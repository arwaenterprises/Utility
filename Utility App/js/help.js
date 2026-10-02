// ============================================
// HELP - step-by-step guide for each tool (English + Arabic)
// ============================================
// A "?" button in every tool's header opens the guide. The first time a person opens a
// tool, its guide opens by itself once (remembered per person on this device).
//
// RULE: every guide must exist in BOTH languages (en and ar). The tests fail if a tool
// has no Arabic version. To add a tool's guide: add an entry to HELP with the same id as
// in APPS (config.js), with an `en` and an `ar` block. In the Arabic text, buttons that
// are English on screen are kept in English (bold) so people can find them.
const HELP = {
    boxScanner: {
        en: {
            intro: 'Scan items into boxes, close each box, then download the list.',
            steps: [
                'Type a <b>Remark</b> (required - it tells your scanning jobs apart, for example "Fall Winter 2023 stocks").',
                'Scan the <b>Box ID</b> (the label on the box). This first scan starts the session and locks the Remark.',
                'Scan each <b>item barcode</b> that goes into that box. The last 5 scans show below; tap <b>Del</b> to remove a mistake.',
                'When the box is full, tap <b>Close Box</b>, tap <b>Yes</b>, then scan the Box ID again to confirm.',
                'Repeat for the next box. Tap <b>View Box</b> and scan any box ID to see what is inside it.',
                'When you are finished, tap <b>Download</b> to get the Excel file, then <b>Reset</b> to start a new session.'
            ],
            tips: [
                '<b>Nu</b> accepts numbers only; <b>AlNu</b> accepts letters and numbers. You can change it only when no box is open.',
                '<b>No Dup</b> stops the same barcode being scanned twice.',
                'Works offline. The &#10003; badge shows your scans are saved to the server.',
                'The &#9000;&#65039; button shows or hides the on-screen keyboard (handy with a handheld scanner).',
                'To change the Remark, tap <b>Reset</b>. If nothing was scanned yet it closes at once, with no question and no download.'
            ]
        },
        ar: {
            intro: 'امسح القطع داخل الصناديق، أغلق كل صندوق، ثم حمّل القائمة.',
            steps: [
                'اكتب <b>ملاحظة</b> (إلزامية - تميّز بين أعمال المسح، مثال: "مخزون خريف وشتاء 2023").',
                'امسح <b>رقم الصندوق</b> (الملصق الموجود على الصندوق). هذا المسح الأول يبدأ الجلسة ويقفل الملاحظة.',
                'امسح <b>باركود</b> كل قطعة توضع في هذا الصندوق. تظهر آخر 5 عمليات مسح في الأسفل؛ اضغط <b>حذف</b> لإزالة أي خطأ.',
                'عندما يمتلئ الصندوق اضغط <b>إغلاق الصندوق</b>، ثم <b>Yes</b>، ثم امسح رقم الصندوق مرة أخرى للتأكيد.',
                'كرر العملية للصندوق التالي. اضغط <b>عرض الصندوق</b> وامسح أي رقم صندوق لترى محتوياته.',
                'عند الانتهاء اضغط <b>تحميل</b> للحصول على ملف Excel، ثم <b>إعادة</b> لبدء جلسة جديدة.'
            ],
            tips: [
                '<b>Nu</b> للأرقام فقط، و<b>AlNu</b> للأحرف والأرقام. لا يمكن تغييره إلا عندما لا يكون هناك صندوق مفتوح.',
                '<b>بدون تكرار</b> يمنع مسح الباركود نفسه مرتين.',
                'يعمل بدون إنترنت. علامة &#10003; تعني أن عمليات المسح حُفظت على الخادم.',
                'زر &#9000;&#65039; يُظهر أو يُخفي لوحة المفاتيح على الشاشة (مفيد مع الماسح اليدوي).',
                'لتغيير الملاحظة اضغط <b>إعادة</b>. إذا لم يتم مسح شيء بعد فيُغلق فورًا بدون سؤال وبدون تحميل.'
            ]
        }
    },
    itemBarcode: {
        en: {
            intro: 'Print barcode or QR labels for items, one at a time or many at once.',
            steps: [
                'Check <b>Mode</b> and <b>Type</b> at the top. Tap <b>Settings</b> to choose Barcode or QR Code, and Numeric or Alphanumeric.',
                '<b>Single:</b> scan or type a barcode, enter the quantity (up to 200), then tap <b>Print Label</b>.',
                '<b>Bulk:</b> tap <b>Template</b>, fill it in (Barcode, Qty and, if you want, Text), tap <b>Upload</b>, check the preview, then <b>Print All</b>.',
                'Switch on <b>Add text</b> to print a line of text above the barcode.'
            ],
            tips: [
                'In Settings, tap <b>Print Test Label</b> first to check your printer.',
                'You can also paste several barcodes separated by commas, for example 123,456,789.'
            ]
        },
        ar: {
            intro: 'اطبع ملصقات باركود أو QR للقطع، واحدًا واحدًا أو بالجملة.',
            steps: [
                'تحقق من <b>Mode</b> و<b>Type</b> في الأعلى. اضغط <b>Settings</b> لاختيار Barcode أو QR Code، وNumeric أو Alphanumeric.',
                '<b>Single (فردي):</b> امسح الباركود أو اكتبه، أدخل الكمية (حتى 200)، ثم اضغط <b>Print Label</b>.',
                '<b>Bulk (بالجملة):</b> اضغط <b>Template</b>، املأ الملف (Barcode وQty، ويمكنك إضافة Text)، اضغط <b>Upload</b>، راجع المعاينة، ثم <b>Print All</b>.',
                'فعّل <b>Add text</b> لطباعة سطر نصي فوق الباركود.'
            ],
            tips: [
                'في Settings اضغط <b>Print Test Label</b> أولًا للتأكد من الطابعة.',
                'يمكنك أيضًا لصق عدة باركودات مفصولة بفواصل، مثل 123,456,789.'
            ]
        }
    },
    boxCode: {
        en: {
            intro: 'Print numbered box labels for a transfer (TRN).',
            steps: [
                'Check the <b>Prefix</b> and mode at the top. Tap <b>Settings</b> to change them.',
                'Type the <b>TRN number</b> (Transfer Reference Number).',
                'Enter <b>Start From</b> (the first box number) and <b>Quantity</b> (up to 100).',
                'Check the preview, then tap <b>Print Box Labels</b>.'
            ],
            tips: ['Labels are 4&times;6 inches and print 2 codes per label, so Quantity 10 gives 5 labels.']
        },
        ar: {
            intro: 'اطبع ملصقات صناديق مرقمة لعملية تحويل (TRN).',
            steps: [
                'تحقق من <b>Prefix</b> والوضع في الأعلى. اضغط <b>Settings</b> لتغييرهما.',
                'اكتب <b>TRN Number</b> (رقم مرجع التحويل).',
                'أدخل <b>Start From</b> (رقم أول صندوق) و<b>Quantity</b> (حتى 100).',
                'راجع المعاينة ثم اضغط <b>Print Box Labels</b>.'
            ],
            tips: ['مقاس الملصق 4×6 بوصة ويطبع رمزين في كل ملصق، لذا الكمية 10 تعطي 5 ملصقات.']
        }
    },
    boxSegregate: {
        en: {
            intro: 'Scan a box barcode to see its details, or check boxes against a pallet.',
            before: 'Your box list must be uploaded first. If you work alone or are your team\'s admin, tap the upload icon (<img class="help-ico" src="icons/ui-upload.png" alt="">); the download icon (<img class="help-ico" src="icons/ui-download.png" alt="">) gives you the template. Team members: your admin uploads the list; tap <img class="help-ico" src="icons/ui-sync.png" alt=""> to get it.',
            steps: [
                'Tap <img class="help-ico" src="icons/ui-sync.png" alt=""> to load the latest list. The time next to it shows when it was last updated.',
                'Scan the box barcode with the camera (&#128247;) or a handheld scanner. Use &#9000;&#65039; to type it instead.',
                'The result card shows the box details. If it says <b>not found</b>, check the barcode and that the list has been uploaded.',
                '<b>Pallet mode:</b> switch on <b>Pallet</b>, then scan each box on the pallet. The app counts them and flags duplicates and boxes that are not in the list.',
                'In Pallet mode, tap <b>Download</b> for the Excel file, and <b>Reset</b> when the pallet is done.'
            ],
            tips: ['Works offline once the list has been loaded on this device.']
        },
        ar: {
            intro: 'امسح باركود الصندوق لعرض تفاصيله، أو راجع الصناديق مقابل طبلية (Pallet).',
            before: 'يجب رفع قائمة الصناديق أولًا. إذا كنت تعمل بمفردك أو كنت مسؤول الفريق فاضغط أيقونة الرفع (<img class="help-ico" src="icons/ui-upload.png" alt="">)؛ وأيقونة التحميل (<img class="help-ico" src="icons/ui-download.png" alt="">) تعطيك النموذج. أعضاء الفريق: المسؤول يرفع القائمة؛ اضغط <img class="help-ico" src="icons/ui-sync.png" alt=""> لتحميلها.',
            steps: [
                'اضغط <img class="help-ico" src="icons/ui-sync.png" alt=""> لتحميل أحدث قائمة. الوقت بجانبه يوضح آخر تحديث.',
                'امسح باركود الصندوق بالكاميرا (&#128247;) أو بالماسح اليدوي. استخدم &#9000;&#65039; للكتابة بدلًا من المسح.',
                'تعرض البطاقة تفاصيل الصندوق. إذا ظهر <b>not found</b> فتحقق من الباركود ومن أن القائمة قد رُفعت.',
                '<b>وضع الطبلية:</b> فعّل <b>Pallet</b> ثم امسح كل صندوق على الطبلية. يحسبها التطبيق وينبّه إلى المكرر وإلى الصناديق غير الموجودة في القائمة.',
                'في وضع الطبلية اضغط <b>Download</b> لملف Excel، و<b>Reset</b> عند انتهاء الطبلية.'
            ],
            tips: ['يعمل بدون إنترنت بعد تحميل القائمة على هذا الجهاز.']
        }
    },
    priceCheck: {
        en: {
            intro: 'Scan an item to see its price.',
            before: 'The price list must be uploaded first. If you work alone or are your team\'s admin, tap the upload icon (<img class="help-ico" src="icons/ui-upload.png" alt="">); the download icon (<img class="help-ico" src="icons/ui-download.png" alt="">) gives you the template. Team members: your admin uploads the list; tap <img class="help-ico" src="icons/ui-sync.png" alt=""> to get it.',
            steps: [
                'Tap <img class="help-ico" src="icons/ui-sync.png" alt=""> to load the latest price list. The time next to it shows when it was last updated.',
                'Scan the item with the camera (&#128247;) or a handheld scanner. Use &#9000;&#65039; to type the barcode instead.',
                'The price appears on screen. If it says <b>not found</b>, the item is missing from the price list.'
            ],
            tips: ['Works offline once the list has been loaded on this device.']
        },
        ar: {
            intro: 'امسح القطعة لمعرفة سعرها.',
            before: 'يجب رفع قائمة الأسعار أولًا. إذا كنت تعمل بمفردك أو كنت مسؤول الفريق فاضغط أيقونة الرفع (<img class="help-ico" src="icons/ui-upload.png" alt="">)؛ وأيقونة التحميل (<img class="help-ico" src="icons/ui-download.png" alt="">) تعطيك النموذج. أعضاء الفريق: المسؤول يرفع القائمة؛ اضغط <img class="help-ico" src="icons/ui-sync.png" alt=""> لتحميلها.',
            steps: [
                'اضغط <img class="help-ico" src="icons/ui-sync.png" alt=""> لتحميل أحدث قائمة أسعار. الوقت بجانبه يوضح آخر تحديث.',
                'امسح القطعة بالكاميرا (&#128247;) أو بالماسح اليدوي. استخدم &#9000;&#65039; لكتابة الباركود بدلًا من المسح.',
                'يظهر السعر على الشاشة. إذا ظهر <b>not found</b> فالقطعة غير موجودة في قائمة الأسعار.'
            ],
            tips: ['يعمل بدون إنترنت بعد تحميل القائمة على هذا الجهاز.']
        }
    },
    dataManagement: {
        en: {
            intro: 'See what you have scanned, download it as Excel, or clear it.',
            before: 'An enterprise admin sees everyone on the team. An individual account or a team member sees only their own data. Team members can look and download but not reset.',
            steps: [
                'Tap the <b>Data Management</b> tile on the home screen.',
                'Choose the <b>Box-Item Scan</b> or <b>Year/Season</b> tab.',
                'Tap <b>+</b> next to a name to see the boxes, and <b>+</b> next to a box to see its items. Use the search box to find a box number, a barcode or a person.',
                'Tick the names you want (or <b>Select All</b>), then tap <b>Download Selected</b> to get the Excel file. The small arrow on a row downloads just that row.',
                '<b>Reset Selected</b> downloads the data first and then deletes it from the server. It asks <b>Are you sure?</b> before it does anything.'
            ],
            tips: ['Reset cannot be undone, so check the downloaded file first.', 'Close the window with the ✕ in the top corner.']
        },
        ar: {
            intro: 'اطّلع على ما قمت بمسحه، حمّله كملف Excel، أو امسحه.',
            before: 'مسؤول المؤسسة يرى جميع أعضاء الفريق. أما الحساب الفردي أو عضو الفريق فيرى بياناته فقط. يستطيع عضو الفريق العرض والتحميل لكن لا يستطيع الحذف (Reset).',
            steps: [
                'اضغط على بطاقة <b>Data Management</b> في الشاشة الرئيسية.',
                'اختر تبويب <b>Box-Item Scan</b> أو <b>Year/Season</b>.',
                'اضغط <b>+</b> بجانب الاسم لرؤية الصناديق، و<b>+</b> بجانب الصندوق لرؤية قطعه. استخدم مربع البحث للعثور على رقم صندوق أو باركود أو شخص.',
                'حدّد الأسماء المطلوبة (أو <b>Select All</b>) ثم اضغط <b>Download Selected</b> للحصول على ملف Excel. السهم الصغير في أي صف يحمّل ذلك الصف فقط.',
                'زر <b>Reset Selected</b> يحمّل البيانات أولًا ثم يحذفها من الخادم. ويسألك <b>Are you sure?</b> قبل أي إجراء.'
            ],
            tips: ['لا يمكن التراجع عن Reset، لذا تحقق من الملف المحمّل أولًا.', 'أغلق النافذة بزر ✕ في الزاوية العلوية.']
        }
    },
    yearSegregate: {
        en: {
            intro: 'Sort items by year and season into PTL boxes.',
            before: 'The <b>Item Master</b> and <b>PTL config</b> lists must be uploaded first (use the <img class="help-ico" src="icons/ui-upload.png" alt=""> Items and <img class="help-ico" src="icons/ui-upload.png" alt=""> PTL buttons; the <img class="help-ico" src="icons/ui-download.png" alt=""> icons give the templates). Team members: your admin uploads them.',
            steps: [
                'Wait for the items to finish loading, then type a <b>Remark</b> (required). Your first scan starts the session and locks the Remark.',
                'Choose <b>Nu</b> (numbers only) or <b>AlNu</b> (letters and numbers) at the top.',
                'Scan an <b>item barcode</b>. The app shows which PTL the item belongs to.',
                'Go to that PTL and scan its <b>ST</b> code (for example ST05) to open the box. For a new box, scan the physical box label when asked.',
                'Keep scanning items for that PTL. The app warns you if you scan the wrong PTL or box.',
                'When the box is full, close it (scan the PTL\'s close code, or tap the PTL and choose Close) and scan the box barcode to confirm.',
                'When all boxes are closed and the sync badge shows &#10003;, tap <b>Download</b>, then <b>Reset</b> for a new session.'
            ],
            tips: [
                'You cannot change Nu/AlNu or Reset while a PTL box is still open.',
                'The &#127760; button turns spoken prompts on or off and picks their language.',
                'Tap a PTL in the list to see its details.'
            ]
        },
        ar: {
            intro: 'افرز القطع حسب السنة والموسم داخل صناديق PTL.',
            before: 'يجب رفع قائمتي <b>Item Master</b> و<b>PTL config</b> أولًا (أزرار <img class="help-ico" src="icons/ui-upload.png" alt=""> Items و<img class="help-ico" src="icons/ui-upload.png" alt=""> PTL؛ وأيقونات <img class="help-ico" src="icons/ui-download.png" alt=""> تعطيك النماذج). أعضاء الفريق: المسؤول يرفعهما.',
            steps: [
                'انتظر حتى يكتمل تحميل القطع، ثم اكتب <b>Remark</b> (إلزامي). المسح الأول يبدأ الجلسة ويقفل الملاحظة.',
                'اختر <b>Nu</b> (أرقام فقط) أو <b>AlNu</b> (أحرف وأرقام) في الأعلى.',
                'امسح <b>باركود القطعة</b>. يعرض التطبيق رقم PTL الذي تنتمي إليه.',
                'اذهب إلى ذلك الـ PTL وامسح رمز <b>ST</b> الخاص به (مثل ST05) لفتح الصندوق. للصندوق الجديد امسح ملصق الصندوق الفعلي عند الطلب.',
                'استمر في مسح القطع لهذا الـ PTL. ينبّهك التطبيق إذا مسحت PTL أو صندوقًا خاطئًا.',
                'عندما يمتلئ الصندوق أغلقه (امسح رمز الإغلاق الخاص بالـ PTL، أو اضغط على الـ PTL واختر Close) ثم امسح باركود الصندوق للتأكيد.',
                'عندما تُغلق كل الصناديق وتظهر علامة المزامنة &#10003;، اضغط <b>Download</b> ثم <b>Reset</b> لبدء جلسة جديدة.'
            ],
            tips: [
                'لا يمكنك تغيير Nu/AlNu أو عمل Reset وهناك صندوق PTL مفتوح.',
                'زر &#127760; يشغّل التنبيهات الصوتية أو يوقفها ويختار لغتها.',
                'اضغط على أي PTL في القائمة لعرض تفاصيله.'
            ]
        }
    }
};

const HELP_UI = {
    en: { title: 'How to use', before: 'Before you start:', steps: 'Step by step', tips: 'Good to know', ok: 'Got it', hold: 'Tip: press and hold any icon button to see what it does.' },
    ar: { title: 'كيفية استخدام', before: 'قبل أن تبدأ:', steps: 'خطوة بخطوة', tips: 'معلومات مفيدة', ok: 'فهمت', hold: 'نصيحة: اضغط مطولًا على أي زر أيقونة لمعرفة وظيفته.' }
};
let helpLang = 'en';
let helpAppId = null;

function helpSeenKey(appId) {
    return 'help_seen_' + appId + '_' + ((AppState.user && AppState.user.id) || 'anon');
}

// Language: the app-wide choice (welcome screen / Account window), see js/lang.js.
function helpPickLang() {
    return (typeof AppLang !== 'undefined' && AppLang.get() === 'ar') ? 'ar' : 'en';
}

function helpRender() {
    const h = HELP[helpAppId];
    const app = APPS.find(a => a.id === helpAppId);
    if (!h || !app) return;
    const t = HELP_UI[helpLang], c = h[helpLang];
    const list = (arr, tag) => '<' + tag + '>' + arr.map(x => '<li>' + x + '</li>').join('') + '</' + tag + '>';
    document.getElementById('helpTitle').innerHTML = appIconHtml(app, 'title-icon') + ' ' + t.title + ' ' + app.name;
    document.getElementById('helpTitle').setAttribute('dir', helpLang === 'ar' ? 'rtl' : 'ltr');
    const body = document.getElementById('helpBody');
    body.setAttribute('dir', helpLang === 'ar' ? 'rtl' : 'ltr');
    body.setAttribute('lang', helpLang);
    body.style.textAlign = helpLang === 'ar' ? 'right' : 'left';
    body.innerHTML =
        '<p class="help-intro">' + c.intro + '</p>' +
        (c.before ? '<div class="help-before"><b>' + t.before + '</b> ' + c.before + '</div>' : '') +
        '<h4>' + t.steps + '</h4>' + list(c.steps, 'ol') +
        (c.tips && c.tips.length ? '<h4>' + t.tips + '</h4>' + list(c.tips, 'ul') : '') +
        '<p class="help-hold">' + t.hold + '</p>';
    body.scrollTop = 0;
    document.getElementById('helpCloseBtn').textContent = t.ok;
}

function helpShow(appId) {
    if (!HELP[appId] || !APPS.find(a => a.id === appId)) return;
    helpAppId = appId;
    helpLang = helpPickLang();
    helpRender();
    document.getElementById('helpModal').classList.add('active');
    try { Storage.set(helpSeenKey(appId), '1'); } catch (e) { /* storage blocked: fine */ }
}

function helpAutoShowOnce(appId) {
    if (!HELP[appId]) return;
    let seen = null;
    try { seen = Storage.get(helpSeenKey(appId)); } catch (e) { /* storage blocked: show it */ }
    if (!seen) helpShow(appId);
}

document.addEventListener('DOMContentLoaded', () => {
    const open = document.getElementById('helpBtn');
    const close = document.getElementById('helpCloseBtn');
    if (open) open.addEventListener('click', () => { if (AppState.currentApp) helpShow(AppState.currentApp); });
    if (close) close.addEventListener('click', () => document.getElementById('helpModal').classList.remove('active'));
});
