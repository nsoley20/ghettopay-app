import { f, $, esc, validateAmount, validateName } from '../utils.js';
import { store } from '../store.js';
import { db } from '../api.js';

export const coffreScreen = {
  r_coffre() {
    const cbal = store.get('coffre', 0);
    $('coffre-total').textContent = f(cbal) + ' FCFA';
    this.r_coffreList();
  },

  r_coffreList() {
    const cached = store.get('coffres', []);
    this._renderCoffreList(cached);

    if (!store.currentUser) return;
    db.from('coffres').select('*').eq('user_id', store.currentUser.id).order('created_at', { ascending: false })
      .then(({ data }) => {
        if (!data) return;
        store.set('coffres', data);
        this._renderCoffreList(data);
        const total = data.reduce((s, c) => s + (c.saved || 0), 0);
        store.set('coffre', total);
        if ($('coffre-total')) $('coffre-total').textContent = f(total) + ' FCFA';
      }).catch(() => {});
  },

  _renderCoffreList(coffres) {
    if (!$('coffre-list')) return;
    if (!coffres.length) {
      $('coffre-list').innerHTML = '<div style="text-align:center;padding:32px 16px;color:var(--txt3);font-size:.82rem">Aucun coffre. Crée le tien !</div>';
      return;
    }

    const nowDate = new Date();
    $('coffre-list').innerHTML = coffres.map(c => {
      const pct = c.target > 0 ? Math.round((c.saved / c.target) * 100) : 0;
      const unlockDate = c.unlock_date ? new Date(c.unlock_date) : null;
      const isLocked = unlockDate && unlockDate > nowDate;
      const unlockStr = unlockDate ? unlockDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
      let calHTML = '';
      if (unlockDate) {
        const totalMonths = Math.max(1, Math.ceil((unlockDate - nowDate) / (30.5 * 24 * 3600 * 1000)));
        const cappedMonths = Math.min(totalMonths, 12);
        const dots = Array.from({length: cappedMonths}, (_, i) => {
          const md = new Date(nowDate); md.setMonth(md.getMonth() + i);
          const mname = md.toLocaleDateString('fr-FR', {month:'short'});
          const isLast = i === cappedMonths - 1;
          return `<div style="display:flex;flex-direction:column;align-items:center;gap:3px;flex-shrink:0">
            <div style="width:${isLast?'10px':'8px'};height:${isLast?'10px':'8px'};border-radius:50%;background:${isLast?'var(--gold)':i===0?'var(--green)':'var(--bg3)'};border:${isLast?'2px solid var(--gold2)':'none'}"></div>
            <span style="font-size:.4rem;color:var(--txt3);font-family:var(--fm)">${mname}</span>
          </div>`;
        }).join('');
        const monthsLeft = Math.max(0, Math.ceil((unlockDate - nowDate) / (30.5 * 24 * 3600 * 1000)));
        calHTML = `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
          <div style="font-size:.55rem;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;font-family:var(--fm)">Calendrier · ${monthsLeft} mois restant${monthsLeft>1?'s':''}</div>
          <div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:2px;align-items:flex-end">${dots}${totalMonths>12?`<div style="font-size:.55rem;color:var(--txt3);align-self:center;margin-left:2px">+${totalMonths-12}</div>`:''}</div>
        </div>`;
      }

      const lockBadge = isLocked
        ? `<div style="display:inline-flex;align-items:center;gap:5px;background:rgba(10,74,46,.09);border:1px solid rgba(10,74,46,.18);border-radius:100px;padding:3px 10px;font-size:.55rem;font-weight:800;color:var(--forest);font-family:var(--fm);text-transform:uppercase;letter-spacing:.06em">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><use href="#lock"/></svg>Verrouillé
           </div>`
        : `<div style="display:inline-flex;align-items:center;gap:5px;background:rgba(22,163,74,.09);border:1px solid rgba(22,163,74,.18);border-radius:100px;padding:3px 10px;font-size:.55rem;font-weight:800;color:var(--green);font-family:var(--fm);text-transform:uppercase;letter-spacing:.06em">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><use href="#chk"/></svg>Déverrouillé
           </div>`;

      const buttons = isLocked
        ? `<button class="btn btn-ghost" style="flex:1;font-size:.75rem" onclick="G.depositCoffre('${esc(c.id)}','${esc(c.name)}')">
             <svg><use href="#plus"/></svg>Ajouter des fonds
           </button>
           <button disabled style="padding:0 14px;border:1px solid rgba(0,0,0,.1);border-radius:12px;background:rgba(0,0,0,.04);color:var(--txt3);font-size:.75rem;font-weight:700;flex-shrink:0;cursor:not-allowed;display:flex;align-items:center;gap:6px">
             <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="#lock"/></svg>Verrouillé
           </button>`
        : `<button class="btn btn-ghost" style="flex:1;font-size:.75rem" onclick="G._withdrawCoffre('${esc(c.id)}')">
             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="#recv"/></svg>Retirer les fonds
           </button>
           <button onclick="G.deleteCoffre('${esc(c.id)}','${esc(c.name)}')" style="padding:0 14px;border:1px solid rgba(220,38,38,.2);border-radius:12px;background:rgba(220,38,38,.07);color:#dc2626;font-size:.75rem;font-weight:700;cursor:pointer;flex-shrink:0">Supprimer</button>`;

      return `<div class="coffre-item">
        <div class="ci-head">
          <div class="ci-ic" style="background:rgba(10,74,46,.1)"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="var(--forest)" stroke-width="1.9"><use href="#lock"/></svg></div>
          <div style="flex:1">
            <div class="ci-name">${esc(c.name)}</div>
            <div class="ci-dl">Déblocage : ${esc(unlockStr)}</div>
            <div style="margin-top:4px">${lockBadge}</div>
          </div>
          <div class="ci-right"><div class="ci-val">${f(c.saved)} F</div><div class="ci-rate">${pct}% atteint</div></div>
        </div>
        <div class="ci-bar-bg"><div class="ci-bar" style="width:${pct}%;background:${isLocked ? 'var(--forest)' : 'var(--green)'}"></div></div>
        <div class="ci-bar-lbls"><span>${f(c.saved)} FCFA épargnés</span><span>Objectif : ${f(c.target)} FCFA</span></div>
        ${calHTML}
        <div style="display:flex;gap:8px;margin-top:10px">${buttons}</div>
      </div>`;
    }).join('');
  },

  async createCoffre() {
    const name = $('nc-name')?.value.trim();
    const target = parseInt($('nc-target')?.value) || 0;
    const months = parseInt($('nc-months')?.value) || 6;
    const nameErr = validateName(name);
    if (nameErr) { this.toast(nameErr, 'err'); return; }

    const unlockDate = new Date();
    unlockDate.setMonth(unlockDate.getMonth() + months);

    if (store.currentUser) {
      const { error } = await db.from('coffres').insert({
        user_id: store.currentUser.id, name, target, saved: 0,
        unlock_date: unlockDate.toISOString().split('T')[0]
      });
      if (error) { this.toast('Erreur création coffre', 'err'); return; }
    } else {
      const coffres = store.get('coffres', []);
      coffres.unshift({ id: Date.now().toString(), name, target, saved: 0, unlock_date: unlockDate.toISOString().split('T')[0] });
      store.set('coffres', coffres);
    }

    this.closeModal('mc');
    const ncn = $('nc-name'); if (ncn) ncn.value = '';
    const nct = $('nc-target'); if (nct) nct.value = '';
    this.r_coffre();
    if (window.innerWidth >= 1280) this.gp_renderCoffre();
    this.toast('Coffre créé !', 'ok');
  },

  async deleteCoffre(coffreId, name) {
    const coffres = store.get('coffres', []);
    const c = coffres.find(x => String(x.id) === String(coffreId));
    const unlockDate = c?.unlock_date ? new Date(c.unlock_date) : null;
    if (unlockDate && unlockDate > new Date()) {
      const dateStr = unlockDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
      this.toast(`Coffre verrouillé jusqu'au ${dateStr}`, 'err');
      return;
    }
    if (!confirm(`Supprimer le coffre "${name}" ? Les fonds seront remboursés sur ton solde.`)) return;
    const saved = c?.saved || 0;
    if (store.currentUser) {
      await db.from('coffres').delete().eq('id', coffreId);
      if (saved > 0) {
        const bal = store.get('bal', 0);
        const newCoffre = Math.max(0, store.get('coffre', 0) - saved);
        await db.from('wallets').update({ balance: bal + saved, coffre_balance: newCoffre }).eq('user_id', store.currentUser.id);
        store.set('bal', bal + saved);
        store.set('coffre', newCoffre);
      }
    }
    const newCoffres = coffres.filter(x => String(x.id) !== String(coffreId));
    store.set('coffres', newCoffres);
    if (saved > 0) store.set('coffre', Math.max(0, store.get('coffre',0) - saved));
    this.r_coffre();
    this.toast('Coffre supprimé', 'inf');
  },

  async _withdrawCoffre(coffreId) {
    const coffres = store.get('coffres', []);
    const c = coffres.find(x => String(x.id) === String(coffreId));
    if (!c) { this.toast('Coffre introuvable', 'err'); return; }
    const unlockDate = c.unlock_date ? new Date(c.unlock_date) : null;
    if (unlockDate && unlockDate > new Date()) {
      const dateStr = unlockDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
      this.toast(`Coffre verrouillé jusqu'au ${dateStr}`, 'err');
      return;
    }
    const saved = c.saved || 0;
    if (saved <= 0) { this.toast('Coffre vide', 'err'); return; }
    if (!confirm(`Retirer ${f(saved)} FCFA du coffre "${c.name}" ?`)) return;
    const bal = store.get('bal', 0);
    const newCoffre = Math.max(0, store.get('coffre', 0) - saved);
    if (store.currentUser) {
      await Promise.all([
        db.from('coffres').update({ saved: 0 }).eq('id', coffreId),
        db.from('wallets').update({ balance: bal + saved, coffre_balance: newCoffre }).eq('user_id', store.currentUser.id),
        db.from('transactions').insert({ from_user_id: store.currentUser.id, amount: saved, type: 'coffre_withdraw', merchant_name: c.name, status: 'completed' })
      ]).catch(e => { this.toast('Erreur retrait : ' + (e.message||''), 'err'); return; });
    }
    store.set('bal', bal + saved);
    store.set('coffre', newCoffre);
    const updated = coffres.map(x => String(x.id)===String(coffreId) ? {...x, saved:0} : x);
    store.set('coffres', updated);
    this.r_coffre();
    if (window.innerWidth >= 1280) this.gp_renderCoffre();
    this.toast(`${f(saved)} FCFA retirés dans votre solde`, 'ok');
  },

  depositCoffre(coffreId, coffreName) {
    this._depCoffreId = coffreId;
    this._depCoffreName = coffreName;
    if ($('mdep-title')) $('mdep-title').textContent = coffreName;
    if ($('mdep-sub')) $('mdep-sub').textContent = `Ajouter des fonds dans "${coffreName}"`;
    if ($('mdep-bal')) $('mdep-bal').textContent = f(store.get('bal', 0)) + ' FCFA';
    if ($('mdep-amount')) $('mdep-amount').value = '';
    this.showModal('mdep');
    setTimeout(() => $('mdep-amount')?.focus(), 300);
  },

  async _doDeposit() {
    const coffreId = this._depCoffreId;
    const coffreName = this._depCoffreName;
    const amount = parseInt($('mdep-amount')?.value) || 0;
    const bal = store.get('bal', 0);
    const depErr = validateAmount(amount, bal);
    if (depErr) { this.toast(depErr, 'err'); return; }

    this.closeModal('mdep');

    const newCoffre = store.get('coffre', 0) + amount;
    if (store.currentUser) {
      const { data: cof } = await db.from('coffres').select('saved').eq('id', coffreId).single();
      await Promise.all([
        db.from('wallets').update({ balance: bal - amount, coffre_balance: newCoffre }).eq('user_id', store.currentUser.id),
        db.from('coffres').update({ saved: (cof?.saved || 0) + amount }).eq('id', coffreId),
        db.from('transactions').insert({ from_user_id: store.currentUser.id, amount, type: 'coffre_deposit', merchant_name: coffreName, status: 'completed' })
      ]);
      store.set('bal', bal - amount);
      store.set('coffre', newCoffre);
    } else {
      store.set('bal', bal - amount);
      store.set('coffre', newCoffre);
      const coffres = store.get('coffres', []);
      const c = coffres.find(x => x.id == coffreId);
      if (c) c.saved += amount;
      store.set('coffres', coffres);
    }

    this.r_coffre();
    if (window.innerWidth >= 1280) this.gp_renderCoffre();
    this.toast(`${f(amount)} FCFA déposés dans ${coffreName}`, 'ok');
  },
};
