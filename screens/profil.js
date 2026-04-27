import { f, $ } from '../utils.js';
import { store } from '../store.js';
import { db } from '../api.js';
import { validateName } from '../utils.js';

export const profilScreen = {
  _kycPhotoData: null,

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
    const unread = store.get('notifs', []).filter(n => !n.read).length;
    if ($('notif-sub')) $('notif-sub').textContent = unread ? `${unread} non lue${unread > 1 ? 's' : ''}` : 'Tout lu';
    if ($('notif-dot')) $('notif-dot').style.display = unread ? 'block' : 'none';
    const isDark = document.documentElement.classList.contains('dark');
    this._updateDarkUI(isDark);
    const lvl = u.level || 'Silver';
    if ($('kyc-sub')) $('kyc-sub').textContent = lvl === 'Gold' ? 'Niveau Gold · Vérifié ✓' : lvl === 'Platinum' ? 'Niveau Platinum · Vérifié ✓' : 'Niveau Silver · Compléter KYC';
    if ($('limit-sub')) $('limit-sub').textContent = lvl === 'Platinum' ? 'Illimité' : lvl === 'Gold' ? '5 000 000 FCFA/mois' : '2 000 000 FCFA/mois';
    const refs = parseInt(localStorage.getItem('gp_refs') || '0');
    if ($('ref-badge')) $('ref-badge').textContent = refs + ' invité' + (refs !== 1 ? 's' : '');
  },

  _pickProfilePhoto() {
    $('prof-photo-input')?.click();
  },
  _onProfilePhotoChosen(input) {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { this.toast('Image trop lourde (max 2 Mo)', 'err'); return; }
    const reader = new FileReader();
    reader.onload = async e => {
      const src = e.target.result;
      localStorage.setItem('gp_photo', src);
      this._applyProfilePhoto(src);
      this.toast('Photo de profil mise à jour', 'ok');
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
    if (profNameErr) { this.toast(profNameErr, 'err'); return; }
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

    this.closeModal('mp');
    this.render('profil');
    if (window.innerWidth >= 1280) this.gp_renderProfil();
    this.toast('Profil mis à jour', 'inf');
  },

  async logout() {
    this.toast('Déconnexion...', 'inf');
    if (store.currentUser) await db.auth.signOut();
    store.currentUser = null;
    localStorage.clear();
    setTimeout(() => this.go('onboard'), 1000);
  },

  _openReferral() {
    const u = store.get('user', {});
    const code = 'GP-' + (u.name || 'USER').toUpperCase().replace(/\s+/g,'').slice(0,6).padEnd(6,'0');
    if ($('ref-code')) $('ref-code').textContent = code;
    const refs = parseInt(localStorage.getItem('gp_refs') || '0');
    if ($('ref-count')) $('ref-count').textContent = refs;
    if ($('ref-earned')) $('ref-earned').textContent = f(refs * 500) + ' F';
    this.showModal('m-ref');
  },
  _shareReferral() {
    const u = store.get('user', {});
    const code = 'GP-' + (u.name || 'USER').toUpperCase().replace(/\s+/g,'').slice(0,6).padEnd(6,'0');
    const text = `Rejoins GhettoPay avec mon code de parrainage et reçois 500 FCFA offerts ! 🎁\nCode : ${code}\nTélécharge l'app : ${location.origin}${location.pathname}`;
    if (navigator.share) {
      navigator.share({ title: 'GhettoPay — Parrainage', text }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(text).then(() => this.toast('Code copié !', 'ok')).catch(() => this.toast(code, 'inf'));
    }
  },

  _kycPickPhoto() { $('kyc-photo-input')?.click(); },
  _onKycPhotoChosen(input) {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { this.toast('Image trop lourde (max 5 Mo)', 'err'); input.value = ''; return; }
    const reader = new FileReader();
    reader.onload = e => {
      const preview = $('kyc-photo-preview');
      const icon = $('kyc-photo-icon');
      const label = $('kyc-photo-label');
      if (preview) { preview.src = e.target.result; preview.style.display = 'block'; }
      if (icon) icon.style.display = 'none';
      if (label) { label.textContent = '✓ Photo sélectionnée · Appuyer pour changer'; label.style.color = 'var(--green)'; }
      this._kycPhotoData = e.target.result;
    };
    reader.readAsDataURL(file);
  },
  _submitKyc() {
    const name = $('kyc-name')?.value.trim();
    const id = $('kyc-id')?.value.trim();
    if (!name || !id) { this.toast('Remplis tous les champs', 'err'); return; }
    if (!this._kycPhotoData) { this.toast('Ajoute une photo de ta pièce d\'identité', 'err'); return; }
    this.closeModal('m-kyc');
    this._kycPhotoData = null;
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
    this.ok('Demande envoyée !', 'Ton dossier KYC est en cours de traitement. Sous 48h tu recevras une notification.', null);
  },

  toggleDark() {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('gp_dark', isDark ? '1' : '0');
    this._updateDarkUI(isDark);
  },
  _updateDarkUI(isDark) {
    const sub = $('dark-sub'), knob = $('dark-knob'), track = $('dark-toggle');
    if (sub) sub.textContent = isDark ? 'Activé' : 'Désactivé';
    if (knob) knob.style.transform = isDark ? 'translateX(16px)' : 'translateX(0)';
    if (track) track.style.background = isDark ? 'var(--green)' : 'var(--bg3)';
  },

  async _bioRegister() {
    if (!window.PublicKeyCredential) { this.toast('WebAuthn non supporté sur ce navigateur', 'err'); return; }
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
        this.toast('Biométrie enregistrée avec succès', 'ok');
      }
    } catch(e) { this.toast('Biométrie annulée ou non disponible', 'err'); }
  },
};
