// ============================================
// LONG-PRESS HINTS FOR ICON BUTTONS
// ============================================
// On a computer, hovering an icon shows its `title`. Phones and tablets have no hover, so
// press-and-hold on any element that has a `title` (or aria-label / data-tip) shows the same
// text in a small bubble, and the button is NOT triggered by that press. Text is shown in
// Arabic when the Box Scanner / guide language is Arabic (see TIP_AR).
// To make a new icon explain itself: give it a title="..." (and add its Arabic below).
const TIP_AR = {
    'Show/hide keyboard': 'إظهار/إخفاء لوحة المفاتيح',
    'Upload list': 'رفع القائمة',
    'Type manually': 'الكتابة يدويًا',
    'Sync data': 'مزامنة البيانات',
    'Scan with camera': 'المسح بالكاميرا',
    'Download template': 'تحميل النموذج',
    'Voice language': 'لغة الصوت',
    'Upload item master': 'رفع قائمة القطع (Item Master)',
    'Upload PTL config': 'رفع إعدادات PTL',
    'Sign out': 'تسجيل الخروج',
    'Send a new invite': 'إرسال دعوة جديدة',
    'Rename enterprise': 'تغيير اسم الشركة',
    'Remove invite': 'حذف الدعوة',
    'Remove from team': 'إزالة من الفريق',
    'Refresh Item Master & HU Config': 'تحديث Item Master وإعدادات HU',
    'Print a line of text above the barcode': 'اطبع سطرًا نصيًا فوق الباركود',
    'Pallet mode: sort boxes by document / store': 'وضع الطبلية: فرز الصناديق حسب المستند / المتجر',
    'How to use this tool': 'طريقة استخدام هذه الأداة',
    "Download this member's data": 'تحميل بيانات هذا العضو',
    "Download this member's Year/Season data": 'تحميل بيانات السنة/الموسم لهذا العضو',
    'Download this box': 'تحميل هذا الصندوق',
    'Download item master template': 'تحميل نموذج قائمة القطع (Item Master)',
    'Download PTL config template': 'تحميل نموذج إعدادات PTL',
    'Back to Home': 'العودة إلى الرئيسية',
    'Account': 'الحساب',
    'Later': 'لاحقًا',
    'Complete or reset session to go back': 'أكمل الجلسة أو أعدها للرجوع',
    'Delete this scan': 'حذف هذا المسح',
    'Show / hide details': 'إظهار / إخفاء التفاصيل',
    'Sync status (a tick means saved to the server)': 'حالة المزامنة (علامة الصح تعني الحفظ على الخادم)'
};
// Used when an element has no title of its own (e.g. buttons the app creates later).
const TIP_FALLBACK = {
    '.delete-scan-btn': 'Delete this scan',
    '.expand-btn': 'Show / hide details',
    '.sync-badge': 'Sync status (a tick means saved to the server)'
};

(function () {
    const HOLD_MS = 450, SHOW_MS = 2600, MOVE_PX = 10;
    let timer = null, startX = 0, startY = 0, tipEl = null, hideTimer = null, swallowUntil = 0;

    function tipTextFor(el) {
        let t = el.getAttribute('data-tip') || el.getAttribute('title') || el.getAttribute('aria-label') || '';
        if (!t) for (const sel in TIP_FALLBACK) if (el.matches(sel)) t = TIP_FALLBACK[sel];
        return t;
    }
    function holder(target) {
        let el = target && target.closest ? target.closest('[data-tip],[title],[aria-label],.delete-scan-btn,.expand-btn,.sync-badge') : null;
        if (!el || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return null;
        return tipTextFor(el) ? el : null;
    }
    function isArabic() {
        try {
            if (typeof helpPickLang === 'function') return helpPickLang() === 'ar';
        } catch (e) { /* ignore */ }
        return false;
    }
    function hide() {
        clearTimeout(hideTimer);
        if (tipEl) { tipEl.remove(); tipEl = null; }
    }
    function show(el) {
        let text = tipTextFor(el);
        const ar = isArabic();
        if (ar && TIP_AR[text]) text = TIP_AR[text];
        hide();
        tipEl = document.createElement('div');
        tipEl.className = 'longpress-tip';
        tipEl.setAttribute('role', 'tooltip');
        if (ar) tipEl.setAttribute('dir', 'rtl');
        tipEl.textContent = text;
        document.body.appendChild(tipEl);
        const r = el.getBoundingClientRect(), t = tipEl.getBoundingClientRect();
        let left = r.left + r.width / 2 - t.width / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - t.width - 8));
        let top = r.top - t.height - 10;
        if (top < 8) top = r.bottom + 10;
        tipEl.style.left = left + 'px';
        tipEl.style.top = top + 'px';
        hideTimer = setTimeout(hide, SHOW_MS);
        try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) { /* not supported */ }
    }
    function cancel() { clearTimeout(timer); timer = null; }

    document.addEventListener('pointerdown', (e) => {
        hide();
        swallowUntil = 0;                                      // a new touch starts a new gesture: never swallow its click
        if (e.pointerType === 'mouse') return;                 // a mouse already has hover
        const el = holder(e.target);
        if (!el) return;
        startX = e.clientX; startY = e.clientY;
        cancel();
        timer = setTimeout(() => { timer = null; swallowUntil = Date.now() + 1200; show(el); }, HOLD_MS);
    }, true);
    document.addEventListener('pointermove', (e) => {
        if (timer && Math.hypot(e.clientX - startX, e.clientY - startY) > MOVE_PX) cancel();
    }, true);
    ['pointerup', 'pointercancel', 'scroll'].forEach(ev => document.addEventListener(ev, cancel, true));

    // The release after a long press must not press the button.
    document.addEventListener('click', (e) => {
        if (Date.now() < swallowUntil) { e.preventDefault(); e.stopPropagation(); swallowUntil = 0; }
    }, true);
    // No phone "copy / save image" menu on these icons.
    document.addEventListener('contextmenu', (e) => { if (holder(e.target) && e.pointerType !== 'mouse' && ('ontouchstart' in window)) e.preventDefault(); }, true);
})();
