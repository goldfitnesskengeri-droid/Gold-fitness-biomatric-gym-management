const express = require('express');
const {
  logRawEvent,
  getDeviceBySerial,
  recordDeviceHeartbeat,
  getPendingCommands,
  claimCommand,
  finishCommand,
  getMemberIdByDeviceUid,
  insertAttendanceLog,
} = require('../lib/db');
const { parseAttlogBody, buildCommandLine } = require('../lib/parsers');

const router = express.Router();

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}

// Log every /iclock/* hit unconditionally, before any route-specific logic.
// This is the ground truth for adjusting parsers.js once real devices connect.
router.use(async (req, res, next) => {
  await logRawEvent({
    route: req.path,
    method: req.method,
    query: req.query,
    headers: req.headers,
    rawBody: req.rawBody || null,
    remoteIp: clientIp(req),
  });
  next();
});

/**
 * GET/POST /iclock/cdata
 * - GET with no/empty query, or a handshake query (SN=...): device checking in / registering.
 * - POST with ?table=ATTLOG (or OPERLOG/BIODATA/etc): device pushing data rows in the body.
 *
 * Exact query param set and handshake response body are NOT confirmed against
 * real firmware yet - responding "OK" is the safe default most ADMS server
 * implementations use to acknowledge receipt.
 */
router.get('/cdata', async (req, res) => {
  const sn = req.query.SN || req.query.sn;
  if (sn) {
    const device = await getDeviceBySerial(String(sn));
    if (device) await recordDeviceHeartbeat(device.id);
  }
  res.type('text/plain').send('OK');
});

router.post('/cdata', async (req, res) => {
  const sn = req.query.SN || req.query.sn;
  const table = req.query.table || req.query.Table;
  const device = sn ? await getDeviceBySerial(String(sn)) : null;
  if (device) await recordDeviceHeartbeat(device.id);

  if (table === 'ATTLOG') {
    const rows = parseAttlogBody(req.rawBody);
    for (const row of rows) {
      const memberId = await getMemberIdByDeviceUid(row.deviceUid);
      if (!memberId) {
        // No default-allow behavior on a lookup miss - just don't fabricate
        // an attendance row for a device_uid we can't resolve to a member.
        continue;
      }
      await insertAttendanceLog({
        gymId: device ? device.gym_id : null,
        memberId,
        deviceUid: row.deviceUid,
        deviceName: device ? device.device_name : (sn ? String(sn) : null),
        checkinTimeIso: row.time ? new Date(row.time.replace(' ', 'T')).toISOString() : new Date().toISOString(),
      });
    }
  }
  // ADMS devices expect a plain "OK" (optionally with a count) on success.
  res.type('text/plain').send('OK');
});

/**
 * GET /iclock/getrequest
 * Device polls for queued commands. Reply is one or more "C:<id>:<command>"
 * lines, or "OK" when there is nothing pending. The command vocabulary
 * inside each line (parsers.js:buildCommandLine) is unverified against real
 * firmware; the command TYPES themselves are not a guess (copied from
 * dgf_bridge.py's own biometric_commands.command switch).
 */
router.get('/getrequest', async (req, res) => {
  const sn = req.query.SN || req.query.sn;
  const device = sn ? await getDeviceBySerial(String(sn)) : null;
  if (device) await recordDeviceHeartbeat(device.id);

  const pending = device ? await getPendingCommands(device.id) : [];
  if (!pending.length) {
    res.type('text/plain').send('OK');
    return;
  }

  const claimed = [];
  for (const cmd of pending) {
    // Conditional claim (pending -> running) so this gateway and the local
    // dgf_bridge.py can never both execute the same command if both are
    // somehow running during the migration period.
    // eslint-disable-next-line no-await-in-loop
    if (await claimCommand(cmd.id, cmd.attempts)) claimed.push(cmd);
  }

  if (!claimed.length) {
    res.type('text/plain').send('OK');
    return;
  }

  const lines = claimed.map(buildCommandLine);
  res.type('text/plain').send(lines.join('\n'));
});

/**
 * POST /iclock/devicecmd
 * Device reports back the result of a command it executed. Body format for
 * the result line (typically "ID=<id>\tReturn=<code>\t...") is unverified -
 * raw body is captured above regardless, so nothing is lost even if this
 * parse turns out wrong once we see a real one.
 */
router.post('/devicecmd', async (req, res) => {
  const body = req.rawBody || '';
  const idMatch = body.match(/ID=(\d+)/i);
  const returnMatch = body.match(/Return=(-?\d+)/i);
  if (idMatch) {
    const success = returnMatch ? Number(returnMatch[1]) === 0 : true;
    await finishCommand(Number(idMatch[1]), { success, result: body.slice(0, 500) });
  }
  res.type('text/plain').send('OK');
});

/**
 * GET/POST /iclock/registry
 * Device registration/initial handshake.
 */
router.all('/registry', async (req, res) => {
  const sn = req.query.SN || req.query.sn;
  if (sn) {
    const device = await getDeviceBySerial(String(sn));
    if (device) await recordDeviceHeartbeat(device.id);
  }
  res.type('text/plain').send('OK');
});

module.exports = router;
