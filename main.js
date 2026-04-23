import { f, $, si, esc, tryCatch, validateAmount, validatePhone, validateName } from './utils.js';
import { S } from './state.js';
import { db } from './api.js';

// ── STATE ──
let cur = 'loading', hist = [], pD = {}, selC = null, aStr = '', pinBuf = '', balVis = true;
let currentUser = null; // utilisateur connecté
let isNewUser = false;  // mode inscription
let walletChannel = null; // canal realtime solde


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
    const p = S.get('pending_reg', null);
    if (p && authId) {
      const { data: newUser, error } = await db.from('users').insert({
        auth_id: authId, phone: p.phone, name: p.name,
        avatar: p.avatar, pin_code: String(p.pin), email: p.email,
        location: 'Libreville, Gabon', level: 'Silver'
      }).select().single();
      if (!error && newUser) {
        await db.from('wallets').insert({ user_id: newUser.id, balance: 10000, coffre_balance: 0, cashback: 0 });
        S.set('pending_reg', null);
        user = newUser;
      }
    }
    // Si toujours pas de user DB → garder les données locales existantes (ne pas effacer)
    if (!user) return;
  }

  const { data: wallet } = await db.from('wallets').select('*').eq('user_id', user.id).single();
  currentUser = { ...user, wallet };

  // pin_code peut être int ou string selon la DB → toujours stocker en string
  S.set('user', { name: user.name, phone: user.phone, pin: String(user.pin_code || ''), avatar: user.avatar, loc: user.location, level: user.level });
  S.set('bal', wallet?.balance || 0);
  S.set('cash', wallet?.cashback || 0);
  // Recalculer le total coffre depuis les coffres réels (non-bloquant)
  S.set('coffre', wallet?.coffre_balance || 0);
  db.from('coffres').select('saved').eq('user_id', user.id)
    .then(({ data: userCoffres }) => {
      if (!userCoffres) return;
      const realCoffre = userCoffres.reduce((s, c) => s + (c.saved || 0), 0);
      S.set('coffre', realCoffre);
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
  if (walletChannel) { db.removeChannel(walletChannel); walletChannel = null; }
  walletChannel = db.channel('wallet_' + user.id)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'wallets', filter: `user_id=eq.${user.id}` }, payload => {
      const d = payload.new;
      const nb = d.balance || 0, nc = d.coffre_balance || 0;
      S.set('bal', nb); S.set('coffre', nc); S.set('cash', d.cashback || 0);
      if (currentUser?.wallet) { currentUser.wallet.balance = nb; currentUser.wallet.coffre_balance = nc; }
      if (cur === 'home') {
        if (balVis) {
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
    if (cur === 'scan' && scr !== 'scan') G.stopScan();
    const p = $('sc-' + cur), n = $('sc-' + scr);
    if (!n) return;
    if (p) p.classList.remove('on');
    n.classList.add('on');
    // Ne pas empiler les écrans d'auth dans l'historique
    const noHist = ['onboard', 'login', 'pin'];
    if (cur !== scr && !noHist.includes(cur)) hist.push(cur);
    cur = scr;
    G.render(scr);
    // Mettre à jour navbar
    document.querySelectorAll('.bt').forEach(b => b.classList.remove('on'));
    const map = { home: 0, budget: 1, coffre: 3, profil: 4 };
    if (map[scr] !== undefined) {
      document.querySelectorAll('.bt')[map[scr]]?.classList.add('on');
    }
  },

  back() {
    const scr = hist.length ? hist.pop() : 'home';
    // Navigation directe sans passer par go() pour ne pas re-empiler dans hist
    if (cur === 'scan' && scr !== 'scan') G.stopScan();
    const p = $('sc-' + cur), n = $('sc-' + scr);
    if (!n) return;
    if (p) p.classList.remove('on');
    n.classList.add('on');
    cur = scr;
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

  // ── HOME ──
  r_home() {
    const bal = S.get('bal', 0), cbal = S.get('coffre', 0), u = S.get('user', {});
    $('home-name').textContent = (u.name || 'Utilisateur').split(' ')[0] + ' ' + ((u.name || '').split(' ')[1]?.[0] || '') + '.';
    const photo = localStorage.getItem('gp_photo');
    const hav = $('home-av');
    if (hav) {
      if (photo) { hav.textContent = ''; hav.style.backgroundImage = `url(${photo})`; hav.style.backgroundSize = 'cover'; hav.style.backgroundPosition = 'center'; }
      else { hav.style.backgroundImage = ''; hav.textContent = u.avatar || '?'; }
    }
    $('bal-amt').innerHTML = `<span class="cur">FCFA </span>${balVis ? f(bal) : '• • • •'}`;
    $('bal-sub').textContent = `+ Coffre : ${f(cbal)} FCFA`;
    $('cstrip-val').textContent = f(cbal);
    const unread = S.get('notifs', []).filter(n => !n.read).length;
    $('notif-dot').style.display = unread ? 'block' : 'none';
    G.r_txList();
    // Rafraîchir le solde depuis la DB (non-bloquant, met à jour si différent)
    if (currentUser) {
      db.from('wallets').select('balance,coffre_balance,cashback').eq('user_id', currentUser.id).single()
        .then(({ data }) => {
          if (!data || cur !== 'home') return;
          const nb = data.balance || 0, nc = data.coffre_balance || 0;
          if (nb !== S.get('bal', 0) || nc !== S.get('coffre', 0)) {
            S.set('bal', nb); S.set('coffre', nc); S.set('cash', data.cashback || 0);
            if (balVis) {
              $('bal-amt').innerHTML = `<span class="cur">FCFA </span>${f(nb)}`;
              $('bal-sub').textContent = `+ Coffre : ${f(nc)} FCFA`;
            }
            $('cstrip-val').textContent = f(nc);
            G.r_txList();
          }
        }).catch(() => {});
    }
  },

  // ── LOGIN ──
  r_login() {
    // Mettre le focus sur le champ email après la transition
    setTimeout(() => { $('login-email')?.focus(); }, 350);
  },

  _txRow(isCredit, name, ico, col, bg, cat, time, amount) {
    const sign = isCredit ? '+' : '-';
    return `<div class="tx"><div class="tx-av" style="background:${bg}">${si(ico, col, 15)}</div><div class="tx-info"><div class="tx-name">${esc(name)}</div><div class="tx-meta">${esc(cat)} · ${esc(time)}</div></div><div class="tx-right"><div class="tx-amt ${isCredit?'cr':'db'}">${sign}${f(amount)} <span style="font-size:.6rem;opacity:.65">F</span></div></div></div>`;
  },

  async r_txList() {
    const empty = '<div style="padding:28px;text-align:center;color:var(--txt3);font-size:.82rem">Aucune transaction récente</div>';
    if (!currentUser) {
      const txs = S.get('txs', []);
      if (!txs.length) { $('tx-list').innerHTML = empty; return; }
      $('tx-list').innerHTML = txs.slice(0, 8).map(t => {
        const isCredit = t.type === 'recv';
        const ico = { recv:'recv', send:'send', qr:'qric', recharge:'phone', bill:'pay', coffre_deposit:'lock', tontine:'users' }[t.type] || 'send';
        const col = isCredit ? '#16A34A' : '#DC2626';
        const bg = isCredit ? 'rgba(22,163,74,.12)' : 'rgba(212,160,23,.12)';
        const cat = { recv:'Reçu', send:'Envoyé', qr:'QR Pay', recharge:'Recharge', bill:'Facture', coffre_deposit:'Coffre', tontine:'Tontine' }[t.type] || t.type;
        return G._txRow(isCredit, t.name || 'Inconnu', ico, col, bg, cat, t.time || '—', t.amount);
      }).join('');
      return;
    }
    const { data: txs } = await db.from('transactions')
      .select('*, from_user:from_user_id(name,avatar), to_user:to_user_id(name,avatar)')
      .or(`from_user_id.eq.${currentUser.id},to_user_id.eq.${currentUser.id}`)
      .order('created_at', { ascending: false }).limit(8);
    if (!txs?.length) { $('tx-list').innerHTML = empty; return; }
    $('tx-list').innerHTML = txs.map(t => {
      const isCredit = t.to_user_id === currentUser.id;
      const other = isCredit ? t.from_user : t.to_user;
      const name = other?.name || t.merchant_name || 'GhettoPay';
      const ico = { transfer: isCredit?'recv':'send', qr:'qric', recharge:'phone', bill:'pay', coffre_deposit:'lock', tontine:'users' }[t.type] || 'send';
      const col = isCredit ? '#16A34A' : '#DC2626';
      const bg = isCredit ? 'rgba(22,163,74,.12)' : 'rgba(212,160,23,.12)';
      const cat = { transfer:'Transfert', qr:'QR Pay', recharge:'Recharge', bill:'Facture', coffre_deposit:'Coffre', tontine:'Tontine' }[t.type] || t.type;
      const time = new Date(t.created_at).toLocaleDateString('fr-FR', { day:'numeric', month:'short' });
      return G._txRow(isCredit, name, ico, col, bg, cat, time, t.amount);
    }).join('');
  },

  toggleBal() {
    balVis = !balVis;
    const bal = S.get('bal', 0), cbal = S.get('coffre', 0);
    $('bal-amt').innerHTML = `<span class="cur">FCFA </span>${balVis ? f(bal) : '• • • •'}`;
    $('bal-sub').textContent = balVis ? `+ Coffre : ${f(cbal)} FCFA` : '••••••••';
    $('eye-ic').innerHTML = balVis ? '<use href="#eye"/>' : '<use href="#eyeoff"/>';
  },

  // ── SEND ──
  r_send() {
    aStr = '';
    $('amt-disp').textContent = '0';
    // Si un contact est déjà sélectionné (ex: depuis scan QR), le conserver
    if (!selC) {
      $('rec-row').style.display = 'none';
    } else {
      if ($('rec-av')) $('rec-av').textContent = selC.av;
      if ($('rec-name')) $('rec-name').textContent = selC.name;
      if ($('rec-phone')) $('rec-phone').textContent = selC.phone;
      if ($('rec-row')) $('rec-row').style.display = 'flex';
    }
    G.r_contacts();
  },

  async r_contacts() {
    G._allContacts = [];
    G._contactMap = {};
    if (!currentUser) {
      G._allContacts = S.get('contacts', []);
    } else {
      const { data: users } = await db.from('users').select('id,name,avatar,phone').neq('id', currentUser.id).limit(30);
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
    let c = G._contactMap?.[id] || (S.get('contacts',[])).find(x => x.id === id) || (G._allContacts||[]).find(x => x.id === id);
    if (!c) return;
    selC = { id: c.id, name: c.name, phone: c.phone||'', av: c.avatar || c.av || (c.name||'?')[0].toUpperCase() };
    $('rec-av').textContent = selC.av;
    $('rec-name').textContent = selC.name;
    $('rec-phone').textContent = selC.phone;
    $('rec-row').style.display = 'flex';
  },

  kp(v) {
    if (v === 'del') { aStr = aStr.slice(0, -1); }
    else if (aStr.length < 9) { aStr += v; }
    const n = parseInt(aStr) || 0;
    $('amt-disp').textContent = f(n);
    const fee = Math.round(n * 0.015);
    const fd = $('fee-disp');
    if (fd) fd.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#15803d" stroke-width="2.5"><use href="#chk"/></svg>Frais : ${fee > 0 ? f(fee) + ' FCFA (1,5%)' : '0 FCFA'}`;
  },

  _pendingSend: null, _mpcBuf: '',
  async doSend() {
    if (!selC) { G.toast('Choisis un destinataire', 'err'); return; }
    const n = parseInt(aStr) || 0;
    const bal = S.get('bal', 0);
    const amtErr = validateAmount(n, bal, { withFee: true });
    if (amtErr) { G.toast(amtErr, 'err'); return; }
    const fee = Math.round(n * 0.015);
    const total = n + fee;
    const note = $('send-note')?.value || '';

    // PIN confirmation si montant > 100 000 FCFA
    const PIN_THRESHOLD = 100000;
    if (n >= PIN_THRESHOLD && S.get('user', {}).pin) {
      G._pendingSend = { selC, n, fee, total, bal, note };
      G._mpcBuf = '';
      G._mpcUpdateDots();
      if ($('mpc-desc')) $('mpc-desc').textContent = `Transfert de ${f(n)} FCFA à ${selC.name} — Entre ton PIN pour valider`;
      G.showModal('m-pin-confirm');
      return;
    }

    if (currentUser) {
      G.toast('Envoi en cours...', 'inf');
      const { data, error } = await db.rpc('transfer_money', {
        p_from_user_id: currentUser.id, p_to_user_id: selC.id, p_amount: n, p_note: note
      });
      if (error || !data?.success) { G.toast(data?.error || 'Erreur de transfert', 'err'); return; }
      const newBal = bal - total;
      S.set('bal', newBal);
      if (currentUser.wallet) currentUser.wallet.balance = newBal;
    } else {
      S.set('bal', bal - total);
      const txs = S.get('txs', []);
      txs.unshift({ id: Date.now(), name: selC.name, av: selC.av, amount: n, fee, type: 'send', cat: 'Transfert', time: "À l'instant" });
      S.set('txs', txs);
    }
    G.ok(`${f(n)} FCFA envoyés`, `À ${selC.name} · Frais ${f(fee)} FCFA · Confirmé ✓`, () => G.go('home'));
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
      if (!currentUser) { G.toast('Connecte-toi pour envoyer de l\'argent', 'err'); return; }
      G.toast('Recherche du destinataire…', 'inf');
      const { data: found } = await db.from('users').select('id,name').eq('phone', phone).maybeSingle();
      if (!found) { G.toast('Cet utilisateur n\'est pas encore sur GhettoPay', 'err'); return; }
      const nm = found.name || name || phone;
      // Définir selC AVANT go('send') pour que r_send() le détecte
      selC = { id: found.id, name: nm, phone, av: (nm[0] || '?').toUpperCase() };
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
    if (!currentUser) { G.toast('Connecte-toi pour envoyer de l\'argent', 'err'); return; }
    G.toast('Recherche du destinataire…', 'inf');
    const { data: found } = await db.from('users').select('id,name').eq('phone', phone).maybeSingle();
    if (!found) { G.toast('Numéro introuvable sur GhettoPay', 'err'); return; }
    const nm = found.name || phone;
    selC = { id: found.id, name: nm, phone, av: (nm[0] || '?').toUpperCase() };
    G.go('send');
    setTimeout(() => {
      if ($('rec-av')) $('rec-av').textContent = selC.av;
      if ($('rec-name')) $('rec-name').textContent = selC.name;
      if ($('rec-phone')) $('rec-phone').textContent = selC.phone;
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
    const u = S.get('user', {});
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
    const u = S.get('user', {});
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
    const u = S.get('user', {});
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
    selC = { id: 'manual_' + phone, name: phone, phone, av: '#' };
    $('rec-av').textContent = selC.av;
    $('rec-name').textContent = selC.name;
    $('rec-phone').textContent = selC.phone;
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
        selC = { id: 'contact_' + phone, name, phone, av: (name[0]||'?').toUpperCase() };
        $('rec-av').textContent = selC.av;
        $('rec-name').textContent = selC.name;
        $('rec-phone').textContent = selC.phone;
        $('rec-row').style.display = 'flex';
      }
    } catch(e) { G.toast('Accès contacts refusé', 'err'); }
  },

  doQR() {
    const merchant = $('qr-merchant')?.value.trim();
    const amount = parseInt($('qr-amount')?.value) || 0;
    const merchantErr = validateName(merchant, { label: 'Nom du commerçant' });
    if (merchantErr) { G.toast(merchantErr, 'err'); return; }
    const bal = S.get('bal', 0);
    const qrAmtErr = validateAmount(amount, bal);
    if (qrAmtErr) { G.toast(qrAmtErr, 'err'); return; }

    if (currentUser) {
      // Enregistrer le paiement QR
      db.from('transactions').insert({
        from_user_id: currentUser.id,
        amount,
        type: 'qr',
        merchant_name: merchant,
        status: 'completed'
      }).then(({ error }) => {
        if (error) { G.toast('Erreur paiement', 'err'); return; }
        S.set('bal', bal - amount);
        G.ok(`${f(amount)} FCFA payés`, `${merchant} · Confirmé ✓`, () => G.go('home'));
      });
    } else {
      S.set('bal', bal - amount);
      G.ok(`${f(amount)} FCFA payés`, `${merchant} · Confirmé ✓`, () => G.go('home'));
    }
  },

  // ── COFFRE ──
  r_coffre() {
    const cbal = S.get('coffre', 0);
    $('coffre-total').textContent = f(cbal) + ' FCFA';
    G.r_coffreList();
  },

  r_coffreList() {
    // Affichage instantané depuis le cache
    const cached = S.get('coffres', []);
    G._renderCoffreList(cached);

    if (!currentUser) return;
    // Mise à jour silencieuse depuis la DB
    db.from('coffres').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false })
      .then(({ data }) => {
        if (!data) return;
        S.set('coffres', data);
        G._renderCoffreList(data);
        // Mettre à jour le total coffre
        const total = data.reduce((s, c) => s + (c.saved || 0), 0);
        S.set('coffre', total);
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
      const unlockStr = unlockDate ? unlockDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
      // Calendar: months from now to unlock
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
      return `<div class="coffre-item">
        <div class="ci-head">
          <div class="ci-ic" style="background:rgba(10,74,46,.1)"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="var(--forest)" stroke-width="1.9"><use href="#lock"/></svg></div>
          <div style="flex:1"><div class="ci-name">${esc(c.name)}</div><div class="ci-dl">Déblocage : ${esc(unlockStr)}</div></div>
          <div class="ci-right"><div class="ci-val">${f(c.saved)} F</div><div class="ci-rate">${pct}% atteint</div></div>
        </div>
        <div class="ci-bar-bg"><div class="ci-bar" style="width:${pct}%;background:var(--green)"></div></div>
        <div class="ci-bar-lbls"><span>${f(c.saved)} FCFA épargnés</span><span>Objectif : ${f(c.target)} FCFA</span></div>
        ${calHTML}
        <div style="display:flex;gap:8px;margin-top:10px">
          <button class="btn btn-ghost" style="flex:1;font-size:.75rem" onclick="G.depositCoffre('${esc(c.id)}','${esc(c.name)}')">
            <svg><use href="#plus"/></svg>Ajouter des fonds
          </button>
          <button onclick="G.deleteCoffre('${esc(c.id)}','${esc(c.name)}')" style="padding:0 14px;border:1px solid rgba(220,38,38,.2);border-radius:12px;background:rgba(220,38,38,.07);color:#dc2626;font-size:.75rem;font-weight:700;cursor:pointer;flex-shrink:0">Supprimer</button>
        </div>
      </div>`;
    }).join('');
  },

  async createCoffre() {
    const name = $('nc-name')?.value.trim();
    const target = parseInt($('nc-target')?.value) || 0;
    const months = parseInt($('nc-months')?.value) || 6;
    const nameErr = validateName(name);
    if (nameErr) { G.toast(nameErr, 'err'); return; }

    const unlockDate = new Date();
    unlockDate.setMonth(unlockDate.getMonth() + months);

    if (currentUser) {
      const { error } = await db.from('coffres').insert({
        user_id: currentUser.id, name, target, saved: 0,
        unlock_date: unlockDate.toISOString().split('T')[0]
      });
      if (error) { G.toast('Erreur création coffre', 'err'); return; }
    } else {
      const coffres = S.get('coffres', []);
      coffres.unshift({ id: Date.now().toString(), name, target, saved: 0, unlock_date: unlockDate.toISOString().split('T')[0] });
      S.set('coffres', coffres);
    }

    G.closeModal('mc');
    const ncn = $('nc-name'); if (ncn) ncn.value = '';
    const nct = $('nc-target'); if (nct) nct.value = '';
    G.r_coffre();
    if (window.innerWidth >= 1280) G.gp_renderCoffre();
    G.toast('Coffre créé !', 'ok');
  },

  async deleteCoffre(coffreId, name) {
    if (!confirm(`Supprimer le coffre "${name}" ? Les fonds seront remboursés sur ton solde.`)) return;
    const coffres = S.get('coffres', []);
    const c = coffres.find(x => String(x.id) === String(coffreId));
    const saved = c?.saved || 0;
    if (currentUser) {
      await db.from('coffres').delete().eq('id', coffreId);
      if (saved > 0) {
        const bal = S.get('bal', 0);
        const newCoffre = Math.max(0, S.get('coffre', 0) - saved);
        await db.from('wallets').update({ balance: bal + saved, coffre_balance: newCoffre }).eq('user_id', currentUser.id);
        S.set('bal', bal + saved);
        S.set('coffre', newCoffre);
      }
    }
    const newCoffres = coffres.filter(x => String(x.id) !== String(coffreId));
    S.set('coffres', newCoffres);
    if (saved > 0) S.set('coffre', Math.max(0, S.get('coffre',0) - saved));
    G.r_coffre();
    G.toast('Coffre supprimé', 'inf');
  },

  async _withdrawCoffre(coffreId) {
    const coffres = S.get('coffres', []);
    const c = coffres.find(x => String(x.id) === String(coffreId));
    if (!c) { G.toast('Coffre introuvable', 'err'); return; }
    const saved = c.saved || 0;
    if (saved <= 0) { G.toast('Coffre vide', 'err'); return; }
    if (!confirm(`Retirer ${f(saved)} FCFA du coffre "${c.name}" ?`)) return;
    const bal = S.get('bal', 0);
    const newCoffre = Math.max(0, S.get('coffre', 0) - saved);
    if (currentUser) {
      await Promise.all([
        db.from('coffres').update({ saved: 0 }).eq('id', coffreId),
        db.from('wallets').update({ balance: bal + saved, coffre_balance: newCoffre }).eq('user_id', currentUser.id),
        db.from('transactions').insert({ from_user_id: currentUser.id, amount: saved, type: 'coffre_withdraw', merchant_name: c.name, status: 'completed' })
      ]).catch(e => { G.toast('Erreur retrait : ' + (e.message||''), 'err'); return; });
    }
    S.set('bal', bal + saved);
    S.set('coffre', newCoffre);
    const updated = coffres.map(x => String(x.id)===String(coffreId) ? {...x, saved:0} : x);
    S.set('coffres', updated);
    G.r_coffre();
    if (window.innerWidth >= 1280) G.gp_renderCoffre();
    G.toast(`${f(saved)} FCFA retirés dans votre solde`, 'ok');
  },

  _deleteCurrentTontine() {
    const t = G._curTontine; if (!t) return;
    G.deleteTontine(t.id, t.name);
  },

  _confirmCb: null,
  _askConfirm(title, body, okLabel, okStyle, cb) {
    if ($('mc-title')) $('mc-title').textContent = title;
    if ($('mc-body')) $('mc-body').textContent = body;
    const btn = $('mc-ok');
    if (btn) { btn.textContent = okLabel; btn.className = 'btn ' + (okStyle || 'btn-danger'); }
    G._confirmCb = cb;
    G.showModal('m-confirm');
  },
  _runConfirm() {
    G.closeModal('m-confirm');
    if (G._confirmCb) { const cb = G._confirmCb; G._confirmCb = null; cb(); }
  },

  async deleteTontine(tontineId, name) {
    const t = G._curTontine;
    const isCreator = currentUser && t?.creator_id === currentUser.id;

    if (isCreator) {
      G._askConfirm(
        `Supprimer "${name}" ?`,
        `Les membres ayant déjà cotisé ce cycle seront remboursés automatiquement.`,
        'Supprimer', 'btn-danger',
        () => G._doDeleteTontine(tontineId, name)
      );
      return;
    } else {
      G._askConfirm(
        `Quitter "${name}" ?`,
        `Tu ne pourras plus voir ni cotiser à cette tontine.`,
        'Quitter', 'btn-danger',
        () => G._doDeleteTontine(tontineId, name)
      );
      return;
    }
  },

  async _doDeleteTontine(tontineId, name) {
    const t = G._curTontine;
    const isCreator = currentUser && t?.creator_id === currentUser.id;

    if (isCreator) {

      // Récupérer tous les membres qui ont cotisé
      const { data: paidRows } = await db.from('tontine_members')
        .select('user_id, member_name, has_paid')
        .eq('tontine_id', tontineId)
        .eq('has_paid', true);

      const amt = t.amount_per_cycle || 0;
      let selfRefunded = false;

      for (const row of (paidRows || [])) {
        if (!row.user_id || row.user_id === currentUser.id) {
          // Rembourser le créateur localement
          if (row.user_id === currentUser.id) {
            const bal = S.get('bal', 0);
            S.set('bal', bal + amt);
            await db.from('wallets').update({ balance: bal + amt }).eq('user_id', currentUser.id).catch(() => {});
            if ($('bal-amt')) $('bal-amt').textContent = f(bal + amt);
            selfRefunded = true;
          }
          continue;
        }
        // Rembourser le membre
        const { data: w } = await db.from('wallets').select('balance').eq('user_id', row.user_id).maybeSingle();
        if (w) {
          await db.from('wallets').update({ balance: w.balance + amt }).eq('user_id', row.user_id).catch(() => {});
        }
        // Notification de remboursement
        await db.from('notifications').insert({
          user_id: row.user_id, type: 'tontine_refund',
          title: `Remboursement — ${name}`,
          body: `La tontine "${name}" a été supprimée. ${f(amt)} FCFA ont été remboursés sur ton solde.`,
          read: false
        }).catch(() => {});
      }

      const { error: delMembErr } = await db.from('tontine_members').delete().eq('tontine_id', tontineId);
      if (delMembErr) { G.toast('Erreur suppression membres : ' + delMembErr.message, 'err'); return; }
      const { error: delTonErr } = await db.from('tontines').delete().eq('id', tontineId);
      if (delTonErr) { G.toast('Erreur suppression tontine : ' + delTonErr.message, 'err'); return; }
      if (selfRefunded) G.toast(`Tontine supprimée · +${f(amt)} FCFA remboursés`, 'ok');
      else G.toast('Tontine supprimée', 'inf');

    } else {
      // Membre non-créateur : quitter seulement
      if (currentUser) {
        const { error: leaveErr } = await db.from('tontine_members').delete()
          .eq('tontine_id', tontineId).eq('user_id', currentUser.id);
        if (leaveErr) { G.toast('Erreur : ' + leaveErr.message, 'err'); return; }
      }
      G.toast('Tontine quittée', 'inf');
    }

    const tontines = S.get('tontines', []).filter(x => String(x.id) !== String(tontineId));
    S.set('tontines', tontines);
    G._tontinesList = G._tontinesList.filter(x => String(x.id) !== String(tontineId));
    G._curTontine = null;
    G.go('tontine');
  },

  depositCoffre(coffreId, coffreName) {
    G._depCoffreId = coffreId;
    G._depCoffreName = coffreName;
    if ($('mdep-title')) $('mdep-title').textContent = coffreName;
    if ($('mdep-sub')) $('mdep-sub').textContent = `Ajouter des fonds dans "${coffreName}"`;
    if ($('mdep-bal')) $('mdep-bal').textContent = f(S.get('bal', 0)) + ' FCFA';
    if ($('mdep-amount')) $('mdep-amount').value = '';
    G.showModal('mdep');
    setTimeout(() => $('mdep-amount')?.focus(), 300);
  },

  async _doDeposit() {
    const coffreId = G._depCoffreId;
    const coffreName = G._depCoffreName;
    const amount = parseInt($('mdep-amount')?.value) || 0;
    const bal = S.get('bal', 0);
    const depErr = validateAmount(amount, bal);
    if (depErr) { G.toast(depErr, 'err'); return; }

    G.closeModal('mdep');

    const newCoffre = S.get('coffre', 0) + amount;
    if (currentUser) {
      const { data: cof } = await db.from('coffres').select('saved').eq('id', coffreId).single();
      await Promise.all([
        db.from('wallets').update({ balance: bal - amount, coffre_balance: newCoffre }).eq('user_id', currentUser.id),
        db.from('coffres').update({ saved: (cof?.saved || 0) + amount }).eq('id', coffreId),
        db.from('transactions').insert({ from_user_id: currentUser.id, amount, type: 'coffre_deposit', merchant_name: coffreName, status: 'completed' })
      ]);
      S.set('bal', bal - amount);
      S.set('coffre', newCoffre);
    } else {
      S.set('bal', bal - amount);
      S.set('coffre', newCoffre);
      const coffres = S.get('coffres', []);
      const c = coffres.find(x => x.id == coffreId);
      if (c) c.saved += amount;
      S.set('coffres', coffres);
    }

    G.r_coffre();
    if (window.innerWidth >= 1280) G.gp_renderCoffre();
    G.toast(`${f(amount)} FCFA déposés dans ${coffreName}`, 'ok');
  },

  // ── BUDGET ──
  r_budget() {
    const txs = S.get('txs', []);
    const out = txs.filter(t => t.type === 'send' || t.type === 'qr' || t.type === 'bill' || t.type === 'recharge' || t.type === 'coffre_deposit');
    const inp = txs.filter(t => t.type === 'recv' || t.type === 'transfer_in');
    const totalOut = out.reduce((s, t) => s + (t.amount || 0), 0);
    const totalIn = inp.reduce((s, t) => s + (t.amount || 0), 0);
    $('bud-out').textContent = f(totalOut) + ' F';
    $('bud-in').textContent = f(totalIn) + ' F';
    
    // Catégories
    const cats = [
      { name: 'Transferts', ico: 'send', col: '#D4A017', bg: 'rgba(212,160,23,.12)', types: ['send', 'transfer'] },
      { name: 'Paiements', ico: 'pay', col: '#3b82f6', bg: 'rgba(59,130,246,.12)', types: ['qr', 'bill'] },
      { name: 'Recharges', ico: 'phone', col: '#dc2626', bg: 'rgba(220,38,38,.12)', types: ['recharge'] },
      { name: 'Coffre', ico: 'lock', col: '#0A4A2E', bg: 'rgba(10,74,46,.12)', types: ['coffre_deposit'] },
    ];
    $('cat-list').innerHTML = cats.map(cat => {
      const total = txs.filter(t => cat.types.includes(t.type)).reduce((s, t) => s + (t.amount || 0), 0);
      const pct = totalOut > 0 ? Math.round(total / totalOut * 100) : 0;
      return `<div class="cat-item"><div class="cat-ic" style="background:${cat.bg}">${si(cat.ico, cat.col, 15)}</div><div style="flex:1"><div class="cat-name">${cat.name}</div><div class="cat-bar-wrap" style="margin-top:5px"><div class="cat-bar-fill" style="width:${pct}%;background:${cat.col}"></div></div></div><div class="cat-right"><div class="cat-val">${f(total)} F</div><div class="cat-pct">${pct}%</div></div></div>`;
    }).join('');

    // Bar chart local (transactions localStorage)
    G._renderBudgetChart(txs.map(t => ({ from_user_id: t.type !== 'recv' ? 'me' : null, amount: t.amount, created_at: new Date().toISOString(), type: t.type })), 'me');

    // All transactions
    if (currentUser) {
      db.from('transactions')
        .select('*, from_user:from_user_id(name,avatar), to_user:to_user_id(name,avatar)')
        .or(`from_user_id.eq.${currentUser.id},to_user_id.eq.${currentUser.id}`)
        .order('created_at', { ascending: false })
        .limit(50)
        .then(({ data: txs2 }) => {
          if (!txs2?.length) { $('all-tx').innerHTML = '<div style="padding:16px;text-align:center;color:var(--txt3);font-size:.8rem">Aucune transaction</div>'; return; }
          G._renderBudgetChart(txs2, currentUser.id);
          // Recalculate totals from DB data
          let dbOut = 0, dbIn = 0;
          txs2.forEach(t => {
            if (t.to_user_id === currentUser.id) dbIn += (t.amount || 0);
            else dbOut += (t.amount || 0);
          });
          if ($('bud-out')) $('bud-out').textContent = f(dbOut) + ' F';
          if ($('bud-in')) $('bud-in').textContent = f(dbIn) + ' F';
          // Recalculer les catégories depuis les données DB
          const dbCats = [
            { name: 'Transferts', ico: 'send', col: '#D4A017', bg: 'rgba(212,160,23,.12)', types: ['transfer'] },
            { name: 'Paiements', ico: 'pay', col: '#3b82f6', bg: 'rgba(59,130,246,.12)', types: ['qr', 'bill'] },
            { name: 'Recharges', ico: 'phone', col: '#dc2626', bg: 'rgba(220,38,38,.12)', types: ['recharge'] },
            { name: 'Coffre', ico: 'lock', col: '#0A4A2E', bg: 'rgba(10,74,46,.12)', types: ['coffre_deposit'] },
          ];
          if ($('cat-list')) $('cat-list').innerHTML = dbCats.map(cat => {
            const total = txs2.filter(t => t.from_user_id === currentUser.id && cat.types.includes(t.type)).reduce((s,t) => s+(t.amount||0), 0);
            const pct = dbOut > 0 ? Math.round(total / dbOut * 100) : 0;
            return `<div class="cat-item"><div class="cat-ic" style="background:${cat.bg}">${si(cat.ico, cat.col, 15)}</div><div style="flex:1"><div class="cat-name">${cat.name}</div><div class="cat-bar-wrap" style="margin-top:5px"><div class="cat-bar-fill" style="width:${pct}%;background:${cat.col}"></div></div></div><div class="cat-right"><div class="cat-val">${f(total)} F</div><div class="cat-pct">${pct}%</div></div></div>`;
          }).join('');
          $('all-tx').innerHTML = txs2.map(t => {
            const isCredit = t.to_user_id === currentUser.id;
            const other = isCredit ? t.from_user : t.to_user;
            const name = other?.name || t.merchant_name || 'GhettoPay';
            const ico = { transfer: isCredit?'recv':'send', qr:'qric', recharge:'phone', bill:'pay', coffre_deposit:'lock', tontine:'users' }[t.type] || 'send';
            const col = isCredit ? '#16A34A' : '#DC2626';
            const bg = isCredit ? 'rgba(22,163,74,.12)' : 'rgba(212,160,23,.12)';
            const cat = { transfer:'Transfert', qr:'QR Pay', recharge:'Recharge', bill:'Facture', coffre_deposit:'Coffre', tontine:'Tontine' }[t.type] || t.type;
            const time = new Date(t.created_at).toLocaleDateString('fr-FR', { day:'numeric', month:'short' });
            return G._txRow(isCredit, name, ico, col, bg, cat, time, t.amount);
          }).join('');
        });
    } else {
      $('all-tx').innerHTML = txs.length ? txs.map(t => {
        const isCredit = t.type === 'recv';
        const ico = { recv:'recv', send:'send', qr:'qric', recharge:'phone', bill:'pay', coffre_deposit:'lock', tontine:'users' }[t.type] || 'send';
        const col = isCredit ? '#16A34A' : '#DC2626';
        const bg = isCredit ? 'rgba(22,163,74,.12)' : 'rgba(212,160,23,.12)';
        const cat = t.cat || { recv:'Reçu', send:'Envoyé', qr:'QR Pay', recharge:'Recharge', bill:'Facture', coffre_deposit:'Coffre', tontine:'Tontine' }[t.type] || t.type;
        return G._txRow(isCredit, t.name||'Inconnu', ico, col, bg, cat, t.time||'—', t.amount);
      }).join('') : '<div style="padding:16px;text-align:center;color:var(--txt3);font-size:.8rem">Aucune transaction</div>';
    }
  },

  // ── TONTINE ──
  r_tontine() { G._loadTontines(); },

  // Affiche immédiatement le cache local, puis rafraîchit depuis la DB en parallèle
  _loadTontines() {
    const cached = S.get('tontines', []);
    G._tontinesList = cached;

    // Rendu instantané depuis le cache
    if (cached.length) {
      G._renderTontinesList(cached);
    } else {
      // Skeleton si aucune donnée en cache et utilisateur connecté
      $('tontine-list').innerHTML = currentUser
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

    if (!currentUser) return;

    // 3 requêtes en parallèle pour couvrir tous les cas :
    // A) tontines créées par l'utilisateur (toujours accessible)
    // B) IDs des tontines où l'utilisateur est membre (tontine_members)
    // C) membres de toutes les tontines connues (pour affichage)
    Promise.all([
      db.from('tontines').select('*').eq('creator_id', currentUser.id),
      db.from('tontine_members').select('tontine_id').eq('user_id', currentUser.id)
    ]).then(async ([{ data: ownTontines }, { data: memberships }]) => {

      // IDs des tontines où l'utilisateur est membre mais pas créateur
      const ownIds = new Set((ownTontines || []).map(t => t.id));
      const memberIds = (memberships || [])
        .map(m => m.tontine_id)
        .filter(id => !ownIds.has(id));

      // Fetch les tontines d'invitation si nécessaire
      let invitedTontines = [];
      if (memberIds.length) {
        const { data } = await db.from('tontines').select('*').in('id', [...new Set(memberIds)]);
        invitedTontines = data || [];
      }

      // Merge : tontines créées + tontines invitées
      const allTontines = [...(ownTontines || [])];
      for (const t of invitedTontines) {
        if (!allTontines.find(x => x.id === t.id)) allTontines.push(t);
      }

      // Fallback cache pour tontines invitées introuvables (RLS)
      for (const id of [...new Set(memberIds)]) {
        if (!allTontines.find(t => t.id === id)) {
          const c = cached.find(x => String(x.id) === String(id));
          if (c) allTontines.push(c);
        }
      }

      if (!allTontines.length) { if (!cached.length) G._renderTontinesList([]); return; }

      // Fetch tous les membres en une requête
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

      S.set('tontines', result);
      G._tontinesList = result;
      G._renderTontinesList(result);
      G._syncNotifs();
    }).catch(() => { if (!cached.length) G._renderTontinesList([]); });
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
      const mPhone = m => typeof m === 'string' ? '' : (m?.phone || '');
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
    if (!currentUser) return;
    db.from('notifications').select('*').eq('user_id', currentUser.id).eq('read', false)
      .then(({ data: dbNotifs }) => {
        if (!dbNotifs?.length) return;
        const existing = S.get('notifs', []);
        const existingIds = new Set(existing.map(n => String(n.id)));
        const newOnes = dbNotifs.filter(n => !existingIds.has(String(n.id))).map(n => ({
          id: n.id, type: n.type || 'tontine', icon: 'users',
          bg: 'rgba(10,74,46,.12)', color: 'var(--forest)',
          title: n.title, desc: n.body || '', time: new Date(n.created_at).toLocaleDateString('fr-FR',{day:'numeric',month:'short'}), read: false
        }));
        if (newOnes.length) S.set('notifs', [...newOnes, ...existing]);
      }).catch(() => {});
  },

  _tontineMembers: [], // [{ name, phone }]

  addTontineMember(name, phone, userId) {
    const n = name || $('nt-member-name')?.value.trim();
    const p = phone || $('nt-member-phone')?.value.trim() || '';
    if (!n) { G.toast('Saisis un nom', 'err'); return; }
    if (G._tontineMembers.find(m => m.name === n && m.phone === p)) { G.toast('Déjà ajouté', 'err'); return; }
    G._tontineMembers.push({ name: n, phone: p, userId: userId || null });
    if ($('nt-member-name')) $('nt-member-name').value = '';
    if ($('nt-member-phone')) $('nt-member-phone').value = '';
    G._renderTontineMembers();
  },

  _renderTontineMembers() {
    const list = $('nt-members-list');
    if (!list) return;
    list.innerHTML = G._tontineMembers.map((m, i) =>
      `<div style="display:flex;align-items:center;gap:8px;padding:9px 12px;background:var(--bg2);border-radius:12px">
        <div style="width:24px;height:24px;border-radius:50%;background:var(--forest);color:#fff;font-size:.65rem;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0">${i+1}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:.8rem;font-weight:700;color:var(--txt)">${esc(m.name)}</div>
          ${m.phone ? `<div style="font-size:.6rem;color:var(--txt3);font-family:var(--fm)">${esc(m.phone)}</div>` : ''}
        </div>
        <button onclick="G._removeTontineMember(${i})" style="border:none;background:rgba(220,38,38,.08);color:#dc2626;cursor:pointer;font-size:.75rem;padding:4px 8px;border-radius:8px;font-weight:700">✕</button>
      </div>`
    ).join('') || '';
    G._updateNtCount();
  },

  _removeTontineMember(i) {
    G._tontineMembers.splice(i, 1);
    G._renderTontineMembers();
  },

  _closeTontineModal() {
    G._tontineMembers = [];
    G.closeModal('mt');
    ['nt-name','nt-amount','nt-search'].forEach(id => { const el = $(id); if (el) el.value = ''; });
    const res = $('nt-search-results'); if (res) res.style.display = 'none';
    const list = $('nt-members-list'); if (list) list.innerHTML = '';
    G._updateNtCount();
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
    const n = G._tontineMembers.length;
    const badge = $('nt-count-badge'), txt = $('nt-count-txt');
    if (badge) { badge.textContent = n + ' membre' + (n > 1 ? 's' : ''); badge.style.display = n ? '' : 'none'; }
    if (txt) txt.textContent = n + ' membre' + (n > 1 ? 's' : '');
  },

  async searchTontineUsers(q) {
    const res = $('nt-search-results');
    if (!res) return;
    if (!q || q.length < 2) { res.style.display = 'none'; return; }
    let users = [];
    if (currentUser) {
      const { data } = await db.from('users').select('id,name,phone,avatar')
        .neq('id', currentUser.id)
        .or(`name.ilike.%${q}%,phone.ilike.%${q}%`)
        .limit(8);
      users = data || [];
    } else {
      users = (S.get('contacts', [])).filter(u => (u.name||'').toLowerCase().includes(q.toLowerCase()) || (u.phone||'').includes(q));
    }
    if (!users.length) { res.style.display = 'none'; return; }
    G._ntSearchCache = users;
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
    const u = G._ntSearchCache[idx];
    if (!u) return;
    G.addTontineMember(u.name, u.phone || '', u.id || null);
    const inp = $('nt-search'); if (inp) inp.value = '';
    const res = $('nt-search-results'); if (res) res.style.display = 'none';
  },

  async pickTontineContact() {
    if (!('contacts' in navigator && 'ContactsManager' in window)) {
      G.toast('Non disponible · Saisie manuelle', 'err'); return;
    }
    try {
      const contacts = await navigator.contacts.select(['name', 'tel'], { multiple: true });
      if (contacts?.length) {
        contacts.forEach(c => {
          const name = c.name?.[0] || '';
          const phone = c.tel?.[0] || '';
          if (name || phone) G.addTontineMember(name || phone, phone);
        });
        G.toast(`${contacts.length} contact${contacts.length > 1 ? 's' : ''} ajouté${contacts.length > 1 ? 's' : ''}`, 'inf');
      }
    } catch(e) { G.toast('Accès contacts refusé', 'err'); }
  },

  async createTontine() {
    const name = $('nt-name')?.value.trim();
    const amount = parseInt($('nt-amount')?.value) || 0;
    const freq = $('nt-freq')?.value || 'monthly';
    const tontNameErr = validateName(name);
    if (tontNameErr) { G.toast(tontNameErr, 'err'); return; }
    if (amount <= 0) { G.toast('Montant requis', 'err'); return; }

    // Creator always first member, then invited members
    const creatorEntry = { name: S.get('user',{}).name || 'Moi', phone: currentUser?.phone || '', userId: currentUser?.id };
    const rawMembers = G._tontineMembers.length > 0 ? [creatorEntry, ...G._tontineMembers] : [creatorEntry];
    // Noms pour affichage et DB
    const memberNames = rawMembers.map(m => typeof m === 'string' ? m : m.name);

    let localId = Date.now().toString();
    if (currentUser) {
      try {
        const startDate = new Date().toISOString();
        const { data: dbT, error } = await db.from('tontines').insert({
          name, creator_id: currentUser.id,
          amount_per_cycle: amount, frequency: freq,
          start_date: startDate
        }).select().single();
        if (!error && dbT) {
          localId = dbT.id;
          // Résoudre les user_id : 1) ID stocké lors de la recherche, 2) recherche par téléphone
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

          // Envoyer une notification DB à chaque membre GhettoPay (sauf le créateur)
          const notifInserts = inserts
            .filter(r => r.user_id && r.user_id !== currentUser.id)
            .map(r => ({
              user_id: r.user_id,
              type: 'tontine_invite',
              title: `Tu as été ajouté à "${name}"`,
              body: `${S.get('user',{}).name || 'Quelqu\'un'} t\'a invité dans la tontine "${name}" · ${freq === 'weekly' ? 'Hebdo' : 'Mensuel'} · ${f(amount)} FCFA`,
              read: false
            }));
          if (notifInserts.length) {
            await db.from('notifications').insert(notifInserts).catch(() => {});
          }
        }
      } catch(e) { /* fall through to localStorage */ }
    }

    const tontines = S.get('tontines', []);
    if (!tontines.find(t => String(t.id) === String(localId))) {
      tontines.unshift({ id: localId, name, amount_per_cycle: amount, frequency: freq, members_count: rawMembers.length, members_paid: 0, paid_by: [], members: rawMembers, start_date: new Date().toISOString() });
      S.set('tontines', tontines);
    }

    G._tontineMembers = [];
    G._closeTontineModal();
    G.r_tontine();
    if (window.innerWidth >= 1280) G.gp_renderTontine();
    G.toast('Tontine créée !', 'ok');
  },

  _payCurrentTontine() {
    const t = G._curTontine; if (!t) return;
    G.payTontine(t.id, t.amount_per_cycle, t.name);
  },

  async _checkAutoDistribute(tontineId, newPaid, tData) {
    if (!currentUser || !tData) return;
    // Récupérer tous les membres dans l'ordre
    const { data: members } = await db.from('tontine_members')
      .select('user_id, member_name, turn_order')
      .eq('tontine_id', tontineId)
      .order('turn_order', { ascending: true });
    const total = members?.length || 0;
    if (total === 0) return;
    // Use real DB count to avoid race conditions with concurrent payments
    const { count: paidCount } = await db.from('tontine_members')
      .select('id', { count: 'exact', head: true })
      .eq('tontine_id', tontineId).eq('has_paid', true);
    if ((paidCount || 0) < total) return;

    // Calculer qui reçoit ce cycle
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
      // Pas de compte GhettoPay — notifier seulement
      G.toast(`🎉 Tout le monde a cotisé ! ${f(totalAmount)} FCFA à remettre à ${recipientName}`, 'ok');
      return;
    }

    // Créditer le wallet du bénéficiaire
    const { data: rWallet } = await db.from('wallets')
      .select('balance').eq('user_id', recipient.user_id).maybeSingle();
    if (rWallet) {
      await db.from('wallets')
        .update({ balance: (rWallet.balance || 0) + totalAmount })
        .eq('user_id', recipient.user_id).catch(() => {});
    }

    // Transaction crédit pour le bénéficiaire
    await db.from('transactions').insert({
      to_user_id: recipient.user_id,
      amount: totalAmount,
      type: 'transfer',
      merchant_name: `Cagnotte tontine — ${tontineName}`,
      status: 'completed'
    }).catch(() => {});

    // Notification au bénéficiaire
    await db.from('notifications').insert({
      user_id: recipient.user_id, type: 'tontine_payment',
      title: `🎉 Cagnotte reçue — ${tontineName}`,
      body: `Tous les membres ont cotisé ! ${f(totalAmount)} FCFA ont été versés sur ton compte.`,
      read: false
    }).catch(() => {});

    // Notifications à tous les autres membres
    const others = members.filter(m => m.user_id && m.user_id !== recipient.user_id);
    if (others.length) {
      await db.from('notifications').insert(others.map(m => ({
        user_id: m.user_id, type: 'tontine_payment',
        title: `Cagnotte distribuée — ${tontineName}`,
        body: `${recipientName} a reçu ${f(totalAmount)} FCFA (tous ont cotisé ce cycle).`,
        read: false
      }))).catch(() => {});
    }

    // Si c'est le current user qui reçoit, mettre à jour son solde local
    if (recipient.user_id === currentUser.id) {
      const newBal = S.get('bal', 0) + totalAmount;
      S.set('bal', newBal);
      if ($('bal-amt')) $('bal-amt').textContent = f(newBal);
      setTimeout(() => G.ok(`🎉 Tu as reçu la cagnotte !`, `${f(totalAmount)} FCFA de "${tontineName}" ont été versés sur ton compte.`, () => G.go('home')), 1500);
    } else {
      G.toast(`🎉 Cagnotte versée à ${recipientName} — ${f(totalAmount)} FCFA`, 'ok');
    }
  },

  async payTontine(tontineId, amount, name) {
    const n = parseInt(amount) || 0;
    const bal = S.get('bal', 0);
    const payErr = validateAmount(n, bal);
    if (payErr) { G.toast(payErr, 'err'); return; }
    const u = S.get('user', {});

    // Vérifier si déjà payé (DB d'abord, cache ensuite)
    if (currentUser) {
      const { data: myRow } = await db.from('tontine_members')
        .select('has_paid').eq('tontine_id', tontineId).eq('user_id', currentUser.id).maybeSingle();
      if (myRow?.has_paid) { G.toast('Tu as déjà cotisé ce cycle', 'err'); return; }
    } else {
      const lt = S.get('tontines', []).find(x => String(x.id) === String(tontineId));
      if (lt?.paid_by?.includes(u.name || 'Moi')) { G.toast('Tu as déjà cotisé ce cycle', 'err'); return; }
    }

    if (currentUser) {
      // 1. Débiter le wallet
      await db.from('wallets').update({ balance: bal - n }).eq('user_id', currentUser.id);
      // 2. Marquer has_paid dans tontine_members
      await db.from('tontine_members').update({ has_paid: true })
        .eq('tontine_id', tontineId).eq('user_id', currentUser.id);
      // 3. Récupérer infos tontine + compter les paiements réels (évite les race conditions)
      const { data: tData } = await db.from('tontines')
        .select('creator_id, amount_per_cycle, frequency, start_date, name').eq('id', tontineId).maybeSingle();
      const { count: realPaid } = await db.from('tontine_members')
        .select('id', { count: 'exact', head: true })
        .eq('tontine_id', tontineId).eq('has_paid', true);
      const newPaid = realPaid || 1;
      await db.from('tontines').update({ members_paid: newPaid }).eq('id', tontineId);
      // 4. Transaction
      await db.from('transactions').insert({
        from_user_id: currentUser.id, amount: n, type: 'tontine', merchant_name: name, status: 'completed'
      });
      // 5. Notification au créateur
      if (tData?.creator_id && tData.creator_id !== currentUser.id) {
        await db.from('notifications').insert({
          user_id: tData.creator_id, type: 'tontine_payment',
          title: `Cotisation reçue — ${name}`,
          body: `${u.name || 'Un membre'} a cotisé ${f(n)} FCFA pour la tontine "${name}".`,
          read: false
        }).catch(() => {});
      }
      // 6. Notifications aux autres membres GhettoPay
      const { data: otherRows } = await db.from('tontine_members')
        .select('user_id').eq('tontine_id', tontineId).neq('user_id', currentUser.id);
      const otherIds = [...new Set((otherRows || []).map(r => r.user_id).filter(id => id && id !== tData?.creator_id))];
      if (otherIds.length) {
        await db.from('notifications').insert(otherIds.map(uid => ({
          user_id: uid, type: 'tontine_payment',
          title: `Cotisation — ${name}`,
          body: `${u.name || 'Un membre'} a cotisé pour ce cycle.`,
          read: false
        }))).catch(() => {});
      }
      // 7. Vérifier si tout le monde a payé → versement automatique
      await G._checkAutoDistribute(tontineId, newPaid, tData);
      S.set('bal', bal - n);
    } else {
      S.set('bal', bal - n);
    }

    // Mettre à jour le cache local
    const tontines = S.get('tontines', []);
    const lt = tontines.find(x => String(x.id) === String(tontineId));
    const tgt = lt || G._curTontine;
    if (tgt) {
      if (!tgt.paid_by) tgt.paid_by = [];
      if (!tgt.paid_by.includes(u.name || 'Moi')) {
        tgt.paid_by.push(u.name || 'Moi');
        tgt.members_paid = (tgt.members_paid || 0) + 1;
      }
      if (lt) { lt.paid_by = tgt.paid_by; lt.members_paid = tgt.members_paid; S.set('tontines', tontines); }
      if (G._curTontine) { G._curTontine.paid_by = [...(tgt.paid_by||[])]; G._curTontine.members_paid = tgt.members_paid; }
    }

    const txList = S.get('txs', []);
    txList.unshift({ id: Date.now(), type: 'tontine', name, amount: n, time: new Date().toLocaleDateString('fr-FR',{day:'numeric',month:'short'}), cat: 'Tontine' });
    S.set('txs', txList);

    // Actualiser l'affichage solde
    if ($('bal-amt')) $('bal-amt').textContent = f(bal - n);

    if (cur === 'tontine-detail') G.r_tontine_detail();
    else G.r_tontine();
    G.ok(`${f(n)} FCFA cotisés`, `${name} · Confirmé ✓`, () => {});
  },

  // ── TONTINE DETAIL ──
  _curTontine: null,
  _tontineManageOpen: false,
  _tontinesList: [],

  openTontine(id) {
    // Search in the last loaded list (covers DB UUIDs and localStorage timestamps)
    G._curTontine = G._tontinesList.find(t => String(t.id) === String(id))
                 || S.get('tontines', []).find(t => String(t.id) === String(id))
                 || null;
    G._tontineManageOpen = false;
    G.go('tontine-detail');
  },

  r_tontine_detail() {
    const t = G._curTontine;
    if (!t) { G.back(); return; }
    if ($('td-title')) $('td-title').textContent = t.name;

    const u = S.get('user', {});
    const members = t.members || [];
    const mName = m => typeof m === 'string' ? m : (m?.name || '?');
    const mPhone = m => typeof m === 'string' ? '' : (m?.phone || '');
    const isCreator = !!(currentUser && t.creator_id === currentUser.id);
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

    // Current cycle index
    let cycleIdx = 0;
    if (isWeekly) cycleIdx = Math.floor((now - startDate) / 604800000);
    else cycleIdx = (now.getFullYear() - startDate.getFullYear()) * 12 + (now.getMonth() - startDate.getMonth());
    const currentTurnIdx = members.length > 0 ? cycleIdx % members.length : 0;
    const currentRecipient = members[currentTurnIdx] ? mName(members[currentTurnIdx]) : '—';
    const myMember = members.find(m => m.user_id && currentUser && m.user_id === currentUser.id);
    const alreadyPaid = myMember?.has_paid || t.paid_by?.includes(u.name || 'Moi');

    // Build schedule (show up to 12 upcoming cycles)
    const schedule = members.map((m, i) => {
      const totalCycles = Math.floor(cycleIdx / members.length) * members.length + i;
      const d = new Date(startDate);
      if (isWeekly) d.setDate(d.getDate() + totalCycles * 7);
      else d.setMonth(d.getMonth() + totalCycles);
      // Adjust if date is in the past
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

    // Calendar: mini month view
    const calYear = now.getFullYear(), calMonth = now.getMonth();
    const firstDay = new Date(calYear, calMonth, 1).getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const calTitle = now.toLocaleDateString('fr-FR',{month:'long',year:'numeric'});

    // Highlighted days: next payment day this month for current recipient
    let highlightDay = null;
    if (!isWeekly) {
      // For monthly tontine, payment is on startDate's day of the month
      const payDay = startDate.getDate();
      if (payDay <= daysInMonth) highlightDay = payDay;
    } else {
      // For weekly, highlight the day of the week matching start
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

    // Membres row (commun créateur + membre)
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

    // Manage section : créateur = plein contrôle, membre = vue lecture + partage
    const manageHTML = G._tontineManageOpen ? `
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

      ${!isCreator ? `<button onclick="G.deleteTontine('${t.id}','${t.name}')" style="width:100%;padding:11px;border:1px solid rgba(220,38,38,.25);border-radius:12px;background:rgba(220,38,38,.07);color:#dc2626;font-size:.8rem;font-weight:700;cursor:pointer">Quitter cette tontine</button>` : ''}

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
    G._tontineManageOpen = !G._tontineManageOpen;
    G.r_tontine_detail();
  },

  async _addTontineDetailMember() {
    const name = $('td-add-name')?.value.trim();
    const phone = $('td-add-phone')?.value.trim() || '';
    if (!name) { G.toast('Saisis un nom', 'err'); return; }
    const t = G._curTontine;
    if (!t.members) t.members = [];
    if (t.members.find(m => (typeof m === 'string' ? m : m.name) === name)) { G.toast('Déjà membre', 'err'); return; }
    t.members.push({ name, phone });
    t.members_count = t.members.length;
    G._saveCurTontine();

    // Ajouter dans Supabase avec le vrai user_id si le membre est un utilisateur GhettoPay
    if (currentUser) {
      try {
        let invitedId = null;
        if (phone) {
          const { data: found } = await db.from('users').select('id').eq('phone', phone).maybeSingle();
          if (found) invitedId = found.id;
        }
        // Insérer dans tontine_members avec member_name et member_phone
        await db.from('tontine_members').insert({
          tontine_id: t.id,
          user_id: invitedId || null,
          turn_order: t.members.length,
          has_paid: false,
          member_name: name,
          member_phone: phone || null
        });
        // Notifier l'utilisateur GhettoPay invité
        if (invitedId) {
          const creator = S.get('user', {});
          await db.from('notifications').insert({
            user_id: invitedId, type: 'tontine_invite',
            title: `Tu as été ajouté à "${t.name}"`,
            body: `${creator.name || 'Quelqu\'un'} t\'a invité dans la tontine "${t.name}" — ${t.frequency === 'weekly' ? 'Hebdo' : 'Mensuel'} · ${f(t.amount_per_cycle)} FCFA`,
            read: false
          }).catch(() => {});
          G.toast(`${name} notifié !`, 'ok');
        }
      } catch(e) {}
    }

    // Notification locale pour le créateur
    const notifs = S.get('notifs', []);
    notifs.unshift({ id: Date.now(), type: 'tontine', icon: 'users', bg: 'rgba(10,74,46,.12)', color: 'var(--forest)', title: 'Membre ajouté', desc: `${name} a été ajouté à la tontine "${t.name}"`, time: 'À l\'instant', read: false });
    S.set('notifs', notifs);

    G.r_tontine_detail();
  },

  _remindMember(name, phone, tontineName) {
    // Notification locale
    const notifs = S.get('notifs', []);
    notifs.unshift({ id: Date.now(), type: 'tontine', icon: 'users', bg: 'rgba(212,160,23,.1)', color: 'var(--gold2)', title: `Rappel envoyé à ${name}`, desc: `Rappel de cotiser "${tontineName}" envoyé`, time: 'À l\'instant', read: false });
    S.set('notifs', notifs);
    // Rappel via DB si user GhettoPay
    if (currentUser && phone) {
      db.from('users').select('id').eq('phone', phone).maybeSingle().then(({ data: u }) => {
        if (u) {
          db.from('notifications').insert({ user_id: u.id, type: 'tontine_reminder', title: `Rappel tontine`, body: `${S.get('user',{}).name||'Le créateur'} te rappelle de cotiser pour "${tontineName}"`, read: false }).catch(()=>{});
        }
      });
    }
    G.toast(`Rappel envoyé à ${name}`, 'ok');
  },

  _sendToRecipient(name, phone, amount) {
    // Pre-fill send screen with recipient
    selC = { id: 'tontine_' + phone, name, phone, av: (name[0]||'?').toUpperCase() };
    G.go('send');
    setTimeout(() => {
      if ($('rec-av')) $('rec-av').textContent = selC.av;
      if ($('rec-name')) $('rec-name').textContent = selC.name;
      if ($('rec-phone')) $('rec-phone').textContent = selC.phone;
      if ($('rec-row')) $('rec-row').style.display = 'flex';
      // Pre-fill amount
      aStr = String(amount);
      if ($('amt-disp')) $('amt-disp').textContent = f(amount);
    }, 150);
  },

  _remindMemberByIdx(i) {
    const t = G._curTontine; if (!t) return;
    const mName = m => typeof m === 'string' ? m : (m?.name || '?');
    const mPhone = m => typeof m === 'string' ? '' : (m?.phone || '');
    const m = t.members?.[i]; if (!m) return;
    G._remindMember(mName(m), mPhone(m), t.name);
  },

  _sendToRecipientByIdx(i) {
    const t = G._curTontine; if (!t) return;
    const mName = m => typeof m === 'string' ? m : (m?.name || '?');
    const mPhone = m => typeof m === 'string' ? '' : (m?.phone || '');
    const m = t.members?.[i]; if (!m) return;
    G._sendToRecipient(mName(m), mPhone(m), t.amount_per_cycle);
  },

  async _removeTontineDetailMember(i) {
    const t = G._curTontine;
    if (!t?.members) return;
    const m = t.members[i];
    const mn = typeof m === 'string' ? m : (m?.name || '');
    const mp = typeof m === 'string' ? '' : (m?.phone || '');
    t.members.splice(i, 1);
    t.members_count = t.members.length;
    G._saveCurTontine();
    // Supprimer de la DB (par phone → user_id, sinon par member_name)
    if (currentUser && t.id) {
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
    G.r_tontine_detail();
  },

  _saveCurTontine() {
    const t = G._curTontine;
    if (!t) return;
    const tontines = S.get('tontines', []);
    const idx = tontines.findIndex(x => String(x.id) === String(t.id));
    if (idx >= 0) tontines[idx] = t;
    S.set('tontines', tontines);
  },

  // ── FACTURES ──
  r_factures() {
    const bills = S.get('bills', []);
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
    const bills = S.get('bills', []);
    const b = bills.find(x => x.id == id);
    if (!b) return;
    const bal = S.get('bal', 0);
    if (b.amount > bal) { G.toast('Solde insuffisant', 'err'); return; }
    b.paid = true;
    S.set('bal', bal - b.amount);
    S.set('bills', bills);
    if (currentUser) {
      db.from('transactions').insert({ from_user_id: currentUser.id, amount: b.amount, type: 'bill', merchant_name: b.name, status: 'completed' });
      db.from('wallets').update({ balance: bal - b.amount }).eq('user_id', currentUser.id);
    }
    // Animate removal from DOM immediately
    const el = $('bill-' + id);
    if (el) { el.style.transition = 'opacity .3s,transform .3s'; el.style.opacity = '0'; el.style.transform = 'translateX(40px)'; setTimeout(() => { el.remove(); G.r_factures(); }, 320); }
    else { G.r_factures(); }
    G.toast(`${b.name} payée · ${f(b.amount)} FCFA`, 'inf');
  },

  payAll() {
    const bills = S.get('bills', []).filter(b => !b.paid);
    if (!bills.length) { G.toast('Toutes les factures sont déjà payées', 'inf'); return; }
    let bal = S.get('bal', 0);
    const total = bills.reduce((s, b) => s + b.amount, 0);
    if (total > bal) { G.toast('Solde insuffisant', 'err'); return; }
    const allBills = S.get('bills', []);
    for (const b of bills) { b.paid = true; bal -= b.amount; }
    S.set('bal', bal);
    S.set('bills', allBills);
    // Animate all out
    bills.forEach(b => {
      const el = $('bill-' + b.id);
      if (el) { el.style.transition = 'opacity .3s,transform .3s'; el.style.opacity = '0'; el.style.transform = 'translateX(40px)'; }
    });
    setTimeout(() => {
      G.r_factures();
      G.ok(`${bills.length} facture${bills.length>1?'s':''} payée${bills.length>1?'s':''}`, `Total : ${f(total)} FCFA · Confirmé ✓`, () => G.go('home'));
    }, 350);
  },

  // ── RECHARGE ──
  setOp(n, on, off) { $('rch-op').value = n; $(on).classList.add('on'); $(off).classList.remove('on'); },
  setPill(el, v) { el.closest('.pills').querySelectorAll('.pill').forEach(p => p.classList.remove('on')); el.classList.add('on'); $('rch-amt').value = v; },
  setDur(el, m) { document.querySelectorAll('#mc .pill').forEach(p => p.classList.remove('on')); el.classList.add('on'); $('nc-months').value = m; G._coffreCalc(); },
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
    if (rchPhoneErr) { G.toast(rchPhoneErr, 'err'); return; }
    const bal = S.get('bal', 0);
    const rchAmtErr = validateAmount(n, bal);
    if (rchAmtErr) { G.toast(rchAmtErr, 'err'); return; }
    S.set('bal', bal - n);
    if (currentUser) {
      db.from('wallets').update({ balance: bal - n }).eq('user_id', currentUser.id);
      db.from('transactions').insert({ from_user_id: currentUser.id, amount: n, type: 'recharge', merchant_name: `Recharge ${op}`, status: 'completed' });
    }
    G.ok('Recharge effectuée', `${f(n)} FCFA de crédit ${op}`, () => G.go('home'));
  },

  // ── NOTIFS ──
  r_notifs() {
    // Affichage immédiat depuis le cache
    G._renderNotifsList(S.get('notifs', []));
    // Puis sync depuis la DB
    if (!currentUser) return;
    db.from('notifications')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data: dbNotifs }) => {
        if (!dbNotifs?.length) return;
        const iconFor  = t => ({ tontine_invite:'users', tontine_reminder:'users' }[t] || 'bell');
        const bgFor    = t => t === 'tontine_reminder' ? 'rgba(212,160,23,.1)' : 'rgba(10,74,46,.12)';
        const colorFor = t => t === 'tontine_reminder' ? 'var(--gold2)' : 'var(--forest)';
        const existing = S.get('notifs', []);
        const existingIds = new Set(existing.map(n => String(n.id)));
        const newOnes = dbNotifs.filter(n => !existingIds.has(String(n.id))).map(n => ({
          id: n.id, type: n.type || 'tontine',
          icon: iconFor(n.type), bg: bgFor(n.type), color: colorFor(n.type),
          title: n.title || '', desc: n.body || '',
          time: new Date(n.created_at).toLocaleDateString('fr-FR', { day:'numeric', month:'short' }),
          read: n.read || false
        }));
        if (!newOnes.length) return;
        const merged = [...newOnes, ...existing];
        S.set('notifs', merged);
        G._renderNotifsList(merged);
        const unread = merged.filter(n => !n.read).length;
        if ($('notif-dot')) $('notif-dot').style.display = unread ? 'block' : 'none';
      }).catch(() => {});
  },

  _renderNotifsList(notifs) {
    if (!$('notif-list')) return;
    const iconFor = t => ({tontine_invite:'users',tontine_reminder:'users',tontine_payment:'z',tontine_refund:'recv',transfer:'recv'}[t] || 'bell');
    const bgFor = t => ({tontine_invite:'rgba(10,74,46,.12)',tontine_payment:'rgba(22,163,74,.12)',tontine_refund:'rgba(59,130,246,.12)',tontine_reminder:'rgba(212,160,23,.1)'}[t] || 'rgba(10,74,46,.1)');
    const colFor = t => ({tontine_invite:'var(--forest)',tontine_payment:'var(--green)',tontine_refund:'#3b82f6',tontine_reminder:'var(--gold2)'}[t] || 'var(--forest)');
    $('notif-list').innerHTML = notifs.map(n => {
      const ico = n.icon || iconFor(n.type);
      const bg = n.bg || bgFor(n.type);
      const col = n.color || colFor(n.type);
      return `<div class="notif-item ${n.read ? '' : 'unread'}" style="display:flex;align-items:flex-start;gap:12px;padding:14px 16px;border-bottom:1px solid var(--border);cursor:pointer" onclick="G._markNotifRead('${n.id}',this)">
        <div class="notif-ic" style="background:${bg};flex-shrink:0;margin-top:2px">${si(ico, col, 17)}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:.82rem;font-weight:${n.read ? '600' : '800'};color:var(--txt);margin-bottom:2px">${esc(n.title)}</div>
          <div style="font-size:.7rem;color:var(--txt3);line-height:1.5">${esc(n.desc || '')}</div>
          <div style="font-size:.6rem;color:var(--txt3);margin-top:4px;font-family:var(--fm)">${esc(n.time || '')}</div>
        </div>
        ${!n.read ? '<div style="width:8px;height:8px;border-radius:50%;background:var(--gold2);flex-shrink:0;margin-top:6px"></div>' : ''}
      </div>`;
    }).join('') || '<div style="padding:32px;text-align:center;color:var(--txt3);font-size:.82rem">Aucune notification</div>';
    // Update count in profil
    const unread = notifs.filter(n => !n.read).length;
    if ($('notif-sub')) $('notif-sub').textContent = unread ? `${unread} non lue${unread>1?'s':''}` : 'Tout lu';
    if ($('notif-dot')) $('notif-dot').style.display = unread ? 'block' : 'none';
  },

  _markNotifRead(id, el) {
    const ns = S.get('notifs', []);
    const n = ns.find(x => String(x.id) === String(id));
    if (n && !n.read) {
      n.read = true;
      S.set('notifs', ns);
      if (el) el.querySelector('div[style*="background:var(--gold2)"]')?.remove();
      el?.classList.remove('unread');
      if (currentUser && id) db.from('notifications').update({ read: true }).eq('id', id).catch(() => {});
      const unread = ns.filter(n => !n.read).length;
      if ($('notif-dot')) $('notif-dot').style.display = unread ? 'block' : 'none';
      if ($('notif-sub')) $('notif-sub').textContent = unread ? `${unread} non lue${unread>1?'s':''}` : 'Tout lu';
    }
  },

  readAll() {
    const ns = S.get('notifs', []);
    ns.forEach(n => n.read = true);
    S.set('notifs', ns);
    G._renderNotifsList(ns);
    if ($('notif-dot')) $('notif-dot').style.display = 'none';
    if ($('notif-sub')) $('notif-sub').textContent = 'Tout lu';
    // Mark read in DB
    if (currentUser) {
      db.from('notifications').update({ read: true }).eq('user_id', currentUser.id).eq('read', false).catch(() => {});
    }
    G.toast('Toutes lues', 'inf');
  },

  // ── PROFIL ──
  r_profil() {
    const u = S.get('user', {});
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
    $('prof-txc').textContent = S.get('txs', []).length;
    $('prof-cash').textContent = f(S.get('cash', 0));
    // Notif count
    const unread = S.get('notifs', []).filter(n => !n.read).length;
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
      if (currentUser) {
        try {
          const ext = file.name.split('.').pop() || 'jpg';
          const path = `avatars/${currentUser.id}.${ext}`;
          const { error: upErr } = await db.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
          if (!upErr) {
            const { data: urlData } = db.storage.from('avatars').getPublicUrl(path);
            if (urlData?.publicUrl) {
              await db.from('users').update({ avatar_url: urlData.publicUrl }).eq('id', currentUser.id);
              currentUser.avatar_url = urlData.publicUrl;
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
    const u = S.get('user', {});
    u.name = name;
    u.phone = $('ep-phone')?.value.trim();
    u.loc = $('ep-loc')?.value.trim();
    u.avatar = name[0].toUpperCase();
    S.set('user', u);

    if (currentUser) {
      await db.from('users').update({ name, phone: u.phone, location: u.loc, avatar: u.avatar }).eq('id', currentUser.id);
      currentUser.name = name;
    }

    G.closeModal('mp');
    G.render('profil');
    if (window.innerWidth >= 1280) G.gp_renderProfil();
    G.toast('Profil mis à jour', 'inf');
  },

  async logout() {
    G.toast('Déconnexion...', 'inf');
    if (currentUser) await db.auth.signOut();
    currentUser = null;
    localStorage.clear();
    setTimeout(() => G.go('onboard'), 1000);
  },

  // ── PIN (vérification) ──
  r_pin() {
    pinBuf = '';
    document.querySelectorAll('.pin-dot').forEach(d => d.classList.remove('fill', 'err'));
    const u = S.get('user', {});
    if ($('pin-sub')) {
      const name = (u.name || '').split(' ')[0];
      $('pin-sub').textContent = name ? `Bonjour ${name} · Saisis ton PIN` : 'Entre ton code PIN';
    }
  },

  pinKey(v) {
    if (pinBuf.length >= 4) return;
    pinBuf += v;
    document.querySelectorAll('.pin-dot').forEach((d, i) => d.classList.toggle('fill', i < pinBuf.length));
    if (pinBuf.length === 4) G._checkPin();
  },

  pinDel() {
    pinBuf = pinBuf.slice(0, -1);
    document.querySelectorAll('.pin-dot').forEach((d, i) => d.classList.toggle('fill', i < pinBuf.length));
  },

  _pinFailures: 0,
  _PIN_LOCKOUT_MS: 30000,
  _PIN_MAX_ATTEMPTS: 5,

  _showPinErrAnim() {
    pinBuf = '';
    document.querySelectorAll('.pin-dot').forEach(d => {
      d.classList.remove('fill');
      d.classList.add('err');
      setTimeout(() => d.classList.remove('err'), 600);
    });
  },

  _checkPin() {
    setTimeout(() => {
      const u = S.get('user', {});
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
      if (String(pinBuf) === String(u.pin)) {
        G._pinFailures = 0;
        sessionStorage.removeItem('gp_pin_locked');
        hist = [];
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
      S.set('pending_reg', { name, phone, pin, email, avatar });
      // Données complètes en local dès maintenant — le profil DB sera créé après confirmation
      S.set('user', { name, phone, email, pin: String(pin), avatar, loc: 'Libreville, Gabon', level: 'Silver' });
      S.set('bal', 10000);
      S.set('coffre', 0); S.set('cash', 0);
      S.set('bills', [
        { id: 1, name: 'SEEG Eau', ref: 'Réf: EAU-2024', amount: 28000, due: '31 déc.' },
        { id: 2, name: 'SEEG Électricité', ref: 'Réf: ELEC-2024', amount: 35000, due: '31 déc.' }
      ]);
      S.set('notifs', [
        { id: 1, title: 'Bienvenue sur GhettoPay !', desc: 'Ton compte est créé · 10 000 FCFA offerts', time: "À l'instant", read: false, icon: 'z', color: 'var(--gold2)', bg: 'rgba(212,160,23,.12)' },
        { id: 2, title: 'Sécurité activée', desc: 'PIN configuré · Compte vérifié', time: "À l'instant", read: false, icon: 'shield', color: 'var(--green)', bg: 'rgba(22,163,74,.12)' }
      ]);
      S.set('txs', []); S.set('coffres', []); S.set('tontines', []);
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
    S.set('user', { name, phone, email, pin: String(pin), avatar, loc: 'Libreville, Gabon', level: 'Silver' });
    S.set('bills', [
      { id: 1, name: 'SEEG Eau', ref: 'Réf: EAU-2024', amount: 28000, due: '31 déc.' },
      { id: 2, name: 'SEEG Électricité', ref: 'Réf: ELEC-2024', amount: 35000, due: '31 déc.' }
    ]);
    S.set('notifs', [
      { id: 1, title: 'Bienvenue sur GhettoPay !', desc: 'Ton compte est créé · 10 000 FCFA offerts', time: "À l'instant", read: false, icon: 'z', color: 'var(--gold2)', bg: 'rgba(212,160,23,.12)' },
      { id: 2, title: 'Sécurité activée', desc: 'PIN configuré · Compte vérifié', time: "À l'instant", read: false, icon: 'shield', color: 'var(--green)', bg: 'rgba(22,163,74,.12)' }
    ]);
    S.set('txs', []);
    S.set('coffres', []);
    S.set('tontines', []);
    S.set('ok', true);

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
    else G.render(cur);
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
    const u = S.get('user', {});
    const code = 'GP-' + (u.name || 'USER').toUpperCase().replace(/\s+/g,'').slice(0,6).padEnd(6,'0');
    if ($('ref-code')) $('ref-code').textContent = code;
    const refs = parseInt(localStorage.getItem('gp_refs') || '0');
    if ($('ref-count')) $('ref-count').textContent = refs;
    if ($('ref-earned')) $('ref-earned').textContent = f(refs * 500) + ' F';
    G.showModal('m-ref');
  },
  _shareReferral() {
    const u = S.get('user', {});
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
    const u = S.get('user', {}); u.level = 'Gold'; u.kycPending = true; S.set('user', u);
    if ($('kyc-sub')) $('kyc-sub').textContent = 'Vérification en cours…';
    if ($('prof-level')) $('prof-level').textContent = 'Gold';
    if ($('limit-sub')) $('limit-sub').textContent = '5 000 000 FCFA/mois';
    if (currentUser) db.from('users').update({ level: 'Gold' }).eq('id', currentUser.id).catch(() => {});
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

  // ── EXPORT CSV ──
  exportCSV() {
    const rows = [['Date','Type','Nom','Montant (FCFA)','Catégorie']];
    if (currentUser) {
      db.from('transactions')
        .select('*, from_user:from_user_id(name), to_user:to_user_id(name)')
        .or(`from_user_id.eq.${currentUser.id},to_user_id.eq.${currentUser.id}`)
        .order('created_at', { ascending: false })
        .limit(500)
        .then(({ data: txs }) => {
          (txs || []).forEach(t => {
            const isCredit = t.to_user_id === currentUser.id;
            const other = isCredit ? t.from_user : t.to_user;
            const name = other?.name || t.merchant_name || 'GhettoPay';
            const cat = { transfer:'Transfert', qr:'QR Pay', recharge:'Recharge', bill:'Facture', coffre_deposit:'Coffre', tontine:'Tontine' }[t.type] || t.type;
            const date = new Date(t.created_at).toLocaleDateString('fr-FR');
            rows.push([date, isCredit ? 'Crédit' : 'Débit', name, t.amount, cat]);
          });
          G._downloadCSV(rows);
        });
    } else {
      const txs = S.get('txs', []);
      txs.forEach(t => {
        const cat = t.cat || t.type || '';
        rows.push([t.time || '', t.type === 'recv' ? 'Crédit' : 'Débit', t.name || '', t.amount || 0, cat]);
      });
      G._downloadCSV(rows);
    }
  },
  _downloadCSV(rows) {
    const bom = '\uFEFF';
    const csv = bom + rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `ghettopay_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    G.toast('Export CSV téléchargé', 'ok');
  },

  // ── BUDGET BAR CHART ──
  _renderBudgetChart(txs2, userId) {
    const el = $('bud-chart');
    if (!el) return;
    const now = new Date();
    const months = Array.from({length:6}, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      return { year: d.getFullYear(), month: d.getMonth(), label: d.toLocaleDateString('fr-FR',{month:'short'}), total: 0 };
    });
    txs2.forEach(t => {
      const isOut = userId ? t.from_user_id === userId : (t.type !== 'recv');
      if (!isOut) return;
      const d = t.created_at ? new Date(t.created_at) : null;
      if (!d) return;
      const m = months.find(m => m.year === d.getFullYear() && m.month === d.getMonth());
      if (m) m.total += (t.amount || 0);
    });
    const max = Math.max(...months.map(m => m.total), 1);
    const W = 300, H = 80, bw = 32, gap = 14;
    const totalW = months.length * (bw + gap) - gap;
    const offsetX = (W - totalW) / 2;
    const bars = months.map((m, i) => {
      const bh = Math.max(4, Math.round((m.total / max) * H));
      const x = offsetX + i * (bw + gap);
      const y = H - bh;
      const isLast = i === months.length - 1;
      return `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="6" fill="${isLast ? 'var(--gold2)' : 'var(--forest)'}"/>
        <text x="${x + bw/2}" y="${H + 14}" text-anchor="middle" font-size="8" fill="var(--txt3)" font-family="var(--fm)">${m.label}</text>
        ${m.total > 0 ? `<text x="${x + bw/2}" y="${y - 4}" text-anchor="middle" font-size="7.5" fill="${isLast ? 'var(--gold2)' : 'var(--txt2)'}" font-family="var(--fm)">${m.total >= 1000 ? Math.round(m.total/1000)+'k' : m.total}</text>` : ''}`;
    }).join('');
    el.innerHTML = `<div style="background:var(--card);border-radius:16px;padding:16px;border:1px solid var(--border)">
      <div style="font-size:.68rem;font-weight:800;color:var(--txt2);text-transform:uppercase;letter-spacing:.1em;margin-bottom:10px">Dépenses — 6 derniers mois</div>
      <svg width="100%" viewBox="0 0 ${W} ${H+20}" style="overflow:visible">${bars}</svg>
    </div>`;
  },

  // ── RESET CYCLE TONTINE ──
  _closeTontineCycle() {
    const t = G._curTontine;
    if (!t) return;
    G._askConfirm(
      `Clôturer le cycle "${t.name}" ?`,
      `Tous les membres seront remis à zéro pour un nouveau cycle.`,
      'Clôturer', '', () => G._doCloseTontineCycle()
    );
  },

  async _doCloseTontineCycle() {
    const t = G._curTontine;
    if (!t) return;
    if (currentUser) {
      await db.from('tontine_members').update({ has_paid: false }).eq('tontine_id', t.id);
      await db.from('tontines').update({ members_paid: 0 }).eq('id', t.id);
      // Notifications aux membres
      const { data: mRows } = await db.from('tontine_members').select('user_id').eq('tontine_id', t.id);
      if (mRows?.length) {
        const notifs = mRows.filter(r => r.user_id && r.user_id !== currentUser.id).map(r => ({
          user_id: r.user_id, type: 'tontine_reminder',
          title: `Nouveau cycle — ${t.name}`,
          body: `Le créateur a clôturé le cycle. Un nouveau cycle commence maintenant.`,
          read: false
        }));
        if (notifs.length) await db.from('notifications').insert(notifs).catch(()=>{});
      }
    }
    // Mettre à jour le cache
    if (G._curTontine) {
      G._curTontine.members_paid = 0;
      G._curTontine.paid_by = [];
      if (G._curTontine.members) G._curTontine.members.forEach(m => { if (typeof m === 'object') m.has_paid = false; });
    }
    const ts = S.get('tontines', []);
    const lt = ts.find(x => String(x.id) === String(t.id));
    if (lt) { lt.members_paid = 0; lt.paid_by = []; S.set('tontines', ts); }
    G.r_tontine_detail();
    G.toast('Cycle clôturé — nouveau cycle démarré', 'ok');
  },

  // ── PARTAGE LIEN TONTINE ──
  _shareTontine() {
    const t = G._curTontine;
    if (!t) return;
    const url = `${location.origin}${location.pathname}?join=${t.id}`;
    const text = `Rejoins ma tontine "${t.name}" sur GhettoPay !\n${url}`;
    if (navigator.share) {
      navigator.share({ title: t.name, text, url }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(text).then(() => G.toast('Lien copié dans le presse-papiers', 'ok')).catch(() => G.toast(url, 'inf'));
    }
  },

  // ── BIOMÉTRIE WebAuthn ──
  async _bioRegister() {
    if (!window.PublicKeyCredential) { G.toast('WebAuthn non supporté sur ce navigateur', 'err'); return; }
    const u = S.get('user', {});
    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const cred = await navigator.credentials.create({ publicKey: {
        challenge, rp: { name: 'GhettoPay', id: location.hostname },
        user: { id: new TextEncoder().encode(currentUser?.id || u.phone || 'user'), name: u.phone || 'user', displayName: u.name || 'Utilisateur' },
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
    const users = S.get('contacts', []);
    if (!users.length && currentUser) {
      db.from('users').select('id,name,phone,avatar_url').neq('id', currentUser.id).limit(40)
        .then(({data}) => { if (data) { S.set('contacts', data); G.gp_filterContacts(''); } }).catch(()=>{});
    }
    G.gp_filterContacts('');
  },
  gp_filterContacts(q) {
    const grid = $('gp-contact-grid'); if (!grid) return;
    const q2 = (q || '').toLowerCase().trim();
    let users = S.get('contacts', []);
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
    const bal = S.get('bal', 0);
    const gpAmtErr = validateAmount(G._gpAmt || 0, bal, { withFee: true, min: 100 });
    if (gpAmtErr) { G.toast(gpAmtErr, 'err'); return; }
    const total = G._gpAmt + Math.round(G._gpAmt * 0.015);
    if (!currentUser) { G.toast('Non connecté', 'err'); return; }
    const btn = document.querySelector('#gp-send-panel button[onclick="G.gp_send()"]');
    if (btn) { btn.textContent = 'Envoi…'; btn.disabled = true; }
    try {
      const {error} = await db.from('transactions').insert({ from_user_id: currentUser.id, to_user_id: G._gpContact.id, amount: G._gpAmt, type: 'transfer', status: 'completed' });
      if (error) throw error;
      const newBal = bal - total;
      S.set('bal', newBal);
      await db.from('wallets').update({ balance: newBal }).eq('user_id', currentUser.id).catch(()=>{});
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
    const total = S.get('coffre', 0);
    const el = $('gp-coffre-total'); if (el) el.textContent = f(total) + ' FCFA';
    G._gp_renderCoffreGrid();
    if (currentUser) {
      db.from('coffres').select('*').eq('user_id', currentUser.id).order('created_at',{ascending:false})
        .then(({data}) => { if (data) { S.set('coffres_list', data); G._gp_renderCoffreGrid(); } }).catch(()=>{});
    }
  },
  _gp_renderCoffreGrid() {
    const grid = $('gp-coffre-grid'); if (!grid) return;
    const coffres = S.get('coffres_list', []);
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
    const txs = S.get('txs', []);
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
    if (currentUser) {
      db.from('transactions').select('*,from_user:from_user_id(name),to_user:to_user_id(name)')
        .or(`from_user_id.eq.${currentUser.id},to_user_id.eq.${currentUser.id}`)
        .order('created_at',{ascending:false}).limit(50)
        .then(({data:rows}) => {
          if (!rows?.length) return;
          const mapped = rows.map(t => ({
            name: t.to_user_id===currentUser.id ? (t.from_user?.name||'—') : (t.to_user?.name||t.merchant_name||'—'),
            type: t.to_user_id===currentUser.id ? 'credit' : 'debit',
            amount: t.amount||0,
            cat: {transfer:'Transfert',qr:'QR Pay',recharge:'Recharge',coffre_deposit:'Coffre',tontine:'Tontine'}[t.type]||t.type||'Autre'
          }));
          S.set('txs', mapped);
          G.gp_renderBudget();
        }).catch(()=>{});
    }
  },

  // ── DESKTOP TONTINE PANEL ───────────────────────────────
  gp_renderTontine() {
    const grid = $('gp-tontine-grid'); if (!grid) return;
    const list = G._tontinesList || S.get('tontines', []);
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
    if (currentUser && !G._tontinesList?.length) {
      Promise.all([
        db.from('tontines').select('*').eq('creator_id', currentUser.id).order('created_at',{ascending:false}),
        db.from('tontines').select('*').contains('members', [currentUser.id]).order('created_at',{ascending:false})
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
    const notifs = S.get('notifs', []);
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
    if (currentUser) {
      db.from('notifications').select('*').eq('user_id', currentUser.id).order('created_at',{ascending:false}).limit(20)
        .then(({data}) => {
          if (!data?.length) return;
          const mapped = data.map(n => ({ id:n.id, type:n.type||'system', title:n.title||'Notification', body:n.body||n.message||'', read:n.read||false, time:new Date(n.created_at).toLocaleDateString('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) }));
          S.set('notifs', mapped);
          G.gp_renderNotifs();
        }).catch(()=>{});
    }
  },
  gp_markRead(id) {
    const notifs = S.get('notifs', []).map(n => n.id==id ? {...n,read:true} : n);
    S.set('notifs', notifs);
    G.gp_renderNotifs();
    if (id && currentUser) db.from('notifications').update({read:true}).eq('id',id).catch(()=>{});
  },
  gp_markAllRead() {
    const notifs = S.get('notifs', []).map(n => ({...n,read:true}));
    S.set('notifs', notifs);
    G.gp_renderNotifs();
    if (currentUser) db.from('notifications').update({read:true}).eq('user_id',currentUser.id).catch(()=>{});
  },

  // ── DESKTOP PROFIL PANEL ────────────────────────────────
  gp_renderProfil() {
    const u = S.get('user', {});
    const txs = S.get('txs', []);
    const av = (u.name||'?')[0].toUpperCase();
    const cash = S.get('cash', 0);
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
    const bal = S.get('bal', 0), cbal = S.get('coffre', 0), cash = S.get('cash', 0);
    const u = S.get('user', {});
    const tontines = G._tontinesList || [];
    const av = u.avatar || (u.name || '?')[0].toUpperCase();
    const firstName = (u.name || 'Utilisateur').split(' ')[0];

    // Topbar + sidebar avatar
    const greet = $('gp-greet'); if (greet) greet.textContent = `Bonjour, ${firstName}`;
    const sbAv = $('gp-sb-av'); if (sbAv) sbAv.textContent = av;
    const topAv = $('gp-top-av'); if (topAv) topAv.textContent = av;

    // Notif badge
    const unread = S.get('notifs', []).filter(n => !n.read).length;
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
    const txs = S.get('txs', []);
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
    if (currentUser) {
      const since = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString();
      db.from('transactions').select('amount,created_at').or(`from_user_id.eq.${currentUser.id},to_user_id.eq.${currentUser.id}`).gte('created_at', since)
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
    const txs = S.get('txs', []).slice(0, 8);
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
    if (currentUser) {
      db.from('transactions').select('*,from_user:from_user_id(name),to_user:to_user_id(name)')
        .or(`from_user_id.eq.${currentUser.id},to_user_id.eq.${currentUser.id}`)
        .order('created_at',{ascending:false}).limit(8)
        .then(({data:rows}) => {
          if (!rows?.length) return;
          list.innerHTML = rows.map((t, i) => {
            const isCredit = t.to_user_id === currentUser.id;
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
        pinBuf = S.get('user', {}).pin || '0000';
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
      const pin = S.get('user', {}).pin || '';
      if (G._mpcBuf === String(pin)) {
        G.closeModal('m-pin-confirm');
        G._mpcBuf = '';
        // Exécuter le transfert en attente
        const ps = G._pendingSend;
        if (!ps) return;
        G._pendingSend = null;
        selC = ps.selC;
        aStr = String(ps.n);
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
  async _execSend({ selC: sc, n, fee, total, bal, note }) {
    if (currentUser) {
      G.toast('Envoi en cours...', 'inf');
      const { data, error } = await db.rpc('transfer_money', {
        p_from_user_id: currentUser.id, p_to_user_id: sc.id, p_amount: n, p_note: note
      });
      if (error || !data?.success) { G.toast(data?.error || 'Erreur de transfert', 'err'); return; }
      const newBal = bal - total;
      S.set('bal', newBal);
      if (currentUser.wallet) currentUser.wallet.balance = newBal;
    } else {
      S.set('bal', bal - total);
      const txs = S.get('txs', []);
      txs.unshift({ id: Date.now(), name: sc.name, av: sc.av, amount: n, fee, type: 'send', cat: 'Transfert', time: "À l'instant" });
      S.set('txs', txs);
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
    const u = S.get('user', {});
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
    const coffres = S.get('coffres_list', []);
    const c = coffres.find(x => String(x.id) === String(id));
    const name = c?.name || 'Coffre';
    const bal = S.get('bal', 0);
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
    const u = S.get('user', {});
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

window.G = G;
window.setBudTab = setBudTab;

appStart();

function setBudTab(btn) {
  btn.closest('.bud-tabs').querySelectorAll('.btab').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  G.render('budget');
}

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
      if (currentUser) {
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
      if (!currentUser) { G.toast('Connecte-toi pour envoyer de l\'argent', 'inf'); return; }
      const { data: found } = await db.from('users').select('id,name').eq('phone', phone).maybeSingle();
      if (!found) { G.toast('Cet utilisateur n\'est pas encore sur GhettoPay', 'err'); return; }
      const nm = found.name || name;
      selC = { id: found.id, name: nm, phone, av: (nm[0] || '?').toUpperCase() };
      G.go('send');
      setTimeout(() => {
        if ($('rec-av')) $('rec-av').textContent = selC.av;
        if ($('rec-name')) $('rec-name').textContent = selC.name;
        if ($('rec-phone')) $('rec-phone').textContent = selC.phone;
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

// ── SERVICE WORKER ──
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(e => console.warn('SW:', e));
}
