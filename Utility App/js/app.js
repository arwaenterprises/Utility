// ============================================
// SCREEN NAVIGATION
// ============================================
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
    AppState.currentScreen = screenId;
}

// ============================================
// AUTH (Google sign-in via Supabase)
// ============================================
async function signInWithGoogle() {
    const errorDiv = document.getElementById('loginError');
    errorDiv.classList.remove('show');
    const { error } = await supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin }
    });
    if (error) showError(errorDiv, error.message);
}

async function signOut() {
    Camera.stopAll();
    await supabaseClient.auth.signOut();
    AppState.user = null;
    AppState.profile = null;
    AppState.operator = null;
    document.body.classList.remove('operator-mode');
    updateHeaderUser();
    showScreen('loginScreen');
}

async function loadUserProfile() {
    const { data, error } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', AppState.user.id)
        .single();
    if (error) {
        console.error('Failed to load profile:', error);
        return;
    }
    AppState.profile = data;
}

// Re-reads this account's profile from the server. Team membership can change while a phone is
// open (the admin removes or adds the person), and every scan is checked against the CURRENT team
// when it is uploaded - a stale profile would stamp scans with a team the person no longer belongs to
// and the server would refuse them. minGapMs stops repeated calls (0 = always ask).
let lastProfileCheckMs = 0;
async function refreshProfile(minGapMs) {
    if (!AppState.user || !AppState.isOnline) return false;
    const now = Date.now();
    if (minGapMs && now - lastProfileCheckMs < minGapMs) return false;
    lastProfileCheckMs = now;
    const { data, error } = await supabaseClient.from('profiles').select('*').eq('id', AppState.user.id).single();
    if (error || !data) return false;
    const changed = (AppState.profile?.enterprise_id || null) !== (data.enterprise_id || null) || AppState.profile?.tier !== data.tier;
    AppState.profile = data;
    if (changed) {
        updateHeaderUser();
        if (document.getElementById('homeScreen').classList.contains('active')) renderAppGrid();
    }
    return changed;
}

// "new row violates row-level security policy" (code 42501) = the server refused the data for this account.
function isPermissionError(err) {
    return !!err && (err.code === '42501' || /row-level security|permission denied/i.test(err.message || ''));
}

async function enterAppAsSignedInUser(session) {
    AppState.user = session.user;
    await loadUserProfile();
    // Every Google sign-in is its own team: accounts made before that rule get theirs on the next sign-in.
    if (AppState.profile?.tier === 'individual' && !AppState.profile?.enterprise_id && AppState.isOnline) {
        const { error: teamError } = await supabaseClient.rpc('ensure_own_team');
        if (!teamError) await loadUserProfile();
    }
    updateHeaderUser();
    checkExistingSession();
    showScreen('homeScreen');
    renderAppGrid();
}

function showError(element, message) {
    element.textContent = message;
    element.classList.add('show');
}

function updateHeaderUser() {
    const el = document.getElementById('headerUser');
    const signOutBtn = document.getElementById('signOutBtn');
    if (AppState.user && AppState.operator) {          // a labourer: name and "leave this job" only
        el.textContent = AppState.operator.name;
        el.classList.add('show');
        signOutBtn.classList.add('show');
    } else if (AppState.user) {
        el.textContent = AppState.profile?.display_name || AppState.user.email;
        el.classList.add('show');
        signOutBtn.classList.add('show');
    } else {
        el.classList.remove('show');
        signOutBtn.classList.remove('show');
    }
}

// ============================================
// ACCOUNT / ENTERPRISE
// ============================================
function tierDisplayText(profile) {
    if (!profile) return '';
    if (profile.tier === 'enterprise_admin') return 'Enterprise Admin';
    if (profile.tier === 'enterprise_member') return 'Enterprise Member';
    return 'Individual';
}

async function openAccountModal() {
    // An enterprise admin (every Google sign-in is its own team) gets the Team & Data workspace; members and
    // individuals keep the small account window.
    if (AppState.profile?.tier === 'enterprise_admin' && typeof openWorkspace === 'function') { openWorkspace(); return; }
    document.getElementById('accountEmailDisp').textContent = AppState.user?.email || '';
    document.getElementById('accountTierDisp').textContent = tierDisplayText(AppState.profile);
    document.getElementById('accountModal').classList.add('active');
}

function closeAccountModal() {
    document.getElementById('accountModal').classList.remove('active');
}

// ============================================
// TEAM MODAL (unified management + scans; scales to thousands of rows by
// computing stats server-side and fetching box/item detail only on demand,
// instead of loading the whole team's scan history into the browser)
//
// Rendered as a spreadsheet-style nested table: Members -> Boxes -> Items,
// each level expand/collapse in place (no drill-down popups), with a
// download icon on every row so any slice of data can be exported on its own.
// ============================================
let teamMemberStatsCache = [];       // [{user_id, display_name, email, boxes_closed, total_qty}]
const teamMemberBoxesCache = new Map(); // user_id -> [{boxNumber, status, items:[...]}] (lazy-loaded on expand)
const expandedMemberIds = new Set();
const expandedBoxKeys = new Set();      // `${scope}:${ownerId}:${boxNumber}` where scope is 'member' or 'search'
const selectedMemberIds = new Set();
let teamSearchDebounceTimer = null;
let teamSearchResultsCache = []; // flat rows from the last search_team_scans() call

function teamMemberDisplayName(m) {
    return m.display_name || m.email || '—';
}

// A "person" in the people lists is either an ordinary account (key 'u:<id>') or a labourer who joined by QR
// (key 'o:<name in lower case>', which can span several handhelds). The database builds the key; older rows
// without one fall back to the account id.
function personKey(m) { return m.person_key || m.user_id; }
function personName(m) { return teamMemberDisplayName(m); }
function findTeamPerson(key) {
    return teamMemberStatsCache.find(m => personKey(m) === key) || teamYsStatsCache.find(m => personKey(m) === key) || null;
}
function splitPeople(people) {
    return {
        ids: people.filter(p => !p.is_operator).map(p => p.user_id),
        names: people.filter(p => p.is_operator).flatMap(p => p.operator_names || [])
    };
}
// Reads the scans of a set of people from one table: accounts by user id, labourers by the name on the scan.
// build(query) adds the select/ordering to a page query; two lists are fetched (accounts, then labourers) and merged.
async function fetchScansForPeople(table, selectCols, people) {
    const { ids, names } = splitPeople(people);
    const parts = [];
    for (const [col, values] of [['user_id', ids], ['operator_name', names]]) {
        if (!values.length) continue;
        const { data, error } = await fetchAllPages((from, to) => scopeToMyEnterprise(supabaseClient.from(table).select(selectCols))
            .in(col, values)
            .order('scanned_at', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to));
        if (error) return { data: null, error };
        parts.push(...data);
    }
    parts.sort((a, b) => (a.scanned_at < b.scanned_at ? -1 : a.scanned_at > b.scanned_at ? 1 : 0));
    return { data: parts, error: null };
}
async function deleteScansForPeople(table, people) {
    const { ids, names } = splitPeople(people);
    for (const [col, values] of [['user_id', ids], ['operator_name', names]]) {
        if (!values.length) continue;
        const { error } = await scopeToMyEnterprise(supabaseClient.from(table).delete()).in(col, values);
        if (error) return error;
    }
    return null;
}

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Supabase returns at most ~1000 rows per request, so anything that exports (and then
// possibly deletes) a member's data must page through ALL of it, or rows would be
// deleted without ever having been exported. makeQuery(from, to) builds one page.
async function fetchAllPages(makeQuery) {
    const pageSize = 1000;
    const rows = [];
    for (let from = 0; ; from += pageSize) {
        const { data, error } = await makeQuery(from, from + pageSize - 1);
        if (error) return { data: null, error };
        rows.push(...data);
        if (data.length < pageSize) break;
    }
    return { data: rows, error: null };
}

function exportScansToExcel(rows, filenamePrefix) {
    if (!rows || rows.length === 0) {
        alert('No data to download.');
        return;
    }
    const sheetRows = rows.map(s => ({
        'Scanned By': s.operator_name || s.display_name || s.email || s.profiles?.display_name || s.profiles?.email || '—',
        'Remark': s.remark || '',
        'Box Number': s.box_number,
        'Barcode': s.barcode,
        'Qty': s.qty,
        'Status': s.box_status,
        'Scanned At': new Date(s.scanned_at).toLocaleString()
    }));
    const ws = XLSX.utils.json_to_sheet(sheetRows);
    ws['!cols'] = [{wch:20},{wch:20},{wch:12},{wch:20},{wch:5},{wch:8},{wch:18}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Team Scans');
    XLSX.writeFile(wb, `${filenamePrefix}_${new Date().toISOString().slice(0,10)}.xlsx`);
}

// Two tabs: Box Scanner scans | Year/Season Sort scans (each has its own list, Select All, Download and Reset).
function showTeamTab(tab) {
    const ys = tab === 'ys';
    document.getElementById('teamPanelBs').style.display = ys ? 'none' : 'block';
    document.getElementById('teamPanelYs').style.display = ys ? 'block' : 'none';
    document.getElementById('teamTabBs').classList.toggle('active', !ys);
    document.getElementById('teamTabYs').classList.toggle('active', ys);
}

async function openTeamModal() {   // = Data Management (the 7th tile)
    closeAccountModal();
    showTeamTab('bs');
    // An enterprise MEMBER can look at and download their own data but not delete it (the database refuses);
    // an individual account and an admin can also Reset.
    const isMember = !!AppState.profile?.enterprise_id && AppState.profile.tier !== 'enterprise_admin';
    document.getElementById('resetTeamSelectedBtn').style.display = isMember ? 'none' : '';
    document.getElementById('resetTeamYsBtn').style.display = isMember ? 'none' : '';

    document.getElementById('teamSearchInput').value = '';
    document.getElementById('teamSearchResults').style.display = 'none';
    document.getElementById('teamSelectAllCheckbox').checked = false;
    document.getElementById('teamSelectAllCheckbox').parentElement.style.display = 'flex';
    document.getElementById('teamMemberList').style.display = 'block';
    selectedMemberIds.clear();
    expandedMemberIds.clear();
    expandedBoxKeys.clear();
    teamMemberBoxesCache.clear();

    document.getElementById('teamMemberList').innerHTML = '<p style="font-size:13px; color: var(--ak-text-light);">Loading...</p>';
    document.getElementById('teamModal').classList.add('active');

    await refreshTeamMemberStats();
    await refreshTeamYsStats();
    await setDataTitle();
    if (typeof helpAutoShowOnce === 'function') helpAutoShowOnce('dataManagement');
}

// Data Management: the window title says whose data is shown.
async function setDataTitle() {
    const ar = typeof AppLang !== 'undefined' && AppLang.get() === 'ar';
    let suffix = ar ? ' — بياناتي' : ' — my data';
    if (AppState.profile?.tier === 'enterprise_admin') {
        const { data } = await supabaseClient.from('enterprises').select('name').eq('id', AppState.profile.enterprise_id).maybeSingle();
        suffix = ' — ' + ((data && data.name) || 'Team') + (ar ? ' (جميع المستخدمين)' : ' (all users)');
    }
    const dm = APPS.find(a => a.id === 'dataManagement');
    document.getElementById('teamModalTitle').innerHTML = '<img class="title-icon" src="icons/ui-data.png" alt=""> ' + escapeHtml(appName(dm)) + escapeHtml(suffix);
}

// Scans / Year-Season queries are limited to the signed-in account's own enterprise - or, for an individual
// account (no enterprise), to rows with no enterprise.
function scopeToMyEnterprise(query) {
    const eid = AppState.profile?.enterprise_id;
    return eid ? query.eq('enterprise_id', eid) : query.is('enterprise_id', null);
}

// ---- Year/Season Sort scans (separate from Box Scanner scans) ----
let teamYsStatsCache = [];
const selectedYsMemberIds = new Set();

async function refreshTeamYsStats() {
    const el = document.getElementById('teamYsList');
    selectedYsMemberIds.clear();
    document.getElementById('teamYsSelectAll').checked = false;
    const { data, error } = await supabaseClient.rpc('team_ys_member_stats');
    if (error) { el.innerHTML = '<p style="font-size:13px;">Could not load Year/Season stats.</p>'; return; }
    teamYsStatsCache = (data || []).sort((a, b) => teamMemberDisplayName(a).localeCompare(teamMemberDisplayName(b)));
    if (teamYsStatsCache.length === 0) { el.innerHTML = '<div class="team-table-empty">No team members yet</div>'; return; }
    el.innerHTML = `
        <table class="team-table">
            <thead><tr><th></th><th>Member</th><th>Boxes closed</th><th>Qty</th><th></th></tr></thead>
            <tbody>${teamYsStatsCache.map(m => `
                <tr class="team-row">
                    <td style="width:26px;"><input type="checkbox" class="team-ys-checkbox" data-ys-member="${escapeHtml(personKey(m))}"></td>
                    <td>${personCellHtml(m)}</td>
                    <td>${m.boxes_closed}</td>
                    <td>${m.total_qty}</td>
                    <td style="width:36px;"><button class="icon-btn" data-ys-download="${escapeHtml(personKey(m))}" title="Download this member's Year/Season data">⬇</button></td>
                </tr>`).join('')}
            </tbody>
        </table>`;
}

async function fetchTeamYsScans(keys) {
    const { data, error } = await fetchScansForPeople('ys_scans',
        'id, staff_name, remark, ptl_number, season, year, brand, barcode, qty, box_barcode, box_status, scan_timestamp, scanned_at, user_id, operator_name, profiles(display_name, email)',
        keys.map(findTeamPerson).filter(Boolean));
    if (error) { alert(error.message); return null; }
    return data || [];
}

function exportYsScansToExcel(rows, filenamePrefix) {
    if (!rows || rows.length === 0) { alert('No data to download.'); return false; }
    const sheetRows = rows.map(s => ({
        'Scanned By': s.operator_name || s.profiles?.display_name || s.profiles?.email || '—',
        'Staff': s.staff_name || '',
        'Remark': s.remark || '',
        'PTL Number': s.ptl_number,
        'Season': s.season,
        'Year': s.year,
        'Brand': s.brand || '',
        'Barcode': s.barcode,
        'Qty': s.qty,
        'Box Barcode': s.box_barcode,
        'Box Status': s.box_status,
        'Scan Timestamp': s.scan_timestamp || new Date(s.scanned_at).toLocaleString()
    }));
    const ws = XLSX.utils.json_to_sheet(sheetRows);
    ws['!cols'] = [{wch:20},{wch:16},{wch:20},{wch:10},{wch:8},{wch:6},{wch:14},{wch:18},{wch:5},{wch:16},{wch:10},{wch:20}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Year-Season Scans');
    XLSX.writeFile(wb, `${filenamePrefix}_${new Date().toISOString().slice(0,10)}.xlsx`);
    return true;
}

async function downloadTeamYs(userIds, prefix) {
    const rows = await fetchTeamYsScans(userIds);
    if (rows) exportYsScansToExcel(rows, prefix);
}

async function resetSelectedTeamYs() {
    const ids = Array.from(selectedYsMemberIds);
    if (ids.length === 0) { alert('Select at least one team member first.'); return; }
    if (!confirm(`Download and then permanently delete Year/Season scan data for ${ids.length} selected member(s)?`)) return;
    const rows = await fetchTeamYsScans(ids);
    if (!rows) return;
    // Only delete once the export has actually been produced.
    if (rows.length > 0 && !exportYsScansToExcel(rows, 'team_year_season_reset')) return;
    const error = await deleteScansForPeople('ys_scans', ids.map(findTeamPerson).filter(Boolean));
    if (error) { alert(error.message); return; }
    await refreshTeamYsStats();
}

// The Data Management tile: admins get the Team & Data workspace on its Data section, others the older window.
function openDataManagement() {
    if (AppState.profile?.tier === 'enterprise_admin' && typeof openWorkspace === 'function') return openWorkspace('data');
    return openTeamModal();
}

function closeTeamModal() {
    document.getElementById('teamModal').classList.remove('active');
}

async function refreshTeamMemberStats() {
    const { data, error } = await supabaseClient.rpc('team_member_stats');
    if (error) {
        document.getElementById('teamMemberList').innerHTML = '<p style="font-size:13px;">Could not load team stats.</p>';
        return;
    }
    teamMemberStatsCache = (data || []).sort((a, b) => teamMemberDisplayName(a).localeCompare(teamMemberDisplayName(b)));
    renderTeamMemberList();
}

// Renders a nested box/item sub-table (shared by the member-expand path and
// the search-results path) inside a <tr><td colspan="..."> row.
function renderBoxTableHtml(boxes, scope, ownerId) {
    if (!boxes || boxes.length === 0) {
        return '<div class="team-table-empty">No scans</div>';
    }
    const rows = boxes.map(b => {
        const key = `${scope}:${ownerId}:${b.boxNumber}`;
        const isExpanded = expandedBoxKeys.has(key);
        const rowsHtml = [`
            <tr class="team-row">
                <td style="width:30px;"><button class="expand-btn" title="Show / hide details" data-expand-box="${key}">${isExpanded ? '−' : '+'}</button></td>
                <td><strong>${escapeHtml(b.boxNumber)}</strong></td>
                <td>${escapeHtml(b.status)}</td>
                <td>${b.items.length}</td>
                <td style="width:36px;"><button class="icon-btn" data-download-box="${key}" title="Download this box">⬇</button></td>
            </tr>
        `];
        if (isExpanded) {
            rowsHtml.push(`
                <tr class="team-row">
                    <td class="nested-cell" colspan="5">
                        <div class="nested-table-wrap">
                            <table class="team-table">
                                <thead><tr><th>Barcode</th><th>By</th><th>Time</th></tr></thead>
                                <tbody>
                                    ${b.items.map(s => `
                                        <tr class="team-row">
                                            <td>${escapeHtml(s.barcode)}</td>
                                            <td>${escapeHtml(s.operator_name || s.display_name || s.email || '')}</td>
                                            <td>${new Date(s.scanned_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </td>
                </tr>
            `);
        }
        return rowsHtml.join('');
    }).join('');

    return `
        <div class="nested-table-wrap">
            <table class="team-table">
                <thead><tr><th></th><th>Box Number</th><th>Status</th><th>Items</th><th></th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;
}

// The name cell of a people row: the name, a "labourer" tag for QR joiners, and the job(s) they scanned for.
function personCellHtml(m) {
    return escapeHtml(personName(m)) + (m.is_operator ? ' <span class="person-tag">' + escapeHtml(qlT('labourer')) + '</span>' : '') +
        (m.jobs ? '<small class="person-jobs">' + escapeHtml(m.jobs) + '</small>' : '');
}

function renderTeamMemberList() {
    const listEl = document.getElementById('teamMemberList');
    if (teamMemberStatsCache.length === 0) {
        listEl.innerHTML = '<div class="team-table-empty">No team members yet</div>';
        return;
    }

    const bodyRows = teamMemberStatsCache.map(m => {
        const isExpanded = expandedMemberIds.has(personKey(m));
        const rows = [`
            <tr class="team-row">
                <td style="width:26px;"><input type="checkbox" class="team-member-checkbox" data-member-id="${escapeHtml(personKey(m))}" ${selectedMemberIds.has(personKey(m)) ? 'checked' : ''}></td>
                <td style="width:30px;"><button class="expand-btn" title="Show / hide details" data-expand-member="${escapeHtml(personKey(m))}">${isExpanded ? '−' : '+'}</button></td>
                <td>${personCellHtml(m)}</td>
                <td>${m.boxes_closed}</td>
                <td>${m.total_qty}</td>
                <td style="width:36px;"><button class="icon-btn" data-download-member="${escapeHtml(personKey(m))}" title="Download this member's data">⬇</button></td>
            </tr>
        `];
        if (isExpanded) {
            const boxes = teamMemberBoxesCache.get(personKey(m));
            rows.push(`
                <tr class="team-row">
                    <td class="nested-cell" colspan="6">
                        <div>${boxes ? renderBoxTableHtml(boxes, 'member', personKey(m)) : '<p style="font-size:12px; color: var(--ak-text-light); padding:8px;">Loading...</p>'}</div>
                    </td>
                </tr>
            `);
        }
        return rows.join('');
    }).join('');

    listEl.innerHTML = `
        <div class="team-table-scroll">
            <table class="team-table">
                <thead>
                    <tr><th></th><th></th><th>Member</th><th>Boxes Closed</th><th>Qty Scanned</th><th></th></tr>
                </thead>
                <tbody>${bodyRows}</tbody>
            </table>
        </div>
    `;
}

async function toggleMemberExpand(userId) {
    if (expandedMemberIds.has(userId)) {
        expandedMemberIds.delete(userId);
        renderTeamMemberList();
        return;
    }
    expandedMemberIds.add(userId);
    renderTeamMemberList();

    if (!teamMemberBoxesCache.has(userId)) {
        const person = findTeamPerson(userId);
        const { data: rows, error } = person
            ? await fetchScansForPeople('scans', 'id, remark, barcode, box_number, box_status, qty, scanned_at, operator_name', [person])
            : { data: null, error: true };
        if (error) {
            teamMemberBoxesCache.set(userId, []);
        } else {
            const memberName = person ? personName(person) : '';
            const data = rows.slice().reverse().slice(0, 5000);        // newest first, like before
            const groups = new Map();
            data.forEach(s => {
                s.display_name = memberName;
                if (!groups.has(s.box_number)) groups.set(s.box_number, []);
                groups.get(s.box_number).push(s);
            });
            teamMemberBoxesCache.set(userId, Array.from(groups.entries()).map(([boxNumber, items]) => ({
                boxNumber, status: items[0].box_status, items
            })));
        }
        renderTeamMemberList();
    }
}

function toggleBoxExpand(key) {
    if (expandedBoxKeys.has(key)) expandedBoxKeys.delete(key);
    else expandedBoxKeys.add(key);

    // Both the member-expand path and the search-results path share this
    // toggle; re-render whichever one is currently on screen.
    if (document.getElementById('teamSearchResults').style.display !== 'none') {
        renderTeamSearchResults();
    } else {
        renderTeamMemberList();
    }
}

function toggleSelectAll(checked) {
    selectedMemberIds.clear();
    if (checked) teamMemberStatsCache.forEach(m => selectedMemberIds.add(personKey(m)));
    renderTeamMemberList();
}

function downloadMemberData(userId) {
    const boxes = teamMemberBoxesCache.get(userId);
    const person = findTeamPerson(userId);
    const name = person ? personName(person) : userId;
    const prefix = `team_scans_${name.replace(/[^a-z0-9]/gi, '_')}`;
    if (boxes) {
        exportScansToExcel(boxes.flatMap(b => b.items), prefix);
        return;
    }
    // Not expanded yet (nothing cached) - fetch fresh for the download.
    if (!person) return;
    fetchScansForPeople('scans', 'id, remark, barcode, box_number, box_status, qty, scanned_at, operator_name', [person])
        .then(({ data, error }) => {
            if (error) { alert(error.message); return; }
            (data || []).forEach(s => { s.display_name = name; });
            exportScansToExcel(data || [], prefix);
        });
}

function downloadBoxData(key) {
    const [scope, ownerId, boxNumber] = key.split(':');
    const items = scope === 'member'
        ? (teamMemberBoxesCache.get(ownerId) || []).find(b => b.boxNumber === boxNumber)?.items || []
        : teamSearchResultsCache.filter(s => s.box_number === boxNumber);
    exportScansToExcel(items, `box_${boxNumber.replace(/[^a-z0-9]/gi, '_')}`);
}

function runTeamSearch(term) {
    clearTimeout(teamSearchDebounceTimer);
    const trimmed = term.trim();
    if (!trimmed) {
        document.getElementById('teamSearchResults').style.display = 'none';
        document.getElementById('teamSelectAllCheckbox').parentElement.style.display = 'flex';
        document.getElementById('teamMemberList').style.display = 'block';
        return;
    }
    teamSearchDebounceTimer = setTimeout(() => executeTeamSearch(trimmed), 300);
}

async function executeTeamSearch(term) {
    const resultsEl = document.getElementById('teamSearchResults');
    document.getElementById('teamMemberList').style.display = 'none';
    document.getElementById('teamSelectAllCheckbox').parentElement.style.display = 'none';
    resultsEl.style.display = 'block';
    resultsEl.innerHTML = '<p style="font-size:13px; color: var(--ak-text-light);">Searching...</p>';

    const { data, error } = await supabaseClient.rpc('search_team_scans', { search_term: term, limit_count: 200 });
    if (error) {
        resultsEl.innerHTML = '<p style="font-size:13px;">Search failed.</p>';
        return;
    }
    teamSearchResultsCache = data || [];
    expandedBoxKeys.forEach(k => { if (k.startsWith('search:')) expandedBoxKeys.delete(k); });
    renderTeamSearchResults();
}

function renderTeamSearchResults() {
    const resultsEl = document.getElementById('teamSearchResults');
    if (teamSearchResultsCache.length === 0) {
        resultsEl.innerHTML = '<div class="team-table-empty">No matches</div>';
        return;
    }
    const groups = new Map();
    teamSearchResultsCache.forEach(s => {
        if (!groups.has(s.box_number)) groups.set(s.box_number, []);
        groups.get(s.box_number).push(s);
    });
    const boxes = Array.from(groups.entries()).map(([boxNumber, items]) => ({
        boxNumber, status: items[0].box_status, items
    }));
    resultsEl.innerHTML = renderBoxTableHtml(boxes, 'search', 'results');
}

async function fetchSelectedTeamScans() {
    const people = Array.from(selectedMemberIds).map(findTeamPerson).filter(Boolean);
    const { data, error } = await fetchScansForPeople('scans',
        'id, remark, barcode, box_number, box_status, qty, scanned_at, user_id, operator_name, profiles(display_name, email)', people);
    if (error) {
        alert(error.message);
        return null;
    }
    return data || [];
}

async function downloadSelectedTeamData() {
    if (selectedMemberIds.size === 0) {
        alert('Select at least one team member first.');
        return;
    }
    const data = await fetchSelectedTeamScans();
    if (!data) return;
    exportScansToExcel(data, 'team_scans');
}

async function resetSelectedTeamData() {
    if (selectedMemberIds.size === 0) {
        alert('Select at least one team member first.');
        return;
    }
    if (!confirm(`Download and then permanently delete scan data for ${selectedMemberIds.size} selected member(s)?`)) return;

    const data = await fetchSelectedTeamScans();
    if (!data) return;
    if (data.length > 0) exportScansToExcel(data, 'team_scans_reset');

    const error = await deleteScansForPeople('scans', Array.from(selectedMemberIds).map(findTeamPerson).filter(Boolean));
    if (error) {
        alert(error.message);
        return;
    }

    selectedMemberIds.clear();
    teamMemberBoxesCache.clear();
    expandedMemberIds.clear();
    document.getElementById('teamSelectAllCheckbox').checked = false;
    await refreshTeamMemberStats();
}

async function removeMember(memberId) {
    if (!confirm('Remove this teammate from your enterprise?')) return;
    const { error } = await supabaseClient.rpc('remove_enterprise_member', { member_user_id: memberId });
    if (error) {
        alert(error.message);
        return;
    }
    selectedMemberIds.delete(memberId);
    expandedMemberIds.delete(memberId);
    teamMemberBoxesCache.delete(memberId);
}

// ============================================
// HOME SCREEN
// ============================================
function renderAppGrid() {
    const grid = document.getElementById('appGrid');
    grid.innerHTML = '';
    
    APPS.filter(app => !app.hidden).forEach(app => {
        const tile = document.createElement('div');
        tile.className = 'app-tile';
        tile.dataset.appId = app.id;
        
        const isLocked = AppState.hasActiveSession && AppState.activeSessionApp !== app.id && app.sessionRequired;
        if (isLocked) tile.classList.add('locked');
        
        tile.innerHTML = `
            <span class="app-tile-icon">${appIconHtml(app, 'app-tile-img')}</span>
            <span class="app-tile-name">${appName(app)}</span>
            <span class="app-tile-lock">🔒</span>
        `;
        
        tile.addEventListener('click', () => { if (isLocked) return; if (app.modal) openDataManagement(); else openApp(app.id); });
        grid.appendChild(tile);
    });
    
    updateSessionBanner();
}

function updateSessionBanner() {
    const banner = document.getElementById('sessionBanner');
    banner.classList.toggle('show', AppState.hasActiveSession);
}

// ============================================
// APP NAVIGATION
// ============================================
// The title bar of an open tool, in the app language.
function setAppTitle(app) {
    document.getElementById('appTitleText').innerHTML = `${appIconHtml(app, 'title-icon')} ${appName(app)}`;
    document.getElementById('appSubtitleText').textContent = appDesc(app);
}

// Tool names follow the app language everywhere they are shown.
function refreshToolNames() {
    if (document.getElementById('homeScreen').classList.contains('active')) renderAppGrid();
    const open = APPS.find(a => a.id === AppState.currentApp);
    if (open && document.getElementById('appScreen').classList.contains('active')) setAppTitle(open);
    const bs = APPS.find(a => a.id === 'boxScanner'), ys = APPS.find(a => a.id === 'yearSegregate');
    document.getElementById('teamTabBs').textContent = '📦 ' + appName(bs);
    document.getElementById('teamTabYs').textContent = '🗂️ ' + appName(ys);
    const dm = document.getElementById('teamModalTitle');
    if (dm && document.getElementById('teamModal').classList.contains('active')) setDataTitle();
}

function openApp(appId) {
    const app = APPS.find(a => a.id === appId);
    if (!app) return;
    
    AppState.currentApp = appId;
    setAppTitle(app);
    
    document.querySelectorAll('.app-module').forEach(m => m.classList.remove('active'));
    document.getElementById(app.containerId).classList.add('active');
    
    updateBackButton();
    showScreen('appScreen');
    initializeApp(appId);
    if (typeof helpAutoShowOnce === 'function') helpAutoShowOnce(appId);
}

function updateBackButton() {
    const btn = document.getElementById('appBackBtn');
    if (AppState.operator) return;                 // a labourer's device has no Home: the back button is hidden by CSS
    const app = APPS.find(a => a.id === AppState.currentApp);
    
    if (app && app.sessionRequired && AppState.hasActiveSession) {
        btn.classList.add('disabled');
        btn.title = 'Complete or reset session to go back';
    } else {
        btn.classList.remove('disabled');
        btn.title = 'Back to Home';
    }
}

function goToHome() {
    Camera.stopAll();                              // never leave a camera running behind another screen
    const app = APPS.find(a => a.id === AppState.currentApp);
    if (AppState.operator) return;                 // a labourer stays inside the one tool of the QR link
    if (app && app.sessionRequired && AppState.hasActiveSession) return;
    
    AppState.currentApp = null;
    showScreen('homeScreen');
    renderAppGrid();
}

// ============================================
// SESSION MANAGEMENT
// ============================================
function setActiveSession(appId, active) {
    AppState.hasActiveSession = active;
    AppState.activeSessionApp = active ? appId : null;
    if (active) {
        Storage.set('active_session', appId);
    } else {
        Storage.remove('active_session');
    }
    updateBackButton();
}

function checkExistingSession() {
    const activeSession = Storage.get('active_session');
    if (activeSession) {
        AppState.hasActiveSession = true;
        AppState.activeSessionApp = activeSession;
    }
}

// ============================================
// APP INITIALIZATION
// ============================================
function initializeApp(appId) {
    switch (appId) {
        case 'boxScanner': initBoxScanner(); break;
        case 'itemBarcode': initItemBarcode(); break;
        case 'boxCode': initBoxCode(); break;
        case 'boxSegregate': initBoxSegregate(); break;
        case 'priceCheck': initPriceCheck(); break;
        case 'yearSegregate': initYearSegregate(); break;
    }
}

// EVENT LISTENERS
// ============================================
function setupEventListeners() {
    document.getElementById('googleSignInBtn').addEventListener('click', signInWithGoogle);
    document.getElementById('signOutBtn').addEventListener('click', () => { if (AppState.operator) operatorLeave(); else signOut(); });
    document.getElementById('joinBtn').addEventListener('click', operatorSubmitJoin);
    document.getElementById('joinNameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') operatorSubmitJoin(); });
    document.getElementById('joinSignOutBtn').addEventListener('click', async () => { await signOut(); const t = operatorTokenFromUrl(); if (t) operatorShowJoin(t, null); });
    document.getElementById('appBackBtn').addEventListener('click', goToHome);
    document.getElementById('goToSessionBtn').addEventListener('click', () => { if (AppState.activeSessionApp) openApp(AppState.activeSessionApp); });
    document.getElementById('closeAccountBtn').addEventListener('click', closeAccountModal);
    document.getElementById('updateBtn').addEventListener('click', onUpdateIconTap);
    document.getElementById('updateNowBtn').addEventListener('click', updateAppNow);
    document.getElementById('updateLaterBtn').addEventListener('click', () => { document.getElementById('updateModal').classList.remove('active'); });
    document.getElementById('dataHelpBtn').addEventListener('click', () => helpShow('dataManagement'));
    document.getElementById('closeTeamBtn').addEventListener('click', closeTeamModal);
    document.querySelectorAll('[data-team-tab]').forEach(t => t.addEventListener('click', () => showTeamTab(t.dataset.teamTab)));
    document.getElementById('teamYsSelectAll').addEventListener('change', (e) => {
        document.querySelectorAll('.team-ys-checkbox').forEach(cb => {
            cb.checked = e.target.checked;
            if (e.target.checked) selectedYsMemberIds.add(cb.dataset.ysMember); else selectedYsMemberIds.delete(cb.dataset.ysMember);
        });
    });

    document.getElementById('teamSearchInput').addEventListener('input', (e) => runTeamSearch(e.target.value));

    document.getElementById('teamSelectAllCheckbox').addEventListener('change', (e) => toggleSelectAll(e.target.checked));

    document.getElementById('downloadTeamSelectedBtn').addEventListener('click', downloadSelectedTeamData);
    document.getElementById('teamYsList').addEventListener('change', (e) => {
        const id = e.target.dataset.ysMember;
        if (!id) return;
        if (e.target.checked) selectedYsMemberIds.add(id); else selectedYsMemberIds.delete(id);
    });
    document.getElementById('teamYsList').addEventListener('click', (e) => {
        const id = e.target.dataset.ysDownload;
        if (id) {
            const m = teamYsStatsCache.find(x => personKey(x) === id);
            downloadTeamYs([id], 'team_year_season_' + teamMemberDisplayName(m || {}).replace(/[^a-z0-9]/gi, '_'));
        }
    });
    document.getElementById('downloadTeamYsBtn').addEventListener('click', () => {
        const ids = Array.from(selectedYsMemberIds);
        if (ids.length === 0) { alert('Select at least one team member first.'); return; }
        downloadTeamYs(ids, 'team_year_season');
    });
    document.getElementById('resetTeamYsBtn').addEventListener('click', resetSelectedTeamYs);
    document.getElementById('resetTeamSelectedBtn').addEventListener('click', resetSelectedTeamData);

    document.getElementById('teamMemberList').addEventListener('click', (e) => {
        if (e.target.matches('.team-member-checkbox')) {
            const id = e.target.dataset.memberId;
            if (e.target.checked) selectedMemberIds.add(id); else selectedMemberIds.delete(id);
            return;
        }
        const removeId = e.target.dataset.removeMember;
        if (removeId) { removeMember(removeId); return; }
        const downloadMemberId = e.target.dataset.downloadMember;
        if (downloadMemberId) { downloadMemberData(downloadMemberId); return; }
        const downloadBoxKey = e.target.dataset.downloadBox;
        if (downloadBoxKey) { downloadBoxData(downloadBoxKey); return; }
        const expandBoxKey = e.target.dataset.expandBox;
        if (expandBoxKey) { toggleBoxExpand(expandBoxKey); return; }
        const expandMemberTarget = e.target.closest('[data-expand-member]');
        if (expandMemberTarget) toggleMemberExpand(expandMemberTarget.dataset.expandMember);
    });

    document.getElementById('teamSearchResults').addEventListener('click', (e) => {
        const downloadBoxKey = e.target.dataset.downloadBox;
        if (downloadBoxKey) { downloadBoxData(downloadBoxKey); return; }
        const expandBoxKey = e.target.dataset.expandBox;
        if (expandBoxKey) toggleBoxExpand(expandBoxKey);
    });
}

// ============================================
// SERVICE WORKER
// ============================================
// Registers sw.js so every browser/tablet checks for and picks up the latest
// deployed files, with an offline fallback to the last-known-good copy.
// ============================================
// APP UPDATES
// ============================================
// An installed app (PWA) that stays in the background keeps running the page it loaded, so a new
// deploy can go unnoticed for days. Every deploy bumps the version number (the ?v= on the script tags
// and CACHE_VERSION in sw.js). The app compares the version it is running with the one on the server
// when it opens, when it comes back to the foreground and when the connection returns, and shows a
// red dot and a popup instead of reloading by itself (a reload in the middle of a scan would be worse).
function runningAppVersion() {
    const tag = document.querySelector('script[src*="js/app.js"]');
    const m = tag && tag.getAttribute('src').match(/[?&]v=(\d+)/);
    return m ? Number(m[1]) : 0;
}

async function fetchServerAppVersion() {
    const res = await fetch('sw.js?check=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const m = (await res.text()).match(/CACHE_VERSION\s*=\s*'ak-utility-v(\d+)'/);
    return m ? Number(m[1]) : 0;
}

// Returns 'newer' | 'current' | 'offline' | 'unknown'.
// 'newer' also lights the red dot on the update icon; with { popup: true } it opens the centred popup by itself
// (unless another window is open - then only the dot shows and the popup waits for a tap on the icon).
async function checkForAppUpdate(opts) {
    if (!AppState.isOnline) return 'offline';
    try {
        const server = await fetchServerAppVersion();
        const running = runningAppVersion();
        if (!server || !running) return 'unknown';
        if (server > running) {
            AppState.updatePending = server;
            document.getElementById('updateDot').hidden = false;
            if (opts && opts.popup && !document.querySelector('.modal-overlay.active')) showUpdateModal('newer');
            return 'newer';
        }
        AppState.updatePending = null;
        document.getElementById('updateDot').hidden = true;
        return 'current';
    } catch (e) {
        return 'unknown';
    }
}

// The centred update popup. state: 'checking' | 'newer' | 'current' | 'offline' | 'unknown'
function showUpdateModal(state) {
    const text = {
        checking: 'Checking for a new version…',
        newer: `A new version (v${AppState.updatePending}) is ready. Tap Update now to install it.`,
        current: 'You have the latest version.',
        offline: 'You are offline - connect to the internet to check for updates.',
        unknown: 'Could not check right now. Please try again in a moment.'
    };
    document.getElementById('appVersionDisp').textContent = 'v' + runningAppVersion();
    document.getElementById('updateModalText').textContent = text[state] || text.unknown;
    document.getElementById('updateNowBtn').style.display = state === 'newer' ? '' : 'none';
    document.getElementById('updateLaterBtn').textContent = state === 'newer' ? 'Later' : 'OK';
    document.getElementById('updateModal').classList.add('active');
}

async function onUpdateIconTap() {
    if (AppState.updatePending) { showUpdateModal('newer'); return; }
    showUpdateModal('checking');
    const result = await checkForAppUpdate();
    showUpdateModal(result);
}

// Forget the offline copy of the app files (NOT your scans or settings) and the old service worker.
async function clearAppCaches() {
    try {
        if ('serviceWorker' in navigator) {
            for (const reg of await navigator.serviceWorker.getRegistrations()) await reg.unregister();
        }
        if (window.caches) {
            for (const key of await caches.keys()) await caches.delete(key);
        }
    } catch (e) { /* reload anyway */ }
}

async function updateAppNow() {
    if (!AppState.isOnline) { alert('You are offline. Connect to the internet to update the app.'); return; }
    await clearAppCaches();
    window.location.reload();
}

let lastUpdateCheck = 0;
function scheduleUpdateChecks() {
    const run = () => { lastUpdateCheck = Date.now(); checkForAppUpdate({ popup: true }); };
    setTimeout(run, 4000);                                           // shortly after opening
    document.addEventListener('visibilitychange', () => {            // coming back to the foreground
        if (document.visibilityState === 'visible' && Date.now() - lastUpdateCheck > 5 * 60000) run();
    });
    window.addEventListener('online', () => setTimeout(run, 2000));
}

function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    // A controller already present means an earlier visit's service worker is
    // running this page. If that flips to a different one later, it's a real
    // update. On a first-ever visit there's no controller yet, so a claim
    // right after install isn't an update - don't reload for that one.
    const hadController = !!navigator.serviceWorker.controller;

    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch((err) => console.error('SW registration failed:', err));
    });

    let swRefreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController) return;
        if (swRefreshing) return;
        swRefreshing = true;
        window.location.reload();
    });
}

// ============================================
// INITIALIZATION
// ============================================
async function initApp() {
    updateOnlineStatus();
    setupEventListeners();
    if (typeof AppLang !== 'undefined') AppLang.onChange(refreshToolNames);
    refreshToolNames();
    registerServiceWorker();
    scheduleUpdateChecks();

    const { data: { session } } = await supabaseClient.auth.getSession();
    const joinToken = operatorTokenFromUrl();
    if (joinToken) {
        await operatorShowJoin(joinToken, session);
    } else if (isOperatorSession(session)) {
        await operatorEnter(session);
    } else if (session) {
        await enterAppAsSignedInUser(session);
    } else {
        showScreen('loginScreen');
    }

    window.addEventListener('online', () => refreshProfile(60000));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshProfile(60000); });

    supabaseClient.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' && session) {
            if (isOperatorSession(session)) return;        // a labourer's anonymous sign-in: js/operator.js takes it from here
            // Supabase re-fires SIGNED_IN on token refresh (e.g. when the tab
            // regains focus after being idle), not just on a genuine new login.
            // Only navigate to home for an actual new sign-in - otherwise this
            // was yanking people back to the home screen mid-task (e.g. out of
            // an open Box Scanner session) every time the tab refocused.
            if (AppState.user) {
                AppState.user = session.user;
                return;
            }
            await enterAppAsSignedInUser(session);
        } else if (event === 'SIGNED_OUT') {
            AppState.user = null;
            AppState.profile = null;
            updateHeaderUser();
            showScreen('loginScreen');
        }
    });
}

document.addEventListener('DOMContentLoaded', initApp);
