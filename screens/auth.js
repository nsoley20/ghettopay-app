import { $, validateName, validatePhone } from '../utils.js';
import { store } from '../store.js';
import { db } from '../api.js';

export async function loadUserData(authId) {
  let { data: user } = await db.from('users').select('*').eq('auth_id', authId).single();

  if (!user) {
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
    if (!user) return;
  }

  const { data: wallet } = await db.from('wallets').select('*').eq('user_id', user.id).single();
  store.currentUser = { ...user, wallet };

  store.set('user', { name: user.name, phone: user.phone, avatar: user.avatar, loc: user.location, level: user.level });
  sessionStorage.setItem('gp_pin', String(user.pin_code || ''));
  store.set('bal', wallet?.balance || 0);
  store.set('cash', wallet?.cashback || 0);
  store.set('coffre', wallet?.coffre_balance || 0);
  db.from('coffres').select('saved').eq('user_id', user.id)
    .then(({ data: userCoffres }) => {
      if (!userCoffres) return;
      const realCoffre = userCoffres.reduce((s, c) => s + (c.saved || 0), 0);
      store.set('coffre', realCoffre);
      if (wallet && realCoffre !== (wallet.coffre_balance || 0)) {
        db.from('wallets').update({ coffre_balance: realCoffre }).eq('user_id', user.id).catch(() => {});
      }
      if (window.innerWidth >= 1280) window.G?.renderDesktopHome();
    }).catch(() => {});

  if (user.avatar_url && !localStorage.getItem('gp_photo')) {
    localStorage.setItem('gp_photo', user.avatar_url);
  }

  if (window.innerWidth >= 1280) {
    setTimeout(() => window.G?.renderDesktopHome(), 100);
  }

  if (store.walletChannel) { db.removeChannel(store.walletChannel); store.walletChannel = null; }
  store.walletChannel = db.channel('wallet_' + user.id)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'wallets', filter: `user_id=eq.${user.id}` }, payload => {
      const d = payload.new;
      const nb = d.balance || 0, nc = d.coffre_balance || 0;
      store.set('bal', nb); store.set('coffre', nc); store.set('cash', d.cashback || 0);
      if (store.currentUser?.wallet) { store.currentUser.wallet.balance = nb; store.currentUser.wallet.coffre_balance = nc; }
      if (store.cur === 'home') {
        const f = window.G ? n => new Intl.NumberFormat('fr-FR').format(n) : n => n;
        const balAmt = $('bal-amt');
        if (balAmt && store.balVis) balAmt.innerHTML = `<span class="cur">FCFA </span>${f(nb)}`;
        const balSub = $('bal-sub'); if (balSub && store.balVis) balSub.textContent = `+ Coffre : ${f(nc)} FCFA`;
        const cstrip = $('cstrip-val'); if (cstrip) cstrip.textContent = f(nc);
      }
      if (window.innerWidth >= 1280) window.G?.renderDesktopHome();
    })
    .subscribe();
}

export const authScreen = {
  _pinFailures: 0,
  _PIN_LOCKOUT_MS: 30000,
  _PIN_MAX_ATTEMPTS: 5,

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
    if (store.pinBuf.length === 4) this._checkPin();
  },

  pinDel() {
    store.pinBuf = store.pinBuf.slice(0, -1);
    document.querySelectorAll('.pin-dot').forEach((d, i) => d.classList.toggle('fill', i < store.pinBuf.length));
  },

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
      const storedPin = sessionStorage.getItem('gp_pin');
      if (!storedPin) {
        this.toast('Session expirée, reconnecte-toi', 'err');
        setTimeout(() => { this.go('login'); }, 1200);
        return;
      }
      const now = Date.now();
      const lockedUntil = parseInt(sessionStorage.getItem('gp_pin_locked') || '0');
      if (lockedUntil > now) {
        const secs = Math.ceil((lockedUntil - now) / 1000);
        this._showPinErrAnim();
        this.toast(`Trop de tentatives · réessaie dans ${secs}s`, 'err');
        return;
      }
      if (store.pinBuf === storedPin) {
        this._pinFailures = 0;
        sessionStorage.removeItem('gp_pin_locked');
        store.hist = [];
        this.go('home');
        if (store.get('new_user', false)) {
          store.set('new_user', false);
          setTimeout(() => this.showModal('m-kyc'), 600);
        }
      } else {
        this._pinFailures++;
        this._showPinErrAnim();
        if (this._pinFailures >= this._PIN_MAX_ATTEMPTS) {
          sessionStorage.setItem('gp_pin_locked', String(Date.now() + this._PIN_LOCKOUT_MS));
          this._pinFailures = 0;
          this.toast(`${this._PIN_MAX_ATTEMPTS} échecs · verrouillé 30 secondes`, 'err');
        } else {
          const left = this._PIN_MAX_ATTEMPTS - this._pinFailures;
          this.toast(`PIN incorrect · ${left} tentative${left > 1 ? 's' : ''} restante${left > 1 ? 's' : ''}`, 'err');
        }
      }
    }, 200);
  },

  async register() {
    const name = $('reg-name')?.value.trim();
    const phone = $('reg-phone')?.value.trim();
    const email = $('reg-email')?.value.trim();
    const pin = $('reg-pin')?.value.trim();

    const regNameErr = validateName(name, { label: 'Nom complet', min: 2 });
    if (regNameErr) { this.toast(regNameErr, 'err'); return; }
    const regPhoneErr = validatePhone(phone) || (phone.length < 8 ? 'Numéro de téléphone requis' : null);
    if (regPhoneErr) { this.toast(regPhoneErr, 'err'); return; }
    if (!email || !email.includes('@') || !email.includes('.')) { this.toast('Adresse email valide requise', 'err'); return; }
    if (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) { this.toast('PIN de 4 chiffres requis', 'err'); return; }

    this.toast('Création du compte...', 'inf');

    const password = pin + 'GhettoPay2024';

    const { data: authData, error: authError } = await db.auth.signUp({ email, password });
    if (authError) {
      this.toast('Erreur: ' + authError.message, 'err'); return;
    }

    if (!authData.session) {
      const avatar = name[0].toUpperCase();
      store.set('pending_reg', { name, phone, pin, email, avatar });
      store.set('user', { name, phone, email, avatar, loc: 'Libreville, Gabon', level: 'Silver' });
      sessionStorage.setItem('gp_pin', String(pin));
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
      store.set('new_user', true);
      this.ok(
        'Vérifie ton email !',
        `Un lien de confirmation a été envoyé à ${email}. Clique dessus puis reviens te connecter — tu complèteras ta vérification d'identité.`,
        () => this.go('login')
      );
      return;
    }

    const session = authData.session;
    const avatar = name[0].toUpperCase();

    const { data: existingUser } = await db.from('users').select('id').eq('phone', phone).single();

    let userId;
    if (!existingUser) {
      const { data: newUser, error: userError } = await db.from('users').insert({
        auth_id: session.user.id, phone, name, avatar, pin_code: pin, email, location: 'Libreville, Gabon', level: 'Silver'
      }).select().single();
      if (userError) { this.toast('Erreur création profil: ' + userError.message, 'err'); return; }
      userId = newUser.id;
      await db.from('wallets').insert({ user_id: userId, balance: 10000, coffre_balance: 0, cashback: 0 });
    } else {
      userId = existingUser.id;
    }

    await loadUserData(session.user.id);

    store.set('user', { name, phone, email, avatar, loc: 'Libreville, Gabon', level: 'Silver' });
    sessionStorage.setItem('gp_pin', String(pin));
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
    store.set('new_user', true);

    this.ok('Compte créé !', `Bienvenue ${name} · 10 000 FCFA offerts. Entre ton PIN pour accéder à ton compte.`, () => this.go('pin'));
  },

  showLogin() { this.go('login'); },
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
    if (!email || !pin) { this.toast(isAdmin ? 'Email et mot de passe requis' : 'Email et PIN requis', 'err'); return; }

    this.toast('Connexion...', 'inf');
    const password = isAdmin ? pin : pin + 'GhettoPay2024';

    const { data, error } = await db.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.message.includes('Email not confirmed') || error.message.includes('email_not_confirmed')) {
        this.toast('Confirme ton email avant de te connecter', 'err');
      } else {
        this.toast('Email ou PIN incorrect', 'err');
      }
      return;
    }

    if (!data?.user) {
      this.toast('Confirme ton email avant de te connecter', 'err');
      return;
    }

    if (data.user.email === 'admin@ghettopay.ga') {
      window.location.href = 'admin.html';
      return;
    }

    await loadUserData(data.user.id);
    this.go('pin');
  },
};
