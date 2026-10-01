// ============================================
// SUPABASE CLIENT
// ============================================
// Named supabaseClient (not `supabase`) to avoid clashing with the global
// `supabase` namespace the Supabase JS library itself exposes.
const supabaseClient = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
