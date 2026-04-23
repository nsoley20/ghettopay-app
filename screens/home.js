import { f, $, si, esc } from '../utils.js';
import { store } from '../store.js';
import { db } from '../api.js';

export const homeScreen = {
  r_home() {
    const bal = store.get('bal', 0), cbal = store.get('coffre', 0), u = store.get('user', {});
    $('home-name').textContent = (u.name || 'Utilisateur').split(' ')[0] + ' ' + ((u.name || '').split(' ')[1]?.[0] || '') + '.';
    const photo = localStorage.getItem('gp_photo');
    const hav = $('home-av');
    if (hav) {
      if (photo) { hav.textContent = ''; hav.style.backgroundImage = `url(${photo})`; hav.style.backgroundSize = 'cover'; hav.style.backgroundPosition = 'center'; }
      else { hav.style.backgroundImage = ''; hav.textContent = u.avatar || '?'; }
    }
    $('bal-amt').innerHTML = `<span class="cur">FCFA </span>${store.balVis ? f(bal) : '• • • •'}`;
    $('bal-sub').textContent = `+ Coffre : ${f(cbal)} FCFA`;
    $('cstrip-val').textContent = f(cbal);
    const unread = store.get('notifs', []).filter(n => !n.read).length;
    $('notif-dot').style.display = unread ? 'block' : 'none';
    this.r_txList();
    if (store.currentUser) {
      db.from('wallets').select('balance,coffre_balance,cashback').eq('user_id', store.currentUser.id).single()
        .then(({ data }) => {
          if (!data || store.cur !== 'home') return;
          const nb = data.balance || 0, nc = data.coffre_balance || 0;
          if (nb !== store.get('bal', 0) || nc !== store.get('coffre', 0)) {
            store.set('bal', nb); store.set('coffre', nc); store.set('cash', data.cashback || 0);
            if (store.balVis) {
              $('bal-amt').innerHTML = `<span class="cur">FCFA </span>${f(nb)}`;
              $('bal-sub').textContent = `+ Coffre : ${f(nc)} FCFA`;
            }
            $('cstrip-val').textContent = f(nc);
            this.r_txList();
          }
        }).catch(() => {});
    }
  },

  r_login() {
    setTimeout(() => { $('login-email')?.focus(); }, 350);
  },

  _txRow(isCredit, name, ico, col, bg, cat, time, amount) {
    const sign = isCredit ? '+' : '-';
    return `<div class="tx"><div class="tx-av" style="background:${bg}">${si(ico, col, 15)}</div><div class="tx-info"><div class="tx-name">${esc(name)}</div><div class="tx-meta">${esc(cat)} · ${esc(time)}</div></div><div class="tx-right"><div class="tx-amt ${isCredit?'cr':'db'}">${sign}${f(amount)} <span style="font-size:.6rem;opacity:.65">F</span></div></div></div>`;
  },

  async r_txList() {
    const empty = '<div style="padding:28px;text-align:center;color:var(--txt3);font-size:.82rem">Aucune transaction récente</div>';
    if (!store.currentUser) {
      const txs = store.get('txs', []);
      if (!txs.length) { $('tx-list').innerHTML = empty; return; }
      $('tx-list').innerHTML = txs.slice(0, 8).map(t => {
        const isCredit = t.type === 'recv';
        const ico = { recv:'recv', send:'send', qr:'qric', recharge:'phone', bill:'pay', coffre_deposit:'lock', tontine:'users' }[t.type] || 'send';
        const col = isCredit ? '#16A34A' : '#DC2626';
        const bg = isCredit ? 'rgba(22,163,74,.12)' : 'rgba(212,160,23,.12)';
        const cat = { recv:'Reçu', send:'Envoyé', qr:'QR Pay', recharge:'Recharge', bill:'Facture', coffre_deposit:'Coffre', tontine:'Tontine' }[t.type] || t.type;
        return this._txRow(isCredit, t.name || 'Inconnu', ico, col, bg, cat, t.time || '—', t.amount);
      }).join('');
      return;
    }
    const { data: txs } = await db.from('transactions')
      .select('*, from_user:from_user_id(name,avatar), to_user:to_user_id(name,avatar)')
      .or(`from_user_id.eq.${store.currentUser.id},to_user_id.eq.${store.currentUser.id}`)
      .order('created_at', { ascending: false }).limit(8);
    if (!txs?.length) { $('tx-list').innerHTML = empty; return; }
    $('tx-list').innerHTML = txs.map(t => {
      const isCredit = t.to_user_id === store.currentUser.id;
      const other = isCredit ? t.from_user : t.to_user;
      const name = other?.name || t.merchant_name || 'GhettoPay';
      const ico = { transfer: isCredit?'recv':'send', qr:'qric', recharge:'phone', bill:'pay', coffre_deposit:'lock', tontine:'users' }[t.type] || 'send';
      const col = isCredit ? '#16A34A' : '#DC2626';
      const bg = isCredit ? 'rgba(22,163,74,.12)' : 'rgba(212,160,23,.12)';
      const cat = { transfer:'Transfert', qr:'QR Pay', recharge:'Recharge', bill:'Facture', coffre_deposit:'Coffre', tontine:'Tontine' }[t.type] || t.type;
      const time = new Date(t.created_at).toLocaleDateString('fr-FR', { day:'numeric', month:'short' });
      return this._txRow(isCredit, name, ico, col, bg, cat, time, t.amount);
    }).join('');
  },

  toggleBal() {
    store.balVis = !store.balVis;
    const bal = store.get('bal', 0), cbal = store.get('coffre', 0);
    $('bal-amt').innerHTML = `<span class="cur">FCFA </span>${store.balVis ? f(bal) : '• • • •'}`;
    $('bal-sub').textContent = store.balVis ? `+ Coffre : ${f(cbal)} FCFA` : '••••••••';
    $('eye-ic').innerHTML = store.balVis ? '<use href="#eye"/>' : '<use href="#eyeoff"/>';
  },
};
