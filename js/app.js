// Pulse — boot + shell wiring
import { modal } from './core.js';
import { app, lib, player, toast, loadSettings, applyTheme, applyAccent, currentColor, setBgArt, coverImg, hydrate, flip, haptic, go, back, fwd, refresh, refreshSoon, markNav, menu, closeLayer, setImg, setLikeBtn, burst, marquee, slider, ico } from './core.js';
import { $, $$, fmtTime, debounce, throttle, clamp, norm, overlayScroll } from './util.js';
import { albumKeyOf, primaryArtist } from './library.js';
import { trackMenu, albumKey, treeEl, rerenderTrees, createMenu, importMusic, addFolder, libSortMenu } from './views.js';
import * as NP from './np.js';
import { autoFill } from './spotify.js';
import { practicePanel, practiceKeys } from './practice.js';

const isDesktop = !!window.PULSE_DESKTOP;
const isCompanion = isDesktop && new URLSearchParams(location.search).has('mini');
window.PULSE_COMPANION = isCompanion;
const mq = matchMedia('(max-width: 760px)');

async function boot() {
  app.isDesktop = isDesktop; app.isMobile = mq.matches;
  document.body.classList.add(isDesktop ? 'desktop' : 'web');
  mq.addEventListener('change', () => { app.isMobile = mq.matches; refresh(); });
  app.S = loadSettings();
  if (isCompanion) return bootCompanion();
  applyTheme();
  const mod = isDesktop ? await import('./platform-desktop.js') : await import('./platform-web.js');
  const P = app.P = isDesktop ? mod.createDesktopPlatform() : mod.createWebPlatform();
  await P.init();
  await lib.load(P);
  if (isDesktop) await Promise.all(lib.db.roots.filter((r) => r.path).map((r) => P.mountRoot(r).catch(() => {})));
  player.init(P, app.S);
  wireShell(); NP.initNP();
  overlayScroll($('#view'), $('#main')); overlayScroll($('#panelBody'), $('#panel')); overlayScroll($('#side .side-scroll'), $('#side .side-lib'));
  rerenderTrees();
  const lv = app.S.lastView; const start = app.isMobile ? { view: 'home', params: {} } : (lv && app.renderers[lv.view] ? lv : { view: 'home', params: {} });
  go(start.view, start.params || {});
  player.restore(lib.db.session);
  updateBar(); updateState(); updateModes(); updateVolume();
  if (app.S.panelOpen !== false && !app.isMobile) NP.openPanel(app.S.panel || 'info');
  requestAnimationFrame(() => document.body.classList.remove('booting'));
  if (lib.readOnly) setTimeout(() => toast("Couldn't read your library, so nothing will be saved this session (your data is untouched). Restart Pulse to try again.", 9000), 600);

  // desktop: background rescan + folder watching
  if (isDesktop) {
    setTimeout(async () => { if (app.S.rescanOnStart) await lib.rescanAll().catch((e) => console.warn(e)); if (app.S.watch) lib.db.roots.forEach((r) => P.watchRoot(r)); lib.wantCovers(Object.keys(lib.db.tracks), false); setTimeout(checkLikedFolders, 1500); }, 900);
    P.on((type, d) => {
      if (type === 'fschange' && app.S.watch) lib.rescanAll();
      if (type === 'close') { if (app.S.closeToTray) P.win.hide(); else quit(); }
      if (type === 'maxchange') { document.body.classList.toggle('maxed', d); $('#wMax use').setAttribute('href', d ? '#i-collapse' : '#i-wmax'); }
      if (type === 'tray') ({ play: () => player.toggle(), next: () => player.next(), prev: () => player.prev(), show: () => P.win.show(), mini: () => { P.win.show(); NP.enterMini(); }, quit })[d]?.();
    });
    setTray();
    setTimeout(() => import('./core.js').then((c) => c.autoUpdateCheck()), 8000);
    P.win.isMax().then((m) => document.body.classList.toggle('maxed', m)).catch(() => {});
  } else if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
// The separate mini-player window: no library, no audio — it mirrors the main window (see companion.js)
async function bootCompanion() {
  app.companion = true; document.body.classList.add('mini', 'companion');
  applyTheme();
  const mod = await import('./platform-desktop.js'); const P = app.P = mod.createDesktopPlatform(); await P.init();
  NP.initNP(); wireGrips();
  (await import('./companion.js')).runCompanion();
  requestAnimationFrame(() => document.body.classList.remove('booting'));
}
async function quit() { saveSession(); await lib.saveNow(); await (await import('./companion.js')).closeCompanion(); app.P.win.exit(); }
function setTray() { if (!isDesktop) return; app.P.win.setTray([{ id: 'show', text: 'Show Pulse' }, { id: 'mini', text: 'Mini player' }, { id: 'sep1', text: '-' }, { id: 'play', text: player.playing ? 'Pause' : 'Play' }, { id: 'next', text: 'Next' }, { id: 'prev', text: 'Previous' }, { id: 'sep2', text: '-' }, { id: 'quit', text: 'Quit' }]); }
const setTraySoon = debounce(setTray, 400);

function wireGrips() {
  const W = app.P.win;
    $$('#grips .g').forEach((g) => g.addEventListener('pointerdown', async (e) => {
      if (W._max) return;
      e.preventDefault(); g.setPointerCapture(e.pointerId);
      const mode = g.dataset.g; const s = await W.getSize(); const pos = await W.getPos(); const sx = e.screenX, sy = e.screenY;
      const mini = document.body.classList.contains('mini'); const minW = mini ? 180 : 720, minH = mini ? 40 : 480;
      const dpr = devicePixelRatio || 1;
      const mv = throttle((ev) => {
        const dx = ev.screenX - sx, dy = ev.screenY - sy;
        let w = s.width, hh = s.height, x = pos.x, y = pos.y;
        if (mode.includes('r')) w = Math.max(minW, s.width + dx);
        if (mode.includes('b')) hh = Math.max(minH, s.height + dy);
        if (mode.includes('l')) { w = Math.max(minW, s.width - dx); x = pos.x + (s.width - w) * dpr; }
        if (mode.includes('t')) { hh = Math.max(minH, s.height - dy); y = pos.y + (s.height - hh) * dpr; }
        W.setSize(w, hh); if (x !== pos.x || y !== pos.y) W.move(x, y);
      }, 16);
      const up = () => { g.removeEventListener('pointermove', mv); g.removeEventListener('pointerup', up); if (mini) { document.dispatchEvent(new CustomEvent('miniresized')); NP.keepOnScreen(); } };
      g.addEventListener('pointermove', mv); g.addEventListener('pointerup', up);
    }));
}

// ---------------- session ----------------
function saveSession() { if (isCompanion || !lib.db) return; lib.db.session = player.snapshot(); lib.save(); }
const saveSessionSoon = throttle(saveSession, 5000);
addEventListener('pagehide', () => { if (isCompanion) return; saveSession(); lib.saveNow(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && !isCompanion) { saveSession(); lib.saveNow(); } });

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
  const live = player.track?.live;
  flip($('#tCur'), fmtTime(c)); flip($('#tDur'), live ? 'LIVE' : fmtTime(d));
  flip($('#npCur'), fmtTime(c)); flip($('#npDur'), live ? 'LIVE' : d ? '-' + fmtTime(d - c) : '0:00');
  document.body.classList.toggle('is-live', !!live);
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
  const closeDrawer = () => { document.body.classList.remove('side-drawer'); applyTheme(); };
  $('#sideScrim').onclick = closeDrawer;
  $('#side').addEventListener('click', (e) => { if (document.body.classList.contains('side-drawer') && e.target.closest('a[data-go], .tnode, .side-item') && !e.target.closest('.caret')) setTimeout(closeDrawer, 60); });
  addEventListener('resize', debounce(() => applyTheme(), 120));
  $('#btnSide').onclick = () => {
    const b = document.body; if (b.classList.contains('side-anim')) return;
    if (b.classList.contains('side-narrow')) { b.classList.toggle('side-drawer'); applyTheme(); rerenderTrees(); return; }
    b.classList.add('side-anim');
    setTimeout(() => { app.S.sideMini = !app.S.sideMini; app.saveS(); applyTheme(); rerenderTrees(); }, 140);
    setTimeout(() => b.classList.remove('side-anim'), 140 + 300);
  };
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
  $('#barArt').onclick = () => NP.showNowPlaying(); $('#bFull').onclick = () => NP.openNP(true);
  $('#mbar').onclick = (e) => { if (e.target.closest('#mbDev')) { e.stopPropagation(); NP.openNP(); NP.npRight('devices'); return; } NP.openNP(); };
  // mini bar: swipe left/right to skip, swipe up to open Now Playing
  { const mb = $('#mbar'); let sx = 0, sy = 0, lock = null, dx = 0; const meta = () => mb.querySelector('.mb-meta'), art = () => mb.querySelector('.mb-art');
    mb.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; lock = null; dx = 0; }, { passive: true });
    mb.addEventListener('touchmove', (e) => {
      const x = e.touches[0].clientX - sx, y = e.touches[0].clientY - sy;
      if (!lock) { if (Math.abs(x) < 8 && Math.abs(y) < 8) return; lock = Math.abs(x) > Math.abs(y) ? 'h' : 'v'; }
      if (lock === 'h' && app.S.gest.miniSwipe) { e.preventDefault(); dx = x; for (const el of [meta(), art()]) { el.style.transition = 'none'; el.style.transform = `translateX(${x * 0.6}px)`; el.style.opacity = String(Math.max(0.2, 1 - Math.abs(x) / 220)); } }
      if (lock === 'v' && app.S.gest.miniUp && y < 0) { e.preventDefault(); mb.style.transform = `translateY(${Math.max(-40, y * 0.4)}px)`; }
    }, { passive: false });
    mb.addEventListener('touchend', (e) => {
      const y = e.changedTouches[0].clientY - sy;
      for (const el of [meta(), art()]) { el.style.transition = 'transform .35s cubic-bezier(.2,.9,.3,1), opacity .3s'; el.style.transform = ''; el.style.opacity = ''; }
      mb.style.transform = '';
      if (lock === 'h' && app.S.gest.miniSwipe && Math.abs(dx) > 70) { mb.addEventListener('click', (ev) => { ev.stopPropagation(); }, { capture: true, once: true }); haptic(10); dx < 0 ? player.next() : player.prev(); }
      else if (lock === 'v' && app.S.gest.miniUp && y < -40) { mb.addEventListener('click', (ev) => { ev.stopPropagation(); }, { capture: true, once: true }); NP.openNP(); }
    });
  }
  $('#barTitle').onclick = () => { const t = player.track; if (t) go('album', { key: albumKey(t) }); };
  $('#barArtist').onclick = () => { const t = player.track; if (t) go('artist', { key: albumKey(t).split('\u0001')[0] }); };
  $('#bar .bar-left').addEventListener('contextmenu', (e) => { const t = player.track; if (t) { e.preventDefault(); trackMenu([t.id], { x: e.clientX, y: e.clientY }); } });
  $('#bPanel').onclick = () => NP.togglePanel(); NP.watchDevices();
  $('#bMore').onclick = (e) => menu([
    { label: 'Equalizer & sound', icon: 'eq', action: NP.soundPanel },
    { label: 'Sleep timer', icon: 'moon', action: () => NP.sleepMenu({ el: $('#bMore'), up: true, right: true }) },
    { label: player.loop ? 'Practice (looping)' : 'Practice: loop & slow down', icon: 'loop', action: practicePanel },
    { label: `Speed: ${app.S.speed.toFixed(2)}×`, icon: 'speed', sub: () => [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2].map((s) => ({ label: s + '×', checked: app.S.speed === s, action: () => { app.S.speed = s; player.applySpeed(); app.saveS(); } })) },
    { label: `Crossfade: ${app.S.crossfade ? app.S.crossfade + 's' : 'Off'}`, icon: 'wave', sub: () => [0, 2, 4, 6, 8, 12].map((s) => ({ label: s ? s + ' seconds' : 'Off', checked: app.S.crossfade === s, action: () => { app.S.crossfade = s; app.saveS(); if (s && !player.engineOn) toast('Crossfade needs the audio engine (Settings)'); } })) },
    '-', { label: 'Song info', icon: 'info', action: () => NP.openPanel('info') }
  ], { el: e.currentTarget, up: true, right: true });
  $('#bMute').onclick = () => player.toggleMute();
  $('#bMini').onclick = () => NP.enterMini();
  $$('[data-ptab]').forEach((b) => (b.onclick = () => NP.openPanel(b.dataset.ptab)));

  const seekCfg = (el) => slider(el, { get: () => (player.duration ? player.time / player.duration : 0), set: (v) => player.seek(v * player.duration), preview: (v, hover) => { el.querySelector('.tip') && (el.querySelector('.tip').textContent = fmtTime(v * player.duration)); if (!hover && el.id === 'seek') flip($('#tCur'), fmtTime(v * player.duration)); } });
  seekS = seekCfg($('#seek')); npSeekS = seekCfg($('#npSeekBar'));
  volS = slider($('#volume'), { get: () => app.S.volume, set: (v) => player.setVolume(v), preview: (v, hover) => { if (!hover) player.setVolume(v); } });

  // keep a separate mini-player window in sync
  import('./companion.js').then((C) => { player.on((e) => { if (e !== 'time' && C.host.alive) C.pushState(); }); lib.on((e) => { if (e === 'liked' && C.host.alive) C.pushState(); }); });
  // player events
  player.on((e) => {
    if (e === 'time') updateTime();
    else if (e === 'track') { $('#seek').classList.remove('has-loop'); prioritizeCovers(); updateBar(); NP.onTrackChange(); rerenderTreesSoon(); saveSessionSoon(); setTraySoon(); }
    else if (e === 'state') { updateState(); NP.updateNP(); NP.updateMini(); setTraySoon(); if (!player.playing) saveSession(); }
    else if (e === 'mode') updateModes();
    else if (e === 'volume') updateVolume();
    else if (e === 'queue') { NP.onQueueChange(); saveSessionSoon(); prioritizeCovers(); }
    else if (e === 'settings') app.saveS();
    else if (e === 'played') { const src = player.source; if (src?.type === 'node') { for (const n of lib.nodePath(src.id)) { n.lastPlayed = Date.now(); n.plays = (n.plays || 0) + 1; } lib.save(); } }
    else if (e === 'error') toast("Couldn't play that file — skipping");
    else if (e === 'errorstop') toast("Several songs in a row couldn't be played, so Pulse stopped. Their files may have moved — try Settings → Rescan.", 6000);
    else if (e === 'loop') { const L = player.loop; const sk = $('#seek'); sk.classList.toggle('has-loop', !!L); if (L && player.duration) { sk.style.setProperty('--la', L.a / player.duration); sk.style.setProperty('--lb', L.b / player.duration); } }
    else if (e === 'sleepDone') toast('Sleep timer: paused playback');
  });
  const rerenderTreesSoon = debounce(rerenderTrees, 300);
  lib.on((e, d) => {
    if (e === 'liked') { const t = player.track; if (t && t.id === d) { setLikeBtn($('#barLike'), lib.isLiked(d)); setLikeBtn($('#mbLike'), lib.isLiked(d)); NP.updateNP(); NP.updateMini(); } rerenderTreesSoon(); }
    if (e === 'nodes') rerenderTreesSoon();
    if (e === 'scan') { if (d) pill.progress(d.label, d.done, d.total); else { pill.finish(); setTimeout(checkLikedFolders, 1200); } }
    // Library changes land in the background: never re-render mid-scan, refresh once quietly at the end
    if (e === 'cover') { patchCover(d); return; }
    if (e === 'index' && d?.quiet) return;
    // never redraw what you're looking at because of background work; an empty page is the one exception
    if (e === 'index' && !player.track) updateBar();
    if (e === 'index') { if (!lib.scanning) autoFill(); if (['home', 'songs', 'albums', 'artists', 'folders', 'library', 'search', 'genre', 'liked'].includes(app.view)) { if (emptyBefore() && !lib.scanning) quietRefresh(); else pendingRefresh = true; } }
  });

  // window controls (desktop)
  if (isDesktop) {
    const W = app.P.win;
    $('#wMin').onclick = W.minimize; $('#wMax').onclick = () => W.toggleMax(); $('#wClose').onclick = W.close;
    const dragAreas = ['#dragZone', '.tb-drag', '#titlebar', '.np-top'];
    document.addEventListener('pointerdown', async (e) => {
      if (e.button !== 0) return; const z = e.target.closest(dragAreas.join(',')); if (!z || e.target.closest('button, input, a, label, .np-src')) return;
      if (W._max) return; // maximized stays put — use the button or double-click the bar to restore
      W.dragFrom(e);
    });
    $('#titlebar').addEventListener('dblclick', (e) => { if (!e.target.closest('button, input, a, label')) $('#wMax').click(); });
    wireGrips();
  }

  // keyboard
  document.addEventListener('keydown', (e) => {
    const typing = e.target.matches('input, textarea, select, [contenteditable]');
    const k = e.key, ctrl = e.ctrlKey || e.metaKey;
    if (k === 'Escape') { if ($('#layer').children.length) { closeLayer(); return; } if (NP.isNPOpen()) { NP.closeNP(); return; } if (document.body.classList.contains('mini')) { NP.exitMini(); return; } if (typing) e.target.blur(); return; }
    if (ctrl && (k === 'k' || k === 'f')) { e.preventDefault(); if (app.isMobile) go('search'); else { $('#searchInput').focus(); $('#searchInput').select(); } return; }
    if (k === 'F11' && app.isDesktop) { e.preventDefault(); app.P.win.toggleMax(); return; }
    if (ctrl && k === ',') { e.preventDefault(); go('settings'); return; }
    if (ctrl && k === 'm') { e.preventDefault(); document.body.classList.contains('mini') ? NP.exitMini() : NP.enterMini(); return; }
    if (ctrl && k === 'b') { e.preventDefault(); $('#btnSide').click(); return; }
    if (e.altKey && k === 'ArrowLeft') { back(); return; } if (e.altKey && k === 'ArrowRight') { fwd(); return; }
    if (typing || ctrl || e.altKey) return;
    if (practiceKeys(e)) { e.preventDefault(); return; }
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
      case 'p': case 'P': NP.togglePanel(); break;
      case 'f': case 'F': NP.isNPOpen() ? NP.closeNP() : NP.openNP(); break;
      case '/': e.preventDefault(); $('#searchInput').focus(); break;
      // with a song loaded the media keys arrive through Media Session; handling them here too would toggle twice
      case 'MediaPlayPause': if (!msActive()) player.toggle(); break; case 'MediaTrackNext': if (!msActive()) player.next(); break; case 'MediaTrackPrevious': if (!msActive()) player.prev(); break;
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
// Covers: the song you're on and what's queued next always go first
function prioritizeCovers() {
  const ids = [player.current, ...player.upNext.slice(0, 30), ...player.upcomingContext(30).map((x) => x.id)].filter(Boolean);
  if (ids.length) lib.wantCovers(ids, true);
}
// Fill a newly found cover into whatever is on screen — no page redraw
function patchCover({ id, key }) {
  const t = lib.track(id); if (!t) return;
  const esc = (v) => (window.CSS?.escape ? CSS.escape(v) : v.replace(/"/g, '\\"'));
  if (id === player.current) { updateBar(); NP.refreshArt(); }
  for (const th of document.querySelectorAll(`.trow[data-id="${esc(id)}"] .th, .qrow[data-id="${esc(id)}"] .th`)) { if (!th.querySelector('img')) { th.innerHTML = coverImg(key, true); hydrate(th); } }
  const ak = albumKeyOf(t), ar = norm(primaryArtist(t.artist) || '');
  for (const cv of document.querySelectorAll(`[data-album="${esc(ak)}"] .cv, [data-album="${esc(ak)}"] .sw, [data-artist="${esc(ar)}"] .cv`)) {
    if (cv.querySelector('img')) continue; cv.querySelector(':scope > svg')?.remove(); cv.insertAdjacentHTML('afterbegin', coverImg(key, false)); hydrate(cv);
  }
  if (app.view === 'album' && app.params?.key === ak) { const ha = document.querySelector('.hero-art'); if (ha && !ha.querySelector('img')) { ha.querySelector(':scope > svg')?.remove(); ha.insertAdjacentHTML('afterbegin', coverImg(key, false)); hydrate(ha); } }
}
export async function autoRepairCovers() {
  repairing = true;
  const res = await lib.repairCovers((d, t) => pill.progress('Finding covers', d, t)).catch((e) => { console.warn(e); return null; });
  repairing = false; pill.finish(res?.fixed ? `Found ${res.fixed.toLocaleString()} cover${res.fixed === 1 ? '' : 's'}` : 'Covers checked');
  if (res?.fixed) updateBar();
  return res;
}
// The status pill: stays up long enough to read, counter never shifts the text, fades out gently
const pill = window.__pulsePill = {
  el: null, shownAt: 0, hideT: 0, added: 0,
  get node() { return (this.el ||= $('#scanPill')); },
  progress(label, done, total) {
    const n = this.node; clearTimeout(this.hideT);
    if (!n.classList.contains('show')) { this.shownAt = Date.now(); n.classList.add('show'); }
    n.classList.remove('done', 'has-new');
    const lbl = n.querySelector('.lbl'); if (lbl.textContent !== label) lbl.textContent = label;
    const cnt = n.querySelector('.cnt'); const w = String(total.toLocaleString()).length;
    cnt.style.minWidth = (w * 2 + 3) + 'ch';
    if (Date.now() - (this._ft || 0) < 250 && done < total) return; this._ft = Date.now(); // ~4 updates a second keeps it readable
    flip(cnt, `${done.toLocaleString().padStart(total.toLocaleString().length, ' ')} / ${total.toLocaleString()}`);
    this.added = total;
  },
  finish(msg) {
    const n = this.node; if (!n.classList.contains('show')) return;
    const wait = Math.max(0, 900 - (Date.now() - this.shownAt));
    clearTimeout(this.hideT);
    this.hideT = setTimeout(() => {
      n.classList.add('done'); n.querySelector('.lbl').textContent = msg || (pendingRefresh ? `${this.added.toLocaleString()} song${this.added === 1 ? '' : 's'} added` : 'Library up to date');
      n.querySelector('.cnt').textContent = ''; n.querySelector('.cnt').style.minWidth = ''; n.querySelector('.cnt')._flip = null;
      if (pendingRefresh && !emptyBefore()) { n.classList.add('has-new'); this.hideT = setTimeout(() => this.hide(), 9000); }
      else { if (pendingRefresh) { pendingRefresh = false; quietRefresh(); } this.hideT = setTimeout(() => this.hide(), 1800); }
    }, wait);
  },
  hide() { const n = this.node; n.classList.remove('show'); setTimeout(() => { if (!n.classList.contains('show')) n.classList.remove('done', 'has-new'); }, 500); }
};
// A folder called "Liked Songs" (or Liked / Favorites)? Offer to heart everything in it, optionally kept in sync.
const LIKED_RE = /^(liked|liked songs|my liked songs|favou?rites|loved|loved tracks)$/i;
const msActive = () => 'mediaSession' in navigator && !!navigator.mediaSession.metadata;
let likedAsking = false;
async function checkLikedFolders() {
  if (likedAsking || !lib.idx.folders) return;
  const S = app.S; S.likedFolders ||= {};
  const found = []; const walk = (n) => { for (const c of n.children.values()) { if (LIKED_RE.test(c.name.trim())) found.push(c); walk(c); } }; walk(lib.idx.folders);
  let changed = 0;
  for (const f of found) {
    const ids = lib.folderAllTracks(f); const st = S.likedFolders[f.key];
    if (st === 'sync') { for (const id of ids) if (!lib.db.liked[id]) { const t = lib.track(id); lib.db.liked[id] = t?.mtime || t?.added || Date.now(); changed++; } continue; }
    if (st || !ids.length || $('#layer').children.length) continue;
    likedAsking = true;
    const choice = await new Promise((res) => {
      const m = modal(`<h2>Make these your Liked Songs?</h2>
        <p style="margin:0 0 14px;opacity:.78;line-height:1.5">Pulse found a folder named <b>“${f.name.replace(/</g, '&lt;')}”</b> with <b>${ids.length.toLocaleString()} song${ids.length === 1 ? '' : 's'}</b>. Want to heart all of them so they show up in your Liked Songs?</p>
        <div class="opt"><div class="l"><b>Keep in sync</b><small>Songs added to this folder later get liked automatically</small></div><div class="r"><div class="tog on" id="lkSync"></div></div></div>
        <div class="row"><button class="pill" id="lkNo">Not now</button><button class="pill solid" id="lkYes">${ico('heart-f')}Like ${ids.length.toLocaleString()} songs</button></div>`);
      const tg = m.querySelector('#lkSync'); tg.onclick = () => tg.classList.toggle('on');
      m._onClose = () => res(null); // dismissed: ask again another time
      m.querySelector('#lkNo').onclick = () => { res('no'); closeLayer(); };
      m.querySelector('#lkYes').onclick = () => { const sync = tg.classList.contains('on'); res(sync ? 'sync' : 'once'); closeLayer(); };
    });
    likedAsking = false; if (!choice) break; S.likedFolders[f.key] = choice; app.saveS();
    if (choice !== 'no') { let c = 0; for (const id of ids) if (!lib.db.liked[id]) { const t = lib.track(id); lib.db.liked[id] = t?.mtime || t?.added || Date.now(); c++; } changed += c; toast(`Added ${c.toLocaleString()} songs to Liked Songs`); }
    break; // one question at a time
  }
  if (changed) { lib.save(); lib.emit('liked'); }
}
const emptyBefore = () => !document.querySelector('#view .trow, #view .card, #view .tile');
document.addEventListener('click', (e) => { if (e.target.closest('#scanPill .refresh')) { pendingRefresh = false; quietRefresh(); pill.hide(); } });
window.__pulseRepair = autoRepairCovers;

boot().catch((e) => { console.error(e); document.body.classList.remove('booting'); document.getElementById('view').innerHTML = `<div class="page"><div class="empty"><h3>Pulse failed to start</h3><p>${String(e.message || e)}</p></div></div>`; });
