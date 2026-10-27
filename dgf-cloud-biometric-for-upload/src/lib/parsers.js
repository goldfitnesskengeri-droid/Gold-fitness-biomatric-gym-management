/**
 * ADMS wire-format parsing (the text a physical device sends/receives over
 * HTTP). This is still a BEST-EFFORT reconstruction from public, high-level
 * ADMS documentation - unverified against the owner's actual F22/X990
 * firmware. Treat every function here as "adjust once we see real traffic
 * in biometric_raw_events", not as finished.
 *
 * The command VOCABULARY below (enroll/add_finger/delete_finger/...) is NOT
 * a guess - it's copied directly from the real dgf_bridge.py source
 * (biometric_commands.command values it switches on), so the gateway stays
 * compatible with the exact same queue the app's UI already writes to.
 *
 * Commonly documented ADMS ATTLOG row shape (tab-separated), one row per
 * line in the POST body when table=ATTLOG:
 *   PIN\tTIME\tSTATUS\tVERIFY\tWORKCODE\t...
 * e.g. "16\t2026-10-24 09:15:03\t0\t1\t0"
 */
function parseAttlogBody(rawBody) {
  if (!rawBody || typeof rawBody !== 'string') return [];
  return rawBody
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const cols = line.split('\t');
      return {
        deviceUid: cols[0] ?? null, // matches biometric_enrollments.device_uid, NOT a device identifier
        time: cols[1] ?? null,
        status: cols[2] ?? null, // check-in/out code, meaning unconfirmed
        verifyType: cols[3] ?? null, // fingerprint/face/card, meaning unconfirmed
        workcode: cols[4] ?? null,
        raw: line,
      };
    });
}

/**
 * Turn a biometric_commands row into an ADMS command-queue line for a
 * /iclock/getrequest response. The "C:<id>:<command>" envelope is confirmed
 * by public ADMS references; the command vocabulary inside it (DATA UPDATE,
 * DATA DELETE, etc, and its exact argument format) is NOT confirmed and will
 * need adjusting once we see what the owner's F22/X990 actually accept -
 * dgf_bridge.py talks to the device over raw TCP/4370 (pyzk), not ADMS text
 * commands, so this mapping has no prior art to copy from.
 */
function buildCommandLine(cmdRow) {
  const { id, command, device_uid: deviceUid, finger_index: fingerIndex } = cmdRow;
  switch (command) {
    case 'enroll':
    case 'add_finger':
      return `C:${id}:DATA UPDATE FINGERTMP PIN=${deviceUid}\tFID=${fingerIndex ?? 0}`;
    case 'delete_finger':
      return `C:${id}:DATA DELETE FINGERTMP PIN=${deviceUid}\tFID=${fingerIndex ?? 0}`;
    case 'delete_user':
      return `C:${id}:DATA DELETE USERINFO PIN=${deviceUid}`;
    case 'block':
      return `C:${id}:DATA UPDATE USERINFO PIN=${deviceUid}\tEnabled=0`;
    case 'unblock':
      return `C:${id}:DATA UPDATE USERINFO PIN=${deviceUid}\tEnabled=1`;
    case 'push_user':
      return `C:${id}:DATA UPDATE USERINFO PIN=${deviceUid}`;
    case 'pull_users':
      return `C:${id}:DATA QUERY USERINFO`;
    default:
      // Unknown command type - surface it rather than silently skipping.
      return `C:${id}:INFO UNKNOWN_COMMAND ${command}`;
  }
}

module.exports = { parseAttlogBody, buildCommandLine };
