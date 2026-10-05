// In-memory Supabase mock injected before the app scripts.
window.__db = { reference_chunks: [], ys_scans: [], scans: [], enterprises: [{ id: 'E1', name: 'Acme' }], usage_daily: [] };
window.__me = { id: 'u1', enterprise_id: null, tier: 'individual', email: 'a@b.c' };
window.__rpcCalls = [];
(function () {
  const db = window.__db;
  const owned = (r) => window.__me.enterprise_id ? r.enterprise_id === window.__me.enterprise_id : (r.enterprise_id == null && r.user_id === window.__me.id);
  function builder(table) {
    const st = { filters: [], order: [], range: null, op: 'select', rows: null, conflict: null };
    const b = {
      select() { return b; },
      eq(c, v) { st.filters.push(r => r[c] === v); return b; },
      ilike(c, v) { st.filters.push(r => String(r[c] == null ? '' : r[c]).toLowerCase() === String(v).toLowerCase()); return b; },
      is(c, v) { st.filters.push(r => (r[c] == null) === (v === null)); return b; },
      in(c, vs) { st.filters.push(r => vs.includes(r[c])); return b; },
      order(c, o) { st.order.push([c, !(o && o.ascending === false)]); return b; },
      range(f, t) { st.range = [f, t]; return b; },
      limit(n) { st.range = [0, n - 1]; return b; },
      upsert(rows, o) { st.op = 'upsert'; st.rows = rows; st.conflict = o && o.onConflict; return b; },
      delete() { st.op = 'delete'; return b; },
      maybeSingle() { st.single = true; return b; },
      single() { st.single = true; return b; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); }
    };
    function run() {
      let t = db[table];
      if (window.__fail && (st.op === 'upsert' || st.op === 'insert' || st.op === 'delete')) return { data: null, error: { message: 'network down (test)' } };
      if (table === 'profiles') return { data: { id: window.__me.id, display_name: 'Ann', email: window.__me.email, tier: window.__me.tier, enterprise_id: window.__me.enterprise_id }, error: null };
      // Same rule as the real database (scans_insert_own / ys_scans_insert_own): a scan may carry no team,
      // or the team the account belongs to RIGHT NOW. Only enforced when a test sets __enforceTeamRule.
      if (st.op === 'upsert' && window.__enforceTeamRule && (table === 'scans' || table === 'ys_scans')
          && st.rows.some(r => r.enterprise_id && r.enterprise_id !== window.__me.enterprise_id)) {
        window.__rlsRejects = (window.__rlsRejects || 0) + 1;
        return { data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "' + table + '"' } };
      }
      if (st.op === 'upsert') {
        for (const r of st.rows) {
          const i = t.findIndex(x => x[st.conflict] === r[st.conflict]);
          if (i >= 0) t[i] = { ...t[i], ...r }; else t.push({ id: 'id' + Math.random(), ...r });
        }
        return { data: null, error: null };
      }
      let rows = t.filter(r => st.filters.every(f => f(r)));
      // RLS emulation for reference_chunks: only the active list of your own account
      if (table === 'reference_chunks') rows = rows.filter(r => r.is_active && owned(r));
      if (st.op === 'delete') { db[table] = t.filter(r => !rows.includes(r)); return { data: null, error: null }; }
      st.order.slice().reverse().forEach(([c, asc]) => rows.sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1)));
      if (st.range) rows = rows.slice(st.range[0], st.range[1] + 1);
      if (st.single) return { data: rows[0] || null, error: null };
      return { data: rows.map(r => ({ ...r, profiles: { display_name: 'Ann', email: 'a@b.c' } })), error: null };
    }
    return b;
  }
  const rpcs = {
    // ---- Team QR links (labourers) ----
    get_team_link_info: ({ p_token }) => {
      const l = window.__teamLink;
      return l && l.token === p_token ? [{ enterprise_name: 'Acme', admin_name: 'Akhtar', tool: l.tool, job_name: l.job_name, state: l.state }] : [];
    },
    join_team_link: ({ p_token, p_name }) => {
      const l = window.__teamLink;
      if (!l || l.token !== p_token) throw { message: 'This QR code is not valid.' };
      if (l.state !== 'active') throw { message: 'This job has ended.' };
      const s = JSON.parse(localStorage.getItem('mock_session') || 'null');
      if (!s || !s.user.is_anonymous) throw { message: 'Only a labourer who scanned a team QR code can join.' };
      window.__joined = { user: s.user.id, name: p_name };
      localStorage.setItem('mock_operator', JSON.stringify({ name: p_name.trim(), link: l.id }));
      return { operator_id: 'op1', link_id: l.id, enterprise_id: 'E1', tool: l.tool, job_name: l.job_name, name: p_name.trim() };
    },
    my_team_link: () => {
      const l = window.__teamLink, o = JSON.parse(localStorage.getItem('mock_operator') || 'null');
      return l && o ? [{ link_id: l.id, tool: l.tool, job_name: l.job_name, enterprise_name: 'Acme', admin_name: 'Akhtar', operator_name: o.name, state: l.state }] : [];
    },
    list_team_links: () => (window.__links = window.__links || []).map(l => ({ ...l, operators: l.operators || 0 })),
    create_team_link: ({ p_tool, p_job }) => {
      if (!p_job || !p_job.trim()) throw { message: 'Please type a job name (1 to 60 characters).' };
      window.__links = window.__links || [];
      // same tool AND same job name (ignoring capitals / end spaces) replaces that link; other jobs stay active
      window.__links.forEach(l => { if (l.tool === p_tool && l.state === 'active' && l.job_name.trim().toLowerCase() === p_job.trim().toLowerCase()) l.state = 'stopped'; });
      const l = { id: 'L' + (window.__links.length + 1), token: 'f'.repeat(31) + (window.__links.length + 1), tool: p_tool, job_name: p_job.trim(), state: 'active', operators: 0 };
      window.__links.push(l);
      return { id: l.id, token: l.token, tool: l.tool, job_name: l.job_name };
    },
    stop_team_link: ({ p_link_id }) => { (window.__links || []).forEach(l => { if (l.id === p_link_id) l.state = 'stopped'; }); },
    list_team_operators: () => (window.__labourers = window.__labourers || []).map(o => ({ ...o })),
    rename_team_operator: ({ p_operator_id, p_name }) => { window.__labourers.forEach(o => { if (o.id === p_operator_id) o.name = p_name; }); },
    remove_team_operator: ({ p_operator_id }) => { window.__labourers.forEach(o => { if (o.id === p_operator_id) o.removed_at = new Date().toISOString(); }); },
    ensure_own_team: () => { window.__me.tier = 'enterprise_admin'; window.__me.enterprise_id = 'E1'; return 'E1'; },
    leave_team_link: () => { window.__left = true; localStorage.removeItem('mock_operator'); },
    remove_enterprise_member: ({ member_user_id }) => { window.__removedMember = member_user_id; return true; },
    begin_list_upload: ({ p_list_type }) => { db.reference_chunks = db.reference_chunks.filter(r => !(r.list_type === p_list_type && !r.is_active && owned(r))); },
    append_list_chunk: ({ p_list_type, p_seq, p_rows }) => {
      if (window.__failSeq === p_seq) throw { message: 'chunk failed (test)' };
      if (p_rows.length > 5000) throw { message: 'chunk too large' };
      db.reference_chunks.push({ id: 'c' + Math.random(), list_type: p_list_type, user_id: window.__me.id, enterprise_id: window.__me.enterprise_id, seq: p_seq, row_count: p_rows.length, rows: p_rows, is_active: false, uploaded_at: new Date().toISOString() });
    },
    append_list_chunk_compact: ({ p_list_type, p_seq, p_keys, p_rows }) => {
      if (window.__noCompact) throw { code: 'PGRST202', message: 'Could not find the function public.append_list_chunk_compact' };
      window.__compactCalls = (window.__compactCalls || 0) + 1;
      return rpcs.append_list_chunk({ p_list_type, p_seq, p_rows: p_rows.map(r => Object.fromEntries(p_keys.map((k, i) => [k, r[i]]))) });
    },
    commit_list_upload: ({ p_list_type }) => {
      const staged = db.reference_chunks.filter(r => r.list_type === p_list_type && !r.is_active && owned(r));
      if (!staged.length) throw { message: 'Nothing was uploaded' };
      db.reference_chunks = db.reference_chunks.filter(r => !(r.list_type === p_list_type && r.is_active && owned(r)));
      staged.forEach(r => { r.is_active = true; r.uploaded_at = new Date().toISOString(); });
      return staged.reduce((n, r) => n + r.row_count, 0);
    },
    log_usage: ({ p_tool, p_action, p_count, p_qty, p_day }) => {
      if (window.__fail) throw { message: 'network down (test)' };
      const allowed = ['box_scanner/box_closed','year_season/box_closed','item_barcode/print_job','box_code/print_job','box_segregate/lookup_found','box_segregate/lookup_not_found','box_segregate_pallet/box_scanned','box_segregate_pallet/box_duplicate','box_segregate_pallet/box_not_found','price_check/lookup_found','price_check/lookup_not_found'];
      if (!allowed.includes(p_tool + '/' + p_action)) throw { message: 'Invalid usage event: ' + p_tool + '/' + p_action };
      let r = db.usage_daily.find(x => x.user_id === window.__me.id && x.day === p_day && x.tool === p_tool && x.action === p_action);
      if (!r) { r = { user_id: window.__me.id, day: p_day, tool: p_tool, action: p_action, event_count: 0, qty: 0 }; db.usage_daily.push(r); }
      r.event_count += p_count; r.qty += p_qty;
    },
    // ---- Team & Data workspace (admin). Tests can set window.__wsOverview / __wsBoxes / __wsPeople / __wsData / __wsRows / __wsFacets ----
    ws_overview: () => window.__wsOverview || { active_jobs: 2, stopped_jobs: 1, people_now: 3, units_today: 120, boxes_today: 7, top_jobs: [{ job: 'Inbound 7', units: 80 }, { job: 'Inbound 8', units: 40 }], idle_jobs: [], idle_total: 0, quiet_people: 0 },
    ws_jobs: ({ p_search, p_tool, p_status, p_sort, p_limit, p_offset }) => {
      const now = new Date().toISOString();
      let rows = (window.__links = window.__links || []).filter(l =>
        (!p_tool || l.tool === p_tool) && (p_status === 'all' || (p_status === 'active' ? l.state === 'active' : l.state === 'stopped')) &&
        (!p_search || l.job_name.toLowerCase().includes(String(p_search).toLowerCase())));
      if (p_sort === 'name') rows = rows.slice().sort((a, b) => a.job_name.localeCompare(b.job_name));
      const total = rows.length;
      return rows.slice(p_offset || 0, (p_offset || 0) + (p_limit || 25)).map(l => ({ id: l.id, tool: l.tool, job_name: l.job_name, token: l.token, created_at: l.created_at || now, stopped_at: l.state === 'stopped' ? now : null,
        last_scan_at: l.last_scan_at === undefined ? now : l.last_scan_at, state: l.state, people: l.operators || 0, boxes: l.boxes || 0, units: l.units || 0, total_count: total }));
    },
    ws_job_boxes: ({ p_link_id, p_search }) => ((window.__wsBoxes || {})[p_link_id] || []).filter(b => !p_search || b.box.includes(p_search)).map(b => ({ ...b, total_count: ((window.__wsBoxes || {})[p_link_id] || []).length })),
    ws_job_people: ({ p_link_id }) => (window.__wsJobPeople || {})[p_link_id] || [],
    ws_job_activity: () => Array.from({ length: 24 }, (_, i) => ({ hour: new Date(Date.now() - (23 - i) * 3600000).toISOString(), units: i === 23 ? 5 : 0 })),
    ws_people: ({ p_search, p_type }) => (window.__wsPeople || []).filter(p => (p_type === 'all' || p.kind === p_type) && (!p_search || p.name.toLowerCase().includes(String(p_search).toLowerCase()))).map(p => ({ ...p, total_count: (window.__wsPeople || []).length })),
    ws_data_boxes: (a) => { const rows = window.__wsData || []; return rows.map(r => ({ ...r, total_boxes: rows.length, total_units: rows.reduce((n, x) => n + x.items, 0), total_rows: rows.reduce((n, x) => n + x.items, 0) })).slice(a.p_offset || 0, (a.p_offset || 0) + (a.p_limit || 50)); },
    ws_data_rows: (a) => {
      const key = (r) => String(r.job || '').trim().toLowerCase() + '\u0001' + r.box;
      const all = (window.__wsRows || []).filter(r => !a.p_boxes || a.p_boxes.includes(key(r)));
      const i = a.p_after_id ? all.findIndex(r => r.id === a.p_after_id) + 1 : 0;
      return all.slice(i, i + (a.p_limit || 1000));
    },
    ws_data_delete: (a) => {
      window.__wsDeleteArgs = a;
      const key = (r) => String(r.job || '').trim().toLowerCase() + '\u0001' + r.box;
      const hit = (r) => !a.p_boxes || a.p_boxes.includes(key(r));
      const n = (window.__wsRows || []).filter(hit).length;
      window.__wsRows = (window.__wsRows || []).filter(r => !hit(r));
      window.__wsData = (window.__wsData || []).filter(r => !hit(r));
      return n;
    },
    ws_facets: ({ p_kind }) => (window.__wsFacets || {})[p_kind] || [],
    rename_enterprise: ({ new_name }) => { db.enterprises[0].name = new_name.trim(); },
    // like the real functions: an enterprise admin gets everyone, anybody else only their own row
    team_member_stats: () => (window.__operatorPeople || []).concat(window.__me.tier === 'enterprise_admin' || window.__teamAll
      ? [{ user_id: 'u1', display_name: 'Ann', email: 'a@b.c', boxes_closed: 0, total_qty: 0 }, { user_id: 'u2', display_name: 'Bob', email: 'b@b.c', boxes_closed: 0, total_qty: 0 }]
      : [{ user_id: window.__me.id, display_name: 'Ann', email: window.__me.email, boxes_closed: 0, total_qty: 0 }]),
    team_ys_member_stats: () => window.__me.tier === 'enterprise_admin' || window.__teamAll
      ? [{ user_id: 'u1', display_name: 'Ann', email: 'a@b.c', boxes_closed: 1, total_qty: db.ys_scans.length }, { user_id: 'u2', display_name: 'Bob', email: 'b@b.c', boxes_closed: 0, total_qty: 0 }]
      : [{ user_id: window.__me.id, display_name: 'Ann', email: window.__me.email, boxes_closed: 1, total_qty: db.ys_scans.length }]
  };
  window.supabase = { createClient: () => ({
    auth: {
      // the signed-in session is kept in localStorage like the real library does, so a reload keeps it
      getSession: async () => ({ data: { session: JSON.parse(localStorage.getItem('mock_session') || 'null') } }),
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
      signOut: async () => { localStorage.removeItem('mock_session'); },
      signInAnonymously: async () => {
        window.__anonSignIns = (window.__anonSignIns || 0) + 1;
        const session = { user: { id: 'anon' + window.__anonSignIns, is_anonymous: true } };
        localStorage.setItem('mock_session', JSON.stringify(session));
        return { data: { session, user: session.user }, error: null };
      }
    },
    from: builder,
    rpc: async (name, args) => { window.__rpcCalls.push(name); (window.__rpcLog = window.__rpcLog || []).push({ name, args: args || {} }); try { return { data: rpcs[name](args || {}), error: null }; } catch (e) { return { data: null, error: e }; } }
  }) };
})();
