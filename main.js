import { f, $, si, esc, tryCatch, validateAmount, validatePhone, validateName } from './utils.js';
import { store } from './store.js';
import { db } from './api.js';
import { homeScreen } from './screens/home.js';
import { budgetScreen } from './screens/budget.js';
import { facturesScreen } from './screens/factures.js';
import { notifsScreen } from './screens/notifs.js';
import { coffreScreen } from './screens/coffre.js';
import { tontineScreen } from './screens/tontine.js';


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

// ── CHARGER LES DONNÉES UTILISATEUR ──
async function loadUserData(authId) {
  let { data: user } = await db.from('users').select('*').eq('auth_id', authId).single();

  if (!user) {
    // Tenter de compléter l'inscription avec les données en attente
    const p = store.get('pending_reg', null);
    if (p && authId) {
      const { data: newUser, error } = await db.from('users').insert({
        auth_id: authId, phone: p.phone, name: p.name,
        avatar: p.avatar, pin_code: String(p.pin), email: p.email,
        location: 'Libreville, Gabon', level: 'Silver'
      }).select().single();
      if (!error && newUser) {
        await db.from('wallets').insert({ user_id: newUser.id, balance: 10000, coffre_balance: 0, cashback: 0 });
        store.set('pending_reg', null);
        user = newUser;
      }
    }
    // Si toujours pas de user DB → garder les données locales existantes (ne pas effacer)
    if (!user) return;
  }

  const { data: wallet } = await db.from('wallets').select('*').eq('user_id', user.id).single();
  store.currentUser = { ...user, wallet };

  // pin_code peut être int ou string selon la DB → toujours stocker en string
  store.set('user', { name: user.name, phone: user.phone, pin: String(user.pin_code || ''), avatar: user.avatar, loc: user.location, level: user.level });
  store.set('bal', wallet?.balance || 0);
  store.set('cash', wallet?.cashback || 0);
  // Recalculer le total coffre depuis les coffres réels (non-bloquant)
  store.set('coffre', wallet?.coffre_balance || 0);
  db.from('coffres').select('saved').eq('user_id', user.id)
    .then(({ data: userCoffres }) => {
      if (!userCoffres) return;
      const realCoffre = userCoffres.reduce((s, c) => s + (c.saved || 0), 0);
      store.set('coffre', realCoffre);
      if (wallet && realCoffre !== (wallet.coffre_balance || 0)) {
        db.from('wallets').update({ coffre_balance: realCoffre }).eq('user_id', user.id).catch(() => {});
      }
      if (window.innerWidth >= 1280) G.renderDesktopHome();
    }).catch(() => {});

  // Charger la photo de profil depuis Supabase si disponible et pas encore en cache local
  if (user.avatar_url && !localStorage.getItem('gp_photo')) {
    localStorage.setItem('gp_photo', user.avatar_url);
  }

  // Mettre à jour le dashboard desktop si visible
  if (window.innerWidth >= 1280) {
    setTimeout(() => G.renderDesktopHome(), 100);
  }

  // ── REALTIME : écouter les changements de solde du wallet ──
  if (store.walletChannel) { db.removeChannel(store.walletChannel); store.walletChannel = null; }
  store.walletChannel = db.channel('wallet_' + user.id)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'wallets', filter: `user_id=eq.${user.id}` }, payload => {
      const d = payload.new;
      const nb = d.balance || 0, nc = d.coffre_balance || 0;
      store.set('bal', nb); store.set('coffre', nc); store.set('cash', d.cashback || 0);
      if (store.currentUser?.wallet) { store.currentUser.wallet.balance = nb; store.currentUser.wallet.coffre_balance = nc; }
      if (store.cur === 'home') {
        if (store.balVis) {
          $('bal-amt').innerHTML = `<span class="cur">FCFA </span>${f(nb)}`;
          $('bal-sub').textContent = `+ Coffre : ${f(nc)} FCFA`;
        }
        $('cstrip-val').textContent = f(nc);
      }
      // Mettre à jour les cartes du dashboard desktop en temps réel
      if (window.innerWidth >= 1280) G.renderDesktopHome();
    })
    .subscribe();
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
      login: () => G.r_login(),
      send: () => G.r_send(),
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

  // ── SEND ──
  r_send() {
    store.aStr = '';
    $('amt-disp').textContent = '0';
    // Si un contact est déjà sélectionné (ex: depuis scan QR), le conserver
    if (!store.selC) {
      $('rec-row').style.display = 'none';
    } else {
      if ($('rec-av')) $('rec-av').textContent = store.selC.av;
      if ($('rec-name')) $('rec-name').textContent = store.selC.name;
      if ($('rec-phone')) $('rec-phone').textContent = store.selC.phone;
      if ($('rec-row')) $('rec-row').style.display = 'flex';
    }
    G.r_contacts();
  },

  async r_contacts() {
    G._allContacts = [];
    G._contactMap = {};
    if (!store.currentUser) {
      G._allContacts = store.get('contacts', []);
    } else {
      const { data: users } = await db.from('users').select('id,name,avatar,phone').neq('id', store.currentUser.id).limit(30);
      G._allContacts = users || [];
      (users||[]).forEach(u => G._contactMap[u.id] = u);
    }
    G._renderContacts(G._allContacts);
  },

  _renderContacts(list) {
    if (!list?.length) {
      $('contact-grid').innerHTML = '<div style="color:var(--txt3);font-size:.78rem;padding:4px 0">Aucun utilisateur trouvé</div>';
      return;
    }
    const grads = ['linear-gradient(135deg,#0A4A2E,#16A34A)','linear-gradient(135deg,#7c3aed,#a78bfa)','linear-gradient(135deg,#0284c7,#38bdf8)','linear-gradient(135deg,#d97706,#fcd34d)','linear-gradient(135deg,#dc2626,#f87171)'];
    $('contact-grid').innerHTML = list.map((u, i) => {
      const av = u.avatar || u.av || (u.name||'?')[0].toUpperCase();
      const nm = (u.name||'').split(' ')[0];
      return `<div class="contact" onclick="G.selContact('${esc(u.id)}')"><div class="c-av" style="background:${u.bg||grads[i%grads.length]}">${esc(av)}</div><div class="c-name">${esc(nm)}</div></div>`;
    }).join('');
  },

  filterContacts(q) {
    if (!q) { G._renderContacts(G._allContacts); return; }
    const filtered = (G._allContacts||[]).filter(u => (u.name||'').toLowerCase().includes(q.toLowerCase()) || (u.phone||'').includes(q));
    G._renderContacts(filtered);
  },

  selContact(id) {
    let c = G._contactMap?.[id] || (store.get('contacts',[])).find(x => x.id === id) || (G._allContacts||[]).find(x => x.id === id);
    if (!c) return;
    store.selC = { id: c.id, name: c.name, phone: c.phone||'', av: c.avatar || c.av || (c.name||'?')[0].toUpperCase() };
    $('rec-av').textContent = store.selC.av;
    $('rec-name').textContent = store.selC.name;
    $('rec-phone').textContent = store.selC.phone;
    $('rec-row').style.display = 'flex';
  },

  kp(v) {
    if (v === 'del') { store.aStr = store.aStr.slice(0, -1); }
    else if (store.aStr.length < 9) { store.aStr += v; }
    const n = parseInt(store.aStr) || 0;
    $('amt-disp').textContent = f(n);
    const fee = Math.round(n * 0.015);
    const fd = $('fee-disp');
    if (fd) fd.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#15803d" stroke-width="2.5"><use href="#chk"/></svg>Frais : ${fee > 0 ? f(fee) + ' FCFA (1,5%)' : '0 FCFA'}`;
  },

  _pendingSend: null, _mpcBuf: '',
  async doSend() {
    if (!store.selC) { G.toast('Choisis un destinataire', 'err'); return; }
    const n = parseInt(store.aStr) || 0;
    const bal = store.get('bal', 0);
    const amtErr = validateAmount(n, bal, { withFee: true });
    if (amtErr) { G.toast(amtErr, 'err'); return; }
    const fee = Math.round(n * 0.015);
    const total = n + fee;
    const note = $('send-note')?.value || '';

    // PIN confirmation si montant > 100 000 FCFA
    const PIN_THRESHOLD = 100000;
    if (n >= PIN_THRESHOLD && store.get('user', {}).pin) {
      G._pendingSend = { store.selC, n, fee, total, bal, note };
      G._mpcBuf = '';
      G._mpcUpdateDots();
      if ($('mpc-desc')) $('mpc-desc').textContent = `Transfert de ${f(n)} FCFA à ${store.selC.name} — Entre ton PIN pour valider`;
      G.showModal('m-pin-confirm');
      return;
    }

    if (store.currentUser) {
      G.toast('Envoi en cours...', 'inf');
      const { data, error } = await db.rpc('transfer_money', {
        p_from_user_id: store.currentUser.id, p_to_user_id: store.selC.id, p_amount: n, p_note: note
      });
      if (error || !data?.success) { G.toast(data?.error || 'Erreur de transfert', 'err'); return; }
      const newBal = bal - total;
      store.set('bal', newBal);
      if (store.currentUser.wallet) store.currentUser.wallet.balance = newBal;
    } else {
      store.set('bal', bal - total);
      const txs = store.get('txs', []);
      txs.unshift({ id: Date.now(), name: store.selC.name, av: store.selC.av, amount: n, fee, type: 'send', cat: 'Transfert', time: "À l'instant" });
      store.set('txs', txs);
    }
    G.ok(`${f(n)} FCFA envoyés`, `À ${store.selC.name} · Frais ${f(fee)} FCFA · Confirmé ✓`, () => G.go('home'));
  },

  // ── QR HUB ──
  r_qrhub() { /* écran statique, rien à charger */ },

  // ── SCANNER QR ──
  _scanStream: null, _scanInterval: null,

  r_scan() {
    // Reset UI
    if ($('scan-start-btn')) $('scan-start-btn').style.display = 'flex';
    if ($('scan-status')) $('scan-status').textContent = '';
    if ($('scan-hint')) $('scan-hint').textContent = 'Place le QR code dans le cadre — détection automatique';
    if ($('scan-line')) $('scan-line').style.display = 'block';
    // Auto-start si l'API est disponible
    if (navigator.mediaDevices?.getUserMedia) G.startCamera();
  },

  startCamera() {
    const video = $('scan-video');
    const canvas = $('scan-canvas');
    if (!video) return;

    G._scanActive = true;
    if ($('scan-start-btn')) $('scan-start-btn').style.display = 'none';
    if ($('scan-status')) $('scan-status').textContent = 'Démarrage…';

    if (!navigator.mediaDevices?.getUserMedia) {
      if ($('scan-status')) $('scan-status').textContent = 'Caméra indisponible';
      if ($('scan-hint')) $('scan-hint').textContent = 'Utilise la saisie manuelle ci-dessous';
      return;
    }

    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } })
      .then(stream => {
        // Utilisateur déjà parti — stopper la stream immédiatement
        if (!G._scanActive) { stream.getTracks().forEach(t => t.stop()); return; }
        G._scanStream = stream;
        video.srcObject = stream;
        video.onloadedmetadata = () => {
          video.play().then(() => {
            if (!G._scanActive) { G.stopScan(); return; }
            if ($('scan-status')) $('scan-status').textContent = 'Actif';
            G._scanInterval = setInterval(() => {
              if (!G._scanActive || !canvas || video.readyState < 2 || video.videoWidth === 0) return;
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(video, 0, 0);
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              if (!window.jsQR) return;
              const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
              if (code?.data) { G.stopScan(); G._handleQRResult(code.data); }
            }, 300);
          }).catch(() => G._scanError());
        };
      })
      .catch(err => {
        if (err.name === 'NotAllowedError') {
          if ($('scan-status')) $('scan-status').textContent = 'Permission refusée';
          G.toast('Autorise la caméra dans les paramètres du navigateur', 'err');
        } else {
          G._scanError();
        }
      });
  },

  _scanError() {
    if ($('scan-status')) $('scan-status').textContent = 'Caméra indisponible';
    if ($('scan-hint')) $('scan-hint').textContent = 'Utilise la saisie manuelle ci-dessous';
    if ($('scan-start-btn')) $('scan-start-btn').style.display = 'none';
  },

  stopScan() {
    G._scanActive = false;
    try { clearInterval(G._scanInterval); } catch(e) {}
    G._scanInterval = null;
    try { G._scanStream?.getTracks().forEach(t => t.stop()); } catch(e) {}
    G._scanStream = null;
  },

  async _handleQRResult(data) {
    try {
      let phone = '', name = '';
      if (data.includes('?')) {
        const qs = data.split('?')[1];
        const params = new URLSearchParams(qs);
        phone = params.get('phone') || '';
        name = params.get('name') || phone;
      } else if (/^\+?[\d\s\-]{7,}$/.test(data.trim())) {
        phone = data.trim();
        name = phone;
      }
      if (!phone) { G.toast('QR non reconnu par GhettoPay', 'err'); return; }
      // Lookup real user ID by phone — required for transfer_money RPC
      if (!store.currentUser) { G.toast('Connecte-toi pour envoyer de l\'argent', 'err'); return; }
      G.toast('Recherche du destinataire…', 'inf');
      const { data: found } = await db.from('users').select('id,name').eq('phone', phone).maybeSingle();
      if (!found) { G.toast('Cet utilisateur n\'est pas encore sur GhettoPay', 'err'); return; }
      const nm = found.name || name || phone;
      // Définir store.selC AVANT go('send') pour que r_send() le détecte
      store.selC = { id: found.id, name: nm, phone, av: (nm[0] || '?').toUpperCase() };
      G.go('send');
      G.toast(`Destinataire : ${nm}`, 'inf');
    } catch(e) {
      G.toast('QR non reconnu', 'err');
    }
  },

  async scanManualSend() {
    const phone = $('scan-phone')?.value.trim();
    const phoneErr = validatePhone(phone);
    if (phoneErr) { G.toast(phoneErr, 'err'); return; }
    if (!store.currentUser) { G.toast('Connecte-toi pour envoyer de l\'argent', 'err'); return; }
    G.toast('Recherche du destinataire…', 'inf');
    const { data: found } = await db.from('users').select('id,name').eq('phone', phone).maybeSingle();
    if (!found) { G.toast('Numéro introuvable sur GhettoPay', 'err'); return; }
    const nm = found.name || phone;
    store.selC = { id: found.id, name: nm, phone, av: (nm[0] || '?').toUpperCase() };
    G.go('send');
    setTimeout(() => {
      if ($('rec-av')) $('rec-av').textContent = store.selC.av;
      if ($('rec-name')) $('rec-name').textContent = store.selC.name;
      if ($('rec-phone')) $('rec-phone').textContent = store.selC.phone;
      if ($('rec-row')) $('rec-row').style.display = 'flex';
    }, 150);
  },

  // ── QR (paiement commerçant) ──
  r_qr() {
    if ($('qr-merchant')) $('qr-merchant').value = '';
    if ($('qr-amount')) $('qr-amount').value = '';
  },

  // ── RECEVOIR — QR personnel ──
  r_recv() {
    const u = store.get('user', {});
    if ($('recv-name')) $('recv-name').textContent = u.name || 'Utilisateur';
    if ($('recv-phone')) $('recv-phone').textContent = u.phone || '';
    if (!window.QRCode) return;
    const qrData = `${location.origin}${location.pathname}?phone=${encodeURIComponent(u.phone||'')}&name=${encodeURIComponent(u.name||'')}`;
    const qrEl = $('recv-qr-real');
    if (qrEl) {
      qrEl.innerHTML = '';
      new QRCode(qrEl, { text: qrData || 'ghettopay', width: 200, height: 200, colorDark: '#0D0D0D', colorLight: '#FFFFFF', correctLevel: QRCode.CorrectLevel.M });
    }
  },

  shareQR() {
    const u = store.get('user', {});
    const qrEl = $('recv-qr-real');
    const canvas = qrEl?.querySelector('canvas');
    const img = qrEl?.querySelector('img');
    const fname = `ghettopay-${(u.name||'qr').toLowerCase().replace(/\s+/g,'-')}.png`;
    if (canvas) {
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = fname;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      G.toast('QR téléchargé !', 'inf');
    } else if (img) {
      const a = document.createElement('a');
      a.href = img.src; a.download = fname;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      G.toast('QR téléchargé !', 'inf');
    } else {
      G.copyPayLink();
    }
  },

  copyPayLink() {
    const u = store.get('user', {});
    const link = `${location.origin}${location.pathname}?phone=${encodeURIComponent(u.phone||'')}&name=${encodeURIComponent(u.name||'')}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(link)
        .then(() => G.toast('Lien copié !', 'inf'))
        .catch(() => G.toast(link, 'inf'));
    } else {
      G.toast(link, 'inf');
    }
  },

  selManualPhone() {
    const phone = $('manual-phone')?.value.trim();
    const phoneErr2 = validatePhone(phone);
    if (phoneErr2) { G.toast(phoneErr2, 'err'); return; }
    store.selC = { id: 'manual_' + phone, name: phone, phone, av: '#' };
    $('rec-av').textContent = store.selC.av;
    $('rec-name').textContent = store.selC.name;
    $('rec-phone').textContent = store.selC.phone;
    $('rec-row').style.display = 'flex';
    if ($('manual-phone')) $('manual-phone').value = '';
    G.toast('Destinataire défini', 'inf');
  },

  async pickContact() {
    if (!('contacts' in navigator && 'ContactsManager' in window)) {
      G.toast('Non disponible sur ce navigateur', 'err'); return;
    }
    try {
      const contacts = await navigator.contacts.select(['name', 'tel'], { multiple: false });
      if (contacts?.length) {
        const c = contacts[0];
        const phone = c.tel?.[0] || '';
        const name = c.name?.[0] || phone;
        store.selC = { id: 'contact_' + phone, name, phone, av: (name[0]||'?').toUpperCase() };
        $('rec-av').textContent = store.selC.av;
        $('rec-name').textContent = store.selC.name;
        $('rec-phone').textContent = store.selC.phone;
        $('rec-row').style.display = 'flex';
      }
    } catch(e) { G.toast('Accès contacts refusé', 'err'); }
  },

  doQR() {
    const merchant = $('qr-merchant')?.value.trim();
    const amount = parseInt($('qr-amount')?.value) || 0;
    const merchantErr = validateName(merchant, { label: 'Nom du commerçant' });
    if (merchantErr) { G.toast(merchantErr, 'err'); return; }
    const bal = store.get('bal', 0);
    const qrAmtErr = validateAmount(amount, bal);
    if (qrAmtErr) { G.toast(qrAmtErr, 'err'); return; }

    if (store.currentUser) {
      // Enregistrer le paiement QR
      db.from('transactions').insert({
        from_user_id: store.currentUser.id,
        amount,
        type: 'qr',
        merchant_name: merchant,
        status: 'completed'
      }).then(({ error }) => {
        if (error) { G.toast('Erreur paiement', 'err'); return; }
        store.set('bal', bal - amount);
        G.ok(`${f(amount)} FCFA payés`, `${merchant} · Confirmé ✓`, () => G.go('home'));
      });
    } else {
      store.set('bal', bal - amount);
      G.ok(`${f(amount)} FCFA payés`, `${merchant} · Confirmé ✓`, () => G.go('home'));
    }
  },


  // ── PROFIL ──
  r_profil() {
    const u = store.get('user', {});
    const photo = localStorage.getItem('gp_photo');
    const av = $('prof-av');
    if (av) {
      if (photo) {
        av.style.backgroundImage = `url(${photo})`;
        av.style.backgroundSize = 'cover';
        av.style.backgroundPosition = 'center';
        av.textContent = '';
        // keep overlay
        const ov = document.createElement('div');
        ov.id = 'prof-av-overlay';
        ov.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,.35);border-radius:50%;display:flex;align-items:center;justify-content:center;opacity:0;transition:.2s';
        ov.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><use href="#edit"/></svg>';
        av.appendChild(ov);
      } else {
        av.style.backgroundImage = '';
        av.textContent = u.avatar || '?';
        if (!$('prof-av-overlay')) {
          const ov = document.createElement('div');
          ov.id = 'prof-av-overlay';
          ov.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,.35);border-radius:50%;display:flex;align-items:center;justify-content:center;opacity:0;transition:.2s';
          ov.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><use href="#edit"/></svg>';
          av.appendChild(ov);
        }
      }
    }
    $('prof-name').textContent = u.name || '';
    $('prof-phone').textContent = u.phone || '';
    $('prof-loc').textContent = u.loc || 'Libreville, Gabon';
    $('prof-level').textContent = u.level || 'Silver';
    $('prof-txc').textContent = store.get('txs', []).length;
    $('prof-cash').textContent = f(store.get('cash', 0));
    // Notif count
    const unread = store.get('notifs', []).filter(n => !n.read).length;
    if ($('notif-sub')) $('notif-sub').textContent = unread ? `${unread} non lue${unread > 1 ? 's' : ''}` : 'Tout lu';
    if ($('notif-dot')) $('notif-dot').style.display = unread ? 'block' : 'none';
    // Dark mode toggle state
    const isDark = document.documentElement.classList.contains('dark');
    G._updateDarkUI(isDark);
    // KYC / Limit status
    const lvl = u.level || 'Silver';
    if ($('kyc-sub')) $('kyc-sub').textContent = lvl === 'Gold' ? 'Niveau Gold · Vérifié ✓' : lvl === 'Platinum' ? 'Niveau Platinum · Vérifié ✓' : 'Niveau Silver · Compléter KYC';
    if ($('limit-sub')) $('limit-sub').textContent = lvl === 'Platinum' ? 'Illimité' : lvl === 'Gold' ? '5 000 000 FCFA/mois' : '2 000 000 FCFA/mois';
    // Referral badge
    const refs = parseInt(localStorage.getItem('gp_refs') || '0');
    if ($('ref-badge')) $('ref-badge').textContent = refs + ' invité' + (refs !== 1 ? 's' : '');
  },

  _pickProfilePhoto() {
    $('prof-photo-input')?.click();
  },
  _onProfilePhotoChosen(input) {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { G.toast('Image trop lourde (max 2 Mo)', 'err'); return; }
    const reader = new FileReader();
    reader.onload = async e => {
      const src = e.target.result;
      localStorage.setItem('gp_photo', src);
      G._applyProfilePhoto(src);
      G.toast('Photo de profil mise à jour', 'ok');
      // Persister sur Supabase Storage si connecté
      if (store.currentUser) {
        try {
          const ext = file.name.split('.').pop() || 'jpg';
          const path = `avatars/${store.currentUser.id}.${ext}`;
          const { error: upErr } = await db.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
          if (!upErr) {
            const { data: urlData } = db.storage.from('avatars').getPublicUrl(path);
            if (urlData?.publicUrl) {
              await db.from('users').update({ avatar_url: urlData.publicUrl }).eq('id', store.currentUser.id);
              store.currentUser.avatar_url = urlData.publicUrl;
            }
          }
        } catch (_) {}
      }
    };
    reader.readAsDataURL(file);
  },
  _applyProfilePhoto(src) {
    const av = $('prof-av');
    if (av) { av.style.backgroundImage = `url(${src})`; av.style.backgroundSize = 'cover'; av.style.backgroundPosition = 'center'; av.textContent = ''; }
    const hav = $('home-av');
    if (hav && src) { hav.style.backgroundImage = `url(${src})`; hav.style.backgroundSize = 'cover'; hav.style.backgroundPosition = 'center'; hav.textContent = ''; }
  },

  async saveProfile() {
    const name = $('ep-name')?.value.trim();
    const profNameErr = validateName(name, { label: 'Nom complet', min: 2 });
    if (profNameErr) { G.toast(profNameErr, 'err'); return; }
    const u = store.get('user', {});
    u.name = name;
    u.phone = $('ep-phone')?.value.trim();
    u.loc = $('ep-loc')?.value.trim();
    u.avatar = name[0].toUpperCase();
    store.set('user', u);

    if (store.currentUser) {
      await db.from('users').update({ name, phone: u.phone, location: u.loc, avatar: u.avatar }).eq('id', store.currentUser.id);
      store.currentUser.name = name;
    }

    G.closeModal('mp');
    G.render('profil');
    if (window.innerWidth >= 1280) G.gp_renderProfil();
    G.toast('Profil mis à jour', 'inf');
  },

  async logout() {
    G.toast('Déconnexion...', 'inf');
    if (store.currentUser) await db.auth.signOut();
    store.currentUser = null;
    localStorage.clear();
    setTimeout(() => G.go('onboard'), 1000);
  },

  // ── PIN (vérification) ──
  r_pin() {
    store.pinBuf = '';
    document.querySelectorAll('.pin-dot').forEach(d => d.classList.remove('fill', 'err'));
    const u = store.get('user', {});
    if ($('pin-sub')) {
      const name = (u.name || '').split(' ')[0];
      $('pin-sub').textContent = name ? `Bonjour ${name} · Saisis ton PIN` : 'Entre ton code PIN';
    }
  },

  pinKey(v) {
    if (store.pinBuf.length >= 4) return;
    store.pinBuf += v;
    document.querySelectorAll('.pin-dot').forEach((d, i) => d.classList.toggle('fill', i < store.pinBuf.length));
    if (store.pinBuf.length === 4) G._checkPin();
  },

  pinDel() {
    store.pinBuf = store.pinBuf.slice(0, -1);
    document.querySelectorAll('.pin-dot').forEach((d, i) => d.classList.toggle('fill', i < store.pinBuf.length));
  },

  _pinFailures: 0,
  _PIN_LOCKOUT_MS: 30000,
  _PIN_MAX_ATTEMPTS: 5,

  _showPinErrAnim() {
    store.pinBuf = '';
    document.querySelectorAll('.pin-dot').forEach(d => {
      d.classList.remove('fill');
      d.classList.add('err');
      setTimeout(() => d.classList.remove('err'), 600);
    });
  },

  _checkPin() {
    setTimeout(() => {
      const u = store.get('user', {});
      if (!u.pin) {
        G.toast('Session expirée, reconnecte-toi', 'err');
        setTimeout(() => { G.go('login'); }, 1200);
        return;
      }
      const now = Date.now();
      const lockedUntil = parseInt(sessionStorage.getItem('gp_pin_locked') || '0');
      if (lockedUntil > now) {
        const secs = Math.ceil((lockedUntil - now) / 1000);
        G._showPinErrAnim();
        G.toast(`Trop de tentatives · réessaie dans ${secs}s`, 'err');
        return;
      }
      if (String(store.pinBuf) === String(u.pin)) {
        G._pinFailures = 0;
        sessionStorage.removeItem('gp_pin_locked');
        store.hist = [];
        G.go('home');
      } else {
        G._pinFailures++;
        G._showPinErrAnim();
        if (G._pinFailures >= G._PIN_MAX_ATTEMPTS) {
          sessionStorage.setItem('gp_pin_locked', String(Date.now() + G._PIN_LOCKOUT_MS));
          G._pinFailures = 0;
          G.toast(`${G._PIN_MAX_ATTEMPTS} échecs · verrouillé 30 secondes`, 'err');
        } else {
          const left = G._PIN_MAX_ATTEMPTS - G._pinFailures;
          G.toast(`PIN incorrect · ${left} tentative${left > 1 ? 's' : ''} restante${left > 1 ? 's' : ''}`, 'err');
        }
      }
    }, 200);
  },

  // ── INSCRIPTION ──
  async register() {
    const name = $('reg-name')?.value.trim();
    const phone = $('reg-phone')?.value.trim();
    const email = $('reg-email')?.value.trim();
    const pin = $('reg-pin')?.value.trim();

    const regNameErr = validateName(name, { label: 'Nom complet', min: 2 });
    if (regNameErr) { G.toast(regNameErr, 'err'); return; }
    const regPhoneErr = validatePhone(phone) || (phone.length < 8 ? 'Numéro de téléphone requis' : null);
    if (regPhoneErr) { G.toast(regPhoneErr, 'err'); return; }
    if (!email || !email.includes('@') || !email.includes('.')) { G.toast('Adresse email valide requise', 'err'); return; }
    if (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) { G.toast('PIN de 4 chiffres requis', 'err'); return; }

    G.toast('Création du compte...', 'inf');

    const password = pin + 'GhettoPay2024';

    const { data: authData, error: authError } = await db.auth.signUp({ email, password });
    if (authError) {
      G.toast('Erreur: ' + authError.message, 'err'); return;
    }

    // Email de confirmation requis — sauvegarder tout localement pour que le PIN fonctionne dès la connexion
    if (!authData.session) {
      const avatar = name[0].toUpperCase();
      store.set('pending_reg', { name, phone, pin, email, avatar });
      // Données complètes en local dès maintenant — le profil DB sera créé après confirmation
      store.set('user', { name, phone, email, pin: String(pin), avatar, loc: 'Libreville, Gabon', level: 'Silver' });
      store.set('bal', 10000);
      store.set('coffre', 0); store.set('cash', 0);
      store.set('bills', [
        { id: 1, name: 'SEEG Eau', ref: 'Réf: EAU-2024', amount: 28000, due: '31 déc.' },
        { id: 2, name: 'SEEG Électricité', ref: 'Réf: ELEC-2024', amount: 35000, due: '31 déc.' }
      ]);
      store.set('notifs', [
        { id: 1, title: 'Bienvenue sur GhettoPay !', desc: 'Ton compte est créé · 10 000 FCFA offerts', time: "À l'instant", read: false, icon: 'z', color: 'var(--gold2)', bg: 'rgba(212,160,23,.12)' },
        { id: 2, title: 'Sécurité activée', desc: 'PIN configuré · Compte vérifié', time: "À l'instant", read: false, icon: 'shield', color: 'var(--green)', bg: 'rgba(22,163,74,.12)' }
      ]);
      store.set('txs', []); store.set('coffres', []); store.set('tontines', []);
      G.ok(
        'Vérifie ton email !',
        `Un lien de confirmation a été envoyé à ${email}. Clique dessus puis reviens te connecter avec ton PIN.`,
        () => G.go('login')
      );
      return;
    }

    const session = authData.session;
    const avatar = name[0].toUpperCase();

    // Vérifier si profil existe déjà (inscription partielle)
    const { data: existingUser } = await db.from('users').select('id').eq('phone', phone).single();

    let userId;
    if (!existingUser) {
      const { data: newUser, error: userError } = await db.from('users').insert({
        auth_id: session.user.id, phone, name, avatar, pin_code: pin, email, location: 'Libreville, Gabon', level: 'Silver'
      }).select().single();
      if (userError) { G.toast('Erreur création profil: ' + userError.message, 'err'); return; }
      userId = newUser.id;
      await db.from('wallets').insert({ user_id: userId, balance: 10000, coffre_balance: 0, cashback: 0 });
    } else {
      userId = existingUser.id;
    }

    await loadUserData(session.user.id);

    // Initialiser les données locales
    store.set('user', { name, phone, email, pin: String(pin), avatar, loc: 'Libreville, Gabon', level: 'Silver' });
    store.set('bills', [
      { id: 1, name: 'SEEG Eau', ref: 'Réf: EAU-2024', amount: 28000, due: '31 déc.' },
      { id: 2, name: 'SEEG Électricité', ref: 'Réf: ELEC-2024', amount: 35000, due: '31 déc.' }
    ]);
    store.set('notifs', [
      { id: 1, title: 'Bienvenue sur GhettoPay !', desc: 'Ton compte est créé · 10 000 FCFA offerts', time: "À l'instant", read: false, icon: 'z', color: 'var(--gold2)', bg: 'rgba(212,160,23,.12)' },
      { id: 2, title: 'Sécurité activée', desc: 'PIN configuré · Compte vérifié', time: "À l'instant", read: false, icon: 'shield', color: 'var(--green)', bg: 'rgba(22,163,74,.12)' }
    ]);
    store.set('txs', []);
    store.set('coffres', []);
    store.set('tontines', []);
    store.set('ok', true);

    G.ok('Compte créé !', `Bienvenue ${name} · 10 000 FCFA offerts. Connecte-toi maintenant.`, () => G.go('login'));
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

  showLogin() { G.go('login'); },
  hideLogin() {},
  _loginEmailChanged(email) {
    const pinInput = $('login-pin');
    const pinLabel = $('login-pin-label');
    if (!pinInput) return;
    const isAdmin = email.trim() === 'admin@ghettopay.ga';
    if (isAdmin) {
      pinInput.removeAttribute('maxlength');
      pinInput.removeAttribute('inputmode');
      pinInput.placeholder = 'Mot de passe admin';
      pinInput.style.letterSpacing = '.04em';
      pinInput.style.fontSize = '.92rem';
      if (pinLabel) pinLabel.textContent = 'Mot de passe';
    } else {
      pinInput.maxLength = 4;
      pinInput.inputMode = 'numeric';
      pinInput.placeholder = '• • • •';
      pinInput.style.letterSpacing = '.28em';
      pinInput.style.fontSize = '1.05rem';
      if (pinLabel) pinLabel.textContent = 'Code PIN';
    }
    pinInput.value = '';
  },

  async login() {
    const email = document.getElementById('login-email')?.value.trim();
    const pin = document.getElementById('login-pin')?.value.trim();
    const isAdmin = email === 'admin@ghettopay.ga';
    if (!email || !pin) { G.toast(isAdmin ? 'Email et mot de passe requis' : 'Email et PIN requis', 'err'); return; }

    G.toast('Connexion...', 'inf');
    // Admin utilise son mot de passe directement ; les autres utilisent PIN + suffixe
    const password = isAdmin ? pin : pin + 'GhettoPay2024';

    const { data, error } = await db.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.message.includes('Email not confirmed') || error.message.includes('email_not_confirmed')) {
        G.toast('Confirme ton email avant de te connecter', 'err');
      } else {
        G.toast('Email ou PIN incorrect', 'err');
      }
      return;
    }

    if (!data?.user) {
      G.toast('Confirme ton email avant de te connecter', 'err');
      return;
    }

    // Admin → rediriger vers l'interface d'administration
    if (data.user.email === 'admin@ghettopay.ga') {
      window.location.href = 'admin.html';
      return;
    }

    await loadUserData(data.user.id);
    G.go('pin');
  },
  showModal(id) { const el = $(id); if (el) el.classList.add('on'); },
  closeModal(id) {
    const el = $(id); if (el) el.classList.remove('on');
    const gpOv = $('gp-modal'); if (gpOv && gpOv.style.display !== 'none') gpOv.style.display = 'none';
  },

  // ── PARRAINAGE ──
  _openReferral() {
    const u = store.get('user', {});
    const code = 'GP-' + (u.name || 'USER').toUpperCase().replace(/\s+/g,'').slice(0,6).padEnd(6,'0');
    if ($('ref-code')) $('ref-code').textContent = code;
    const refs = parseInt(localStorage.getItem('gp_refs') || '0');
    if ($('ref-count')) $('ref-count').textContent = refs;
    if ($('ref-earned')) $('ref-earned').textContent = f(refs * 500) + ' F';
    G.showModal('m-ref');
  },
  _shareReferral() {
    const u = store.get('user', {});
    const code = 'GP-' + (u.name || 'USER').toUpperCase().replace(/\s+/g,'').slice(0,6).padEnd(6,'0');
    const text = `Rejoins GhettoPay avec mon code de parrainage et reçois 500 FCFA offerts ! 🎁\nCode : ${code}\nTélécharge l'app : ${location.origin}${location.pathname}`;
    if (navigator.share) {
      navigator.share({ title: 'GhettoPay — Parrainage', text }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(text).then(() => G.toast('Code copié !', 'ok')).catch(() => G.toast(code, 'inf'));
    }
  },

  // ── KYC ──
  _kycPickPhoto() { $('kyc-photo-input')?.click(); },
  _onKycPhotoChosen(input) {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { G.toast('Image trop lourde (max 5 Mo)', 'err'); input.value = ''; return; }
    const reader = new FileReader();
    reader.onload = e => {
      const preview = $('kyc-photo-preview');
      const icon = $('kyc-photo-icon');
      const label = $('kyc-photo-label');
      if (preview) { preview.src = e.target.result; preview.style.display = 'block'; }
      if (icon) icon.style.display = 'none';
      if (label) { label.textContent = '✓ Photo sélectionnée · Appuyer pour changer'; label.style.color = 'var(--green)'; }
      G._kycPhotoData = e.target.result;
    };
    reader.readAsDataURL(file);
  },
  _submitKyc() {
    const name = $('kyc-name')?.value.trim();
    const id = $('kyc-id')?.value.trim();
    if (!name || !id) { G.toast('Remplis tous les champs', 'err'); return; }
    if (!G._kycPhotoData) { G.toast('Ajoute une photo de ta pièce d\'identité', 'err'); return; }
    G.closeModal('m-kyc');
    G._kycPhotoData = null;
    // Reset preview pour la prochaine ouverture
    const preview = $('kyc-photo-preview');
    const icon = $('kyc-photo-icon');
    const label = $('kyc-photo-label');
    if (preview) { preview.src = ''; preview.style.display = 'none'; }
    if (icon) icon.style.display = '';
    if (label) { label.textContent = 'Appuyer pour prendre ou importer une photo'; label.style.color = ''; }
    const u = store.get('user', {}); u.level = 'Gold'; u.kycPending = true; store.set('user', u);
    if ($('kyc-sub')) $('kyc-sub').textContent = 'Vérification en cours…';
    if ($('prof-level')) $('prof-level').textContent = 'Gold';
    if ($('limit-sub')) $('limit-sub').textContent = '5 000 000 FCFA/mois';
    if (store.currentUser) db.from('users').update({ level: 'Gold' }).eq('id', store.currentUser.id).catch(() => {});
    G.ok('Demande envoyée !', 'Ton dossier KYC est en cours de traitement. Sous 48h tu recevras une notification.', null);
  },

  // ── DARK MODE ──
  toggleDark() {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('gp_dark', isDark ? '1' : '0');
    G._updateDarkUI(isDark);
  },
  _updateDarkUI(isDark) {
    const sub = $('dark-sub'), knob = $('dark-knob'), track = $('dark-toggle');
    if (sub) sub.textContent = isDark ? 'Activé' : 'Désactivé';
    if (knob) knob.style.transform = isDark ? 'translateX(16px)' : 'translateX(0)';
    if (track) track.style.background = isDark ? 'var(--green)' : 'var(--bg3)';
  },

  // ── BIOMÉTRIE WebAuthn ──
  async _bioRegister() {
    if (!window.PublicKeyCredential) { G.toast('WebAuthn non supporté sur ce navigateur', 'err'); return; }
    const u = store.get('user', {});
    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const cred = await navigator.credentials.create({ publicKey: {
        challenge, rp: { name: 'GhettoPay', id: location.hostname },
        user: { id: new TextEncoder().encode(store.currentUser?.id || u.phone || 'user'), name: u.phone || 'user', displayName: u.name || 'Utilisateur' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { userVerification: 'required' },
        timeout: 60000
      }});
      if (cred) {
        localStorage.setItem('gp_bio_id', btoa(String.fromCharCode(...new Uint8Array(cred.rawId))));
        if ($('bio-sub')) $('bio-sub').textContent = 'Empreinte enregistrée';
        if ($('pin-bio-btn')) $('pin-bio-btn').style.display = '';
        G.toast('Biométrie enregistrée avec succès', 'ok');
      }
    } catch(e) { G.toast('Biométrie annulée ou non disponible', 'err'); }
  },
  // ── DESKTOP NAVIGATION & RENDER ────────────────────────
  desktopNav(section) {
    if (window.innerWidth < 1280) { G.go(section); return; }
    // Active nav item
    document.querySelectorAll('.gp-nav-item').forEach(el => el.classList.remove('gp-active'));
    const btn = document.querySelector(`[data-gp="${section}"]`);
    if (btn) btn.classList.add('gp-active');
    // Topbar title
    const titles = { home:'Tableau de bord', send:'Envoyer de l\'argent', coffre:'Coffre épargne', budget:'Budget', tontine:'Tontines', notifs:'Notifications', profil:'Profil' };
    const t = $('gp-title'); if (t) t.textContent = titles[section] || section;
    // Hide all panels
    ['home','send','coffre','budget','tontine','notifs','profil'].forEach(p => {
      const el = $(`gp-${p}-panel`); if (el) el.style.display = 'none';
    });
    // Show target panel
    const panel = $(`gp-${section}-panel`);
    if (panel) panel.style.display = 'flex';
    // Render content
    const renders = { home: G.renderDesktopHome, send: G.gp_renderSend, coffre: G.gp_renderCoffre, budget: G.gp_renderBudget, tontine: G.gp_renderTontine, notifs: G.gp_renderNotifs, profil: G.gp_renderProfil };
    if (renders[section]) renders[section].call(G);
  },

  // ── DESKTOP SEND PANEL ──────────────────────────────────
  _gpAmt: 0, _gpContact: null,
  gp_renderSend() {
    G._gpAmt = 0; G._gpContact = null;
    const disp = $('gp-amt-disp'); if (disp) disp.textContent = '0';
    const fee = $('gp-fee-disp'); if (fee) fee.textContent = '0 FCFA';
    const recRow = $('gp-rec-row'); if (recRow) recRow.style.display = 'none';
    // Numpad
    const np = $('gp-numpad');
    if (np) {
      const keys = ['1','2','3','4','5','6','7','8','9','←','0','OK'];
      np.innerHTML = keys.map(k => {
        const bg = k==='OK' ? 'background:linear-gradient(135deg,#C8960A,#D4A820);color:#3A2000;' : k==='←' ? 'background:#F5F2EA;color:#1A1A1A;' : 'background:#FAFAF8;color:#1A1A1A;border:1px solid rgba(0,0,0,.06);';
        return `<button onclick="G.gp_kp('${k}')" style="${bg}padding:14px;border-radius:12px;font-size:1rem;font-weight:800;cursor:pointer;border:none;font-family:'DM Sans',sans-serif;transition:opacity .15s" onmousedown="this.style.opacity='.6'" onmouseup="this.style.opacity='1'">${k}</button>`;
      }).join('');
    }
    G.gp_loadContacts();
  },
  gp_loadContacts() {
    const grid = $('gp-contact-grid'); if (!grid) return;
    const users = store.get('contacts', []);
    if (!users.length && store.currentUser) {
      db.from('users').select('id,name,phone,avatar_url').neq('id', store.currentUser.id).limit(40)
        .then(({data}) => { if (data) { store.set('contacts', data); G.gp_filterContacts(''); } }).catch(()=>{});
    }
    G.gp_filterContacts('');
  },
  gp_filterContacts(q) {
    const grid = $('gp-contact-grid'); if (!grid) return;
    const q2 = (q || '').toLowerCase().trim();
    let users = store.get('contacts', []);
    if (q2) users = users.filter(u => (u.name||'').toLowerCase().includes(q2) || (u.phone||'').includes(q2));
    if (!users.length) { grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:24px;color:#9A9A9A;font-size:.75rem">Aucun contact</div>'; return; }
    const grads = ['linear-gradient(135deg,#0A4A2E,#16A34A)','linear-gradient(135deg,#7c3aed,#a78bfa)','linear-gradient(135deg,#0284c7,#38bdf8)','linear-gradient(135deg,#d97706,#fcd34d)'];
    grid.innerHTML = users.slice(0, 30).map((u, i) => {
      const av = (u.name||'?')[0].toUpperCase();
      return `<div onclick="G.gp_selContact(${JSON.stringify(u).replace(/"/g,'&quot;')})" style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:14px 8px;background:#FAFAF8;border-radius:14px;cursor:pointer;border:2px solid ${G._gpContact?.id===u.id?'#C8960A':'transparent'};transition:all .15s" onmouseover="this.style.background='#F5F2EA'" onmouseout="this.style.background='#FAFAF8'">
        <div style="width:44px;height:44px;border-radius:50%;background:${grads[i%grads.length]};display:flex;align-items:center;justify-content:center;font-weight:900;color:#fff;font-size:.95rem">${av}</div>
        <div style="font-size:.65rem;font-weight:700;color:#1A1A1A;text-align:center;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${u.name||'—'}</div>
        <div style="font-size:.58rem;color:#9A9A9A;font-family:monospace">${(u.phone||'').replace(/(\d{2})(\d{2})(\d{2})(\d{2})/,'$1 $2 $3 $4')}</div>
      </div>`;
    }).join('');
  },
  gp_selContact(u) {
    G._gpContact = u;
    const recRow = $('gp-rec-row');
    if (recRow) {
      recRow.style.display = 'flex';
      const av = $('gp-rec-av'); if (av) { av.textContent = (u.name||'?')[0].toUpperCase(); }
      const nm = $('gp-rec-name'); if (nm) nm.textContent = u.name || '—';
      const ph = $('gp-rec-phone'); if (ph) ph.textContent = u.phone || '';
    }
    G.gp_filterContacts($('gp-send-search')?.value || '');
  },
  gp_kp(k) {
    if (k === '←') { G._gpAmt = Math.floor(G._gpAmt / 10); }
    else if (k === 'OK') { G.gp_send(); return; }
    else { if (G._gpAmt > 999999) return; G._gpAmt = G._gpAmt * 10 + parseInt(k); }
    const disp = $('gp-amt-disp'); if (disp) disp.textContent = G._gpAmt ? f(G._gpAmt) : '0';
    const fee = $('gp-fee-disp'); if (fee) fee.textContent = G._gpAmt ? f(Math.round(G._gpAmt * 0.015)) + ' FCFA' : '0 FCFA';
  },
  async gp_send() {
    if (!G._gpContact) { G.toast('Choisir un destinataire', 'err'); return; }
    const bal = store.get('bal', 0);
    const gpAmtErr = validateAmount(G._gpAmt || 0, bal, { withFee: true, min: 100 });
    if (gpAmtErr) { G.toast(gpAmtErr, 'err'); return; }
    const total = G._gpAmt + Math.round(G._gpAmt * 0.015);
    if (!store.currentUser) { G.toast('Non connecté', 'err'); return; }
    const btn = document.querySelector('#gp-send-panel button[onclick="G.gp_send()"]');
    if (btn) { btn.textContent = 'Envoi…'; btn.disabled = true; }
    try {
      const {error} = await db.from('transactions').insert({ from_user_id: store.currentUser.id, to_user_id: G._gpContact.id, amount: G._gpAmt, type: 'transfer', status: 'completed' });
      if (error) throw error;
      const newBal = bal - total;
      store.set('bal', newBal);
      await db.from('wallets').update({ balance: newBal }).eq('user_id', store.currentUser.id).catch(()=>{});
      G.toast(`${f(G._gpAmt)} FCFA envoyés à ${G._gpContact.name}`, 'ok');
      G._gpAmt = 0; G._gpContact = null;
      const disp = $('gp-amt-disp'); if (disp) disp.textContent = '0';
      const rr = $('gp-rec-row'); if (rr) rr.style.display = 'none';
      G.renderDesktopHome();
    } catch(e) { G.toast('Erreur: ' + (e.message||'inconnue'), 'err'); }
    finally { if (btn) { btn.textContent = 'Envoyer →'; btn.disabled = false; } }
  },

  // ── DESKTOP COFFRE PANEL ────────────────────────────────
  gp_renderCoffre() {
    const total = store.get('coffre', 0);
    const el = $('gp-coffre-total'); if (el) el.textContent = f(total) + ' FCFA';
    G._gp_renderCoffreGrid();
    if (store.currentUser) {
      db.from('coffres').select('*').eq('user_id', store.currentUser.id).order('created_at',{ascending:false})
        .then(({data}) => { if (data) { store.set('coffres_list', data); G._gp_renderCoffreGrid(); } }).catch(()=>{});
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
          <div><div style="font-size:.9rem;font-weight:800;color:#1A1A1A">${c.name||'Coffre'}</div><div style="font-size:.65rem;color:#9A9A9A;margin-top:2px">${c.category||'Épargne'}</div></div>
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

  // ── DESKTOP BUDGET PANEL ────────────────────────────────
  gp_renderBudget() {
    const txs = store.get('txs', []);
    let out = 0, inn = 0;
    txs.forEach(t => { if (t.type==='credit'||t.type==='recv') inn += (t.amount||0); else out += (t.amount||0); });
    const net = inn - out;
    const bOut = $('gp-bud-out'); if (bOut) bOut.textContent = f(out) + ' F';
    const bIn = $('gp-bud-in'); if (bIn) bIn.textContent = f(inn) + ' F';
    const bNet = $('gp-bud-net'); if (bNet) { bNet.textContent = (net>=0?'+':'')+f(net)+' F'; bNet.style.color = net>=0?'#16A34A':'#DC2626'; }
    // Tx list
    const txlist = $('gp-bud-txlist');
    if (txlist) {
      txlist.innerHTML = txs.slice(0,10).map(t => {
        const cr = t.type==='credit'||t.type==='recv';
        return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid rgba(0,0,0,.04)">
          <div style="font-size:.78rem;font-weight:600;color:#1A1A1A">${t.name||t.type||'—'}</div>
          <div style="font-size:.78rem;font-weight:800;color:${cr?'#16A34A':'#DC2626'}">${cr?'+':'-'}${f(t.amount)} F</div>
        </div>`;
      }).join('') || '<div style="text-align:center;padding:20px;color:#9A9A9A;font-size:.75rem">Aucune transaction</div>';
    }
    // Categories
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
          G.gp_renderBudget();
        }).catch(()=>{});
    }
  },

  // ── DESKTOP TONTINE PANEL ───────────────────────────────
  gp_renderTontine() {
    const grid = $('gp-tontine-grid'); if (!grid) return;
    const list = G._tontinesList || store.get('tontines', []);
    if (!list.length) {
      grid.innerHTML = '<div style="text-align:center;padding:40px;color:#9A9A9A;font-size:.78rem;background:#fff;border-radius:18px;border:1.5px dashed rgba(0,0,0,.1)">Aucune tontine — créez-en une pour commencer</div>';
    } else {
      const cols = ['linear-gradient(135deg,#9B59D0,#B47DE8)','linear-gradient(135deg,#0A4A2E,#16A34A)','linear-gradient(135deg,#0284c7,#38bdf8)','linear-gradient(135deg,#d97706,#fcd34d)'];
      grid.innerHTML = list.map((ton, i) => `<div style="background:#fff;border-radius:18px;padding:22px;border:1px solid rgba(0,0,0,.05);box-shadow:0 1px 3px rgba(0,0,0,.06)">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
          <div style="width:44px;height:44px;border-radius:12px;background:${cols[i%cols.length]};flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:.9rem">${(ton.name||'T')[0].toUpperCase()}</div>
          <div><div style="font-size:.9rem;font-weight:800;color:#1A1A1A">${ton.name||'Tontine'}</div><div style="font-size:.62rem;color:#9A9A9A;margin-top:2px">${ton.frequency||'mensuelle'} · ${ton.members_count||ton.member_count||'?'} membres</div></div>
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
    if (store.currentUser && !G._tontinesList?.length) {
      Promise.all([
        db.from('tontines').select('*').eq('creator_id', store.currentUser.id).order('created_at',{ascending:false}),
        db.from('tontines').select('*').contains('members', [store.currentUser.id]).order('created_at',{ascending:false})
      ]).then(([r1, r2]) => {
        const all = [...(r1.data||[]), ...(r2.data||[])];
        const seen = new Set();
        G._tontinesList = all.filter(t => seen.has(t.id) ? false : seen.add(t.id));
        G.gp_renderTontine();
      }).catch(()=>{});
    }
  },

  // ── DESKTOP NOTIFS PANEL ────────────────────────────────
  gp_renderNotifs() {
    const list = $('gp-notifs-list'); if (!list) return;
    const notifs = store.get('notifs', []);
    // Update badge
    const badge = $('gp-notif-badge'); if (badge) badge.style.display = 'none';
    if (!notifs.length) { list.innerHTML = '<div style="text-align:center;padding:40px;color:#9A9A9A;font-size:.78rem;background:#fff;border-radius:18px;border:1.5px dashed rgba(0,0,0,.1)">Aucune notification</div>'; return; }
    const icons = { transaction:'💸', tontine:'🤝', coffre:'🔒', kyc:'🪪', system:'📢' };
    list.innerHTML = notifs.slice(0,20).map(n => `<div style="display:flex;align-items:flex-start;gap:14px;padding:16px;background:${n.read?'#fff':'rgba(200,150,10,.04)'};border-radius:14px;border:1px solid ${n.read?'rgba(0,0,0,.05)':'rgba(200,150,10,.18)'};cursor:pointer" onclick="G.gp_markRead('${n.id||''}')">
      <div style="font-size:1.4rem;flex-shrink:0">${icons[n.type]||'🔔'}</div>
      <div style="flex:1">
        <div style="font-size:.82rem;font-weight:${n.read?'600':'800'};color:#1A1A1A">${n.title||'Notification'}</div>
        <div style="font-size:.72rem;color:#7A7A6A;margin-top:3px;line-height:1.4">${n.body||n.message||''}</div>
        <div style="font-size:.6rem;color:#9A9A9A;font-family:monospace;margin-top:6px">${n.time||''}</div>
      </div>
      ${!n.read ? '<div style="width:8px;height:8px;border-radius:50%;background:#C8960A;flex-shrink:0;margin-top:4px"></div>' : ''}
    </div>`).join('');
    if (store.currentUser) {
      db.from('notifications').select('*').eq('user_id', store.currentUser.id).order('created_at',{ascending:false}).limit(20)
        .then(({data}) => {
          if (!data?.length) return;
          const mapped = data.map(n => ({ id:n.id, type:n.type||'system', title:n.title||'Notification', body:n.body||n.message||'', read:n.read||false, time:new Date(n.created_at).toLocaleDateString('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) }));
          store.set('notifs', mapped);
          G.gp_renderNotifs();
        }).catch(()=>{});
    }
  },
  gp_markRead(id) {
    const notifs = store.get('notifs', []).map(n => n.id==id ? {...n,read:true} : n);
    store.set('notifs', notifs);
    G.gp_renderNotifs();
    if (id && store.currentUser) db.from('notifications').update({read:true}).eq('id',id).catch(()=>{});
  },
  gp_markAllRead() {
    const notifs = store.get('notifs', []).map(n => ({...n,read:true}));
    store.set('notifs', notifs);
    G.gp_renderNotifs();
    if (store.currentUser) db.from('notifications').update({read:true}).eq('user_id',store.currentUser.id).catch(()=>{});
  },

  // ── DESKTOP PROFIL PANEL ────────────────────────────────
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
    const tontines = G._tontinesList || [];
    const av = u.avatar || (u.name || '?')[0].toUpperCase();
    const firstName = (u.name || 'Utilisateur').split(' ')[0];

    // Topbar + sidebar avatar
    const greet = $('gp-greet'); if (greet) greet.textContent = `Bonjour, ${firstName}`;
    const sbAv = $('gp-sb-av'); if (sbAv) sbAv.textContent = av;
    const topAv = $('gp-top-av'); if (topAv) topAv.textContent = av;

    // Notif badge
    const unread = store.get('notifs', []).filter(n => !n.read).length;
    const badge = $('gp-notif-badge'); if (badge) badge.style.display = unread ? 'block' : 'none';

    // Cards
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

    G._renderDesktopChart();
    G._renderDesktopActivity();
  },

  _renderDesktopChart() {
    const chart = $('gp-bar-chart'); if (!chart) return;
    const now = new Date();
    const months = Array.from({length:6}, (_,i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5-i), 1);
      return { y:d.getFullYear(), m:d.getMonth(), label:d.toLocaleDateString('fr-FR',{month:'short'}), val:0 };
    });
    // Use cached txs from DB or local
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

    // If connected, fetch real DB data for the chart
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
          <div class="gp-act-name">${name}</div>
          <div class="gp-act-meta">${cat} · ${time}</div>
        </div>
        <div class="gp-act-amount ${cls}">${sign}${f(t.amount)}<span style="font-size:.55rem;opacity:.65"> F</span></div>
      </div>`;
    }).join('');

    // Refresh from DB if connected
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
                <div class="gp-act-name">${name}</div>
                <div class="gp-act-meta">${cat} · ${time}</div>
              </div>
              <div class="gp-act-amount ${cls}">${sign}${f(t.amount)}<span style="font-size:.55rem;opacity:.65"> F</span></div>
            </div>`;
          }).join('');
        }).catch(()=>{});
    }
  },

  async _bioAuth() {
    if (!window.PublicKeyCredential) { G.toast('WebAuthn non supporté', 'err'); return; }
    const rawId = localStorage.getItem('gp_bio_id');
    if (!rawId) { G.toast('Enregistre d\'abord ton empreinte dans le Profil', 'err'); return; }
    try {
      const credId = Uint8Array.from(atob(rawId), c => c.charCodeAt(0));
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const assertion = await navigator.credentials.get({ publicKey: {
        challenge, allowCredentials: [{ type: 'public-key', id: credId }],
        userVerification: 'required', timeout: 60000
      }});
      if (assertion) {
        // Auth biométrique réussie → connecter
        store.pinBuf = store.get('user', {}).pin || '0000';
        G._checkPin();
      }
    } catch(e) { G.toast('Biométrie échouée ou annulée', 'err'); }
  },

  // ── PIN CONFIRMATION GROS TRANSFERT ──
  _mpcUpdateDots() {
    const dots = document.querySelectorAll('#mpc-dots .pin-dot');
    dots.forEach((d, i) => d.classList.toggle('on', i < G._mpcBuf.length));
  },
  _mpcKey(k) {
    if (G._mpcBuf.length >= 4) return;
    G._mpcBuf += k;
    G._mpcUpdateDots();
    if (G._mpcBuf.length === 4) {
      const pin = store.get('user', {}).pin || '';
      if (G._mpcBuf === String(pin)) {
        G.closeModal('m-pin-confirm');
        G._mpcBuf = '';
        // Exécuter le transfert en attente
        const ps = G._pendingSend;
        if (!ps) return;
        G._pendingSend = null;
        store.selC = ps.store.selC;
        store.aStr = String(ps.n);
        G._execSend(ps);
      } else {
        G._mpcBuf = '';
        G._mpcUpdateDots();
        G.toast('PIN incorrect', 'err');
      }
    }
  },
  _mpcDel() {
    G._mpcBuf = G._mpcBuf.slice(0, -1);
    G._mpcUpdateDots();
  },
  async _execSend({ store.selC: sc, n, fee, total, bal, note }) {
    if (store.currentUser) {
      G.toast('Envoi en cours...', 'inf');
      const { data, error } = await db.rpc('transfer_money', {
        p_from_user_id: store.currentUser.id, p_to_user_id: sc.id, p_amount: n, p_note: note
      });
      if (error || !data?.success) { G.toast(data?.error || 'Erreur de transfert', 'err'); return; }
      const newBal = bal - total;
      store.set('bal', newBal);
      if (store.currentUser.wallet) store.currentUser.wallet.balance = newBal;
    } else {
      store.set('bal', bal - total);
      const txs = store.get('txs', []);
      txs.unshift({ id: Date.now(), name: sc.name, av: sc.av, amount: n, fee, type: 'send', cat: 'Transfert', time: "À l'instant" });
      store.set('txs', txs);
    }
    G.ok(`${f(n)} FCFA envoyés`, `À ${sc.name} · Frais ${f(fee)} FCFA · Confirmé ✓`, () => G.go('home'));
  },

  // ── DESKTOP MODAL SYSTEM ─────────────────────────────────
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

  // ── DESKTOP MODAL OPENERS ───────────────────────────────
  gp_openNewCoffre() {
    G.gpModal(`
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
    G._tontineMembers = [];
    G.gpModal(`
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
    G.gpModal(`
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
    G.gpModal(`
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
    G._depCoffreId = id;
    G._depCoffreName = name;
    G.gpModal(`
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
    G.gpModal(`
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

Object.assign(G, homeScreen, budgetScreen, facturesScreen, notifsScreen, coffreScreen, tontineScreen);

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

