export const f = n => new Intl.NumberFormat('fr-FR').format(Math.round(n));
export const $ = id => document.getElementById(id);
export const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const si = (ic, col, sz = 18) => `<svg width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="none" stroke="${esc(col)}" stroke-width="2"><use href="#${ic}"/></svg>`;

// Wrapper try/catch pour les appels Supabase — retourne { data, error }
export async function tryCatch(fn, label = '') {
  try {
    const data = await fn();
    return { data, error: null };
  } catch (e) {
    console.error(label || 'tryCatch', e);
    return { data: null, error: e };
  }
}

// Validateurs — retournent null si OK, sinon un message d'erreur
export const validateAmount = (amount, balance, { withFee = false, min = 1 } = {}) => {
  if (!amount || amount < min) return min > 1 ? `Montant minimum ${f(min)} FCFA` : 'Saisis un montant';
  const total = withFee ? amount + Math.round(amount * 0.015) : amount;
  if (total > balance) return withFee ? 'Solde insuffisant (frais inclus)' : 'Solde insuffisant';
  return null;
};

export const validatePhone = phone => {
  if (!phone) return 'Numéro requis';
  const clean = phone.replace(/[\s\-().]/g, '');
  // Gabon : +241XXXXXXXX ou 0XXXXXXXX (8 chiffres locaux commençant par 06 ou 07)
  if (!/^(\+241)?0[67]\d{7}$/.test(clean)) return 'Numéro gabonais invalide (ex: 077 12 34 56)';
  return null;
};

export const validateName = (name, { min = 1, label = 'Nom' } = {}) => {
  if (!name || name.trim().length < min) return min > 1 ? `${label} trop court` : `${label} requis`;
  return null;
};
