// ============================================
// TEAM QR LINKS - the labourer's side
// ============================================
// A labourer scans a team QR with the phone's own scanner. It opens  /j/<token>  which Netlify forwards to
// /?join=<token>. They see WHO the link belongs to (enterprise, admin, tool, job - read from the server),
// type only their name, and from then on this device shows ONLY that one tool.
// Behind the scenes the device signs in anonymously (no Google account) and join_team_link() attaches it to the
// admin's team. The server stamps every scan with the job (Remark) and the operator's name - see supabase/schema.sql.
//
// What is remembered on the device (so it keeps working offline): Storage 'operator'.
const OP_STORAGE_KEY = 'operator';
const OP_RECHECK_MS = 2 * 60 * 1000;

const OP_T = {
    en: {
        enterprise: 'Enterprise', admin: 'Admin', tool: 'Tool', job: 'Job',
        loading: 'Checking this QR code...',
        invalid: 'This QR code is not valid. Ask your admin for the current one.',
        stopped: 'This QR code has been stopped by your admin. Ask for the current one.',
        inactive: 'This QR code was switched off after 3 days without scanning. Ask your admin for a new one.',
        offline: 'You are offline. Connect to the internet to join.',
        googleSignedIn: 'This device is signed in with a Google account. Sign out first to join as a labourer.',
        busy: 'This device still has scans from the job "{job}". Reset that job first (it downloads your scans), then scan the QR again.',
        nameRequired: 'Please type your name.',
        joinFailed: 'Could not join. Please try again.',
        leaveBusy: 'Reset your scans first (this downloads them), then you can leave this job.',
        leaveAsk: 'Leave this job on this device? To work again you will need to scan the QR code.',
        banner: { stopped: 'This job has been stopped by your admin. New scanning is switched off.',
                  inactive: 'This job was switched off after 3 days without scanning. New scanning is switched off.',
                  removed: 'Your admin removed you from this job. New scanning is switched off.' },
        blocked: 'Scanning is switched off for this job.',
        leave: 'Leave this job', staff: 'Operator'
    },
    ar: {
        enterprise: 'المؤسسة', admin: 'المسؤول', tool: 'الأداة', job: 'المهمة',
        loading: 'جارٍ التحقق من رمز QR هذا...',
        invalid: 'رمز QR هذا غير صالح. اطلب من المسؤول الرمز الحالي.',
        stopped: 'أوقف المسؤول رمز QR هذا. اطلب الرمز الحالي.',
        inactive: 'تم إيقاف رمز QR هذا بعد 3 أيام دون مسح. اطلب من المسؤول رمزًا جديدًا.',
        offline: 'أنت غير متصل بالإنترنت. اتصل بالإنترنت للانضمام.',
        googleSignedIn: 'هذا الجهاز مسجّل الدخول بحساب Google. سجّل الخروج أولًا للانضمام كعامل.',
        busy: 'لا يزال في هذا الجهاز عمليات مسح من المهمة "{job}". أعد ضبط تلك المهمة أولًا (تنزّل عمليات المسح)، ثم امسح الرمز مرة أخرى.',
        nameRequired: 'الرجاء كتابة اسمك.',
        joinFailed: 'تعذّر الانضمام. حاول مرة أخرى.',
        leaveBusy: 'أعد ضبط عمليات المسح أولًا (تنزّل الملف)، ثم يمكنك مغادرة هذه المهمة.',
        leaveAsk: 'هل تريد مغادرة هذه المهمة على هذا الجهاز؟ للعمل مرة أخرى ستحتاج إلى مسح رمز QR.',
        banner: { stopped: 'أوقف المسؤول هذه المهمة. تم إيقاف المسح الجديد.',
                  inactive: 'تم إيقاف هذه المهمة بعد 3 أيام دون مسح. تم إيقاف المسح الجديد.',
                  removed: 'أزالك المسؤول من هذه المهمة. تم إيقاف المسح الجديد.' },
        blocked: 'المسح متوقف لهذه المهمة.',
        leave: 'مغادرة هذه المهمة', staff: 'عامل'
    }
};
function opT(key) {
    const lang = (typeof AppLang !== 'undefined' && AppLang.get() === 'ar') ? 'ar' : 'en';
    return OP_T[lang][key] !== undefined ? OP_T[lang][key] : OP_T.en[key];
}
function opToolName(toolId) {
    const app = APPS.find(a => a.id === toolId);
    return app ? app.name : toolId;
}

// ---- the token in the address ----
function operatorTokenFromUrl() {
    try {
        const t = new URLSearchParams(window.location.search).get('join');
        return t && /^[A-Za-z0-9]{16,64}$/.test(t) ? t : null;
    } catch (e) { return null; }
}
function operatorForgetTokenInUrl() {
    try { window.history.replaceState(null, '', window.location.pathname); } catch (e) { /* ignore */ }
}

// ---- what this device remembers ----
function operatorLoadCache(userId) {
    const c = Storage.getJSON(OP_STORAGE_KEY);
    return c && c.user_id === userId ? c : null;
}
function operatorSave(info) {
    Storage.setJSON(OP_STORAGE_KEY, info);
}
function isOperatorSession(session) {
    return !!(session && session.user && session.user.is_anonymous);
}

// ---- the join screen ----
let joinPending = null;       // { token, info }

function joinSetMessage(text, isError) {
    const el = document.getElementById('joinMsg');
    el.textContent = text || '';
    el.classList.toggle('show', !!text);
    el.classList.toggle('error', !!isError);
}

function joinRenderInfo(info) {
    document.getElementById('joinEnterprise').textContent = info.enterprise_name || '';
    document.getElementById('joinAdmin').textContent = info.admin_name || '';
    document.getElementById('joinTool').textContent = opToolName(info.tool);
    document.getElementById('joinJob').textContent = info.job_name || '';
}

async function operatorShowJoin(token, session) {
    showScreen('joinScreen');
    document.getElementById('joinForm').style.display = 'none';
    document.getElementById('joinInfo').style.display = 'none';
    joinSetMessage(opT('loading'), false);
    joinPending = null;

    if (session && !isOperatorSession(session)) {
        joinSetMessage(opT('googleSignedIn'), true);
        document.getElementById('joinSignOutBtn').style.display = '';
        return;
    }
    document.getElementById('joinSignOutBtn').style.display = 'none';
    if (!AppState.isOnline) { joinSetMessage(opT('offline'), true); return; }

    const { data, error } = await supabaseClient.rpc('get_team_link_info', { p_token: token });
    const info = Array.isArray(data) ? data[0] : data;
    if (error || !info) { joinSetMessage(opT('invalid'), true); return; }
    joinRenderInfo(info);
    document.getElementById('joinInfo').style.display = '';
    if (info.state === 'stopped') { joinSetMessage(opT('stopped'), true); return; }
    if (info.state === 'inactive') { joinSetMessage(opT('inactive'), true); return; }

    // A device that still holds unsent/unreset scans from another job must finish that job first.
    const cache = session ? operatorLoadCache(session.user.id) : null;
    if (cache && AppState.hasActiveSession && cache.link_id && cache.job_name) {
        joinSetMessage(opT('busy').replace('{job}', cache.job_name), true);
        return;
    }
    joinPending = { token, info };
    joinSetMessage('', false);
    const nameInput = document.getElementById('joinNameInput');
    nameInput.value = cache && cache.name ? cache.name : '';
    document.getElementById('joinForm').style.display = '';
    nameInput.focus();
}

async function operatorSubmitJoin() {
    if (!joinPending) return;
    const name = document.getElementById('joinNameInput').value.trim();
    if (!name || name.length > 40) { joinSetMessage(opT('nameRequired'), true); return; }
    if (!AppState.isOnline) { joinSetMessage(opT('offline'), true); return; }
    const btn = document.getElementById('joinBtn');
    btn.disabled = true;
    try {
        let { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) {
            const res = await supabaseClient.auth.signInAnonymously();
            if (res.error || !res.data.session) throw res.error || new Error('no session');
            session = res.data.session;
        }
        const { data, error } = await supabaseClient.rpc('join_team_link', { p_token: joinPending.token, p_name: name });
        if (error || !data) throw error || new Error('no result');
        const info = joinPending.info;
        operatorSave({
            user_id: session.user.id, link_id: data.link_id, enterprise_id: data.enterprise_id,
            tool: data.tool, job_name: data.job_name, name: data.name,
            enterprise_name: info.enterprise_name, admin_name: info.admin_name, state: 'active'
        });
        operatorForgetTokenInUrl();
        joinPending = null;
        await operatorEnter(session);
    } catch (err) {
        console.error('Join failed:', err);
        const m = (err && err.message) || '';
        joinSetMessage(/has ended|3 days/i.test(m) ? opT('stopped') : opT('joinFailed'), true);
    } finally {
        btn.disabled = false;
    }
}

// ---- entering and leaving operator mode ----
async function operatorEnter(session) {
    let cache = operatorLoadCache(session.user.id);
    if (!cache && AppState.isOnline) {
        // The device kept its sign-in but forgot the job (cleared site data): ask the server.
        const { data } = await supabaseClient.rpc('my_team_link');
        const row = Array.isArray(data) ? data[0] : data;
        if (row) {
            cache = {
                user_id: session.user.id, link_id: row.link_id, tool: row.tool, job_name: row.job_name,
                name: row.operator_name, enterprise_name: row.enterprise_name, admin_name: row.admin_name, state: row.state
            };
            const { data: prof } = await supabaseClient.from('profiles').select('enterprise_id').eq('id', session.user.id).single();
            cache.enterprise_id = prof ? prof.enterprise_id : null;
            operatorSave(cache);
        }
    }
    if (!cache) {            // nothing to work on: back to the start
        await supabaseClient.auth.signOut();
        showScreen('loginScreen');
        return;
    }
    AppState.user = session.user;
    AppState.operator = cache;
    AppState.profile = { id: session.user.id, tier: 'operator', enterprise_id: cache.enterprise_id, display_name: cache.name, email: '' };
    document.body.classList.add('operator-mode');
    updateHeaderUser();
    checkExistingSession();
    operatorRenderBar();
    openApp(cache.tool);
    refreshOperatorState();
    startOperatorRechecks();
}

let operatorRecheckTimer = null;
function startOperatorRechecks() {
    if (operatorRecheckTimer) return;
    operatorRecheckTimer = setInterval(() => refreshOperatorState(), OP_RECHECK_MS);
    window.addEventListener('online', () => refreshOperatorState());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshOperatorState(); });
    if (typeof AppLang !== 'undefined') AppLang.onChange(() => { if (AppState.operator) operatorRenderBar(); });
}

// Asks the server whether the job is still on. Offline: keeps what the device already knows.
async function refreshOperatorState() {
    if (!AppState.operator || !AppState.isOnline) return;
    const { data, error } = await supabaseClient.rpc('my_team_link');
    if (error) return;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return;
    const op = AppState.operator;
    const changed = op.state !== row.state || op.job_name !== row.job_name || op.name !== row.operator_name || op.link_id !== row.link_id;
    op.state = row.state; op.job_name = row.job_name; op.name = row.operator_name; op.link_id = row.link_id;
    op.enterprise_name = row.enterprise_name; op.admin_name = row.admin_name; op.tool = row.tool;
    operatorSave(op);
    if (changed) operatorApplyChange();
}

// The bar at the top of the tool: who/where/what, plus a notice when the job has been switched off.
function operatorRenderBar() {
    const op = AppState.operator;
    const bar = document.getElementById('operatorBar');
    if (!op) { bar.style.display = 'none'; return; }
    bar.style.display = '';
    document.getElementById('opBarJob').textContent = op.job_name;
    document.getElementById('opBarWho').textContent = op.name + ' · ' + op.enterprise_name + ' (' + op.admin_name + ')';
    const notice = document.getElementById('opBarNotice');
    const text = op.state !== 'active' ? (opT('banner')[op.state] || opT('blocked')) : '';
    notice.textContent = text;
    notice.style.display = text ? '' : 'none';
    document.getElementById('signOutBtn').setAttribute('title', opT('leave'));
}

function operatorBlocked() {
    return !!(AppState.operator && AppState.operator.state !== 'active');
}

// The job's Remark is the job name, set by the admin: shown, never typed.
function operatorRemark() {
    return AppState.operator ? AppState.operator.job_name : '';
}

function operatorApplyChange() {
    operatorRenderBar();
    if (typeof updateScannerScanFieldsEnabled === 'function' && document.getElementById('boxIdInput')) updateScannerScanFieldsEnabled();
    if (typeof ysUpdateScanFieldsEnabled === 'function' && document.getElementById('ysBarcodeInput')) ysUpdateScanFieldsEnabled();
    if (AppState.operator && AppState.operator.state === 'active') {
        const remarkInput = document.getElementById('scannerRemarkInput');
        if (remarkInput && !ScannerState.remark) remarkInput.value = AppState.operator.job_name;
    }
}

// Tells the tool a scan was refused because the job had been switched off; re-checks so the bar updates.
function operatorNoteScanRefused(message) {
    if (AppState.operator && /has ended|3 days/i.test(message || '')) refreshOperatorState();
}

async function operatorLeave() {
    if (AppState.hasActiveSession) { alert(opT('leaveBusy')); return; }
    if (!confirm(opT('leaveAsk'))) return;
    Storage.remove(OP_STORAGE_KEY);
    AppState.operator = null;
    document.body.classList.remove('operator-mode');
    await signOut();
}
