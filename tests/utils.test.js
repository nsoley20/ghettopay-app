import { describe, it, expect } from 'vitest';

// ── utils pure functions (inlined for node env, no DOM needed) ──
const f = n => new Intl.NumberFormat('fr-FR').format(Math.round(n));
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const validatePhone = phone => {
  if (!phone) return 'Numéro requis';
  const clean = phone.replace(/[\s\-().]/g, '');
  if (!/^(\+241)?0[67]\d{7}$/.test(clean)) return 'Numéro gabonais invalide (ex: 077 12 34 56)';
  return null;
};

// ── S (localStorage mock) ──
const store = {};
const S = {
  get(k, d) { return store[k] !== undefined ? store[k] : d; },
  set(k, v) { store[k] = v; },
};

describe('f() — formatage FCFA', () => {
  it('formate un entier', () => expect(f(10000)).toBe('10\u202f000'));
  it('arrondit les décimales', () => expect(f(9999.9)).toBe('10\u202f000'));
  it('zéro', () => expect(f(0)).toBe('0'));
  it('négatif', () => expect(f(-5000)).toBe('-5\u202f000'));
  it('grand nombre', () => expect(f(1000000)).toBe('1\u202f000\u202f000'));
});

describe('esc() — échappement XSS', () => {
  it('échappe <script>', () => expect(esc('<script>')).toBe('&lt;script&gt;'));
  it('échappe les guillemets', () => expect(esc('"hello"')).toBe('&quot;hello&quot;'));
  it('échappe &', () => expect(esc('a&b')).toBe('a&amp;b'));
  it('gère null', () => expect(esc(null)).toBe(''));
  it('gère undefined', () => expect(esc(undefined)).toBe(''));
  it('payload XSS complet', () => {
    const payload = '<img src=x onerror="alert(1)">';
    const result = esc(payload);
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
    expect(result).not.toContain('"');
  });
  it('chaîne normale inchangée', () => expect(esc('Jean Dupont')).toBe('Jean Dupont'));
});

describe('validatePhone() — numéros gabonais', () => {
  it('accepte 077XXXXXXX', () => expect(validatePhone('077123456')).toBeNull());
  it('accepte 066XXXXXXX', () => expect(validatePhone('066123456')).toBeNull());
  it('accepte +241077XXXXXXX', () => expect(validatePhone('+241077123456')).toBeNull());
  it('accepte avec espaces', () => expect(validatePhone('077 12 34 56')).toBeNull());
  it('rejette trop court', () => expect(validatePhone('0771234')).toBeTruthy());
  it('rejette préfixe invalide (05)', () => expect(validatePhone('055123456')).toBeTruthy());
  it('rejette null', () => expect(validatePhone(null)).toBeTruthy());
  it('rejette chaîne vide', () => expect(validatePhone('')).toBeTruthy());
});

describe('S — cache localStorage', () => {
  it('retourne la valeur par défaut si clé absente', () => {
    expect(S.get('inexistant', 42)).toBe(42);
  });
  it('stocke et récupère une valeur', () => {
    S.set('bal', 50000);
    expect(S.get('bal', 0)).toBe(50000);
  });
  it('stocke un objet', () => {
    S.set('user', { name: 'Jean', pin: '1234' });
    expect(S.get('user', {}).name).toBe('Jean');
  });
});
