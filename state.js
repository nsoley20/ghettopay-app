export const S = {
  get(k, d) { try { const v = localStorage.getItem('gp3_' + k); return v !== null ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('gp3_' + k, JSON.stringify(v)); } catch {} }
};
