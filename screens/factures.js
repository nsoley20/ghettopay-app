import { f, $, si, esc } from '../utils.js';
import { store } from '../store.js';
import { db } from '../api.js';
import { validateAmount, validatePhone } from '../utils.js';

export const facturesScreen = {
  r_factures() {
    const bills = store.get('bills', []);
    const todo = bills.filter(b => !b.paid);
    $('bills-todo').innerHTML = todo.map(b => `
      <div class="bill-item" id="bill-${b.id}">
        <div class="bill-ic" style="background:rgba(220,38,38,.1)">${si('pay', '#dc2626', 20)}</div>
        <div><div class="bill-name">${esc(b.name)}</div><div class="bill-ref">${esc(b.ref || 'Réf: —')}</div></div>
        <div class="bill-right"><div class="bill-val">${f(b.amount)} F</div><div class="bill-due">${b.due || '—'}</div></div>
        <button onclick="G.payBill('${b.id}')" style="margin-left:8px;padding:6px 12px;background:var(--forest);color:#fff;border:none;border-radius:8px;font-size:.72rem;font-weight:700;cursor:pointer">Payer</button>
      </div>`).join('') || '<div style="padding:20px;text-align:center;color:var(--txt3);font-size:.82rem">Toutes les factures sont à jour</div>';
  },

  payBill(id) {
    const bills = store.get('bills', []);
    const b = bills.find(x => x.id == id);
    if (!b) return;
    const bal = store.get('bal', 0);
    if (b.amount > bal) { this.toast('Solde insuffisant', 'err'); return; }
    b.paid = true;
    store.set('bal', bal - b.amount);
    store.set('bills', bills);
    if (store.currentUser) {
      db.from('transactions').insert({ from_user_id: store.currentUser.id, amount: b.amount, type: 'bill', merchant_name: b.name, status: 'completed' });
      db.from('wallets').update({ balance: bal - b.amount }).eq('user_id', store.currentUser.id);
    }
    const el = $('bill-' + id);
    if (el) { el.style.transition = 'opacity .3s,transform .3s'; el.style.opacity = '0'; el.style.transform = 'translateX(40px)'; setTimeout(() => { el.remove(); this.r_factures(); }, 320); }
    else { this.r_factures(); }
    this.toast(`${b.name} payée · ${f(b.amount)} FCFA`, 'inf');
  },

  payAll() {
    const bills = store.get('bills', []).filter(b => !b.paid);
    if (!bills.length) { this.toast('Toutes les factures sont déjà payées', 'inf'); return; }
    let bal = store.get('bal', 0);
    const total = bills.reduce((s, b) => s + b.amount, 0);
    if (total > bal) { this.toast('Solde insuffisant', 'err'); return; }
    const allBills = store.get('bills', []);
    for (const b of bills) { b.paid = true; bal -= b.amount; }
    store.set('bal', bal);
    store.set('bills', allBills);
    bills.forEach(b => {
      const el = $('bill-' + b.id);
      if (el) { el.style.transition = 'opacity .3s,transform .3s'; el.style.opacity = '0'; el.style.transform = 'translateX(40px)'; }
    });
    setTimeout(() => {
      this.r_factures();
      this.ok(`${bills.length} facture${bills.length>1?'s':''} payée${bills.length>1?'s':''}`, `Total : ${f(total)} FCFA · Confirmé ✓`, () => this.go('home'));
    }, 350);
  },

  // ── RECHARGE ──
  setOp(n, on, off) { $('rch-op').value = n; $(on).classList.add('on'); $(off).classList.remove('on'); },
  setPill(el, v) { el.closest('.pills').querySelectorAll('.pill').forEach(p => p.classList.remove('on')); el.classList.add('on'); $('rch-amt').value = v; },
  setDur(el, m) { document.querySelectorAll('#mc .pill').forEach(p => p.classList.remove('on')); el.classList.add('on'); $('nc-months').value = m; this._coffreCalc(); },

  _coffreCalc() {
    const target = parseInt($('nc-target')?.value) || 0;
    const months = parseInt($('nc-months')?.value) || 3;
    const ass = $('nc-assistant');
    if (!ass) return;
    if (target <= 0) { ass.style.display = 'none'; return; }
    ass.style.display = 'block';
    const perDay = Math.ceil(target / (months * 30));
    const perWeek = Math.ceil(target / (months * 4.33));
    const perMonth = Math.ceil(target / months);
    if ($('nc-per-day')) $('nc-per-day').textContent = f(perDay) + ' F';
    if ($('nc-per-week')) $('nc-per-week').textContent = f(perWeek) + ' F';
    if ($('nc-per-month')) $('nc-per-month').textContent = f(perMonth) + ' F';
  },

  doRecharge() {
    const op = $('rch-op')?.value, ph = $('rch-phone')?.value.trim(), n = parseInt($('rch-amt')?.value) || 0;
    const rchPhoneErr = validatePhone(ph);
    if (rchPhoneErr) { this.toast(rchPhoneErr, 'err'); return; }
    const bal = store.get('bal', 0);
    const rchAmtErr = validateAmount(n, bal);
    if (rchAmtErr) { this.toast(rchAmtErr, 'err'); return; }
    store.set('bal', bal - n);
    if (store.currentUser) {
      db.from('wallets').update({ balance: bal - n }).eq('user_id', store.currentUser.id);
      db.from('transactions').insert({ from_user_id: store.currentUser.id, amount: n, type: 'recharge', merchant_name: `Recharge ${op}`, status: 'completed' });
    }
    this.ok('Recharge effectuée', `${f(n)} FCFA de crédit ${op}`, () => this.go('home'));
  },
};
