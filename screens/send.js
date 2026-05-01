import { f, $, esc, validateAmount, validatePhone, validateName } from '../utils.js';
import { store } from '../store.js';
import { db } from '../api.js';

export const sendScreen = {
  _allContacts: [], _contactMap: {}, _pendingSend: null, _mpcBuf: '',
  _scanStream: null, _scanInterval: null, _scanActive: false,

  r_send() {
    store.aStr = '';
    $('amt-disp').textContent = '0';
    if (!store.selC) {
      $('rec-row').style.display = 'none';
    } else {
      if ($('rec-av')) $('rec-av').textContent = store.selC.av;
      if ($('rec-name')) $('rec-name').textContent = store.selC.name;
      if ($('rec-phone')) $('rec-phone').textContent = store.selC.phone;
      if ($('rec-row')) $('rec-row').style.display = 'flex';
    }
    this.r_contacts();
  },

  async r_contacts() {
    this._allContacts = [];
    this._contactMap = {};
    if (!store.currentUser) {
      this._allContacts = store.get('contacts', []);
    } else {
      const { data: users } = await db.from('users').select('id,name,avatar,phone').neq('id', store.currentUser.id).limit(30);
      this._allContacts = users || [];
      (users||[]).forEach(u => this._contactMap[u.id] = u);
    }
    this._renderContacts(this._allContacts);
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
    if (!q) { this._renderContacts(this._allContacts); return; }
    const filtered = (this._allContacts||[]).filter(u => (u.name||'').toLowerCase().includes(q.toLowerCase()) || (u.phone||'').includes(q));
    this._renderContacts(filtered);
  },

  selContact(id) {
    let c = this._contactMap?.[id] || (store.get('contacts',[])).find(x => x.id === id) || (this._allContacts||[]).find(x => x.id === id);
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
    const isInternal = store.selC && !store.selC.id?.startsWith('manual_');
    const fee = isInternal ? 0 : Math.round(n * 0.015);
    const fd = $('fee-disp');
    if (fd) {
      if (isInternal) {
        fd.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#15803d" stroke-width="2.5"><use href="#chk"/></svg>Transfert GhettoPay · Sans frais`;
      } else {
        fd.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#15803d" stroke-width="2.5"><use href="#chk"/></svg>Frais : ${fee > 0 ? f(fee) + ' FCFA (1,5%)' : '0 FCFA'}`;
      }
    }
  },

  async doSend() {
    if (!store.selC) { this.toast('Choisis un destinataire', 'err'); return; }
    const n = parseInt(store.aStr) || 0;
    const bal = store.get('bal', 0);
    const isInternal = !store.selC.id?.startsWith('manual_');
    const amtErr = validateAmount(n, bal, { withFee: !isInternal });
    if (amtErr) { this.toast(amtErr, 'err'); return; }
    const fee = isInternal ? 0 : Math.round(n * 0.015);
    const total = n + fee;
    const note = $('send-note')?.value || '';

    const PIN_THRESHOLD = 100000;
    if (n >= PIN_THRESHOLD && store.get('user', {}).pin) {
      this._pendingSend = { selC: store.selC, n, fee, total, bal, note };
      this._mpcBuf = '';
      this._mpcUpdateDots();
      if ($('mpc-desc')) $('mpc-desc').textContent = `Transfert de ${f(n)} FCFA à ${store.selC.name} — Entre ton PIN pour valider`;
      this.showModal('m-pin-confirm');
      return;
    }

    if (store.currentUser) {
      this.toast('Envoi en cours...', 'inf');
      const { data, error } = await db.rpc('transfer_money', {
        p_from_user_id: store.currentUser.id, p_to_user_id: store.selC.id, p_amount: n, p_note: note
      });
      if (error || !data?.success) { this.toast(data?.error || 'Erreur de transfert', 'err'); return; }
      const newBal = bal - total;
      store.set('bal', newBal);
      if (store.currentUser.wallet) store.currentUser.wallet.balance = newBal;
    } else {
      store.set('bal', bal - total);
      const txs = store.get('txs', []);
      txs.unshift({ id: Date.now(), name: store.selC.name, av: store.selC.av, amount: n, fee, type: 'send', cat: 'Transfert', time: "À l'instant" });
      store.set('txs', txs);
    }
    this.ok(`${f(n)} FCFA envoyés`, `À ${store.selC.name} · Frais ${f(fee)} FCFA · Confirmé ✓`, () => this.go('home'));
  },

  r_qrhub() { /* écran statique, rien à charger */ },

  r_scan() {
    if ($('scan-start-btn')) $('scan-start-btn').style.display = 'flex';
    if ($('scan-status')) $('scan-status').textContent = '';
    if ($('scan-hint')) $('scan-hint').textContent = 'Place le QR code dans le cadre — détection automatique';
    if ($('scan-line')) $('scan-line').style.display = 'block';
    if (navigator.mediaDevices?.getUserMedia) this.startCamera();
  },

  startCamera() {
    const video = $('scan-video');
    const canvas = $('scan-canvas');
    if (!video) return;

    this._scanActive = true;
    if ($('scan-start-btn')) $('scan-start-btn').style.display = 'none';
    if ($('scan-status')) $('scan-status').textContent = 'Démarrage…';

    if (!navigator.mediaDevices?.getUserMedia) {
      if ($('scan-status')) $('scan-status').textContent = 'Caméra indisponible';
      if ($('scan-hint')) $('scan-hint').textContent = 'Utilise la saisie manuelle ci-dessous';
      return;
    }

    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } })
      .then(stream => {
        if (!this._scanActive) { stream.getTracks().forEach(t => t.stop()); return; }
        this._scanStream = stream;
        video.srcObject = stream;
        video.onloadedmetadata = () => {
          video.play().then(() => {
            if (!this._scanActive) { this.stopScan(); return; }
            if ($('scan-status')) $('scan-status').textContent = 'Actif';
            this._scanInterval = setInterval(() => {
              if (!this._scanActive || !canvas || video.readyState < 2 || video.videoWidth === 0) return;
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(video, 0, 0);
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              if (!window.jsQR) return;
              const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
              if (code?.data) { this.stopScan(); this._handleQRResult(code.data); }
            }, 300);
          }).catch(() => this._scanError());
        };
      })
      .catch(err => {
        if (err.name === 'NotAllowedError') {
          if ($('scan-status')) $('scan-status').textContent = 'Permission refusée';
          this.toast('Autorise la caméra dans les paramètres du navigateur', 'err');
        } else {
          this._scanError();
        }
      });
  },

  _scanError() {
    if ($('scan-status')) $('scan-status').textContent = 'Caméra indisponible';
    if ($('scan-hint')) $('scan-hint').textContent = 'Utilise la saisie manuelle ci-dessous';
    if ($('scan-start-btn')) $('scan-start-btn').style.display = 'none';
  },

  stopScan() {
    this._scanActive = false;
    try { clearInterval(this._scanInterval); } catch(e) {}
    this._scanInterval = null;
    try { this._scanStream?.getTracks().forEach(t => t.stop()); } catch(e) {}
    this._scanStream = null;
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
      if (!phone) { this.toast('QR non reconnu par GhettoPay', 'err'); return; }
      if (!store.currentUser) { this.toast('Connecte-toi pour envoyer de l\'argent', 'err'); return; }
      this.toast('Recherche du destinataire…', 'inf');
      const { data: found } = await db.from('users').select('id,name').eq('phone', phone).maybeSingle();
      if (!found) { this.toast('Cet utilisateur n\'est pas encore sur GhettoPay', 'err'); return; }
      const nm = found.name || name || phone;
      store.selC = { id: found.id, name: nm, phone, av: (nm[0] || '?').toUpperCase() };
      this.go('send');
      this.toast(`Destinataire : ${nm}`, 'inf');
    } catch(e) {
      this.toast('QR non reconnu', 'err');
    }
  },

  async scanManualSend() {
    const phone = $('scan-phone')?.value.trim();
    const phoneErr = validatePhone(phone);
    if (phoneErr) { this.toast(phoneErr, 'err'); return; }
    if (!store.currentUser) { this.toast('Connecte-toi pour envoyer de l\'argent', 'err'); return; }
    this.toast('Recherche du destinataire…', 'inf');
    const { data: found } = await db.from('users').select('id,name').eq('phone', phone).maybeSingle();
    if (!found) { this.toast('Numéro introuvable sur GhettoPay', 'err'); return; }
    const nm = found.name || phone;
    store.selC = { id: found.id, name: nm, phone, av: (nm[0] || '?').toUpperCase() };
    this.go('send');
    setTimeout(() => {
      if ($('rec-av')) $('rec-av').textContent = store.selC.av;
      if ($('rec-name')) $('rec-name').textContent = store.selC.name;
      if ($('rec-phone')) $('rec-phone').textContent = store.selC.phone;
      if ($('rec-row')) $('rec-row').style.display = 'flex';
    }, 150);
  },

  r_qr() {
    if ($('qr-merchant')) $('qr-merchant').value = '';
    if ($('qr-amount')) $('qr-amount').value = '';
  },

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
      this.toast('QR téléchargé !', 'inf');
    } else if (img) {
      const a = document.createElement('a');
      a.href = img.src; a.download = fname;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      this.toast('QR téléchargé !', 'inf');
    } else {
      this.copyPayLink();
    }
  },

  copyPayLink() {
    const u = store.get('user', {});
    const link = `${location.origin}${location.pathname}?phone=${encodeURIComponent(u.phone||'')}&name=${encodeURIComponent(u.name||'')}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(link)
        .then(() => this.toast('Lien copié !', 'inf'))
        .catch(() => this.toast(link, 'inf'));
    } else {
      this.toast(link, 'inf');
    }
  },

  selManualPhone() {
    const phone = $('manual-phone')?.value.trim();
    const phoneErr2 = validatePhone(phone);
    if (phoneErr2) { this.toast(phoneErr2, 'err'); return; }
    store.selC = { id: 'manual_' + phone, name: phone, phone, av: '#' };
    $('rec-av').textContent = store.selC.av;
    $('rec-name').textContent = store.selC.name;
    $('rec-phone').textContent = store.selC.phone;
    $('rec-row').style.display = 'flex';
    if ($('manual-phone')) $('manual-phone').value = '';
    this.toast('Destinataire défini', 'inf');
  },

  async pickContact() {
    if (!('contacts' in navigator && 'ContactsManager' in window)) {
      this.toast('Non disponible sur ce navigateur', 'err'); return;
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
    } catch(e) { this.toast('Accès contacts refusé', 'err'); }
  },

  doQR() {
    const merchant = $('qr-merchant')?.value.trim();
    const amount = parseInt($('qr-amount')?.value) || 0;
    const merchantErr = validateName(merchant, { label: 'Nom du commerçant' });
    if (merchantErr) { this.toast(merchantErr, 'err'); return; }
    const bal = store.get('bal', 0);
    const fee = Math.round(amount * 0.015);
    const total = amount + fee;
    const qrAmtErr = validateAmount(amount, bal, { withFee: true });
    if (qrAmtErr) { this.toast(qrAmtErr, 'err'); return; }

    if (store.currentUser) {
      db.from('transactions').insert({
        from_user_id: store.currentUser.id,
        amount,
        type: 'qr',
        merchant_name: merchant,
        status: 'completed'
      }).then(({ error }) => {
        if (error) { this.toast('Erreur paiement', 'err'); return; }
        store.set('bal', bal - total);
        this.ok(`${f(amount)} FCFA payés`, `${merchant} · Frais ${f(fee)} FCFA · Confirmé ✓`, () => this.go('home'));
      });
    } else {
      store.set('bal', bal - total);
      this.ok(`${f(amount)} FCFA payés`, `${merchant} · Frais ${f(fee)} FCFA · Confirmé ✓`, () => this.go('home'));
    }
  },
};
