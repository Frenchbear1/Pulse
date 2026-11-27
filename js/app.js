// Pulse — boot + shell wiring
import { app, lib, player, toast, loadSettings, applyTheme, applyAccent, currentColor, setBgArt, go, back, fwd, refresh, refreshSoon, markNav, menu, closeLayer, setImg, setLikeBtn, burst, marquee, slider, ico } from './core.js';
import { $, $$, fmtTime, debounce, throttle, clamp } from './util.js';
import { trackMenu, albumKey, treeEl, rerenderTrees, createMenu, importMusic, addFolder } from './views.js';
import * as NP from './np.js';
import { autoFill } from './spotify.js';

const isDesktop = !!window.PULSE_DESKTOP;
const mq = matchMedia('(max-width: 760px)');

async function boot() {
  app.isDesktop = isDesktop; app.isMobile = mq.matches;
  document.body.classList.add(isDesktop ? 'desktop' : 'web');
  mq.addEventListener('change', () => { app.isMobile = mq.matches; refresh(); });
  app.S = loadSettings();
  applyTheme();
  const mod = isDesktop ? await import('./platform-desktop.js') : await import('./platform-web.js');
  const P = app.P = isDesktop ? mod.createDesktopPlatform() : mod.createWebPlatform();
  await P.init();
  await lib.load(P);
  if (isDesktop) await Promise.all(lib.db.roots.filter((r) => r.path).map((r) => P.mountRoot(r).catch(() => {})));
  player.init(P, app.S);
  wireShell(); NP.initNP();
  $('#tree').appendChild(treeEl(null)); rerenderTrees();
  const lv = app.S.lastView; const start = app.isMobile ? { view: 'home', params: {} } : (lv && app.renderers[lv.view] ? lv : { view: 'home', params: {} });
  go(start.view, start.params || {});
  player.restore(lib.db.session);
  updateBar(); updateState(); updateModes(); updateVolume();
  if (app.S.panel && !app.isMobile) NP.openPanel(app.S.panel);
  requestAnimationFrame(() => document.body.classList.remove('booting'));

  // desktop: background rescan + folder watching
  if (isDesktop) {
    setTimeout(async () => { if (app.S.rescanOnStart) await lib.rescanAll().catch((e) => console.warn(e)); if (app.S.watch) lib.db.roots.forEach((r) => P.watchRoot(r)); autoRepairCovers(); }, 900);
    P.on((type, d) => {
      if (type === 'fschange' && app.S.watch) lib.rescanAll();
      if (type === 'close') { if (app.S.closeToTray) P.win.hide(); else quit(); }
      if (type === 'maxchange') { document.body.classList.toggle('maxed', d); $('#wMax use').setAttribute('href', d ? '#i-collapse' : '#i-wmax'); }
      if (type === 'tray') ({ play: () => player.toggle(), next: () => player.next(), prev: () => player.prev(), show: () => P.win.show(), mini: () => { P.win.show(); NP.enterMini(); }, quit })[d]?.();
    });
    setTray();
    P.win.isMax().then((m) => document.body.classList.toggle('maxed', m)).catch(() => {});
  } else if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
async function quit() { saveSession(); await lib.saveNow(); app.P.win.exit(); }
function setTray() { if (!isDesktop) return; app.P.win.setTray([{ id: 'show', text: 'Show Pulse' }, { id: 'mini', text: 'Mini player' }, { id: 'sep1', text: '-' }, { id: 'play', text: player.playing ? 'Pause' : 'Play' }, { id: 'next', text: 'Next' }, { id: 'prev', text: 'Previous' }, { id: 'sep2', text: '-' }, { id: 'quit', text: 'Quit' }]); }
const setTraySoon = debounce(setTray, 400);

// ---------------- session ----------------
function saveSession() { lib.db.session = player.snapshot(); lib.save(); }
const saveSessionSoon = throttle(saveSession, 5000);
addEventListener('pagehide', () => { saveSession(); lib.saveNow(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { saveSession(); lib.saveNow(); } });

// ---------------- bar ----------------
let seekS, volS, npSeekS;
async function updateBar() {
  const t = player.track;
  $('#barTitle').textContent = t ? t.title : 'Nothing playing';
  $('#barArtist').textContent = t ? (t.artist || 'Unknown Artist') : (Object.keys(lib.db.tracks).length ? 'Pick a song to get started' : 'Add your music to get started');
  $('#mbTitle').textContent = t ? t.title : 'Nothing playing'; $('#mbArtist').textContent = t ? t.artist || 'Unknown Artist' : '';
  $('#mbar').classList.toggle('empty', !t);
  setLikeBtn($('#barLike'), t && lib.isLiked(t.id)); setLikeBtn($('#mbLike'), t && lib.isLiked(t.id));
  $('#barLike').style.visibility = t ? '' : 'hidden';
  marquee($('#bar .marq'));
  await Promise.all([setImg($('#barArt img'), t?.cover, true), setImg($('.mb-art img'), t?.cover, true)]);
  applyAccent(currentColor()); setBgArt(t?.cover);
  document.title = t ? `${t.title} • ${t.artist || 'Pulse'}` : 'Pulse';
  updateTime();
}
function updateState() {
  const p = player.playing;
  $$('#cPlay, #mbPlay, #npPlay, #mini [data-m=play]').forEach((b) => b.classList.toggle('is-playing', p));
  $('#np').classList.toggle('paused', !p);
  $$('.eq-mini').forEach((e) => e.classList.toggle('paused', !p));
  $('#cPlay').title = p ? 'Pause (Space)' : 'Play (Space)';
}
function updateModes() {
  $('#cShuffle').classList.toggle('on', player.shuffle);
  $('#cRepeat').classList.toggle('on', player.repeat !== 'off');
  $('#cRepeat use').setAttribute('href', player.repeat === 'one' ? '#i-repeat1' : '#i-repeat');
  $('#cRepeat').title = { off: 'Repeat: off', all: 'Repeat: all', one: 'Repeat: one' }[player.repeat];
  NP.updateNP();
}
function updateVolume() {
  const v = app.S.muted ? 0 : app.S.volume; volS?.update(v); $('#volume').style.setProperty('--v', v);
  $('#bMute use').setAttribute('href', v === 0 ? '#i-vol-x' : v < 0.5 ? '#i-vol-low' : '#i-vol');
}
function updateTime() {
  const d = player.duration, c = player.time, f = d ? c / d : 0;
  seekS?.update(f); npSeekS?.update(f);
  $('#tCur').textContent = fmtTime(c); $('#tDur').textContent = fmtTime(d);
  $('#npCur').textContent = fmtTime(c); $('#npDur').textContent = d ? '-' + fmtTime(d - c) : '0:00';
  $('.mb-prog div').style.width = f * 100 + '%';
  try { const el = player.el; if (el.buffered.length && d) { const b = el.buffered.end(el.buffered.length - 1) / d; $('#seek').style.setProperty('--b', b); $('#npSeekBar').style.setProperty('--b', b); } } catch {}
  NP.miniTime(); NP.npTick();
}

function wireShell() {
  // navigation
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-go]'); if (!a || e.target.closest('[data-play]')) return;
    if (a.closest('.card, .tile') && a.closest('.card, .tile') !== a) return;
    e.preventDefault(); const v = a.dataset.go;
    if (v === 'search' && !app.isMobile) { $('#searchInput').focus(); go('search', { q: $('#searchInput').value }); return; }
    go(v);
  });
  $('#navBack').onclick = back; $('#navFwd').onclick = fwd;
  $('#btnSide').onclick = () => { app.S.sideMini = !app.S.sideMini; app.saveS(); applyTheme(); };
  $('#btnSettings').onclick = () => go('settings');
  $('#sideNew').onclick = (e) => createMenu({ el: e.currentTarget });
  const si = $('#searchInput');
  si.addEventListener('input', debounce(() => { if (app.view === 'search') { app.params.q = si.value; app.S.lastView = { view: 'search', params: { q: si.value } }; refresh(); } else go('search', { q: si.value }); }, 120));
  si.addEventListener('focus', () => { if (app.view !== 'search') go('search', { q: si.value }); });
  si.addEventListener('keydown', (e) => { if (e.key === 'Escape') { si.value = ''; si.blur(); back(); } if (e.key === 'Enter') { const first = lib.search(si.value, 1)[0]; if (first) player.playList(lib.search(si.value, 300), 0, { type: 'search', id: si.value, label: 'Search: ' + si.value }); } });
  // player bar
  $('#cPlay').onclick = () => player.toggle(); $('#mbPlay').onclick = (e) => { e.stopPropagation(); player.toggle(); };
  $('#cNext').onclick = () => player.next(); $('#cPrev').onclick = () => player.prev();
  $('#cShuffle').onclick = () => player.toggleShuffle(); $('#cRepeat').onclick = () => player.cycleRepeat();
  const like = (btn) => { const t = player.track; if (!t) return; lib.like(t.id); if (lib.isLiked(t.id)) burst(btn); };
  $('#barLike').onclick = (e) => like(e.currentTarget); $('#mbLike').onclick = (e) => { e.stopPropagation(); like(e.currentTarget); };
  $('#barArt').onclick = () => NP.openNP(); $('#bFull').onclick = () => NP.openNP();
  $('#mbar').onclick = () => NP.openNP();
  $('#barTitle').onclick = () => { const t = player.track; if (t) go('album', { key: albumKey(t) }); };
  $('#barArtist').onclick = () => { const t = player.track; if (t) go('artist', { key: albumKey(t).split('\u0001')[0] }); };
  $('#bar .bar-left').addEventListener('contextmenu', (e) => { const t = player.track; if (t) { e.preventDefault(); trackMenu([t.id], { x: e.clientX, y: e.clientY }); } });
  $('#bQueue').onclick = () => NP.openPanel('queue'); $('#bLyrics').onclick = () => NP.openPanel('lyrics');
  $('#bMore').onclick = (e) => menu([
    { label: 'Equalizer & sound', icon: 'eq', action: NP.soundPanel },
    { label: 'Sleep timer', icon: 'moon', action: () => NP.sleepMenu({ el: $('#bMore'), up: true, right: true }) },
    { label: `Speed: ${app.S.speed.toFixed(2)}×`, icon: 'speed', sub: () => [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2].map((s) => ({ label: s + '×', checked: app.S.speed === s, action: () => { app.S.speed = s; player.applySpeed(); app.saveS(); } })) },
    { label: `Crossfade: ${app.S.crossfade ? app.S.crossfade + 's' : 'Off'}`, icon: 'wave', sub: () => [0, 2, 4, 6, 8, 12].map((s) => ({ label: s ? s + ' seconds' : 'Off', checked: app.S.crossfade === s, action: () => { app.S.crossfade = s; app.saveS(); if (s && !player.engineOn) toast('Crossfade needs the audio engine (Settings)'); } })) },
    '-', { label: 'Song info', icon: 'info', action: () => NP.openPanel('info') }
  ], { el: e.currentTarget, up: true, right: true });
  $('#bMute').onclick = () => player.toggleMute();
  $('#bMini').onclick = () => NP.enterMini();
  $('#panelClose').onclick = NP.closePanel;
  $$('[data-ptab]').forEach((b) => (b.onclick = () => NP.openPanel(b.dataset.ptab)));

  const seekCfg = (el) => slider(el, { get: () => (player.duration ? player.time / player.duration : 0), set: (v) => player.seek(v * player.duration), preview: (v, hover) => { el.querySelector('.tip') && (el.querySelector('.tip').textContent = fmtTime(v * player.duration)); if (!hover && el.id === 'seek') $('#tCur').textContent = fmtTime(v * player.duration); } });
  seekS = seekCfg($('#seek')); npSeekS = seekCfg($('#npSeekBar'));
  volS = slider($('#volume'), { get: () => app.S.volume, set: (v) => player.setVolume(v), preview: (v, hover) => { if (!hover) player.setVolume(v); } });

  // player events
  player.on((e) => {
    if (e === 'time') updateTime();
    else if (e === 'track') { updateBar(); NP.onTrackChange(); rerenderTreesSoon(); saveSessionSoon(); setTraySoon(); }
    else if (e === 'state') { updateState(); NP.updateNP(); NP.updateMini(); setTraySoon(); if (!player.playing) saveSession(); }
    else if (e === 'mode') updateModes();
    else if (e === 'volume') updateVolume();
    else if (e === 'queue') { NP.onQueueChange(); saveSessionSoon(); }
    else if (e === 'settings') app.saveS();
    else if (e === 'error') toast("Couldn't play that file — skipping");
    else if (e === 'sleepDone') toast('Sleep timer: paused playback');
  });
  const rerenderTreesSoon = debounce(rerenderTrees, 300);
  lib.on((e, d) => {
    if (e === 'liked') { const t = player.track; if (t && t.id === d) { setLikeBtn($('#barLike'), lib.isLiked(d)); setLikeBtn($('#mbLike'), lib.isLiked(d)); NP.updateNP(); NP.updateMini(); } rerenderTreesSoon(); }
    if (e === 'nodes') rerenderTreesSoon();
    if (e === 'scan') { const pill = $('#scanPill'); if (d) { pill.classList.remove('hidden'); pill.querySelector('.txt').textContent = `${d.label} • ${d.done.toLocaleString()} / ${d.total.toLocaleString()}`; } else { pill.classList.add('hidden'); if (pendingRefresh) { pendingRefresh = false; quietRefresh(); } } }
    // Library changes land in the background: never re-render mid-scan, refresh once quietly at the end
    if (e === 'index') { autoFill(); if (['home', 'songs', 'albums', 'artists', 'folders', 'library', 'search'].includes(app.view)) { if (lib.scanning || repairing) pendingRefresh = true; else quietRefresh(); } }
  });

  // window controls (desktop)
  if (isDesktop) {
    const W = app.P.win;
    $('#wMin').onclick = W.minimize; $('#wMax').onclick = () => W.toggleMax(); $('#wClose').onclick = W.close;
    const dragAreas = ['#dragZone', '.tb-drag', '#titlebar', '.np-top'];
    document.addEventListener('pointerdown', async (e) => {
      if (e.button !== 0) return; const z = e.target.closest(dragAreas.join(',')); if (!z || e.target.closest('button, input, a, label, .np-src')) return;
      if (W._max && e.detail < 2) { // drag down from maximized: restore under the cursor, then keep dragging
        const fx = e.clientX / innerWidth; const sx = e.screenX, sy = e.screenY;
        const onMove = async (ev) => { if (Math.hypot(ev.screenX - sx, ev.screenY - sy) < 6) return; document.removeEventListener('pointermove', onMove); await W.restore({ x: ev.screenX, y: ev.screenY, fx }); W.drag(); };
        document.addEventListener('pointermove', onMove); document.addEventListener('pointerup', () => document.removeEventListener('pointermove', onMove), { once: true });
        return;
      }
      W.drag();
    });
    $('#titlebar').addEventListener('dblclick', (e) => { if (!e.target.closest('button, input, a, label')) $('#wMax').click(); });
    // resize grips (borderless window)
    $$('#grips .g').forEach((g) => g.addEventListener('pointerdown', async (e) => {
      e.preventDefault(); g.setPointerCapture(e.pointerId); const mode = g.dataset.g; const s = await W.getSize(); const sx = e.screenX, sy = e.screenY;
      const mv = throttle((ev) => { const w = mode.includes('r') ? Math.max(720, s.width + (ev.screenX - sx)) : s.width; const hh = mode.includes('b') ? Math.max(480, s.height + (ev.screenY - sy)) : s.height; W.setSize(w, hh, true); }, 16);
      const up = () => { g.removeEventListener('pointermove', mv); g.removeEventListener('pointerup', up); };
      g.addEventListener('pointermove', mv); g.addEventListener('pointerup', up);
    }));
  }

  // keyboard
  document.addEventListener('keydown', (e) => {
    const typing = e.target.matches('input, textarea, select, [contenteditable]');
    const k = e.key, ctrl = e.ctrlKey || e.metaKey;
    if (k === 'Escape') { if ($('#layer').children.length) { closeLayer(); return; } if (NP.isNPOpen()) { NP.closeNP(); return; } if (document.body.classList.contains('mini')) { NP.exitMini(); return; } if (typing) e.target.blur(); return; }
    if (ctrl && (k === 'k' || k === 'f')) { e.preventDefault(); if (app.isMobile) go('search'); else { $('#searchInput').focus(); $('#searchInput').select(); } return; }
    if (ctrl && k === ',') { e.preventDefault(); go('settings'); return; }
    if (ctrl && k === 'm') { e.preventDefault(); document.body.classList.contains('mini') ? NP.exitMini() : NP.enterMini(); return; }
    if (ctrl && k === 'b') { e.preventDefault(); $('#btnSide').click(); return; }
    if (e.altKey && k === 'ArrowLeft') { back(); return; } if (e.altKey && k === 'ArrowRight') { fwd(); return; }
    if (typing || ctrl || e.altKey) return;
    switch (k) {
      case ' ': e.preventDefault(); player.toggle(); break;
      case 'ArrowRight': e.preventDefault(); e.shiftKey ? player.next() : player.seekBy(5); break;
      case 'ArrowLeft': e.preventDefault(); e.shiftKey ? player.prev() : player.seekBy(-5); break;
      case 'ArrowUp': e.preventDefault(); player.setVolume(app.S.volume + 0.05); toast(`Volume ${Math.round(app.S.volume * 100)}%`, 700); break;
      case 'ArrowDown': e.preventDefault(); player.setVolume(app.S.volume - 0.05); toast(`Volume ${Math.round(app.S.volume * 100)}%`, 700); break;
      case 'm': case 'M': player.toggleMute(); break;
      case 's': case 'S': player.toggleShuffle(); toast(player.shuffle ? 'Shuffle on' : 'Shuffle off', 900); break;
      case 'r': case 'R': player.cycleRepeat(); toast({ off: 'Repeat off', all: 'Repeat all', one: 'Repeat one' }[player.repeat], 900); break;
      case 'l': case 'L': like($('#barLike')); break;
      case 'q': case 'Q': NP.openPanel('queue'); break;
      case 'y': case 'Y': NP.openPanel('lyrics'); break;
      case 'f': case 'F': NP.isNPOpen() ? NP.closeNP() : NP.openNP(); break;
      case '/': e.preventDefault(); $('#searchInput').focus(); break;
      case 'MediaPlayPause': player.toggle(); break; case 'MediaTrackNext': player.next(); break; case 'MediaTrackPrevious': player.prev(); break;
    }
  });
  // mouse back/forward buttons
  document.addEventListener('mouseup', (e) => { if (e.button === 3) back(); if (e.button === 4) fwd(); });
  document.addEventListener('contextmenu', (e) => { if (!e.target.closest('input, textarea')) e.preventDefault(); });

  // drag & drop audio files onto the window (web) to import
  if (!isDesktop) {
    let dz = null;
    document.addEventListener('dragover', (e) => { if (!e.dataTransfer.types.includes('Files')) return; e.preventDefault(); if (!dz) { dz = document.createElement('div'); dz.className = 'dropzone'; dz.textContent = 'Drop songs to import'; document.body.appendChild(dz); } });
    document.addEventListener('dragleave', (e) => { if (dz && !e.relatedTarget) { dz.remove(); dz = null; } });
    document.addEventListener('drop', async (e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); dz?.remove(); dz = null; const n = await lib.importFiles([...e.dataTransfer.files]); toast(n ? `Imported ${n} songs` : 'Nothing new to import'); refresh(); });
  }
  // sidebar drop zone for "Your library" header (create playlist from dragged songs)
  const sh = $('.side-head');
  sh.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('application/x-pulse-tracks')) { e.preventDefault(); sh.style.outline = '2px solid var(--acc)'; } });
  sh.addEventListener('dragleave', () => (sh.style.outline = ''));
  sh.addEventListener('drop', (e) => { sh.style.outline = ''; const d = e.dataTransfer.getData('application/x-pulse-tracks'); if (!d) return; const ids = JSON.parse(d); const t = lib.track(ids[0]); const n = lib.createNode('playlist', ids.length === 1 ? t.title : (t.album || 'New playlist'), null, { tracks: ids }); toast(`Created "${n.name}"`); });
  // drop on main area root nodes (move to top level)
  $('#tree').addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('application/x-pulse-node') && e.target === $('#tree')) e.preventDefault(); });
}

// ---------- background helpers ----------
let pendingRefresh = false, repairing = false;
const quietRefresh = debounce(() => { if ($('#layer').children.length || $('.trow.sel')) { pendingRefresh = true; return; } const v = $('#view'); v.classList.add('quiet'); refresh(); setTimeout(() => v.classList.remove('quiet'), 600); }, 400);
export async function autoRepairCovers(force) {
  const missing = Object.values(lib.db.tracks).filter((t) => !t.cover).length;
  if (!missing || repairing || (!force && app.S.coverRepairV === 2)) return null;
  repairing = true; const pill = $('#scanPill');
  pill.classList.remove('hidden');
  const res = await lib.repairCovers((d, t) => { pill.querySelector('.txt').textContent = `Finding covers • ${d.toLocaleString()} / ${t.toLocaleString()}`; }).catch((e) => { console.warn(e); return null; });
  repairing = false; pill.classList.add('hidden'); app.S.coverRepairV = 2; app.saveS();
  if (res?.fixed) { toast(`Found covers for ${res.fixed.toLocaleString()} song${res.fixed === 1 ? '' : 's'}`); quietRefresh(); updateBar(); }
  return res;
}
window.__pulseRepair = autoRepairCovers;

boot().catch((e) => { console.error(e); document.body.classList.remove('booting'); document.getElementById('view').innerHTML = `<div class="page"><div class="empty"><h3>Pulse failed to start</h3><p>${String(e.message || e)}</p></div></div>`; });
