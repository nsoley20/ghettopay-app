import { $, si, esc } from '../utils.js';
import { store } from '../store.js';
import { db } from '../api.js';

export const notifsScreen = {
  r_notifs() {
    this._renderNotifsList(store.get('notifs', []));
    if (!store.currentUser) return;
    db.from('notifications')
      .select('*')
      .eq('user_id', store.currentUser.id)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data: dbNotifs }) => {
        if (!dbNotifs?.length) return;
        const iconFor  = t => ({ tontine_invite:'users', tontine_reminder:'users' }[t] || 'bell');
        const bgFor    = t => t === 'tontine_reminder' ? 'rgba(212,160,23,.1)' : 'rgba(10,74,46,.12)';
        const colorFor = t => t === 'tontine_reminder' ? 'var(--gold2)' : 'var(--forest)';
        const existing = store.get('notifs', []);
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
        store.set('notifs', merged);
        this._renderNotifsList(merged);
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
    const unread = notifs.filter(n => !n.read).length;
    if ($('notif-sub')) $('notif-sub').textContent = unread ? `${unread} non lue${unread>1?'s':''}` : 'Tout lu';
    if ($('notif-dot')) $('notif-dot').style.display = unread ? 'block' : 'none';
  },

  _markNotifRead(id, el) {
    const ns = store.get('notifs', []);
    const n = ns.find(x => String(x.id) === String(id));
    if (n && !n.read) {
      n.read = true;
      store.set('notifs', ns);
      if (el) el.querySelector('div[style*="background:var(--gold2)"]')?.remove();
      el?.classList.remove('unread');
      if (store.currentUser && id) db.from('notifications').update({ read: true }).eq('id', id).catch(() => {});
      const unread = ns.filter(n => !n.read).length;
      if ($('notif-dot')) $('notif-dot').style.display = unread ? 'block' : 'none';
      if ($('notif-sub')) $('notif-sub').textContent = unread ? `${unread} non lue${unread>1?'s':''}` : 'Tout lu';
    }
  },

  readAll() {
    const ns = store.get('notifs', []);
    ns.forEach(n => n.read = true);
    store.set('notifs', ns);
    this._renderNotifsList(ns);
    if ($('notif-dot')) $('notif-dot').style.display = 'none';
    if ($('notif-sub')) $('notif-sub').textContent = 'Tout lu';
    if (store.currentUser) {
      db.from('notifications').update({ read: true }).eq('user_id', store.currentUser.id).eq('read', false).catch(() => {});
    }
    this.toast('Toutes lues', 'inf');
  },
};
