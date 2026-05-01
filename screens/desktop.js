import { f, $, esc } from '../utils.js';
import { store } from '../store.js';
import { db } from '../api.js';
import { validateAmount } from '../utils.js';

export const desktopScreen = {
  _gpAmt: 0, _gpContact: null,

  desktopNav(section) {
    const AUTH = ['pin','login','onboard'];
    if (AUTH.includes(section)) {
      document.body.classList.add('gp-auth');
      const pinForm = $('gp-auth-pin-form');
      const authForms = $('gp-auth-forms');
      if (section === 'pin') {
        if (pinForm) pinForm.style.display = 'flex';
        if (authForms) authForms.style.display = 'none';
        store.cur = section;
        this.r_pin?.();
      } else {
        if (pinForm) pinForm.style.display = 'none';
        if (authForms) authForms.style.display = 'flex';
        store.cur = section;
        this._gpAuthTab(section === 'login' ? 'login' : 'reg');
      }
      return;
    }
    // Écrans desktop : panneaux larges
    document.body.classList.remove('gp-auth');
    document.querySelectorAll('.gp-nav-item').forEach(el => el.classList.remove('gp-active'));
    const btn = document.querySelector(`[data-gp="${section}"]`);
    if (btn) btn.classList.add('gp-active');
    const titles = { home:'Tableau de bord', send:'Envoyer de l\'argent', coffre:'Coffre épargne', budget:'Budget', tontine:'Tontines', notifs:'Notifications', profil:'Profil', transfert:'Mobile Money', factures:'Factures' };
    const t = $('gp-title'); if (t) t.textContent = titles[section] || section;
    ['home','send','coffre','budget','tontine','notifs','profil','transfert','factures'].forEach(p => {
      const el = $(`gp-${p}-panel`); if (el) el.style.display = 'none';
    });
    const panel = $(`gp-${section}-panel`);
    if (panel) panel.style.display = 'flex';
    const renders = { home: this.renderDesktopHome, send: this.gp_renderSend, coffre: this.gp_renderCoffre, budget: this.gp_renderBudget, tontine: this.gp_renderTontine, notifs: this.gp_renderNotifs, profil: this.gp_renderProfil, transfert: this.gp_renderTransfert, factures: this.gp_renderFactures };
    if (renders[section]) renders[section].call(this);
  },

  _gpAuthTab(tab) {
    const loginForm = $('gp-auth-login-form');
    const regForm = $('gp-auth-reg-form');
    const tabLogin = $('gp-tab-login');
    const tabReg = $('gp-tab-reg');
    const title = $('gp-auth-form-title');
    const sub = $('gp-auth-form-sub');
    if (tab === 'login') {
      if (loginForm) loginForm.style.display = 'flex';
      if (regForm) regForm.style.display = 'none';
      if (tabLogin) { tabLogin.style.background = '#fff'; tabLogin.style.color = '#1A1A1A'; tabLogin.style.boxShadow = '0 1px 6px rgba(0,0,0,.1)'; }
      if (tabReg) { tabReg.style.background = 'transparent'; tabReg.style.color = 'var(--txt3)'; tabReg.style.boxShadow = 'none'; }
      if (title) title.textContent = 'Bon retour !';
      if (sub) sub.textContent = 'Entre ton email et ton code PIN';
      setTimeout(() => $('gp-login-email')?.focus(), 80);
    } else {
      if (loginForm) loginForm.style.display = 'none';
      if (regForm) regForm.style.display = 'flex';
      if (tabReg) { tabReg.style.background = '#fff'; tabReg.style.color = '#1A1A1A'; tabReg.style.boxShadow = '0 1px 6px rgba(0,0,0,.1)'; }
      if (tabLogin) { tabLogin.style.background = 'transparent'; tabLogin.style.color = 'var(--txt3)'; tabLogin.style.boxShadow = 'none'; }
      if (title) title.textContent = 'Créer mon compte';
      if (sub) sub.textContent = 'Rejoins des milliers de Gabonais sur GhettoPay';
      setTimeout(() => $('gp-reg-name')?.focus(), 80);
    }
  },

  gp_renderSend() {
    this._gpAmt = 0; this._gpContact = null;
    const disp = $('gp-amt-disp'); if (disp) { disp.textContent = '0'; disp.style.display = 'none'; }
    const feeEl = $('gp-fee-disp'); if (feeEl) feeEl.textContent = 'Sans frais';
    const recRow = $('gp-rec-row'); if (recRow) recRow.style.display = 'none';
    const np = $('gp-numpad');
    if (np) {
      np.innerHTML = `<input id="gp-amt-input" type="number" inputmode="numeric" min="1" max="9999999"
        style="width:100%;border:none;border-bottom:2px solid rgba(10,74,46,.2);background:none;font-size:2.4rem;font-weight:900;color:#1A1A1A;text-align:center;padding:8px 0;outline:none;font-family:'DM Sans',sans-serif;letter-spacing:-.03em;box-sizing:border-box;appearance:textfield;-moz-appearance:textfield"
        placeholder="0" oninput="G._gpUpdateAmt(this.value)">`;
      setTimeout(() => $('gp-amt-input')?.focus(), 60);
    }
    this.gp_loadContacts();
  },

  _gpUpdateAmt(val) {
    this._gpAmt = Math.max(0, Math.min(9999999, parseInt(val) || 0));
    const isInternal = this._gpContact && !this._gpContact.id?.startsWith('manual_');
    const fee = (isInternal || !this._gpAmt) ? 0 : Math.round(this._gpAmt * 0.015);
    const feeEl = $('gp-fee-disp');
    if (feeEl) feeEl.textContent = isInternal ? 'Sans frais' : (fee ? f(fee) + ' FCFA (1,5%)' : '0 FCFA');
  },

  gp_loadContacts() {
    const grid = $('gp-contact-grid'); if (!grid) return;
    const users = store.get('contacts', []);
    if (!users.length && store.currentUser) {
      db.from('users').select('id,name,phone,avatar_url').neq('id', store.currentUser.id).limit(40)
        .then(({data}) => { if (data) { store.set('contacts', data); this.gp_filterContacts(''); } }).catch(()=>{});
    }
    this.gp_filterContacts('');
  },
  gp_filterContacts(q) {
    const grid = $('gp-contact-grid'); if (!grid) return;
    const q2 = (q || '').toLowerCase().trim();
    let users = store.get('contacts', []);
    if (q2) users = users.filter(u => (u.name||'').toLowerCase().includes(q2) || (u.phone||'').includes(q2));
    if (!users.length) { grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:24px;color:#9A9A9A;font-size:.75rem">Aucun contact</div>'; return; }
    const grads = ['linear-gradient(135deg,#0A4A2E,#16A34A)','linear-gradient(135deg,#7c3aed,#a78bfa)','linear-gradient(135deg,#0284c7,#38bdf8)','linear-gradient(135deg,#d97706,#fcd34d)'];
    const selId = this._gpContact?.id;
    grid.innerHTML = users.slice(0, 30).map((u, i) => {
      const av = (u.name||'?')[0].toUpperCase();
      return `<div onclick="G.gp_selContact(${JSON.stringify(u).replace(/"/g,'&quot;')})" style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:14px 8px;background:#FAFAF8;border-radius:14px;cursor:pointer;border:2px solid ${selId===u.id?'#C8960A':'transparent'};transition:all .15s" onmouseover="this.style.background='#F5F2EA'" onmouseout="this.style.background='#FAFAF8'">
        <div style="width:44px;height:44px;border-radius:50%;background:${grads[i%grads.length]};display:flex;align-items:center;justify-content:center;font-weight:900;color:#fff;font-size:.95rem">${av}</div>
        <div style="font-size:.65rem;font-weight:700;color:#1A1A1A;text-align:center;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(u.name||'—')}</div>
        <div style="font-size:.58rem;color:#9A9A9A;font-family:monospace">${esc((u.phone||'').replace(/(\d{2})(\d{2})(\d{2})(\d{2})/,'$1 $2 $3 $4'))}</div>
      </div>`;
    }).join('');
  },
  gp_selContact(u) {
    this._gpContact = u;
    const recRow = $('gp-rec-row');
    if (recRow) {
      recRow.style.display = 'flex';
      const av = $('gp-rec-av'); if (av) { av.textContent = (u.name||'?')[0].toUpperCase(); }
      const nm = $('gp-rec-name'); if (nm) nm.textContent = u.name || '—';
      const ph = $('gp-rec-phone'); if (ph) ph.textContent = u.phone || '';
    }
    this.gp_filterContacts($('gp-send-search')?.value || '');
  },
  async gp_send() {
    if (!this._gpContact) { this.toast('Choisir un destinataire', 'err'); return; }
    const amt = this._gpAmt || 0;
    const isInternal = !this._gpContact.id?.startsWith('manual_');
    const bal = store.get('bal', 0);
    const gpAmtErr = validateAmount(amt, bal, { withFee: !isInternal, min: 100 });
    if (gpAmtErr) { this.toast(gpAmtErr, 'err'); return; }
    const fee = isInternal ? 0 : Math.round(amt * 0.015);
    const total = amt + fee;
    const PIN_THRESHOLD = 100000;
    if (amt >= PIN_THRESHOLD && store.get('user', {}).pin) {
      this._gpShowPinModal(
        `Transfert de ${f(amt)} FCFA à ${this._gpContact.name}${fee ? ` · Frais ${f(fee)} FCFA` : ' · Sans frais'}`,
        () => this._gpDoSend(amt, fee, total)
      );
      return;
    }
    await this._gpDoSend(amt, fee, total);
  },

  async _gpDoSend(amt, fee, total) {
    if (!store.currentUser) { this.toast('Non connecté', 'err'); return; }
    const bal = store.get('bal', 0);
    const btn = document.querySelector('#gp-send-panel button[onclick="G.gp_send()"]');
    if (btn) { btn.textContent = 'Envoi…'; btn.disabled = true; }
    try {
      const { data, error } = await db.rpc('transfer_money', {
        p_from_user_id: store.currentUser.id, p_to_user_id: this._gpContact.id, p_amount: amt, p_note: ''
      });
      if (error || !data?.success) throw new Error(data?.error || 'Erreur de transfert');
      const newBal = bal - total;
      store.set('bal', newBal);
      if (store.currentUser.wallet) store.currentUser.wallet.balance = newBal;
      this.toast(`${f(amt)} FCFA envoyés à ${this._gpContact.name}${fee ? ` · Frais ${f(fee)} FCFA` : ''}`, 'ok');
      this._gpAmt = 0; this._gpContact = null;
      this.desktopNav('home');
    } catch(e) { this.toast('Erreur : ' + (e.message || 'inconnue'), 'err'); }
    finally { if (btn) { btn.textContent = 'Envoyer →'; btn.disabled = false; } }
  },

  _gpShowPinModal(desc, cb) {
    this._gpPinCb = cb;
    this._gpPinBuf = '';
    this.gpModal(`
      <div style="font-size:1.05rem;font-weight:900;color:#1A1A1A;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between">
        <span>Confirmer avec ton PIN</span>
        <button onclick="G.gpCloseModal()" style="border:none;background:rgba(0,0,0,.06);border-radius:50%;width:32px;height:32px;cursor:pointer;font-size:1rem;display:flex;align-items:center;justify-content:center">✕</button>
      </div>
      <div style="font-size:.72rem;color:#9A9A9A;margin-bottom:24px">${esc(desc)}</div>
      <div style="display:flex;justify-content:center;gap:14px;margin-bottom:28px">
        ${[0,1,2,3].map(i=>`<div id="gpd${i}" style="width:14px;height:14px;border-radius:50%;background:rgba(0,0,0,.1);transition:background .15s"></div>`).join('')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
        ${['1','2','3','4','5','6','7','8','9','','0','←'].map(k=>
          k==='' ? '<div></div>' :
          `<button onclick="G._gpPinKey('${k}')" style="padding:15px;border:1px solid rgba(0,0,0,.08);border-radius:12px;background:#F5F2EA;color:#1A1A1A;font-size:1rem;font-weight:800;cursor:pointer;font-family:'DM Sans',sans-serif;transition:opacity .12s" onmousedown="this.style.opacity='.6'" onmouseup="this.style.opacity='1'">${k}</button>`
        ).join('')}
      </div>`);
  },

  _gpPinKey(k) {
    if (k === '←') { this._gpPinBuf = (this._gpPinBuf||'').slice(0,-1); }
    else if ((this._gpPinBuf||'').length < 4) { this._gpPinBuf = (this._gpPinBuf||'') + k; }
    [0,1,2,3].forEach(i => {
      const d = document.getElementById(`gpd${i}`);
      if (d) d.style.background = i < (this._gpPinBuf||'').length ? '#0A4A2E' : 'rgba(0,0,0,.1)';
    });
    if ((this._gpPinBuf||'').length === 4) {
      const pin = String(store.get('user', {}).pin || '');
      if (this._gpPinBuf === pin) {
        this.gpCloseModal();
        const cb = this._gpPinCb; this._gpPinCb = null; this._gpPinBuf = '';
        if (cb) cb();
      } else {
        this._gpPinBuf = '';
        [0,1,2,3].forEach(i => { const d = document.getElementById(`gpd${i}`); if (d) d.style.background='rgba(220,38,38,.4)'; });
        setTimeout(() => [0,1,2,3].forEach(i => { const d = document.getElementById(`gpd${i}`); if (d) d.style.background='rgba(0,0,0,.1)'; }), 600);
        this.toast('PIN incorrect', 'err');
      }
    }
  },

  gp_renderCoffre() {
    const total = store.get('coffre', 0);
    const el = $('gp-coffre-total'); if (el) el.textContent = f(total) + ' FCFA';
    this._gp_renderCoffreGrid();
    if (store.currentUser) {
      db.from('coffres').select('*').eq('user_id', store.currentUser.id).order('created_at',{ascending:false})
        .then(({data}) => { if (data) { store.set('coffres_list', data); this._gp_renderCoffreGrid(); } }).catch(()=>{});
    }
  },
  _gp_renderCoffreGrid() {
    const grid = $('gp-coffre-grid'); if (!grid) return;
    const coffres = store.get('coffres_list', []);
    if (!coffres.length) { grid.innerHTML = '<div style="text-align:center;padding:40px;color:#9A9A9A;font-size:.78rem;background:#fff;border-radius:18px;border:1.5px dashed rgba(0,0,0,.1)">Aucun coffre — créez-en un pour commencer</div>'; return; }
    const cols = ['linear-gradient(135deg,#0A4A2E,#16A34A)','linear-gradient(135deg,#7c3aed,#a78bfa)','linear-gradient(135deg,#0284c7,#38bdf8)','linear-gradient(135deg,#d97706,#fcd34d)'];
    grid.innerHTML = coffres.map((c, i) => {
      const pct = c.goal_amount ? Math.min(100, Math.round((c.current_amount||0) / c.goal_amount * 100)) : 0;
      return `<div style="background:#fff;border-radius:18px;padding:22px;border:1px solid rgba(0,0,0,.05);box-shadow:0 1px 3px rgba(0,0,0,.06)">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
          <div style="width:44px;height:44px;border-radius:12px;background:${cols[i%cols.length]};flex-shrink:0"></div>
          <div><div style="font-size:.9rem;font-weight:800;color:#1A1A1A">${esc(c.name||'Coffre')}</div><div style="font-size:.65rem;color:#9A9A9A;margin-top:2px">${esc(c.category||'Épargne')}</div></div>
        </div>
        <div style="font-size:1.5rem;font-weight:900;color:#1A1A1A;margin-bottom:4px">${f(c.current_amount||0)} <span style="font-size:.65rem;font-weight:600;color:#9A9A9A">FCFA</span></div>
        ${c.goal_amount ? `<div style="font-size:.62rem;color:#9A9A9A;margin-bottom:10px">Objectif : ${f(c.goal_amount)} FCFA</div><div style="height:6px;background:#F0EDE4;border-radius:6px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${cols[i%cols.length]};border-radius:6px;transition:width .4s"></div></div><div style="font-size:.6rem;color:#9A9A9A;margin-top:4px">${pct}% atteint</div>` : ''}
        <div style="display:flex;gap:8px;margin-top:14px">
          <button onclick="G.gp_openDeposit('${c.id}')" style="flex:1;padding:9px;border:none;border-radius:10px;background:${cols[i%cols.length]};color:#fff;font-weight:800;font-size:.72rem;cursor:pointer;font-family:'DM Sans',sans-serif">Déposer</button>
          <button onclick="G._withdrawCoffre('${c.id}')" style="flex:1;padding:9px;border:1.5px solid rgba(0,0,0,.1);border-radius:10px;background:none;font-weight:700;font-size:.72rem;cursor:pointer;font-family:'DM Sans',sans-serif;color:#5A5A5A">Retirer</button>
        </div>
      </div>`;
    }).join('');
  },

  gp_renderBudget() {
    const txs = store.get('txs', []);
    let out = 0, inn = 0;
    txs.forEach(t => { if (t.type==='credit'||t.type==='recv') inn += (t.amount||0); else out += (t.amount||0); });
    const net = inn - out;
    const bOut = $('gp-bud-out'); if (bOut) bOut.textContent = f(out) + ' F';
    const bIn = $('gp-bud-in'); if (bIn) bIn.textContent = f(inn) + ' F';
    const bNet = $('gp-bud-net'); if (bNet) { bNet.textContent = (net>=0?'+':'')+f(net)+' F'; bNet.style.color = net>=0?'#16A34A':'#DC2626'; }
    const txlist = $('gp-bud-txlist');
    if (txlist) {
      txlist.innerHTML = txs.slice(0,10).map(t => {
        const cr = t.type==='credit'||t.type==='recv';
        return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid rgba(0,0,0,.04)">
          <div style="font-size:.78rem;font-weight:600;color:#1A1A1A">${esc(t.name||t.type||'—')}</div>
          <div style="font-size:.78rem;font-weight:800;color:${cr?'#16A34A':'#DC2626'}">${cr?'+':'-'}${f(t.amount)} F</div>
        </div>`;
      }).join('') || '<div style="text-align:center;padding:20px;color:#9A9A9A;font-size:.75rem">Aucune transaction</div>';
    }
    const catMap = {};
    txs.forEach(t => { const c = t.cat||t.type||'Autre'; catMap[c] = (catMap[c]||0) + (t.amount||0); });
    const cats = $('gp-bud-cats');
    if (cats) {
      const total = Object.values(catMap).reduce((a,b)=>a+b, 1);
      const catColors = ['#0A4A2E','#7c3aed','#0284c7','#d97706','#dc2626'];
      cats.innerHTML = Object.entries(catMap).slice(0,5).map(([c, v], i) => {
        const pct = Math.round(v/total*100);
        return `<div><div style="display:flex;justify-content:space-between;font-size:.72rem;margin-bottom:5px"><span style="font-weight:700;color:#1A1A1A;text-transform:capitalize">${c}</span><span style="color:#9A9A9A">${pct}%</span></div><div style="height:5px;background:#F0EDE4;border-radius:5px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${catColors[i%catColors.length]};border-radius:5px"></div></div></div>`;
      }).join('') || '<div style="color:#9A9A9A;font-size:.75rem">Aucune donnée</div>';
    }
    if (store.currentUser) {
      db.from('transactions').select('*,from_user:from_user_id(name),to_user:to_user_id(name)')
        .or(`from_user_id.eq.${store.currentUser.id},to_user_id.eq.${store.currentUser.id}`)
        .order('created_at',{ascending:false}).limit(50)
        .then(({data:rows}) => {
          if (!rows?.length) return;
          const mapped = rows.map(t => ({
            name: t.to_user_id===store.currentUser.id ? (t.from_user?.name||'—') : (t.to_user?.name||t.merchant_name||'—'),
            type: t.to_user_id===store.currentUser.id ? 'credit' : 'debit',
            amount: t.amount||0,
            cat: {transfer:'Transfert',qr:'QR Pay',recharge:'Recharge',coffre_deposit:'Coffre',tontine:'Tontine'}[t.type]||t.type||'Autre'
          }));
          store.set('txs', mapped);
          this.gp_renderBudget();
        }).catch(()=>{});
    }
  },

  gp_renderTontine() {
    const grid = $('gp-tontine-grid'); if (!grid) return;
    const list = this._tontinesList || store.get('tontines', []);
    if (!list.length) {
      grid.innerHTML = '<div style="text-align:center;padding:40px;color:#9A9A9A;font-size:.78rem;background:#fff;border-radius:18px;border:1.5px dashed rgba(0,0,0,.1)">Aucune tontine — créez-en une pour commencer</div>';
    } else {
      const cols = ['linear-gradient(135deg,#9B59D0,#B47DE8)','linear-gradient(135deg,#0A4A2E,#16A34A)','linear-gradient(135deg,#0284c7,#38bdf8)','linear-gradient(135deg,#d97706,#fcd34d)'];
      grid.innerHTML = list.map((ton, i) => `<div style="background:#fff;border-radius:18px;padding:22px;border:1px solid rgba(0,0,0,.05);box-shadow:0 1px 3px rgba(0,0,0,.06)">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
          <div style="width:44px;height:44px;border-radius:12px;background:${cols[i%cols.length]};flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:.9rem">${esc((ton.name||'T')[0].toUpperCase())}</div>
          <div><div style="font-size:.9rem;font-weight:800;color:#1A1A1A">${esc(ton.name||'Tontine')}</div><div style="font-size:.62rem;color:#9A9A9A;margin-top:2px">${esc(ton.frequency||'mensuelle')} · ${ton.members_count||ton.member_count||'?'} membres</div></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">
          <div style="background:#F5F2EA;border-radius:10px;padding:10px"><div style="font-size:.58rem;color:#9A9A9A;font-family:monospace;text-transform:uppercase;margin-bottom:3px">Cotisation</div><div style="font-size:.85rem;font-weight:900;color:#1A1A1A">${f(ton.contribution_amount||0)} F</div></div>
          <div style="background:#F5F2EA;border-radius:10px;padding:10px"><div style="font-size:.58rem;color:#9A9A9A;font-family:monospace;text-transform:uppercase;margin-bottom:3px">Cagnotte</div><div style="font-size:.85rem;font-weight:900;color:#16A34A">${f(ton.pot_amount||ton.total_amount||0)} F</div></div>
        </div>
        <div style="display:flex;gap:8px">
          <button onclick="G._openTontineDetail('${ton.id}')" style="flex:1;padding:9px;border:none;border-radius:10px;background:${cols[i%cols.length]};color:#fff;font-weight:800;font-size:.72rem;cursor:pointer;font-family:'DM Sans',sans-serif">Détails</button>
          <button onclick="G._doDeleteTontine('${ton.id}')" style="padding:9px 12px;border:1.5px solid rgba(220,38,38,.3);border-radius:10px;background:rgba(220,38,38,.06);color:#DC2626;font-weight:700;font-size:.72rem;cursor:pointer;font-family:'DM Sans',sans-serif">✕</button>
        </div>
      </div>`).join('');
    }
    if (store.currentUser && !this._tontinesList?.length) {
      Promise.all([
        db.from('tontines').select('*').eq('creator_id', store.currentUser.id).order('created_at',{ascending:false}),
        db.from('tontines').select('*').contains('members', [store.currentUser.id]).order('created_at',{ascending:false})
      ]).then(([r1, r2]) => {
        const all = [...(r1.data||[]), ...(r2.data||[])];
        const seen = new Set();
        this._tontinesList = all.filter(t => seen.has(t.id) ? false : seen.add(t.id));
        this.gp_renderTontine();
      }).catch(()=>{});
    }
  },

  gp_renderNotifs() {
    const list = $('gp-notifs-list'); if (!list) return;
    const notifs = store.get('notifs', []);
    const badge = $('gp-notif-badge'); if (badge) badge.style.display = 'none';
    if (!notifs.length) { list.innerHTML = '<div style="text-align:center;padding:40px;color:#9A9A9A;font-size:.78rem;background:#fff;border-radius:18px;border:1.5px dashed rgba(0,0,0,.1)">Aucune notification</div>'; return; }
    const icons = { transaction:'💸', tontine:'🤝', coffre:'🔒', kyc:'🪪', system:'📢' };
    list.innerHTML = notifs.slice(0,20).map(n => `<div style="display:flex;align-items:flex-start;gap:14px;padding:16px;background:${n.read?'#fff':'rgba(200,150,10,.04)'};border-radius:14px;border:1px solid ${n.read?'rgba(0,0,0,.05)':'rgba(200,150,10,.18)'};cursor:pointer" onclick="G.gp_markRead('${n.id||''}')">
      <div style="font-size:1.4rem;flex-shrink:0">${icons[n.type]||'🔔'}</div>
      <div style="flex:1">
        <div style="font-size:.82rem;font-weight:${n.read?'600':'800'};color:#1A1A1A">${esc(n.title||'Notification')}</div>
        <div style="font-size:.72rem;color:#7A7A6A;margin-top:3px;line-height:1.4">${esc(n.body||n.message||'')}</div>
        <div style="font-size:.6rem;color:#9A9A9A;font-family:monospace;margin-top:6px">${esc(n.time||'')}</div>
      </div>
      ${!n.read ? '<div style="width:8px;height:8px;border-radius:50%;background:#C8960A;flex-shrink:0;margin-top:4px"></div>' : ''}
    </div>`).join('');
    if (store.currentUser) {
      db.from('notifications').select('*').eq('user_id', store.currentUser.id).order('created_at',{ascending:false}).limit(20)
        .then(({data}) => {
          if (!data?.length) return;
          const mapped = data.map(n => ({ id:n.id, type:n.type||'system', title:n.title||'Notification', body:n.body||n.message||'', read:n.read||false, time:new Date(n.created_at).toLocaleDateString('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) }));
          store.set('notifs', mapped);
          this.gp_renderNotifs();
        }).catch(()=>{});
    }
  },
  gp_markRead(id) {
    const notifs = store.get('notifs', []).map(n => n.id==id ? {...n,read:true} : n);
    store.set('notifs', notifs);
    this.gp_renderNotifs();
    if (id && store.currentUser) db.from('notifications').update({read:true}).eq('id',id).catch(()=>{});
  },
  gp_markAllRead() {
    const notifs = store.get('notifs', []).map(n => ({...n,read:true}));
    store.set('notifs', notifs);
    this.gp_renderNotifs();
    if (store.currentUser) db.from('notifications').update({read:true}).eq('user_id',store.currentUser.id).catch(()=>{});
  },

  gp_renderProfil() {
    const u = store.get('user', {});
    const txs = store.get('txs', []);
    const av = (u.name||'?')[0].toUpperCase();
    const cash = store.get('cash', 0);
    const el = {
      av: $('gp-prof-av'), name: $('gp-prof-name'), phone: $('gp-prof-phone'),
      level: $('gp-prof-level'), txc: $('gp-prof-txc'), cash: $('gp-prof-cash'), kycSub: $('gp-kyc-sub')
    };
    if (el.av) { if (u.avatar) { el.av.innerHTML = `<img src="${u.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`; } else el.av.textContent = av; }
    if (el.name) el.name.textContent = u.name || '—';
    if (el.phone) el.phone.textContent = u.phone || '—';
    const lvl = txs.length >= 50 ? 'Gold' : txs.length >= 20 ? 'Silver' : 'Bronze';
    if (el.level) { el.level.textContent = lvl; const lc = {Gold:'rgba(212,168,32,.15)',Silver:'rgba(150,150,150,.15)',Bronze:'rgba(180,100,20,.15)'}; el.level.style.background = lc[lvl]||lc.Bronze; }
    if (el.txc) el.txc.textContent = txs.length;
    if (el.cash) el.cash.textContent = f(cash);
    if (el.kycSub) el.kycSub.textContent = u.kyc_status === 'verified' ? '✓ Vérifié' : 'Compléter pour niveau Gold';
  },

  renderDesktopHome() {
    if (window.innerWidth < 1280) return;
    const bal = store.get('bal', 0), cbal = store.get('coffre', 0), cash = store.get('cash', 0);
    const u = store.get('user', {});
    const tontines = this._tontinesList || [];
    const av = (u.name || '?')[0].toUpperCase();
    const firstName = (u.name || 'Utilisateur').split(' ')[0];
    const greet = $('gp-greet'); if (greet) greet.textContent = `Bonjour, ${firstName}`;
    const sbAv = $('gp-sb-av'); if (sbAv) sbAv.textContent = av;
    const topAv = $('gp-top-av'); if (topAv) topAv.textContent = av;
    const unread = store.get('notifs', []).filter(n => !n.read).length;
    const badge = $('gp-notif-badge'); if (badge) badge.style.display = unread ? 'block' : 'none';
    const cards = $('gp-cards-row');
    if (cards) cards.innerHTML = `
      <div class="gp-card gp-card-gold">
        <span class="gp-card-label">Solde principal</span>
        <span class="gp-card-value">${f(bal)}</span>
        <span class="gp-card-sub">FCFA disponible</span>
      </div>
      <div class="gp-card gp-card-forest">
        <span class="gp-card-label">Coffre épargne</span>
        <span class="gp-card-value">${f(cbal)}</span>
        <span class="gp-card-sub">FCFA épargnés</span>
      </div>
      <div class="gp-card gp-card-green">
        <span class="gp-card-label">Cashback</span>
        <span class="gp-card-value">${f(cash)}</span>
        <span class="gp-card-sub">FCFA accumulés</span>
      </div>
      <div class="gp-card gp-card-purple">
        <span class="gp-card-label">Tontines actives</span>
        <span class="gp-card-value">${tontines.length}</span>
        <span class="gp-card-sub">${tontines.length === 1 ? 'tontine' : 'tontines'}</span>
      </div>`;
    this._renderDesktopChart();
    this._renderDesktopActivity();
  },

  _renderDesktopChart() {
    const chart = $('gp-bar-chart'); if (!chart) return;
    const now = new Date();
    const months = Array.from({length:6}, (_,i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5-i), 1);
      return { y:d.getFullYear(), m:d.getMonth(), label:d.toLocaleDateString('fr-FR',{month:'short'}), val:0 };
    });
    const txs = store.get('txs', []);
    txs.forEach(t => {
      const d = new Date(t.date || t.created_at || 0);
      const mo = months.find(m => m.y === d.getFullYear() && m.m === d.getMonth());
      if (mo) mo.val += (t.amount || 0);
    });
    const maxV = Math.max(...months.map(m => m.val), 1);
    const colors = ['gp-forest','gp-gold','gp-forest','gp-gold','gp-forest','gp-gold'];
    chart.innerHTML = months.map((m, i) => {
      const h = Math.max(5, Math.round((m.val / maxV) * 110));
      return `<div class="gp-bar-col">
        <div class="gp-bar-val">${m.val >= 1000 ? (m.val/1000).toFixed(0)+'k' : ''}</div>
        <div class="gp-bar ${colors[i]}" style="height:${h}px"></div>
        <div class="gp-bar-lbl">${m.label}</div>
      </div>`;
    }).join('');

    if (store.currentUser) {
      const since = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString();
      db.from('transactions').select('amount,created_at').or(`from_user_id.eq.${store.currentUser.id},to_user_id.eq.${store.currentUser.id}`).gte('created_at', since)
        .then(({ data: dbTxs }) => {
          if (!dbTxs?.length) return;
          months.forEach(m => m.val = 0);
          dbTxs.forEach(t => {
            const d = new Date(t.created_at);
            const mo = months.find(m => m.y === d.getFullYear() && m.m === d.getMonth());
            if (mo) mo.val += (t.amount || 0);
          });
          const maxV2 = Math.max(...months.map(m => m.val), 1);
          chart.innerHTML = months.map((m, i) => {
            const h = Math.max(5, Math.round((m.val / maxV2) * 110));
            return `<div class="gp-bar-col">
              <div class="gp-bar-val">${m.val >= 1000 ? (m.val/1000).toFixed(0)+'k' : ''}</div>
              <div class="gp-bar ${colors[i]}" style="height:${h}px"></div>
              <div class="gp-bar-lbl">${m.label}</div>
            </div>`;
          }).join('');
        }).catch(() => {});
    }
  },

  _renderDesktopActivity() {
    const list = $('gp-activity-list'); if (!list) return;
    const grads = ['linear-gradient(135deg,#0A4A2E,#16A34A)','linear-gradient(135deg,#7c3aed,#a78bfa)','linear-gradient(135deg,#0284c7,#38bdf8)','linear-gradient(135deg,#d97706,#fcd34d)','linear-gradient(135deg,#dc2626,#f87171)'];
    const txs = store.get('txs', []).slice(0, 8);
    if (!txs.length) {
      list.innerHTML = '<div style="text-align:center;padding:24px;color:#9A9A9A;font-size:.78rem">Aucune transaction récente</div>';
      return;
    }
    list.innerHTML = txs.map((t, i) => {
      const isCredit = t.type === 'credit' || t.type === 'recv';
      const sign = isCredit ? '+' : '-';
      const cls = isCredit ? 'cr' : 'db';
      const name = t.name || 'Inconnu';
      const av = (name[0] || '?').toUpperCase();
      const cat = t.cat || t.category || t.type || '';
      const time = t.time || (t.created_at ? new Date(t.created_at).toLocaleDateString('fr-FR',{day:'numeric',month:'short'}) : '—');
      return `<div class="gp-act-item" style="animation-delay:${i*0.06}s">
        <div class="gp-act-av" style="background:${grads[i%grads.length]}">${av}</div>
        <div class="gp-act-info">
          <div class="gp-act-name">${esc(name)}</div>
          <div class="gp-act-meta">${esc(cat)} · ${esc(time)}</div>
        </div>
        <div class="gp-act-amount ${cls}">${sign}${f(t.amount)}<span style="font-size:.55rem;opacity:.65"> F</span></div>
      </div>`;
    }).join('');

    if (store.currentUser) {
      db.from('transactions').select('*,from_user:from_user_id(name),to_user:to_user_id(name)')
        .or(`from_user_id.eq.${store.currentUser.id},to_user_id.eq.${store.currentUser.id}`)
        .order('created_at',{ascending:false}).limit(8)
        .then(({data:rows}) => {
          if (!rows?.length) return;
          list.innerHTML = rows.map((t, i) => {
            const isCredit = t.to_user_id === store.currentUser.id;
            const name = isCredit ? (t.from_user?.name||'—') : (t.to_user?.name || t.merchant_name || '—');
            const av = (name[0]||'?').toUpperCase();
            const sign = isCredit ? '+' : '-';
            const cls = isCredit ? 'cr' : 'db';
            const cats = {transfer:'Transfert',qr:'QR Pay',recharge:'Recharge',coffre_deposit:'Coffre',tontine:'Tontine'};
            const cat = cats[t.type] || t.type || '';
            const time = new Date(t.created_at).toLocaleDateString('fr-FR',{day:'numeric',month:'short'});
            return `<div class="gp-act-item" style="animation-delay:${i*0.06}s">
              <div class="gp-act-av" style="background:${grads[i%grads.length]}">${av}</div>
              <div class="gp-act-info">
                <div class="gp-act-name">${esc(name)}</div>
                <div class="gp-act-meta">${esc(cat)} · ${esc(time)}</div>
              </div>
              <div class="gp-act-amount ${cls}">${sign}${f(t.amount)}<span style="font-size:.55rem;opacity:.65"> F</span></div>
            </div>`;
          }).join('');
        }).catch(()=>{});
    }
  },

  async _bioAuth() {
    if (!window.PublicKeyCredential) { this.toast('WebAuthn non supporté', 'err'); return; }
    const rawId = localStorage.getItem('gp_bio_id');
    if (!rawId) { this.toast('Enregistre d\'abord ton empreinte dans le Profil', 'err'); return; }
    try {
      const credId = Uint8Array.from(atob(rawId), c => c.charCodeAt(0));
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const assertion = await navigator.credentials.get({ publicKey: {
        challenge, allowCredentials: [{ type: 'public-key', id: credId }],
        userVerification: 'required', timeout: 60000
      }});
      if (assertion) {
        store.pinBuf = store.get('user', {}).pin || '0000';
        this._checkPin();
      }
    } catch(e) { this.toast('Biométrie échouée ou annulée', 'err'); }
  },

  _mpcUpdateDots() {
    const dots = document.querySelectorAll('#mpc-dots .pin-dot');
    dots.forEach((d, i) => d.classList.toggle('on', i < this._mpcBuf.length));
  },
  _mpcKey(k) {
    if (this._mpcBuf.length >= 4) return;
    this._mpcBuf += k;
    this._mpcUpdateDots();
    if (this._mpcBuf.length === 4) {
      const pin = store.get('user', {}).pin || '';
      if (this._mpcBuf === String(pin)) {
        this.closeModal('m-pin-confirm');
        this._mpcBuf = '';
        const ps = this._pendingSend;
        if (!ps) return;
        this._pendingSend = null;
        store.selC = ps.selC;
        store.aStr = String(ps.n);
        this._execSend(ps);
      } else {
        this._mpcBuf = '';
        this._mpcUpdateDots();
        this.toast('PIN incorrect', 'err');
      }
    }
  },
  _mpcDel() {
    this._mpcBuf = this._mpcBuf.slice(0, -1);
    this._mpcUpdateDots();
  },
  async _execSend({ selC: sc, n, fee, total, bal, note }) {
    if (store.currentUser) {
      this.toast('Envoi en cours...', 'inf');
      const { data, error } = await db.rpc('transfer_money', {
        p_from_user_id: store.currentUser.id, p_to_user_id: sc.id, p_amount: n, p_note: note
      });
      if (error || !data?.success) { this.toast(data?.error || 'Erreur de transfert', 'err'); return; }
      const newBal = bal - total;
      store.set('bal', newBal);
      if (store.currentUser.wallet) store.currentUser.wallet.balance = newBal;
    } else {
      store.set('bal', bal - total);
      const txs = store.get('txs', []);
      txs.unshift({ id: Date.now(), name: sc.name, av: sc.av, amount: n, fee, type: 'send', cat: 'Transfert', time: "À l'instant" });
      store.set('txs', txs);
    }
    this.ok(`${f(n)} FCFA envoyés`, `À ${sc.name} · Frais ${f(fee)} FCFA · Confirmé ✓`, () => this.go('home'));
  },

  gp_renderTransfert() {
    this._gpTransfertDir = this._gpTransfertDir || 'gp_to_airtel';
    this.gp_setTransfertDir(this._gpTransfertDir);
  },

  gp_setTransfertDir(dir) {
    this._gpTransfertDir = dir;
    const DIR = {
      gp_to_airtel: { from:'GhettoPay', to:'Airtel Money', color:'#E8252A', ph:'+241 06/07 XX XX XX', fromGp:true },
      airtel_to_gp: { from:'Airtel Money', to:'GhettoPay', color:'#E8252A', ph:'+241 06/07 XX XX XX', fromGp:false },
      gp_to_moov:   { from:'GhettoPay', to:'Moov Money',  color:'#00A651', ph:'+241 07 XX XX XX',    fromGp:true  },
      moov_to_gp:   { from:'Moov Money', to:'GhettoPay',  color:'#00A651', ph:'+241 07 XX XX XX',    fromGp:false },
    };
    const d = DIR[dir]; if (!d) return;
    // Tabs
    Object.keys(DIR).forEach(k => {
      const tab = $(`gp-tr-tab-${k}`); if (!tab) return;
      const active = k === dir;
      tab.style.background = active ? DIR[k].color : 'none';
      tab.style.color = active ? '#fff' : DIR[k].color;
      tab.style.fontWeight = active ? '800' : '700';
    });
    const bal = store.get('bal', 0);
    const form = $('gp-transfert-form');
    if (form) form.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;padding:12px;background:rgba(0,0,0,.03);border-radius:12px">
        <span style="font-size:.88rem;font-weight:900;color:#1A1A1A">${d.from}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${d.color}" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg>
        <span style="font-size:.88rem;font-weight:900;color:#1A1A1A">${d.to}</span>
        ${d.fromGp ? `<span style="margin-left:auto;font-size:.65rem;color:#9A9A9A">Solde : <strong style="color:#0A4A2E">${f(bal)} F</strong></span>` : ''}
      </div>
      <div>
        <div style="font-size:.6rem;font-weight:800;color:#7A7A6A;text-transform:uppercase;letter-spacing:.1em;margin-bottom:7px">Numéro</div>
        <input id="gp-tr-phone" class="inp" type="tel" placeholder="${d.ph}" style="width:100%;box-sizing:border-box"/>
      </div>
      <div>
        <div style="font-size:.6rem;font-weight:800;color:#7A7A6A;text-transform:uppercase;letter-spacing:.1em;margin-bottom:7px">Montant (FCFA)</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
          ${[1000,5000,10000,25000,50000].map(v=>`<button onclick="document.getElementById('gp-tr-amt').value=${v};G._gpUpdateTrFee()" style="padding:7px 12px;border:1.5px solid rgba(0,0,0,.1);border-radius:9px;background:none;font-size:.72rem;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif">${f(v)}</button>`).join('')}
        </div>
        <input id="gp-tr-amt" class="inp" type="number" inputmode="numeric" placeholder="Ou saisir…" oninput="G._gpUpdateTrFee()" style="width:100%;box-sizing:border-box"/>
      </div>
      <button onclick="G._gpDoTransfert()" style="padding:14px;border:none;border-radius:14px;background:linear-gradient(135deg,${d.color},${d.color}CC);color:#fff;font-weight:900;font-size:.88rem;cursor:pointer;font-family:'DM Sans',sans-serif">Envoyer maintenant</button>`;
    const info = $('gp-transfert-info');
    if (info) info.innerHTML = `
      <div style="display:flex;justify-content:space-between;font-size:.72rem;padding:10px 0;border-bottom:1px solid rgba(0,0,0,.06)"><span style="color:#9A9A9A">Frais GhettoPay</span><span style="font-weight:700">1%</span></div>
      <div style="display:flex;justify-content:space-between;font-size:.72rem;padding:10px 0;border-bottom:1px solid rgba(0,0,0,.06)"><span style="color:#9A9A9A">Frais opérateur</span><span id="gp-tr-op-fee" style="font-weight:700">—</span></div>
      <div style="display:flex;justify-content:space-between;font-size:.72rem;padding:10px 0;border-bottom:1px solid rgba(0,0,0,.06)"><span style="color:#9A9A9A">Total frais</span><span id="gp-tr-total-fee" style="font-weight:700;color:#DC2626">—</span></div>
      <div style="display:flex;justify-content:space-between;font-size:.72rem;padding:10px 0"><span style="color:#9A9A9A">Délai</span><span style="font-weight:700;color:#16A34A">Instantané</span></div>
      <div style="background:rgba(10,74,46,.06);border-radius:12px;padding:12px;font-size:.68rem;color:#5A5A5A;margin-top:6px">Plafond : <strong>500 000 FCFA</strong> par opération</div>`;
  },

  _gpUpdateTrFee() {
    const amt = parseInt($('gp-tr-amt')?.value) || 0;
    const gpFee = Math.round(amt * 0.01);
    const opFee = Math.round(amt * 0.03);
    const opEl = $('gp-tr-op-fee'); if (opEl) opEl.textContent = amt ? `~${f(opFee)} FCFA` : '—';
    const totEl = $('gp-tr-total-fee'); if (totEl) totEl.textContent = amt ? f(gpFee + opFee) + ' FCFA' : '—';
  },

  async _gpDoTransfert() {
    const phone = $('gp-tr-phone')?.value.trim();
    const amount = parseInt($('gp-tr-amt')?.value) || 0;
    const dir = this._gpTransfertDir || 'gp_to_airtel';
    const fromGp = dir === 'gp_to_airtel' || dir === 'gp_to_moov';
    if (!phone) { this.toast('Numéro requis', 'err'); return; }
    if (amount < 500) { this.toast('Minimum 500 FCFA', 'err'); return; }
    if (amount > 500000) { this.toast('Maximum 500 000 FCFA', 'err'); return; }
    const gpFee = Math.round(amount * 0.01);
    const total = fromGp ? amount + gpFee : amount;
    if (fromGp) {
      const bal = store.get('bal', 0);
      if (total > bal) { this.toast(`Solde insuffisant · Besoin de ${f(total)} FCFA`, 'err'); return; }
    }
    this.toast('Traitement en cours…', 'inf');
    if (fromGp && store.currentUser) {
      const bal = store.get('bal', 0);
      await Promise.all([
        db.from('transactions').insert({ from_user_id: store.currentUser.id, amount, type: 'mobile_money', merchant_name: phone, status: 'pending' }),
        db.from('wallets').update({ balance: bal - total }).eq('user_id', store.currentUser.id)
      ]).catch(()=>{});
      store.set('bal', bal - total);
    }
    setTimeout(() => {
      this.ok(`${f(amount)} FCFA ${fromGp ? 'envoyés' : 'en cours de réception'}`, `Frais ${f(gpFee)} FCFA · ${esc(phone)} · En cours`, () => this.renderDesktopHome());
    }, 1000);
  },

  gp_renderFactures() {
    const list = $('gp-bills-list'); if (!list) return;
    if (store.currentUser) {
      db.from('bills').select('*').eq('user_id', store.currentUser.id).eq('paid', false).order('due_date',{ascending:true})
        .then(({data}) => {
          if (data) { store.set('bills', data.map(b => ({ id:b.id, name:b.name||b.merchant_name||'Facture', ref:b.reference||'', amount:b.amount||0, due:b.due_date?new Date(b.due_date).toLocaleDateString('fr-FR',{day:'numeric',month:'short'}):'', paid:b.paid||false }))); this._renderGpBills(); }
        }).catch(()=>{});
    }
    this._renderGpBills();
  },

  _renderGpBills() {
    const list = $('gp-bills-list'); if (!list) return;
    const bills = store.get('bills', []).filter(b => !b.paid);
    if (!bills.length) {
      list.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#9A9A9A;font-size:.78rem;background:#fff;border-radius:18px;border:1.5px dashed rgba(0,0,0,.1)">Toutes les factures sont à jour ✓</div>';
      return;
    }
    list.innerHTML = bills.map(b => `
      <div style="background:#fff;border-radius:18px;padding:20px;border:1px solid rgba(220,38,38,.12);display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:40px;height:40px;border-radius:12px;background:rgba(220,38,38,.08);display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#DC2626" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
          </div>
          <div style="flex:1">
            <div style="font-size:.85rem;font-weight:800;color:#1A1A1A">${esc(b.name)}</div>
            <div style="font-size:.65rem;color:#9A9A9A;margin-top:2px">${esc(b.ref||'Réf: —')}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:1rem;font-weight:900;color:#DC2626">${f(b.amount)} F</div>
            <div style="font-size:.6rem;color:#9A9A9A;margin-top:2px">${b.due||'—'}</div>
          </div>
        </div>
        <button onclick="G.payBill('${b.id}');G._renderGpBills()" style="width:100%;padding:10px;border:none;border-radius:11px;background:linear-gradient(135deg,#0A4A2E,#16A34A);color:#fff;font-weight:800;font-size:.78rem;cursor:pointer;font-family:'DM Sans',sans-serif">Payer maintenant</button>
      </div>`).join('');
  },

  gpModal(html) {
    const box = $('gp-modal-box'), ov = $('gp-modal');
    if (!box || !ov) return;
    box.innerHTML = html;
    ov.style.display = 'flex';
    setTimeout(() => { const first = box.querySelector('input:not([type=hidden])'); if (first) first.focus(); }, 80);
  },
  gpCloseModal() {
    const ov = $('gp-modal'); if (ov) ov.style.display = 'none';
    const box = $('gp-modal-box'); if (box) box.innerHTML = '';
  },

  gp_openNewCoffre() {
    this.gpModal(`
      <div style="font-size:1.05rem;font-weight:900;color:#1A1A1A;margin-bottom:22px;display:flex;align-items:center;justify-content:space-between">
        <span>Nouveau coffre</span>
        <button onclick="G.gpCloseModal()" style="border:none;background:rgba(0,0,0,.06);border-radius:50%;width:32px;height:32px;cursor:pointer;font-size:1rem;display:flex;align-items:center;justify-content:center;flex-shrink:0">✕</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:16px">
        <div>
          <div style="font-size:.6rem;font-weight:800;color:#7A7A6A;text-transform:uppercase;letter-spacing:.1em;margin-bottom:7px">Nom du coffre</div>
          <input id="nc-name" class="inp" placeholder="Ex : Voyage en France, Voiture…" style="width:100%"/>
        </div>
        <div>
          <div style="font-size:.6rem;font-weight:800;color:#7A7A6A;text-transform:uppercase;letter-spacing:.1em;margin-bottom:7px">Objectif en FCFA (optionnel)</div>
          <input id="nc-target" class="inp" type="number" placeholder="Ex : 500 000" style="width:100%"/>
          <input id="nc-months" type="hidden" value="3"/>
        </div>
        <div>
          <div style="font-size:.6rem;font-weight:800;color:#7A7A6A;text-transform:uppercase;letter-spacing:.1em;margin-bottom:10px">Durée de blocage</div>
          <div style="display:flex;gap:8px" id="gp-dur-btns">
            <button onclick="G._gpSetDur(this,3)" class="gp-dur-btn" style="flex:1;padding:10px 0;border:1.5px solid #0A4A2E;border-radius:11px;background:#0A4A2E;color:#fff;font-weight:800;font-size:.75rem;cursor:pointer;font-family:'DM Sans',sans-serif;transition:.15s">3 mois</button>
            <button onclick="G._gpSetDur(this,6)" class="gp-dur-btn" style="flex:1;padding:10px 0;border:1.5px solid rgba(0,0,0,.1);border-radius:11px;background:none;color:#5A5A5A;font-weight:700;font-size:.75rem;cursor:pointer;font-family:'DM Sans',sans-serif;transition:.15s">6 mois</button>
            <button onclick="G._gpSetDur(this,12)" class="gp-dur-btn" style="flex:1;padding:10px 0;border:1.5px solid rgba(0,0,0,.1);border-radius:11px;background:none;color:#5A5A5A;font-weight:700;font-size:.75rem;cursor:pointer;font-family:'DM Sans',sans-serif;transition:.15s">1 an</button>
            <button onclick="G._gpSetDur(this,24)" class="gp-dur-btn" style="flex:1;padding:10px 0;border:1.5px solid rgba(0,0,0,.1);border-radius:11px;background:none;color:#5A5A5A;font-weight:700;font-size:.75rem;cursor:pointer;font-family:'DM Sans',sans-serif;transition:.15s">2 ans</button>
          </div>
        </div>
        <div style="display:flex;gap:10px;margin-top:4px">
          <button onclick="G.createCoffre()" style="flex:1;padding:14px;border:none;border-radius:14px;background:linear-gradient(135deg,#0A4A2E,#16A34A);color:#fff;font-weight:900;font-size:.88rem;cursor:pointer;font-family:'DM Sans',sans-serif">Créer ce coffre</button>
          <button onclick="G.gpCloseModal()" style="padding:14px 20px;border:1.5px solid rgba(0,0,0,.1);border-radius:14px;background:none;font-weight:700;font-size:.88rem;cursor:pointer;font-family:'DM Sans',sans-serif;color:#5A5A5A">Annuler</button>
        </div>
      </div>`);
  },
  _gpSetDur(btn, val) {
    document.querySelectorAll('.gp-dur-btn').forEach(b => {
      b.style.background = 'none'; b.style.borderColor = 'rgba(0,0,0,.1)'; b.style.color = '#5A5A5A';
    });
    btn.style.background = '#0A4A2E'; btn.style.borderColor = '#0A4A2E'; btn.style.color = '#fff';
    const inp = $('nc-months'); if (inp) inp.value = val;
  },

  gp_openNewTontine() {
    this._tontineMembers = [];
    this.gpModal(`
      <div style="font-size:1.05rem;font-weight:900;color:#1A1A1A;margin-bottom:22px;display:flex;align-items:center;justify-content:space-between">
        <span>Nouvelle tontine</span>
        <button onclick="G._closeTontineModal()" style="border:none;background:rgba(0,0,0,.06);border-radius:50%;width:32px;height:32px;cursor:pointer;font-size:1rem;display:flex;align-items:center;justify-content:center;flex-shrink:0">✕</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:16px">
        <div>
          <div style="font-size:.6rem;font-weight:800;color:#7A7A6A;text-transform:uppercase;letter-spacing:.1em;margin-bottom:7px">Nom de la tontine</div>
          <input id="nt-name" class="inp" placeholder="Ex : Amis Libreville, Famille 2025…" style="width:100%"/>
        </div>
        <div>
          <div style="font-size:.6rem;font-weight:800;color:#7A7A6A;text-transform:uppercase;letter-spacing:.1em;margin-bottom:7px">Montant par cycle (FCFA)</div>
          <input id="nt-amount" class="inp" type="number" placeholder="Ex : 50 000" style="width:100%"/>
        </div>
        <div>
          <div style="font-size:.6rem;font-weight:800;color:#7A7A6A;text-transform:uppercase;letter-spacing:.1em;margin-bottom:10px">Fréquence</div>
          <div style="display:flex;gap:8px">
            <button id="nt-freq-w" onclick="G._setFreq('weekly')" style="flex:1;padding:10px 0;border:1.5px solid rgba(0,0,0,.1);border-radius:11px;background:none;color:#5A5A5A;font-weight:700;font-size:.78rem;cursor:pointer;font-family:'DM Sans',sans-serif;transition:.15s">Hebdomadaire</button>
            <button id="nt-freq-m" onclick="G._setFreq('monthly')" style="flex:1;padding:10px 0;border:1.5px solid #0A4A2E;border-radius:11px;background:#0A4A2E;color:#fff;font-weight:800;font-size:.78rem;cursor:pointer;font-family:'DM Sans',sans-serif;transition:.15s">Mensuelle</button>
          </div>
          <input id="nt-freq" type="hidden" value="monthly"/>
        </div>
        <div style="background:#F5F2EA;border-radius:16px;padding:16px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <div style="font-size:.7rem;font-weight:800;color:#1A1A1A">Membres</div>
            <span id="nt-count-txt" style="font-size:.65rem;font-weight:700;color:#0A4A2E">0 membre</span>
          </div>
          <div id="nt-members-list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px"></div>
          <div style="display:flex;gap:6px;margin-bottom:8px">
            <input id="nt-member-name" class="inp" placeholder="Nom…" style="flex:1.3;font-size:.82rem"/>
            <input id="nt-member-phone" class="inp" type="tel" placeholder="+241…" style="flex:1;font-size:.82rem"/>
            <button onclick="G.addTontineMember()" style="padding:0 14px;border:none;border-radius:12px;background:#0A4A2E;color:#fff;font-weight:900;font-size:1.1rem;cursor:pointer;flex-shrink:0;height:44px">+</button>
          </div>
          <div style="position:relative">
            <input id="nt-search" class="inp" type="text" placeholder="Rechercher un utilisateur GhettoPay…" oninput="G.searchTontineUsers(this.value)" autocomplete="off" style="width:100%;font-size:.82rem"/>
            <div id="nt-search-results" style="display:none;position:absolute;left:0;right:0;background:#fff;border-radius:12px;border:1px solid rgba(0,0,0,.08);box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:50;max-height:180px;overflow-y:auto;margin-top:4px"></div>
          </div>
        </div>
        <div style="display:flex;gap:10px;margin-top:4px">
          <button onclick="G.createTontine()" style="flex:1;padding:14px;border:none;border-radius:14px;background:linear-gradient(135deg,#9B59D0,#B47DE8);color:#fff;font-weight:900;font-size:.88rem;cursor:pointer;font-family:'DM Sans',sans-serif">Créer la tontine</button>
          <button onclick="G._closeTontineModal()" style="padding:14px 20px;border:1.5px solid rgba(0,0,0,.1);border-radius:14px;background:none;font-weight:700;font-size:.88rem;cursor:pointer;font-family:'DM Sans',sans-serif;color:#5A5A5A">Annuler</button>
        </div>
      </div>`);
  },

  gp_openEditProfil() {
    const u = store.get('user', {});
    this.gpModal(`
      <div style="font-size:1.05rem;font-weight:900;color:#1A1A1A;margin-bottom:22px;display:flex;align-items:center;justify-content:space-between">
        <span>Modifier le profil</span>
        <button onclick="G.gpCloseModal()" style="border:none;background:rgba(0,0,0,.06);border-radius:50%;width:32px;height:32px;cursor:pointer;font-size:1rem;display:flex;align-items:center;justify-content:center;flex-shrink:0">✕</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:14px">
        <div>
          <div style="font-size:.6rem;font-weight:800;color:#7A7A6A;text-transform:uppercase;letter-spacing:.1em;margin-bottom:7px">Nom complet</div>
          <input id="ep-name" class="inp" value="${(u.name||'').replace(/"/g,'&quot;')}" placeholder="Nom complet" style="width:100%"/>
        </div>
        <div>
          <div style="font-size:.6rem;font-weight:800;color:#7A7A6A;text-transform:uppercase;letter-spacing:.1em;margin-bottom:7px">Téléphone</div>
          <input id="ep-phone" class="inp" type="tel" value="${(u.phone||'').replace(/"/g,'&quot;')}" placeholder="+241 77 00 00 00" style="width:100%"/>
        </div>
        <div>
          <div style="font-size:.6rem;font-weight:800;color:#7A7A6A;text-transform:uppercase;letter-spacing:.1em;margin-bottom:7px">Ville</div>
          <input id="ep-loc" class="inp" value="${(u.loc||'').replace(/"/g,'&quot;')}" placeholder="Ex : Libreville" style="width:100%"/>
        </div>
        <div style="display:flex;gap:10px;margin-top:4px">
          <button onclick="G.saveProfile()" style="flex:1;padding:14px;border:none;border-radius:14px;background:linear-gradient(135deg,#0A4A2E,#16A34A);color:#fff;font-weight:900;font-size:.88rem;cursor:pointer;font-family:'DM Sans',sans-serif">Sauvegarder</button>
          <button onclick="G.gpCloseModal()" style="padding:14px 20px;border:1.5px solid rgba(0,0,0,.1);border-radius:14px;background:none;font-weight:700;font-size:.88rem;cursor:pointer;font-family:'DM Sans',sans-serif;color:#5A5A5A">Annuler</button>
        </div>
      </div>`);
  },

  gp_openKyc() {
    this.gpModal(`
      <div style="font-size:1.05rem;font-weight:900;color:#1A1A1A;margin-bottom:22px;display:flex;align-items:center;justify-content:space-between">
        <span>Vérification d'identité</span>
        <button onclick="G.gpCloseModal()" style="border:none;background:rgba(0,0,0,.06);border-radius:50%;width:32px;height:32px;cursor:pointer;font-size:1rem;display:flex;align-items:center;justify-content:center;flex-shrink:0">✕</button>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:16px">
        <div style="flex:1;padding:8px;border-radius:10px;background:rgba(22,163,74,.1);border:1.5px solid #16A34A;text-align:center;font-size:.68rem;font-weight:800;color:#16A34A">Silver ✓</div>
        <div style="flex:1;padding:8px;border-radius:10px;background:rgba(212,160,23,.08);border:1.5px dashed rgba(212,160,23,.4);text-align:center;font-size:.68rem;font-weight:700;color:#D4A017">Gold</div>
        <div style="flex:1;padding:8px;border-radius:10px;background:#F5F2EA;border:1.5px dashed rgba(0,0,0,.08);text-align:center;font-size:.68rem;font-weight:700;color:#9A9A9A">Platinum</div>
      </div>
      <div style="font-size:.78rem;color:#5A5A5A;margin-bottom:16px">Pour accéder au niveau Gold, fournis tes documents d'identité.</div>
      <div style="display:flex;flex-direction:column;gap:14px">
        <div>
          <div style="font-size:.6rem;font-weight:800;color:#7A7A6A;text-transform:uppercase;letter-spacing:.1em;margin-bottom:7px">Pièce d'identité (CNI / Passeport)</div>
          <input id="kyc-name" class="inp" placeholder="Nom complet (tel que sur la pièce)" style="width:100%"/>
        </div>
        <div>
          <div style="font-size:.6rem;font-weight:800;color:#7A7A6A;text-transform:uppercase;letter-spacing:.1em;margin-bottom:7px">Numéro de la pièce</div>
          <input id="kyc-id" class="inp" placeholder="Numéro de la pièce d'identité" style="width:100%"/>
        </div>
        <div>
          <div style="font-size:.6rem;font-weight:800;color:#7A7A6A;text-transform:uppercase;letter-spacing:.1em;margin-bottom:7px">Selfie avec la pièce</div>
          <div id="kyc-photo-zone" onclick="G._kycPickPhoto()" style="border:2px dashed rgba(0,0,0,.1);border-radius:14px;padding:20px;text-align:center;cursor:pointer;color:#9A9A9A;font-size:.78rem;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px;background:#F8F6F0">
            <svg id="kyc-photo-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><use href="#user"/></svg>
            <span id="kyc-photo-label">Cliquer pour importer une photo</span>
            <img id="kyc-photo-preview" style="display:none;max-height:120px;border-radius:10px;object-fit:cover"/>
          </div>
          <input type="file" id="kyc-photo-input" accept="image/*" style="display:none" onchange="G._onKycPhotoChosen(this)"/>
        </div>
        <div style="display:flex;gap:10px;margin-top:4px">
          <button onclick="G._submitKyc()" style="flex:1;padding:14px;border:none;border-radius:14px;background:linear-gradient(135deg,#D4A017,#E8C040);color:#3A2000;font-weight:900;font-size:.88rem;cursor:pointer;font-family:'DM Sans',sans-serif">Soumettre</button>
          <button onclick="G.gpCloseModal()" style="padding:14px 20px;border:1.5px solid rgba(0,0,0,.1);border-radius:14px;background:none;font-weight:700;font-size:.88rem;cursor:pointer;font-family:'DM Sans',sans-serif;color:#5A5A5A">Annuler</button>
        </div>
      </div>`);
  },

  gp_openDeposit(id) {
    const coffres = store.get('coffres_list', []);
    const c = coffres.find(x => String(x.id) === String(id));
    const name = c?.name || 'Coffre';
    const bal = store.get('bal', 0);
    this._depCoffreId = id;
    this._depCoffreName = name;
    this.gpModal(`
      <div style="font-size:1.05rem;font-weight:900;color:#1A1A1A;margin-bottom:6px;display:flex;align-items:center;justify-content:space-between">
        <span>Déposer dans "${name}"</span>
        <button onclick="G.gpCloseModal()" style="border:none;background:rgba(0,0,0,.06);border-radius:50%;width:32px;height:32px;cursor:pointer;font-size:1rem;display:flex;align-items:center;justify-content:center;flex-shrink:0">✕</button>
      </div>
      <div style="font-size:.72rem;color:#9A9A9A;margin-bottom:20px">Solde disponible : <strong style="color:#1A1A1A">${f(bal)} FCFA</strong></div>
      <div style="display:flex;flex-direction:column;gap:14px">
        <div>
          <div style="font-size:.6rem;font-weight:800;color:#7A7A6A;text-transform:uppercase;letter-spacing:.1em;margin-bottom:7px">Montant (FCFA)</div>
          <input id="mdep-amount" class="inp" type="number" inputmode="decimal" placeholder="Ex : 10 000" style="width:100%;font-size:1.1rem"/>
        </div>
        <div style="display:flex;gap:8px">
          ${[5000,10000,25000,50000].map(v=>`<button onclick="document.getElementById('mdep-amount').value=${v}" style="flex:1;padding:9px 0;border:1.5px solid rgba(0,0,0,.1);border-radius:10px;background:none;font-size:.72rem;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;color:#5A5A5A">${f(v)}</button>`).join('')}
        </div>
        <div style="display:flex;gap:10px;margin-top:4px">
          <button onclick="G._doDeposit()" style="flex:1;padding:14px;border:none;border-radius:14px;background:linear-gradient(135deg,#0A4A2E,#16A34A);color:#fff;font-weight:900;font-size:.88rem;cursor:pointer;font-family:'DM Sans',sans-serif">Déposer</button>
          <button onclick="G.gpCloseModal()" style="padding:14px 20px;border:1.5px solid rgba(0,0,0,.1);border-radius:14px;background:none;font-weight:700;font-size:.88rem;cursor:pointer;font-family:'DM Sans',sans-serif;color:#5A5A5A">Annuler</button>
        </div>
      </div>`);
  },

  gp_openReferral() {
    const u = store.get('user', {});
    const code = 'GP-' + (u.name || 'USER').toUpperCase().replace(/\s+/g,'').slice(0,6).padEnd(6,'0');
    const refs = parseInt(localStorage.getItem('gp_refs') || '0');
    this.gpModal(`
      <div style="font-size:1.05rem;font-weight:900;color:#1A1A1A;margin-bottom:22px;display:flex;align-items:center;justify-content:space-between">
        <span>Parrainer un ami</span>
        <button onclick="G.gpCloseModal()" style="border:none;background:rgba(0,0,0,.06);border-radius:50%;width:32px;height:32px;cursor:pointer;font-size:1rem;display:flex;align-items:center;justify-content:center;flex-shrink:0">✕</button>
      </div>
      <div style="background:linear-gradient(135deg,#0A4A2E,#16A34A);border-radius:16px;padding:24px;text-align:center;margin-bottom:20px">
        <div style="font-size:.6rem;color:rgba(255,255,255,.6);text-transform:uppercase;letter-spacing:.15em;margin-bottom:8px">Ton code de parrainage</div>
        <div style="font-size:1.6rem;font-weight:900;color:#fff;letter-spacing:.12em;font-family:'DM Mono',monospace">${code}</div>
        <div style="font-size:.68rem;color:rgba(255,255,255,.6);margin-top:6px">+500 FCFA par filleul</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">
        <div style="background:#F5F2EA;border-radius:14px;padding:16px;text-align:center">
          <div style="font-size:1.4rem;font-weight:900;color:#1A1A1A">${refs}</div>
          <div style="font-size:.6rem;color:#9A9A9A;margin-top:3px;text-transform:uppercase;letter-spacing:.08em">Invités</div>
        </div>
        <div style="background:#F5F2EA;border-radius:14px;padding:16px;text-align:center">
          <div style="font-size:1.4rem;font-weight:900;color:#16A34A">${f(refs*500)} F</div>
          <div style="font-size:.6rem;color:#9A9A9A;margin-top:3px;text-transform:uppercase;letter-spacing:.08em">Gagné</div>
        </div>
      </div>
      <div style="display:flex;gap:10px">
        <button onclick="G._shareReferral()" style="flex:1;padding:14px;border:none;border-radius:14px;background:linear-gradient(135deg,#0A4A2E,#16A34A);color:#fff;font-weight:900;font-size:.88rem;cursor:pointer;font-family:'DM Sans',sans-serif">Partager le code</button>
        <button onclick="G.gpCloseModal()" style="padding:14px 20px;border:1.5px solid rgba(0,0,0,.1);border-radius:14px;background:none;font-weight:700;font-size:.88rem;cursor:pointer;font-family:'DM Sans',sans-serif;color:#5A5A5A">Fermer</button>
      </div>`);
  },
};
