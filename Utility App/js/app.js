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

async function signOut(options) {
    await supabaseClient.auth.signOut(options);
    AppState.user = null;
    AppState.profile = null;
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

async function enterAppAsSignedInUser(session) {
    AppState.user = session.user;
    await loadUserProfile();
    updateHeaderUser();
    checkExistingSession();
    await checkForMyPendingInvite();
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
    const accountBtn = document.getElementById('accountBtn');
    if (AppState.user) {
        el.textContent = AppState.profile?.display_name || AppState.user.email;
        el.classList.add('show');
        signOutBtn.classList.add('show');
        accountBtn.classList.add('show');
    } else {
        el.classList.remove('show');
        signOutBtn.classList.remove('show');
        accountBtn.classList.remove('show');
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
    document.getElementById('accountEmailDisp').textContent = AppState.user?.email || '';
    document.getElementById('accountTierDisp').textContent = tierDisplayText(AppState.profile);

    const isIndividual = AppState.profile?.tier === 'individual';
    const isAdmin = AppState.profile?.tier === 'enterprise_admin';
    document.getElementById('createEnterpriseSection').style.display = isIndividual ? 'block' : 'none';
    document.getElementById('manageTeamSection').style.display = isAdmin ? 'block' : 'none';

    document.getElementById('accountModal').classList.add('active');
}

function closeAccountModal() {
    document.getElementById('accountModal').classList.remove('active');
}

// ============================================
// DELETE MY ACCOUNT
// ============================================
// The server (delete_my_account() in supabase/schema.sql) deletes the account and its data and decides
// what is allowed (an enterprise admin with team members is refused, with a clear message). Here we
// explain it, ask for a typed confirmation, and afterwards wipe everything stored on this device.
function deleteAccountExplanation() {
    const p = AppState.profile || {};
    let text = 'This permanently deletes your account and your data: scans, uploaded lists and usage history. It cannot be undone. Download anything you need first (Box Scanner → Download).';
    if (p.tier === 'enterprise_member') {
        text += ' Scans you made for your enterprise are business records: they stay with the enterprise (your admin keeps them). Everything else is deleted.';
    } else if (p.tier === 'enterprise_admin') {
        text += ' You are the enterprise admin: this works only when no other members are left (remove them in Team first). The enterprise and all its data are deleted with your account.';
    }
    return text;
}

function openDeleteAccount() {
    closeAccountModal();
    document.getElementById('deleteAccountText').textContent = deleteAccountExplanation();
    document.getElementById('deleteAccountConfirmInput').value = '';
    document.getElementById('deleteAccountConfirmBtn').disabled = true;
    document.getElementById('deleteAccountModal').classList.add('active');
    setTimeout(() => document.getElementById('deleteAccountConfirmInput').focus(), 100);
}

function closeDeleteAccount() {
    document.getElementById('deleteAccountModal').classList.remove('active');
}

// Removes this user's data from the device: offline databases and saved settings.
async function wipeLocalDataForUser(userId) {
    try { if (typeof scannerDB !== 'undefined' && scannerDB) { scannerDB.close(); scannerDB = null; } } catch (e) {}
    try { if (typeof refDB !== 'undefined' && refDB) { refDB.close(); refDB = null; } } catch (e) {}
    try { if (typeof pcDb !== 'undefined' && pcDb) { pcDb.close(); pcDb = null; } } catch (e) {}
    try { if (typeof ysDB !== 'undefined' && ysDB) { ysDB.close(); ysDB = null; } } catch (e) {}
    for (const name of ['AKBoxScannerDB_', 'AKRef_', 'AKPriceCheckDB_', 'AKYSSegregateDB_']) {
        try { indexedDB.deleteDatabase(name + userId); } catch (e) {}
    }
    try {
        Object.keys(localStorage).filter(k => k.startsWith(CONFIG.STORAGE_PREFIX)).forEach(k => localStorage.removeItem(k));
    } catch (e) {}
}

async function confirmDeleteAccount() {
    if (document.getElementById('deleteAccountConfirmInput').value.trim() !== 'DELETE') return;
    const btn = document.getElementById('deleteAccountConfirmBtn');
    btn.disabled = true;
    if (!AppState.isOnline) { alert('You are offline. Connect to the internet to delete your account.'); btn.disabled = false; return; }
    const userId = AppState.user.id;
    const { error } = await supabaseClient.rpc('delete_my_account');
    if (error) {
        alert(error.message);                       // e.g. "You are the enterprise admin and your team still has 3 member(s)..."
        btn.disabled = false;
        return;
    }
    closeDeleteAccount();
    await wipeLocalDataForUser(userId);
    await signOut({ scope: 'local' });             // the account no longer exists on the server: just clear this device's session
    alert('Your account and data have been deleted.');
}

async function createEnterprise() {
    const name = document.getElementById('enterpriseNameInput').value.trim();
    if (!name) return;
    const { error } = await supabaseClient.rpc('create_enterprise', { enterprise_name: name });
    if (error) {
        alert(error.message);
        return;
    }
    await loadUserProfile();
    updateHeaderUser();
    document.getElementById('enterpriseNameInput').value = '';
    await openAccountModal();
}

async function sendInvite() {
    const email = document.getElementById('inviteEmailInput').value.trim();
    if (!email) return;
    const { error } = await supabaseClient.from('enterprise_invites').insert({
        enterprise_id: AppState.profile.enterprise_id,
        invited_email: email,
        invited_by: AppState.user.id
    });
    if (error) {
        alert(error.message);
        return;
    }
    document.getElementById('inviteEmailInput').value = '';
    await loadPendingInvitesList();
}

async function loadPendingInvitesList() {
    const listEl = document.getElementById('pendingInvitesList');
    const { data, error } = await supabaseClient
        .from('enterprise_invites')
        .select('id, invited_email, status, expires_at')
        .eq('enterprise_id', AppState.profile.enterprise_id)
        .order('created_at', { ascending: false });
    if (error) {
        listEl.textContent = '';
        return;
    }
    // The database refuses an expired invite, but it keeps the row as 'pending'; show
    // it as expired and let the admin re-send (a fresh 7-day invite) or remove it.
    listEl.innerHTML = data.map(inv => {
        const expired = inv.status === 'pending' && new Date(inv.expires_at) < new Date();
        const label = expired ? 'expired' : inv.status;
        const actions = inv.status !== 'pending' ? '' :
            (expired ? `<button class="icon-btn" data-resend-invite="${inv.id}" data-email="${escapeHtml(inv.invited_email)}" title="Send a new invite">↻</button>` : '') +
            `<button class="delete-scan-btn" data-cancel-invite="${inv.id}" title="Remove invite">✕</button>`;
        return `
        <div style="display:flex; justify-content:space-between; align-items:center; font-size: 13px; padding: 4px 0;${expired ? ' color: var(--ak-text-light);' : ''}">
            <span>${escapeHtml(inv.invited_email)} — ${label}</span>
            <span style="display:flex; gap:6px;">${actions}</span>
        </div>`;
    }).join('') || '<div style="font-size: 13px; color: var(--ak-text-light);">No invites yet</div>';
}

async function resendInvite(inviteId, email) {
    const del = await supabaseClient.from('enterprise_invites').delete().eq('id', inviteId);
    if (del.error) { alert(del.error.message); return; }
    const { error } = await supabaseClient.from('enterprise_invites').insert({
        enterprise_id: AppState.profile.enterprise_id,
        invited_email: email,
        invited_by: AppState.user.id
    });
    if (error) { alert(error.message); return; }
    await loadPendingInvitesList();
}

async function cancelInvite(inviteId) {
    const { error } = await supabaseClient.from('enterprise_invites').delete().eq('id', inviteId);
    if (error) {
        alert(error.message);
        return;
    }
    await loadPendingInvitesList();
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
        'Scanned By': s.display_name || s.email || s.profiles?.display_name || s.profiles?.email || '—',
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

async function openTeamModal() {
    closeAccountModal();

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

    await loadPendingInvitesList();
    await refreshTeamMemberStats();
    await refreshTeamYsStats();
    await refreshTeamTitle();
}

// Title shows the enterprise name and how many people are in it (admin included).
async function refreshTeamTitle() {
    const { data } = await supabaseClient.from('enterprises').select('name').eq('id', AppState.profile.enterprise_id).maybeSingle();
    const n = teamMemberStatsCache.length;
    document.getElementById('teamModalTitle').textContent =
        '👥 ' + ((data && data.name) || 'Team') + (n ? ` (${n} member${n === 1 ? '' : 's'})` : '');
}

async function renameEnterprise() {
    const { data } = await supabaseClient.from('enterprises').select('name').eq('id', AppState.profile.enterprise_id).maybeSingle();
    const name = prompt('Enterprise name:', (data && data.name) || '');
    if (name === null) return;
    if (!name.trim()) { alert('Name cannot be empty.'); return; }
    const { error } = await supabaseClient.rpc('rename_enterprise', { new_name: name });
    if (error) { alert(error.message); return; }
    await refreshTeamTitle();
}

// ---- Year/Season Sort scans (separate from Box Scanner scans) ----
let teamYsStatsCache = [];
const selectedYsMemberIds = new Set();

async function refreshTeamYsStats() {
    const el = document.getElementById('teamYsList');
    selectedYsMemberIds.clear();
    const { data, error } = await supabaseClient.rpc('team_ys_member_stats');
    if (error) { el.innerHTML = '<p style="font-size:13px;">Could not load Year/Season stats.</p>'; return; }
    teamYsStatsCache = (data || []).sort((a, b) => teamMemberDisplayName(a).localeCompare(teamMemberDisplayName(b)));
    if (teamYsStatsCache.length === 0) { el.innerHTML = '<div class="team-table-empty">No team members yet</div>'; return; }
    el.innerHTML = `
        <table class="team-table">
            <thead><tr><th></th><th>Member</th><th>Boxes closed</th><th>Qty</th><th></th></tr></thead>
            <tbody>${teamYsStatsCache.map(m => `
                <tr class="team-row">
                    <td style="width:26px;"><input type="checkbox" class="team-ys-checkbox" data-ys-member="${m.user_id}"></td>
                    <td>${escapeHtml(teamMemberDisplayName(m))}</td>
                    <td>${m.boxes_closed}</td>
                    <td>${m.total_qty}</td>
                    <td style="width:36px;"><button class="icon-btn" data-ys-download="${m.user_id}" title="Download this member's Year/Season data">⬇</button></td>
                </tr>`).join('')}
            </tbody>
        </table>`;
}

async function fetchTeamYsScans(userIds) {
    const { data, error } = await fetchAllPages((from, to) => supabaseClient
        .from('ys_scans')
        .select('id, staff_name, remark, ptl_number, season, year, brand, barcode, qty, box_barcode, box_status, scan_timestamp, scanned_at, user_id, profiles(display_name, email)')
        .eq('enterprise_id', AppState.profile.enterprise_id)
        .in('user_id', userIds)
        .order('scanned_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to));
    if (error) { alert(error.message); return null; }
    return data || [];
}

function exportYsScansToExcel(rows, filenamePrefix) {
    if (!rows || rows.length === 0) { alert('No data to download.'); return false; }
    const sheetRows = rows.map(s => ({
        'Scanned By': s.profiles?.display_name || s.profiles?.email || '—',
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
    const { error } = await supabaseClient.from('ys_scans').delete()
        .eq('enterprise_id', AppState.profile.enterprise_id).in('user_id', ids);
    if (error) { alert(error.message); return; }
    await refreshTeamYsStats();
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
                <td style="width:30px;"><button class="expand-btn" data-expand-box="${key}">${isExpanded ? '−' : '+'}</button></td>
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
                                            <td>${escapeHtml(s.display_name || s.email || '')}</td>
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

function renderTeamMemberList() {
    const listEl = document.getElementById('teamMemberList');
    if (teamMemberStatsCache.length === 0) {
        listEl.innerHTML = '<div class="team-table-empty">No team members yet</div>';
        return;
    }

    const bodyRows = teamMemberStatsCache.map(m => {
        const isExpanded = expandedMemberIds.has(m.user_id);
        const isSelf = m.user_id === AppState.user?.id;
        const rows = [`
            <tr class="team-row">
                <td style="width:26px;"><input type="checkbox" class="team-member-checkbox" data-member-id="${m.user_id}" ${selectedMemberIds.has(m.user_id) ? 'checked' : ''}></td>
                <td style="width:30px;"><button class="expand-btn" data-expand-member="${m.user_id}">${isExpanded ? '−' : '+'}</button></td>
                <td>${escapeHtml(teamMemberDisplayName(m))}</td>
                <td>${m.boxes_closed}</td>
                <td>${m.total_qty}</td>
                <td style="width:36px;"><button class="icon-btn" data-download-member="${m.user_id}" title="Download this member's data">⬇</button></td>
                <td style="width:36px;">${isSelf ? '' : `<button class="icon-btn icon-btn-danger" data-remove-member="${m.user_id}" title="Remove from team">✕</button>`}</td>
            </tr>
        `];
        if (isExpanded) {
            const boxes = teamMemberBoxesCache.get(m.user_id);
            rows.push(`
                <tr class="team-row">
                    <td class="nested-cell" colspan="7">
                        <div id="memberBoxes_${m.user_id}">${boxes ? renderBoxTableHtml(boxes, 'member', m.user_id) : '<p style="font-size:12px; color: var(--ak-text-light); padding:8px;">Loading...</p>'}</div>
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
                    <tr><th></th><th></th><th>Member</th><th>Boxes Closed</th><th>Qty Scanned</th><th></th><th></th></tr>
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
        const { data, error } = await supabaseClient
            .from('scans')
            .select('id, remark, barcode, box_number, box_status, qty, scanned_at')
            .eq('enterprise_id', AppState.profile.enterprise_id)
            .eq('user_id', userId)
            .order('scanned_at', { ascending: false })
            .limit(5000);

        if (error) {
            teamMemberBoxesCache.set(userId, []);
        } else {
            const member = teamMemberStatsCache.find(m => m.user_id === userId);
            const memberName = member ? teamMemberDisplayName(member) : '';
            const groups = new Map();
            (data || []).forEach(s => {
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
    if (checked) teamMemberStatsCache.forEach(m => selectedMemberIds.add(m.user_id));
    renderTeamMemberList();
}

function downloadMemberData(userId) {
    const boxes = teamMemberBoxesCache.get(userId);
    const member = teamMemberStatsCache.find(m => m.user_id === userId);
    const name = member ? teamMemberDisplayName(member) : userId;
    if (boxes) {
        exportScansToExcel(boxes.flatMap(b => b.items), `team_scans_${name.replace(/[^a-z0-9]/gi, '_')}`);
        return;
    }
    // Not expanded yet (nothing cached) - fetch fresh for the download.
    fetchAllPages((from, to) => supabaseClient
        .from('scans')
        .select('id, remark, barcode, box_number, box_status, qty, scanned_at')
        .eq('enterprise_id', AppState.profile.enterprise_id)
        .eq('user_id', userId)
        .order('scanned_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to))
        .then(({ data, error }) => {
            if (error) { alert(error.message); return; }
            (data || []).forEach(s => { s.display_name = name; });
            exportScansToExcel(data || [], `team_scans_${name.replace(/[^a-z0-9]/gi, '_')}`);
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
    const ids = Array.from(selectedMemberIds);
    const { data, error } = await fetchAllPages((from, to) => supabaseClient
        .from('scans')
        .select('id, remark, barcode, box_number, box_status, qty, scanned_at, user_id, profiles(display_name, email)')
        .eq('enterprise_id', AppState.profile.enterprise_id)
        .in('user_id', ids)
        .order('scanned_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to));
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

    const ids = Array.from(selectedMemberIds);
    const { error } = await supabaseClient
        .from('scans')
        .delete()
        .eq('enterprise_id', AppState.profile.enterprise_id)
        .in('user_id', ids);
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
    await refreshTeamMemberStats();
}

async function checkForMyPendingInvite() {
    if (AppState.profile?.tier !== 'individual') return;
    const { data, error } = await supabaseClient
        .from('enterprise_invites')
        .select('token')
        .eq('status', 'pending')
        .ilike('invited_email', AppState.user.email)
        .limit(1)
        .maybeSingle();
    if (error || !data) return;
    AppState.pendingInviteToken = data.token;
    document.getElementById('inviteBanner').style.display = 'flex';
}

async function acceptMyInvite() {
    if (!AppState.pendingInviteToken) return;
    const { error } = await supabaseClient.rpc('accept_enterprise_invite', { invite_token: AppState.pendingInviteToken });
    if (error) {
        alert(error.message);
        return;
    }
    AppState.pendingInviteToken = null;
    document.getElementById('inviteBanner').style.display = 'none';
    await loadUserProfile();
    updateHeaderUser();
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
            <span class="app-tile-icon">${app.icon}</span>
            <span class="app-tile-name">${app.name}</span>
            <span class="app-tile-lock">🔒</span>
        `;
        
        tile.addEventListener('click', () => { if (!isLocked) openApp(app.id); });
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
function openApp(appId) {
    const app = APPS.find(a => a.id === appId);
    if (!app) return;
    
    AppState.currentApp = appId;
    document.getElementById('appTitleText').innerHTML = `${app.icon} ${app.name}`;
    document.getElementById('appSubtitleText').textContent = app.description;
    
    document.querySelectorAll('.app-module').forEach(m => m.classList.remove('active'));
    document.getElementById(app.containerId).classList.add('active');
    
    updateBackButton();
    showScreen('appScreen');
    initializeApp(appId);
}

function updateBackButton() {
    const btn = document.getElementById('appBackBtn');
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
    const app = APPS.find(a => a.id === AppState.currentApp);
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
    document.getElementById('signOutBtn').addEventListener('click', signOut);
    document.getElementById('appBackBtn').addEventListener('click', goToHome);
    document.getElementById('goToSessionBtn').addEventListener('click', () => { if (AppState.activeSessionApp) openApp(AppState.activeSessionApp); });
    document.getElementById('accountBtn').addEventListener('click', openAccountModal);
    document.getElementById('closeAccountBtn').addEventListener('click', closeAccountModal);
    document.getElementById('openDeleteAccountBtn').addEventListener('click', openDeleteAccount);
    document.getElementById('deleteAccountCancelBtn').addEventListener('click', closeDeleteAccount);
    document.getElementById('deleteAccountConfirmBtn').addEventListener('click', confirmDeleteAccount);
    document.getElementById('deleteAccountConfirmInput').addEventListener('input', (e) => {
        document.getElementById('deleteAccountConfirmBtn').disabled = e.target.value.trim() !== 'DELETE';
    });
    document.getElementById('createEnterpriseBtn').addEventListener('click', createEnterprise);
    document.getElementById('sendInviteBtn').addEventListener('click', sendInvite);
    document.getElementById('acceptInviteBtn').addEventListener('click', acceptMyInvite);
    document.getElementById('openTeamModalBtn').addEventListener('click', openTeamModal);
    document.getElementById('closeTeamBtn').addEventListener('click', closeTeamModal);
    document.getElementById('pendingInvitesList').addEventListener('click', (e) => {
        const id = e.target.dataset.cancelInvite;
        if (id) cancelInvite(id);
        const resendId = e.target.dataset.resendInvite;
        if (resendId) resendInvite(resendId, e.target.dataset.email);
    });

    document.getElementById('teamSearchInput').addEventListener('input', (e) => runTeamSearch(e.target.value));

    document.getElementById('teamSelectAllCheckbox').addEventListener('change', (e) => toggleSelectAll(e.target.checked));

    document.getElementById('downloadTeamSelectedBtn').addEventListener('click', downloadSelectedTeamData);
    document.getElementById('renameEnterpriseBtn').addEventListener('click', renameEnterprise);
    document.getElementById('teamYsList').addEventListener('change', (e) => {
        const id = e.target.dataset.ysMember;
        if (!id) return;
        if (e.target.checked) selectedYsMemberIds.add(id); else selectedYsMemberIds.delete(id);
    });
    document.getElementById('teamYsList').addEventListener('click', (e) => {
        const id = e.target.dataset.ysDownload;
        if (id) {
            const m = teamYsStatsCache.find(x => x.user_id === id);
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
    registerServiceWorker();

    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
        await enterAppAsSignedInUser(session);
    } else {
        showScreen('loginScreen');
    }

    supabaseClient.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' && session) {
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
