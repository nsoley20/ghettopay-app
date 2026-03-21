/* ═══════════════════════════════════════════════════
   GHETTOPAY — Application Logic
   Toutes les données sont persistées dans localStorage
═══════════════════════════════════════════════════ */

const GP = {

  /* ── STORAGE ─────────────────────────────────── */
  save(key, val) {
    try { localStorage.setItem('gp_' + key, JSON.stringify(val)); } catch(e) {}
  },
  load(key, def) {
    try {
      const v = localStorage.getItem('gp_' + key);
      return v !== null ? JSON.parse(v) : def;
    } catch(e) { return def; }
  },

  /* ── DEFAULT DATA ────────────────────────────── */
  init() {
    // First time setup
    if (!this.load('initialized', false)) {
      this.save('user', {
        name: 'Rostand Moussavou',
        phone: '+241 06 12 34 56',
        pin: '1234',
        avatar: 'R',
        location: 'Libreville',
        verified: true,
        level: 'Gold'
      });
      this.save('balance', 680000);
      this.save('coffre_balance', 245000);
      this.save('cashback', 8200);
      this.save('contacts', [
        { id: 1, name: 'Amina Nzamba',    phone: '+241 06 11 22 33', avatar: 'A', color: 'linear-gradient(135deg,#c8960e,#0d3d1f)', favorite: true },
        { id: 2, name: 'Jean-Paul Ekang', phone: '+241 07 44 55 66', avatar: 'J', color: 'linear-gradient(135deg,#4f46e5,#818cf8)', favorite: true },
        { id: 3, name: 'Mireille Obame',  phone: '+241 06 77 88 99', avatar: 'M', color: 'linear-gradient(135deg,#059669,#34d399)', favorite: false },
        { id: 4, name: 'Serge Koumba',    phone: '+241 07 33 22 11', avatar: 'S', color: 'linear-gradient(135deg,#7c3aed,#a78bfa)', favorite: false },
        { id: 5, name: 'Patricia Moanda', phone: '+241 06 55 44 33', avatar: 'P', color: 'linear-gradient(135deg,#0284c7,#38bdf8)', favorite: false },
        { id: 6, name: 'Cédric Nguema',   phone: '+241 07 66 77 88', avatar: 'C', color: 'linear-gradient(135deg,#d97706,#fbbf24)', favorite: false },
      ]);
      this.save('transactions', [
        { id: 1,  type:'credit', category:'transfer',  icon:'recv',  name:'Amina Nzamba',      amount:25000,  note:'Remboursement dîner', date:'2024-11-25T09:30:00', method:'transfer' },
        { id: 2,  type:'debit',  category:'shopping',  icon:'pay',   name:'Market Mbolo',       amount:12000,  note:'Courses semaine',     date:'2024-11-25T11:15:00', method:'qr' },
        { id: 3,  type:'debit',  category:'mobile',    icon:'phone', name:'Airtel Recharge',    amount:5000,   note:'Crédit téléphone',    date:'2024-11-24T18:30:00', method:'app' },
        { id: 4,  type:'credit', category:'tontine',   icon:'users', name:'Jean-Paul Ekang',    amount:50000,  note:'Tontine Famille',     date:'2024-11-24T09:00:00', method:'transfer' },
        { id: 5,  type:'debit',  category:'bills',     icon:'zap',   name:'SEEG Électricité',   amount:28000,  note:'Facture novembre',    date:'2024-11-22T14:00:00', method:'app' },
        { id: 6,  type:'credit', category:'cashback',  icon:'star',  name:'Cashback Gabon Vert',amount:1200,   note:'Achat partenaire',    date:'2024-11-22T14:01:00', method:'auto' },
        { id: 7,  type:'debit',  category:'transfer',  icon:'send',  name:'Mireille Obame',     amount:15000,  note:'',                    date:'2024-11-21T16:00:00', method:'transfer' },
        { id: 8,  type:'debit',  category:'bills',     icon:'drop',  name:'SEEG Eau',           amount:18500,  note:'Facture octobre',     date:'2024-11-20T10:00:00', method:'app' },
        { id: 9,  type:'credit', category:'transfer',  icon:'recv',  name:'Serge Koumba',       amount:75000,  note:'Part appartement',    date:'2024-11-19T08:00:00', method:'transfer' },
        { id: 10, type:'debit',  category:'shopping',  icon:'pay',   name:'Boulangerie du Soleil',amount:3500, note:'Pain et viennoiseries',date:'2024-11-18T07:30:00', method:'qr' },
      ]);
      this.save('coffres', [
        { id: 1, name:'Voyage en France', icon:'target', color:'#c8960e', target:250000, saved:180000, deadline:'2024-12-15', rate:5.5, locked:true },
        { id: 2, name:"Fond d'urgence",   icon:'shield', color:'#22c55e', target:150000, saved:65000,  deadline:'2025-03-01', rate:5.5, locked:true },
      ]);
      this.save('tontines', [
        { id: 1, name:'Famille Moussavou',       avatar:'F', color:'linear-gradient(135deg,#7c3aed,#a78bfa)', members:8,  paid:5, amount:400000, cycle:'Mensuel',   deadline:'2024-12-15', myTurn:true  },
        { id: 2, name:'Amis Lycée Omar Bongo',   avatar:'A', color:'linear-gradient(135deg,#0284c7,#38bdf8)', members:5,  paid:4, amount:250000, cycle:'Mensuel',   deadline:'2024-11-30', myTurn:false },
        { id: 3, name:'Collègues GhettoCorp',    avatar:'C', color:'linear-gradient(135deg,#d97706,#fbbf24)', members:12, paid:4, amount:60000,  cycle:'Hebdo',     deadline:'2024-11-29', myTurn:false },
      ]);
      this.save('notifications', [
        { id:1, type:'credit', icon:'recv',   title:'+25 000 FCFA reçus',         desc:'Amina Nzamba t\'a envoyé 25 000 FCFA',                 time:'Il y a 2h',    read:false },
        { id:2, type:'coffre', icon:'lock',   title:'Coffre — Objectif 72%',      desc:'Ton coffre "Voyage en France" est à 72%',              time:'Il y a 5h',    read:false },
        { id:3, type:'tontine',icon:'users',  title:'Jean-Paul a cotisé',         desc:'50 000 FCFA reçus · Tontine Famille Moussavou',        time:'Lun 09h14',    read:true  },
        { id:4, type:'cashback',icon:'star',  title:'Cashback +1 200 FCFA',       desc:'Tu as reçu du cashback chez un partenaire Gabon Vert', time:'Lun 08h02',    read:true  },
        { id:5, type:'bill',   icon:'bell',   title:'Facture SEEG à payer',       desc:'Facture eau 18 500 FCFA due le 30 novembre',           time:'Dimanche',     read:true  },
      ]);
      this.save('bills', [
        { id:1, name:'SEEG — Eau',        icon:'drop',  color:'#3b82f6', ref:'0241-4521', amount:18500, due:'2024-11-30', paid:false },
        { id:2, name:'SEEG — Électricité',icon:'zap',   color:'#c8960e', ref:'0241-7823', amount:28000, due:'2024-12-05', paid:false },
        { id:3, name:'Internet Moov',     icon:'wifi',  color:'#22c55e', ref:'AUTO-3312', amount:15000, due:'2024-12-01', paid:false },
      ]);
      this.save('initialized', true);
    }

    // Register SW
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  },

  /* ── GETTERS ─────────────────────────────────── */
  getUser()         { return this.load('user', {}); },
  getBalance()      { return this.load('balance', 0); },
  getCoffreBalance(){ return this.load('coffre_balance', 0); },
  getCashback()     { return this.load('cashback', 0); },
  getContacts()     { return this.load('contacts', []); },
  getTransactions() { return this.load('transactions', []); },
  getCoffres()      { return this.load('coffres', []); },
  getTontines()     { return this.load('tontines', []); },
  getNotifications(){ return this.load('notifications', []); },
  getBills()        { return this.load('bills', []); },
  getUnreadCount()  { return this.getNotifications().filter(n => !n.read).length; },

  /* ── ACTIONS ─────────────────────────────────── */
  sendMoney(contactId, amount, note) {
    const bal = this.getBalance();
    if (amount > bal) return { ok: false, msg: 'Solde insuffisant' };
    const contact = this.getContacts().find(c => c.id === contactId);
    if (!contact) return { ok: false, msg: 'Destinataire introuvable' };
    this.save('balance', bal - amount);
    const txs = this.getTransactions();
    txs.unshift({
      id: Date.now(), type:'debit', category:'transfer', icon:'send',
      name: contact.name, amount, note: note || '',
      date: new Date().toISOString(), method:'transfer'
    });
    this.save('transactions', txs);
    return { ok: true, msg: `${fmt(amount)} FCFA envoyés à ${contact.name}` };
  },

  receiveQR(merchant, amount) {
    const bal = this.getBalance();
    if (amount > bal) return { ok: false, msg: 'Solde insuffisant' };
    this.save('balance', bal - amount);
    const txs = this.getTransactions();
    txs.unshift({
      id: Date.now(), type:'debit', category:'shopping', icon:'pay',
      name: merchant, amount, note:'Paiement QR Code',
      date: new Date().toISOString(), method:'qr'
    });
    this.save('transactions', txs);
    return { ok: true, msg: `${fmt(amount)} FCFA payés à ${merchant}` };
  },

  payBill(billId) {
    const bills = this.getBills();
    const bill = bills.find(b => b.id === billId && !b.paid);
    if (!bill) return { ok: false, msg: 'Facture introuvable' };
    const bal = this.getBalance();
    if (bill.amount > bal) return { ok: false, msg: 'Solde insuffisant' };
    this.save('balance', bal - bill.amount);
    bill.paid = true;
    this.save('bills', bills);
    const txs = this.getTransactions();
    txs.unshift({
      id: Date.now(), type:'debit', category:'bills', icon:'home',
      name: bill.name, amount: bill.amount, note:'Facture payée',
      date: new Date().toISOString(), method:'app'
    });
    this.save('transactions', txs);
    return { ok: true, msg: `${bill.name} payée — ${fmt(bill.amount)} FCFA` };
  },

  addToCoffre(coffreId, amount) {
    const bal = this.getBalance();
    if (amount > bal) return { ok: false, msg: 'Solde insuffisant' };
    const coffres = this.getCoffres();
    const coffre = coffres.find(c => c.id === coffreId);
    if (!coffre) return { ok: false, msg: 'Coffre introuvable' };
    this.save('balance', bal - amount);
    coffre.saved = Math.min(coffre.saved + amount, coffre.target);
    this.save('coffres', coffres);
    this.save('coffre_balance', coffres.reduce((s, c) => s + c.saved, 0));
    const txs = this.getTransactions();
    txs.unshift({
      id: Date.now(), type:'debit', category:'coffre', icon:'lock',
      name: 'Coffre — ' + coffre.name, amount, note:'Versement coffre',
      date: new Date().toISOString(), method:'app'
    });
    this.save('transactions', txs);
    return { ok: true, msg: `${fmt(amount)} FCFA versés dans "${coffre.name}"` };
  },

  addCoffre(name, target, months) {
    const coffres = this.getCoffres();
    const deadline = new Date();
    deadline.setMonth(deadline.getMonth() + months);
    coffres.push({
      id: Date.now(), name, icon:'target', color:'#c8960e',
      target, saved: 0,
      deadline: deadline.toISOString().split('T')[0],
      rate: 5.5, locked: true
    });
    this.save('coffres', coffres);
    return { ok: true, msg: `Coffre "${name}" créé avec succès` };
  },

  cotiserTontine(tontineId, amount) {
    const bal = this.getBalance();
    if (amount > bal) return { ok: false, msg: 'Solde insuffisant' };
    const tontines = this.getTontines();
    const t = tontines.find(t => t.id === tontineId);
    if (!t) return { ok: false, msg: 'Tontine introuvable' };
    this.save('balance', bal - amount);
    t.paid = Math.min(t.paid + 1, t.members);
    this.save('tontines', tontines);
    const txs = this.getTransactions();
    txs.unshift({
      id: Date.now(), type:'debit', category:'tontine', icon:'users',
      name: 'Tontine — ' + t.name, amount, note:'Cotisation',
      date: new Date().toISOString(), method:'app'
    });
    this.save('transactions', txs);
    return { ok: true, msg: `Cotisation envoyée — ${t.name}` };
  },

  markAllRead() {
    const notifs = this.getNotifications();
    notifs.forEach(n => n.read = true);
    this.save('notifications', notifs);
  },

  rechargeAirtime(operator, phone, amount) {
    const bal = this.getBalance();
    if (amount > bal) return { ok: false, msg: 'Solde insuffisant' };
    this.save('balance', bal - amount);
    const txs = this.getTransactions();
    txs.unshift({
      id: Date.now(), type:'debit', category:'mobile', icon:'phone',
      name: `${operator} — ${phone}`, amount, note:'Recharge airtime',
      date: new Date().toISOString(), method:'app'
    });
    this.save('transactions', txs);
    return { ok: true, msg: `${fmt(amount)} FCFA de crédit ${operator} envoyés` };
  },

  updateProfile(data) {
    const user = this.getUser();
    Object.assign(user, data);
    this.save('user', user);
    return { ok: true };
  }
};

/* ── UTILS ───────────────────────────────────────── */
function fmt(n) {
  return Number(n).toLocaleString('fr-FR');
}
function timeAgo(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60)    return 'À l\'instant';
  if (diff < 3600)  return `Il y a ${Math.floor(diff/60)}min`;
  if (diff < 86400) return `Il y a ${Math.floor(diff/3600)}h`;
  const days = Math.floor(diff/86400);
  if (days === 1) return 'Hier';
  return d.toLocaleDateString('fr-FR', { day:'numeric', month:'short' });
}
function iconSVG(name, color, size) {
  const sz = size || 18;
  const icons = {
    send:   '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
    recv:   '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    pay:    '<rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>',
    lock:   '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    phone:  '<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
    users:  '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    star:   '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    zap:    '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    drop:   '<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>',
    home:   '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    wifi:   '<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 16 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>',
    bell:   '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    check:  '<polyline points="20 6 9 17 4 12"/>',
    trend:  '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
  };
  const d = icons[name] || icons.star;
  return `<svg width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="none" stroke="${color||'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
}

/* ── ROUTER ──────────────────────────────────────── */
const Router = {
  current: 'home',
  history: [],
  go(screen, data) {
    const prev = document.getElementById('sc-' + this.current);
    const next = document.getElementById('sc-' + screen);
    if (!next || screen === this.current) return;
    prev?.classList.add('leaving');
    next.classList.add('active');
    setTimeout(() => { prev?.classList.remove('leaving','active'); }, 400);
    this.history.push({ screen: this.current, data: App.pageData });
    this.current = screen;
    App.pageData = data || {};
    App.render(screen);
  },
  back() {
    if (!this.history.length) return;
    const { screen, data } = this.history.pop();
    const leaving = document.getElementById('sc-' + this.current);
    const arriving = document.getElementById('sc-' + screen);
    leaving.style.cssText = 'transition:transform .32s cubic-bezier(.32,.72,0,1),opacity .28s;transform:translateX(100%);opacity:0;';
    arriving.classList.add('active');
    arriving.style.cssText = 'transition:transform .32s cubic-bezier(.32,.72,0,1),opacity .28s;transform:translateX(-8%);opacity:0;';
    setTimeout(() => {
      arriving.style.transform = 'translateX(0)';
      arriving.style.opacity = '1';
    }, 10);
    setTimeout(() => {
      leaving.classList.remove('active');
      leaving.style.cssText = '';
      arriving.style.cssText = '';
    }, 360);
    this.current = screen;
    App.pageData = data || {};
    App.render(screen);
  }
};

/* ── APP RENDERER ────────────────────────────────── */
const App = {
  balVisible: true,
  pageData: {},
  amtStr: '',
  selContact: null,
  pinBuffer: '',
  authenticated: false,

  render(screen) {
    const fn = this['render_' + screen];
    if (fn) fn.call(this);
  },

  toast(msg, type) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show ' + (type || 'success');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 3200);
  },

  success(title, sub, cb) {
    document.getElementById('ov-title').textContent = title;
    document.getElementById('ov-sub').textContent = sub || '';
    document.getElementById('overlay').classList.add('on');
    this._ovCb = cb;
  },

  closeOverlay() {
    document.getElementById('overlay').classList.remove('on');
    if (this._ovCb) { this._ovCb(); this._ovCb = null; }
    this.render(Router.current);
  },

  /* ─── HOME ───────────────────────────────────── */
  render_home() {
    const bal = GP.getBalance();
    const coffre = GP.getCoffreBalance();
    const unread = GP.getUnreadCount();
    const txs = GP.getTransactions().slice(0, 6);

    document.getElementById('bal-amount').innerHTML = this.balVisible
      ? `<span class="bc">FCFA </span>${fmt(bal)}`
      : `<span class="bc">FCFA </span>••• •••`;
    document.getElementById('bal-sub').textContent = this.balVisible
      ? `+ Coffre : ${fmt(coffre)} FCFA`
      : `+ Coffre : ••• •••`;

    // Unread badge
    const badge = document.getElementById('notif-badge');
    badge.textContent = unread;
    badge.style.display = unread > 0 ? 'flex' : 'none';

    // Transactions
    const list = document.getElementById('tx-list');
    list.innerHTML = txs.map(tx => `
      <div class="tx-item">
        <div class="tx-av" style="background:${txColor(tx)}">
          ${iconSVG(tx.icon, 'white', 15)}
        </div>
        <div class="tx-info">
          <div class="tx-name">${tx.name}</div>
          <div class="tx-meta">${txLabel(tx.category)} · ${timeAgo(tx.date)}</div>
        </div>
        <div class="tx-right">
          <div class="tx-amount ${tx.type}">${tx.type==='credit'?'+':'-'}${fmt(tx.amount)}</div>
          <div class="tx-cat">FCFA</div>
        </div>
      </div>
    `).join('');
  },

  /* ─── SEND ───────────────────────────────────── */
  render_send() {
    const contacts = GP.getContacts();
    this.amtStr = '';
    this.selContact = null;
    document.getElementById('amt-disp').textContent = '0';
    document.getElementById('send-rec-row').style.display = 'none';
    document.getElementById('send-note').value = '';

    const grid = document.getElementById('contact-grid');
    grid.innerHTML = contacts.map(c => `
      <div class="contact-chip" onclick="App.pickContact(${c.id})">
        <div class="contact-av" id="cav-${c.id}" style="background:${c.color}">${c.avatar}</div>
        <div class="contact-name">${c.name.split(' ')[0]}</div>
      </div>
    `).join('');
  },

  pickContact(id) {
    const contacts = GP.getContacts();
    const c = contacts.find(c => c.id === id);
    if (!c) return;
    this.selContact = c;
    document.querySelectorAll('.contact-av').forEach(a => a.classList.remove('selected'));
    document.getElementById('cav-' + id)?.classList.add('selected');
    const row = document.getElementById('send-rec-row');
    row.style.display = 'flex';
    document.getElementById('rec-av').style.background = c.color;
    document.getElementById('rec-av').textContent = c.avatar;
    document.getElementById('rec-name').textContent = c.name;
    document.getElementById('rec-phone').textContent = c.phone;
  },

  kp(v) {
    if (v === 'del') this.amtStr = this.amtStr.slice(0, -1);
    else if (this.amtStr.length < 8) this.amtStr += v;
    const n = parseInt(this.amtStr) || 0;
    document.getElementById('amt-disp').textContent = fmt(n);
  },

  doSend() {
    const n = parseInt(this.amtStr) || 0;
    if (!this.selContact) { this.toast('Choisis un destinataire', 'error'); return; }
    if (n <= 0) { this.toast('Saisis un montant', 'error'); return; }
    const note = document.getElementById('send-note')?.value || '';
    const res = GP.sendMoney(this.selContact.id, n, note);
    if (!res.ok) { this.toast(res.msg, 'error'); return; }
    this.success(`${fmt(n)} FCFA envoyés`, `À ${this.selContact.name} · Confirmé instantanément`, () => Router.go('home'));
  },

  /* ─── QR ─────────────────────────────────────── */
  render_qr() {
    const user = GP.getUser();
    document.getElementById('qr-user-name').textContent = user.name;
    document.getElementById('qr-user-phone').textContent = user.phone;
  },

  doQRPay() {
    const merchant = document.getElementById('qr-merchant-input')?.value || 'Commerçant';
    const amount = parseInt(document.getElementById('qr-amount-input')?.value) || 0;
    if (!merchant) { this.toast('Nom du commerçant requis', 'error'); return; }
    if (amount <= 0) { this.toast('Montant requis', 'error'); return; }
    const res = GP.receiveQR(merchant, amount);
    if (!res.ok) { this.toast(res.msg, 'error'); return; }
    this.success('Paiement confirmé', res.msg, () => Router.go('home'));
  },

  /* ─── COFFRE ─────────────────────────────────── */
  render_coffre() {
    const coffres = GP.getCoffres();
    const total = coffres.reduce((s, c) => s + c.saved, 0);
    document.getElementById('coffre-total').textContent = fmt(total) + ' FCFA';

    const list = document.getElementById('coffre-list');
    list.innerHTML = coffres.map(c => {
      const pct = Math.round(c.saved / c.target * 100);
      return `
      <div class="coffre-item" onclick="App.openCoffre(${c.id})">
        <div class="ci-head">
          <div class="ci-ic" style="background:${c.color}22;border:1px solid ${c.color}33">
            ${iconSVG(c.icon, c.color, 17)}
          </div>
          <div>
            <div class="ci-name">${c.name}</div>
            <div class="ci-dl">Déblocage · ${fmtDate(c.deadline)}</div>
          </div>
          <div class="ci-right">
            <div class="ci-val">${fmt(c.saved)}</div>
            <div class="ci-rate">+${c.rate}%/an</div>
          </div>
        </div>
        <div class="ci-bar-bg"><div class="ci-bar" style="width:${pct}%;background:${c.color}"></div></div>
        <div class="ci-bar-labels"><span>${fmt(c.saved)} / ${fmt(c.target)} FCFA</span><span style="color:${c.color};font-weight:700">${pct}%</span></div>
      </div>`;
    }).join('');
  },

  openCoffre(id) {
    Router.go('coffre-detail', { coffreId: id });
  },

  render_coffre_detail() {
    const id = this.pageData.coffreId;
    const coffres = GP.getCoffres();
    const c = coffres.find(c => c.id === id);
    if (!c) return;
    const pct = Math.round(c.saved / c.target * 100);
    document.getElementById('cd-title').textContent = c.name;
    document.getElementById('cd-saved').textContent = fmt(c.saved);
    document.getElementById('cd-target').textContent = fmt(c.target);
    document.getElementById('cd-pct').textContent = pct + '%';
    document.getElementById('cd-rate').textContent = c.rate + '%/an';
    document.getElementById('cd-dl').textContent = fmtDate(c.deadline);
    document.getElementById('cd-bar').style.width = pct + '%';
    document.getElementById('cd-bar').style.background = c.color;
  },

  addToCoffre() {
    const id = this.pageData.coffreId;
    const n = parseInt(document.getElementById('cd-input')?.value) || 0;
    if (n <= 0) { this.toast('Saisis un montant', 'error'); return; }
    const res = GP.addToCoffre(id, n);
    if (!res.ok) { this.toast(res.msg, 'error'); return; }
    this.success('Versement enregistré', res.msg, () => Router.go('coffre'));
  },

  showNewCoffre() {
    document.getElementById('new-coffre-modal').classList.add('on');
  },
  closeNewCoffre() {
    document.getElementById('new-coffre-modal').classList.remove('on');
  },
  createCoffre() {
    const name = document.getElementById('nc-name')?.value?.trim();
    const target = parseInt(document.getElementById('nc-target')?.value) || 0;
    const months = parseInt(document.getElementById('nc-months')?.value) || 6;
    if (!name) { this.toast('Donne un nom au coffre', 'error'); return; }
    if (target <= 0) { this.toast('Définis un objectif', 'error'); return; }
    const res = GP.addCoffre(name, target, months);
    this.closeNewCoffre();
    this.success('Coffre créé', res.msg, () => Router.go('coffre'));
  },

  /* ─── BUDGET ─────────────────────────────────── */
  render_budget() {
    const txs = GP.getTransactions();
    const now = new Date();
    const thisMonth = txs.filter(t => {
      const d = new Date(t.date);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
    const debits = thisMonth.filter(t => t.type === 'debit');
    const credits = thisMonth.filter(t => t.type === 'credit');
    const totalOut = debits.reduce((s, t) => s + t.amount, 0);
    const totalIn = credits.reduce((s, t) => s + t.amount, 0);

    document.getElementById('bud-out').textContent = fmt(totalOut) + ' FCFA';
    document.getElementById('bud-in').textContent = fmt(totalIn) + ' FCFA';

    // Categories
    const cats = {};
    debits.forEach(t => {
      cats[t.category] = (cats[t.category] || 0) + t.amount;
    });
    const catDefs = {
      bills:    { label:'Logement & factures', icon:'home',  color:'#22c55e' },
      shopping: { label:'Courses & marché',    icon:'pay',   color:'#c8960e' },
      mobile:   { label:'Mobile & internet',   icon:'phone', color:'#818cf8' },
      transfer: { label:'Transferts',          icon:'send',  color:'#fb923c' },
      tontine:  { label:'Tontines',           icon:'users', color:'#a855f7' },
      coffre:   { label:'Coffre',             icon:'lock',  color:'#0ea5e9' },
    };
    const total = totalOut || 1;
    const catList = document.getElementById('cat-list');
    catList.innerHTML = Object.entries(cats).map(([key, amt]) => {
      const def = catDefs[key] || { label: key, icon:'star', color:'#888' };
      const pct = Math.round(amt / total * 100);
      return `
      <div class="cat-item">
        <div class="cat-ic" style="background:${def.color}18">${iconSVG(def.icon, def.color, 16)}</div>
        <div class="cat-name">${def.label}</div>
        <div class="cat-bar-wrap"><div class="cat-bar-fill" style="width:${pct}%;background:${def.color}"></div></div>
        <div class="cat-right">
          <div class="cat-val">${fmt(amt)}</div>
          <div class="cat-pct">${pct}%</div>
        </div>
      </div>`;
    }).join('') || '<div style="text-align:center;padding:16px;color:var(--appsub);font-size:.78rem">Aucune dépense ce mois</div>';

    // All tx list
    const allList = document.getElementById('all-tx-list');
    allList.innerHTML = txs.slice(0, 20).map(tx => `
      <div class="tx-item">
        <div class="tx-av" style="background:${txColor(tx)}">${iconSVG(tx.icon,'white',15)}</div>
        <div class="tx-info">
          <div class="tx-name">${tx.name}</div>
          <div class="tx-meta">${txLabel(tx.category)} · ${timeAgo(tx.date)}</div>
        </div>
        <div class="tx-right">
          <div class="tx-amount ${tx.type}">${tx.type==='credit'?'+':'-'}${fmt(tx.amount)}</div>
          <div class="tx-cat">FCFA</div>
        </div>
      </div>`).join('');
  },

  /* ─── TONTINE ────────────────────────────────── */
  render_tontine() {
    const tontines = GP.getTontines();
    const list = document.getElementById('tontine-list');
    list.innerHTML = tontines.map(t => {
      const pct = Math.round(t.paid / t.members * 100);
      return `
      <div class="tontine-item">
        <div class="tnt-head">
          <div class="tnt-av" style="background:${t.color}">${t.avatar}</div>
          <div>
            <div class="tnt-name">${t.name}</div>
            <div class="tnt-members">${t.members} membres · ${t.cycle}</div>
          </div>
          <div class="tnt-amount">
            <div class="tnt-val">${fmt(t.amount)}</div>
            <div class="tnt-cycle">FCFA/cycle</div>
          </div>
        </div>
        ${t.myTurn ? `<div class="tnt-turn-badge">C'est ton tour de recevoir !</div>` : ''}
        <div class="tnt-bar-bg"><div class="tnt-bar" style="width:${pct}%;background:${t.color.includes('gradient') ? 'var(--green2)' : t.color}"></div></div>
        <div class="tnt-footer"><span>${t.paid} / ${t.members} ont cotisé</span><span>Échéance : ${fmtDate(t.deadline)}</span></div>
        <button class="tnt-btn" onclick="App.cotiser(${t.id})">Cotiser maintenant</button>
      </div>`;
    }).join('');
  },

  cotiser(id) {
    const t = GP.getTontines().find(t => t.id === id);
    if (!t) return;
    const perPerson = Math.round(t.amount / t.members);
    const res = GP.cotiserTontine(id, perPerson);
    if (!res.ok) { this.toast(res.msg, 'error'); return; }
    this.success('Cotisation envoyée', res.msg, () => Router.go('tontine'));
  },

  /* ─── FACTURES ───────────────────────────────── */
  render_factures() {
    const bills = GP.getBills();
    const unpaid = bills.filter(b => !b.paid);
    const paid = bills.filter(b => b.paid);

    const renderBill = (b, canPay) => `
      <div class="bill-item ${b.paid ? 'paid' : ''}">
        <div class="bill-ic" style="background:${b.color}18">${iconSVG(b.icon, b.color, 19)}</div>
        <div>
          <div class="bill-name">${b.name}</div>
          <div class="bill-ref">Réf : ${b.ref}</div>
        </div>
        <div class="bill-right">
          <div class="bill-val">${fmt(b.amount)}</div>
          <div class="bill-due ${b.paid ? 'ok' : ''}">${b.paid ? 'Payée' : 'Dû le ' + fmtDate(b.deadline)}</div>
        </div>
        ${canPay && !b.paid ? `<button class="bill-pay-btn" onclick="App.payBill(${b.id})">Payer</button>` : ''}
      </div>`;

    document.getElementById('bills-unpaid').innerHTML = unpaid.length
      ? unpaid.map(b => renderBill(b, true)).join('')
      : '<div class="bills-empty">Aucune facture en attente</div>';

    document.getElementById('bills-paid').innerHTML = paid.length
      ? paid.map(b => renderBill(b, false)).join('')
      : '';
  },

  payBill(id) {
    const res = GP.payBill(id);
    if (!res.ok) { this.toast(res.msg, 'error'); return; }
    this.success('Facture payée', res.msg, () => Router.go('factures'));
  },

  payAllBills() {
    const unpaid = GP.getBills().filter(b => !b.paid);
    if (!unpaid.length) { this.toast('Aucune facture en attente', 'info'); return; }
    let allOk = true;
    let msg = '';
    unpaid.forEach(b => {
      const res = GP.payBill(b.id);
      if (!res.ok) allOk = false;
      else msg = res.msg;
    });
    if (!allOk) { this.toast('Solde insuffisant pour tout payer', 'error'); this.render('factures'); return; }
    this.success('Toutes les factures payées', `${unpaid.length} factures réglées`, () => Router.go('factures'));
  },

  /* ─── RECHARGE ───────────────────────────────── */
  render_recharge() {},

  doRecharge() {
    const op = document.getElementById('rch-op')?.value;
    const phone = document.getElementById('rch-phone')?.value?.trim();
    const amount = parseInt(document.getElementById('rch-amount')?.value) || 0;
    if (!phone) { this.toast('Saisis un numéro', 'error'); return; }
    if (amount <= 0) { this.toast('Choisis un montant', 'error'); return; }
    const res = GP.rechargeAirtime(op, phone, amount);
    if (!res.ok) { this.toast(res.msg, 'error'); return; }
    this.success('Recharge effectuée', res.msg, () => Router.go('home'));
  },

  /* ─── NOTIFS ─────────────────────────────────── */
  render_notifications() {
    const notifs = GP.getNotifications();
    const list = document.getElementById('notif-list');
    const ic = { recv:'#22c55e', lock:'#c8960e', users:'#818cf8', star:'#fb923c', bell:'#dc2626' };
    list.innerHTML = notifs.map(n => `
      <div class="notif-item ${n.read ? '' : 'unread'}">
        <div class="notif-ic" style="background:${(ic[n.icon]||'#888')}18">${iconSVG(n.icon, ic[n.icon]||'#888', 16)}</div>
        <div class="notif-body">
          <div class="notif-title">${n.title}</div>
          <div class="notif-desc">${n.desc}</div>
          <div class="notif-time">${n.time}</div>
        </div>
      </div>`).join('');
  },

  markAllRead() {
    GP.markAllRead();
    this.render('notifications');
    document.getElementById('notif-badge').style.display = 'none';
    this.toast('Toutes les notifications lues', 'success');
  },

  /* ─── PROFIL ─────────────────────────────────── */
  render_profil() {
    const user = GP.getUser();
    const cashback = GP.getCashback();
    const txCount = GP.getTransactions().length;
    document.getElementById('prof-av').textContent = user.avatar;
    document.getElementById('prof-name').textContent = user.name;
    document.getElementById('prof-phone').textContent = user.phone;
    document.getElementById('prof-loc').textContent = user.location;
    document.getElementById('prof-level').textContent = user.level;
    document.getElementById('prof-tx-count').textContent = txCount;
    document.getElementById('prof-cashback').textContent = fmt(cashback);
  },

  showEditProfile() {
    const user = GP.getUser();
    document.getElementById('ep-name').value = user.name;
    document.getElementById('ep-phone').value = user.phone;
    document.getElementById('ep-location').value = user.location;
    document.getElementById('edit-profile-modal').classList.add('on');
  },
  closeEditProfile() {
    document.getElementById('edit-profile-modal').classList.remove('on');
  },
  saveProfile() {
    const name = document.getElementById('ep-name')?.value?.trim();
    const phone = document.getElementById('ep-phone')?.value?.trim();
    const location = document.getElementById('ep-location')?.value?.trim();
    if (!name) { this.toast('Le nom est requis', 'error'); return; }
    GP.updateProfile({ name, phone, location, avatar: name[0].toUpperCase() });
    this.closeEditProfile();
    this.render('profil');
    this.toast('Profil mis à jour', 'success');
  },

  /* ─── PIN SCREEN ─────────────────────────────── */
  render_pin() {
    this.pinBuffer = '';
    document.getElementById('pin-dots').innerHTML = Array(4).fill('<div class="pin-dot"></div>').join('');
  },

  pinKey(v) {
    if (this.pinBuffer.length >= 4) return;
    this.pinBuffer += v;
    const dots = document.querySelectorAll('.pin-dot');
    dots.forEach((d, i) => d.classList.toggle('filled', i < this.pinBuffer.length));
    if (this.pinBuffer.length === 4) this.checkPin();
  },

  pinDel() {
    this.pinBuffer = this.pinBuffer.slice(0, -1);
    const dots = document.querySelectorAll('.pin-dot');
    dots.forEach((d, i) => d.classList.toggle('filled', i < this.pinBuffer.length));
  },

  checkPin() {
    const user = GP.getUser();
    setTimeout(() => {
      if (this.pinBuffer === user.pin) {
        this.authenticated = true;
        Router.history = [];
        Router.go('home');
      } else {
        this.pinBuffer = '';
        document.querySelectorAll('.pin-dot').forEach(d => {
          d.classList.remove('filled');
          d.classList.add('error');
          setTimeout(() => d.classList.remove('error'), 600);
        });
        this.toast('PIN incorrect', 'error');
      }
    }, 200);
  }
};

/* ── HELPERS ─────────────────────────────────────── */
function txColor(tx) {
  const m = {
    transfer:'linear-gradient(135deg,#c8960e,#0d3d1f)',
    shopping:'linear-gradient(135deg,#4f46e5,#818cf8)',
    mobile:  'linear-gradient(135deg,#dc2626,#f59e0b)',
    tontine: 'linear-gradient(135deg,#0284c7,#38bdf8)',
    bills:   'linear-gradient(135deg,#059669,#34d399)',
    cashback:'linear-gradient(135deg,#d97706,#fbbf24)',
    coffre:  'linear-gradient(135deg,#c8960e,#fcd34d)',
  };
  return m[tx.category] || 'linear-gradient(135deg,#666,#999)';
}
function txLabel(cat) {
  return {
    transfer:'Transfert', shopping:'Paiement QR', mobile:'Recharge',
    tontine:'Tontine', bills:'Facture', cashback:'Cashback', coffre:'Coffre'
  }[cat] || cat;
}
function fmtDate(str) {
  if (!str) return '';
  const d = new Date(str);
  return d.toLocaleDateString('fr-FR', { day:'numeric', month:'short', year:'numeric' });
}

/* ── BOOT ────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => {
  GP.init();
  document.getElementById('sc-pin').classList.add('active');
  Router.current = 'pin';
  App.render('pin');

  // Clock
  function tick() {
    const now = new Date();
    const h = now.getHours().toString().padStart(2,'0');
    const m = now.getMinutes().toString().padStart(2,'0');
    document.querySelectorAll('.clock').forEach(el => el.textContent = h + ':' + m);
  }
  tick(); setInterval(tick, 30000);
});
