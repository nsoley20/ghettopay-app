// store.js — source de vérité unique pour tout l'état applicatif
//
// État in-memory : navigation, UI, session (non persisté)
// État persistant : données utilisateur via localStorage (préfixe gp3_)

const _mem = {
  cur: 'loading',
  hist: [],
  pD: {},
  selC: null,
  aStr: '',
  pinBuf: '',
  balVis: true,
  currentUser: null,
  isNewUser: false,
  walletChannel: null,
};

export const store = {
  get cur()           { return _mem.cur; },
  set cur(v)          { _mem.cur = v; },
  get hist()          { return _mem.hist; },
  set hist(v)         { _mem.hist = v; },
  get pD()            { return _mem.pD; },
  set pD(v)           { _mem.pD = v; },
  get selC()          { return _mem.selC; },
  set selC(v)         { _mem.selC = v; },
  get aStr()          { return _mem.aStr; },
  set aStr(v)         { _mem.aStr = v; },
  get pinBuf()        { return _mem.pinBuf; },
  set pinBuf(v)       { _mem.pinBuf = v; },
  get balVis()        { return _mem.balVis; },
  set balVis(v)       { _mem.balVis = v; },
  get currentUser()   { return _mem.currentUser; },
  set currentUser(v)  { _mem.currentUser = v; },
  get isNewUser()     { return _mem.isNewUser; },
  set isNewUser(v)    { _mem.isNewUser = v; },
  get walletChannel() { return _mem.walletChannel; },
  set walletChannel(v){ _mem.walletChannel = v; },

  // Persistance localStorage (même API que l'ancien S)
  get(k, d) {
    try {
      const v = localStorage.getItem('gp3_' + k);
      return v !== null ? JSON.parse(v) : d;
    } catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem('gp3_' + k, JSON.stringify(v)); } catch {}
  },
};
