import { f, $, si } from '../utils.js';
import { store } from '../store.js';
import { db } from '../api.js';

export const budgetScreen = {
  r_budget() {
    const txs = store.get('txs', []);
    const out = txs.filter(t => t.type === 'send' || t.type === 'qr' || t.type === 'bill' || t.type === 'recharge' || t.type === 'coffre_deposit');
    const inp = txs.filter(t => t.type === 'recv' || t.type === 'transfer_in');
    const totalOut = out.reduce((s, t) => s + (t.amount || 0), 0);
    const totalIn = inp.reduce((s, t) => s + (t.amount || 0), 0);
    $('bud-out').textContent = f(totalOut) + ' F';
    $('bud-in').textContent = f(totalIn) + ' F';

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

    this._renderBudgetChart(txs.map(t => ({ from_user_id: t.type !== 'recv' ? 'me' : null, amount: t.amount, created_at: new Date().toISOString(), type: t.type })), 'me');

    if (store.currentUser) {
      db.from('transactions')
        .select('*, from_user:from_user_id(name,avatar), to_user:to_user_id(name,avatar)')
        .or(`from_user_id.eq.${store.currentUser.id},to_user_id.eq.${store.currentUser.id}`)
        .order('created_at', { ascending: false })
        .limit(50)
        .then(({ data: txs2 }) => {
          if (!txs2?.length) { $('all-tx').innerHTML = '<div style="padding:16px;text-align:center;color:var(--txt3);font-size:.8rem">Aucune transaction</div>'; return; }
          this._renderBudgetChart(txs2, store.currentUser.id);
          let dbOut = 0, dbIn = 0;
          txs2.forEach(t => {
            if (t.to_user_id === store.currentUser.id) dbIn += (t.amount || 0);
            else dbOut += (t.amount || 0);
          });
          if ($('bud-out')) $('bud-out').textContent = f(dbOut) + ' F';
          if ($('bud-in')) $('bud-in').textContent = f(dbIn) + ' F';
          const dbCats = [
            { name: 'Transferts', ico: 'send', col: '#D4A017', bg: 'rgba(212,160,23,.12)', types: ['transfer'] },
            { name: 'Paiements', ico: 'pay', col: '#3b82f6', bg: 'rgba(59,130,246,.12)', types: ['qr', 'bill'] },
            { name: 'Recharges', ico: 'phone', col: '#dc2626', bg: 'rgba(220,38,38,.12)', types: ['recharge'] },
            { name: 'Coffre', ico: 'lock', col: '#0A4A2E', bg: 'rgba(10,74,46,.12)', types: ['coffre_deposit'] },
          ];
          if ($('cat-list')) $('cat-list').innerHTML = dbCats.map(cat => {
            const total = txs2.filter(t => t.from_user_id === store.currentUser.id && cat.types.includes(t.type)).reduce((s,t) => s+(t.amount||0), 0);
            const pct = dbOut > 0 ? Math.round(total / dbOut * 100) : 0;
            return `<div class="cat-item"><div class="cat-ic" style="background:${cat.bg}">${si(cat.ico, cat.col, 15)}</div><div style="flex:1"><div class="cat-name">${cat.name}</div><div class="cat-bar-wrap" style="margin-top:5px"><div class="cat-bar-fill" style="width:${pct}%;background:${cat.col}"></div></div></div><div class="cat-right"><div class="cat-val">${f(total)} F</div><div class="cat-pct">${pct}%</div></div></div>`;
          }).join('');
          $('all-tx').innerHTML = txs2.map(t => {
            const isCredit = t.to_user_id === store.currentUser.id;
            const other = isCredit ? t.from_user : t.to_user;
            const name = other?.name || t.merchant_name || 'GhettoPay';
            const ico = { transfer: isCredit?'recv':'send', qr:'qric', recharge:'phone', bill:'pay', coffre_deposit:'lock', tontine:'users' }[t.type] || 'send';
            const col = isCredit ? '#16A34A' : '#DC2626';
            const bg = isCredit ? 'rgba(22,163,74,.12)' : 'rgba(212,160,23,.12)';
            const cat = { transfer:'Transfert', qr:'QR Pay', recharge:'Recharge', bill:'Facture', coffre_deposit:'Coffre', tontine:'Tontine' }[t.type] || t.type;
            const time = new Date(t.created_at).toLocaleDateString('fr-FR', { day:'numeric', month:'short' });
            return this._txRow(isCredit, name, ico, col, bg, cat, time, t.amount);
          }).join('');
        });
    } else {
      const txs2 = store.get('txs', []);
      $('all-tx').innerHTML = txs2.length ? txs2.map(t => {
        const isCredit = t.type === 'recv';
        const ico = { recv:'recv', send:'send', qr:'qric', recharge:'phone', bill:'pay', coffre_deposit:'lock', tontine:'users' }[t.type] || 'send';
        const col = isCredit ? '#16A34A' : '#DC2626';
        const bg = isCredit ? 'rgba(22,163,74,.12)' : 'rgba(212,160,23,.12)';
        const cat = t.cat || { recv:'Reçu', send:'Envoyé', qr:'QR Pay', recharge:'Recharge', bill:'Facture', coffre_deposit:'Coffre', tontine:'Tontine' }[t.type] || t.type;
        return this._txRow(isCredit, t.name||'Inconnu', ico, col, bg, cat, t.time||'—', t.amount);
      }).join('') : '<div style="padding:16px;text-align:center;color:var(--txt3);font-size:.8rem">Aucune transaction</div>';
    }
  },

  exportCSV() {
    const rows = [['Date','Type','Nom','Montant (FCFA)','Catégorie']];
    if (store.currentUser) {
      db.from('transactions')
        .select('*, from_user:from_user_id(name), to_user:to_user_id(name)')
        .or(`from_user_id.eq.${store.currentUser.id},to_user_id.eq.${store.currentUser.id}`)
        .order('created_at', { ascending: false })
        .limit(500)
        .then(({ data: txs }) => {
          (txs || []).forEach(t => {
            const isCredit = t.to_user_id === store.currentUser.id;
            const other = isCredit ? t.from_user : t.to_user;
            const name = other?.name || t.merchant_name || 'GhettoPay';
            const cat = { transfer:'Transfert', qr:'QR Pay', recharge:'Recharge', bill:'Facture', coffre_deposit:'Coffre', tontine:'Tontine' }[t.type] || t.type;
            const date = new Date(t.created_at).toLocaleDateString('fr-FR');
            rows.push([date, isCredit ? 'Crédit' : 'Débit', name, t.amount, cat]);
          });
          this._downloadCSV(rows);
        });
    } else {
      const txs = store.get('txs', []);
      txs.forEach(t => {
        const cat = t.cat || t.type || '';
        rows.push([t.time || '', t.type === 'recv' ? 'Crédit' : 'Débit', t.name || '', t.amount || 0, cat]);
      });
      this._downloadCSV(rows);
    }
  },

  _downloadCSV(rows) {
    const bom = '﻿';
    const csv = bom + rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `ghettopay_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.toast('Export CSV téléchargé', 'ok');
  },

  setBudTab(btn) {
    btn.closest('.bud-tabs').querySelectorAll('.btab').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    this.render('budget');
  },

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
};
