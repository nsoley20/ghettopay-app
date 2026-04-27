import { $ } from './utils.js';
import { store } from './store.js';
import { db } from './api.js';
import { homeScreen } from './screens/home.js';
import { budgetScreen } from './screens/budget.js';
import { facturesScreen } from './screens/factures.js';
import { notifsScreen } from './screens/notifs.js';
import { coffreScreen } from './screens/coffre.js';
import { tontineScreen } from './screens/tontine.js';
import { sendScreen } from './screens/send.js';
import { transfertScreen } from './screens/transfert.js';
import { profilScreen } from './screens/profil.js';
import { authScreen, loadUserData } from './screens/auth.js';
import { desktopScreen } from './screens/desktop.js';


// ── DÉMARRAGE ──
async function appStart() {
  try {
    if (window.innerWidth >= 1280) G.renderDesktopHome();
    const { data: { session } } = await db.auth.getSession();
    if (session) {
      await loadUserData(session.user.id);
      G.go('pin');
    } else {
      G.go('onboard');
    }
  } catch(e) {
    console.error('appStart error:', e);
    G.go('onboard');
  } finally {
    $('sc-loading').classList.remove('on');
  }
}

// ── NAVIGATION ──
const G = {
  go(scr) {
    // Stopper la caméra si on quitte l'écran scan
    if (store.cur === 'scan' && scr !== 'scan') G.stopScan();
    const p = $('sc-' + store.cur), n = $('sc-' + scr);
    if (!n) return;
    if (p) p.classList.remove('on');
    n.classList.add('on');
    // Ne pas empiler les écrans d'auth dans l'historique
    const noHist = ['onboard', 'login', 'pin'];
    if (store.cur !== scr && !noHist.includes(store.cur)) store.hist.push(store.cur);
    store.cur = scr;
    G.render(scr);
    // Mettre à jour navbar
    document.querySelectorAll('.bt').forEach(b => b.classList.remove('on'));
    const map = { home: 0, budget: 1, coffre: 3, profil: 4 };
    if (map[scr] !== undefined) {
      document.querySelectorAll('.bt')[map[scr]]?.classList.add('on');
    }
  },

  back() {
    const scr = store.hist.length ? store.hist.pop() : 'home';
    // Navigation directe sans passer par go() pour ne pas re-empiler dans store.hist
    if (store.cur === 'scan' && scr !== 'scan') G.stopScan();
    const p = $('sc-' + store.cur), n = $('sc-' + scr);
    if (!n) return;
    if (p) p.classList.remove('on');
    n.classList.add('on');
    store.cur = scr;
    G.render(scr);
    document.querySelectorAll('.bt').forEach(b => b.classList.remove('on'));
    const map = { home: 0, budget: 1, coffre: 3, profil: 4 };
    if (map[scr] !== undefined) document.querySelectorAll('.bt')[map[scr]]?.classList.add('on');
  },

  render(scr) {
    const renders = {
      home: () => G.r_home(),
      login: () => G.r_login?.(),
      send: () => G.r_send(),
      transfert: () => G.r_transfert(),
      coffre: () => G.r_coffre(),
      budget: () => G.r_budget(),
      tontine: () => G.r_tontine(),
      'tontine-detail': () => G.r_tontine_detail(),
      factures: () => G.r_factures(),
      recv: () => G.r_recv(),
      qrhub: () => G.r_qrhub(),
      scan: () => G.r_scan(),
      notifs: () => G.r_notifs(),
      profil: () => G.r_profil(),
      qr: () => G.r_qr(),
    };
    renders[scr]?.();
  },


  // ── OVERLAY / TOAST / MODAL ──
  _okCb: null,
  ok(title, sub, cb) {
    if (window.innerWidth >= 1280) { G.toast(title, 'ok'); if (cb) setTimeout(cb, 400); return; }
    $('ov-title').textContent = title;
    $('ov-sub').textContent = sub || '';
    $('overlay').classList.add('on');
    G._okCb = cb || null;
  },
  closeOk() {
    $('overlay').classList.remove('on');
    if (G._okCb) { G._okCb(); G._okCb = null; }
    else G.render(store.cur);
  },
  toast(msg, type) {
    const t = $('toast-el');
    t.textContent = msg;
    t.className = 'toast ' + (type || '') + ' on';
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove('on'), 3000);
  },

  showModal(id) { const el = $(id); if (el) el.classList.add('on'); },
  closeModal(id) {
    const el = $(id); if (el) el.classList.remove('on');
    const gpOv = $('gp-modal'); if (gpOv && gpOv.style.display !== 'none') gpOv.style.display = 'none';
  },

};

Object.assign(G, homeScreen, budgetScreen, facturesScreen, notifsScreen, coffreScreen, tontineScreen, sendScreen, transfertScreen, profilScreen, authScreen, desktopScreen);

window.G = G;
window.setBudTab = btn => G.setBudTab(btn);

appStart();

// ── HORLOGE ──
function tick() {
  const n = new Date();
  const t = `${n.getHours().toString().padStart(2, '0')}:${n.getMinutes().toString().padStart(2, '0')}`;
  document.querySelectorAll('[id^="clk"]').forEach(el => el.textContent = t);
}
tick();
setInterval(tick, 30000);

// ── DARK MODE INIT ──
(function(){
  const isDark = localStorage.getItem('gp_dark') === '1';
  if (isDark) document.documentElement.classList.add('dark');
  // Defer UI update until DOM ready
  document.addEventListener('DOMContentLoaded', () => G._updateDarkUI(isDark), { once: true });
  // If already loaded, update immediately
  if (document.readyState !== 'loading') G._updateDarkUI(isDark);
})();

// ── BIOMETRIC INIT ──
(function(){
  if (localStorage.getItem('gp_bio_id') && window.PublicKeyCredential) {
    const btn = document.getElementById('pin-bio-btn');
    if (btn) btn.style.display = '';
  }
})();

// ── JOIN TONTINE VIA URL ──
(function(){
  const p = new URLSearchParams(location.search);
  const joinId = p.get('join');
  if (joinId) {
    history.replaceState(null, '', location.pathname);
    setTimeout(() => {
      if (store.currentUser) {
        G.openTontine(joinId);
      } else {
        G.toast('Connecte-toi pour rejoindre cette tontine', 'inf');
      }
    }, 2000);
  }
})();

// ── PAYER VIA LIEN QR ──
(function(){
  const p = new URLSearchParams(location.search);
  const phone = p.get('phone');
  const name = p.get('name') || phone;
  if (phone) {
    history.replaceState(null, '', location.pathname);
    setTimeout(async () => {
      if (!store.currentUser) { G.toast('Connecte-toi pour envoyer de l\'argent', 'inf'); return; }
      const { data: found } = await db.from('users').select('id,name').eq('phone', phone).maybeSingle();
      if (!found) { G.toast('Cet utilisateur n\'est pas encore sur GhettoPay', 'err'); return; }
      const nm = found.name || name;
      store.selC = { id: found.id, name: nm, phone, av: (nm[0] || '?').toUpperCase() };
      G.go('send');
      setTimeout(() => {
        if ($('rec-av')) $('rec-av').textContent = store.selC.av;
        if ($('rec-name')) $('rec-name').textContent = store.selC.name;
        if ($('rec-phone')) $('rec-phone').textContent = store.selC.phone;
        if ($('rec-row')) $('rec-row').style.display = 'flex';
      }, 200);
    }, 2000);
  }
})();

// ── PWA INSTALL ──
let dp;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); dp = e;
  setTimeout(() => $('install-banner')?.classList.add('on'), 4000);
});
$('install-btn')?.addEventListener('click', async () => {
  $('install-banner').classList.remove('on');
  if (dp) { dp.prompt(); await dp.userChoice; dp = null; }
});

