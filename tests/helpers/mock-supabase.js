// In-memory Supabase mock injected before the app scripts.
window.__db = { reference_chunks: [], ys_scans: [], scans: [], enterprises: [{ id: 'E1', name: 'Acme' }], enterprise_invites: [] };
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
      is(c, v) { st.filters.push(r => (r[c] == null) === (v === null)); return b; },
      in(c, vs) { st.filters.push(r => vs.includes(r[c])); return b; },
      order(c, o) { st.order.push([c, !(o && o.ascending === false)]); return b; },
      range(f, t) { st.range = [f, t]; return b; },
      upsert(rows, o) { st.op = 'upsert'; st.rows = rows; st.conflict = o && o.onConflict; return b; },
      delete() { st.op = 'delete'; return b; },
      insert(row) { st.op = 'insert'; st.rows = [row]; return b; },
      maybeSingle() { st.single = true; return b; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); }
    };
    function run() {
      let t = db[table];
      if (window.__fail && (st.op === 'upsert' || st.op === 'insert' || st.op === 'delete')) return { data: null, error: { message: 'network down (test)' } };
      if (st.op === 'insert') { st.rows.forEach(r => t.push({ id: 'i' + Math.random(), status: 'pending', expires_at: new Date(Date.now() + 7 * 864e5).toISOString(), ...r })); return { data: null, error: null }; }
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
    begin_list_upload: ({ p_list_type }) => { db.reference_chunks = db.reference_chunks.filter(r => !(r.list_type === p_list_type && !r.is_active && owned(r))); },
    append_list_chunk: ({ p_list_type, p_seq, p_rows }) => {
      if (p_rows.length > 5000) throw { message: 'chunk too large' };
      db.reference_chunks.push({ id: 'c' + Math.random(), list_type: p_list_type, user_id: window.__me.id, enterprise_id: window.__me.enterprise_id, seq: p_seq, row_count: p_rows.length, rows: p_rows, is_active: false, uploaded_at: new Date().toISOString() });
    },
    commit_list_upload: ({ p_list_type }) => {
      const staged = db.reference_chunks.filter(r => r.list_type === p_list_type && !r.is_active && owned(r));
      if (!staged.length) throw { message: 'Nothing was uploaded' };
      db.reference_chunks = db.reference_chunks.filter(r => !(r.list_type === p_list_type && r.is_active && owned(r)));
      staged.forEach(r => { r.is_active = true; r.uploaded_at = new Date().toISOString(); });
      return staged.reduce((n, r) => n + r.row_count, 0);
    },
    rename_enterprise: ({ new_name }) => { db.enterprises[0].name = new_name.trim(); },
    team_member_stats: () => [{ user_id: 'u1', display_name: 'Ann', email: 'a@b.c', boxes_closed: 0, total_qty: 0 }, { user_id: 'u2', display_name: 'Bob', email: 'b@b.c', boxes_closed: 0, total_qty: 0 }],
    team_ys_member_stats: () => [{ user_id: 'u1', display_name: 'Ann', email: 'a@b.c', boxes_closed: 1, total_qty: db.ys_scans.length }]
  };
  window.supabase = { createClient: () => ({
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }, signOut: async () => {} },
    from: builder,
    rpc: async (name, args) => { window.__rpcCalls.push(name); try { return { data: rpcs[name](args || {}), error: null }; } catch (e) { return { data: null, error: e }; } }
  }) };
})();
