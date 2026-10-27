const { supabase } = require('./supabase');

/**
 * Log the complete raw request (headers + query + raw body) unconditionally,
 * before any parsing is attempted.
 *
 * Why: the exact byte-level ADMS field/body format for the owner's actual
 * F22/X990 firmware is NOT publicly documented anywhere we could find. Rather
 * than guess a parsing format and silently drop or mis-handle real device
 * traffic, every hit to an /iclock/* route is recorded here first. Once real
 * devices are pointed at this gateway, these rows are the ground truth used
 * to write (and correct) the real parsers in parsers.js.
 */
async function logRawEvent({ route, method, query, headers, rawBody, remoteIp }) {
  try {
    const { error } = await supabase.from('biometric_raw_events').insert({
      route,
      method,
      query,
      headers,
      raw_body: rawBody,
      remote_ip: remoteIp,
      received_at: new Date().toISOString(),
    });
    if (error) {
      // eslint-disable-next-line no-console
      console.error('[db] logRawEvent failed:', error.message);
    }
  } catch (err) {
    // Never let logging failures break the actual device response.
    // eslint-disable-next-line no-console
    console.error('[db] logRawEvent threw:', err.message);
  }
}

/**
 * Look up the device row by its serial number (what the device itself
 * reports, matching the SN query param in the ADMS handshake). This is the
 * same row the local dgf_bridge.py reads/writes (biometric_devices), keyed
 * the same way check_devices() in the bridge verifies it
 * ("serial in app is X - check IP address" warning).
 */
async function getDeviceBySerial(serialNumber) {
  if (!serialNumber) return null;
  const { data, error } = await supabase
    .from('biometric_devices')
    .select('id, gym_id, device_name, is_active, bridge_enabled, serial_number')
    .eq('serial_number', serialNumber)
    .maybeSingle();
  if (error) {
    // eslint-disable-next-line no-console
    console.error('[db] getDeviceBySerial failed:', error.message);
    return null;
  }
  return data;
}

/**
 * Record that a device just talked to us (handshake, attendance push, or
 * command poll all count as "alive"). Mirrors exactly what
 * dgf_bridge.py's check_devices() already writes on a successful poll, so
 * the existing Biometric Devices dashboard tab doesn't need to change to
 * show gateway-connected devices as online too.
 */
async function recordDeviceHeartbeat(deviceId, extra = {}) {
  if (!deviceId) return;
  const { error } = await supabase
    .from('biometric_devices')
    .update({
      status: 'online',
      last_connected_at: new Date().toISOString(),
      ...extra,
    })
    .eq('id', deviceId);
  if (error) {
    // eslint-disable-next-line no-console
    console.error('[db] recordDeviceHeartbeat failed:', error.message);
  }
}

/**
 * Fetch commands still pending for this device (biometric_commands.device_id
 * - the FK to biometric_devices, NOT device_uid, which is actually the
 * member's shared on-device user id - see dgf_bridge.py:push_user). Mirrors
 * process_commands()'s own query shape (status=pending, oldest first).
 */
async function getPendingCommands(deviceId) {
  if (!deviceId) return [];
  const { data, error } = await supabase
    .from('biometric_commands')
    .select('id, command, member_id, device_uid, finger_index, attempts')
    .eq('device_id', deviceId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(20);
  if (error) {
    // eslint-disable-next-line no-console
    console.error('[db] getPendingCommands failed:', error.message);
    return [];
  }
  return data || [];
}

/**
 * Claim a pending command the same way process_commands() does: a
 * conditional update (status=pending -> running) so the local bridge and
 * this gateway can never both execute the same queued command if a gym
 * somehow has both running during the transition period.
 */
async function claimCommand(commandId, previousAttempts) {
  const { data, error } = await supabase
    .from('biometric_commands')
    .update({ status: 'running', started_at: new Date().toISOString(), attempts: (previousAttempts || 0) + 1 })
    .eq('id', commandId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (error) {
    // eslint-disable-next-line no-console
    console.error('[db] claimCommand failed:', error.message);
    return false;
  }
  return Boolean(data);
}

async function finishCommand(commandId, { success, result }) {
  const { error } = await supabase
    .from('biometric_commands')
    .update({
      status: success ? 'done' : 'failed',
      result: result ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq('id', commandId);
  if (error) {
    // eslint-disable-next-line no-console
    console.error('[db] finishCommand failed:', error.message);
  }
}

/**
 * biometric_enrollments.device_uid is the member's shared user id across
 * every device (dgf_bridge.py's push_user/copy_to_other_devices always
 * creates the same uid everywhere) - so an ATTLOG row's PIN resolves to a
 * member the same way pull_attendance()'s uid_map does, independent of
 * which specific device sent the punch.
 */
async function getMemberIdByDeviceUid(deviceUid) {
  if (deviceUid === null || deviceUid === undefined || deviceUid === '') return null;
  const { data, error } = await supabase
    .from('biometric_enrollments')
    .select('member_id')
    .eq('device_uid', deviceUid)
    .maybeSingle();
  if (error) {
    // eslint-disable-next-line no-console
    console.error('[db] getMemberIdByDeviceUid failed:', error.message);
    return null;
  }
  return data ? data.member_id : null;
}

/**
 * Insert a parsed attendance punch. Matches dgf_bridge.py's pull_attendance()
 * row shape exactly (both check_in_time and checkin_time are written - the
 * table genuinely has both columns) so this lands identically whether it
 * came from the local bridge or this cloud gateway.
 */
async function insertAttendanceLog({ gymId, memberId, deviceUid, deviceName, checkinTimeIso }) {
  const { error } = await supabase.from('attendance_logs').insert({
    gym_id: gymId ?? null,
    member_id: memberId ?? null,
    biometric_id: deviceUid !== null && deviceUid !== undefined ? String(deviceUid) : null,
    check_in_time: checkinTimeIso,
    checkin_time: checkinTimeIso,
    device_name: deviceName ?? null,
    punch_source: 'biometric',
    status: 'present',
    sync_status: 'synced',
  });
  if (error) {
    // eslint-disable-next-line no-console
    console.error('[db] insertAttendanceLog failed:', error.message);
  }
  if (!error && memberId) {
    await supabase.from('members').update({ last_checkin: checkinTimeIso }).eq('id', memberId);
  }
}

module.exports = {
  logRawEvent,
  getDeviceBySerial,
  recordDeviceHeartbeat,
  getPendingCommands,
  claimCommand,
  finishCommand,
  getMemberIdByDeviceUid,
  insertAttendanceLog,
};
