// All page views + the virtualized track list + track/playlist actions.
import { app, lib, player, toast, go, menu, modal, closeLayer, prompt, confirmBox, pickImage, copyText, coverImg, collectionCover, genCover, hydrate, ico, refresh, burst, setLikeBtn, applyTheme, applyPreset, PRESETS, DEFAULTS, VERSION, checkForUpdate, haptic, SWIPE_ACTIONS } from './core.js';
import { $, $$, esc, h, fmtTime, fmtLong, fmtBytes, norm, sortKey, debounce } from './util.js';
import { EQ_PRESETS } from './player.js';
import { albumKeyOf, primaryArtist } from './library.js';

const R = app.renderers;
const T = (id) => lib.track(id);
const sumDur = (ids) => ids.reduce((a, i) => a + (T(i)?.duration || 0), 0);
const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;
const ago = (ts) => { if (!ts) return ''; const d = (Date.now() - ts) / 1000; if (d < 3600) return Math.max(1, Math.round(d / 60)) + ' min ago'; if (d < 86400) return Math.round(d / 3600) + ' hr ago'; if (d < 86400 * 30) return Math.round(d / 86400) + ' days ago'; return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };
const isCurSource = (src) => player.source && src && player.source.type === src.type && player.source.id === src.id;

// =====================================================================
// Virtualized track list
// =====================================================================
export function trackList(ids, o = {}) {
  const src = o.source || { type: 'list', label: 'Songs' };
  const showAlbum = o.album !== false; const showAdded = !!o.added;
  const wrap = h(`<div class="tlist ${showAlbum ? '' : 'no-album'}"></div>`);
  if (!ids.length) { wrap.appendChild(h(`<div class="empty" style="padding:30px">${o.emptyHTML || '<p>No songs here yet.</p>'}</div>`)); return wrap; }
  const cols = showAlbum ? ['#', 'Title', 'Album', showAdded ? 'Date added' : 'Plays', '', ico('clock'), ''] : ['#', 'Title', showAdded ? 'Date added' : 'Plays', '', ico('clock'), ''];
  const keys = showAlbum ? ['track', 'title', 'album', showAdded ? 'added' : 'plays', '', 'duration', ''] : ['track', 'title', showAdded ? 'added' : 'plays', '', 'duration', ''];
  const head = h(`<div class="thead">${cols.map((c, i) => `<span data-k="${keys[i]}" class="${i === cols.length - 4 ? 'ad' : ''}${o.sort && o.sort.k === keys[i] ? ' sorted' : ''}" style="${i === 0 || i === cols.length - 2 ? 'text-align:right' : ''}">${c}${o.sort && o.sort.k === keys[i] ? (o.sort.d > 0 ? ' ↑' : ' ↓') : ''}</span>`).join('')}</div>`);
  if (o.onSort) head.addEventListener('click', (e) => { const k = e.target.closest('span')?.dataset.k; if (k) o.onSort(k); });
  wrap.appendChild(head);
  const v = h('<div class="vwrap"></div>'); wrap.appendChild(v);
  const rowH = () => parseFloat(getComputedStyle(document.body).getPropertyValue('--row')) || 56;
  let RH = 56; const rows = new Map(); const sel = new Set(); let anchor = -1;
  const scroller = $('#view');
  const rowHTML = (i) => {
    const t = T(ids[i]); if (!t) return '<div></div>';
    const cur = t.id === player.current;
    const n = o.numbers === 'track' ? (t.track || '') : i + 1;
    const lk = lib.isLiked(t.id);
    const extra = showAdded ? ago(o.addedAt ? o.addedAt(t.id, i) : t.added) : (lib.db.plays[t.id] || '');
    return `<div class="n">${cur ? `<span class="eq-mini ${player.playing ? '' : 'paused'}"><i></i><i></i><i></i><i></i></span>` : `<span class="num">${n}</span>`}<span class="pl">${ico(cur && player.playing ? 'pause' : 'play')}</span></div>
      <div class="main">${o.noArt ? '' : `<div class="th">${t.cover ? coverImg(t.cover, true) : ico('note')}</div>`}<div class="tt"><span class="t1">${esc(t.title)}</span><span class="t2">${artistLinks(t)}</span></div></div>
      ${showAlbum ? `<a class="al" data-album="${esc(albumKey(t))}">${esc(t.album || '')}</a>` : ''}
      <span class="ad">${esc(extra)}</span>
      <button class="ib lk ${lk ? 'on' : ''}" title="Like">${ico(lk ? 'heart-f' : 'heart')}</button>
      <span class="du">${t.duration ? fmtTime(t.duration) : ''}</span>
      <button class="ib mo" title="More">${ico('more')}</button>`;
  };
  const paint = () => {
    RH = rowH(); v.style.height = ids.length * RH + 'px';
    const top = v.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    const vh = scroller.clientHeight; const first = Math.max(0, Math.floor(-top / RH) - 8); const last = Math.min(ids.length - 1, Math.ceil((vh - top) / RH) + 8);
    for (const [i, el] of rows) if (i < first || i > last) { el.remove(); rows.delete(i); }
    for (let i = first; i <= last; i++) {
      if (rows.has(i)) continue;
      const el = document.createElement('div'); el.className = 'trow' + (sel.has(i) ? ' sel' : '') + (ids[i] === player.current ? ' cur' : '');
      el.dataset.i = i; el.dataset.id = ids[i]; el.style.top = i * RH + 'px'; el.draggable = !app.isMobile; el.innerHTML = rowHTML(i);
      v.appendChild(el); rows.set(i, el); hydrate(el);
    }
  };
  const repaint = () => { for (const el of rows.values()) el.remove(); rows.clear(); paint(); };
  let raf = 0; const onScroll = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paint(); }); };
  scroller.addEventListener('scroll', onScroll, { passive: true }); addEventListener('resize', onScroll);
  const offPlayer = (e) => { if (e === 'track' || e === 'state') repaint(); };
  player.on(offPlayer);
  const offLib = (e, d) => { if (e === 'liked') { for (const [i, el] of rows) if (ids[i] === d) { const b = el.querySelector('.lk'); setLikeBtn(b, lib.isLiked(d)); } } };
  lib.on(offLib);
  const prevCleanup = app.cleanup;
  app.cleanup = () => { prevCleanup?.(); scroller.removeEventListener('scroll', onScroll); removeEventListener('resize', onScroll); player.listeners.delete(offPlayer); lib.listeners.delete(offLib); };
  requestAnimationFrame(paint); setTimeout(paint, 60);

  const idxOf = (e) => { const r = e.target.closest('.trow'); return r ? +r.dataset.i : -1; };
  const selIds = () => [...sel].sort((a, b) => a - b).map((i) => ids[i]);
  const setSel = (i, mode) => {
    if (mode === 'toggle') { sel.has(i) ? sel.delete(i) : sel.add(i); anchor = i; }
    else if (mode === 'range' && anchor >= 0) { sel.clear(); const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)]; for (let k = a; k <= b; k++) sel.add(k); }
    else { sel.clear(); sel.add(i); anchor = i; }
    for (const [k, el] of rows) el.classList.toggle('sel', sel.has(k));
  };
  const play = (i) => {
    if (ids[i] === player.current && isCurSource(src)) { player.toggle(); return; }
    player.playList(ids, i, src);
  };
  v.addEventListener('click', (e) => {
    const i = idxOf(e); if (i < 0) return;
    const t = e.target;
    if (t.closest('.lk')) { const id = ids[i]; lib.like(id); setLikeBtn(t.closest('.lk'), lib.isLiked(id)); if (lib.isLiked(id)) burst(t.closest('.lk')); return; }
    if (t.closest('.mo')) { if (!sel.has(i)) setSel(i); trackMenu(sel.size > 1 ? selIds() : [ids[i]], { el: t.closest('.mo'), right: true }, { playlist: o.playlistId, indices: sel.size > 1 ? [...sel] : [i] }); return; }
    if (t.closest('.pl')) { play(i); return; }
    const art = t.closest('[data-artist]'); if (art) { go('artist', { key: art.dataset.artist }); return; }
    const al = t.closest('[data-album]'); if (al) { go('album', { key: al.dataset.album }); return; }
    if (app.isMobile) { play(i); return; }
    setSel(i, e.ctrlKey || e.metaKey ? 'toggle' : e.shiftKey ? 'range' : 'one');
  });
  v.addEventListener('dblclick', (e) => { const i = idxOf(e); if (i >= 0 && !e.target.closest('button,a')) play(i); });
  v.addEventListener('contextmenu', (e) => { const i = idxOf(e); if (i < 0) return; e.preventDefault(); if (!sel.has(i)) setSel(i); trackMenu(sel.size > 1 ? selIds() : [ids[i]], { x: e.clientX, y: e.clientY }, { playlist: o.playlistId, indices: sel.size > 1 ? [...sel] : [i] }); });
  longPress(v, (e) => { const i = idxOf(e); if (i >= 0) trackMenu([ids[i]], { x: 0, y: 0 }, { playlist: o.playlistId, indices: [i] }); });
  rowSwipes(v, (row) => ids[+row.dataset.i]);
  // drag & drop: to sidebar playlists, and reorder within playlists
  v.addEventListener('dragstart', (e) => {
    const i = idxOf(e); if (i < 0) return; if (!sel.has(i)) setSel(i);
    const list = selIds(); e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('application/x-pulse-tracks', JSON.stringify(list));
    if (o.playlistId) e.dataTransfer.setData('application/x-pulse-reorder', JSON.stringify({ pl: o.playlistId, from: i }));
    const g = h(`<div class="drag-ghost">${list.length > 1 ? plural(list.length, 'song') : esc(T(list[0]).title)}</div>`); document.body.appendChild(g); e.dataTransfer.setDragImage(g, 10, 10); setTimeout(() => g.remove(), 0);
  });
  if (o.playlistId && o.reorder) {
    let over = null;
    v.addEventListener('dragover', (e) => { if (!e.dataTransfer.types.includes('application/x-pulse-reorder')) return; e.preventDefault(); const r = e.target.closest('.trow'); if (over && over !== r) over.classList.remove('drop-above', 'drop-below'); over = r; if (r) { const b = r.getBoundingClientRect(); r.classList.toggle('drop-above', e.clientY < b.top + b.height / 2); r.classList.toggle('drop-below', e.clientY >= b.top + b.height / 2); } });
    v.addEventListener('drop', (e) => { const d = e.dataTransfer.getData('application/x-pulse-reorder'); if (!d || !over) return; e.preventDefault(); const { from } = JSON.parse(d); let to = +over.dataset.i + (over.classList.contains('drop-below') ? 1 : 0); if (to > from) to--; over.classList.remove('drop-above', 'drop-below'); if (to !== from) { lib.reorderPlaylist(o.playlistId, from, to); refresh(); } });
    v.addEventListener('dragleave', (e) => { if (over && !v.contains(e.relatedTarget)) { over.classList.remove('drop-above', 'drop-below'); over = null; } });
  }
  wrap.selectAll = () => { ids.forEach((_, i) => sel.add(i)); repaint(); };
  wrap.tabIndex = -1;
  wrap.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'a') { e.preventDefault(); wrap.selectAll(); } if (e.key === 'Enter' && sel.size) play([...sel][0]); });
  return wrap;
}
function longPress(el, fn) {
  let t, sx, sy;
  el.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; t = setTimeout(() => { t = null; navigator.vibrate?.(8); fn(e); el.addEventListener('click', stop, { capture: true, once: true }); }, 480); }, { passive: true });
  const cancel = () => { clearTimeout(t); };
  const stop = (e) => { e.stopPropagation(); e.preventDefault(); };
  el.addEventListener('touchmove', (e) => { if (Math.hypot(e.touches[0].clientX - sx, e.touches[0].clientY - sy) > 10) cancel(); }, { passive: true });
  el.addEventListener('touchend', cancel); el.addEventListener('touchcancel', cancel);
}
export { longPress };
// Swipe a song row: right → queue (default), left → like. Locks to horizontal so scrolling still works.
function rowSwipes(v, idFor) {
  let row = null, sx = 0, sy = 0, dx = 0, lock = null, bg = null;
  const G = () => app.S.gest || {};
  const reset = (animate) => { if (!row) return; const r = row; r.style.transition = animate ? 'transform .3s cubic-bezier(.2,.9,.3,1)' : ''; r.style.transform = ''; const b = bg; setTimeout(() => { r.style.transition = ''; r.classList.remove('swiping'); b?.remove(); }, animate ? 300 : 0); row = null; bg = null; lock = null; };
  v.addEventListener('touchstart', (e) => { if (e.touches.length !== 1) return; const r = e.target.closest('.trow'); if (!r) return; row = r; sx = e.touches[0].clientX; sy = e.touches[0].clientY; dx = 0; lock = null; }, { passive: true });
  v.addEventListener('touchmove', (e) => {
    if (!row) return; const x = e.touches[0].clientX - sx, y = e.touches[0].clientY - sy;
    if (!lock) { if (Math.abs(x) < 8 && Math.abs(y) < 8) return; lock = Math.abs(x) > Math.abs(y) * 1.3 ? 'h' : 'v'; }
    if (lock !== 'h') return;
    const dir = x > 0 ? 'right' : 'left'; const act = G()[dir] || 'off'; if (act === 'off') return;
    e.preventDefault(); dx = x;
    if (!bg) { bg = document.createElement('div'); bg.className = 'swipe-bg'; bg.style.top = row.style.top; v.insertBefore(bg, row); row.classList.add('swiping'); }
    const [label, icon] = SWIPE_ACTIONS[act] || SWIPE_ACTIONS.off; const id = idFor(row); const liked = act === 'like' && lib.isLiked(id);
    bg.className = `swipe-bg ${dir} ${Math.abs(dx) > 80 ? 'armed' : ''}`; bg.innerHTML = `<span>${ico(liked ? 'heart' : icon)}${liked ? 'Unlike' : label}</span>`;
    if (Math.abs(dx) > 80 && !row._armed) { row._armed = true; haptic(6); } else if (Math.abs(dx) <= 80) row._armed = false;
    row.style.transform = `translateX(${Math.sign(dx) * Math.min(Math.abs(dx), 140 + Math.max(0, Math.abs(dx) - 140) * 0.25)}px)`;
  }, { passive: false });
  v.addEventListener('touchend', () => {
    if (!row) return; if (lock !== 'h' || Math.abs(dx) <= 80) { reset(true); return; }
    const id = idFor(row); const act = G()[dx > 0 ? 'right' : 'left'];
    row.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); }, { capture: true, once: true });
    if (act === 'queue') { player.addToQueue([id]); toast('Added to queue'); }
    else if (act === 'next') { player.playNext([id]); toast('Playing next'); }
    else if (act === 'like') { lib.like(id); toast(lib.isLiked(id) ? 'Added to Liked Songs' : 'Removed from Liked Songs'); const b = row.querySelector('.lk'); setLikeBtn(b, lib.isLiked(id)); }
    else if (act === 'playlist') { const r = row; setTimeout(() => menu(playlistPicker([id]), { x: 0, y: 0 }), 200); }
    haptic(12); reset(true);
  });
  v.addEventListener('touchcancel', () => reset(true));
}
function artistLinks(t) {
  const names = String(t.artist || 'Unknown Artist').split(/\s*(;|,| feat\.? | ft\.? | & )\s*/i);
  return names.map((n, i) => (i % 2 ? esc(n.trim() === ';' ? ',' : n) + ' ' : `<a data-artist="${esc(norm(n))}">${esc(n)}</a>`)).join('');
}
export function albumKey(t) { return albumKeyOf(t); }

// =====================================================================
// Track menu (context) & playlist picker
// =====================================================================
export function playlistPicker(ids, excludeId) {
  const items = [{ label: 'New playlist', icon: 'plus', action: async () => { const name = await prompt('New playlist', '', 'My playlist'); if (!name) return; const n = lib.createNode('playlist', name); lib.addToPlaylist(n.id, ids); toast(`Added to ${name}`); } }, '-'];
  const walk = (list, depth) => { for (const id of list) { const n = lib.node(id); if (!n) continue; if (n.type === 'folder') { items.push({ header: '  '.repeat(depth) + n.name }); walk(n.children, depth + 1); } else if (n.id !== excludeId) items.push({ label: n.name, icon: 'playlist', indent: depth, filter: n.name, action: () => { const c = lib.addToPlaylist(n.id, ids); toast(c ? `Added ${c > 1 ? c + ' songs' : ''} to ${n.name}`.replace('  ', ' ') : 'Already in ' + n.name); } }); } };
  walk(lib.db.rootNodes, 0);
  return items;
}
export function trackMenu(ids, at, ctx = {}) {
  const t = T(ids[0]); if (!t) return;
  const one = ids.length === 1; const liked = ids.every((i) => lib.isLiked(i));
  const items = [
    { label: one ? 'Play' : `Play ${ids.length} songs`, icon: 'play', action: () => player.playList(ids, 0, { type: 'sel', label: 'Selection' }) },
    { label: 'Play next', icon: 'queue', action: () => { player.playNext(ids); toast('Playing next'); } },
    { label: 'Add to queue', icon: 'plus', action: () => { player.addToQueue(ids); toast(one ? 'Added to queue' : `${ids.length} songs added to queue`); } },
    { label: 'Add to playlist', icon: 'playlist', sub: () => playlistPicker(ids, ctx.playlist), searchSub: Object.keys(lib.db.nodes).length > 8 },
    '-',
    { label: liked ? 'Remove from Liked Songs' : 'Save to Liked Songs', icon: liked ? 'heart-f' : 'heart', action: () => { ids.forEach((i) => lib.like(i, !liked)); toast(liked ? 'Removed from Liked Songs' : 'Added to Liked Songs'); } },
    one && { label: 'Go to artist', icon: 'artist', action: () => go('artist', { key: norm(primaryArtist(t.artist) || 'Unknown Artist') }) },
    one && { label: 'Go to album', icon: 'album', action: () => go('album', { key: albumKey(t) }) },
    one && { label: 'Go to folder', icon: 'folder', action: () => { const root = lib.db.roots.find((r) => r.id === t.root); go('folders', { key: '/' + [root?.name || 'Imported', ...(t.dirs || [])].join('/') }); } },
    one && { label: 'Song info', icon: 'info', action: () => songInfo(t) },
    one && app.isDesktop && { label: 'Show in File Explorer', icon: 'folder', action: () => app.P.revealTrack(t, lib.db.roots.find((r) => r.id === t.root)) },
    ctx.playlist && '-',
    ctx.playlist && { label: 'Remove from this playlist', icon: 'x', action: () => { lib.removeFromPlaylist(ctx.playlist, ctx.indices); refresh(); } },
    '-',
    { label: app.isDesktop ? 'Move to Recycle Bin' : 'Delete from this device', icon: 'trash', danger: true, action: async () => {
      if (await confirmBox(app.isDesktop ? 'Move to Recycle Bin?' : 'Delete from Pulse?', `${one ? `"${t.title}"` : ids.length + ' songs'} will be ${app.isDesktop ? 'moved to the Recycle Bin' : 'removed from this device'}, along with saved covers.`)) { await lib.deleteTracks(ids, true); toast('Deleted'); refresh(); }
    } }
  ];
  const head = `<div class="sheet-head"><div class="sw">${t.cover ? coverImg(t.cover, true) : ico('note')}</div><div><b>${esc(one ? t.title : ids.length + ' songs')}</b><small>${esc(one ? t.artist : '')}</small></div></div>`;
  const m = menu(items, at, { head }); hydrate(m);
}
function songInfo(t) {
  const root = lib.db.roots.find((r) => r.id === t.root);
  const rows = [['Title', t.title], ['Artist', t.artist], ['Album artist', t.albumArtist], ['Album', t.album], ['Year', t.year || ''], ['Genre', t.genre], ['Track', t.track ? t.track + (t.disc ? ` (disc ${t.disc})` : '') : ''], ['Composer', t.composer], ['BPM', t.bpm || ''], ['Duration', fmtTime(t.duration)], ['Quality', [t.bitrate && t.bitrate + ' kbps', t.sampleRate && (t.sampleRate / 1000) + ' kHz', t.bitDepth && t.bitDepth + '-bit'].filter(Boolean).join(' · ')], ['Size', fmtBytes(t.size)], ['Plays', lib.db.plays[t.id] || 0], ['Last played', lib.db.last[t.id] ? new Date(lib.db.last[t.id]).toLocaleString() : 'Never'], ['Added', new Date(t.added).toLocaleString()], ['Lyrics', t.hasLyrics ? (t.lrc ? 'Synced (.lrc)' : 'Embedded') : 'None'], ['File', (root?.path ? root.path + '/' : '') + t.rel]].filter((r) => r[1] !== '' && r[1] != null);
  modal(`<h2>Song info <button class="ib sm" data-close>${ico('x')}</button></h2><div style="display:flex;gap:16px;align-items:center;margin-bottom:12px"><div class="sw" style="width:84px;height:84px">${t.cover ? coverImg(t.cover, false) : ico('note')}</div><div><b style="font-size:17px">${esc(t.title)}</b><div style="opacity:.7">${esc(t.artist)}</div></div></div><dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`, hydrate);
}

// =====================================================================
// Shared page pieces
// =====================================================================
function heroEl({ kind, title, art, round, stats, desc, crumbs, color, editable }) {
  const el = h(`<div class="hero" style="${color ? `--hc:${color}` : ''}">
    <div class="hero-art ${round ? 'round' : ''}">${art || ''}${editable ? `<div class="edit-ov">${ico('edit')}<span>Choose photo</span></div>` : ''}</div>
    <div class="hero-info">${crumbs || ''}<div class="kind">${esc(kind || '')}</div><h1>${esc(title)}</h1>${desc ? `<div class="desc">${esc(desc)}</div>` : ''}<div class="stats">${stats || ''}</div></div></div>`);
  return el;
}
function actionsEl(ids, src, title, extra = '') {
  const playingHere = isCurSource(src) && player.playing;
  const el = h(`<div class="actions"><button class="bigplay ${playingHere ? 'is-playing' : ''}" title="Play">${ico('play').replace('<svg>', '<svg class="i-play">')}${ico('pause').replace('<svg>', '<svg class="i-pause">')}</button>
    <button class="ib mode ${player.shuffle ? 'on' : ''}" data-a="shuffle" title="Shuffle play">${ico('shuffle')}</button>${extra}<span class="stuck-title">${esc(title)}</span><span class="grow"></span></div>`);
  el.querySelector('.bigplay').onclick = () => { if (isCurSource(src) && player.current) player.toggle(); else player.playList(ids, 0, src, { randomStart: true }); };
  el.querySelector('[data-a=shuffle]').onclick = (e) => { player.toggleShuffle(); e.currentTarget.classList.toggle('on', player.shuffle); if (!isCurSource(src)) player.playList(ids, 0, src, { shuffle: true, randomStart: true }); };
  const upd = (e) => { if (e === 'state' || e === 'track') el.querySelector('.bigplay').classList.toggle('is-playing', isCurSource(src) && player.playing); };
  player.on(upd); const pc = app.cleanup; app.cleanup = () => { pc?.(); player.listeners.delete(upd); };
  const sc = $('#view'); const stick = () => el.classList.toggle('stuck', el.getBoundingClientRect().top <= sc.getBoundingClientRect().top + 1 && sc.scrollTop > 80);
  sc.addEventListener('scroll', stick, { passive: true }); const pc2 = app.cleanup; app.cleanup = () => { pc2?.(); sc.removeEventListener('scroll', stick); };
  return el;
}
function cardHTML({ cover, title, sub, round, data, i = 0, playing }) {
  return `<div class="card" ${data} style="--i:${Math.min(i, 20)}"><div class="cv ${round ? 'round' : ''}">${cover}<button class="fab ${playing ? 'playing' : ''}" data-play>${ico(playing && player.playing ? 'pause' : 'play')}</button></div><b>${esc(title)}</b><small>${esc(sub || '')}</small></div>`;
}
function albumCard(al, i) { return cardHTML({ cover: al.cover ? coverImg(al.cover, false) : ico('album'), title: al.name, sub: (al.year ? al.year + ' • ' : '') + al.artist, data: `data-album="${esc(al.key)}"`, i }); }
function artistCard(ar, i) { return cardHTML({ cover: ar.cover ? coverImg(ar.cover, false) : ico('artist'), title: ar.name, sub: plural(ar.tracks.length, 'song'), round: true, data: `data-artist="${esc(ar.key)}"`, i }); }
function nodeCard(n, i) { const ids = lib.nodeTracks(n.id); return cardHTML({ cover: collectionCover(n, ids), title: n.name, sub: n.type === 'folder' ? `Folder • ${plural(n.children.length, 'item')}` : `Playlist • ${plural(ids.length, 'song')}`, data: `data-node="${n.id}"`, i }); }
function wireCards(el) {
  el.addEventListener('click', (e) => {
    const c = e.target.closest('.card,.tile'); if (!c) return;
    const playBtn = e.target.closest('[data-play]');
    const { album, artist, node, fold, go: g } = c.dataset;
    if (playBtn) {
      e.stopPropagation();
      if (album) { const al = lib.idx.albums.get(album); player.playList(al.tracks, 0, { type: 'album', id: album, label: al.name }); }
      else if (artist) { const ar = lib.idx.artists.get(artist); player.playList(ar.tracks, 0, { type: 'artist', id: artist, label: ar.name }, { randomStart: true }); }
      else if (node) { const n = lib.node(node); player.playList(lib.nodeTracks(node), 0, { type: 'node', id: node, label: n.name }); }
      else if (fold) { const f = lib.folderNode(fold); player.playList(lib.folderAllTracks(f), 0, { type: 'folder', id: fold, label: f.name }); }
      else if (g === 'liked') player.playList(likedIds(), 0, { type: 'liked', label: 'Liked Songs' });
      return;
    }
    if (album) go('album', { key: album }); else if (artist) go('artist', { key: artist }); else if (node) go('node', { id: node }); else if (fold) go('folders', { key: fold }); else if (g) go(g);
  });
  el.addEventListener('contextmenu', (e) => { const c = e.target.closest('[data-node]'); if (c) { e.preventDefault(); nodeMenu(c.dataset.node, { x: e.clientX, y: e.clientY }); } });
  longPress(el, (e) => { const c = e.target.closest('[data-node]'); if (c) nodeMenu(c.dataset.node, { x: 0, y: 0 }); });
}
const likedIds = () => Object.entries(lib.db.liked).filter(([id]) => T(id)).sort((a, b) => b[1] - a[1]).map((e) => e[0]);

function emptyLibrary() {
  const desk = app.isDesktop;
  const el = h(`<div class="empty" style="padding-top:12vh"><div class="boot-logo" style="justify-content:center;margin-bottom:18px"><span></span><span></span><span></span><span></span></div><h3>Your music, instantly.</h3><p>${desk ? 'Point Pulse at the folders where your songs live. Sub-folders, covers, tags and lyrics are all picked up automatically.' : 'Import songs or whole folders from the Files app. They\'re stored inside Pulse so they play offline, with covers and lyrics.'}</p>
    <div class="btns">${desk ? `<button class="pill solid" data-add>${ico('folder')}Add music folder</button>` : `<button class="pill solid" data-imp="1">${ico('folder')}Import a folder</button><button class="pill" data-imp="0">${ico('note')}Import songs</button>`}</div></div>`);
  el.addEventListener('click', (e) => { if (e.target.closest('[data-add]')) addFolder(); const b = e.target.closest('[data-imp]'); if (b) importMusic(b.dataset.imp === '1'); });
  return el;
}
async function shrinkImage(pic) {
  const url = URL.createObjectURL(new Blob([pic.data], { type: pic.mime || 'image/jpeg' }));
  try { const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; }); const sc = Math.min(1, 1920 / Math.max(img.naturalWidth, img.naturalHeight)); const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * sc); c.height = Math.round(img.naturalHeight * sc); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.82); } finally { URL.revokeObjectURL(url); }
}
export async function addFolder() { const r = await app.P.pickRoot(); if (r) { toast('Scanning ' + r.name + '…'); await lib.addRoot(r); refresh(); } }
export async function importMusic(folder) {
  const files = await app.P.pickFiles(folder); if (!files.length) return;
  const n = await lib.importFiles(files); toast(n ? `Imported ${plural(n, 'song')}` : 'Those songs are already in your library'); refresh();
}

// =====================================================================
// HOME
// =====================================================================
R.home = () => {
  const el = h('<div class="page"></div>');
  if (!Object.keys(lib.db.tracks).length && !lib.scanning) { el.appendChild(emptyLibrary()); return el; }
  const hr = new Date().getHours(); const greet = hr < 5 ? 'Up late' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  el.appendChild(h(`<div class="greet"><span>${greet}</span></div>`));
  // quick tiles: liked + recent playlists/albums
  const tiles = [`<a class="tile" data-go="liked" style="--i:0"><span class="sw liked">${ico('heart-f')}</span><b>Liked Songs</b><span class="fab" data-play>${ico('play')}</span></a>`];
  const recentNodes = Object.values(lib.db.nodes).filter((n) => n.type === 'playlist').sort((a, b) => (b.updated || b.created) - (a.updated || a.created)).slice(0, 4);
  recentNodes.forEach((n, i) => tiles.push(`<a class="tile" data-node="${n.id}" style="--i:${i + 1}"><span class="sw">${collectionCover(n, lib.nodeTracks(n.id))}</span><b>${esc(n.name)}</b><span class="fab" data-play>${ico('play')}</span></a>`));
  const seenAl = new Set(); const recAlbums = [];
  for (const id of lib.db.history) { const t = T(id); if (!t) continue; const k = albumKey(t); if (seenAl.has(k)) continue; seenAl.add(k); const al = lib.idx.albums.get(k); if (al) recAlbums.push(al); if (recAlbums.length > 16) break; }
  recAlbums.slice(0, 7 - recentNodes.length).forEach((al, i) => tiles.push(`<a class="tile" data-album="${esc(al.key)}" style="--i:${i + 5}"><span class="sw">${al.cover ? coverImg(al.cover, true) : ico('album')}</span><b>${esc(al.name)}</b><span class="fab" data-play>${ico('play')}</span></a>`));
  el.appendChild(h(`<div class="tiles">${tiles.join('')}</div>`));
  const section = (title, html, more) => { if (!html) return; el.appendChild(h(`<div class="sec"><h2>${title}</h2>${more ? `<a data-go="${more}">Show all</a>` : ''}</div>`)); el.appendChild(h(`<div class="grid row">${html}</div>`)); };
  if (recAlbums.length) section('Jump back in', recAlbums.slice(0, 14).map(albumCard).join(''));
  const playlists = lib.db.rootNodes.map((id) => lib.node(id)).filter(Boolean);
  if (playlists.length) section('Your library', playlists.slice(0, 14).map(nodeCard).join(''), 'library');
  const recentAdded = [...lib.idx.albums.values()].map((al) => [Math.max(...al.tracks.map((i) => T(i).added || 0)), al]).sort((a, b) => b[0] - a[0]).slice(0, 14).map((x) => x[1]);
  section('Recently added', recentAdded.map(albumCard).join(''), 'albums');
  const most = Object.entries(lib.db.plays).filter(([id]) => T(id)).sort((a, b) => b[1] - a[1]).slice(0, 50);
  if (most.length >= 3) {
    const artistsCount = new Map(); for (const [id, c] of most) { const ar = lib.idx.artists.get(norm(primaryArtist(T(id).artist))); if (ar) artistsCount.set(ar, (artistsCount.get(ar) || 0) + c); }
    section('Your top artists', [...artistsCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map((e, i) => artistCard(e[0], i)).join(''), 'artists');
    el.appendChild(h(`<div class="sec"><h2>On repeat</h2><a data-go="mostplayed">Show all</a></div>`));
    el.appendChild(trackList(most.slice(0, 10).map((m) => m[0]), { source: { type: 'mostplayed', label: 'On repeat' }, album: true }));
  }
  const genres = [...lib.idx.genres.values()].sort((a, b) => b.tracks.length - a.tracks.length).slice(0, 18);
  if (genres.length > 2) { el.appendChild(h(`<div class="sec"><h2>Moods & genres</h2></div>`)); el.appendChild(h(`<div class="chips">${genres.map((g) => `<a class="chip" data-genre="${esc(g.key)}">${esc(g.name)}</a>`).join('')}</div>`)); }
  wireCards(el);
  el.addEventListener('click', (e) => { const g = e.target.closest('[data-genre]'); if (g) go('genre', { key: g.dataset.genre }); const a = e.target.closest('.sec a[data-go]'); if (a) go(a.dataset.go); });
  return el;
};

// =====================================================================
// SONGS
// =====================================================================
const sorters = {
  title: (a, b) => sortKey(a.title).localeCompare(sortKey(b.title)),
  artist: (a, b) => sortKey(a.artist).localeCompare(sortKey(b.artist)) || sortKey(a.album).localeCompare(sortKey(b.album)) || (a.track - b.track),
  album: (a, b) => sortKey(a.album).localeCompare(sortKey(b.album)) || (a.disc - b.disc) || (a.track - b.track),
  added: (a, b) => a.added - b.added || sortKey(a.title).localeCompare(sortKey(b.title)),
  duration: (a, b) => a.duration - b.duration,
  plays: (a, b) => (lib.db.plays[a.id] || 0) - (lib.db.plays[b.id] || 0),
  year: (a, b) => (a.year || 0) - (b.year || 0),
  track: (a, b) => (a.track || 0) - (b.track || 0)
};
function sortIds(ids, s) { const f = sorters[s.k] || sorters.added; return ids.map(T).filter(Boolean).sort((a, b) => f(a, b) * s.d).map((t) => t.id); }
function filterBox(onInput, value = '') {
  const el = h(`<label class="filter ${value ? 'open' : ''}" title="Filter">${ico('search')}<input placeholder="Filter" value="${esc(value)}"></label>`);
  const inp = el.querySelector('input'); inp.addEventListener('input', debounce(() => onInput(inp.value), 120));
  el.addEventListener('click', () => { el.classList.add('open'); inp.focus(); }); inp.addEventListener('blur', () => { if (!inp.value) el.classList.remove('open'); });
  return el;
}
function sortMenuBtn(cur, keys, onPick) {
  const b = h(`<button class="pill">${ico('sort')}<span>${keys.find((k) => k[0] === cur.k)?.[1] || 'Sort'}</span></button>`);
  b.onclick = () => menu([{ header: 'Sort by' }, ...keys.map(([k, l]) => ({ label: l, checked: cur.k === k, action: () => onPick({ k, d: cur.k === k ? -cur.d : (k === 'added' || k === 'plays' ? -1 : 1) }) }))], { el: b, right: true });
  return b;
}
function listPage({ title, ids, source, sortKeyName, kind, hero, extraActions, playlistId, reorder, addedAt, numbers, album = true, emptyHTML }) {
  const el = h('<div></div>');
  const S = app.S; let sort = sortKeyName ? (S[sortKeyName] || { k: 'added', d: -1 }) : null;
  let q = '';
  if (hero) el.appendChild(hero);
  else el.appendChild(h(`<div class="page" style="padding-bottom:0"><div class="page-h"><h1>${esc(title)}</h1><span style="color:var(--tx3)">${plural(ids.length, 'song')} • ${fmtLong(sumDur(ids))}</span></div></div>`));
  const acts = actionsEl(ids, source, title, extraActions || '');
  el.appendChild(acts);
  const holder = h('<div></div>'); el.appendChild(holder);
  const draw = () => {
    let list = sort ? sortIds(ids, sort) : ids;
    if (q) { const toks = norm(q).split(/\s+/); list = list.filter((id) => toks.every((t) => lib.idx.search.get(id)?.includes(t))); }
    holder.innerHTML = '';
    holder.appendChild(trackList(list, { source: { ...source, sorted: true }, sort, onSort: sort ? (k) => { if (!k) return; sort = { k, d: sort.k === k ? -sort.d : 1 }; S[sortKeyName] = sort; app.saveS(); draw(); } : null, playlistId, reorder: reorder && !q, added: !!addedAt || sort?.k === 'added', addedAt, numbers, album, emptyHTML }));
  };
  const grow = acts.querySelector('.grow');
  grow.after(filterBox((v) => { q = v; draw(); }));
  if (sort) acts.appendChild(sortMenuBtn(sort, [['added', 'Recently added'], ['title', 'Title'], ['artist', 'Artist'], ['album', 'Album'], ['year', 'Year'], ['duration', 'Duration'], ['plays', 'Most played']], (s) => { sort = s; S[sortKeyName] = s; app.saveS(); draw(); acts.querySelector('.pill span').textContent = { added: 'Recently added', title: 'Title', artist: 'Artist', album: 'Album', year: 'Year', duration: 'Duration', plays: 'Most played' }[s.k]; }));
  draw();
  return el;
}
R.songs = () => {
  const ids = Object.keys(lib.db.tracks);
  if (!ids.length) { const p = h('<div class="page"></div>'); p.appendChild(emptyLibrary()); return p; }
  return listPage({ title: 'Songs', ids, source: { type: 'songs', label: 'All songs' }, sortKeyName: 'songsSort' });
};
R.liked = () => {
  const ids = likedIds();
  return listPage({ title: 'Liked Songs', ids, source: { type: 'liked', label: 'Liked Songs' }, addedAt: (id) => lib.db.liked[id], hero: heroEl({ kind: 'Playlist', title: 'Liked Songs', art: `<div class="sw liked" style="width:100%;height:100%;border-radius:0">${ico('heart-f').replace('<svg>', '<svg style="width:40%;height:40%">')}</div>`, stats: `${plural(ids.length, 'song')} • ${fmtLong(sumDur(ids))}`, color: '#5b3fd8' }), emptyHTML: '<h3>Songs you like will appear here</h3><p>Tap the heart on any song.</p>' });
};
R.recent = () => { const ids = lib.db.history.filter(T); return listPage({ title: 'Recently Played', ids, source: { type: 'recent', label: 'Recently played' }, addedAt: (id) => lib.db.last[id], hero: heroEl({ kind: 'History', title: 'Recently Played', art: `<div class="sw recent" style="width:100%;height:100%;border-radius:0">${ico('clock').replace('<svg>', '<svg style="width:40%;height:40%">')}</div>`, stats: plural(ids.length, 'song'), color: '#0f766e' }) }); };
R.mostplayed = () => { const ids = Object.entries(lib.db.plays).filter(([id]) => T(id)).sort((a, b) => b[1] - a[1]).slice(0, 200).map((e) => e[0]); return listPage({ title: 'On Repeat', ids, source: { type: 'mostplayed', label: 'On repeat' } }); };

// =====================================================================
// ALBUMS / ARTISTS / GENRES
// =====================================================================
function gridPage(title, items, card, sortOpts, onSortKey) {
  const el = h(`<div class="page"><div class="page-h"><h1>${esc(title)}</h1></div></div>`);
  const head = el.querySelector('.page-h');
  let q = ''; const grid = h('<div class="grid"></div>');
  const draw = () => { const list = q ? items.filter((x) => norm(x.name + ' ' + (x.artist || '')).includes(norm(q))) : items; grid.innerHTML = list.slice(0, 3000).map(card).join(''); hydrate(grid); };
  head.appendChild(filterBox((v) => { q = v; draw(); }));
  if (sortOpts) { const b = h(`<button class="pill">${ico('sort')}<span>${sortOpts.find((s) => s[0] === app.S[onSortKey])?.[1] || 'Sort'}</span></button>`); b.onclick = () => menu(sortOpts.map(([k, l]) => ({ label: l, checked: app.S[onSortKey] === k, action: () => { app.S[onSortKey] = k; app.saveS(); refresh(); } })), { el: b, right: true }); head.appendChild(b); }
  const sz = h(`<button class="ib" title="Card size">${ico('grid')}</button>`); sz.onclick = () => { const sizes = [132, 172, 220]; app.S.gridSize = sizes[(sizes.indexOf(app.S.gridSize) + 1) % sizes.length]; app.saveS(); applyTheme(); }; head.appendChild(sz);
  el.appendChild(grid); draw(); wireCards(el);
  return el;
}
R.albums = () => {
  const k = app.S.albumSort; let list = [...lib.idx.albums.values()];
  const f = { name: (a, b) => sortKey(a.name).localeCompare(sortKey(b.name)), artist: (a, b) => sortKey(a.artist).localeCompare(sortKey(b.artist)) || b.year - a.year, year: (a, b) => (b.year || 0) - (a.year || 0), added: (a, b) => Math.max(...b.tracks.map((i) => T(i).added)) - Math.max(...a.tracks.map((i) => T(i).added)) }[k] || ((a, b) => sortKey(a.name).localeCompare(sortKey(b.name)));
  list.sort(f);
  return gridPage('Albums', list, albumCard, [['name', 'Name'], ['artist', 'Artist'], ['year', 'Year'], ['added', 'Recently added']], 'albumSort');
};
R.artists = () => gridPage('Artists', [...lib.idx.artists.values()].sort((a, b) => sortKey(a.name).localeCompare(sortKey(b.name))), artistCard);
R.album = ({ key }) => {
  const al = lib.idx.albums.get(key); if (!al) return h('<div class="page"><div class="empty"><h3>Album not found</h3></div></div>');
  const color = lib.db.covers[al.cover]?.color;
  const discs = new Set(al.tracks.map((i) => T(i).disc || 1)).size;
  const hero = heroEl({ kind: 'Album', title: al.name, art: al.cover ? coverImg(al.cover, false) : ico('album'), color, stats: `<a data-artist="${esc(norm(al.artist))}"><b>${esc(al.artist)}</b></a>${al.year ? ' • ' + al.year : ''} • ${plural(al.tracks.length, 'song')}${discs > 1 ? ` (${discs} discs)` : ''}, ${fmtLong(sumDur(al.tracks))}` });
  hero.addEventListener('click', (e) => { const a = e.target.closest('[data-artist]'); if (a) go('artist', { key: a.dataset.artist }); });
  const el = listPage({ title: al.name, ids: al.tracks, source: { type: 'album', id: key, label: al.name }, hero, numbers: 'track', album: false });
  const more = h(`<button class="ib" title="More">${ico('more')}</button>`); more.onclick = () => menu([{ label: 'Add to queue', icon: 'plus', action: () => player.addToQueue(al.tracks) }, { label: 'Add to playlist', icon: 'playlist', sub: () => playlistPicker(al.tracks) }, { label: 'Go to artist', icon: 'artist', action: () => go('artist', { key: norm(al.artist) }) }], { el: more });
  el.querySelector('.actions [data-a=shuffle]').after(more);
  // more by artist
  const ar = lib.idx.artists.get(norm(al.artist));
  if (ar && ar.albums.size > 1) { const p = h(`<div class="page" style="padding-top:0"><div class="sec"><h2>More by ${esc(ar.name)}</h2></div><div class="grid row">${[...ar.albums].filter((k) => k !== key).map((k) => lib.idx.albums.get(k)).filter(Boolean).map(albumCard).join('')}</div></div>`); wireCards(p); el.appendChild(p); }
  return el;
};
R.artist = ({ key }) => {
  const ar = lib.idx.artists.get(key); if (!ar) return h('<div class="page"><div class="empty"><h3>Artist not found</h3></div></div>');
  const top = [...ar.tracks].sort((a, b) => (lib.db.plays[b] || 0) - (lib.db.plays[a] || 0));
  const hero = heroEl({ kind: 'Artist', title: ar.name, art: ar.cover ? coverImg(ar.cover, false) : ico('artist'), round: true, color: lib.db.covers[ar.cover]?.color, stats: `${plural(ar.tracks.length, 'song')} • ${plural(ar.albums.size, 'album')} • ${fmtLong(sumDur(ar.tracks))}` });
  const el = h('<div></div>'); el.appendChild(hero);
  const src = { type: 'artist', id: key, label: ar.name };
  el.appendChild(actionsEl(top, src, ar.name));
  const p = h('<div class="page" style="padding-top:0"></div>');
  p.appendChild(h('<div class="sec" style="margin-top:0"><h2>Popular</h2></div>'));
  el.appendChild(p);
  el.appendChild(trackList(top.slice(0, 10), { source: src }));
  const albums = [...ar.albums].map((k) => lib.idx.albums.get(k)).filter(Boolean).sort((a, b) => (b.year || 0) - (a.year || 0));
  const p2 = h(`<div class="page" style="padding-top:0"><div class="sec"><h2>Discography</h2></div><div class="grid">${albums.map(albumCard).join('')}</div>${top.length > 10 ? '<div class="sec"><h2>All songs</h2></div>' : ''}</div>`);
  wireCards(p2); el.appendChild(p2);
  if (top.length > 10) el.appendChild(trackList(sortIds(ar.tracks, { k: 'album', d: 1 }), { source: src }));
  return el;
};
R.genre = ({ key }) => { const g = lib.idx.genres.get(key); if (!g) return h('<div class="page"></div>'); return listPage({ title: g.name, ids: g.tracks, source: { type: 'genre', id: key, label: g.name }, sortKeyName: 'songsSort' }); };

// =====================================================================
// FOLDERS (on-disk structure, unlimited depth)
// =====================================================================
R.folders = ({ key = '' }) => {
  const f = lib.folderNode(key);
  if (!f) return R.folders({});
  if (!key && f.children.size === 1) { const only = [...f.children.values()][0]; if (only.children.size || only.tracks.length) return R.folders({ key: only.key }); }
  const all = lib.folderAllTracks(f);
  const segs = key.split('/').filter(Boolean);
  const crumbs = `<div class="crumbs"><a data-fold="">Folders</a>${segs.map((s, i) => `${ico('fwd')}<a data-fold="/${esc(segs.slice(0, i + 1).join('/'))}">${esc(s)}</a>`).join('')}</div>`;
  const el = h('<div></div>');
  if (!key) {
    el.appendChild(h(`<div class="page" style="padding-bottom:0"><div class="page-h"><h1>Folders</h1></div></div>`));
    if (!lib.db.roots.length) { const p = h('<div class="page"></div>'); p.appendChild(emptyLibrary()); el.appendChild(p); return el; }
  } else {
    const hero = heroEl({ kind: 'Folder', title: f.name, art: f.cover ? coverImg(f.cover, false) : ico('folder'), crumbs, color: lib.db.covers[f.cover]?.color, stats: `${f.children.size ? plural(f.children.size, 'folder') + ' • ' : ''}${plural(all.length, 'song')} • ${fmtLong(sumDur(all))}` });
    el.appendChild(hero);
    const more = `<button class="pill" data-mirror title="Recreate this folder tree as playlists in Your Library">${ico('layers')}Save as playlists</button>`;
    const acts = actionsEl(all, { type: 'folder', id: key, label: f.name }, f.name, more); el.appendChild(acts);
    acts.querySelector('[data-mirror]').onclick = () => { const n = lib.mirrorFolder(key); toast(`Saved "${f.name}" to Your Library`); go('node', { id: n.id }); };
  }
  if (f.children.size) {
    const kids = [...f.children.values()].sort((a, b) => sortKey(a.name).localeCompare(sortKey(b.name)));
    const p = h(`<div class="page" style="padding-top:${key ? 0 : 8}px;padding-bottom:0">${key ? `<div class="sec" style="margin-top:4px"><h2>Folders</h2></div>` : ''}<div class="grid">${kids.map((c, i) => { const n = lib.folderAllTracks(c).length; return cardHTML({ cover: c.cover ? coverImg(c.cover, false) : `<div class="gen-cover" style="--gc:var(--s2)">${ico('folder')}</div>`, title: c.name, sub: `${c.children.size ? plural(c.children.size, 'folder') + ' • ' : ''}${plural(n, 'song')}`, data: `data-fold="${esc(c.key)}"`, i }); }).join('')}</div></div>`);
    wireCards(p); el.appendChild(p);
  }
  if (f.tracks.length) {
    if (f.children.size) el.appendChild(h('<div class="page" style="padding-bottom:0"><div class="sec" style="margin-top:6px"><h2>Songs in this folder</h2></div></div>'));
    el.appendChild(trackList(sortIds(f.tracks, { k: 'track', d: 1 }).sort((a, b) => (T(a).disc - T(b).disc) || (T(a).track - T(b).track) || sortKey(T(a).name).localeCompare(sortKey(T(b).name))), { source: { type: 'folder', id: key, label: f.name } }));
  }
  el.addEventListener('click', (e) => { const c = e.target.closest('.crumbs [data-fold]'); if (c) go('folders', { key: c.dataset.fold }); });
  return el;
};

// =====================================================================
// LIBRARY (tiered playlists & folders)
// =====================================================================
R.library = ({ tab = 'all' }) => {
  const el = h(`<div class="page"><div class="page-h"><h1>Your Library</h1><button class="ib" data-new title="Create">${ico('plus')}</button></div></div>`);
  el.querySelector('[data-new]').onclick = (e) => createMenu({ el: e.currentTarget, right: true });
  const tabs = [['all', 'Playlists'], ['songs', 'Songs'], ['albums', 'Albums'], ['artists', 'Artists'], ['folders', 'Folders'], ['liked', 'Liked']];
  const chips = h(`<div class="chips lib-tabs">${tabs.map(([k, l]) => `<a class="chip ${k === tab ? 'on' : ''}" data-t="${k}">${l}</a>`).join('')}</div>`);
  chips.addEventListener('click', (e) => { const c = e.target.closest('[data-t]'); if (!c) return; const t = c.dataset.t; if (t === 'all') return; go(t); });
  el.appendChild(chips);
  const tools = h('<div id="libPageTools" class="lib-tools"></div>'); tools.appendChild(libToolsEl()); el.appendChild(tools);
  const box = h('<div id="libPageTree"></div>'); box.appendChild(treeEl(null, true)); el.appendChild(box);
  if (!lib.db.rootNodes.length) el.appendChild(h(`<div class="empty" style="padding:30px 10px"><p>Make playlists and nest them in folders — as many levels deep as you like. Drag to reorganize.</p></div>`));
  return el;
};
export function createMenu(at, parent = null) {
  menu([
    { label: 'New playlist', icon: 'playlist', action: async () => { const n = await prompt('New playlist', '', 'My playlist'); if (n) { const x = lib.createNode('playlist', n, parent); go('node', { id: x.id }); } } },
    { label: 'New folder', icon: 'folder', action: async () => { const n = await prompt('New folder', '', 'Folder name'); if (n) lib.createNode('folder', n, parent); } },
    !parent && '-',
    !parent && { label: 'Import from Spotify', icon: 'spark', action: () => import('./spotify.js').then((m) => m.openSpotifyImport()) },
    !parent && { label: 'Import M3U playlist', icon: 'import', action: importM3U },
    !parent && app.isDesktop && { label: 'Add music folder', icon: 'plus', action: addFolder },
    !parent && !app.isDesktop && { label: 'Import songs', icon: 'note', action: () => importMusic(false) },
    !parent && !app.isDesktop && { label: 'Import a folder', icon: 'folder', action: () => importMusic(true) }
  ], at);
}
function importM3U() {
  const i = document.createElement('input'); i.type = 'file'; i.accept = '.m3u,.m3u8,audio/x-mpegurl';
  i.onchange = async () => { const f = i.files[0]; if (!f) return; const n = lib.importM3U(await f.text(), f.name.replace(/\.m3u8?$/i, '')); toast(`Imported ${plural(n.tracks.length, 'song')}`); go('node', { id: n.id }); };
  i.click();
}

// Tree (used by sidebar and mobile library). Unlimited depth, drag to nest/reorder.
const openState = new Set(JSON.parse(localStorage.getItem('pulse.open') || '[]'));
const saveOpen = () => localStorage.setItem('pulse.open', JSON.stringify([...openState]));
// Library ordering: pinned first, then the chosen sort (custom = your drag order)
export const LIB_SORTS = [['recent', 'Recents'], ['added', 'Recently added'], ['alpha', 'Alphabetical'], ['plays', 'Most played'], ['custom', 'Custom order']];
export const LIB_LAYOUTS = [['compact', 'Compact list', 'v-compact'], ['list', 'List', 'v-list'], ['grid', 'Grid', 'v-grid'], ['big', 'Large grid', 'v-big']];
const layout = () => (document.body.classList.contains('side-mini') ? 'list' : app.S.libLayout || 'list');
let libQuery = '';
export const LIB_VIEWS = [['all', 'Everything'], ['playlists', 'Playlists only'], ['folders', 'Folders only'], ['pinned', 'Pinned']];
function sortNodes(ids) {
  const k = app.S.libSort || 'recent'; const N = (id) => lib.node(id);
  const by = { recent: (a, b) => (N(b).lastPlayed || N(b).updated || N(b).created || 0) - (N(a).lastPlayed || N(a).updated || N(a).created || 0), added: (a, b) => (N(b).created || 0) - (N(a).created || 0), alpha: (a, b) => sortKey(N(a).name).localeCompare(sortKey(N(b).name)), plays: (a, b) => (N(b).plays || 0) - (N(a).plays || 0) }[k];
  const list = ids.filter((id) => N(id));
  const pinned = list.filter((id) => N(id).pinned).sort((a, b) => (N(a).pinned || 0) - (N(b).pinned || 0));
  const rest = list.filter((id) => !N(id).pinned); if (by) rest.sort(by);
  return [...pinned, ...rest];
}
function nodeRow(n, depth) {
  const id = n.id; const ids = n.type === 'playlist' ? n.tracks : null; const isOpen = openState.has(id);
  const compact = layout() === 'compact';
  const cover = compact ? (n.type === 'folder' ? `<span class="cfold">${ico('folder')}</span>` : '') : n.type === 'folder' && !n.cover ? `<span class="sw sw-folder">${ico('folder')}</span>` : `<span class="sw">${collectionCover(n, ids || lib.nodeTracks(id))}</span>`;
  const playingHere = player.source?.type === 'node' && player.source.id === id;
  return h(`<a class="tnode ${isOpen ? 'open' : ''} ${n.type}" data-id="${id}" draggable="true" style="padding-left:${8 + depth * (compact ? 14 : 18)}px">${cover}<span class="t"><b>${esc(n.name)}</b><small>${n.pinned ? `<svg class="pinned"><use href="#i-pin"/></svg>` : ''}${n.type === 'folder' ? `Folder • ${plural(n.children.length, 'item')}` : `Playlist • ${plural(n.tracks.length, 'song')}`}</small></span>${playingHere ? `<span class="eq-mini ${player.playing ? '' : 'paused'}"><i></i><i></i><i></i></span>` : ''}${n.type === 'folder' ? `<span class="caret" title="${isOpen ? 'Collapse' : 'Expand'}">${ico('fwd')}</span>` : ''}</a>`);
}
function specialRows() {
  const L = layout(); const lk = likedIds().length;
  const liked = { name: 'Liked Songs', sub: `Playlist • ${plural(lk, 'song')}`, go: 'liked', cls: 'liked', icon: 'heart-f' };
  const rec = { name: 'Recently Played', sub: 'Your history', go: 'recent', cls: 'recent', icon: 'clock' };
  return [liked, rec].map((x) => L === 'grid' || L === 'big'
    ? `<a class="lcard special" data-go="${x.go}"><span class="lc-art sw ${x.cls}">${ico(x.icon)}</span><b>${x.name}</b><small>${x.sub}</small></a>`
    : `<a class="side-item special" data-go="${x.go}"><span class="sw ${x.cls}">${ico(x.icon)}</span><span class="t"><b>${x.name}</b><small ${x.go === 'liked' ? 'class="likedCount"' : ''}>${x.sub}</small></span></a>`).join('');
}
function cardFor(n) {
  const ids = n.type === 'playlist' ? n.tracks : lib.nodeTracks(n.id);
  const art = n.type === 'folder' && !n.cover ? `<span class="lc-art sw sw-folder">${ico('folder')}</span>` : `<span class="lc-art">${collectionCover(n, ids)}</span>`;
  const playingHere = player.source?.type === 'node' && player.source.id === n.id;
  return h(`<a class="tnode lcard ${n.type} ${playingHere ? 'playing' : ''}" data-id="${n.id}" draggable="true">${art}<b>${n.pinned ? `<svg class="pinned"><use href="#i-pin"/></svg>` : ''}${esc(n.name)}</b><small>${n.type === 'folder' ? `Folder • ${plural(n.children.length, 'item')}` : `Playlist • ${plural(n.tracks.length, 'song')}`}</small></a>`);
}
export function treeEl(parent = null, big = false) {
  const L = layout(); const grid = L === 'grid' || L === 'big';
  const wrap = h(`<div class="tree-level ${parent === null ? `lay-${L}` : ''}"></div>`);
  const view = app.S.libView || 'all'; const q = parent === null ? libQuery.trim().toLowerCase() : '';
  const add = (n, depth) => wrap.appendChild(grid ? cardFor(n) : nodeRow(n, depth));
  if (parent === null && !q && view === 'all') wrap.insertAdjacentHTML('beforeend', specialRows());
  if (parent === null && (q || grid || view === 'playlists' || view === 'pinned')) {
    // flat: searching, grid layouts, or a filter across every folder level (grid keeps folders as cards you open)
    let all = Object.values(lib.db.nodes).filter((n) => {
      if (q) return n.name.toLowerCase().includes(q);
      if (view === 'pinned') return n.pinned; if (view === 'playlists') return n.type === 'playlist'; if (view === 'folders') return n.type === 'folder' && !n.parent;
      return !n.parent;
    }).map((n) => n.id);
    for (const id of sortNodes(all)) add(lib.node(id), 0);
    if (!all.length) wrap.appendChild(h(`<div class="tree-empty">${q ? `Nothing called “${esc(q)}”` : view === 'pinned' ? 'Pin playlists or folders from their ⋯ menu to keep them here.' : 'No playlists yet.'}</div>`));
  } else {
    for (const id of sortNodes(lib.children(parent))) {
      const n = lib.node(id); if (!n) continue;
      if (view === 'folders' && n.type !== 'folder') continue;
      const depth = lib.nodePath(id).length - 1;
      wrap.appendChild(nodeRow(n, depth));
      if (n.type === 'folder' && openState.has(id)) { const kids = treeEl(id, big); kids.classList.add('tchildren'); kids.style.setProperty('--line-x', 8 + depth * (L === 'compact' ? 14 : 18) + (L === 'compact' ? 10 : 23) + 'px'); wrap.appendChild(kids); }
    }
  }
  if (parent === null) { wireTree(wrap); wrap.addEventListener('click', (e) => { const a = e.target.closest('.special[data-go]'); if (a) go(a.dataset.go); }); }
  hydrate(wrap);
  return wrap;
}
// Search + "Recents ≡" bar above the library (sidebar and Library page)
export function libToolsEl() {
  const cur = LIB_SORTS.find((x) => x[0] === (app.S.libSort || 'recent')) || LIB_SORTS[0];
  const lay = LIB_LAYOUTS.find((x) => x[0] === (app.S.libLayout || 'list')) || LIB_LAYOUTS[1];
  const el = h(`<div class="lt ${libQuery ? 'searching' : ''}"><button class="ib sm lt-s" title="Search in Your Library">${ico('search')}</button><input class="lt-q" placeholder="Search in Your Library" value="${esc(libQuery)}"><button class="lt-sort" title="Sort and view">${esc(cur[1])}${ico(lay[2])}</button></div>`);
  const inp = el.querySelector('.lt-q');
  el.querySelector('.lt-s').onclick = () => { el.classList.add('searching'); inp.focus(); };
  inp.addEventListener('input', debounce(() => { libQuery = inp.value; rerenderTrees(true); }, 120));
  inp.addEventListener('blur', () => { if (!inp.value) el.classList.remove('searching'); });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Escape') { inp.value = ''; libQuery = ''; inp.blur(); rerenderTrees(true); } });
  el.querySelector('.lt-sort').onclick = (e) => libSortMenu({ el: e.currentTarget, right: true });
  return el;
}
export function libSortMenu(at) {
  const viewRow = () => { const r = h(`<div class="m-views">${LIB_LAYOUTS.map(([k, l, i]) => `<button class="${(app.S.libLayout || 'list') === k ? 'on' : ''}" data-l="${k}" title="${l}">${ico(i)}</button>`).join('')}</div>`); r.onclick = (e) => { const b = e.target.closest('[data-l]'); if (!b) return; app.S.libLayout = b.dataset.l; app.saveS(); $$('button', r).forEach((x) => x.classList.toggle('on', x === b)); rerenderTrees(); }; return r; };
  menu([{ header: 'Sort by' }, ...LIB_SORTS.map(([k, l]) => ({ label: l, checked: (app.S.libSort || 'recent') === k, action: () => { app.S.libSort = k; app.saveS(); rerenderTrees(); } })),
    '-', { header: 'Show' }, ...LIB_VIEWS.map(([k, l]) => ({ label: l, checked: (app.S.libView || 'all') === k, action: () => { app.S.libView = k; app.saveS(); rerenderTrees(); } })),
    '-', { header: 'View as' }, { el: viewRow }], at);
}
function wireTree(root) {
  root.addEventListener('click', (e) => {
    const row = e.target.closest('.tnode'); if (!row) return; const id = row.dataset.id; const n = lib.node(id);
    if ((e.target.closest('.caret') || (e.detail === 2 && false)) && n.type === 'folder') { e.preventDefault(); openState.has(id) ? openState.delete(id) : openState.add(id); saveOpen(); rerenderTrees(); return; }
    go('node', { id });
  });
  root.addEventListener('contextmenu', (e) => { const row = e.target.closest('.tnode'); if (!row) return; e.preventDefault(); nodeMenu(row.dataset.id, { x: e.clientX, y: e.clientY }); });
  longPress(root, (e) => { const row = e.target.closest('.tnode'); if (row) nodeMenu(row.dataset.id, { x: 0, y: 0 }); });
  let over = null, zone = null;
  const clear = () => { if (over) over.classList.remove('drop-in', 'drop-above', 'drop-below'); over = null; zone = null; };
  root.addEventListener('dragstart', (e) => { const row = e.target.closest('.tnode'); if (!row) return; e.dataTransfer.setData('application/x-pulse-node', row.dataset.id); e.dataTransfer.effectAllowed = 'move'; row.classList.add('dragging'); });
  root.addEventListener('dragend', (e) => { e.target.closest?.('.tnode')?.classList.remove('dragging'); clear(); });
  root.addEventListener('dragover', (e) => {
    const row = e.target.closest('.tnode'); const types = e.dataTransfer.types;
    if (!row) return; const n = lib.node(row.dataset.id);
    if (types.includes('application/x-pulse-tracks')) { if (n.type !== 'playlist') { clear(); return; } e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (over !== row) { clear(); over = row; } zone = 'in'; row.classList.add('drop-in'); return; }
    if (!types.includes('application/x-pulse-node')) return;
    e.preventDefault(); if (over !== row) clear(); over = row;
    const b = row.getBoundingClientRect(); const y = (e.clientY - b.top) / b.height;
    zone = n.type === 'folder' && y > 0.28 && y < 0.72 ? 'in' : y < 0.5 ? 'above' : 'below';
    row.classList.toggle('drop-in', zone === 'in'); row.classList.toggle('drop-above', zone === 'above'); row.classList.toggle('drop-below', zone === 'below');
    if (zone === 'in' && n.type === 'folder' && !openState.has(n.id)) { clearTimeout(row._t); row._t = setTimeout(() => { if (over === row && zone === 'in') { openState.add(n.id); saveOpen(); rerenderTrees(); } }, 700); }
  });
  root.addEventListener('drop', (e) => {
    if (!over) return; e.preventDefault(); const target = lib.node(over.dataset.id);
    const tracks = e.dataTransfer.getData('application/x-pulse-tracks');
    if (tracks && target.type === 'playlist') { const c = lib.addToPlaylist(target.id, JSON.parse(tracks)); toast(c ? `Added to ${target.name}` : 'Already in ' + target.name); clear(); rerenderTrees(); return; }
    const id = e.dataTransfer.getData('application/x-pulse-node'); if (!id || id === target.id) { clear(); return; }
    let ok;
    if (zone === 'in') { ok = lib.moveNode(id, target.id); openState.add(target.id); saveOpen(); }
    else { const sib = lib.children(target.parent).filter((x) => x !== id); let idx = sib.indexOf(target.id) + (zone === 'below' ? 1 : 0); ok = lib.moveNode(id, target.parent, idx); }
    if (!ok) toast("Can't move a folder inside itself");
    clear(); rerenderTrees();
  });
}
export function rerenderTrees(typing) {
  const t = $('#tree'); if (t) { const st = t.parentElement.scrollTop; t.innerHTML = ''; t.appendChild(treeEl(null)); t.parentElement.scrollTop = st; }
  const st = $('#sideTools'); if (st && !typing) { st.innerHTML = ''; st.appendChild(libToolsEl()); }
  const lt = $('#libPageTree'); if (lt) { lt.innerHTML = ''; lt.appendChild(treeEl(null, true)); const bar = $('#libPageTools'); if (bar && !typing) { bar.innerHTML = ''; bar.appendChild(libToolsEl()); } }
  $$('.likedCount').forEach((lc) => (lc.textContent = `Playlist • ${plural(likedIds().length, 'song')}`));
  import('./core.js').then((c) => c.markNav());
}
export function nodeMenu(id, at) {
  const n = lib.node(id); if (!n) return; const ids = lib.nodeTracks(id);
  const items = [
    ids.length && { label: 'Play', icon: 'play', action: () => player.playList(ids, 0, { type: 'node', id, label: n.name }) },
    ids.length && { label: 'Shuffle play', icon: 'shuffle', action: () => player.playList(ids, 0, { type: 'node', id, label: n.name }, { shuffle: true, randomStart: true }) },
    ids.length && { label: 'Add to queue', icon: 'queue', action: () => { player.addToQueue(ids); toast('Added to queue'); } },
    ids.length && '-',
    n.type === 'folder' && { label: 'New playlist inside', icon: 'playlist', action: async () => { const nm = await prompt('New playlist', '', 'Playlist name'); if (nm) { lib.createNode('playlist', nm, id); openState.add(id); saveOpen(); rerenderTrees(); } } },
    n.type === 'folder' && { label: 'New folder inside', icon: 'folder', action: async () => { const nm = await prompt('New folder', '', 'Folder name'); if (nm) { lib.createNode('folder', nm, id); openState.add(id); saveOpen(); rerenderTrees(); } } },
    { label: 'Edit details', icon: 'edit', action: () => editNode(id) },
    { label: n.pinned ? 'Unpin' : 'Pin to top', icon: 'pin', action: () => { n.pinned = n.pinned ? 0 : Date.now(); lib.save(); lib.emit('nodes'); rerenderTrees(); toast(n.pinned ? 'Pinned to the top' : 'Unpinned'); } },
    { label: n.type === 'folder' ? 'Move folder to' : 'Move to folder', icon: 'folder', sub: () => moveTargets(id) },
    { label: 'Rename', icon: 'edit', action: async () => { const nm = await prompt('Rename', n.name); if (nm) { lib.renameNode(id, nm); rerenderTrees(); if (app.view === 'node') refresh(); } } },
    n.spotify && { label: 'Spotify matches & missing songs', icon: 'spark', action: () => import('./spotify.js').then((m) => m.openSpotifyReview(id)) },
    n.type === 'playlist' && { label: 'Generate AI cover prompt', icon: 'spark', action: () => aiPromptModal(id) },
    n.type === 'playlist' && { label: 'Export as M3U', icon: 'export', action: () => { const blob = new Blob([lib.exportM3U(id)], { type: 'audio/x-mpegurl' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = n.name + '.m3u'; a.click(); } },
    n.type === 'playlist' && { label: 'Duplicate', icon: 'copy', action: () => { lib.createNode('playlist', n.name + ' copy', n.parent, { tracks: [...n.tracks], desc: n.desc }); rerenderTrees(); } },
    '-',
    { label: 'Delete', icon: 'trash', danger: true, action: async () => { if (await confirmBox(`Delete ${n.type}?`, n.type === 'folder' ? `"${n.name}" and everything inside it will be deleted. Your song files are not touched.` : `"${n.name}" will be deleted. Your song files are not touched.`)) { lib.deleteNode(id); rerenderTrees(); if (app.view === 'node' && app.params.id === id) go('library', {}, { replace: true }); } } }
  ];
  menu(items, at);
}
function moveTargets(id) {
  const items = [{ label: 'New folder…', icon: 'plus', action: async () => { const nm = await prompt('New folder', '', 'Folder name'); if (!nm) return; const cur = lib.node(id); const f = lib.createNode('folder', nm, cur.parent || null); lib.moveNode(id, f.id); openState.add(f.id); saveOpen(); rerenderTrees(); toast(`Moved into “${nm}”`); } }, { label: 'Top level', icon: 'library', action: () => { lib.moveNode(id, null); rerenderTrees(); } }, '-'];
  const walk = (list, d) => { for (const x of list) { const n = lib.node(x); if (!n || n.type !== 'folder' || x === id || lib.isAncestor(id, x)) continue; items.push({ label: n.name, icon: 'folder', indent: d, action: () => { lib.moveNode(id, x); openState.add(x); saveOpen(); rerenderTrees(); } }); walk(n.children, d + 1); } };
  walk(lib.db.rootNodes, 0);
  return items;
}

R.node = ({ id }) => {
  const n = lib.node(id); if (!n) return h('<div class="page"><div class="empty"><h3>This playlist was deleted</h3></div></div>');
  const ids = lib.nodeTracks(id);
  const path = lib.nodePath(id);
  const crumbs = path.length > 1 ? `<div class="crumbs"><a data-lib>Library</a>${path.slice(0, -1).map((p) => `${ico('fwd')}<a data-node-link="${p.id}">${esc(p.name)}</a>`).join('')}</div>` : '';
  const color = n.cover ? lib.db.covers[n.cover]?.color : (ids[0] && lib.db.covers[T(ids[0])?.cover]?.color);
  const hero = heroEl({ kind: n.type === 'folder' ? 'Folder' : 'Playlist', title: n.name, desc: n.desc, crumbs, art: collectionCover(n, ids), color, editable: true, stats: n.type === 'folder' ? `${plural(n.children.length, 'item')} • ${plural(ids.length, 'song')} inside • ${fmtLong(sumDur(ids))}` : `${plural(ids.length, 'song')} • ${fmtLong(sumDur(ids))}` });
  hero.querySelector('.hero-art').onclick = () => editNode(id);
  hero.querySelector('h1').style.cursor = 'pointer'; hero.querySelector('h1').onclick = () => editNode(id);
  hero.addEventListener('click', (e) => { const a = e.target.closest('[data-node-link]'); if (a) go('node', { id: a.dataset.nodeLink }); if (e.target.closest('[data-lib]')) go('library'); });
  const src = { type: 'node', id, label: n.name };
  const extra = `<button class="ib" data-more title="More">${ico('more')}</button>${n.type === 'playlist' ? `<button class="ib" data-addsongs title="Add songs">${ico('plus')}</button>` : `<button class="ib" data-newin title="Add inside">${ico('plus')}</button>`}`;
  let el;
  if (n.type === 'playlist') {
    el = listPage({ title: n.name, ids, source: src, hero, playlistId: id, reorder: true, extraActions: extra, addedAt: n.addedAt && Object.keys(n.addedAt).length ? (tid) => n.addedAt[tid] : null, emptyHTML: `<h3>Let's find something for your playlist</h3><p>Drag songs onto it in the sidebar, use "Add to playlist" from any song's menu, or search below.</p>` });
    if (!ids.length) el.appendChild(addSongsPanel(id));
  } else {
    el = h('<div></div>'); el.appendChild(hero); el.appendChild(actionsEl(ids, src, n.name, extra));
    const kids = n.children.map((c) => lib.node(c)).filter(Boolean);
    const p = h(`<div class="page" style="padding-top:0">${kids.length ? `<div class="grid">${kids.map(nodeCard).join('')}</div>` : '<div class="empty" style="padding:30px"><p>This folder is empty. Add playlists or more folders inside — nest as deep as you want.</p></div>'}</div>`);
    wireCards(p); el.appendChild(p);
  }
  const acts = el.querySelector('.actions');
  if (n.spotify) {
    const have = n.spotify.map.filter((x) => x && T(x)).length, total = n.spotify.items.length;
    const bn = h(`<div class="sp-banner"><span class="sp-dot ${have === total ? 'full' : ''}"></span><div><b>From Spotify</b><small>${have} of ${total} songs in your library${have < total ? ` • ${total - have} missing${n.spotify.sync ? ' — filled in automatically when they show up' : ''}` : ' • complete'}</small></div><button class="pill" data-spr>${have < total ? 'See missing' : 'Review matches'}</button></div>`);
    bn.querySelector('[data-spr]').onclick = () => import('./spotify.js').then((m) => m.openSpotifyReview(id));
    acts.after(bn);
  }
  acts.querySelector('[data-more]').onclick = (e) => nodeMenu(id, { el: e.currentTarget });
  acts.querySelector('[data-addsongs]')?.addEventListener('click', () => { const x = el.querySelector('.add-songs'); if (x) x.scrollIntoView({ behavior: 'smooth' }); else { el.appendChild(addSongsPanel(id)); el.lastChild.scrollIntoView({ behavior: 'smooth' }); } });
  acts.querySelector('[data-newin]')?.addEventListener('click', (e) => { createMenu({ el: e.currentTarget }, id); });
  return el;
};
function addSongsPanel(pid) {
  const p = h(`<div class="page add-songs" style="padding-top:10px"><div class="sec" style="margin-top:0"><h2>Find songs to add</h2></div><label class="tb-search" style="max-width:420px;margin-bottom:12px">${ico('search')}<input placeholder="Search your library"></label><div class="res"></div></div>`);
  const res = p.querySelector('.res'); const inp = p.querySelector('input');
  const draw = () => {
    const q = inp.value.trim(); const ids = q ? lib.search(q, 40) : lib.db.history.filter(T).slice(0, 15);
    res.innerHTML = ids.map((id) => { const t = T(id); return `<div class="qrow" data-id="${id}"><div class="th">${t.cover ? coverImg(t.cover, true) : ico('note')}</div><div class="tt"><b>${esc(t.title)}</b><small>${esc(t.artist)} • ${esc(t.album)}</small></div><button class="pill" data-add>Add</button></div>`; }).join('') || '<p style="color:var(--tx3)">No matches</p>';
    hydrate(res);
  };
  inp.addEventListener('input', debounce(draw, 120)); draw();
  res.addEventListener('click', (e) => { const b = e.target.closest('[data-add]'); if (!b) return; const id = b.closest('[data-id]').dataset.id; lib.addToPlaylist(pid, [id]); b.textContent = 'Added'; b.disabled = true; rerenderTrees(); });
  return p;
}
export function editNode(id) {
  const n = lib.node(id); const ids = lib.nodeTracks(id);
  const m = modal(`<h2>Edit details <button class="ib sm" data-close>${ico('x')}</button></h2>
    <div class="edit-grid"><div><div class="edit-cover">${collectionCover(n, ids)}<div class="ov">${ico('image')}<span>Choose photo</span></div></div>
      <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap"><button class="pill" data-ai style="flex:1;justify-content:center">${ico('spark')}AI prompt</button>${n.cover ? `<button class="ib" data-rmcover title="Remove custom cover">${ico('trash')}</button>` : ''}</div></div>
      <div><label class="field"><span>Name</span><input class="inp" id="nm" value="${esc(n.name)}" autofocus></label><label class="field"><span>Description</span><textarea class="inp" id="ds" placeholder="Add an optional description (also used for the AI cover prompt)">${esc(n.desc || '')}</textarea></label></div></div>
    <div class="row"><button class="pill" data-close>Cancel</button><button class="pill solid" id="sv">Save</button></div>`, hydrate);
  m.querySelector('.edit-cover').onclick = async () => { const pic = await pickImage(); if (!pic) return; await lib.setNodeCover(id, pic); toast('Cover updated'); closeLayer(); rerenderTrees(); refresh(); };
  m.querySelector('[data-rmcover]')?.addEventListener('click', async () => { await lib.setNodeCover(id, null); closeLayer(); rerenderTrees(); refresh(); });
  m.querySelector('[data-ai]').onclick = () => { n.desc = m.querySelector('#ds').value.trim(); aiPromptModal(id); };
  m.querySelector('#sv').onclick = () => { n.name = m.querySelector('#nm').value.trim() || n.name; n.desc = m.querySelector('#ds').value.trim(); lib.save(); lib.emit('nodes'); closeLayer(); rerenderTrees(); refresh(); };
}
export function aiPromptModal(id) {
  const n = lib.node(id); let style = 'auto';
  const styles = [['auto', 'Auto'], ['minimal', 'Minimal'], ['abstract', 'Abstract'], ['photo', 'Photo'], ['retro', 'Retro'], ['neon', 'Neon'], ['anime', 'Illustrated']];
  const m = modal(`<h2>AI cover prompt <button class="ib sm" data-close>${ico('x')}</button></h2>
    <p style="opacity:.7;margin:-6px 0 14px;font-size:13.5px">Paste this into ChatGPT, Gemini, Midjourney or any image generator, then import the result as this playlist's cover.</p>
    <div class="seg" style="margin-bottom:12px">${styles.map(([k, l]) => `<button data-st="${k}" class="${k === style ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="prompt-box"><textarea class="inp" id="pr"></textarea><button class="ib" data-copy title="Copy">${ico('copy')}</button></div>
    <div class="row"><button class="pill" data-import>${ico('image')}Import generated image</button><button class="pill solid" data-copy2>${ico('copy')}Copy prompt</button></div>`);
  const ta = m.querySelector('#pr'); const draw = () => { ta.value = lib.aiPrompt(id, style); };
  draw();
  m.querySelector('.seg').onclick = (e) => { const b = e.target.closest('[data-st]'); if (!b) return; style = b.dataset.st; $$('.seg button', m).forEach((x) => x.classList.toggle('on', x === b)); draw(); };
  const cp = () => copyText(ta.value); m.querySelector('[data-copy]').onclick = cp; m.querySelector('[data-copy2]').onclick = cp;
  m.querySelector('[data-import]').onclick = async () => { const pic = await pickImage(); if (!pic) return; await lib.setNodeCover(id, pic); toast('Cover updated'); closeLayer(); rerenderTrees(); if (app.view === 'node') refresh(); };
}

// =====================================================================
// SEARCH
// =====================================================================
R.search = ({ q = '' }) => {
  const el = h('<div class="page"></div>');
  if (app.isMobile) {
    const bar = h(`<div class="mob-search"><label class="tb-search">${ico('search')}<input placeholder="What do you want to hear?" value="${esc(q)}"></label></div>`);
    el.appendChild(bar);
    const inp = bar.querySelector('input'); inp.addEventListener('input', debounce(() => { app.params.q = inp.value; drawRes(inp.value); }, 140));
    if (!q) setTimeout(() => inp.focus(), 300);
  }
  const res = h('<div></div>'); el.appendChild(res);
  const drawRes = (q) => {
    res.innerHTML = ''; if (app.cleanup) { app.cleanup(); app.cleanup = null; }
    q = q.trim();
    if (!q) {
      res.appendChild(h('<div class="page-h" style="margin-top:6px"><h1>Browse</h1></div>'));
      const gs = [...lib.idx.genres.values()].sort((a, b) => b.tracks.length - a.tracks.length).slice(0, 40);
      const cards = gs.map((g, i) => { let hs = 0; for (const c of g.name) hs = (hs * 31 + c.charCodeAt(0)) | 0; const hue = Math.abs(hs) % 360; return `<a class="tile genre-tile" data-genre="${esc(g.key)}" style="--i:${i};background:linear-gradient(135deg,hsl(${hue} 62% 46% / .9),hsl(${(hue + 50) % 360} 70% 28% / .9))"><b>${esc(g.name)}</b></a>`; }).join('');
      res.appendChild(h(`<div class="tiles" style="grid-template-columns:repeat(auto-fill,minmax(${app.isMobile ? 150 : 200}px,1fr))">${cards || '<p style="color:var(--tx3);grid-column:1/-1;margin:0">Genres from your songs\' tags will show up here once you add music.</p>'}</div>`));
      res.onclick = (e) => { const g = e.target.closest('[data-genre]'); if (g) go('genre', { key: g.dataset.genre }); };
      return;
    }
    const ids = lib.search(q, 500); const nq = norm(q);
    const albums = [...lib.idx.albums.values()].filter((a) => norm(a.name + ' ' + a.artist).includes(nq)).slice(0, 14);
    const artists = [...lib.idx.artists.values()].filter((a) => norm(a.name).includes(nq)).sort((a, b) => b.tracks.length - a.tracks.length).slice(0, 14);
    const nodes = Object.values(lib.db.nodes).filter((n) => norm(n.name).includes(nq)).slice(0, 14);
    if (!ids.length && !albums.length && !artists.length && !nodes.length) { res.appendChild(h(`<div class="empty"><h3>No results for "${esc(q)}"</h3><p>Check the spelling, or try fewer words.</p></div>`)); return; }
    if (artists[0] && norm(artists[0].name) === nq) { res.appendChild(h('<div class="sec" style="margin-top:4px"><h2>Top result</h2></div>')); const g = h(`<div class="grid" style="--card:200px">${artistCard(artists[0], 0)}</div>`); wireCards(g); res.appendChild(g); }
    if (ids.length) { res.appendChild(h(`<div class="sec" style="margin-top:4px"><h2>Songs</h2><small style="color:var(--tx3)">${plural(ids.length, 'result')}</small></div>`)); const tl = trackList(ids, { source: { type: 'search', id: q, label: `Search: ${q}` } }); tl.style.margin = '0 -18px'; res.appendChild(tl); }
    const sec = (t, html) => { if (!html) return; const p = h(`<div><div class="sec"><h2>${t}</h2></div><div class="grid row">${html}</div></div>`); wireCards(p); res.appendChild(p); };
    sec('Artists', artists.map(artistCard).join('')); sec('Albums', albums.map(albumCard).join('')); sec('Playlists & folders', nodes.map(nodeCard).join(''));
    hydrate(res);
  };
  drawRes(q);
  return el;
};

// =====================================================================
// SETTINGS
// =====================================================================
const tog = (k, on) => `<div class="tog ${on ? 'on' : ''}" data-tog="${k}"></div>`;
const opt = (title, desc, right) => `<div class="opt"><div class="l"><b>${title}</b>${desc ? `<small>${desc}</small>` : ''}</div><div class="r">${right}</div></div>`;
const ACCENTS = ['#7c5cff', '#3b82f6', '#22d3ee', '#14d8b0', '#1ed760', '#a3e635', '#ffd23f', '#ff7a1a', '#ff3d6e', '#f2558f', '#c084fc', '#e8e8ec'];
const fmtVal = (f, v) => f === 'px' ? Math.round(v) + 'px' : f === 's' ? (v ? v + 's' : 'Off') : Math.round(v * 100) + '%';
const THEME_KEYS = ['theme', 'accentMode', 'accent', 'accent2', 'bgMode', 'blur', 'glass', 'radius', 'font', 'glow'];
R.settings = () => {
  const S = app.S; const el = h('<div class="page settings"></div>');
  el.appendChild(h(`<div class="page-h"><h1>Settings</h1></div>`));
  // Library
  const roots = lib.db.roots;
  const total = Object.keys(lib.db.tracks).length;
  let libHTML = `<h3>Library</h3><div class="set-group">`;
  if (app.isDesktop) {
    libHTML += roots.filter((r) => r.path).map((r) => `<div class="root-row"><span class="sw">${ico('folder')}</span><div class="p"><b>${esc(r.name)}</b><small>${esc(r.path)} • ${plural(Object.values(lib.db.tracks).filter((t) => t.root === r.id).length, 'song')}</small></div><button class="ib" data-rescan="${r.id}" title="Rescan">${ico('refresh')}</button><button class="ib" data-rmroot="${r.id}" title="Remove from library">${ico('x')}</button></div>`).join('');
    libHTML += `<div class="root-row"><button class="pill solid" data-addroot>${ico('plus')}Add music folder</button><button class="pill" data-rescanall>${ico('refresh')}Rescan all</button></div>`;
    libHTML += opt('Import from Spotify', 'Rebuild your Spotify playlists from songs you already have (via Exportify)', `<button class="pill" data-spimp>${ico('spark')}Start</button>`);
    libHTML += opt('Watch folders for changes', 'New or deleted files show up automatically', tog('watch', S.watch));
    libHTML += opt('Quick rescan on startup', 'Checks for added/removed files in the background after launch', tog('rescanOnStart', S.rescanOnStart));
  } else {
    libHTML += `<div class="root-row"><div class="p"><b>${plural(total, 'song')} on this device</b><small id="storageInfo">Checking storage…</small></div></div><div class="root-row"><button class="pill solid" data-imp="1">${ico('folder')}Import a folder</button><button class="pill" data-imp="0">${ico('note')}Import songs</button></div>`;
  }
  const noArt = Object.values(lib.db.tracks).filter((t) => !t.cover).length;
  if (total) libHTML += opt('Album covers', `${(total - noArt).toLocaleString()} of ${total.toLocaleString()} songs have art${lib.coverErrors.length ? ` • last problem: ${esc(lib.coverErrors[0])}` : ''}`, noArt ? `<button class="pill" data-repaircovers>${ico('refresh')}Find missing covers</button>` : `<span style="color:var(--tx3);font-size:13px">All set</span>`);
  libHTML += `</div>`;
  el.appendChild(h(`<div>${libHTML}</div>`));
  // Theme studio
  const segOf = (k, opts) => `<div class="seg" data-seg="${k}">${opts.map(([v, l]) => `<button data-v="${v}" class="${S[k] === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const rng = (k, min, max, step, fmt) => `<input type="range" min="${min}" max="${max}" step="${step}" value="${S[k]}" data-range="${k}" data-fmt="${fmt}"><span class="val">${fmtVal(fmt, S[k])}</span>`;
  const presets = `<div class="presets">${Object.entries(PRESETS).map(([k, p]) => `<button class="preset ${S.preset === k ? 'on' : ''}" data-preset="${k}" style="--pbg:${p.pv[0]};--pa:${p.pv[1]};--pb:${p.pv[2]};--pglass:${p.theme === 'light' ? 'rgba(255,255,255,.6)' : 'rgba(255,255,255,.1)'}"><div class="pv"><i></i></div><b>${p.name}</b></button>`).join('')}</div>`;
  const sw1 = `<div class="swatches">${ACCENTS.map((c) => `<button data-acc="${c}" style="background:${c}" class="${S.accent === c && S.accentMode === 'fixed' ? 'on' : ''}" title="${c}"></button>`).join('')}<label title="Any color"><input type="color" value="${S.accent}" data-acccustom></label></div>`;
  const sw2 = `<div class="swatches"><button class="pill ${S.accent2 === 'auto' ? 'on' : ''}" data-acc2="auto" style="width:auto;height:28px;border-radius:999px;padding:0 12px;font-size:12px">Auto</button>${ACCENTS.map((c) => `<button data-acc2="${c}" style="background:${c}" class="${S.accent2 === c ? 'on' : ''}"></button>`).join('')}<label title="Any color"><input type="color" value="${S.accent2 === 'auto' ? '#22d3ee' : S.accent2}" data-acc2custom></label></div>`;
  const cur = player.track?.cover; const artURL = cur ? app.P.coverURLSync?.(cur, true) : null;
  const preview = `<div class="tprev-wrap"><div class="tprev" data-tprev>
      <div class="tp-desk"></div>
      <div class="tp-bg"><div class="tp-o a"></div><div class="tp-o b"></div><div class="tp-art"${artURL ? ` style="background-image:url(${artURL})"` : ''} data-tpart></div><div class="tp-wall"${S.wallpaper ? ` style="background-image:url(${S.wallpaper})"` : ''}></div></div>
      <div class="tp-shapes"><i class="s1"></i><i class="s2"></i><i class="s3"></i><b>Pulse</b></div>
      <div class="tp-side tp-glass"><span class="r on"></span><span class="r"></span><span class="r"></span><span class="r short"></span></div>
      <div class="tp-main tp-glass"><div class="tp-card"><div class="tp-cv"></div><span class="l"></span><span class="l s"></span></div><div class="tp-card"><div class="tp-cv b"></div><span class="l"></span><span class="l s"></span></div><div class="tp-menu tp-glass"><span></span><span></span><span></span></div></div>
      <div class="tp-bar tp-glass"><div class="tp-cv sm"></div><span class="l"></span><div class="tp-play"></div><div class="tp-prog"><i></i></div></div>
    </div><small>Live preview — it changes as you move the sliders below</small></div>`;
  let look = `<h3>Theme studio</h3><div class="set-group">${preview}${presets}` +
    opt('Mode', '', segOf('theme', [['dark', 'Dark'], ['midnight', 'Midnight'], ['black', 'Black'], ['light', 'Light'], ['auto', 'Auto']])) +
    opt('Accent', 'From album art changes the whole look with every song', segOf('accentMode', [['dynamic', 'From album art'], ['fixed', 'My color']])) +
    opt('Accent color', '', sw1) +
    opt('Gradient partner', 'Second color for gradients, glows and the background', sw2) +
    opt('Background', '', segOf('bgMode', [['aurora', 'Aurora'], ['art', 'Album art'], ['wallpaper', 'Wallpaper'], ['solid', 'Solid']])) +
    (S.bgMode === 'wallpaper' ? opt('Wallpaper', 'Any photo — it sits behind the glass', `${S.wallpaper ? `<span class="wall-thumb" style="background-image:url(${S.wallpaper})"></span>` : ''}<button class="pill" data-wall>${ico('image')}${S.wallpaper ? 'Change' : 'Choose image'}</button>${S.wallpaper ? `<button class="ib sm" data-wallrm title="Remove">${ico('x')}</button>` : ''}`) : '') +
    opt('Glass blur', 'How frosted the panels are', rng('blur', 0, 60, 1, 'px')) +
    opt('Glass tint', 'More = solid panels, less = see-through', rng('glass', 0, 1, 0.01, 'pct')) +
    opt('Background glow', '', rng('glow', 0, 1.6, 0.05, 'pct')) +
    opt('Corner roundness', '', rng('radius', 4, 32, 1, 'px')) +
    opt('Font', '', segOf('font', [['system', 'Clean'], ['rounded', 'Rounded'], ['serif', 'Editorial'], ['mono', 'Mono']]));
  if (app.isDesktop) look += opt('Window transparency', 'See your desktop through the whole window', rng('winOpacity', 0.35, 1, 0.01, 'pct'));
  look += '</div>';
  look += `<h3>Motion & layout</h3><div class="set-group">` + opt('Animations', '', segOf('anim', [['full', 'Full'], ['low', 'Subtle'], ['off', 'Off']])) + opt('Compact rows', 'Fit more songs on screen', tog('compact', S.compact)) + opt('Blur inactive lyric lines', '', tog('blurLyrics', S.blurLyrics)) + '</div>';
  el.appendChild(h(`<div>${look}</div>`));
  if (cur && !artURL) app.P.coverURL(cur, true).then((u) => { const a = el.querySelector('[data-tpart]'); if (u && a) a.style.backgroundImage = `url(${u})`; });
  // Playback
  let pb = `<h3>Playback</h3><div class="set-group">` +
    opt('Crossfade', 'Blend the end of one song into the next', `<input type="range" min="0" max="12" step="1" value="${S.crossfade}" data-range="crossfade"><span class="val">${S.crossfade ? S.crossfade + 's' : 'Off'}</span>`) +
    opt('Smooth pause & play', 'Quick fade instead of a hard stop', tog('fadePause', S.fadePause)) +
    opt('Volume leveler', 'Evens out loud and quiet songs', tog('leveler', S.leveler)) +
    opt('Equalizer & sound', 'EQ, presets, speed, pitch', `<button class="pill" data-sound>${ico('eq')}Open</button>`);
  if (!app.isMobile) pb += opt('Now playing view', 'Clicking the cover in the player bar opens this. Auto uses a side panel on wide windows, full screen on small ones. The ⤢ button is always full screen.', segOf('npView', [['auto', 'Auto'], ['panel', 'Side panel'], ['full', 'Full screen']]));
  if (!app.isDesktop) pb += opt('Audio effects engine', 'Needed for EQ, crossfade and the visualizer. On iPhone it can stop background playback when locked — leave on Auto unless you want effects.', `<div class="seg" data-seg="engine">${[['auto', 'Auto'], ['on', 'On'], ['off', 'Off']].map(([k, l]) => `<button data-v="${k}" class="${S.engine === k ? 'on' : ''}">${l}</button>`).join('')}</div>`);
  pb += '</div>';
  el.appendChild(h(`<div>${pb}</div>`));
  if (app.isDesktop) {
    el.appendChild(h(`<div><h3>Window</h3><div class="set-group">${opt('Close button minimizes to tray', 'Keep playing in the background; quit from the tray icon', tog('closeToTray', S.closeToTray))}${opt('Mini player', 'Layouts, transparency, blur, always-on-top', `<button class="pill" data-minicustom>${ico('palette')}Customize</button><button class="pill" data-gomini>${ico('mini')}Open</button>`)}</div></div>`));
  }
  // gestures
  if (!app.isDesktop) {
    const G = S.gest; const actSel = (dir) => `<select class="inp" data-gest-sel="${dir}" style="width:170px;height:36px">${Object.entries(SWIPE_ACTIONS).map(([k, [l]]) => `<option value="${k}" ${G[dir] === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    const gt = (k) => `<div class="tog ${G[k] ? 'on' : ''}" data-gest="${k}"></div>`;
    el.appendChild(h(`<div><h3>Gestures</h3><div class="set-group">
      ${opt('Swipe a song right', 'Works in every song list', actSel('right'))}
      ${opt('Swipe a song left', '', actSel('left'))}
      ${opt('Long-press a song', 'Opens the song menu: play next, add to playlist, go to album…', '<span style="color:var(--tx3);font-size:13px">Always on</span>')}
      ${opt('Swipe the mini player', 'Left for next song, right for previous', gt('miniSwipe'))}
      ${opt('Swipe up on the mini player', 'Opens Now Playing', gt('miniUp'))}
      ${opt('Swipe down on Now Playing', 'Closes it', gt('npDown'))}
      ${opt('Swipe the cover in Now Playing', 'Left for next, right for previous', gt('artSwipe'))}
      ${opt('Double-tap the cover', 'Like the song', gt('artDouble'))}
      ${opt('Haptic feedback', 'A small tap when a gesture triggers (Android; iPhone doesn’t allow it in web apps)', gt('haptics'))}
    </div></div>`));
  }
  // shortcuts
  if (!app.isMobile) {
    const keys = [['Space', 'Play / pause'], ['Shift + → / ←', 'Next / previous'], ['→ / ←', 'Seek 5s'], ['↑ / ↓', 'Volume'], ['M', 'Mute'], ['S', 'Shuffle'], ['R', 'Repeat'], ['L', 'Like current song'], ['Q', 'Queue'], ['Y', 'Lyrics'], ['F', 'Now Playing'], ['Ctrl + K or /', 'Search'], ['Ctrl + M', 'Mini player'], ['Ctrl + B', 'Sidebar'], ['Ctrl + ,', 'Settings'], ['Alt + ← / →', 'Back / forward'], ['Esc', 'Close overlays'], ['Ctrl + A', 'Select all songs']];
    el.appendChild(h(`<div><h3>Keyboard shortcuts</h3><div class="set-group"><div class="keys">${keys.map(([k, d]) => `<div><span>${d}</span><kbd>${k}</kbd></div>`).join('')}</div></div></div>`));
  }
  el.appendChild(h(`<div><h3>Data</h3><div class="set-group">${opt('Backup library', 'Playlists, folders, likes and play counts as a JSON file', `<button class="pill" data-backup>${ico('export')}Export</button><button class="pill" data-restore>${ico('import')}Import</button>`)}${opt('Reset settings', 'Library is kept', `<button class="pill" data-resetS>Reset</button>`)}${opt('Version', `Pulse ${VERSION}<span id="updInfo"></span>`, `<button class="pill" data-checkupd>${ico('refresh')}Check for updates</button>`)}</div></div>`));

  // wiring
  el.addEventListener('click', async (e) => {
    const t = e.target;
    const gg = t.closest('[data-gest]'); if (gg) { const k = gg.dataset.gest; S.gest[k] = !S.gest[k]; gg.classList.toggle('on', S.gest[k]); app.saveS(); return; }
    const tg = t.closest('[data-tog]'); if (tg) { const k = tg.dataset.tog; S[k] = !S[k]; tg.classList.toggle('on', S[k]); app.saveS(); applyTheme(); if (k === 'leveler') player.applyLeveler(); return; }
    const pr = t.closest('[data-preset]'); if (pr) { applyPreset(pr.dataset.preset); refresh(); return; }
    const a2 = t.closest('[data-acc2]'); if (a2) { S.accent2 = a2.dataset.acc2; S.preset = 'custom'; app.saveS(); applyTheme(); refresh(); return; }
    if (t.closest('[data-wall]')) { const pic = await pickImage(); if (!pic) return; S.wallpaper = await shrinkImage(pic); S.bgMode = 'wallpaper'; S.preset = 'custom'; app.saveS(); applyTheme(); refresh(); return; }
    if (t.closest('[data-wallrm]')) { S.wallpaper = null; S.bgMode = 'aurora'; app.saveS(); applyTheme(); refresh(); return; }
    const sg = t.closest('.seg[data-seg] button'); if (sg) { const k = sg.parentElement.dataset.seg; S[k] = sg.dataset.v; if (THEME_KEYS.includes(k)) S.preset = 'custom'; if (k === 'bgMode') { app.saveS(); applyTheme(); refresh(); return; } $$('button', sg.parentElement).forEach((b) => b.classList.toggle('on', b === sg)); app.saveS(); applyTheme(); if (k === 'engine' && S.engine === 'on') player.enableEngine(); if (k === 'engine' && S.engine === 'off' && player.engineOn) toast('Restart Pulse to fully turn the engine off'); return; }
    const ac = t.closest('[data-acc]'); if (ac) { S.accent = ac.dataset.acc; S.accentMode = 'fixed'; S.preset = 'custom'; app.saveS(); applyTheme(); refresh(); return; }
    if (t.closest('[data-addroot]')) { addFolder(); return; }
    if (t.closest('[data-checkupd]')) { const info = el.querySelector('#updInfo'); info.textContent = ' • checking…'; const u = await checkForUpdate(true); info.innerHTML = u === null ? ' • couldn\'t reach GitHub' : u.newer ? ` • <b style="color:rgb(var(--acc-rgb))">${esc(u.version)} is available</b> — <a data-openrel style="text-decoration:underline;cursor:pointer">download</a>` : ' • you\'re on the latest version'; return; }
    if (t.closest('[data-openrel]')) { app.P.openURL(`https://github.com/${'Frenchbear1/Pulse'}/releases/latest`); return; }
    if (t.closest('[data-repaircovers]')) { toast('Looking for covers…'); const r = await window.__pulseRepair?.(true); if (r) toast(r.fixed ? `Found ${r.fixed} covers` : `No embedded art found in ${r.total} song${r.total === 1 ? '' : 's'}${lib.coverErrors[0] ? ' — ' + lib.coverErrors[0] : ''}`, 5000); refresh(); return; }
    if (t.closest('[data-spimp]')) { import('./spotify.js').then((m) => m.openSpotifyImport()); return; }
    if (t.closest('[data-rescanall]')) { toast('Rescanning…'); await lib.rescanAll(); toast('Library up to date'); refresh(); return; }
    const rs = t.closest('[data-rescan]'); if (rs) { const r = roots.find((x) => x.id === rs.dataset.rescan); toast('Rescanning ' + r.name); await lib.rescan(r); refresh(); return; }
    const rm = t.closest('[data-rmroot]'); if (rm) { const r = roots.find((x) => x.id === rm.dataset.rmroot); if (await confirmBox('Remove folder?', `"${r.name}" will be removed from Pulse. Files on disk stay untouched.`, 'Remove')) { app.P.unwatchRoot?.(r); await lib.removeRoot(r.id); refresh(); } return; }
    const imp = t.closest('[data-imp]'); if (imp) { importMusic(imp.dataset.imp === '1'); return; }
    if (t.closest('[data-sound]')) { import('./np.js').then((m) => m.soundPanel()); return; }
    if (t.closest('[data-minicustom]')) { import('./np.js').then((m) => m.miniCustomize()); return; }
    if (t.closest('[data-gomini]')) { import('./np.js').then((m) => m.enterMini()); return; }
    if (t.closest('[data-backup]')) { const d = { ...lib.db, tracks: undefined, lyrics: undefined, covers: undefined, trackMeta: Object.fromEntries(Object.values(lib.db.tracks).map((x) => [x.id, { rel: x.rel, root: x.root, title: x.title, artist: x.artist }])) }; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(d)], { type: 'application/json' })); a.download = 'pulse-backup.json'; a.click(); return; }
    if (t.closest('[data-restore]')) { const i = document.createElement('input'); i.type = 'file'; i.accept = '.json'; i.onchange = async () => { try { const d = JSON.parse(await i.files[0].text()); for (const k of ['nodes', 'rootNodes', 'liked', 'plays', 'last', 'history']) if (d[k]) lib.db[k] = d[k]; await lib.saveNow(); rerenderTrees(); toast('Backup restored'); refresh(); } catch { toast('That file is not a Pulse backup'); } }; i.click(); return; }
    if (t.closest('[data-resetS]')) { if (await confirmBox('Reset settings?', 'Theme, sound and layout settings go back to default.', 'Reset')) { Object.assign(S, structuredClone(DEFAULTS)); app.saveS(); applyTheme(); player.applyEQ(); player.applyVolume(); refresh(); } }
  });
  el.addEventListener('input', (e) => {
    const r = e.target.closest('[data-range]'); if (r) { const k = r.dataset.range; S[k] = +r.value; if (THEME_KEYS.includes(k)) { S.preset = 'custom'; $$('.preset.on', el).forEach((x) => x.classList.remove('on')); } const v = r.nextElementSibling; if (v?.classList.contains('val')) v.textContent = fmtVal(r.dataset.fmt || (k === 'crossfade' ? 's' : 'pct'), S[k]); app.saveS(); applyTheme(); }
    if (e.target.matches('[data-gest-sel]')) { S.gest[e.target.dataset.gestSel] = e.target.value; app.saveS(); return; }
    if (e.target.matches('[data-acccustom]')) { S.accent = e.target.value; S.accentMode = 'fixed'; S.preset = 'custom'; app.saveS(); applyTheme(); }
    if (e.target.matches('[data-acc2custom]')) { S.accent2 = e.target.value; S.preset = 'custom'; app.saveS(); applyTheme(); }
  });
  if (!app.isDesktop) app.P.storageInfo().then((i) => { const s = el.querySelector('#storageInfo'); if (s) s.textContent = i ? `Using ${fmtBytes(i.usage)} of ${fmtBytes(i.quota)} available` : 'Stored privately inside Pulse'; });
  return el;
};
