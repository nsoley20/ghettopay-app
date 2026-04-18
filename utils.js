export const f = n => new Intl.NumberFormat('fr-FR').format(Math.round(n));
export const $ = id => document.getElementById(id);
export const si = (ic, col, sz = 18) => `<svg width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="none" stroke="${col}" stroke-width="2"><use href="#${ic}"/></svg>`;
export const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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
  if (!phone || phone.length < 6) return 'Numéro invalide';
  return null;
};

export const validateName = (name, { min = 1, label = 'Nom' } = {}) => {
  if (!name || name.trim().length < min) return min > 1 ? `${label} trop court` : `${label} requis`;
  return null;
};
