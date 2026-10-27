const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  // eslint-disable-next-line no-console
  console.warn('[supabase] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set - DB calls will fail until configured in Render env vars.');
}

// Service-role client. This key must NEVER be sent to a device or browser -
// it only ever lives in this server process's environment variables.
const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false },
});

module.exports = { supabase };
