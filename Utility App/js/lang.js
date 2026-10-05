// ============================================
// APP LANGUAGE (English / Arabic) - one choice for the whole app
// ============================================
// Chosen on the welcome screen or with the round EN / AR button in the top bar, and
// remembered on this device. It decides the language of: the welcome and home screens, the
// Box Scanner, the step-by-step guides and the long-press hints. It also turns the page
// right-to-left for Arabic.
// RULE: every text marked data-i18n="key" in index.html needs an Arabic entry below (tests check).
// Tools whose screens are not translated yet (see ROADMAP) stay English but are laid out
// right-to-left when Arabic is chosen.
const AR_UI = {
    hero_tag: 'أدوات مستودعات ومتاجر بسيطة وآمنة تعمل على أي هاتف أو جهاز لوحي أو حاسوب.',
    welcome: 'مرحبًا',
    signin_sub: 'سجّل الدخول للوصول إلى أدواتك',
    signin_btn: 'تسجيل الدخول عبر Google',
    b_google_t: 'تسجيل دخول Google', b_google_s: 'لا نرى كلمة مرورك أبدًا',
    b_ssl_t: 'HTTPS: التقييم A+', b_ssl_s: 'SSL Labs، 1 أكتوبر 2026 &#8599;',
    b_safe_t: 'التصفح الآمن: سليم', b_safe_s: 'Google، 1 أكتوبر 2026 &#8599;',
    b_noads_t: 'بدون إعلانات ولا تتبّع', b_noads_s: 'بياناتك تبقى حتى تحذفها أنت',
    dp_h: 'بياناتك تحت سيطرتك',
    dp1_b: 'فريقك فقط يرى بياناتك', dp1_s: 'عمليات المسح والقوائم الخاصة بك سرّية عن الفرق الأخرى. يستطيع مسؤول الفريق رؤيتها، وكذلك أسماء العمال الذين انضموا برمز QR.',
    dp2_b: 'بياناتك تبقى حتى تحذفها', dp2_s: 'احذفها بنفسك داخل التطبيق عند انتهاء العمل، أو راسلنا وسنزيلها.',
    dp3_b: 'لا نبيع البيانات، لا إعلانات، لا تتبّع', dp3_s: 'لا نبيع البيانات ولا نعرض إعلانات. إحصاءات الاستخدام مجرد أعداد ولا تتضمن باركوداتك أبدًا.',
    dp4_b: 'الكاميرا تبقى على جهازك', dp4_s: 'مسح الباركود يتم داخل متصفحك. لا يتم تسجيل أو رفع أي شيء.',
    l_privacy: 'سياسة الخصوصية', l_terms: 'الشروط', l_security: 'تفاصيل الأمان',
    teaser: 'سجّل الدخول لاستكشاف أدوات المستودعات لدينا — ونضيف المزيد مع الوقت.',
    how_h: 'كيف يعمل',
    st1_b: 'سجّل الدخول', st1_s: 'بحساب Google الخاص بك',
    st2_b: 'استكشف الأدوات', st2_s: 'امسح أو ابحث أو اطبع',
    st3_b: 'يعمل بدون إنترنت', st3_s: 'ويزامن عند عودة الاتصال',
    foot_by: 'من تطوير وتشغيل <strong>Arwa Enterprises</strong> &middot; الهند ودول الخليج',
    f_about: 'حول وتواصل', f_privacy: 'الخصوصية', f_terms: 'الشروط', f_security: 'الأمان',
    foot_note: 'الشارات التي تحمل &#8599; تفتح الفحص العلني، لتتحقق منها بنفسك.',
    home_h: 'مرحبًا!', home_p: 'اختر أداة للبدء',
    sess_t: 'جلسة مسح الصناديق والقطع نشطة', sess_i: 'أكمل الجلسة أو أعدها للتبديل بين التطبيقات', sess_btn: 'الذهاب إلى الماسح',
    lang_label: 'اللغة',
    lab_h: 'العمال (انضموا عبر QR)',
    cam_close: '✕ إغلاق الكاميرا',
    ql_h: 'روابط QR للفريق',
    ql_p: 'ينضم العمال برمز QR — دون حساب Google. كل رابط لأداة واحدة ومهمة واحدة؛ أنشئ رابطًا لكل فريق حتى على الأداة نفسها. إنشاء رابط بنفس الأداة واسم المهمة يحلّ محل الرابط القديم لتلك المهمة.',
    ql_create: 'إنشاء رابط QR',
    qs_print: 'طباعة', qs_share: 'مشاركة', qs_copy: 'نسخ الرابط', qs_close: 'إغلاق',
    join_h: 'الانضمام إلى فريق',
    join_check: 'تأكد من صحة هذه الأسماء قبل المتابعة:',
    join_ent: 'المؤسسة', join_adm: 'المسؤول', join_tool: 'الأداة', join_job: 'المهمة',
    join_name: 'اسمك',
    join_note: 'يكفي اسمك فقط. يخبر المسؤول بمن قام بمسح ماذا.',
    join_btn: 'انضمام',
    join_signout: 'تسجيل الخروج من Google',
    labour_hint: 'هل تنضم إلى فريق كعامل؟ امسح رمز QR الخاص بالمسؤول بكاميرا الهاتف أو ماسح QR — لا حاجة لتسجيل الدخول.'
};

const AppLang = (function () {
    const listeners = [];

    function get() {
        let l = null;
        try { l = Storage.get('lang'); } catch (e) { /* storage blocked */ }
        if (!l) {                                    // first run after this update: keep an earlier Arabic Box Scanner choice
            try { const s = Storage.getJSON('scanner_session'); if (s && s.language === 'ar') l = 'ar'; } catch (e) { /* ignore */ }
        }
        return l === 'ar' ? 'ar' : 'en';
    }

    function translatePage(lang) {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            if (el.dataset.en === undefined) el.dataset.en = el.innerHTML;     // remember the English text once
            const ar = AR_UI[el.dataset.i18n];
            el.innerHTML = (lang === 'ar' && ar !== undefined) ? ar : el.dataset.en;
        });
    }

    function apply() {
        const lang = get();
        document.body.classList.toggle('rtl', lang === 'ar');
        document.documentElement.setAttribute('lang', lang);
        translatePage(lang);
        const circle = document.getElementById('langBtn');                 // the round EN / AR button in the top bar
        if (circle) circle.textContent = lang === 'ar' ? 'AR' : 'EN';
        listeners.forEach(fn => { try { fn(lang); } catch (e) { console.error(e); } });
    }

    function set(lang) {
        try { Storage.set('lang', lang === 'ar' ? 'ar' : 'en'); } catch (e) { /* storage blocked: still applies for this visit */ }
        apply();
    }

    document.addEventListener('DOMContentLoaded', () => {
        const circle = document.getElementById('langBtn');
        if (circle) circle.addEventListener('click', () => set(get() === 'ar' ? 'en' : 'ar'));
        apply();
    });

    return { get, set, apply, onChange: fn => listeners.push(fn) };
})();
