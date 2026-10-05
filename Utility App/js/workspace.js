// ============================================
// TEAM & DATA WORKSPACE (enterprise admin)
// ============================================
// One full-screen window that replaces User management and Data Management for an admin:
//   Jobs & People | Data      (account details: the small Account window under your name in the top bar)
// A JOB is one Team QR link (a tool + a job name). It owns its QR code, its people, its boxes and its scans; People
// and Data are views of the same jobs. Everything is shown a page at a time from summaries computed in the database
// (the ws_* functions in supabase/schema.sql), so it stays fast with many jobs, people and scans.
// Members and individuals keep the older Data Management window (js/app.js).
const WS_PAGE = 25;               // jobs / people per page
const WS_DATA_PAGE = 50;          // boxes per page in Data and in a job
const WS_IDLE_HOURS = 24;         // an active job with no scan for this long shows "Idle" (it is never stopped by itself)
const WS_FETCH_ROWS = 1000;       // rows per request when downloading (the API returns at most about 1000)
const WS_FILE_ROWS = 50000;       // rows per Excel file; bigger downloads are split into several files
const WS_SECTIONS = ['jobs', 'data'];
const WS_DATA_TOOLS = ['boxScanner', 'yearSegregate'];   // tools that keep scans; the others keep none, their link just expires
const WS_EXPIRE_WARN_DAYS = 3;       // a link that expires (no data kept) is flagged this many days ahead

const WS_T = {
    en: {
        title: 'Team & Data', jobs: 'Jobs & People', data: 'Data',
        loading: 'Loading...', none: 'Nothing here yet.', failed: 'Could not load this. Please try again.', retry: 'Try again',
        prev: 'Previous', next: 'Next', range: '{a}-{b} of {n}', cancel: 'Cancel', ok: 'OK', back: 'Back',
        all: 'All', allTools: 'All tools', units: 'Units', boxes: 'Boxes', peopleCol: 'People', lastScan: 'Last scan', status: 'Status', tool: 'Tool', job: 'Job',
        person: 'Person', items: 'Items', by: 'Scanned by', when: 'When', box: 'Box', type: 'Type', name: 'Name', jobsCol: 'Jobs',
        never: 'No scans yet', justNow: 'just now', minAgo: '{n} min ago', hAgo: '{n} h ago', dAgo: '{n} days ago',
        active: 'Active', stopped: 'Stopped', idle: 'Idle', open: 'Open', closed: 'Closed',
        deletesOn: 'Deletes {d}', expiresOn: 'Expires {d}', purgedRecent: 'Deleted automatically in the last 30 days', purgedLine: '{job}: {u} units, {d}',
        expireBanner: 'Nobody has used this link for a while. It will switch itself off on {d}. Scan or open it again to keep it.',
        purgeBanner: 'No scans for a long time. This job, its QR link and its data will be deleted automatically on {d}. Download the data first, or scan again to keep the job.',
        // jobs
        newJob: '+ New job', chooseTool: 'Choose a tool', jobPlaceholder: 'Job name (becomes the Remark)', createJob: 'Create QR link',
        searchJobs: 'Search job or person', showPeople: 'Show people', hidePeople: 'Hide people',
        noJobs: 'No jobs match. Create one with + New job.', selected: '{n} selected', downloadSel: 'Download', stopSel: 'Stop links',
        showQr: 'Show QR', stopLink: 'Stop this link', stopAsk: 'Stop this link? Nobody can start new work on it. Scans already made are kept.',
        stopManyAsk: 'Stop {n} links? Nobody can start new work on them. Scans already made are kept.',
        needTool: 'Please choose a tool.', needJob: 'Please type a job name.',
        replaces: 'A link for {tool} named "{job}" is already active. Creating this one stops the old QR of that job (other jobs are not affected). Continue?',
        // job detail
        tabBoxes: 'Boxes', tabPeople: 'People', tabActivity: 'Activity', searchBox: 'Search box, barcode or person', noBoxes: 'No boxes yet.',
        noPeople: 'Nobody has joined this job yet.', removed: 'removed', rename: 'Rename', remove: 'Remove', unitsPerHour: 'Units per hour, last 24 hours',
        sinceLast: 'since last scan', dataOfJob: 'Data of this job', downloadAll: 'Download all', downloadDelete: 'Download and delete…', thisBox: 'Download this box',
        // data
        tools: 'Tool', anyJob: 'Type a job name to add it', anyPerson: 'Type a person to add them', searchData: 'Search box, barcode, person, job',
        matches: '{b} boxes, {u} units match', selectedBoxes: '{n} boxes selected ({u} units)', downloadSelected: 'Download selected', deleteSelected: 'Download and delete selected…', clearSel: 'Clear selection', selectPage: 'Select all on this page', selectBox: 'Select this box', selScope: '{n} selected boxes', noMatches: 'No data matches these filters.', downloadMatches: 'Download everything that matches',
        deleteMatches: 'Download and delete…', filesNote: 'Large downloads are split into several files of {n} rows.', clearFilters: 'Clear filters',
        // dialogs, progress
        deleteTitle: 'Download and delete', deleteLead: 'This will download the data first, then permanently delete it from the server.',
        deleteScope: 'What will be deleted:', deleteCounts: '{b} boxes, {u} units', withScans: '({r} scans)',
        deleteNoData: 'Nothing matches, so there is nothing to delete.',
        preparing: 'Preparing download...', exporting: 'Downloading {n} of {t} scans ({p}%)...', deleting: 'Deleting...',
        downloaded: 'Downloaded {n} scans.', deleted: 'Deleted {n} scans. Scans made after the download started were kept.', noRows: 'There is nothing to download.',
        exportFailed: 'The download failed, so nothing was deleted.', deleteFailed: 'Could not delete: ',
        // people
                renamePrompt: 'Correct name (also changed on their earlier scans):', nameBad: 'Please type a name of 1 to 40 characters.',
        removeAsk: 'Remove this person? Their handheld stops accepting new scans. What they scanned stays.'
    },
    ar: {
        title: 'الفريق والبيانات', jobs: 'المهام والأشخاص', data: 'البيانات',
        loading: 'جارٍ التحميل...', none: 'لا يوجد شيء هنا بعد.', failed: 'تعذّر التحميل. حاول مرة أخرى.', retry: 'حاول مرة أخرى',
        prev: 'السابق', next: 'التالي', range: '\u200E{a}-{b}\u200E من {n}', cancel: 'إلغاء', ok: 'موافق', back: 'رجوع',
        all: 'الكل', allTools: 'كل الأدوات', units: 'القطع', boxes: 'الصناديق', peopleCol: 'الأشخاص', lastScan: 'آخر مسح', status: 'الحالة', tool: 'الأداة', job: 'المهمة',
        person: 'الشخص', items: 'القطع', by: 'بواسطة', when: 'الوقت', box: 'الصندوق', type: 'النوع', name: 'الاسم', jobsCol: 'المهام',
        never: 'لا يوجد مسح بعد', justNow: 'الآن', minAgo: 'قبل {n} دقيقة', hAgo: 'قبل {n} ساعة', dAgo: 'قبل {n} يومًا',
        active: 'نشط', stopped: 'متوقف', idle: 'خامل', open: 'مفتوح', closed: 'مغلق',
        deletesOn: 'تُحذف {d}', expiresOn: 'ينتهي {d}', expireBanner: 'لم يستخدم أحد هذا الرابط منذ مدة. سيتوقف تلقائيًا في {d}. امسح أو افتحه مرة أخرى للإبقاء عليه.', purgedRecent: 'حُذف تلقائيًا خلال آخر 30 يومًا', purgedLine: '{job}: {u} قطعة، {d}',
        purgeBanner: 'لا يوجد مسح منذ مدة طويلة. ستُحذف هذه المهمة ورابط QR وبياناتها تلقائيًا في {d}. حمّل البيانات أولًا، أو امسح مرة أخرى للإبقاء على المهمة.',
        newJob: '+ مهمة جديدة', chooseTool: 'اختر أداة', jobPlaceholder: 'اسم المهمة (يصبح الملاحظة)', createJob: 'إنشاء رابط QR',
        searchJobs: 'ابحث عن مهمة أو شخص', showPeople: 'عرض الأشخاص', hidePeople: 'إخفاء الأشخاص',
        noJobs: 'لا توجد مهام مطابقة. أنشئ واحدة بزر + مهمة جديدة.', selected: 'تم تحديد {n}', downloadSel: 'تحميل', stopSel: 'إيقاف الروابط',
        showQr: 'عرض QR', stopLink: 'إيقاف هذا الرابط', stopAsk: 'هل تريد إيقاف هذا الرابط؟ لن يستطيع أحد بدء عمل جديد عليه. عمليات المسح التي تمت تبقى محفوظة.',
        stopManyAsk: 'هل تريد إيقاف {n} روابط؟ لن يستطيع أحد بدء عمل جديد عليها. عمليات المسح التي تمت تبقى محفوظة.',
        needTool: 'الرجاء اختيار أداة.', needJob: 'الرجاء كتابة اسم المهمة.',
        replaces: 'يوجد رابط نشط لأداة {tool} باسم "{job}". إنشاء هذا الرابط سيوقف رمز QR القديم لهذه المهمة (المهام الأخرى لا تتأثر). هل تريد المتابعة؟',
        tabBoxes: 'الصناديق', tabPeople: 'الأشخاص', tabActivity: 'النشاط', searchBox: 'ابحث عن صندوق أو باركود أو شخص', noBoxes: 'لا توجد صناديق بعد.',
        noPeople: 'لم ينضم أحد إلى هذه المهمة بعد.', removed: 'تمت إزالته', rename: 'تغيير الاسم', remove: 'إزالة', unitsPerHour: 'القطع في الساعة، آخر 24 ساعة',
        sinceLast: 'منذ آخر مسح', dataOfJob: 'بيانات هذه المهمة', downloadAll: 'تحميل الكل', downloadDelete: 'تحميل ثم حذف…', thisBox: 'تحميل هذا الصندوق',
        tools: 'الأداة', anyJob: 'اكتب اسم مهمة لإضافتها', anyPerson: 'اكتب اسم شخص لإضافته', searchData: 'ابحث عن صندوق أو باركود أو شخص أو مهمة',
        matches: '{b} صندوق، {u} قطعة مطابقة', selectedBoxes: 'تم تحديد {n} صندوق ({u} قطعة)', downloadSelected: 'تحميل المحدد', deleteSelected: 'تحميل ثم حذف المحدد…', clearSel: 'مسح التحديد', selectPage: 'تحديد كل ما في هذه الصفحة', selectBox: 'تحديد هذا الصندوق', selScope: '{n} صندوق محدد', noMatches: 'لا توجد بيانات مطابقة لهذه المرشحات.', downloadMatches: 'تحميل كل ما يطابق',
        deleteMatches: 'تحميل ثم حذف…', filesNote: 'التحميلات الكبيرة تُقسَّم إلى عدة ملفات، كل ملف {n} صف.', clearFilters: 'مسح المرشحات',
        deleteTitle: 'تحميل ثم حذف', deleteLead: 'سيتم تحميل البيانات أولًا ثم حذفها نهائيًا من الخادم.',
        deleteScope: 'ما سيتم حذفه:', deleteCounts: '{b} صندوق، {u} قطعة', withScans: '({r} عملية مسح)',
        deleteNoData: 'لا شيء يطابق، لذا لا يوجد ما يُحذف.',
        preparing: 'جارٍ تجهيز التحميل...', exporting: 'جارٍ تحميل {n} من {t} عملية مسح ({p}%)...', deleting: 'جارٍ الحذف...',
        downloaded: 'تم تحميل {n} عملية مسح.', deleted: 'تم حذف {n} عملية مسح. عمليات المسح بعد بدء التحميل بقيت محفوظة.', noRows: 'لا يوجد ما يمكن تحميله.',
        exportFailed: 'فشل التحميل، لذا لم يُحذف شيء.', deleteFailed: 'تعذّر الحذف: ',
                renamePrompt: 'الاسم الصحيح (يتغير أيضًا في عمليات المسح السابقة):', nameBad: 'الرجاء كتابة اسم من 1 إلى 40 حرفًا.',
        removeAsk: 'هل تريد إزالة هذا الشخص؟ سيتوقف جهازه عن قبول عمليات مسح جديدة. ما مسحه يبقى محفوظًا.'
    }
};

function wsLang() { return (typeof AppLang !== 'undefined' && AppLang.get() === 'ar') ? 'ar' : 'en'; }
function wsT(key, vars) {
    let t = WS_T[wsLang()][key];
    if (t === undefined) t = WS_T.en[key];
    if (t === undefined) t = key;
    if (vars) Object.keys(vars).forEach(k => { t = t.split('{' + k + '}').join(vars[k]); });
    return t;
}
const wsEsc = (s) => escapeHtml(s);
const wsNum = (n) => Number(n || 0).toLocaleString('en-US');
const wsEl = (id) => document.getElementById(id);

function wsAgo(iso) {
    if (!iso) return wsT('never');
    const secs = (Date.now() - new Date(iso).getTime()) / 1000;
    if (secs < 60) return wsT('justNow');
    const m = Math.floor(secs / 60);
    if (m < 60) return wsT('minAgo', { n: m });
    const h = Math.floor(m / 60);
    if (h < 48) return wsT('hAgo', { n: h });
    return wsT('dAgo', { n: Math.floor(h / 24) });
}
function wsDuration(iso) {                       // "27 h" / "3 days" for the idle alerts
    const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
    return h < 48 ? h + ' h' : Math.floor(h / 24) + ' ' + (wsLang() === 'ar' ? 'يومًا' : 'days');
}
function wsToolName(tool) {
    const a = APPS.find(x => x.id === tool);
    return a ? appName(a) : tool;
}
function wsTools() { return APPS.filter(a => !a.modal); }
function wsIsDataTool(t) { return WS_DATA_TOOLS.includes(t); }
function wsIsIdle(j) {
    return j.state === 'active' && (Date.now() - new Date(j.last_scan_at || j.created_at).getTime()) > WS_IDLE_HOURS * 3600000;
}
// What happens by itself soon: 'delete' (a data job, within 7 days of deletion with its data), 'expire' (a job that keeps
// no data, within 3 days of its link switching off) or null.
function wsPurgeKind(j) {
    if (!j.purge_at) return null;
    const left = new Date(j.purge_at).getTime() - Date.now();
    if (wsIsDataTool(j.tool)) return left <= 7 * 86400000 ? 'delete' : null;
    return left <= WS_EXPIRE_WARN_DAYS * 86400000 ? 'expire' : null;
}
function wsPurgeSoon(j) { return wsPurgeKind(j) !== null; }
function wsPurgeBanner(j) { return wsT(wsPurgeKind(j) === 'expire' ? 'expireBanner' : 'purgeBanner', { d: wsDate(j.purge_at) }); }
function wsDate(iso) { return new Date(iso).toLocaleDateString(wsLang() === 'ar' ? 'ar' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
function wsPill(j) {
    const k = wsPurgeKind(j);
    if (k) return `<span class="ws-pill bad" title="${wsEsc(wsPurgeBanner(j))}">${wsEsc(wsT(k === 'expire' ? 'expiresOn' : 'deletesOn', { d: wsDate(j.purge_at) }))}</span>`;
    if (j.state !== 'active') return `<span class="ws-pill off">${wsEsc(wsT('stopped'))}</span>`;
    if (wsIsIdle(j)) return `<span class="ws-pill warn">${wsEsc(wsT('idle'))}</span>`;
    return `<span class="ws-pill ok">${wsEsc(wsT('active'))}</span>`;
}
function wsDebounce(fn, ms) { let t = null; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

const WS = {
    open: false,
    section: 'jobs',
    enterprise: '',
    jobs: { search: '', tool: '', status: 'active', offset: 0, total: 0, rows: [], sel: new Set(), cache: new Map(), req: 0, formOpen: false, open: new Set(), people: new Map() },
    job: null,                       // the job open in the detail view
    jb: { tab: 'boxes', search: '', offset: 0, total: 0, rows: [], expanded: new Set(), items: new Map(), req: 0 },
    data: { sel: new Map(), selSig: '', tool: 'boxScanner', jobs: [], person: '', search: '', offset: 0, total: 0, totals: { boxes: 0, units: 0, rows: 0 }, rows: [], expanded: new Set(), items: new Map(), req: 0 },
    busy: false
};

// ---------- opening, closing, navigation ----------
async function openWorkspace(section) {
    WS.open = true;
    wsEl('wsRoot').classList.add('active');
    document.body.classList.add('ws-open');
    wsEl('wsEnterprise').textContent = WS.enterprise || '...';
    wsLoadEnterpriseName();
    let start = section;
    if (!start) { try { start = Storage.get('ws_section'); } catch (e) { start = null; } }
    wsGo(WS_SECTIONS.includes(start) ? start : 'jobs');
}

function closeWorkspace() {
    WS.open = false;
    wsEl('wsRoot').classList.remove('active');
    document.body.classList.remove('ws-open');
}

async function wsLoadEnterpriseName() {
    const { data } = await supabaseClient.from('enterprises').select('name').eq('id', AppState.profile.enterprise_id).maybeSingle();
    WS.enterprise = (data && data.name) || 'Team';
    wsEl('wsEnterprise').textContent = WS.enterprise;
}

function wsGo(section, keepJob) {
    WS.section = section;
    if (!keepJob) WS.job = null;
    try { Storage.set('ws_section', section); } catch (e) { /* storage blocked: fine */ }
    wsRenderNav();
    wsEl('wsTitle').textContent = wsT('title');
    ({ jobs: wsRenderJobs, data: wsRenderData })[section]();
    wsEl('wsMain').scrollTop = 0;
}

function wsRenderNav() {
    wsEl('wsNav').innerHTML = WS_SECTIONS.map(x => `<button type="button" class="ws-tab-btn${WS.section === x ? ' on' : ''}" data-ws-go="${x}">${wsEsc(wsT(x))}</button>`).join('');
}

// ---------- status line, dialog, progress ----------
let wsStatusTimer = null;
function wsStatus(text, opts) {
    const el = wsEl('wsStatus');
    clearTimeout(wsStatusTimer);
    if (!text) { el.hidden = true; return; }
    el.textContent = text;
    el.className = 'ws-status' + (opts && opts.error ? ' err' : '');
    el.hidden = false;
    if (opts && opts.hideAfter) wsStatusTimer = setTimeout(() => { el.hidden = true; }, opts.hideAfter);
}

// A confirmation window (with o.typed it would also ask for a word to be typed; the delete flows do not use it). Resolves true / false.
function wsDialog(o) {
    return new Promise((resolve) => {
        const modal = wsEl('wsDialog'), input = wsEl('wsDialogInput'), ok = wsEl('wsDialogOk'), cancel = wsEl('wsDialogCancel');
        wsEl('wsDialogTitle').textContent = o.title || '';
        wsEl('wsDialogBody').innerHTML = o.html || '';
        ok.textContent = o.ok || wsT('ok');
        ok.classList.toggle('btn-danger', !!o.danger);
        cancel.textContent = wsT('cancel');
        input.value = '';
        input.hidden = !o.typed;
        const check = () => { ok.disabled = !!o.typed && input.value.trim().toUpperCase() !== String(o.typed).toUpperCase(); };
        const done = (v) => {
            modal.classList.remove('active');
            ok.removeEventListener('click', onOk); cancel.removeEventListener('click', onCancel); input.removeEventListener('input', check);
            document.removeEventListener('keydown', onKey);
            resolve(v);
        };
        const onOk = () => { if (!ok.disabled) done(true); };
        const onCancel = () => done(false);
        const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
        ok.addEventListener('click', onOk); cancel.addEventListener('click', onCancel); input.addEventListener('input', check);
        document.addEventListener('keydown', onKey);
        check();
        modal.classList.add('active');
        if (o.typed) input.focus(); else ok.focus();
    });
}

// ---------- shared pieces ----------
function wsPager(id, offset, total, pageSize) {
    if (!total) return '';
    const a = offset + 1, b = Math.min(offset + pageSize, total);
    return `<div class="ws-pager"><span>${wsEsc(wsT('range', { a: wsNum(a), b: wsNum(b), n: wsNum(total) }))}</span>
        <span><button type="button" class="btn btn-secondary btn-sm" data-ws-page="${id}:prev" ${offset <= 0 ? 'disabled' : ''}>${wsEsc(wsT('prev'))}</button>
        <button type="button" class="btn btn-secondary btn-sm" data-ws-page="${id}:next" ${b >= total ? 'disabled' : ''}>${wsEsc(wsT('next'))}</button></span></div>`;
}
function wsToolSelectHtml(id, value, withAll) {
    return `<select id="${id}" class="form-input ws-sel">${withAll ? `<option value="">${wsEsc(wsT('allTools'))}</option>` : ''}${wsTools().map(a => `<option value="${a.id}"${a.id === value ? ' selected' : ''}>${wsEsc(appName(a))}</option>`).join('')}</select>`;
}
function wsFail(el, retryAction) {
    el.innerHTML = `<div class="ws-empty">${wsEsc(wsT('failed'))} <button type="button" class="btn btn-secondary btn-sm" data-ws="${retryAction}">${wsEsc(wsT('retry'))}</button></div>`;
}

// ============================================
// JOBS
// ============================================
function wsRenderJobs() {
    if (WS.job) { wsRenderJobDetail(); return; }
    const J = WS.jobs;
    const seg = (v, label) => `<button type="button" class="ws-seg-btn${J.status === v ? ' on' : ''}" data-ws-status="${v}">${wsEsc(label)}</button>`;
    wsEl('wsMain').innerHTML = `
        <div class="ws-head"><h3>${wsEsc(wsT('jobs'))}</h3><button type="button" class="btn btn-primary" data-ws="newjob">${wsEsc(wsT('newJob'))}</button></div>
        <div class="ws-card" id="wsNewJob" ${J.formOpen ? '' : 'hidden'}>
            <div class="ws-form"><select id="wsNewTool" class="form-input ws-sel" aria-label="${wsEsc(wsT('chooseTool'))}"><option value="">${wsEsc(wsT('chooseTool'))}</option>${wsTools().map(a => `<option value="${a.id}">${wsEsc(appName(a))}</option>`).join('')}</select>
                <input type="text" id="wsNewName" class="form-input" maxlength="60" autocomplete="off" placeholder="${wsEsc(wsT('jobPlaceholder'))}">
                <button type="button" class="btn btn-primary" data-ws="create">${wsEsc(wsT('createJob'))}</button></div>
        </div>
        <div class="ws-filters">
            <input type="search" id="wsJobSearch" class="form-input ws-grow" placeholder="${wsEsc(wsT('searchJobs'))}" value="${wsEsc(J.search)}" autocomplete="off">
            <span class="ws-seg">${seg('active', wsT('active'))}${seg('stopped', wsT('stopped'))}${seg('all', wsT('all'))}</span>
            ${wsToolSelectHtml('wsJobTool', J.tool, true)}
        </div>
        <div id="wsJobsBulk"></div>
        <div id="wsJobsList"><p class="ws-muted">${wsEsc(wsT('loading'))}</p></div>
        <div id="wsJobsPager"></div>
        <div id="wsPurgeLog"></div>`;
    wsLoadJobs();
    wsLoadPurgeLog();
}

// The jobs, each with its people one tap away (the number in the People column opens them in place).
function wsJobsTable() {
    const J = WS.jobs;
    const head = `<thead><tr><th class="ws-chk"></th><th>${wsEsc(wsT('job'))}</th><th>${wsEsc(wsT('status'))}</th><th class="n">${wsEsc(wsT('peopleCol'))}</th><th class="n">${wsEsc(wsT('boxes'))}</th><th class="n">${wsEsc(wsT('units'))}</th><th>${wsEsc(wsT('lastScan'))}</th><th></th></tr></thead>`;
    const body = J.rows.map(r => {
        const open = J.open.has(r.id);
        let html = `
            <tr class="${J.sel.has(r.id) ? 'sel' : ''}">
                <td class="ws-chk"><input type="checkbox" data-ws-sel="${r.id}" ${J.sel.has(r.id) ? 'checked' : ''} aria-label="${wsEsc(r.job_name)}"></td>
                <td><button type="button" class="ws-link" data-ws-open="${r.id}"><b>${wsEsc(r.job_name)}</b></button><small>${wsEsc(wsToolName(r.tool))}</small></td>
                <td data-label="${wsEsc(wsT('status'))}">${wsPill(r)}</td>
                <td class="n" data-label="${wsEsc(wsT('peopleCol'))}">${Number(r.people) > 0 ? `<button type="button" class="ws-link" data-ws-people="${r.id}" aria-expanded="${open}" title="${wsEsc(wsT(open ? 'hidePeople' : 'showPeople'))}">${wsNum(r.people)} ${open ? '&#9652;' : '&#9662;'}</button>` : '0'}</td>
                <td class="n" data-label="${wsEsc(wsT('boxes'))}">${wsNum(r.boxes)}</td>
                <td class="n" data-label="${wsEsc(wsT('units'))}">${wsNum(r.units)}</td>
                <td data-label="${wsEsc(wsT('lastScan'))}">${wsEsc(wsAgo(r.last_scan_at))}</td>
                <td class="ws-act">${r.state === 'active' ? `<button type="button" class="btn btn-secondary btn-sm" data-ws-qr="${r.id}">QR</button>` : ''}</td>
            </tr>`;
        if (open) html += `<tr class="ws-sub"><td colspan="8">${wsPeopleHtml(J.people.get(r.id))}</td></tr>`;
        return html;
    }).join('');
    return `<div class="ws-scroll"><table class="ws-table">${head}<tbody>${body}</tbody></table></div>`;
}

// the people of one job (used inline in the list and in the job's People tab)
function wsPeopleHtml(rows) {
    if (!rows) return `<p class="ws-muted">${wsEsc(wsT('loading'))}</p>`;
    if (!rows.length) return `<div class="ws-empty">${wsEsc(wsT('noPeople'))}</div>`;
    return `<div class="ws-scroll"><table class="ws-table ws-mini"><thead><tr><th>${wsEsc(wsT('name'))}</th><th class="n">${wsEsc(wsT('boxes'))}</th><th class="n">${wsEsc(wsT('units'))}</th><th>${wsEsc(wsT('lastScan'))}</th><th></th></tr></thead><tbody>${rows.map(p => `
        <tr class="${p.removed_at ? 'ws-removed' : ''}"><td data-label="${wsEsc(wsT('name'))}"><b>${wsEsc(p.name)}</b>${p.removed_at ? ` <span class="ws-pill off">${wsEsc(wsT('removed'))}</span>` : ''}</td>
        <td class="n" data-label="${wsEsc(wsT('boxes'))}">${wsNum(p.boxes)}</td><td class="n" data-label="${wsEsc(wsT('units'))}">${wsNum(p.units)}</td><td data-label="${wsEsc(wsT('lastScan'))}">${wsEsc(wsAgo(p.last_at))}</td>
        <td class="ws-act">${p.removed_at ? '' : `<button type="button" class="btn btn-secondary btn-sm" data-ws-rename="${p.operator_id}" data-name="${wsEsc(p.name)}">${wsEsc(wsT('rename'))}</button> <button type="button" class="btn btn-secondary btn-sm btn-danger-text" data-ws-remove="${p.operator_id}">${wsEsc(wsT('remove'))}</button>`}</td></tr>`).join('')}</tbody></table></div>`;
}

async function wsTogglePeople(id) {
    const J = WS.jobs;
    if (J.open.has(id)) J.open.delete(id); else J.open.add(id);
    wsRerenderJobs();
    if (J.open.has(id) && !J.people.has(id)) {
        const { data, error } = await supabaseClient.rpc('ws_job_people', { p_link_id: id });
        if (error) { J.open.delete(id); alert(error.message); } else J.people.set(id, data || []);
        wsRerenderJobs();
    }
}
function wsRerenderJobs() {
    const list = wsEl('wsJobsList');
    if (list && WS.section === 'jobs' && !WS.job && WS.jobs.rows.length) list.innerHTML = wsJobsTable();
}

// what was deleted automatically in the last 30 days (shown only when there is something)
async function wsLoadPurgeLog() {
    const { data } = await supabaseClient.rpc('ws_purge_log');
    const el = wsEl('wsPurgeLog');
    if (!el || WS.section !== 'jobs' || WS.job || !data || !data.length) return;
    el.innerHTML = `<div class="ws-card"><h4>${wsEsc(wsT('purgedRecent'))}</h4>${data.map(p => `<div class="ws-alert"><span class="ws-pill off">${wsEsc(wsToolName(p.tool))}</span><span>${wsEsc(wsT('purgedLine', { job: p.job, u: wsNum(p.units), d: wsDate(p.purged_at) }))}</span></div>`).join('')}</div>`;
}

async function wsLoadJobs() {
    const J = WS.jobs, req = ++J.req;
    const { data, error } = await supabaseClient.rpc('ws_jobs', { p_search: J.search, p_tool: J.tool, p_status: J.status, p_sort: 'last_scan', p_limit: WS_PAGE, p_offset: J.offset });
    if (req !== J.req || WS.section !== 'jobs' || WS.job) return;
    const list = wsEl('wsJobsList');
    if (error) { wsFail(list, 'jobs-retry'); return; }
    J.rows = data || [];
    J.total = J.rows.length ? Number(J.rows[0].total_count) : 0;
    J.rows.forEach(r => J.cache.set(r.id, r));
    J.people.clear();
    J.open.forEach(id => { if (!J.rows.some(r => r.id === id)) J.open.delete(id); });
    if (!J.rows.length) {
        list.innerHTML = `<div class="ws-empty">${wsEsc(wsT('noJobs'))}</div>`;
    } else {
        list.innerHTML = wsJobsTable();
    }
    wsEl('wsJobsPager').innerHTML = wsPager('jobs', J.offset, J.total, WS_PAGE);
    wsRenderJobsBulk();
}

function wsRenderJobsBulk() {
    const el = wsEl('wsJobsBulk');
    if (!el) return;
    const n = WS.jobs.sel.size;
    const anyActive = [...WS.jobs.sel].some(id => (WS.jobs.cache.get(id) || {}).state === 'active');
    el.innerHTML = n ? `<div class="ws-bulk"><span>${wsEsc(wsT('selected', { n }))}</span>
        <button type="button" class="btn btn-secondary btn-sm" data-ws="bulk-download">${wsEsc(wsT('downloadSel'))}</button>
        ${anyActive ? `<button type="button" class="btn btn-secondary btn-sm" data-ws="bulk-stop">${wsEsc(wsT('stopSel'))}</button>` : ''}</div>` : '';
}

async function wsCreateJob() {
    const tool = wsEl('wsNewTool').value, job = wsEl('wsNewName').value.trim();
    if (!tool) { alert(wsT('needTool')); return; }
    if (!job) { alert(wsT('needJob')); return; }
    const btn = document.querySelector('[data-ws="create"]');
    btn.disabled = true;
    try {
        const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
        const { data: found } = await supabaseClient.rpc('ws_jobs', { p_search: job, p_tool: tool, p_status: 'active', p_sort: 'name', p_limit: 100, p_offset: 0 });
        const existing = (found || []).find(l => same(l.job_name, job));
        if (existing && !(await wsDialog({ title: wsToolName(tool), html: `<p>${wsEsc(wsT('replaces', { tool: wsToolName(tool), job: existing.job_name }))}</p>` }))) return;
        const { data, error } = await supabaseClient.rpc('create_team_link', { p_tool: tool, p_job: job });
        if (error || !data) { alert(error ? error.message : qlT('failed')); return; }
        wsEl('wsNewName').value = '';
        WS.jobs.formOpen = false;
        wsEl('wsNewJob').hidden = true;
        wsLoadJobs();
        await showQrSheet({ token: data.token, tool: data.tool, job_name: data.job_name });
    } finally {
        btn.disabled = false;
    }
}

async function wsStopLinks(ids) {
    const text = ids.length === 1 ? wsT('stopAsk') : wsT('stopManyAsk', { n: ids.length });
    if (!(await wsDialog({ title: wsT('stopLink'), html: `<p>${wsEsc(text)}</p>`, ok: wsT('stopLink'), danger: true }))) return false;
    for (const id of ids) {
        const { error } = await supabaseClient.rpc('stop_team_link', { p_link_id: id });
        if (error) { alert(error.message); return false; }
    }
    return true;
}

// ============================================
// JOB DETAIL
// ============================================
async function wsOpenJob(id, name, tool) {
    let row = WS.jobs.cache.get(id);
    if (!row) {                                  // not in the loaded page: fetch the row
        const { data } = await supabaseClient.rpc('ws_jobs', { p_search: name || '', p_tool: tool || '', p_status: 'all', p_sort: 'name', p_limit: 100, p_offset: 0 });
        row = (data || []).find(r => r.id === id);
        if (row) WS.jobs.cache.set(id, row);
    }
    if (!row) { alert(wsT('failed')); return; }
    WS.job = row;
    WS.jb = { tab: 'boxes', search: '', offset: 0, total: 0, rows: [], expanded: new Set(), items: new Map(), req: 0 };
    WS.section = 'jobs';
    wsRenderNav();
    wsRenderJobDetail();
    wsEl('wsMain').scrollTop = 0;
}

async function wsRefreshJobRow() {
    const j = WS.job;
    const { data } = await supabaseClient.rpc('ws_jobs', { p_search: j.job_name, p_tool: j.tool, p_status: 'all', p_sort: 'name', p_limit: 100, p_offset: 0 });
    const row = (data || []).find(r => r.id === j.id);
    if (row) { WS.job = row; WS.jobs.cache.set(row.id, row); }
}

function wsRenderJobDetail() {
    const j = WS.job;
    const tab = (id, label) => `<button type="button" class="ws-tab${WS.jb.tab === id ? ' on' : ''}" data-ws-tab="${id}">${wsEsc(label)}</button>`;
    const tile = (n, label) => `<div class="ws-tile"><b>${n}</b><span>${wsEsc(label)}</span></div>`;
    wsEl('wsMain').innerHTML = `
        <div class="ws-head"><h3><button type="button" class="ws-back" data-ws="job-back" aria-label="${wsEsc(wsT('back'))}">&lsaquo;</button> ${wsEsc(j.job_name)} ${wsPill(j)}</h3>
            <span class="ws-head-btns"><small class="ws-muted">${wsEsc(wsToolName(j.tool))}</small>
            ${j.state === 'active' ? `<button type="button" class="btn btn-secondary btn-sm" data-ws-qr="${j.id}">${wsEsc(wsT('showQr'))}</button><button type="button" class="btn btn-secondary btn-sm btn-danger-text" data-ws="job-stop">${wsEsc(wsT('stopLink'))}</button>` : ''}</span></div>
        ${wsPurgeSoon(j) ? `<div class="ws-banner">${wsEsc(wsPurgeBanner(j))}</div>` : ''}
        <div class="ws-tiles">${tile(wsNum(j.units), wsT('units'))}${tile(wsNum(j.boxes), wsT('boxes'))}${tile(wsNum(j.people), wsT('peopleCol'))}${tile(wsEsc(wsAgo(j.last_scan_at)), wsT('lastScan'))}</div>
        <div class="ws-tabs">${tab('boxes', wsT('tabBoxes'))}${tab('people', wsT('tabPeople'))}${tab('activity', wsT('tabActivity'))}</div>
        <div id="wsJobTab"></div>
        <div class="ws-danger"><span><b>${wsEsc(wsT('dataOfJob'))}:</b> ${wsEsc(wsNum(j.boxes) + ' ' + wsT('boxes').toLowerCase() + ', ' + wsNum(j.units) + ' ' + wsT('units').toLowerCase())}</span>
            <span><button type="button" class="btn btn-secondary btn-sm" data-ws="job-download">${wsEsc(wsT('downloadAll'))}</button>
            <button type="button" class="btn btn-secondary btn-sm btn-danger-text" data-ws="job-delete">${wsEsc(wsT('downloadDelete'))}</button></span></div>`;
    wsRenderJobTab();
}

function wsRenderJobTab() {
    const el = wsEl('wsJobTab');
    if (!el) return;
    if (WS.jb.tab === 'boxes') {
        el.innerHTML = `<div class="ws-filters"><input type="search" id="wsJobBoxSearch" class="form-input ws-grow" placeholder="${wsEsc(wsT('searchBox'))}" value="${wsEsc(WS.jb.search)}" autocomplete="off"></div><div id="wsJobBoxes"><p class="ws-muted">${wsEsc(wsT('loading'))}</p></div><div id="wsJobBoxesPager"></div>`;
        wsLoadJobBoxes();
    } else if (WS.jb.tab === 'people') {
        el.innerHTML = `<div id="wsJobPeople"><p class="ws-muted">${wsEsc(wsT('loading'))}</p></div>`;
        wsLoadJobPeople();
    } else {
        el.innerHTML = `<div id="wsJobActivity"><p class="ws-muted">${wsEsc(wsT('loading'))}</p></div>`;
        wsLoadJobActivity();
    }
}

// the items of one box (the rows a person scanned into it), for a job or for the Data screen
function wsItemsQuery(tool, box, jobName, linkId) {
    const ys = tool === 'yearSegregate';
    let q = supabaseClient.from(ys ? 'ys_scans' : 'scans').select(ys
        ? 'id, barcode, qty, operator_name, remark, ptl_number, season, year, brand, staff_name, box_barcode, box_status, scan_timestamp, scanned_at, user_id, profiles(display_name, email)'
        : 'id, barcode, qty, operator_name, remark, box_number, box_status, scanned_at, user_id, profiles(display_name, email)')
        .eq('enterprise_id', AppState.profile.enterprise_id).eq(ys ? 'box_barcode' : 'box_number', box);
    if (linkId) q = q.eq('link_id', linkId);
    else if (jobName === null || jobName === undefined) q = q.is('remark', null);
    else q = q.eq('remark', jobName);
    return q;
}
function wsNormaliseRow(tool, s) {
    const person = s.operator_name || s.profiles?.display_name || s.profiles?.email || '';
    if (tool === 'yearSegregate') {
        return { scanned_at: s.scanned_at, person, job: s.remark, box: s.box_barcode, barcode: s.barcode, qty: s.qty, status: s.box_status,
            extra: { ptl: s.ptl_number, season: s.season, year: s.year, brand: s.brand, staff: s.staff_name, ts: s.scan_timestamp } };
    }
    return { scanned_at: s.scanned_at, person, job: s.remark, box: s.box_number, barcode: s.barcode, qty: s.qty, status: s.box_status, extra: null };
}

function wsSelKey(b) { return String(b.job || '').trim().toLowerCase() + '\u0001' + b.box; }

// sel (optional Map of selected boxes) adds a checkbox column: one per box and one in the header for the whole page.
function wsBoxesTable(rows, scope, expanded, items, tool, withJob, sel) {
    const extra = sel ? 1 : 0;
    const body = rows.map(b => {
        const key = scope + ':' + (b.job === null || b.job === undefined ? '' : b.job) + '\u0001' + b.box;
        const isOpen = expanded.has(key);
        const stat = `<span class="ws-pill ${b.status === 'Closed' ? 'ok' : 'warn'}">${wsEsc(b.status === 'Closed' ? wsT('closed') : wsT('open'))}</span>`;
        const picked = sel && sel.has(wsSelKey(b));
        let html = `<tr class="${picked ? 'sel' : ''}">${sel ? `<td class="ws-chk"><input type="checkbox" data-ws-bsel="${wsEsc(wsSelKey(b))}" ${picked ? 'checked' : ''} aria-label="${wsEsc(wsT('selectBox'))}"></td>` : ''}<td class="ws-chk"><button type="button" class="ws-exp" data-ws-exp="${wsEsc(key)}" aria-label="+">${isOpen ? '&minus;' : '+'}</button></td>
            <td data-label="${wsEsc(wsT('box'))}"><b>${wsEsc(b.box)}</b></td>
            ${withJob ? `<td data-label="${wsEsc(wsT('job'))}">${wsEsc(b.job || '-')}</td>` : ''}
            <td data-label="${wsEsc(wsT('status'))}">${stat}</td>
            <td class="n" data-label="${wsEsc(wsT('items'))}">${wsNum(b.items)}</td>
            <td data-label="${wsEsc(wsT('by'))}">${wsEsc(b.scanned_by !== undefined ? b.scanned_by : b.person || '')}</td>
            <td data-label="${wsEsc(wsT('when'))}">${wsEsc(b.last_at ? new Date(b.last_at).toLocaleString() : '')}</td>
            <td class="ws-act"><button type="button" class="icon-btn" data-ws-boxdl="${wsEsc(key)}" title="${wsEsc(wsT('thisBox'))}" aria-label="${wsEsc(wsT('thisBox'))}">&#11015;</button></td></tr>`;
        if (isOpen) {
            const it = items.get(key);
            html += `<tr class="ws-sub"><td colspan="${(withJob ? 8 : 7) + extra}">${!it ? `<p class="ws-muted">${wsEsc(wsT('loading'))}</p>` : `<div class="ws-scroll"><table class="ws-table ws-mini"><thead><tr><th>Barcode</th><th>${wsEsc(wsT('by'))}</th><th>${wsEsc(wsT('when'))}</th></tr></thead><tbody>${it.map(s => `<tr><td>${wsEsc(s.barcode)}${Number(s.qty) > 1 ? ' &times;' + wsNum(s.qty) : ''}</td><td>${wsEsc(s.operator_name || s.profiles?.display_name || s.profiles?.email || '')}</td><td>${wsEsc(new Date(s.scanned_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</td></tr>`).join('')}</tbody></table></div>`}</td></tr>`;
        }
        return html;
    }).join('');
    return `<div class="ws-scroll"><table class="ws-table"><thead><tr>${sel ? '<th class="ws-chk"></th>' : ''}<th class="ws-chk"></th><th>${wsEsc(wsT('box'))}</th>${withJob ? `<th>${wsEsc(wsT('job'))}</th>` : ''}<th>${wsEsc(wsT('status'))}</th><th class="n">${wsEsc(wsT('items'))}</th><th>${wsEsc(wsT('by'))}</th><th>${wsEsc(wsT('when'))}</th><th></th></tr></thead><tbody>${body}</tbody></table></div>`;
}

async function wsLoadJobBoxes() {
    const B = WS.jb, req = ++B.req, j = WS.job;
    const { data, error } = await supabaseClient.rpc('ws_job_boxes', { p_link_id: j.id, p_search: B.search, p_limit: WS_DATA_PAGE, p_offset: B.offset });
    const el = wsEl('wsJobBoxes');
    if (req !== B.req || !el) return;
    if (error) { wsFail(el, 'jobboxes-retry'); return; }
    B.rows = (data || []).map(r => ({ ...r, job: j.job_name }));
    B.total = B.rows.length ? Number(data[0].total_count) : 0;
    el.innerHTML = B.rows.length ? wsBoxesTable(B.rows, 'job', B.expanded, B.items, j.tool, false) : `<div class="ws-empty">${wsEsc(wsT('noBoxes'))}</div>`;
    wsEl('wsJobBoxesPager').innerHTML = wsPager('jobboxes', B.offset, B.total, WS_DATA_PAGE);
}

async function wsLoadJobPeople() {
    const j = WS.job, req = ++WS.jb.req;
    const { data, error } = await supabaseClient.rpc('ws_job_people', { p_link_id: j.id });
    const el = wsEl('wsJobPeople');
    if (req !== WS.jb.req || !el) return;
    if (error) { wsFail(el, 'jobpeople-retry'); return; }
    el.innerHTML = wsPeopleHtml(data || []);
}

async function wsLoadJobActivity() {
    const j = WS.job, req = ++WS.jb.req;
    const { data, error } = await supabaseClient.rpc('ws_job_activity', { p_link_id: j.id, p_hours: 24 });
    const el = wsEl('wsJobActivity');
    if (req !== WS.jb.req || !el) return;
    if (error) { wsFail(el, 'jobactivity-retry'); return; }
    const rows = data || [];
    const max = Math.max(1, ...rows.map(r => Number(r.units)));
    el.innerHTML = `<div class="ws-card"><h4>${wsEsc(wsT('unitsPerHour'))}</h4><div class="ws-spark">${rows.map(r => `<i style="height:${Math.max(2, Math.round(100 * Number(r.units) / max))}%" title="${wsEsc(new Date(r.hour).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ': ' + wsNum(r.units))}"></i>`).join('')}</div>
        <div class="ws-spark-x"><span>${rows.length ? wsEsc(new Date(rows[0].hour).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })) : ''}</span><span>${rows.length ? wsEsc(new Date(rows[rows.length - 1].hour).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })) : ''}</span></div></div>`;
}

// after a person was renamed / removed: reload whichever view shows people
async function wsPeopleChanged(removed) {
    if (WS.job) { wsLoadJobPeople(); if (removed) await wsRefreshJobRow(); return; }
    WS.jobs.people.clear();
    for (const id of WS.jobs.open) {
        const { data } = await supabaseClient.rpc('ws_job_people', { p_link_id: id });
        WS.jobs.people.set(id, data || []);
    }
    if (removed) await wsLoadJobs(); else wsRerenderJobs();
}

async function wsRenameOperators(ids, current) {
    const name = prompt(wsT('renamePrompt'), current);
    if (name === null) return false;
    if (!name.trim() || name.trim().length > 40) { alert(wsT('nameBad')); return false; }
    for (const id of ids) {
        const { error } = await supabaseClient.rpc('rename_team_operator', { p_operator_id: id, p_name: name.trim() });
        if (error) { alert(error.message); return false; }
    }
    return true;
}
async function wsRemoveOperators(ids) {
    if (!confirm(wsT('removeAsk'))) return false;
    for (const id of ids) {
        const { error } = await supabaseClient.rpc('remove_team_operator', { p_operator_id: id });
        if (error) { alert(error.message); return false; }
    }
    return true;
}

// ============================================
// DATA
// ============================================
function wsDataArgs() {
    const D = WS.data;
    return { p_jobs: D.jobs.length ? D.jobs : null, p_person: D.person || null, p_from: null, p_to: null, p_status: null, p_search: D.search || null };
}

function wsRenderData() {
    const D = WS.data;
    wsEl('wsMain').innerHTML = `
        <div class="ws-head"><h3>${wsEsc(wsT('data'))}</h3><span class="ws-muted" id="wsDataTotals"></span></div>
        <div class="ws-filters">
            <input type="search" id="wsDataSearch" class="form-input ws-grow" placeholder="${wsEsc(wsT('searchData'))}" value="${wsEsc(D.search)}" autocomplete="off">
            ${wsToolSelectHtml('wsDataTool', D.tool, false)}
        </div>
        <div class="ws-filters">
            <span class="ws-pick"><input type="text" id="wsDataJobIn" class="form-input" list="wsJobOpts" placeholder="${wsEsc(wsT('anyJob'))}" autocomplete="off"><datalist id="wsJobOpts"></datalist></span>
            <span class="ws-pick"><input type="text" id="wsDataPersonIn" class="form-input" list="wsPersonOpts" placeholder="${wsEsc(wsT('anyPerson'))}" autocomplete="off"><datalist id="wsPersonOpts"></datalist></span>
        </div>
        <div class="ws-chips" id="wsDataChips"></div>
        <div id="wsDataSel"></div>
        <div id="wsDataList"><p class="ws-muted">${wsEsc(wsT('loading'))}</p></div>
        <div id="wsDataPager"></div>
        <div class="ws-danger" id="wsDataActions" hidden></div>`;
    wsRenderDataChips();
    wsLoadData();
}

function wsRenderDataChips() {
    const D = WS.data, el = wsEl('wsDataChips');
    if (!el) return;
    const chips = D.jobs.map((j, i) => `<span class="chip">${wsEsc(wsT('job'))}: ${wsEsc(j)} <button type="button" data-ws-rmjob="${i}" aria-label="x">&times;</button></span>`);
    if (D.person) chips.push(`<span class="chip">${wsEsc(wsT('person'))}: ${wsEsc(D.person)} <button type="button" data-ws-rmperson="1" aria-label="x">&times;</button></span>`);
    if (chips.length) chips.push(`<button type="button" class="btn btn-secondary btn-sm" data-ws="data-clear">${wsEsc(wsT('clearFilters'))}</button>`);
    el.innerHTML = chips.join('');
}

async function wsLoadData() {
    const D = WS.data, req = ++D.req;
    const { data, error } = await supabaseClient.rpc('ws_data_boxes', { p_tool: D.tool, ...wsDataArgs(), p_limit: WS_DATA_PAGE, p_offset: D.offset });
    const el = wsEl('wsDataList');
    if (req !== D.req || WS.section !== 'data' || !el) return;
    if (error) { wsFail(el, 'data-retry'); return; }
    D.rows = data || [];
    const sig = JSON.stringify([D.tool, wsDataArgs()]);
    if (sig !== D.selSig) { D.sel.clear(); D.selSig = sig; }          // a different filter is a different set of boxes
    const first = D.rows[0];
    D.total = first ? Number(first.total_boxes) : 0;
    D.totals = first ? { boxes: Number(first.total_boxes), units: Number(first.total_units), rows: Number(first.total_rows) } : { boxes: 0, units: 0, rows: 0 };
    wsEl('wsDataTotals').textContent = first ? wsT('matches', { b: wsNum(D.totals.boxes), u: wsNum(D.totals.units) }) : '';
    el.innerHTML = D.rows.length ? wsBoxesTable(D.rows, 'data', D.expanded, D.items, D.tool, true, D.sel) : `<div class="ws-empty">${wsEsc(wsT('noMatches'))}</div>`;
    wsEl('wsDataPager').innerHTML = wsPager('data', D.offset, D.total, WS_DATA_PAGE);
    wsRenderDataSel();
    const actions = wsEl('wsDataActions');
    actions.hidden = !first;
    actions.innerHTML = first ? `<span><b>${wsEsc(wsT('deleteCounts', { b: wsNum(D.totals.boxes), u: wsNum(D.totals.units) }) + ' ' + wsT('withScans', { r: wsNum(D.totals.rows) }))}</b>${D.totals.rows > WS_FILE_ROWS ? ` <small class="ws-muted">${wsEsc(wsT('filesNote', { n: wsNum(WS_FILE_ROWS) }))}</small>` : ''}</span>
        <span><button type="button" class="btn btn-secondary btn-sm" data-ws="data-download">${wsEsc(wsT('downloadMatches'))}</button>
        <button type="button" class="btn btn-secondary btn-sm btn-danger-text" data-ws="data-delete">${wsEsc(wsT('deleteMatches'))}</button></span>` : '';
}

// The bar above the table: "select all on this page" (outside the table, so it also works on a phone where the table
// header is hidden) and, once something is ticked, what is selected and what can be done with it.
function wsRenderDataSel() {
    const el = wsEl('wsDataSel'), D = WS.data;
    if (!el) return;
    if (!D.rows.length) { el.innerHTML = ''; return; }
    const n = D.sel.size;
    const units = [...D.sel.values()].reduce((a, b) => a + Number(b.items || 0), 0);
    const pageAll = D.rows.every(b => D.sel.has(wsSelKey(b)));
    el.innerHTML = `<div class="ws-bulk ws-selbar"><label class="ws-lbl"><input type="checkbox" id="wsDataSelAll" ${pageAll ? 'checked' : ''}> <span>${wsEsc(wsT('selectPage'))}</span></label>` + (n ? `
        <span>${wsEsc(wsT('selectedBoxes', { n: wsNum(n), u: wsNum(units) }))}</span>
        <button type="button" class="btn btn-secondary btn-sm" data-ws="sel-download">${wsEsc(wsT('downloadSelected'))}</button>
        <button type="button" class="btn btn-secondary btn-sm btn-danger-text" data-ws="sel-delete">${wsEsc(wsT('deleteSelected'))}</button>
        <button type="button" class="btn btn-secondary btn-sm" data-ws="sel-clear">${wsEsc(wsT('clearSel'))}</button>` : '') + '</div>';
}
// the selected boxes as the server expects them: "job (lower case)" + character 1 + "box"
function wsSelArgs() { return { ...wsDataArgs(), p_boxes: [...WS.data.sel.keys()] }; }

const wsLoadFacets = wsDebounce(async (kind, text) => {
    const { data } = await supabaseClient.rpc('ws_facets', { p_kind: kind, p_tool: WS.data.tool, p_search: text, p_limit: 30 });
    const list = wsEl(kind === 'job' ? 'wsJobOpts' : 'wsPersonOpts');
    if (list) list.innerHTML = (data || []).map(f => `<option value="${wsEsc(f.value)}">${wsEsc(wsNum(f.units))}</option>`).join('');
}, 250);

// ---------- download, delete ----------
function wsWriteXlsx(tool, rows, filename) {
    let sheet, name, cols;
    if (tool === 'yearSegregate') {
        name = 'Year-Season Scans';
        sheet = rows.map(r => ({ 'Scanned By': r.person || '', 'Staff': (r.extra && r.extra.staff) || '', 'Remark': r.job || '', 'PTL Number': r.extra && r.extra.ptl, 'Season': r.extra && r.extra.season, 'Year': r.extra && r.extra.year, 'Brand': (r.extra && r.extra.brand) || '', 'Barcode': r.barcode, 'Qty': r.qty, 'Box Barcode': r.box, 'Box Status': r.status, 'Scan Timestamp': (r.extra && r.extra.ts) || new Date(r.scanned_at).toLocaleString() }));
        cols = [{wch:20},{wch:16},{wch:20},{wch:10},{wch:8},{wch:6},{wch:14},{wch:18},{wch:5},{wch:16},{wch:10},{wch:20}];
    } else {
        name = 'Team Scans';
        sheet = rows.map(r => ({ 'Scanned By': r.person || '', 'Remark': r.job || '', 'Box Number': r.box, 'Barcode': r.barcode, 'Qty': r.qty, 'Status': r.status, 'Scanned At': new Date(r.scanned_at).toLocaleString() }));
        cols = [{wch:20},{wch:20},{wch:12},{wch:20},{wch:5},{wch:8},{wch:18}];
    }
    const ws = XLSX.utils.json_to_sheet(sheet);
    ws['!cols'] = cols;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, name);
    XLSX.writeFile(wb, filename);
}

// Downloads every scan that matches the filter, page by page, into Excel files of at most WS_FILE_ROWS rows.
// Returns { count, startedAt } (startedAt = the cut-off for a delete that follows) or null when it failed.
async function wsExport(o) {
    const startedAt = new Date().toISOString();
    const day = new Date().toISOString().slice(0, 10);
    wsStatus(wsT('preparing'));
    let after = { at: null, id: null }, got = 0, parts = 0, buf = [];
    const total = Math.max(1, Number(o.total) || 0);
    try {
        for (;;) {
            const { data, error } = await supabaseClient.rpc('ws_data_rows', { p_tool: o.tool, ...o.args, p_after_at: after.at, p_after_id: after.id, p_until: startedAt, p_limit: WS_FETCH_ROWS });
            if (error) throw error;
            const page = data || [];
            if (!page.length) break;
            buf.push(...page); got += page.length;
            const last = page[page.length - 1];
            after = { at: last.scanned_at, id: last.id };
            wsStatus(wsT('exporting', { n: wsNum(got), t: wsNum(Math.max(total, got)), p: Math.min(99, Math.round(100 * got / Math.max(total, got))) }));
            if (buf.length >= WS_FILE_ROWS) { parts++; wsWriteXlsx(o.tool, buf, `${o.prefix}_${day}_part${parts}.xlsx`); buf = []; await new Promise(r => setTimeout(r, 0)); }
            if (page.length < WS_FETCH_ROWS) break;
        }
        if (buf.length) { wsWriteXlsx(o.tool, buf, parts ? `${o.prefix}_${day}_part${parts + 1}.xlsx` : `${o.prefix}_${day}.xlsx`); }
    } catch (err) {
        wsStatus(wsT('exportFailed') + (err && err.message ? ' ' + err.message : ''), { error: true });
        return null;
    }
    return { count: got, startedAt };
}

async function wsDownloadFlow(o) {
    if (WS.busy) return;
    WS.busy = true;
    try {
        const res = await wsExport(o);
        if (!res) return;
        wsStatus(res.count ? wsT('downloaded', { n: wsNum(res.count) }) : wsT('noRows'), { hideAfter: 5000 });
    } finally { WS.busy = false; }
}

// Download first, then delete exactly what matches (only scans made before the download started).
async function wsDeleteFlow(o) {
    if (WS.busy) return;
    if (!o.totals || !o.totals.rows) { wsStatus(wsT('deleteNoData'), { hideAfter: 4000 }); return; }
    const ok = await wsDialog({
        title: wsT('deleteTitle'), danger: true, ok: wsT('downloadDelete').replace('…', ''),
        html: `<p>${wsEsc(wsT('deleteLead'))}</p><p><b>${wsEsc(wsT('deleteScope'))}</b><br>${o.scopeHtml}<br>${wsEsc(wsT('deleteCounts', { b: wsNum(o.totals.boxes), u: wsNum(o.totals.units) }) + (o.exact ? ' ' + wsT('withScans', { r: wsNum(o.totals.rows) }) : ''))}</p>`
    });
    if (!ok) return;
    WS.busy = true;
    try {
        const res = await wsExport({ tool: o.tool, args: o.args, total: o.totals.rows, prefix: o.prefix });
        if (!res) return;
        if (!res.count) { wsStatus(wsT('noRows'), { hideAfter: 4000 }); return; }
        wsStatus(wsT('deleting'));
        const { data, error } = await supabaseClient.rpc('ws_data_delete', { p_tool: o.tool, ...o.args, p_until: res.startedAt });
        if (error) { wsStatus(wsT('deleteFailed') + error.message, { error: true }); return; }
        wsStatus(wsT('deleted', { n: wsNum(data) }), { hideAfter: 8000 });
        if (o.after) await o.after();
    } finally { WS.busy = false; }
}

function wsJobExportArgs(j) {
    return { tool: j.tool, args: { p_jobs: [j.job_name], p_person: null, p_from: null, p_to: null, p_status: null, p_search: null }, prefix: 'job_' + String(j.job_name).replace(/[^a-z0-9]+/gi, '_') };
}

async function wsBoxDownload(scope, key) {
    const [job, box] = key.slice(scope.length + 1).split('\u0001');
    const tool = scope === 'job' ? WS.job.tool : WS.data.tool;
    const { data, error } = await fetchAllPages((from, to) => wsItemsQuery(tool, box, job, scope === 'job' ? WS.job.id : null).order('scanned_at', { ascending: true }).order('id', { ascending: true }).range(from, to));
    if (error) { alert(error.message); return; }
    if (!data.length) { alert(wsT('noRows')); return; }
    wsWriteXlsx(tool, data.map(s => wsNormaliseRow(tool, s)), 'box_' + String(box).replace(/[^a-z0-9]+/gi, '_') + '_' + new Date().toISOString().slice(0, 10) + '.xlsx');
}

async function wsToggleBox(scope, key) {
    const state = scope === 'job' ? WS.jb : WS.data;
    if (state.expanded.has(key)) state.expanded.delete(key); else state.expanded.add(key);
    const rerender = () => { if (scope === 'job') wsRenderJobBoxesOnly(); else wsRenderDataOnly(); };
    rerender();
    if (state.expanded.has(key) && !state.items.has(key)) {
        const [job, box] = key.slice(scope.length + 1).split('\u0001');
        const tool = scope === 'job' ? WS.job.tool : WS.data.tool;
        const { data, error } = await wsItemsQuery(tool, box, job === '' ? null : job, scope === 'job' ? WS.job.id : null).order('scanned_at', { ascending: true }).limit(500);
        state.items.set(key, error ? [] : data);
        rerender();
    }
}
function wsRenderJobBoxesOnly() {
    const el = wsEl('wsJobBoxes');
    if (el && WS.jb.rows.length) el.innerHTML = wsBoxesTable(WS.jb.rows, 'job', WS.jb.expanded, WS.jb.items, WS.job.tool, false);
}
function wsRenderDataOnly() {
    const el = wsEl('wsDataList');
    if (el && WS.data.rows.length) el.innerHTML = wsBoxesTable(WS.data.rows, 'data', WS.data.expanded, WS.data.items, WS.data.tool, true, WS.data.sel);
}

// ============================================
// EVENTS (one handler for the whole workspace)
// ============================================
function wsRefreshCurrent() {
    ({ jobs: () => (WS.job ? wsRenderJobDetail() : wsLoadJobs()), data: wsLoadData })[WS.section]();
}

async function wsOnClick(e) {
    const t = e.target.closest('button, [data-ws-go]');
    if (!t) return;
    const d = t.dataset;
    if (d.wsGo) { wsGo(d.wsGo); return; }
    if (d.wsStatus) { WS.jobs.status = d.wsStatus; WS.jobs.offset = 0; WS.jobs.sel.clear(); wsRenderJobs(); return; }
    if (d.wsPeople) { wsTogglePeople(d.wsPeople); return; }
    if (d.wsPage) {
        const [id, dir] = d.wsPage.split(':'), step = dir === 'next' ? 1 : -1;
        if (id === 'jobs') { WS.jobs.offset = Math.max(0, WS.jobs.offset + step * WS_PAGE); wsLoadJobs(); }
        if (id === 'data') { WS.data.offset = Math.max(0, WS.data.offset + step * WS_DATA_PAGE); wsLoadData(); }
        if (id === 'jobboxes') { WS.jb.offset = Math.max(0, WS.jb.offset + step * WS_DATA_PAGE); wsLoadJobBoxes(); }
        return;
    }
    if (d.wsOpen) { wsOpenJob(d.wsOpen, d.wsName, d.wsTool); return; }
    if (d.wsQr) { const j = WS.jobs.cache.get(d.wsQr) || WS.job; if (j) showQrSheet({ token: j.token, tool: j.tool, job_name: j.job_name }); return; }
    if (d.wsTab) { WS.jb.tab = d.wsTab; wsRenderJobDetail(); return; }
    if (d.wsExp) { wsToggleBox(d.wsExp.split(':')[0], d.wsExp); return; }
    if (d.wsBoxdl) { wsBoxDownload(d.wsBoxdl.split(':')[0], d.wsBoxdl); return; }
    if (d.wsRename) { if (await wsRenameOperators([d.wsRename], d.name || '')) await wsPeopleChanged(false); return; }
    if (d.wsRemove) { if (await wsRemoveOperators([d.wsRemove])) await wsPeopleChanged(true); return; }
    if (d.wsRmjob !== undefined) { WS.data.jobs.splice(Number(d.wsRmjob), 1); WS.data.offset = 0; wsRenderDataChips(); wsLoadData(); return; }
    if (d.wsRmperson) { WS.data.person = ''; WS.data.offset = 0; wsRenderDataChips(); wsLoadData(); return; }
    switch (d.ws) {
        case 'newjob': WS.jobs.formOpen = !WS.jobs.formOpen; wsEl('wsNewJob').hidden = !WS.jobs.formOpen; if (WS.jobs.formOpen) wsEl('wsNewName').focus(); return;
        case 'create': wsCreateJob(); return;
        case 'jobs-retry': case 'jobboxes-retry': case 'jobpeople-retry': case 'jobactivity-retry': case 'data-retry': wsRefreshCurrent(); return;
        case 'job-back': WS.job = null; wsRenderJobs(); return;
        case 'job-stop': if (await wsStopLinks([WS.job.id])) { await wsRefreshJobRow(); wsRenderJobDetail(); } return;
        case 'job-download': wsDownloadFlow({ ...wsJobExportArgs(WS.job), total: WS.job.units }); return;
        case 'job-delete': wsDeleteFlow({ ...wsJobExportArgs(WS.job), totals: { boxes: Number(WS.job.boxes), units: Number(WS.job.units), rows: Number(WS.job.units) }, scopeHtml: `<b>${wsEsc(WS.job.job_name)}</b> (${wsEsc(wsToolName(WS.job.tool))})`, after: async () => { await wsRefreshJobRow(); wsRenderJobDetail(); } }); return;
        case 'bulk-stop': { const ids = [...WS.jobs.sel].filter(id => (WS.jobs.cache.get(id) || {}).state === 'active'); if (ids.length && await wsStopLinks(ids)) { WS.jobs.sel.clear(); wsLoadJobs(); } return; }
        case 'bulk-download': {
            const jobs = [...WS.jobs.sel].map(id => WS.jobs.cache.get(id)).filter(Boolean);
            for (const tool of [...new Set(jobs.map(j => j.tool))]) {
                const mine = jobs.filter(j => j.tool === tool);
                await wsDownloadFlow({ tool, args: { p_jobs: mine.map(j => j.job_name), p_person: null, p_from: null, p_to: null, p_status: null, p_search: null }, total: mine.reduce((s, j) => s + Number(j.units), 0), prefix: 'jobs_' + tool });
            }
            return;
        }
        case 'sel-clear': WS.data.sel.clear(); wsRenderDataOnly(); wsRenderDataSel(); return;
        case 'sel-download': {
            const rows = [...WS.data.sel.values()].reduce((a, b) => a + Number(b.items || 0), 0);
            wsDownloadFlow({ tool: WS.data.tool, args: wsSelArgs(), total: rows, prefix: 'team_data_selected' });
            return;
        }
        case 'sel-delete': {
            const D = WS.data, picked = [...D.sel.values()];
            const units = picked.reduce((a, b) => a + Number(b.items || 0), 0);
            const names = picked.slice(0, 5).map(b => wsEsc((b.job || '-') + ' / ' + b.box)).join('<br>') + (picked.length > 5 ? '<br>...' : '');
            wsDeleteFlow({ tool: D.tool, args: wsSelArgs(), totals: { boxes: picked.length, units, rows: units }, scopeHtml: `<b>${wsEsc(wsToolName(D.tool))}</b><br>${wsEsc(wsT('selScope', { n: wsNum(picked.length) }))}<br>${names}`, prefix: 'team_data_deleted',
                after: async () => { D.sel.clear(); D.offset = 0; D.expanded.clear(); D.items.clear(); await wsLoadData(); } });
            return;
        }
        case 'data-clear': Object.assign(WS.data, { jobs: [], person: '', search: '', offset: 0 }); wsRenderData(); return;
        case 'data-download': wsDownloadFlow({ tool: WS.data.tool, args: wsDataArgs(), total: WS.data.totals.rows, prefix: 'team_data' }); return;
        case 'data-delete': {
            const D = WS.data, a = wsDataArgs();
            const parts = [`<b>${wsEsc(wsToolName(D.tool))}</b>`];
            if (D.jobs.length) parts.push(wsEsc(wsT('job')) + ': ' + D.jobs.map(wsEsc).join(', '));
            if (D.person) parts.push(wsEsc(wsT('person')) + ': ' + wsEsc(D.person));
            if (D.search) parts.push('&quot;' + wsEsc(D.search) + '&quot;');
            wsDeleteFlow({ tool: D.tool, args: a, totals: D.totals, exact: true, scopeHtml: parts.join('<br>'), prefix: 'team_data_deleted', after: async () => { D.offset = 0; D.expanded.clear(); D.items.clear(); await wsLoadData(); } });
            return;
        }
    }
}

function wsOnChange(e) {
    const t = e.target;
    if (t.dataset.wsSel) {
        if (t.checked) WS.jobs.sel.add(t.dataset.wsSel); else WS.jobs.sel.delete(t.dataset.wsSel);
        t.closest('tr').classList.toggle('sel', t.checked);
        wsRenderJobsBulk();
        return;
    }
    if (t.dataset.wsBsel !== undefined) {
        const row = WS.data.rows.find(b => wsSelKey(b) === t.dataset.wsBsel);
        if (row) { if (t.checked) WS.data.sel.set(t.dataset.wsBsel, row); else WS.data.sel.delete(t.dataset.wsBsel); }
        wsRenderDataOnly(); wsRenderDataSel();
        return;
    }
    if (t.id === 'wsDataSelAll') {
        WS.data.rows.forEach(b => { if (t.checked) WS.data.sel.set(wsSelKey(b), b); else WS.data.sel.delete(wsSelKey(b)); });
        wsRenderDataOnly(); wsRenderDataSel();
        return;
    }
    switch (t.id) {
        case 'wsJobTool': WS.jobs.tool = t.value; WS.jobs.offset = 0; wsLoadJobs(); break;
        case 'wsDataTool': WS.data.tool = t.value; WS.data.jobs = []; WS.data.person = ''; WS.data.offset = 0; WS.data.expanded.clear(); WS.data.items.clear(); wsRenderData(); break;
        case 'wsDataJobIn': {
            const v = t.value.trim();
            if (v && !WS.data.jobs.some(j => j.toLowerCase() === v.toLowerCase())) { WS.data.jobs.push(v); WS.data.offset = 0; wsRenderDataChips(); wsLoadData(); }
            t.value = ''; break;
        }
        case 'wsDataPersonIn': {
            const v = t.value.trim();
            if (v) { WS.data.person = v; WS.data.offset = 0; wsRenderDataChips(); wsLoadData(); }
            t.value = ''; break;
        }
    }
}

const wsSearchJobs = wsDebounce(() => { WS.jobs.offset = 0; wsLoadJobs(); }, 300);
const wsSearchData = wsDebounce(() => { WS.data.offset = 0; wsLoadData(); }, 300);
const wsSearchBoxes = wsDebounce(() => { WS.jb.offset = 0; wsLoadJobBoxes(); }, 300);

function wsOnInput(e) {
    const t = e.target;
    switch (t.id) {
        case 'wsJobSearch': WS.jobs.search = t.value.trim(); wsSearchJobs(); break;
        case 'wsDataSearch': WS.data.search = t.value.trim(); wsSearchData(); break;
        case 'wsJobBoxSearch': WS.jb.search = t.value.trim(); wsSearchBoxes(); break;
        case 'wsDataJobIn': wsLoadFacets('job', t.value.trim()); break;
        case 'wsDataPersonIn': wsLoadFacets('person', t.value.trim()); break;
    }
}

function setupWorkspaceListeners() {
    const root = wsEl('wsRoot');
    if (!root) return;
    root.addEventListener('click', wsOnClick);
    root.addEventListener('change', wsOnChange);
    root.addEventListener('input', wsOnInput);
    wsEl('wsCloseBtn').addEventListener('click', closeWorkspace);
    wsEl('wsHelpBtn').addEventListener('click', () => helpShow('workspace'));
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && WS.open && !document.querySelector('.modal-overlay.active')) closeWorkspace();
    });
    if (typeof AppLang !== 'undefined') AppLang.onChange(() => { if (WS.open) wsGo(WS.section, true); });
}
document.addEventListener('DOMContentLoaded', setupWorkspaceListeners);
