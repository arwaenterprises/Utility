// ============================================
// USAGE STATISTICS (counts only - never scan contents)
// ============================================
// Each tool calls Usage.log(tool, action, count, qty) when a user finishes something:
//   box_scanner / year_season  box_closed   count = boxes closed,   qty = items in them
//   item_barcode / box_code    print_job    count = print jobs,     qty = labels / codes printed
//   box_segregate              lookup_found | lookup_not_found
//   box_segregate_pallet       box_scanned | box_duplicate | box_not_found
//   price_check                lookup_found | lookup_not_found
// Counts are added up on the device (per user, per day), survive being offline, and are
// sent to Supabase in small batches (supabase/schema.sql, "USAGE STATISTICS"). Only the
// platform owner can read them (weekly report: stats/). Logging can never break the app:
// every failure is swallowed.
const Usage = (function () {
    const FLUSH_INTERVAL_MS = 60000;
    let flushing = false;
    let timer = null;

    const key = () => 'usage_pending_' + (AppState.user ? AppState.user.id : 'anon');
    const today = () => new Date().toLocaleDateString('en-CA');   // YYYY-MM-DD in the device's time zone
    const load = () => Storage.getJSON(key()) || {};
    const save = (p) => Storage.setJSON(key(), p);

    function log(tool, action, count, qty) {
        try {
            if (!AppState.user) return;
            const pending = load();
            const k = [today(), tool, action].join('|');
            const e = pending[k] || { c: 0, q: 0 };
            e.c += (count == null ? 1 : count);
            e.q += (qty || 0);
            pending[k] = e;
            save(pending);
            clearTimeout(timer);
            timer = setTimeout(flush, 3000);
        } catch (err) { /* statistics must never break the app */ }
    }

    // Sends what has been counted. An entry is removed only after the server accepted it, so
    // being offline (or a server error) just means it is sent on a later attempt.
    async function flush() {
        if (flushing || !AppState.user || !AppState.isOnline) return;
        flushing = true;
        try {
            const toSend = load();
            for (const k of Object.keys(toSend)) {
                const [day, tool, action] = k.split('|');
                const { c, q } = toSend[k];
                const { error } = await supabaseClient.rpc('log_usage', { p_tool: tool, p_action: action, p_count: c, p_qty: q, p_day: day });
                // A network / server problem keeps the entry for later; an entry the server will never
                // accept ("Invalid usage ...") is dropped so it cannot block the rest.
                if (error && !/^Invalid usage/.test(error.message || '')) break;
                const now = load();
                const cur = now[k];
                if (cur) {
                    cur.c -= c; cur.q -= q;
                    if (cur.c <= 0 && cur.q <= 0) delete now[k]; else now[k] = cur;
                    save(now);
                }
            }
        } catch (err) { /* retry on the next tick */ }
        finally { flushing = false; }
    }

    setInterval(flush, FLUSH_INTERVAL_MS);
    window.addEventListener('online', () => setTimeout(flush, 1000));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

    return { log, flush };
})();
