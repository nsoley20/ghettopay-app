import { f, $, esc, validatePhone, validateAmount } from '../utils.js';
import { store } from '../store.js';
import { db } from '../api.js';

const DIR_LABELS = {
  gp_to_airtel: { from: 'GhettoPay', to: 'Airtel Money', op: 'Airtel Money', color: '#E8252A', bg: 'rgba(232,37,42,.08)', ph: '+241 06/07 XX XX XX' },
  airtel_to_gp: { from: 'Airtel Money', to: 'GhettoPay', op: 'Airtel Money', color: '#E8252A', bg: 'rgba(232,37,42,.08)', ph: '+241 06/07 XX XX XX' },
  gp_to_moov:   { from: 'GhettoPay', to: 'Moov Money', op: 'Moov Money', color: '#00A651', bg: 'rgba(0,166,81,.08)', ph: '+241 07 XX XX XX' },
  moov_to_gp:   { from: 'Moov Money', to: 'GhettoPay', op: 'Moov Money', color: '#00A651', bg: 'rgba(0,166,81,.08)', ph: '+241 07 XX XX XX' },
};

export const transfertScreen = {
  _transferDir: 'gp_to_airtel',

  r_transfert() {
    this._transferDir = 'gp_to_airtel';
    this._syncTabs();
    this._renderTransfertForm();
  },

  setTransfertDir(dir) {
    this._transferDir = dir;
    this._syncTabs();
    this._renderTransfertForm();
  },

  _syncTabs() {
    document.querySelectorAll('.tr-tab').forEach(t => t.classList.remove('on'));
    const active = $('tr-tab-' + this._transferDir);
    if (active) active.classList.add('on');
  },

  _renderTransfertForm() {
    const dir = this._transferDir;
    const d = DIR_LABELS[dir];
    const isFromGp = dir === 'gp_to_airtel' || dir === 'gp_to_moov';
    const bal = store.get('bal', 0);

    const box = $('tr-form-box');
    if (!box) return;

    box.innerHTML = `
      <div style="background:${d.bg};border:1.5px solid ${d.color}33;border-radius:16px;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:.88rem;font-weight:900;color:var(--txt)">${d.from}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${d.color}" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg>
          <span style="font-size:.88rem;font-weight:900;color:var(--txt)">${d.to}</span>
        </div>
        ${isFromGp ? `<div style="font-size:.65rem;color:var(--txt3)">Solde : <strong style="color:var(--forest)">${f(bal)} F</strong></div>` : ''}
      </div>

      <div class="lbl">Numéro ${d.op}</div>
      <input id="tr-phone" class="inp" type="tel" placeholder="${d.ph}" autocomplete="tel"/>

      <div class="lbl">Montant (FCFA)</div>
      <div class="pills" style="flex-wrap:wrap;gap:8px">
        <div class="pill" onclick="G._setTrPill(this,1000)">1 000</div>
        <div class="pill" onclick="G._setTrPill(this,2000)">2 000</div>
        <div class="pill" onclick="G._setTrPill(this,5000)">5 000</div>
        <div class="pill" onclick="G._setTrPill(this,10000)">10 000</div>
        <div class="pill" onclick="G._setTrPill(this,25000)">25 000</div>
      </div>
      <input id="tr-amount" class="inp" type="number" inputmode="numeric" placeholder="Ou saisir un montant…"/>

      <div style="background:var(--bg2);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:6px">
        <div style="display:flex;justify-content:space-between;font-size:.72rem">
          <span style="color:var(--txt3)">Frais de transfert</span>
          <span style="color:var(--txt);font-weight:700">1%</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:.72rem">
          <span style="color:var(--txt3)">Délai</span>
          <span style="color:var(--green);font-weight:700">Instantané</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:.72rem">
          <span style="color:var(--txt3)">Plafond par opération</span>
          <span style="color:var(--txt);font-weight:700">500 000 FCFA</span>
        </div>
      </div>

      <button class="btn btn-gold" onclick="G._doTransfert()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        Envoyer maintenant
      </button>
    `;
  },

  _setTrPill(el, val) {
    document.querySelectorAll('#tr-form-box .pill').forEach(p => p.classList.remove('on'));
    el.classList.add('on');
    const inp = $('tr-amount');
    if (inp) inp.value = val;
  },

  async _doTransfert() {
    const phone = $('tr-phone')?.value.trim();
    const amount = parseInt($('tr-amount')?.value) || 0;
    const dir = this._transferDir;
    const d = DIR_LABELS[dir];
    const isFromGp = dir === 'gp_to_airtel' || dir === 'gp_to_moov';

    const phoneErr = validatePhone(phone);
    if (phoneErr) { this.toast(phoneErr, 'err'); return; }
    if (amount < 500) { this.toast('Minimum 500 FCFA', 'err'); return; }
    if (amount > 500000) { this.toast('Maximum 500 000 FCFA par transfert', 'err'); return; }

    const fee = Math.round(amount * 0.01);
    const total = isFromGp ? amount + fee : amount;

    if (isFromGp) {
      const bal = store.get('bal', 0);
      if (total > bal) {
        this.toast(`Solde insuffisant · Besoin de ${f(total)} FCFA (montant + frais)`, 'err');
        return;
      }
    }

    this.toast('Traitement en cours…', 'inf');

    if (isFromGp && store.currentUser) {
      const bal = store.get('bal', 0);
      await Promise.all([
        db.from('transactions').insert({
          from_user_id: store.currentUser.id,
          amount,
          type: 'mobile_money',
          merchant_name: `${d.op} · ${phone}`,
          status: 'pending'
        }),
        db.from('wallets').update({ balance: bal - total }).eq('user_id', store.currentUser.id)
      ]).catch(() => {});
      store.set('bal', bal - total);
    }

    setTimeout(() => {
      this.ok(
        `${f(amount)} FCFA ${isFromGp ? 'envoyés' : 'en cours de réception'}`,
        `${d.from} → ${d.to} · ${esc(phone)} · Frais ${f(fee)} FCFA · En cours de traitement`,
        () => this.go('home')
      );
    }, 1200);
  },
};
