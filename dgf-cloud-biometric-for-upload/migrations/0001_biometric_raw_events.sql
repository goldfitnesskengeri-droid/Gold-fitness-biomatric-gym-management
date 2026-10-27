-- Phase 2, migration 1 of DGF Cloud Biometric.
--
-- Purely additive: one new table, no changes to any existing table. The
-- Phase 1 schema audit found that almost every table the original build
-- spec proposed already exists (biometric_devices, biometric_commands,
-- biometric_enrollments, biometric_bridge_status, audit_logs) - this is the
-- one genuinely new table that's needed, because nothing in the existing
-- schema captures the raw, byte-level ADMS traffic a device sends. Until the
-- exact protocol format is confirmed against the real F22/X990 units, every
-- request the gateway receives is logged here unconditionally so parsing
-- can be built/corrected from real data instead of guesses.

create table if not exists public.biometric_raw_events (
  id bigint generated always as identity primary key,
  route text not null,
  method text not null,
  query jsonb,
  headers jsonb,
  raw_body text,
  remote_ip text,
  received_at timestamptz not null default now()
);

create index if not exists biometric_raw_events_received_at_idx
  on public.biometric_raw_events (received_at desc);

comment on table public.biometric_raw_events is
  'Unconditional raw capture of every /iclock/* request the DGF Cloud Biometric gateway receives, used to verify/build real ADMS parsing against the owner''s actual device firmware.';
