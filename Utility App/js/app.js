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
    document.getElementById('inviteTeammateSection').style.display = isAdmin ? 'block' : 'none';
    document.getElementById('teamMembersSection').style.display = isAdmin ? 'block' : 'none';

    if (isAdmin) {
        await loadPendingInvitesList();
        await loadTeamMembersList();
    }

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

async function loadTeamMembersList() {
    const listEl = document.getElementById('teamMembersList');
    const { data, error } = await supabaseClient
        .from('profiles')
        .select('id, display_name, email, tier')
        .eq('enterprise_id', AppState.profile.enterprise_id)
        .neq('id', AppState.user.id);
    if (error) {
        listEl.textContent = '';
        return;
    }
    listEl.innerHTML = data.map(member => `
        <div style="display:flex; justify-content:space-between; align-items:center; font-size: 13px; padding: 4px 0;">
            <span>${member.display_name || member.email}</span>
            <button class="delete-scan-btn" data-remove-member="${member.id}">✕</button>
        </div>
    `).join('') || '<div style="font-size: 13px; color: var(--ak-text-light);">No team members yet</div>';
}

async function removeMember(memberId) {
    if (!confirm('Remove this teammate from your enterprise?')) return;
    const { error } = await supabaseClient.rpc('remove_enterprise_member', { member_user_id: memberId });
    if (error) {
        alert(error.message);
        return;
    }
    await loadTeamMembersList();
}

// ============================================
// TEAM SCANS (consolidated, filterable, grouped by box)
// ============================================
let teamScansCache = [];

function scanDisplayName(s) {
    return s.profiles?.display_name || s.profiles?.email || '—';
}

async function openTeamScansModal() {
    document.getElementById('teamScansBoxList').innerHTML = '<p style="font-size:13px; color: var(--ak-text-light);">Loading...</p>';
    document.getElementById('teamScansModal').classList.add('active');

    const { data, error } = await supabaseClient
        .from('scans')
        .select('id, barcode, box_number, box_status, qty, scanned_at, user_id, profiles(display_name, email)')
        .eq('enterprise_id', AppState.profile.enterprise_id)
        .order('scanned_at', { ascending: false })
        .limit(1000);

    if (error) {
        document.getElementById('teamScansBoxList').innerHTML = '<p style="font-size:13px;">Could not load team scans.</p>';
        return;
    }

    teamScansCache = data || [];
    renderTeamScansMemberFilterOptions();
    applyTeamScansFilters();
}

function closeTeamScansModal() {
    document.getElementById('teamScansModal').classList.remove('active');
}

function renderTeamScansMemberFilterOptions() {
    const select = document.getElementById('teamScansMemberFilter');
    const seen = new Map();
    teamScansCache.forEach(s => { if (!seen.has(s.user_id)) seen.set(s.user_id, scanDisplayName(s)); });
    const current = select.value;
    select.innerHTML = '<option value="">All members</option>' +
        Array.from(seen.entries()).map(([id, name]) => `<option value="${id}">${name}</option>`).join('');
    select.value = current;
}

function applyTeamScansFilters() {
    const memberFilter = document.getElementById('teamScansMemberFilter').value;
    const statusFilter = document.getElementById('teamScansStatusFilter').value;

    const filtered = teamScansCache.filter(s =>
        (!memberFilter || s.user_id === memberFilter) &&
        (!statusFilter || s.box_status === statusFilter)
    );

    renderTeamScansSummary(filtered);
    renderTeamScansBoxList(filtered);
}

function renderTeamScansSummary(scans) {
    const boxNumbers = new Set(scans.map(s => s.box_number));
    const perMember = new Map();
    scans.forEach(s => {
        const name = scanDisplayName(s);
        perMember.set(name, (perMember.get(name) || 0) + 1);
    });

    const memberBreakdown = Array.from(perMember.entries())
        .map(([name, count]) => `${name}: ${count}`)
        .join(' · ');

    document.getElementById('teamScansSummary').innerHTML = `
        <div class="stat-box">
            <div class="stat-label">Items</div>
            <div class="stat-number">${scans.length}</div>
        </div>
        <div class="stat-box">
            <div class="stat-label">Boxes</div>
            <div class="stat-number">${boxNumbers.size}</div>
        </div>
    ` + (memberBreakdown ? `<p style="width:100%; font-size:12px; color: var(--ak-text-light); margin-top: 6px;">${memberBreakdown}</p>` : '');
}

function renderTeamScansBoxList(scans) {
    const listEl = document.getElementById('teamScansBoxList');
    const groups = new Map();
    scans.forEach(s => {
        if (!groups.has(s.box_number)) groups.set(s.box_number, []);
        groups.get(s.box_number).push(s);
    });

    if (groups.size === 0) {
        listEl.innerHTML = '<p style="font-size:13px; color: var(--ak-text-light);">No scans match this filter</p>';
        return;
    }

    listEl.innerHTML = Array.from(groups.entries()).map(([boxNumber, items]) => {
        const names = new Set(items.map(scanDisplayName));
        const scannedBy = names.size === 1 ? Array.from(names)[0] : `${names.size} people`;
        const status = items[0].box_status;
        return `
            <div class="box-group-row" data-box="${boxNumber}" style="display:flex; justify-content:space-between; align-items:center; padding:10px; border:1px solid var(--ak-gray-200); border-radius:8px; margin-bottom:6px; cursor:pointer;">
                <div>
                    <strong>${boxNumber}</strong>
                    <div style="font-size:12px; color: var(--ak-text-light);">${scannedBy} · ${status}</div>
                </div>
                <div style="text-align:right;">
                    <div style="font-weight:600;">${items.length} items</div>
                    <div style="font-size:11px; color: var(--ak-text-light);">tap for detail</div>
                </div>
            </div>
        `;
    }).join('');
}

function openBoxDetail(boxNumber) {
    const memberFilter = document.getElementById('teamScansMemberFilter').value;
    const statusFilter = document.getElementById('teamScansStatusFilter').value;
    const items = teamScansCache.filter(s =>
        s.box_number === boxNumber &&
        (!memberFilter || s.user_id === memberFilter) &&
        (!statusFilter || s.box_status === statusFilter)
    );

    document.getElementById('boxDetailTitle').textContent = `Box ${boxNumber}`;
    document.getElementById('boxDetailTableBody').innerHTML = items.map(s => `
        <tr>
            <td>${s.barcode}</td>
            <td>${scanDisplayName(s)}</td>
            <td>${new Date(s.scanned_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
        </tr>
    `).join('') || '<tr><td colspan="3">No items</td></tr>';
    document.getElementById('boxDetailModal').classList.add('active');
}

function closeBoxDetailModal() {
    document.getElementById('boxDetailModal').classList.remove('active');
}

function downloadTeamScans() {
    const memberFilter = document.getElementById('teamScansMemberFilter').value;
    const statusFilter = document.getElementById('teamScansStatusFilter').value;
    const filtered = teamScansCache.filter(s =>
        (!memberFilter || s.user_id === memberFilter) &&
        (!statusFilter || s.box_status === statusFilter)
    );

    if (filtered.length === 0) {
        alert('No scans match the current filter.');
        return;
    }

    const rows = filtered.map(s => ({
        'Scanned By': scanDisplayName(s),
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
    document.getElementById('viewTeamScansBtn').addEventListener('click', openTeamScansModal);
    document.getElementById('closeTeamScansBtn').addEventListener('click', closeTeamScansModal);
    document.getElementById('teamScansMemberFilter').addEventListener('change', applyTeamScansFilters);
    document.getElementById('teamScansStatusFilter').addEventListener('change', applyTeamScansFilters);
    document.getElementById('downloadTeamScansBtn').addEventListener('click', downloadTeamScans);
    document.getElementById('teamScansBoxList').addEventListener('click', (e) => {
        const row = e.target.closest('.box-group-row');
        if (row) openBoxDetail(row.dataset.box);
    });
    document.getElementById('closeBoxDetailBtn').addEventListener('click', closeBoxDetailModal);
    document.getElementById('pendingInvitesList').addEventListener('click', (e) => {
        const id = e.target.dataset.cancelInvite;
        if (id) cancelInvite(id);
    });
    document.getElementById('teamMembersList').addEventListener('click', (e) => {
        const id = e.target.dataset.removeMember;
        if (id) removeMember(id);
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
