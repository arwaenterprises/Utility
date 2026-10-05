// ============================================
// TEAM QR LINKS - texts and the QR sheet (the admin's list of jobs / links is in js/workspace.js)
// ============================================
// The admin picks a tool, types a job name (it becomes the Remark of every scan) and gets a QR code. Labourers
// scan it with the phone's own scanner - see js/operator.js for what happens on their device.
// Many teams can work on the same tool at once: one link per team, each with its own job name. Creating a link with the
// same tool AND the same job name replaces just that link (a fresh QR for that job). A link never expires by itself: it works until
// the admin stops it (the server decides - supabase/schema.sql). Only Box-Item Scan and Year/Season jobs with no scan for
// 30 days are deleted automatically with their data, after a 7-day warning (see purge_inactive_jobs in schema.sql).
const QL_T = {
    en: {
        none: 'No QR links yet. Create one below.',
        people1: '1 person joined', peopleN: '{n} people joined',
        active: 'Active', inactive: 'Switched off (3 days without scans)',
        show: 'Show QR', stop: 'Stop this link',
        stopAsk: 'Stop this link? Nobody can start new work on it. Scans already made are kept.',
        pickTool: 'Choose a tool', jobPlaceholder: 'Job name (becomes the Remark)',
        needJob: 'Please type a job name.', needTool: 'Please choose a tool.',
        replaces: 'A link for {tool} named "{job}" is already active. Creating this one stops the old QR of that job (other jobs are not affected). Continue?',
        copied: 'Link copied.', copyFail: 'Could not copy. Select the link and copy it by hand.',
        failed: 'Could not do that. Please try again.',
        sheetLine: 'Scan with your phone camera or QR scanner. Only your name is needed.',
        enterprise: 'Enterprise', admin: 'Admin', tool: 'Tool', job: 'Job',
        labourer: 'labourer', name: 'Name', rename: 'Rename', removeLabourer: 'Remove from this job',
        noLabourers: 'Nobody has joined by QR yet.', renamePrompt: 'Correct name (also changed on their earlier scans):',
        nameBad: 'Please type a name of 1 to 40 characters.',
        removeAsk: 'Remove this person? Their handheld stops accepting new scans. What they scanned stays.'
    },
    ar: {
        none: 'لا توجد روابط QR بعد. أنشئ واحدًا أدناه.',
        people1: 'انضم شخص واحد', peopleN: 'انضم {n} أشخاص',
        active: 'نشط', inactive: 'متوقف (3 أيام دون مسح)',
        show: 'عرض QR', stop: 'إيقاف هذا الرابط',
        stopAsk: 'هل تريد إيقاف هذا الرابط؟ لن يستطيع أحد بدء عمل جديد عليه. عمليات المسح التي تمت تبقى محفوظة.',
        pickTool: 'اختر أداة', jobPlaceholder: 'اسم المهمة (يصبح الملاحظة)',
        needJob: 'الرجاء كتابة اسم المهمة.', needTool: 'الرجاء اختيار أداة.',
        replaces: 'يوجد رابط نشط لأداة {tool} باسم "{job}". إنشاء هذا الرابط سيوقف رمز QR القديم لهذه المهمة (المهام الأخرى لا تتأثر). هل تريد المتابعة؟',
        copied: 'تم نسخ الرابط.', copyFail: 'تعذّر النسخ. حدّد الرابط وانسخه يدويًا.',
        failed: 'تعذّر تنفيذ ذلك. حاول مرة أخرى.',
        sheetLine: 'امسح بكاميرا الهاتف أو ماسح QR. يكفي اسمك فقط.',
        enterprise: 'المؤسسة', admin: 'المسؤول', tool: 'الأداة', job: 'المهمة',
        labourer: 'عامل', name: 'الاسم', rename: 'تغيير الاسم', removeLabourer: 'إزالة من هذه المهمة',
        noLabourers: 'لم ينضم أحد عبر QR بعد.', renamePrompt: 'الاسم الصحيح (يتغير أيضًا في عمليات المسح السابقة):',
        nameBad: 'الرجاء كتابة اسم من 1 إلى 40 حرفًا.',
        removeAsk: 'هل تريد إزالة هذا الشخص؟ سيتوقف جهازه عن قبول عمليات مسح جديدة. ما مسحه يبقى محفوظًا.'
    }
};
function qlT(key) {
    const lang = (typeof AppLang !== 'undefined' && AppLang.get() === 'ar') ? 'ar' : 'en';
    return QL_T[lang][key] !== undefined ? QL_T[lang][key] : QL_T.en[key];
}

function teamLinkUrl(token) {
    return window.location.origin + '/j/' + token;
}

// The QR sheet: everything a labourer must check before scanning (enterprise, admin, tool, job) next to the code.
async function showQrSheet(link) {
    const { data: ent } = await supabaseClient.from('enterprises').select('name').eq('id', AppState.profile.enterprise_id).maybeSingle();
    const adminName = AppState.profile.display_name || AppState.user.email || '';
    const url = teamLinkUrl(link.token);
    document.getElementById('qsEnterprise').textContent = (ent && ent.name) || '';
    document.getElementById('qsAdmin').textContent = adminName;
    document.getElementById('qsTool').textContent = opToolName(link.tool);
    document.getElementById('qsJob').textContent = link.job_name;
    document.getElementById('qsUrl').textContent = url;
    document.getElementById('qsLine').textContent = qlT('sheetLine');
    ['qsEntLbl', 'qsAdmLbl', 'qsToolLbl', 'qsJobLbl'].forEach((id, i) => { document.getElementById(id).textContent = qlT(['enterprise', 'admin', 'tool', 'job'][i]); });
    const box = document.getElementById('qsQr');
    box.innerHTML = '';
    new QRCode(box, { text: url, width: 240, height: 240, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
    document.getElementById('qsCopyBtn').dataset.url = url;
    document.getElementById('qsShareBtn').style.display = navigator.share ? '' : 'none';
    document.getElementById('qrSheetModal').classList.add('active');
}

function closeQrSheet() {
    document.getElementById('qrSheetModal').classList.remove('active');
}

async function copyQrLink() {
    const url = document.getElementById('qsCopyBtn').dataset.url;
    try { await navigator.clipboard.writeText(url); alert(qlT('copied')); }
    catch (e) { alert(qlT('copyFail')); }
}

async function shareQrLink() {
    const url = document.getElementById('qsCopyBtn').dataset.url;
    try {
        await navigator.share({
            title: document.getElementById('qsJob').textContent + ' - ' + document.getElementById('qsEnterprise').textContent,
            text: document.getElementById('qsEnterprise').textContent + ' / ' + document.getElementById('qsJob').textContent,
            url
        });
    } catch (e) { /* the person closed the share sheet */ }
}

function printQrSheet() {
    document.body.classList.add('printing-qr');
    const done = () => { document.body.classList.remove('printing-qr'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
}

function setupTeamLinkListeners() {
    document.getElementById('qsCloseBtn').addEventListener('click', closeQrSheet);
    document.getElementById('qsCopyBtn').addEventListener('click', copyQrLink);
    document.getElementById('qsShareBtn').addEventListener('click', shareQrLink);
    document.getElementById('qsPrintBtn').addEventListener('click', printQrSheet);
}
document.addEventListener('DOMContentLoaded', setupTeamLinkListeners);
