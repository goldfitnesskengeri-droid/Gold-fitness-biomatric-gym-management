# DGF Cloud Biometric

A cloud-hosted ADMS/PUSH gateway for DGF Command. Lets eSSL biometric
devices (F22 fingerprint, X990 facial recognition) phone home to this
server over the internet, instead of requiring the local "Fingerprint
Bridge" Python daemon to run continuously on the front-desk PC and poll the
device over the LAN.

## Status: Phase 2 scaffold, NOT production-ready

- No physical device has been tested against this gateway yet.
- The exact byte-level ADMS payload format for the owner's actual F22/X990
  firmware is unconfirmed - every `/iclock/*` request is logged raw to
  `biometric_raw_events` first, and the parsers in `src/lib/parsers.js` are
  explicitly marked as best-effort placeholders pending that real capture.
- Do not point a production device at this until it has been checked
  against a real unit and the owner has confirmed Comm/Network menu support
  for a "Cloud Server"/ADMS option on their specific hardware.

## How it fits into DGF Command

This reads/writes the exact same tables the local `dgf_bridge.py` daemon
already uses (its real source was located and read - see `reference/
dgf_bridge.py` - so this is built to match its contract, not a guess):

- `biometric_devices` - device registry, matched by `serial_number`; heartbeat written to `status`/`last_connected_at` exactly like the bridge's `check_devices()`.
- `biometric_commands` - command queue. **Important**: `device_uid` on this table is the member's shared on-device user id (the same value `push_user()`/`copy_to_other_devices()` writes to every device for that member) - it is NOT a device identifier. Commands are scoped to a specific device via `device_id` (FK to `biometric_devices.id`). Status flow matches the bridge exactly: `pending` -> `running` -> `done`/`failed`, claimed with the same conditional `pending`-only update so the bridge and this gateway can never double-execute the same command if both are ever running at once during the migration period.
- `biometric_enrollments` - `device_uid` -> `member_id` lookup, used to resolve an ATTLOG punch's PIN to a real member (mirrors the bridge's `pull_attendance()` `uid_map`).
- `attendance_logs` - punches are inserted with the same field set the bridge writes (`member_id`, `biometric_id`, `check_in_time` AND `checkin_time`, `device_name`, `punch_source: 'biometric'`, `status: 'present'`, `sync_status: 'synced'`), and `members.last_checkin` is updated the same way.
- `biometric_raw_events` - new, additive-only table (see `migrations/0001_biometric_raw_events.sql`) for raw request capture. This is the one genuinely new table - everything else above already existed and is actively used.

The command **vocabulary** (`enroll`, `add_finger`, `delete_finger`,
`delete_user`, `block`, `unblock`, `push_user`, `pull_users`) is copied
directly from `dgf_bridge.py`'s own command switch, so this gateway's
`src/lib/parsers.js:buildCommandLine()` stays compatible with whatever the
app's UI already queues. What's still unverified is the ADMS **wire
format** itself - the bridge talks to devices over raw TCP/4370 (pyzk), not
ADMS text commands, so there's no prior art for the exact
`C:<id>:<command>` line syntax a given F22/X990 firmware expects. That part
only gets confirmed once a real device is pointed at this gateway and its
request lands in `biometric_raw_events`.

## Endpoints (ADMS/PUSH protocol)

| Route | Method | Purpose |
|---|---|---|
| `/iclock/cdata` | GET | Device handshake/check-in |
| `/iclock/cdata` | POST | Device pushes attendance/data rows (`?table=ATTLOG` etc.) |
| `/iclock/getrequest` | GET | Device polls for queued commands |
| `/iclock/devicecmd` | POST | Device reports command execution result |
| `/iclock/registry` | GET/POST | Device registration |

## Local development

```bash
npm install
cp .env.example .env   # fill in SUPABASE_SERVICE_ROLE_KEY
npm run dev
```

## Deployment

Deployed as a Render web service (always-on, so it doesn't miss device
heartbeats on a sleeping free tier). Environment variables
(`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMS_SHARED_SECRET`) are set
in the Render dashboard - never committed to this repo.

## Security

- The Supabase service-role key lives only in this server's environment
  variables - never sent to a device or browser.
- No raw fingerprint images are stored anywhere in this gateway.
- No default-open/default-allow behavior on a connection or lookup failure.
