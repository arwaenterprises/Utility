// ============================================
// SCREEN NAVIGATION
// ============================================
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
    AppState.currentScreen = screenId;
}

// ============================================
// GOOGLE SHEETS API
// ============================================
// Still used by tools not yet migrated to Supabase (Item Barcode, Box Code,
// Price Check, Box Segregate, Year/Season Sort - hidden in this pilot build).
async function fetchFromGoogleSheets(action, params = {}) {
    if (!AppState.isOnline) return null;
    try {
        const url = new URL(CONFIG.GOOGLE_SCRIPT_URL);
        url.searchParams.append('action', action);
        Object.keys(params).forEach(k => url.searchParams.append(k, params[k]));
        const response = await fetch(url.toString());
        return await response.json();
    } catch (e) {
        console.error('Google Sheets fetch error:', e);
        return null;
    }
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
    await supabaseClient.auth.signOut();
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
        .select('id, invited_email, status')
        .eq('enterprise_id', AppState.profile.enterprise_id)
        .order('created_at', { ascending: false });
    if (error) {
        listEl.textContent = '';
        return;
    }
    listEl.innerHTML = data.map(inv => `
        <div style="display:flex; justify-content:space-between; align-items:center; font-size: 13px; padding: 4px 0;">
            <span>${inv.invited_email} — ${inv.status}</span>
            ${inv.status === 'pending' ? `<button class="delete-scan-btn" data-cancel-invite="${inv.id}">✕</button>` : ''}
        </div>
    `).join('') || '<div style="font-size: 13px; color: var(--ak-text-light);">No invites yet</div>';
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
// ============================================
let teamMemberStatsCache = [];       // [{user_id, display_name, email, boxes_closed, total_qty}]
const teamMemberBoxesCache = new Map(); // user_id -> [{box_number, status, items:[...]}] (lazy-loaded on expand)
const expandedMemberIds = new Set();
const selectedMemberIds = new Set();
let teamSearchDebounceTimer = null;
let teamSearchResultsCache = []; // rows from the last search_team_scans() call

function teamMemberDisplayName(m) {
    return m.display_name || m.email || '—';
}

async function openTeamModal() {
    document.getElementById('teamSearchInput').value = '';
    document.getElementById('teamSearchResults').style.display = 'none';
    document.getElementById('teamSelectAllCheckbox').checked = false;
    selectedMemberIds.clear();
    expandedMemberIds.clear();
    teamMemberBoxesCache.clear();

    document.getElementById('teamMemberList').innerHTML = '<p style="font-size:13px; color: var(--ak-text-light);">Loading...</p>';
    document.getElementById('teamModal').classList.add('active');

    await loadPendingInvitesList();
    await refreshTeamMemberStats();
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

function renderTeamMemberList() {
    const listEl = document.getElementById('teamMemberList');
    if (teamMemberStatsCache.length === 0) {
        listEl.innerHTML = '<div style="font-size: 13px; color: var(--ak-text-light);">No team members yet</div>';
        return;
    }

    listEl.innerHTML = teamMemberStatsCache.map(m => {
        const isExpanded = expandedMemberIds.has(m.user_id);
        const isSelf = m.user_id === AppState.user?.id;
        return `
            <div class="box-group-row" style="display:flex; align-items:center; gap:8px; padding:10px; border:1px solid var(--ak-gray-200); border-radius:8px; margin-bottom:6px;">
                <input type="checkbox" class="team-member-checkbox" data-member-id="${m.user_id}" ${selectedMemberIds.has(m.user_id) ? 'checked' : ''}>
                <button class="delete-scan-btn" data-expand-member="${m.user_id}" style="flex-shrink:0;">${isExpanded ? '−' : '+'}</button>
                <div style="flex:1; cursor:pointer;" data-expand-member="${m.user_id}">
                    <strong>${teamMemberDisplayName(m)}</strong>
                    <div style="font-size:12px; color: var(--ak-text-light);">${m.boxes_closed} boxes closed · ${m.total_qty} qty scanned</div>
                </div>
                ${isSelf ? '' : `<button class="delete-scan-btn" data-remove-member="${m.user_id}" title="Remove from team">✕</button>`}
            </div>
            <div class="member-detail" id="memberDetail_${m.user_id}" style="display:${isExpanded ? 'block' : 'none'}; margin: -2px 0 8px 32px;"></div>
        `;
    }).join('');

    expandedMemberIds.forEach(id => renderMemberBoxes(id));
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
        const detailEl = document.getElementById(`memberDetail_${userId}`);
        if (detailEl) detailEl.innerHTML = '<p style="font-size:12px; color: var(--ak-text-light);">Loading...</p>';

        const { data, error } = await supabaseClient
            .from('scans')
            .select('id, barcode, box_number, box_status, qty, scanned_at')
            .eq('enterprise_id', AppState.profile.enterprise_id)
            .eq('user_id', userId)
            .order('scanned_at', { ascending: false })
            .limit(5000);

        if (error) {
            teamMemberBoxesCache.set(userId, []);
        } else {
            const groups = new Map();
            (data || []).forEach(s => {
                if (!groups.has(s.box_number)) groups.set(s.box_number, []);
                groups.get(s.box_number).push(s);
            });
            teamMemberBoxesCache.set(userId, Array.from(groups.entries()).map(([boxNumber, items]) => ({
                boxNumber, status: items[0].box_status, items
            })));
        }
    }
    renderMemberBoxes(userId);
}

function renderMemberBoxes(userId) {
    const detailEl = document.getElementById(`memberDetail_${userId}`);
    if (!detailEl) return;
    const boxes = teamMemberBoxesCache.get(userId);
    if (!boxes) return; // still loading

    if (boxes.length === 0) {
        detailEl.innerHTML = '<p style="font-size:12px; color: var(--ak-text-light);">No scans yet</p>';
        return;
    }

    detailEl.innerHTML = boxes.map(b => `
        <div class="box-group-row" data-member="${userId}" data-box="${b.boxNumber}" style="display:flex; justify-content:space-between; align-items:center; padding:8px; border:1px solid var(--ak-gray-200); border-radius:6px; margin-bottom:4px; cursor:pointer; font-size:12px;">
            <span><strong>${b.boxNumber}</strong> · ${b.status}</span>
            <span>${b.items.length} items</span>
        </div>
    `).join('');
}

function toggleSelectAll(checked) {
    selectedMemberIds.clear();
    if (checked) teamMemberStatsCache.forEach(m => selectedMemberIds.add(m.user_id));
    renderTeamMemberList();
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
    if (teamSearchResultsCache.length === 0) {
        resultsEl.innerHTML = '<p style="font-size:13px; color: var(--ak-text-light);">No matches</p>';
        return;
    }
    resultsEl.innerHTML = teamSearchResultsCache.map(s => `
        <div class="box-group-row" data-search-box="${s.box_number}" style="display:flex; justify-content:space-between; align-items:center; padding:8px; border:1px solid var(--ak-gray-200); border-radius:6px; margin-bottom:4px; cursor:pointer; font-size:12px;">
            <span><strong>${s.box_number}</strong> · ${s.barcode} · ${s.display_name || s.email}</span>
            <span>${s.box_status}</span>
        </div>
    `).join('');
}

function openBoxDetail(boxNumber, items) {
    document.getElementById('boxDetailTitle').textContent = `Box ${boxNumber}`;
    document.getElementById('boxDetailTableBody').innerHTML = items.map(s => `
        <tr>
            <td>${s.barcode}</td>
            <td>${s.display_name || s.email || ''}</td>
            <td>${new Date(s.scanned_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
        </tr>
    `).join('') || '<tr><td colspan="3">No items</td></tr>';
    document.getElementById('boxDetailModal').classList.add('active');
}

function closeBoxDetailModal() {
    document.getElementById('boxDetailModal').classList.remove('active');
}

async function fetchSelectedTeamScans() {
    const ids = Array.from(selectedMemberIds);
    const { data, error } = await supabaseClient
        .from('scans')
        .select('id, barcode, box_number, box_status, qty, scanned_at, user_id, profiles(display_name, email)')
        .eq('enterprise_id', AppState.profile.enterprise_id)
        .in('user_id', ids);
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
    if (data.length === 0) {
        alert('No scans found for the selected members.');
        return;
    }

    const rows = data.map(s => ({
        'Scanned By': s.profiles?.display_name || s.profiles?.email || '—',
        'Box Number': s.box_number,
        'Barcode': s.barcode,
        'Qty': s.qty,
        'Status': s.box_status,
        'Scanned At': new Date(s.scanned_at).toLocaleString()
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{wch:20},{wch:12},{wch:20},{wch:5},{wch:8},{wch:18}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Team Scans');
    XLSX.writeFile(wb, `team_scans_${new Date().toISOString().slice(0,10)}.xlsx`);
}

async function resetSelectedTeamData() {
    if (selectedMemberIds.size === 0) {
        alert('Select at least one team member first.');
        return;
    }
    if (!confirm(`Download and then permanently delete scan data for ${selectedMemberIds.size} selected member(s)?`)) return;

    const data = await fetchSelectedTeamScans();
    if (!data) return;
    if (data.length > 0) {
        const rows = data.map(s => ({
            'Scanned By': s.profiles?.display_name || s.profiles?.email || '—',
            'Box Number': s.box_number,
            'Barcode': s.barcode,
            'Qty': s.qty,
            'Status': s.box_status,
            'Scanned At': new Date(s.scanned_at).toLocaleString()
        }));
        const ws = XLSX.utils.json_to_sheet(rows);
        ws['!cols'] = [{wch:20},{wch:12},{wch:20},{wch:5},{wch:8},{wch:18}];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Team Scans');
        XLSX.writeFile(wb, `team_scans_reset_${new Date().toISOString().slice(0,10)}.xlsx`);
    }

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
        case 'photoCapture': initPhotoCapture(); break;
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
    document.getElementById('createEnterpriseBtn').addEventListener('click', createEnterprise);
    document.getElementById('sendInviteBtn').addEventListener('click', sendInvite);
    document.getElementById('acceptInviteBtn').addEventListener('click', acceptMyInvite);
    document.getElementById('openTeamModalBtn').addEventListener('click', openTeamModal);
    document.getElementById('closeTeamBtn').addEventListener('click', closeTeamModal);
    document.getElementById('closeBoxDetailBtn').addEventListener('click', closeBoxDetailModal);
    document.getElementById('pendingInvitesList').addEventListener('click', (e) => {
        const id = e.target.dataset.cancelInvite;
        if (id) cancelInvite(id);
    });

    document.getElementById('teamSearchInput').addEventListener('input', (e) => runTeamSearch(e.target.value));

    document.getElementById('teamSelectAllCheckbox').addEventListener('change', (e) => toggleSelectAll(e.target.checked));

    document.getElementById('downloadTeamSelectedBtn').addEventListener('click', downloadSelectedTeamData);
    document.getElementById('resetTeamSelectedBtn').addEventListener('click', resetSelectedTeamData);

    document.getElementById('teamMemberList').addEventListener('click', (e) => {
        if (e.target.matches('.team-member-checkbox')) {
            const id = e.target.dataset.memberId;
            if (e.target.checked) selectedMemberIds.add(id); else selectedMemberIds.delete(id);
            return;
        }
        const removeId = e.target.dataset.removeMember;
        if (removeId) { removeMember(removeId); return; }
        const expandTarget = e.target.closest('[data-expand-member]');
        if (expandTarget) toggleMemberExpand(expandTarget.dataset.expandMember);
    });

    document.getElementById('teamMemberList').addEventListener('click', (e) => {
        const boxRow = e.target.closest('[data-member][data-box]');
        if (!boxRow) return;
        const userId = boxRow.dataset.member;
        const boxNumber = boxRow.dataset.box;
        const boxes = teamMemberBoxesCache.get(userId) || [];
        const box = boxes.find(b => b.boxNumber === boxNumber);
        if (box) openBoxDetail(boxNumber, box.items.map(i => ({ ...i, display_name: teamMemberDisplayName(teamMemberStatsCache.find(m => m.user_id === userId) || {}) })));
    });

    document.getElementById('teamSearchResults').addEventListener('click', (e) => {
        const row = e.target.closest('[data-search-box]');
        if (!row) return;
        const boxNumber = row.dataset.searchBox;
        const items = teamSearchResultsCache.filter(s => s.box_number === boxNumber);
        openBoxDetail(boxNumber, items);
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
