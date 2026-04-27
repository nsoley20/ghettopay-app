import { f, $, esc, validateAmount, validateName } from '../utils.js';
import { store } from '../store.js';
import { db } from '../api.js';

export const tontineScreen = {
  _deleteCurrentTontine() {
    const t = this._curTontine; if (!t) return;
    this.deleteTontine(t.id, t.name);
  },

  _confirmCb: null,
  _askConfirm(title, body, okLabel, okStyle, cb) {
    if ($('mc-title')) $('mc-title').textContent = title;
    if ($('mc-body')) $('mc-body').textContent = body;
    const btn = $('mc-ok');
    if (btn) { btn.textContent = okLabel; btn.className = 'btn ' + (okStyle || 'btn-danger'); }
    this._confirmCb = cb;
    this.showModal('m-confirm');
  },
  _runConfirm() {
    this.closeModal('m-confirm');
    if (this._confirmCb) { const cb = this._confirmCb; this._confirmCb = null; cb(); }
  },

  async deleteTontine(tontineId, name) {
    const t = this._curTontine;
    const isCreator = store.currentUser && t?.creator_id === store.currentUser.id;

    if (isCreator) {
      this._askConfirm(
        `Supprimer "${name}" ?`,
        `Les membres ayant déjà cotisé ce cycle seront remboursés automatiquement.`,
        'Supprimer', 'btn-danger',
        () => this._doDeleteTontine(tontineId, name)
      );
      return;
    } else {
      this._askConfirm(
        `Quitter "${name}" ?`,
        `Tu ne pourras plus voir ni cotiser à cette tontine.`,
        'Quitter', 'btn-danger',
        () => this._doDeleteTontine(tontineId, name)
      );
      return;
    }
  },

  async _doDeleteTontine(tontineId, name) {
    const t = this._curTontine;
    const isCreator = store.currentUser && t?.creator_id === store.currentUser.id;

    if (isCreator) {
      const { data: paidRows } = await db.from('tontine_members')
        .select('user_id, member_name, has_paid')
        .eq('tontine_id', tontineId)
        .eq('has_paid', true);

      const amt = t.amount_per_cycle || 0;
      let selfRefunded = false;

      for (const row of (paidRows || [])) {
        if (!row.user_id || row.user_id === store.currentUser.id) {
          if (row.user_id === store.currentUser.id) {
            const bal = store.get('bal', 0);
            store.set('bal', bal + amt);
            await db.from('wallets').update({ balance: bal + amt }).eq('user_id', store.currentUser.id).catch(() => {});
            if ($('bal-amt')) $('bal-amt').textContent = f(bal + amt);
            selfRefunded = true;
          }
          continue;
        }
        const { data: w } = await db.from('wallets').select('balance').eq('user_id', row.user_id).maybeSingle();
        if (w) {
          await db.from('wallets').update({ balance: w.balance + amt }).eq('user_id', row.user_id).catch(() => {});
        }
        await db.from('notifications').insert({
          user_id: row.user_id, type: 'tontine_refund',
          title: `Remboursement — ${name}`,
          body: `La tontine "${name}" a été supprimée. ${f(amt)} FCFA ont été remboursés sur ton solde.`,
          read: false
        }).catch(() => {});
      }

      const { error: delMembErr } = await db.from('tontine_members').delete().eq('tontine_id', tontineId);
      if (delMembErr) { this.toast('Erreur suppression membres : ' + delMembErr.message, 'err'); return; }
      const { error: delTonErr } = await db.from('tontines').delete().eq('id', tontineId);
      if (delTonErr) { this.toast('Erreur suppression tontine : ' + delTonErr.message, 'err'); return; }
      if (selfRefunded) this.toast(`Tontine supprimée · +${f(amt)} FCFA remboursés`, 'ok');
      else this.toast('Tontine supprimée', 'inf');

    } else {
      if (store.currentUser) {
        const { error: leaveErr } = await db.from('tontine_members').delete()
          .eq('tontine_id', tontineId).eq('user_id', store.currentUser.id);
        if (leaveErr) { this.toast('Erreur : ' + leaveErr.message, 'err'); return; }
      }
      this.toast('Tontine quittée', 'inf');
    }

    const tontines = store.get('tontines', []).filter(x => String(x.id) !== String(tontineId));
    store.set('tontines', tontines);
    this._tontinesList = this._tontinesList.filter(x => String(x.id) !== String(tontineId));
    this._curTontine = null;
    this.go('tontine');
  },

  // ── TONTINE ──
  r_tontine() { this._loadTontines(); },

  _loadTontines() {
    const cached = store.get('tontines', []);
    this._tontinesList = cached;

    if (cached.length) {
      this._renderTontinesList(cached);
    } else {
      $('tontine-list').innerHTML = store.currentUser
        ? [0,0].map(() => `<div style="background:var(--card);border-radius:18px;padding:18px;border:1px solid var(--border)">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
              <div class="skel" style="width:38px;height:38px;border-radius:50%;flex-shrink:0"></div>
              <div style="flex:1"><div class="skel" style="height:11px;width:55%;margin-bottom:7px"></div><div class="skel" style="height:9px;width:35%"></div></div>
              <div class="skel" style="width:52px;height:20px"></div>
            </div>
            <div class="skel" style="height:6px;border-radius:100px;margin-bottom:8px"></div>
            <div class="skel" style="height:34px;border-radius:10px;margin-top:6px"></div>
          </div>`).join('')
        : '<div style="text-align:center;padding:32px;color:var(--txt3);font-size:.82rem">Aucune tontine. Crée ou rejoins-en une !</div><button class="btn btn-gold" onclick="G.showModal(\'mt\')" style="margin:0 16px"><svg><use href="#plus"/></svg>Créer une tontine</button>';
    }

    if (!store.currentUser) return;

    Promise.all([
      db.from('tontines').select('*').eq('creator_id', store.currentUser.id),
      db.from('tontine_members').select('tontine_id').eq('user_id', store.currentUser.id)
    ]).then(async ([{ data: ownTontines }, { data: memberships }]) => {

      const ownIds = new Set((ownTontines || []).map(t => t.id));
      const memberIds = (memberships || [])
        .map(m => m.tontine_id)
        .filter(id => !ownIds.has(id));

      let invitedTontines = [];
      if (memberIds.length) {
        const { data } = await db.from('tontines').select('*').in('id', [...new Set(memberIds)]);
        invitedTontines = data || [];
      }

      const allTontines = [...(ownTontines || [])];
      for (const t of invitedTontines) {
        if (!allTontines.find(x => x.id === t.id)) allTontines.push(t);
      }

      for (const id of [...new Set(memberIds)]) {
        if (!allTontines.find(t => t.id === id)) {
          const c = cached.find(x => String(x.id) === String(id));
          if (c) allTontines.push(c);
        }
      }

      if (!allTontines.length) { if (!cached.length) this._renderTontinesList([]); return; }

      const allIds = allTontines.map(t => t.id);
      const { data: memberRows } = await db.from('tontine_members')
        .select('tontine_id, user_id, member_name, member_phone, has_paid, turn_order')
        .in('tontine_id', allIds)
        .order('turn_order', { ascending: true });

      const mByT = {};
      for (const row of (memberRows || [])) {
        if (!mByT[row.tontine_id]) mByT[row.tontine_id] = [];
        mByT[row.tontine_id].push({
          name: row.member_name || '', phone: row.member_phone || '',
          has_paid: !!row.has_paid, user_id: row.user_id || null
        });
      }

      const result = allTontines.map(t => {
        const members = mByT[t.id] || cached.find(c => c.id === t.id)?.members || [];
        const paid_by = members.filter(m => m.has_paid).map(m => m.name);
        return { ...t, members, paid_by, members_paid: paid_by.length, members_count: members.length };
      });

      store.set('tontines', result);
      this._tontinesList = result;
      this._renderTontinesList(result);
      this._syncNotifs();
    }).catch(() => { if (!cached.length) this._renderTontinesList([]); });
  },

  _renderTontinesList(tontines) {
    if (!$('tontine-list')) return;
    if (!tontines.length) {
      $('tontine-list').innerHTML = '<div style="text-align:center;padding:32px;color:var(--txt3);font-size:.82rem">Aucune tontine. Crée ou rejoins-en une !</div><button class="btn btn-gold" onclick="G.showModal(\'mt\')" style="margin:0 16px"><svg><use href="#plus"/></svg>Créer une tontine</button>';
      return;
    }
    const colors = ['linear-gradient(135deg,#7c3aed,#a78bfa)', 'linear-gradient(135deg,#0284c7,#38bdf8)', 'linear-gradient(135deg,var(--forest),var(--forest2))'];
    const now = new Date();
    $('tontine-list').innerHTML = tontines.map((t, i) => {
      const paid = t.members_paid || 0;
      const total = t.tontine_members?.[0]?.count || t.members_count || (t.members?.length || 1);
      const pct = total > 0 ? Math.round(paid / total * 100) : 0;
      const members = t.members || [];
      const startDate = t.start_date ? new Date(t.start_date) : new Date();
      const monthsElapsed = (now.getFullYear() - startDate.getFullYear()) * 12 + (now.getMonth() - startDate.getMonth());
      const currentTurnIdx = members.length > 0 ? monthsElapsed % members.length : 0;
      const mName = m => typeof m === 'string' ? m : (m?.name || '?');
      const currentTurnName = members[currentTurnIdx] ? mName(members[currentTurnIdx]) : null;
      const turnBadge = currentTurnName
        ? `<div style="background:rgba(212,160,23,.2);border:1px solid rgba(212,160,23,.35);border-radius:10px;padding:8px 12px;font-size:.68rem;font-weight:700;color:var(--gold2);margin-bottom:12px;display:flex;align-items:center;gap:6px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--gold2)" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/></svg>Tour du mois · <strong>${esc(currentTurnName)}</strong></div>`
        : '';
      const orderRow = members.length > 0
        ? `<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px">${members.map((m, mi) => `<div style="padding:3px 8px;border-radius:6px;font-size:.55rem;font-weight:700;background:${mi===currentTurnIdx?'rgba(212,160,23,.3)':'rgba(255,255,255,.1)'};color:${mi===currentTurnIdx?'var(--gold2)':'rgba(255,255,255,.55)'}">${mi+1}. ${esc(mName(m))}</div>`).join('')}</div>`
        : '';
      return `<div style="background:${colors[i % colors.length]};border-radius:18px;padding:18px;cursor:pointer" onclick="G.openTontine('${esc(t.id)}')">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
          <div style="width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:.9rem;color:#fff">${esc(t.name[0])}</div>
          <div style="flex:1"><div style="font-size:.82rem;font-weight:800;color:#fff">${esc(t.name)}</div><div style="font-size:.6rem;color:rgba(255,255,255,.55);font-family:var(--fm)">${total} membre${total>1?'s':''} · ${t.frequency === 'weekly' ? 'Hebdo' : 'Mensuel'}</div></div>
          <div style="text-align:right"><div style="font-family:var(--fd);font-size:.88rem;font-weight:900;color:#fff">${f(t.amount_per_cycle)}</div><div style="font-size:.54rem;color:rgba(255,255,255,.5)">FCFA/cycle</div></div>
        </div>
        ${turnBadge}${orderRow}
        <div style="background:rgba(255,255,255,.15);border-radius:100px;height:6px;overflow:hidden;margin-bottom:6px"><div style="width:${pct}%;height:100%;border-radius:100px;background:var(--gold2);transition:width .5s ease"></div></div>
        <div style="display:flex;justify-content:space-between;font-family:var(--fm);font-size:.56rem;color:rgba(255,255,255,.5)"><span>${paid}/${total} cotisés</span><span>Voir détail →</span></div>
      </div>`;
    }).join('') + `<button class="btn btn-ghost" onclick="G.showModal('mt')" style="margin-top:4px"><svg><use href="#plus"/></svg>Créer une tontine</button>`;
  },

  _syncNotifs() {
    if (!store.currentUser) return;
    db.from('notifications').select('*').eq('user_id', store.currentUser.id).eq('read', false)
      .then(({ data: dbNotifs }) => {
        if (!dbNotifs?.length) return;
        const existing = store.get('notifs', []);
        const existingIds = new Set(existing.map(n => String(n.id)));
        const newOnes = dbNotifs.filter(n => !existingIds.has(String(n.id))).map(n => ({
          id: n.id, type: n.type || 'tontine', icon: 'users',
          bg: 'rgba(10,74,46,.12)', color: 'var(--forest)',
          title: n.title, desc: n.body || '', time: new Date(n.created_at).toLocaleDateString('fr-FR',{day:'numeric',month:'short'}), read: false
        }));
        if (newOnes.length) store.set('notifs', [...newOnes, ...existing]);
      }).catch(() => {});
  },

  _tontineMembers: [],

  addTontineMember(name, phone, userId) {
    const n = name || $('nt-member-name')?.value.trim();
    const p = phone || $('nt-member-phone')?.value.trim() || '';
    if (!n) { this.toast('Saisis un nom', 'err'); return; }
    if (this._tontineMembers.find(m => m.name === n && m.phone === p)) { this.toast('Déjà ajouté', 'err'); return; }
    this._tontineMembers.push({ name: n, phone: p, userId: userId || null });
    if ($('nt-member-name')) $('nt-member-name').value = '';
    if ($('nt-member-phone')) $('nt-member-phone').value = '';
    this._renderTontineMembers();
  },

  _renderTontineMembers() {
    const list = $('nt-members-list');
    if (!list) return;
    list.innerHTML = this._tontineMembers.map((m, i) =>
      `<div style="display:flex;align-items:center;gap:8px;padding:9px 12px;background:var(--bg2);border-radius:12px">
        <div style="width:24px;height:24px;border-radius:50%;background:var(--forest);color:#fff;font-size:.65rem;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0">${i+1}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:.8rem;font-weight:700;color:var(--txt)">${esc(m.name)}</div>
          ${m.phone ? `<div style="font-size:.6rem;color:var(--txt3);font-family:var(--fm)">${esc(m.phone)}</div>` : ''}
        </div>
        <button onclick="G._removeTontineMember(${i})" style="border:none;background:rgba(220,38,38,.08);color:#dc2626;cursor:pointer;font-size:.75rem;padding:4px 8px;border-radius:8px;font-weight:700">✕</button>
      </div>`
    ).join('') || '';
    this._updateNtCount();
  },

  _removeTontineMember(i) {
    this._tontineMembers.splice(i, 1);
    this._renderTontineMembers();
  },

  _closeTontineModal() {
    this._tontineMembers = [];
    this.closeModal('mt');
    ['nt-name','nt-amount','nt-search'].forEach(id => { const el = $(id); if (el) el.value = ''; });
    const res = $('nt-search-results'); if (res) res.style.display = 'none';
    const list = $('nt-members-list'); if (list) list.innerHTML = '';
    this._updateNtCount();
  },

  _setFreq(v) {
    const inp = $('nt-freq'); if (inp) inp.value = v;
    const w = $('nt-freq-w'), m = $('nt-freq-m');
    if (w) {
      w.classList.toggle('on', v === 'weekly');
      if (w.style.background !== undefined && window.innerWidth >= 1280) {
        w.style.background = v==='weekly' ? '#0A4A2E' : 'none';
        w.style.borderColor = v==='weekly' ? '#0A4A2E' : 'rgba(0,0,0,.1)';
        w.style.color = v==='weekly' ? '#fff' : '#5A5A5A';
      }
    }
    if (m) {
      m.classList.toggle('on', v === 'monthly');
      if (m.style.background !== undefined && window.innerWidth >= 1280) {
        m.style.background = v==='monthly' ? '#0A4A2E' : 'none';
        m.style.borderColor = v==='monthly' ? '#0A4A2E' : 'rgba(0,0,0,.1)';
        m.style.color = v==='monthly' ? '#fff' : '#5A5A5A';
      }
    }
  },

  _updateNtCount() {
    const n = this._tontineMembers.length;
    const badge = $('nt-count-badge'), txt = $('nt-count-txt');
    if (badge) { badge.textContent = n + ' membre' + (n > 1 ? 's' : ''); badge.style.display = n ? '' : 'none'; }
    if (txt) txt.textContent = n + ' membre' + (n > 1 ? 's' : '');
  },

  async searchTontineUsers(q) {
    const res = $('nt-search-results');
    if (!res) return;
    if (!q || q.length < 2) { res.style.display = 'none'; return; }
    let users = [];
    if (store.currentUser) {
      const { data } = await db.from('users').select('id,name,phone,avatar')
        .neq('id', store.currentUser.id)
        .or(`name.ilike.%${q}%,phone.ilike.%${q}%`)
        .limit(8);
      users = data || [];
    } else {
      users = (store.get('contacts', [])).filter(u => (u.name||'').toLowerCase().includes(q.toLowerCase()) || (u.phone||'').includes(q));
    }
    if (!users.length) { res.style.display = 'none'; return; }
    this._ntSearchCache = users;
    res.style.display = 'block';
    res.innerHTML = users.map((u, idx) =>
      `<div onclick="G._pickNtSearchResult(${idx})"
        style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border);transition:.1s" onmouseover="this.style.background='var(--bg2)'" onmouseout="this.style.background='none'">
        <div style="width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,var(--forest),var(--green));display:flex;align-items:center;justify-content:center;font-weight:900;color:#fff;font-size:.85rem;flex-shrink:0">${(u.name||'?')[0].toUpperCase()}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:.8rem;font-weight:700;color:var(--txt)">${esc(u.name)}</div>
          <div style="font-size:.6rem;color:var(--txt3);font-family:var(--fm)">${esc(u.phone||'GhettoPay')}</div>
        </div>
        <div style="font-size:.6rem;font-weight:700;color:var(--forest)">+ Ajouter</div>
      </div>`
    ).join('');
  },

  _ntSearchCache: [],
  _pickNtSearchResult(idx) {
    const u = this._ntSearchCache[idx];
    if (!u) return;
    this.addTontineMember(u.name, u.phone || '', u.id || null);
    const inp = $('nt-search'); if (inp) inp.value = '';
    const res = $('nt-search-results'); if (res) res.style.display = 'none';
  },

  async pickTontineContact() {
    if (!('contacts' in navigator && 'ContactsManager' in window)) {
      this.toast('Non disponible · Saisie manuelle', 'err'); return;
    }
    try {
      const contacts = await navigator.contacts.select(['name', 'tel'], { multiple: true });
      if (contacts?.length) {
        contacts.forEach(c => {
          const name = c.name?.[0] || '';
          const phone = c.tel?.[0] || '';
          if (name || phone) this.addTontineMember(name || phone, phone);
        });
        this.toast(`${contacts.length} contact${contacts.length > 1 ? 's' : ''} ajouté${contacts.length > 1 ? 's' : ''}`, 'inf');
      }
    } catch(e) { this.toast('Accès contacts refusé', 'err'); }
  },

  async createTontine() {
    const name = $('nt-name')?.value.trim();
    const amount = parseInt($('nt-amount')?.value) || 0;
    const freq = $('nt-freq')?.value || 'monthly';
    const tontNameErr = validateName(name);
    if (tontNameErr) { this.toast(tontNameErr, 'err'); return; }
    if (amount <= 0) { this.toast('Montant requis', 'err'); return; }

    const creatorEntry = { name: store.get('user',{}).name || 'Moi', phone: store.currentUser?.phone || '', userId: store.currentUser?.id };
    const rawMembers = this._tontineMembers.length > 0 ? [creatorEntry, ...this._tontineMembers] : [creatorEntry];
    const memberNames = rawMembers.map(m => typeof m === 'string' ? m : m.name);

    let localId = Date.now().toString();
    if (store.currentUser) {
      try {
        const startDate = new Date().toISOString();
        const { data: dbT, error } = await db.from('tontines').insert({
          name, creator_id: store.currentUser.id,
          amount_per_cycle: amount, frequency: freq,
          start_date: startDate
        }).select().single();
        if (!error && dbT) {
          localId = dbT.id;
          const needPhone = rawMembers.filter(m => !(m.userId) && (m.phone || ''));
          let phoneToUid = {};
          if (needPhone.length) {
            const phones = needPhone.map(m => m.phone).filter(Boolean);
            const { data: found } = await db.from('users').select('id,phone').in('phone', phones);
            for (const u of (found || [])) phoneToUid[u.phone] = u.id;
          }

          const inserts = rawMembers.map((m, i) => {
            const mn = typeof m === 'string' ? m : m.name;
            const mp = typeof m === 'string' ? '' : (m.phone || '');
            const uid = m.userId || (mp && phoneToUid[mp]) || null;
            return { tontine_id: dbT.id, user_id: uid, turn_order: i + 1, has_paid: false, member_name: mn || null, member_phone: mp || null };
          });
          await db.from('tontine_members').insert(inserts);

          const notifInserts = inserts
            .filter(r => r.user_id && r.user_id !== store.currentUser.id)
            .map(r => ({
              user_id: r.user_id,
              type: 'tontine_invite',
              title: `Tu as été ajouté à "${name}"`,
              body: `${store.get('user',{}).name || 'Quelqu\'un'} t\'a invité dans la tontine "${name}" · ${freq === 'weekly' ? 'Hebdo' : 'Mensuel'} · ${f(amount)} FCFA`,
              read: false
            }));
          if (notifInserts.length) {
            await db.from('notifications').insert(notifInserts).catch(() => {});
          }
        }
      } catch(e) { /* fall through to localStorage */ }
    }

    const tontines = store.get('tontines', []);
    if (!tontines.find(t => String(t.id) === String(localId))) {
      tontines.unshift({ id: localId, name, amount_per_cycle: amount, frequency: freq, members_count: rawMembers.length, members_paid: 0, paid_by: [], members: rawMembers, start_date: new Date().toISOString() });
      store.set('tontines', tontines);
    }

    this._tontineMembers = [];
    this._closeTontineModal();
    this.r_tontine();
    if (window.innerWidth >= 1280) this.gp_renderTontine();
    this.toast('Tontine créée !', 'ok');
  },

  _payCurrentTontine() {
    const t = this._curTontine; if (!t) return;
    this.payTontine(t.id, t.amount_per_cycle, t.name);
  },

  async _checkAutoDistribute(tontineId, newPaid, tData) {
    if (!store.currentUser || !tData) return;
    const { data: members } = await db.from('tontine_members')
      .select('user_id, member_name, turn_order')
      .eq('tontine_id', tontineId)
      .order('turn_order', { ascending: true });
    const total = members?.length || 0;
    if (total === 0) return;
    const { count: paidCount } = await db.from('tontine_members')
      .select('id', { count: 'exact', head: true })
      .eq('tontine_id', tontineId).eq('has_paid', true);
    if ((paidCount || 0) < total) return;

    const startDate = tData.start_date ? new Date(tData.start_date) : new Date();
    const now = new Date();
    const isWeekly = tData.frequency === 'weekly';
    let cycleIdx = 0;
    if (isWeekly) cycleIdx = Math.floor((now - startDate) / 604800000);
    else cycleIdx = (now.getFullYear() - startDate.getFullYear()) * 12 + (now.getMonth() - startDate.getMonth());
    const turnIdx = cycleIdx % total;
    const recipient = members[turnIdx];
    const recipientName = recipient?.member_name || `Membre ${turnIdx + 1}`;
    const totalAmount = (tData.amount_per_cycle || 0) * total;
    const tontineName = tData.name || 'Tontine';

    if (!recipient?.user_id) {
      this.toast(`🎉 Tout le monde a cotisé ! ${f(totalAmount)} FCFA à remettre à ${recipientName}`, 'ok');
      return;
    }

    const { data: rWallet } = await db.from('wallets')
      .select('balance').eq('user_id', recipient.user_id).maybeSingle();
    if (rWallet) {
      await db.from('wallets')
        .update({ balance: (rWallet.balance || 0) + totalAmount })
        .eq('user_id', recipient.user_id).catch(() => {});
    }

    await db.from('transactions').insert({
      to_user_id: recipient.user_id,
      amount: totalAmount,
      type: 'transfer',
      merchant_name: `Cagnotte tontine — ${tontineName}`,
      status: 'completed'
    }).catch(() => {});

    await db.from('notifications').insert({
      user_id: recipient.user_id, type: 'tontine_payment',
      title: `🎉 Cagnotte reçue — ${tontineName}`,
      body: `Tous les membres ont cotisé ! ${f(totalAmount)} FCFA ont été versés sur ton compte.`,
      read: false
    }).catch(() => {});

    const others = members.filter(m => m.user_id && m.user_id !== recipient.user_id);
    if (others.length) {
      await db.from('notifications').insert(others.map(m => ({
        user_id: m.user_id, type: 'tontine_payment',
        title: `Cagnotte distribuée — ${tontineName}`,
        body: `${recipientName} a reçu ${f(totalAmount)} FCFA (tous ont cotisé ce cycle).`,
        read: false
      }))).catch(() => {});
    }

    if (recipient.user_id === store.currentUser.id) {
      const newBal = store.get('bal', 0) + totalAmount;
      store.set('bal', newBal);
      if ($('bal-amt')) $('bal-amt').textContent = f(newBal);
      setTimeout(() => this.ok(`🎉 Tu as reçu la cagnotte !`, `${f(totalAmount)} FCFA de "${tontineName}" ont été versés sur ton compte.`, () => this.go('home')), 1500);
    } else {
      this.toast(`🎉 Cagnotte versée à ${recipientName} — ${f(totalAmount)} FCFA`, 'ok');
    }
  },

  async payTontine(tontineId, amount, name) {
    const n = parseInt(amount) || 0;
    const bal = store.get('bal', 0);
    const payErr = validateAmount(n, bal);
    if (payErr) { this.toast(payErr, 'err'); return; }
    const u = store.get('user', {});

    if (store.currentUser) {
      const { data: myRow } = await db.from('tontine_members')
        .select('has_paid').eq('tontine_id', tontineId).eq('user_id', store.currentUser.id).maybeSingle();
      if (myRow?.has_paid) { this.toast('Tu as déjà cotisé ce cycle', 'err'); return; }
    } else {
      const lt = store.get('tontines', []).find(x => String(x.id) === String(tontineId));
      if (lt?.paid_by?.includes(u.name || 'Moi')) { this.toast('Tu as déjà cotisé ce cycle', 'err'); return; }
    }

    if (store.currentUser) {
      await db.from('wallets').update({ balance: bal - n }).eq('user_id', store.currentUser.id);
      await db.from('tontine_members').update({ has_paid: true })
        .eq('tontine_id', tontineId).eq('user_id', store.currentUser.id);
      const { data: tData } = await db.from('tontines')
        .select('creator_id, amount_per_cycle, frequency, start_date, name').eq('id', tontineId).maybeSingle();
      const { count: realPaid } = await db.from('tontine_members')
        .select('id', { count: 'exact', head: true })
        .eq('tontine_id', tontineId).eq('has_paid', true);
      const newPaid = realPaid || 1;
      await db.from('tontines').update({ members_paid: newPaid }).eq('id', tontineId);
      await db.from('transactions').insert({
        from_user_id: store.currentUser.id, amount: n, type: 'tontine', merchant_name: name, status: 'completed'
      });
      if (tData?.creator_id && tData.creator_id !== store.currentUser.id) {
        await db.from('notifications').insert({
          user_id: tData.creator_id, type: 'tontine_payment',
          title: `Cotisation reçue — ${name}`,
          body: `${u.name || 'Un membre'} a cotisé ${f(n)} FCFA pour la tontine "${name}".`,
          read: false
        }).catch(() => {});
      }
      const { data: otherRows } = await db.from('tontine_members')
        .select('user_id').eq('tontine_id', tontineId).neq('user_id', store.currentUser.id);
      const otherIds = [...new Set((otherRows || []).map(r => r.user_id).filter(id => id && id !== tData?.creator_id))];
      if (otherIds.length) {
        await db.from('notifications').insert(otherIds.map(uid => ({
          user_id: uid, type: 'tontine_payment',
          title: `Cotisation — ${name}`,
          body: `${u.name || 'Un membre'} a cotisé pour ce cycle.`,
          read: false
        }))).catch(() => {});
      }
      await this._checkAutoDistribute(tontineId, newPaid, tData);
      store.set('bal', bal - n);
    } else {
      store.set('bal', bal - n);
    }

    const tontines = store.get('tontines', []);
    const lt = tontines.find(x => String(x.id) === String(tontineId));
    const tgt = lt || this._curTontine;
    if (tgt) {
      if (!tgt.paid_by) tgt.paid_by = [];
      if (!tgt.paid_by.includes(u.name || 'Moi')) {
        tgt.paid_by.push(u.name || 'Moi');
        tgt.members_paid = (tgt.members_paid || 0) + 1;
      }
      if (lt) { lt.paid_by = tgt.paid_by; lt.members_paid = tgt.members_paid; store.set('tontines', tontines); }
      if (this._curTontine) { this._curTontine.paid_by = [...(tgt.paid_by||[])]; this._curTontine.members_paid = tgt.members_paid; }
    }

    const txList = store.get('txs', []);
    txList.unshift({ id: Date.now(), type: 'tontine', name, amount: n, time: new Date().toLocaleDateString('fr-FR',{day:'numeric',month:'short'}), cat: 'Tontine' });
    store.set('txs', txList);

    if ($('bal-amt')) $('bal-amt').textContent = f(bal - n);

    if (store.cur === 'tontine-detail') this.r_tontine_detail();
    else this.r_tontine();
    this.ok(`${f(n)} FCFA cotisés`, `${name} · Confirmé ✓`, () => {});
  },

  // ── TONTINE DETAIL ──
  _curTontine: null,
  _tontineManageOpen: false,
  _tontinesList: [],

  openTontine(id) {
    this._curTontine = this._tontinesList.find(t => String(t.id) === String(id))
                 || store.get('tontines', []).find(t => String(t.id) === String(id))
                 || null;
    this._tontineManageOpen = false;
    this.go('tontine-detail');
  },

  r_tontine_detail() {
    const t = this._curTontine;
    if (!t) { this.back(); return; }
    if ($('td-title')) $('td-title').textContent = t.name;

    const u = store.get('user', {});
    const members = t.members || [];
    const mName = m => typeof m === 'string' ? m : (m?.name || '?');
    const mPhone = m => typeof m === 'string' ? '' : (m?.phone || '');
    const isCreator = !!(store.currentUser && t.creator_id === store.currentUser.id);
    if ($('td-manage-btn')) {
      $('td-manage-btn').style.display = '';
      $('td-manage-btn').textContent = isCreator ? 'Gérer' : 'Membres';
    }

    const paid = t.members_paid || 0;
    const total = members.length || 1;
    const pct = Math.round(paid / total * 100);
    const isWeekly = t.frequency === 'weekly';
    const now = new Date();
    const startDate = t.start_date ? new Date(t.start_date) : new Date();

    let cycleIdx = 0;
    if (isWeekly) cycleIdx = Math.floor((now - startDate) / 604800000);
    else cycleIdx = (now.getFullYear() - startDate.getFullYear()) * 12 + (now.getMonth() - startDate.getMonth());
    const currentTurnIdx = members.length > 0 ? cycleIdx % members.length : 0;
    const currentRecipient = members[currentTurnIdx] ? mName(members[currentTurnIdx]) : '—';
    const myMember = members.find(m => m.user_id && store.currentUser && m.user_id === store.currentUser.id);
    const alreadyPaid = myMember?.has_paid || t.paid_by?.includes(u.name || 'Moi');

    const schedule = members.map((m, i) => {
      const totalCycles = Math.floor(cycleIdx / members.length) * members.length + i;
      const d = new Date(startDate);
      if (isWeekly) d.setDate(d.getDate() + totalCycles * 7);
      else d.setMonth(d.getMonth() + totalCycles);
      while (d < now && i !== currentTurnIdx % members.length) {
        if (isWeekly) d.setDate(d.getDate() + members.length * 7);
        else d.setMonth(d.getMonth() + members.length);
      }
      const isCurrent = i === currentTurnIdx % members.length;
      const isPast = d < now && !isCurrent;
      const label = isWeekly
        ? `Sem. du ${d.toLocaleDateString('fr-FR',{day:'numeric',month:'short'})}`
        : d.toLocaleDateString('fr-FR',{month:'long',year:'numeric'});
      return { m, d, isCurrent, isPast, label, index: i };
    });

    const calYear = now.getFullYear(), calMonth = now.getMonth();
    const firstDay = new Date(calYear, calMonth, 1).getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const calTitle = now.toLocaleDateString('fr-FR',{month:'long',year:'numeric'});

    let highlightDay = null;
    if (!isWeekly) {
      const payDay = startDate.getDate();
      if (payDay <= daysInMonth) highlightDay = payDay;
    } else {
      const dayOfWeek = startDate.getDay();
      for (let d = 1; d <= daysInMonth; d++) {
        if (new Date(calYear, calMonth, d).getDay() === dayOfWeek) { highlightDay = d; break; }
      }
    }

    const calDays = ['L','M','M','J','V','S','D'];
    let calCells = '';
    for (let i = 0; i < (firstDay === 0 ? 6 : firstDay - 1); i++) calCells += '<div></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const isToday = d === now.getDate();
      const isHL = d === highlightDay;
      calCells += `<div style="width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.7rem;font-weight:${isToday||isHL?'800':'500'};${isHL?'background:var(--gold2);color:#000;':''}${isToday&&!isHL?'background:var(--forest);color:#fff;':''}color:${isHL?'#000':isToday?'#fff':'var(--txt)'}">${d}</div>`;
    }

    const membersRows = members.map((m, i) => {
      const hasPaid = m.has_paid || t.paid_by?.includes(mName(m));
      const isCurrentRecip = i === currentTurnIdx % members.length;
      return `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--bg2);border-radius:12px;margin-bottom:8px;border:1px solid ${isCurrentRecip?'rgba(212,160,23,.3)':'transparent'}">
        <div style="width:28px;height:28px;border-radius:50%;background:${isCurrentRecip?'var(--gold2)':hasPaid?'var(--green)':'var(--forest)'};color:${isCurrentRecip?'#000':'#fff'};font-size:.65rem;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0">${i+1}</div>
        <div style="flex:1">
          <div style="font-size:.8rem;font-weight:700;color:var(--txt)">${esc(mName(m))}${isCurrentRecip?' <span style="font-size:.55rem;background:rgba(212,160,23,.15);color:var(--gold2);padding:2px 6px;border-radius:4px;font-weight:700">Tour</span>':''}</div>
          ${mPhone(m)?`<div style="font-size:.6rem;color:var(--txt3)">${esc(mPhone(m))}</div>`:''}
          <div style="font-size:.58rem;font-weight:700;margin-top:2px;color:${hasPaid?'var(--green)':'#dc2626'}">${hasPaid?'✓ Cotisé':'En attente'}</div>
        </div>
        ${isCreator ? `<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">
          ${!hasPaid&&mPhone(m)?`<button onclick="G._remindMemberByIdx(${i})" style="border:none;background:rgba(212,160,23,.12);color:var(--gold2);padding:4px 8px;border-radius:7px;font-size:.6rem;font-weight:700;cursor:pointer">Rappeler</button>`:''}
          ${isCurrentRecip?`<button onclick="G._sendToRecipientByIdx(${i})" style="border:none;background:var(--gold2);color:#000;padding:4px 8px;border-radius:7px;font-size:.6rem;font-weight:700;cursor:pointer">Envoyer</button>`:''}
          ${members.length>1?`<button onclick="G._removeTontineDetailMember(${i})" style="border:none;background:rgba(220,38,38,.08);color:#dc2626;padding:4px 8px;border-radius:7px;font-size:.6rem;font-weight:700;cursor:pointer">Retirer</button>`:''}
        </div>` : ''}
      </div>`;
    }).join('');

    const manageHTML = this._tontineManageOpen ? `
      <div style="background:var(--card);border-radius:16px;padding:16px;border:1.5px solid var(--border)">
        <div class="lbl" style="margin-bottom:12px">Membres — ${paid}/${total} ont cotisé</div>
        ${membersRows}
        ${isCreator ? `
        <div style="display:flex;gap:8px;margin-top:8px">
          <input id="td-add-name" class="inp" placeholder="Nom..." style="flex:1"/>
          <input id="td-add-phone" class="inp" type="tel" placeholder="+241..." style="flex:1"/>
          <button onclick="G._addTontineDetailMember()" style="padding:10px 14px;border:none;border-radius:12px;background:var(--forest);color:#fff;font-weight:800;font-size:.85rem;cursor:pointer">+</button>
        </div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button onclick="G._closeTontineCycle()" style="flex:1;padding:10px;border:1px solid rgba(212,160,23,.25);border-radius:12px;background:rgba(212,160,23,.08);color:var(--gold2);font-size:.78rem;font-weight:700;cursor:pointer">Clôturer le cycle</button>
          <button onclick="G._shareTontine()" style="padding:10px 14px;border:1px solid var(--border);border-radius:12px;background:var(--bg2);color:var(--txt2);font-size:.78rem;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:5px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="#share"/></svg>Partager</button>
        </div>
        <button onclick="G._deleteCurrentTontine()" style="width:100%;margin-top:8px;padding:10px;border:1px solid rgba(220,38,38,.2);border-radius:12px;background:rgba(220,38,38,.07);color:#dc2626;font-size:.78rem;font-weight:700;cursor:pointer">Supprimer cette tontine</button>
        ` : `
        <button onclick="G._shareTontine()" style="width:100%;margin-top:4px;padding:10px;border:1px solid var(--border);border-radius:12px;background:var(--bg2);color:var(--txt2);font-size:.78rem;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="#share"/></svg>Partager cette tontine</button>
        `}
      </div>` : '';

    $('td-body').innerHTML = `
      <div style="background:linear-gradient(135deg,var(--forest),var(--forest2));border-radius:18px;padding:18px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
          <div>
            <div style="font-size:.68rem;color:rgba(255,255,255,.6);font-weight:700;text-transform:uppercase;letter-spacing:.05em">${isCreator?' Mère de tontine · ':''}${isWeekly?'Hebdomadaire':'Mensuelle'}</div>
            <div style="font-family:var(--fd);font-size:1.3rem;font-weight:900;color:#fff;margin-top:2px">${f(t.amount_per_cycle)} <span style="font-size:.65rem;font-weight:600;opacity:.7">FCFA/cycle</span></div>
          </div>
          <div style="text-align:right">
            <div style="font-size:.6rem;color:rgba(255,255,255,.6)">Total cagnotte</div>
            <div style="font-family:var(--fd);font-size:.95rem;font-weight:900;color:var(--gold2)">${f(t.amount_per_cycle * total)}</div>
          </div>
        </div>
        <div style="background:rgba(255,255,255,.15);border-radius:100px;height:8px;overflow:hidden;margin-bottom:6px">
          <div style="width:${pct}%;height:100%;border-radius:100px;background:var(--gold2);transition:.4s"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:.6rem;color:rgba(255,255,255,.55)">
          <span>${paid} / ${total} membres ont cotisé ce cycle</span><span>${pct}%</span>
        </div>
      </div>

      <!-- TOUR EN COURS -->
      <div style="background:rgba(212,160,23,.1);border:1.5px solid rgba(212,160,23,.3);border-radius:16px;padding:16px">
        <div style="font-size:.65rem;font-weight:800;color:var(--gold2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Tour en cours</div>
        <div style="font-size:.95rem;font-weight:900;color:var(--txt)">${currentRecipient} <span style="font-size:.68rem;font-weight:600;color:var(--txt3)">reçoit ce cycle</span></div>
        <div style="font-size:.65rem;color:var(--txt3);margin-top:3px">Cagnotte : ${f(t.amount_per_cycle * total)} FCFA</div>
        <button onclick="G._payCurrentTontine()" style="width:100%;margin-top:12px;padding:11px;border:none;border-radius:12px;background:${alreadyPaid?'var(--bg2)':'var(--gold2)'};color:${alreadyPaid?'var(--txt3)':'#000'};font-size:.8rem;font-weight:900;font-family:var(--f);cursor:${alreadyPaid?'default':'pointer'}">
          ${alreadyPaid ? 'Cotisation payée ce cycle' : 'Cotiser maintenant'}
        </button>
      </div>

      ${manageHTML}

      ${!isCreator ? `<button data-tid="${esc(String(t.id))}" data-tname="${esc(t.name)}" onclick="G.deleteTontine(this.dataset.tid,this.dataset.tname)" style="width:100%;padding:11px;border:1px solid rgba(220,38,38,.25);border-radius:12px;background:rgba(220,38,38,.07);color:#dc2626;font-size:.8rem;font-weight:700;cursor:pointer">Quitter cette tontine</button>` : ''}

      <!-- CALENDRIER MENSUEL -->
      <div style="background:var(--card);border-radius:16px;padding:16px">
        <div style="font-size:.72rem;font-weight:800;color:var(--txt);text-transform:capitalize;margin-bottom:12px">${calTitle}</div>
        <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center;margin-bottom:8px">
          ${calDays.map(d=>`<div style="font-size:.58rem;font-weight:700;color:var(--txt3);padding:4px 0">${d}</div>`).join('')}
          ${calCells}
        </div>
        ${highlightDay ? `<div style="font-size:.65rem;color:var(--txt3);text-align:center;margin-top:4px">
          <span style="display:inline-block;width:10px;height:10px;background:var(--gold2);border-radius:50%;margin-right:4px;vertical-align:middle"></span>Jour de collecte · <strong>${currentRecipient}</strong>
        </div>` : ''}
      </div>

      <!-- PLANNING ROTATION -->
      <div style="background:var(--card);border-radius:16px;padding:16px">
        <div style="font-size:.72rem;font-weight:800;color:var(--txt);margin-bottom:12px">Planning de rotation</div>
        ${schedule.map(s => `
          <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">
            <div style="width:26px;height:26px;border-radius:50%;background:${s.isCurrent?'var(--gold2)':s.isPast?'var(--bg2)':'var(--forest)'};color:${s.isCurrent?'#000':'#fff'};font-size:.65rem;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0">${s.index+1}</div>
            <div style="flex:1">
              <div style="font-size:.8rem;font-weight:${s.isCurrent?'900':'700'};color:${s.isPast?'var(--txt3)':'var(--txt)'}">${mName(s.m)}</div>
              <div style="font-size:.6rem;color:var(--txt3);font-family:var(--fm)">${s.label}</div>
            </div>
            <div style="font-size:.65rem;font-weight:700;color:${s.isCurrent?'var(--gold2)':s.isPast?'var(--txt3)':'var(--txt2)'}">${s.isCurrent?'← En cours':s.isPast?'Passé':'À venir'}</div>
          </div>`).join('')}
      </div>`;
  },

  _toggleTontineManage() {
    this._tontineManageOpen = !this._tontineManageOpen;
    this.r_tontine_detail();
  },

  async _addTontineDetailMember() {
    const name = $('td-add-name')?.value.trim();
    const phone = $('td-add-phone')?.value.trim() || '';
    if (!name) { this.toast('Saisis un nom', 'err'); return; }
    const t = this._curTontine;
    if (!t.members) t.members = [];
    if (t.members.find(m => (typeof m === 'string' ? m : m.name) === name)) { this.toast('Déjà membre', 'err'); return; }
    t.members.push({ name, phone });
    t.members_count = t.members.length;
    this._saveCurTontine();

    if (store.currentUser) {
      try {
        let invitedId = null;
        if (phone) {
          const { data: found } = await db.from('users').select('id').eq('phone', phone).maybeSingle();
          if (found) invitedId = found.id;
        }
        await db.from('tontine_members').insert({
          tontine_id: t.id,
          user_id: invitedId || null,
          turn_order: t.members.length,
          has_paid: false,
          member_name: name,
          member_phone: phone || null
        });
        if (invitedId) {
          const creator = store.get('user', {});
          await db.from('notifications').insert({
            user_id: invitedId, type: 'tontine_invite',
            title: `Tu as été ajouté à "${t.name}"`,
            body: `${creator.name || 'Quelqu\'un'} t\'a invité dans la tontine "${t.name}" — ${t.frequency === 'weekly' ? 'Hebdo' : 'Mensuel'} · ${f(t.amount_per_cycle)} FCFA`,
            read: false
          }).catch(() => {});
          this.toast(`${name} notifié !`, 'ok');
        }
      } catch(e) {}
    }

    const notifs = store.get('notifs', []);
    notifs.unshift({ id: Date.now(), type: 'tontine', icon: 'users', bg: 'rgba(10,74,46,.12)', color: 'var(--forest)', title: 'Membre ajouté', desc: `${name} a été ajouté à la tontine "${t.name}"`, time: 'À l\'instant', read: false });
    store.set('notifs', notifs);

    this.r_tontine_detail();
  },

  _remindMember(name, phone, tontineName) {
    const notifs = store.get('notifs', []);
    notifs.unshift({ id: Date.now(), type: 'tontine', icon: 'users', bg: 'rgba(212,160,23,.1)', color: 'var(--gold2)', title: `Rappel envoyé à ${name}`, desc: `Rappel de cotiser "${tontineName}" envoyé`, time: 'À l\'instant', read: false });
    store.set('notifs', notifs);
    if (store.currentUser && phone) {
      db.from('users').select('id').eq('phone', phone).maybeSingle().then(({ data: u }) => {
        if (u) {
          db.from('notifications').insert({ user_id: u.id, type: 'tontine_reminder', title: `Rappel tontine`, body: `${store.get('user',{}).name||'Le créateur'} te rappelle de cotiser pour "${tontineName}"`, read: false }).catch(()=>{});
        }
      });
    }
    this.toast(`Rappel envoyé à ${name}`, 'ok');
  },

  _sendToRecipient(name, phone, amount) {
    store.selC = { id: 'tontine_' + phone, name, phone, av: (name[0]||'?').toUpperCase() };
    this.go('send');
    setTimeout(() => {
      if ($('rec-av')) $('rec-av').textContent = store.selC.av;
      if ($('rec-name')) $('rec-name').textContent = store.selC.name;
      if ($('rec-phone')) $('rec-phone').textContent = store.selC.phone;
      if ($('rec-row')) $('rec-row').style.display = 'flex';
      store.aStr = String(amount);
      if ($('amt-disp')) $('amt-disp').textContent = f(amount);
    }, 150);
  },

  _remindMemberByIdx(i) {
    const t = this._curTontine; if (!t) return;
    const mName = m => typeof m === 'string' ? m : (m?.name || '?');
    const mPhone = m => typeof m === 'string' ? '' : (m?.phone || '');
    const m = t.members?.[i]; if (!m) return;
    this._remindMember(mName(m), mPhone(m), t.name);
  },

  _sendToRecipientByIdx(i) {
    const t = this._curTontine; if (!t) return;
    const mName = m => typeof m === 'string' ? m : (m?.name || '?');
    const mPhone = m => typeof m === 'string' ? '' : (m?.phone || '');
    const m = t.members?.[i]; if (!m) return;
    this._sendToRecipient(mName(m), mPhone(m), t.amount_per_cycle);
  },

  async _removeTontineDetailMember(i) {
    const t = this._curTontine;
    if (!t?.members) return;
    const m = t.members[i];
    const mn = typeof m === 'string' ? m : (m?.name || '');
    const mp = typeof m === 'string' ? '' : (m?.phone || '');
    t.members.splice(i, 1);
    t.members_count = t.members.length;
    this._saveCurTontine();
    if (store.currentUser && t.id) {
      if (mp) {
        const { data: found } = await db.from('users').select('id').eq('phone', mp).maybeSingle();
        if (found) {
          await db.from('tontine_members').delete()
            .eq('tontine_id', t.id).eq('user_id', found.id).catch(() => {});
        } else {
          await db.from('tontine_members').delete()
            .eq('tontine_id', t.id).eq('member_name', mn).catch(() => {});
        }
      } else if (mn) {
        await db.from('tontine_members').delete()
          .eq('tontine_id', t.id).eq('member_name', mn).catch(() => {});
      }
    }
    this.r_tontine_detail();
  },

  _saveCurTontine() {
    const t = this._curTontine;
    if (!t) return;
    const tontines = store.get('tontines', []);
    const idx = tontines.findIndex(x => String(x.id) === String(t.id));
    if (idx >= 0) tontines[idx] = t;
    store.set('tontines', tontines);
  },

  // ── RESET CYCLE TONTINE ──
  _closeTontineCycle() {
    const t = this._curTontine;
    if (!t) return;
    this._askConfirm(
      `Clôturer le cycle "${t.name}" ?`,
      `Tous les membres seront remis à zéro pour un nouveau cycle.`,
      'Clôturer', '', () => this._doCloseTontineCycle()
    );
  },

  async _doCloseTontineCycle() {
    const t = this._curTontine;
    if (!t) return;
    if (store.currentUser) {
      await db.from('tontine_members').update({ has_paid: false }).eq('tontine_id', t.id);
      await db.from('tontines').update({ members_paid: 0 }).eq('id', t.id);
      const { data: mRows } = await db.from('tontine_members').select('user_id').eq('tontine_id', t.id);
      if (mRows?.length) {
        const notifs = mRows.filter(r => r.user_id && r.user_id !== store.currentUser.id).map(r => ({
          user_id: r.user_id, type: 'tontine_reminder',
          title: `Nouveau cycle — ${t.name}`,
          body: `Le créateur a clôturé le cycle. Un nouveau cycle commence maintenant.`,
          read: false
        }));
        if (notifs.length) await db.from('notifications').insert(notifs).catch(()=>{});
      }
    }
    if (this._curTontine) {
      this._curTontine.members_paid = 0;
      this._curTontine.paid_by = [];
      if (this._curTontine.members) this._curTontine.members.forEach(m => { if (typeof m === 'object') m.has_paid = false; });
    }
    const ts = store.get('tontines', []);
    const lt = ts.find(x => String(x.id) === String(t.id));
    if (lt) { lt.members_paid = 0; lt.paid_by = []; store.set('tontines', ts); }
    this.r_tontine_detail();
    this.toast('Cycle clôturé — nouveau cycle démarré', 'ok');
  },

  // ── PARTAGE LIEN TONTINE ──
  _shareTontine() {
    const t = this._curTontine;
    if (!t) return;
    const url = `${location.origin}${location.pathname}?join=${t.id}`;
    const text = `Rejoins ma tontine "${t.name}" sur GhettoPay !\n${url}`;
    if (navigator.share) {
      navigator.share({ title: t.name, text, url }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(text).then(() => this.toast('Lien copié dans le presse-papiers', 'ok')).catch(() => this.toast(url, 'inf'));
    }
  },
};
