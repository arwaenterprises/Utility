// ============================================
// SYNC STATUS LINE (Box Scanner and Year/Season Sort)
// ============================================
// A small line under the sync badge that says, in plain words, whether everything has reached the
// server, when the last upload happened, and - if closed boxes have been waiting too long - that
// uploads are stuck and why. Scanning is never blocked; the message is only information (tap it to
// retry). The wording lives here (pure function) so it can be tested without a browser.
const SyncStatus = (function () {
    const STUCK_MS = 10 * 60 * 1000;     // waiting longer than this while online counts as "stuck"

    function ago(ms) {
        const m = Math.floor(ms / 60000);
        if (m < 1) return 'just now';
        if (m < 60) return m + ' min ago';
        const h = Math.floor(m / 60);
        if (h < 24) return h + ' h ago';
        return Math.floor(h / 24) + ' d ago';
    }

    function duration(ms) {
        const m = Math.max(1, Math.floor(ms / 60000));
        if (m < 60) return m + ' min';
        const h = Math.floor(m / 60);
        return h < 24 ? h + ' h' : Math.floor(h / 24) + ' d';
    }

    // Turns a raw error into something an operator can act on.
    function friendlyError(message) {
        const m = String(message || '');
        if (!m) return '';
        if (/failed to fetch|networkerror|network request failed|load failed|timeout|timed out/i.test(m)) return 'cannot reach the server';
        if (/jwt|token|not signed in|unauthor|401|refresh/i.test(m)) return 'please sign out and sign in again';
        if (/row-level security|permission denied|403/i.test(m)) return 'not allowed - please sign in again';
        return m.length > 60 ? m.slice(0, 57) + '...' : m;
    }

    // state: { pending, oldestMs, online, lastOkMs, lastError, now, noun }
    //   pending  - number of closed boxes' items not yet uploaded
    //   oldestMs - timestamp (ms) of the oldest waiting item
    //   lastOkMs - timestamp (ms) of the last successful upload (0 = never)
    //   noun     - what is being counted ("items" / "scans")
    function describe(state) {
        const now = state.now || Date.now();
        const noun = state.noun || 'items';
        if (!state.pending) {
            return { level: 'ok', text: state.lastOkMs ? '✓ All uploaded · last upload ' + ago(now - state.lastOkMs) : '✓ Nothing waiting to upload', retry: false };
        }
        if (!state.online) {
            return { level: 'warn', text: `⚠ Offline - ${state.pending} ${noun} waiting. They upload by themselves when you are back online.`, retry: false };
        }
        const waited = now - (state.oldestMs || now);
        if (waited >= STUCK_MS) {
            const why = friendlyError(state.lastError);
            return { level: 'warn', text: `⚠ ${state.pending} ${noun} not uploaded for ${duration(waited)}${why ? ' (' + why + ')' : ''}. Tap to retry. Nothing is lost - keep scanning.`, retry: true };
        }
        return { level: 'working', text: `⬆ Uploading ${state.pending} ${noun}…` + (state.lastOkMs ? ' last upload ' + ago(now - state.lastOkMs) : ''), retry: true };
    }

    function render(el, state) {
        if (!el) return;
        const d = describe(state);
        el.textContent = d.text;
        el.className = 'sync-status-line ' + d.level + (d.retry ? ' tappable' : '');
        el.title = d.retry ? 'Tap to retry now' : '';
    }

    return { describe, render, friendlyError, ago, STUCK_MS };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SyncStatus;
