// Now Playing overlay, side panel (queue / lyrics / info), visualizer, sound panel, sleep timer, mini player.
import { app, lib, player, toast, go, menu, modal, closeLayer, coverImg, hydrate, ico, setImg, setLikeBtn, burst, marquee, slider, applyAccent, hexToRgb, flip } from './core.js';
import { $, $$, esc, h, fmtTime, clamp, debounce } from './util.js';
import { EQ_FREQS, EQ_PRESETS } from './player.js';
import { trackMenu, albumKey, longPress } from './views.js';
import { fetchLyrics, songInfo, artistInfo, fillFromInfo, findCover } from './online.js';
import { companionSend, openCompanion, closeCompanion, pushState, host } from './companion.js';

// ---------------- LRC lyrics ----------------
function parseLRC(text) {
  const lines = []; let offset = 0;
  for (const raw of text.split(/\r?\n/)) {
    const off = /^\[offset:\s*([+-]?\d+)\]/i.exec(raw); if (off) { offset = +off[1] / 1000; continue; }
    const tags = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)]; if (!tags.length) continue;
    const txt = raw.replace(/\[[^\]]*\]/g, '').replace(/<\d+:\d+(?:\.\d+)?>/g, '').trim();
    for (const t of tags) lines.push({ t: +t[1] * 60 + parseFloat(t[2].replace(':', '.')) - offset, txt });
  }
  return lines.sort((a, b) => a.t - b.t);
}
const lyricCache = new Map();
async function getLyrics(t) {
  if (!t) return null; if (lyricCache.has(t.id)) return lyricCache.get(t.id);
  let text = null, src = '';
  if (t.lrc) { try { text = await app.P.readLrc(t); src = 'Synced lyrics (.lrc)'; } catch {} }
  if (!text && lib.db.lyrics[t.id]) { text = lib.db.lyrics[t.id]; src = lib.db.lyricSrc?.[t.id] === 'LRCLIB' ? 'Lyrics from LRCLIB' : lib.db.lyricSrc?.[t.id] === 'ai' ? 'Transcribed on this device (AI)' : 'Embedded lyrics'; }
  if (!text && !t.virtual) { text = await fetchLyrics(t).catch(() => null); if (text) src = 'Lyrics from LRCLIB'; }
  if (!text) { lyricCache.set(t.id, null); return null; }
  const synced = /\[\d{1,3}:\d{1,2}/.test(text) ? parseLRC(text) : null;
  const r = { synced: synced && synced.length > 2 ? synced : null, plain: text.replace(/\[[^\]]*\]/g, '').trim(), src };
  lyricCache.set(t.id, r); return r;
}
export async function lyricsEl(t) {
  const L = await getLyrics(t);
  if (!t) return h('<div class="empty"><p>Play something to see lyrics.</p></div>');
  if (!L) {
    const e = h(`<div class="empty" style="padding:36px 10px"><svg><use href="#i-lyrics"/></svg><h3>No lyrics found</h3><p>${t.virtual ? 'This one doesn’t have words.' : 'Nothing online or in the file. Pulse can listen to the song and write them out with on-device AI (beta) — rough on busy mixes, but synced.'}</p>${t.virtual ? '' : `<button class="pill solid" data-ai>${ico('spark')}Transcribe lyrics</button><small class="ai-st"></small>`}</div>`);
    e.querySelector('[data-ai]')?.addEventListener('click', async (ev) => {
      const b = ev.currentTarget, st = e.querySelector('.ai-st'); b.disabled = true;
      try {
        const { transcribeLyrics } = await import('./transcribe.js');
        const r = await transcribeLyrics(t, (msg, pct) => { st.textContent = msg + (pct ? ` ${Math.round(pct)}%` : ''); });
        if (!r) { st.textContent = 'Couldn’t make out any words in this song.'; b.disabled = false; return; }
        lyricCache.delete(t.id); toast('Lyrics transcribed'); drawPanel(); if (npTab === 'lyrics') { npTab = null; npRight('lyrics'); }
      } catch (err) { st.textContent = 'Transcription failed: ' + (err.message || err); b.disabled = false; }
    });
    return e;
  }
  if (!L.synced) return h(`<div class="lyrics plain">${L.plain.split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join('')}<div class="lyr-src">${esc(L.src)}</div></div>`);
  const el = h(`<div class="lyrics synced">${L.synced.map((l, i) => `<p data-i="${i}" data-t="${l.t}">${esc(l.txt) || '♪'}</p>`).join('')}<div class="lyr-src">${esc(L.src)}</div></div>`);
  el.addEventListener('click', (e) => { const p = e.target.closest('p[data-t]'); if (p) { player.seek(+p.dataset.t + 0.01); if (!player.playing) player.play(); } });
  let last = -1; let userScroll = 0;
  const sc = () => el.closest('#panelBody, .np-right');
  el.addEventListener('wheel', () => { userScroll = Date.now(); }, { passive: true }); el.addEventListener('touchmove', () => { userScroll = Date.now(); }, { passive: true });
  el.sync = () => {
    const tm = player.time + 0.15; let i = -1;
    for (let k = 0; k < L.synced.length; k++) { if (L.synced[k].t <= tm) i = k; else break; }
    if (i === last) return; last = i;
    const ps = el.children;
    for (let k = 0; k < L.synced.length; k++) { ps[k].classList.toggle('on', k === i); ps[k].classList.toggle('past', k < i); }
    const s = sc(); if (i >= 0 && s && Date.now() - userScroll > 3000) { const p = ps[i]; s.scrollTo({ top: p.offsetTop - s.clientHeight * 0.38, behavior: app.S.anim === 'off' ? 'auto' : 'smooth' }); }
  };
  setTimeout(() => el.sync(), 30);
  return el;
}

// ---------------- Queue ----------------
export function queueEl(dark) {
  const cur = player.track; const el = h('<div class="queue"></div>');
  const row = (id, extra = '', cls = '') => { const t = lib.track(id); if (!t) return ''; return `<div class="qrow ${cls}" data-id="${id}" ${extra}><div class="th">${t.cover ? coverImg(t.cover, true) : ico('note')}</div><div class="tt"><b>${esc(t.title)}</b><small>${esc(t.artist || 'Unknown Artist')}</small></div>${cls.includes('up') ? `<span class="grip" title="Drag to reorder">${ico('grip')}</span><button class="ib sm x" title="Remove">${ico('x')}</button>` : ''}</div>`; };
  let html = '';
  if (cur) html += `<div class="q-h">Now playing</div>${row(cur.id, '', 'cur')}`;
  if (player.upNext.length) html += `<div class="q-h">Next in queue <a data-clear>Clear</a></div>` + player.upNext.map((id, i) => row(id, `data-u="${i}" draggable="true"`, 'up')).join('');
  const ctx = player.upcomingContext(100);
  if (ctx.length) html += `<div class="q-h">Next from: ${esc(player.source?.label || 'Library')} <small>${player.shuffle ? 'Shuffled' : ''}</small></div>` + ctx.map((c) => row(c.id, `data-p="${c.p}"`)).join('');
  if (!cur && !html) html = '<div class="empty"><svg><use href="#i-queue"/></svg><p>Your queue is empty.</p></div>';
  el.innerHTML = html; hydrate(el);
  el.addEventListener('click', (e) => {
    const r = e.target.closest('.qrow'); if (!r) { if (e.target.closest('[data-clear]')) player.clearUpNext(); return; }
    if (e.target.closest('.x')) { player.removeUpNext(+r.dataset.u); return; }
    if (r.dataset.u != null) { const [id] = player.upNext.splice(+r.dataset.u, 1); player.load(id, true); player.emit('queue'); }
    else if (r.dataset.p != null) player.jumpTo(+r.dataset.p);
    else if (r.classList.contains('cur')) player.toggle();
  });
  el.addEventListener('contextmenu', (e) => { const r = e.target.closest('.qrow'); if (!r) return; e.preventDefault(); trackMenu([r.dataset.id], { x: e.clientX, y: e.clientY }); });
  let drag = null, over = null;
  el.addEventListener('dragstart', (e) => { const r = e.target.closest('.qrow.up'); if (!r) return; drag = +r.dataset.u; r.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'q'); });
  el.addEventListener('dragover', (e) => { if (drag == null) return; const r = e.target.closest('.qrow.up'); if (!r) return; e.preventDefault(); over?.classList.remove('drop-above'); over = r; r.classList.add('drop-above'); });
  el.addEventListener('drop', (e) => { if (drag == null || !over) return; e.preventDefault(); let to = +over.dataset.u; if (to > drag) to--; player.moveUpNext(drag, to); drag = null; });
  el.addEventListener('dragend', () => { drag = null; over?.classList.remove('drop-above'); });
  return el;
}
// Spotify-style "Now playing" view in the side panel (used instead of full screen on wide windows)
function infoEl() {
  const t = player.track; if (!t) return h('<div class="empty"><svg><use href="#i-note"/></svg><p>Nothing playing yet.</p></div>');
  const liked = lib.isLiked(t.id);
  const qual = [t.bitrate && t.bitrate + ' kbps', t.sampleRate && t.sampleRate / 1000 + ' kHz', t.bitDepth && t.bitDepth + '-bit'].filter(Boolean).join(' • ');
  const next = [...player.upNext.map((id) => ({ id })), ...player.upcomingContext(3)].slice(0, 3);
  const el = h(`<div class="npv">
    <div class="npv-art">${t.cover ? coverImg(t.cover, false) : `<div class="npv-ph">${ico('note')}</div>`}</div>
    <div class="npv-head"><div class="npv-meta"><div class="marq"><h2>${esc(t.title)}</h2></div><a data-ar>${esc(t.artist || 'Unknown artist')}</a></div>
      <button class="ib lk ${liked ? 'on' : ''}" data-lk title="Like">${ico(liked ? 'heart-f' : 'heart')}</button><button class="ib" data-mo title="More">${ico('more')}</button></div>
    <div class="npv-card"><div class="npv-ct">About this song</div><dl class="kv">${[['Album', t.album], ['Year', t.year || ''], ['Genre', t.genre], ['Plays', lib.db.plays[t.id] || 0], ['Quality', qual]].filter((x) => x[1] !== '' && x[1] != null).map(([k, v]) => `<dt>${k}</dt><dd>${k === 'Album' ? `<a data-al>${esc(v)}</a>` : esc(String(v))}</dd>`).join('')}</dl></div>
    ${next.length ? `<div class="npv-card"><div class="npv-ct">Next in queue <a data-q>Open queue</a></div>${next.map((x) => { const n = lib.track(x.id); return n ? `<div class="qrow" data-id="${x.id}"><div class="th">${n.cover ? coverImg(n.cover, true) : ico('note')}</div><div class="tt"><b>${esc(n.title)}</b><small>${esc(n.artist)}</small></div></div>` : ''; }).join('')}</div>` : ''}
    <button class="pill npv-full" data-full>${ico('expand')}Full screen</button>
  </div>`);
  hydrate(el);
  const q = (x) => el.querySelector(x);
  q('[data-ar]').onclick = () => go('artist', { key: albumKey(t).split('\u0001')[0] });
  q('[data-al]') && (q('[data-al]').onclick = () => go('album', { key: albumKey(t) }));
  q('[data-lk]').onclick = (e) => { lib.like(t.id); const b = e.currentTarget; setLikeBtn(b, lib.isLiked(t.id)); if (lib.isLiked(t.id)) burst(b); };
  q('[data-mo]').onclick = (e) => trackMenu([t.id], { el: e.currentTarget });
  q('[data-q]') && (q('[data-q]').onclick = () => openPanel('queue'));
  q('[data-full]').onclick = () => openNP(true);
  el.addEventListener('click', (e) => { const r = e.target.closest('.qrow'); if (r) { const i = player.upNext.indexOf(r.dataset.id); if (i >= 0) { player.upNext.splice(i, 1); player.load(r.dataset.id, true); player.emit('queue'); } else player.next(); } });
  requestAnimationFrame(() => marquee(q('.marq')));
  if (!t.virtual) onlineInfo(t, el);
  return el;
}
async function onlineInfo(t, el) {
  const [si, ai] = await Promise.all([songInfo(t).catch(() => null), artistInfo(t.artist).catch(() => null)]);
  if (!el.isConnected || player.track?.id !== t.id) return;
  const kv = el.querySelector('.npv .kv');
  if (si && kv) {
    const missing = (si.genre && !t.genre) || (si.year && !t.year) || (si.album && (!t.album || t.albumGuess));
    if (missing) { const b = h(`<button class="pill sm-pill">${ico('spark')}Fill in missing info</button>`); b.onclick = () => { if (fillFromInfo(t, si)) { toast('Song info updated'); drawPanel(); } }; kv.after(b); }
    if (si.url) { const a = h(`<a class="npv-link">${ico('ext')}Open in Apple Music</a>`); a.onclick = () => app.P.openURL?.(si.url) ?? window.open(si.url); (el.querySelector('.npv-card') || el).appendChild(a); }
  }
  if (ai?.bio) {
    const card = h(`<div class="npv-card npv-artist">${ai.img ? `<div class="npv-aimg" style="background-image:url('${ai.img.replace(/'/g, '%27')}')"></div>` : ''}<div class="npv-ct">About the artist</div><p>${esc(ai.bio)}</p>${ai.url ? `<a class="npv-link">${ico('ext')}Wikipedia</a>` : ''}</div>`);
    card.querySelector('.npv-link')?.addEventListener('click', () => app.P.openURL?.(ai.url) ?? window.open(ai.url));
    el.querySelector('.npv-full')?.before(card);
  }
}
let coverTry = '';
export function autoCover(t) { if (!t || t.cover || t.virtual || coverTry === t.id) return; coverTry = t.id; setTimeout(() => { if (!t.cover) findCover(t).catch(() => {}); }, 4000); }
// ---------------- Devices (where the sound comes out) ----------------
const devIcon = (l) => /airpods|buds|headphone|headset|earphone|wh-|wf-|beats|bose qc/i.test(l) ? 'headphones' : /hdmi|display|tv|nvidia|monitor|intel\(r\) display|amd high definition/i.test(l) ? 'tv' : /speaker|echo|alexa|soundbar|jbl|sonos|boom|ue /i.test(l) && !/realtek|laptop|internal/i.test(l) ? 'speaker' : 'laptop';
const cleanLabel = (l) => (l || '').replace(/^Default - /, '').replace(/\s*\((?:[0-9a-f]{4}:[0-9a-f]{4}|Bluetooth)\)\s*$/i, '').trim();
export async function devicesEl() {
  const el = h('<div class="devs"><div class="empty" style="padding:30px 0"><span class="spin"></span></div></div>');
  const draw = async (unlock) => {
    const T = app.isDesktop ? 'This computer' : 'This device';
    if (!player.canPickOutput()) {
      const air = !!window.WebKitPlaybackTargetAvailabilityEvent;
      el.innerHTML = `<div class="dev-cur"><div class="dev-ic">${ico(app.isMobile ? 'devices' : 'laptop')}</div><div class="dev-t"><b>${T}</b><small>Playing here</small></div></div>
        ${air ? `<button class="pill accent dev-air" data-air>${ico('airplay')}AirPlay & Bluetooth</button><p class="dev-note">Pick AirPods, a speaker, an Apple TV or your car — the same list as Control Center.</p>` : `<p class="dev-note">This browser doesn’t let apps choose a speaker. Change the output in your system’s sound settings instead.</p>`}`;
      el.querySelector('[data-air]')?.addEventListener('click', () => { player.el.webkitShowPlaybackTargetPicker?.(); });
      return;
    }
    const list = await player.outputs(unlock); const sink = player.sink;
    const def = list.find((d) => d.deviceId === 'default'); const defName = cleanLabel(def?.label) || 'System default';
    const others = list.filter((d) => d.deviceId !== 'default');
    const cur = sink === 'default' ? null : others.find((d) => d.deviceId === sink);
    const curName = cur ? cleanLabel(cur.label) : defName;
    const unnamed = list.length && list.every((d) => !d.label);
    el.innerHTML = `<div class="dev-cur"><div class="dev-ic on">${ico(cur ? devIcon(cur.label) : 'laptop')}</div><div class="dev-t"><b>${esc(curName)}</b><small>${cur ? 'Playing on this device' : `${T} • follows your Windows default`}</small></div><div class="eqbars"><i></i><i></i><i></i></div></div>
      <div class="dev-h">Select a device</div>
      <div class="dev-row ${!cur ? 'on' : ''}" data-dev="default"><div class="dev-ic">${ico('laptop')}</div><div class="dev-t"><b>${T}</b><small>Same as Windows: ${esc(defName)}</small></div>${!cur ? ico('check') : ''}</div>
      ${others.map((d, i) => { const name = cleanLabel(d.label) || `Audio output ${i + 1}`; const on = d.deviceId === sink; const bt = /bluetooth|airpods|buds|hands-free|stereo\)|wh-|wf-/i.test(d.label); return `<div class="dev-row ${on ? 'on' : ''}" data-dev="${esc(d.deviceId)}" data-name="${esc(name)}"><div class="dev-ic">${ico(devIcon(d.label))}</div><div class="dev-t"><b>${esc(name)}</b>${bt ? `<small>${ico('bluetooth')}Bluetooth</small>` : ''}</div>${on ? ico('check') : ''}</div>`; }).join('')}
      ${unnamed ? `<button class="pill dev-unlock" data-unlock>${ico('refresh')}Show device names</button><p class="dev-note">Windows only shares device names after you allow audio access once. Pulse never records anything — it lets go right away.</p>` : ''}
      <div class="dev-foot">
        <a data-bt>${ico('bluetooth')}<span>Pair a Bluetooth device</span>${ico('ext')}</a>
        <a data-help>${ico('info')}<span>What can I connect to?</span></a>
      </div>`;
  };
  el.addEventListener('click', async (e) => {
    const r = e.target.closest('[data-dev]');
    if (r) { if (r.classList.contains('on')) return; r.classList.add('busy'); try { await player.setOutput(r.dataset.dev, r.dataset.name); app.saveS(); toast(r.dataset.dev === 'default' ? 'Playing on this computer' : `Playing on ${r.dataset.name}`); } catch { toast('Couldn’t switch to that device'); } draw(); return; }
    if (e.target.closest('[data-unlock]')) { draw(true); return; }
    if (e.target.closest('[data-bt]')) { app.P.openURL('ms-settings:bluetooth'); return; }
    if (e.target.closest('[data-help]')) modal(`<h2>What can I connect to?</h2><p style="line-height:1.55;color:var(--tx2)">Anything Windows can play sound through: <b>Bluetooth</b> headphones and speakers (including an Echo or Google speaker paired over Bluetooth), your <b>TV or monitor over HDMI</b>, <b>USB</b> headsets and DACs, and your computer’s own speakers.<br><br>Switching here only moves Pulse — the rest of your PC keeps using the Windows default. Pulse remembers your choice and goes back to it when the device reconnects.<br><br><b>Google Cast and Wi-Fi Echo streaming</b> aren’t available: the window Pulse runs in has no casting built in. Pair the speaker over Bluetooth instead and it shows up here.</p><div class="row"><button class="pill solid" id="ok">Got it</button></div>`).querySelector('#ok').onclick = () => closeLayer();
  });
  el.redraw = draw;
  draw(false);
  return el;
}
let devWatch = false;
export function watchDevices() {
  if (devWatch || !navigator.mediaDevices?.addEventListener) return; devWatch = true;
  navigator.mediaDevices.addEventListener('devicechange', async () => {
    const sink = player.sink; if (app.S.panel === 'devices') drawPanel();
    if (sink === 'default' && !app.S._lostSink) return;
    const list = await player.outputs(false); const want = app.S._lostSink || sink;
    if (app.S._lostSink && list.some((d) => d.deviceId === want)) { await player.setOutput(want, app.S.sinkLabel).catch(() => {}); app.S._lostSink = null; app.saveS(); toast(`Back on ${app.S.sinkLabel}`); return; }
    if (sink !== 'default' && !list.some((d) => d.deviceId === sink)) { // e.g. Bluetooth headphones turned off
      player.pause?.(); toast(`${app.S.sinkLabel || 'Your device'} disconnected — paused`);
      const label = app.S.sinkLabel; await player.setOutput('default').catch(() => {}); app.S._lostSink = sink; app.S.sinkLabel = label; app.saveS();
    }
  });
  player.restoreOutput?.();
}

// Wide windows get the side-panel view; narrow ones (and the full-screen button) get the full-screen player
export function npUsesPanel() { return !app.isMobile && (app.S.npView || 'panel') !== 'full'; }
export function showNowPlaying() { if (npUsesPanel()) openPanel('info'); else openNP(true); }

// ---------------- Side panel ----------------
let panelLyrics = null;
// Side panel: an embedded card next to the main view. One bar button shows/hides it; tabs switch inside.
export async function openPanel(tab) {
  const S = app.S; tab = tab || S.panel || 'info';
  if (app.isMobile) { openNP(); npRight(tab === 'info' ? 'queue' : tab); return; }
  const same = S.panel === tab && document.body.classList.contains('panel-open');
  S.panel = tab; S.panelOpen = true; app.saveS(); document.body.classList.add('panel-open');
  $$('[data-ptab]').forEach((b) => b.classList.toggle('on', b.dataset.ptab === tab));
  $('#bPanel')?.classList.add('on');
  if (!same) await drawPanel();
}
export function togglePanel() { document.body.classList.contains('panel-open') ? closePanel() : openPanel(); }
export function closePanel() { app.S.panelOpen = false; app.saveS(); document.body.classList.remove('panel-open'); $('#bPanel')?.classList.remove('on'); panelLyrics = null; }
export async function drawPanel() {
  const tab = app.S.panel || 'info'; if (!document.body.classList.contains('panel-open')) return;
  const body = $('#panelBody'); const st = body.scrollTop;
  const el = tab === 'queue' ? queueEl() : tab === 'lyrics' ? await lyricsEl(player.track) : tab === 'devices' ? await devicesEl() : infoEl();
  body.innerHTML = ''; body.appendChild(el); panelLyrics = tab === 'lyrics' ? el : null;
  if (tab === 'queue') body.scrollTop = st;
}

// ---------------- Now playing overlay ----------------
let npOpen = false, npTab = null, npLyr = null;
export function isNPOpen() { return npOpen; }
export function openNP(full) {
  if (npOpen) return; npOpen = true; const np = $('#np');
  np.classList.add('open'); np.setAttribute('aria-hidden', 'false'); updateNP(); startViz();
  if (app.isMobile) history.pushState({ np: 1 }, '');
}
export function closeNP() {
  if (!npOpen) return; npOpen = false; const np = $('#np'); np.classList.remove('open'); np.setAttribute('aria-hidden', 'true'); stopViz();
}
export async function npRight(tab) {
  const r = $('#npRight');
  if (npTab === tab || !tab) { npTab = null; r.innerHTML = ''; npLyr = null; $$('[data-np]').forEach((b) => b.classList.remove('on')); return; }
  npTab = tab; $$('[data-np]').forEach((b) => b.classList.toggle('on', b.dataset.np === tab));
  const el = tab === 'lyrics' ? await lyricsEl(player.track) : tab === 'devices' ? await devicesEl() : queueEl(true);
  r.innerHTML = ''; r.appendChild(el); npLyr = tab === 'lyrics' ? el : null;
}
let lastNPTrack = null;
export async function updateNP() {
  const t = player.track; const np = $('#np');
  np.classList.toggle('paused', !player.playing);
  $('#npPlay').classList.toggle('is-playing', player.playing);
  if (!t) return;
  if ($('#npTitle').textContent !== t.title) $('#npTitle').textContent = t.title; $('#npArtist').textContent = t.artist || 'Unknown Artist';
  if (npOpen) marquee($('#npTitleWrap'));
  $('#npSource').textContent = player.source?.label || 'Your library';
  setLikeBtn($('#npLike'), lib.isLiked(t.id));
  $('#npShuffle').classList.toggle('on', player.shuffle); $('#npRepeat').classList.toggle('on', player.repeat !== 'off');
  $('#npRepeat use').setAttribute('href', player.repeat === 'one' ? '#i-repeat1' : '#i-repeat');
  if (lastNPTrack !== t.id && npOpen) {
    lastNPTrack = t.id;
    const inner = $('.np-art-inner'); inner.classList.remove('swap'); void inner.offsetWidth; if (app.S.anim !== 'off') inner.classList.add('swap');
    setImg($('#npArt img'), t.cover, false);
    const u = t.cover ? await app.P.coverURL(t.cover, true) : null;
    for (const b of $$('.np-bg img')) { if (u) b.src = u; b.style.opacity = u ? '' : '0'; }
    const col = lib.db.covers[t.cover]?.color;
    const base = col ? hexToRgb(col) : getComputedStyle(document.documentElement).getPropertyValue('--acc-rgb').split(',').map((v) => +v || 60);
    np.style.setProperty('--np-bg', base.map((v) => Math.round(v * 0.22 + 6)).join(','));
    np.style.setProperty('--np-bg2', base.map((v) => Math.round(v * 0.5 + 10)).join(','));
    if (npTab === 'lyrics') { npTab = null; npRight('lyrics'); } else if (npTab === 'queue') { npTab = null; npRight('queue'); }
  }
}
function wireNP() {
  $('#npClose').onclick = closeNP;
  $('#npPlay').onclick = () => player.toggle(); $('#npNext').onclick = () => player.next(); $('#npPrev').onclick = () => player.prev();
  $('#npShuffle').onclick = () => player.toggleShuffle(); $('#npRepeat').onclick = () => player.cycleRepeat();
  $('#npLike').onclick = (e) => { const t = player.track; if (!t) return; lib.like(t.id); if (lib.isLiked(t.id)) burst(e.currentTarget); };
  $('#npArtist').onclick = () => { const t = player.track; if (t) { closeNP(); go('artist', { key: albumKey(t).split('\u0001')[0] }); } };
  $('#npMore').onclick = (e) => { const t = player.track; if (t) trackMenu([t.id], { el: e.currentTarget, right: true }); };
  $$('[data-np]').forEach((b) => b.addEventListener('click', (e) => {
    const k = b.dataset.np;
    if (k === 'lyrics' || k === 'queue') npRight(k);
    else if (k === 'viz') { const order = ['bars', 'wave', 'orb', 'off']; app.S.viz = order[(order.indexOf(app.S.viz) + 1) % order.length]; app.saveS(); toast('Visualizer: ' + { bars: 'Bars', wave: 'Wave', orb: 'Pulse orb', off: 'Off' }[app.S.viz]); if (!player.engineOn && app.S.viz !== 'off') toast('Turn on the audio engine in Settings for the visualizer'); }
    else if (k === 'sound') soundPanel();
    else if (k === 'sleep') sleepMenu({ el: b, up: true });
  }));
  // 3D tilt on the cover
  const art = $('#npArt'); const inner = $('.np-art-inner');
  art.addEventListener('pointermove', (e) => { if (app.isMobile || app.S.anim === 'off') return; const r = art.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5; inner.style.transform = `rotateY(${x * 10}deg) rotateX(${-y * 10}deg) scale(1.02)`; inner.style.setProperty('--shine', 1); $('.np-shine').style.backgroundPosition = `${x * 100}% 0`; });
  art.addEventListener('pointerleave', () => { inner.style.transform = ''; inner.style.setProperty('--shine', 0); });
  art.addEventListener('dblclick', () => { if (app.S.gest?.artDouble === false && app.isMobile) return; const t = player.track; if (t) { lib.like(t.id); burst($('#npLike')); } });
  // gestures: swipe down to close, swipe on art to skip
  let sx = 0, sy = 0, st = 0, dragging = false; const np = $('#np');
  np.addEventListener('touchstart', (e) => { if (e.target.closest('.np-right, .slider')) return; sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now(); dragging = true; }, { passive: true });
  np.addEventListener('touchmove', (e) => { if (!dragging) return; const dy = e.touches[0].clientY - sy, dx = e.touches[0].clientX - sx; if (dy > 0 && Math.abs(dy) > Math.abs(dx) && app.S.gest?.npDown !== false) { np.style.transition = 'none'; np.style.transform = `translateY(${dy}px)`; } else if (Math.abs(dx) > Math.abs(dy) && e.target.closest('#npArt') && app.S.gest?.artSwipe !== false) { inner.style.transform = `translateX(${dx * 0.6}px) rotate(${dx * 0.02}deg)`; } }, { passive: true });
  np.addEventListener('touchend', (e) => {
    if (!dragging) return; dragging = false; const dy = e.changedTouches[0].clientY - sy, dx = e.changedTouches[0].clientX - sx; const v = Math.abs(dy) / (Date.now() - st);
    np.style.transition = ''; np.style.transform = ''; inner.style.transform = '';
    if (app.S.gest?.npDown !== false && (dy > 140 || (dy > 50 && v > 0.6))) { if (history.state?.np) history.back(); else closeNP(); }
    else if (app.S.gest?.artSwipe !== false && e.target.closest('#npArt') && Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy)) dx < 0 ? player.next() : player.prev();
  });
  addEventListener('popstate', () => { if (npOpen) closeNP(); });
}

// ---------------- Visualizer ----------------
let vizRaf = 0;
function startViz() {
  const c = $('#viz'); const x = c.getContext('2d'); const an = player.analyser(); if (!an) return;
  const buf = new Uint8Array(an.frequencyBinCount); const wave = new Uint8Array(an.fftSize);
  let smooth = new Float32Array(64);
  const loop = () => {
    vizRaf = requestAnimationFrame(loop);
    const mode = app.S.viz; if (mode === 'off' || !player.playing && mode !== 'orb') { x.clearRect(0, 0, c.width, c.height); if (mode === 'off') return; }
    const dpr = Math.min(devicePixelRatio, 2); const W = c.clientWidth * dpr, H = c.clientHeight * dpr;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    x.clearRect(0, 0, W, H);
    const acc = getComputedStyle(document.documentElement).getPropertyValue('--acc-rgb').trim() || '255,255,255';
    if (mode === 'bars') {
      an.getByteFrequencyData(buf); const n = 64; const bw = W / n;
      for (let i = 0; i < n; i++) {
        const lo = Math.floor(Math.pow(i / n, 2) * buf.length * 0.7), hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1) / n, 2) * buf.length * 0.7));
        let s = 0; for (let k = lo; k < hi; k++) s += buf[k]; const v = s / (hi - lo) / 255;
        smooth[i] = smooth[i] * 0.6 + v * 0.4; const bh = Math.pow(smooth[i], 1.4) * H;
        const g = x.createLinearGradient(0, H - bh, 0, H); g.addColorStop(0, `rgba(${acc},.9)`); g.addColorStop(1, `rgba(${acc},0)`);
        x.fillStyle = g; const r = Math.min(bw * 0.35, 6); const bx = i * bw + bw * 0.18, bwid = bw * 0.64;
        x.beginPath(); x.roundRect ? x.roundRect(bx, H - bh, bwid, bh, [r, r, 0, 0]) : x.rect(bx, H - bh, bwid, bh); x.fill();
      }
    } else if (mode === 'wave') {
      an.getByteTimeDomainData(wave); x.lineWidth = 3 * dpr; x.strokeStyle = `rgba(${acc},.85)`; x.shadowColor = `rgba(${acc},.8)`; x.shadowBlur = 20 * dpr; x.beginPath();
      for (let i = 0; i < wave.length; i += 4) { const px = (i / wave.length) * W, py = H * 0.55 + ((wave[i] - 128) / 128) * H * 0.4; i ? x.lineTo(px, py) : x.moveTo(px, py); }
      x.stroke(); x.shadowBlur = 0;
    } else if (mode === 'orb') {
      an.getByteFrequencyData(buf); let bass = 0; for (let k = 0; k < 12; k++) bass += buf[k]; bass /= 12 * 255;
      const cx = W / 2, cy = H * 0.9, R = Math.min(W, H * 2) * (0.25 + bass * 0.25);
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, R); g.addColorStop(0, `rgba(${acc},${0.35 + bass * 0.4})`); g.addColorStop(1, `rgba(${acc},0)`);
      x.fillStyle = g; x.fillRect(0, 0, W, H);
    }
  };
  cancelAnimationFrame(vizRaf); loop();
}
function stopViz() { cancelAnimationFrame(vizRaf); vizRaf = 0; }

// ---------------- Sound panel ----------------
export function soundPanel() {
  const S = app.S;
  const m = modal(`<h2>Sound <button class="ib sm" data-close>${ico('x')}</button></h2>
    ${!player.engineOn ? `<div class="opt"><div class="l"><b>Audio engine is off</b><small>EQ, crossfade, leveler and visualizer need it.${app.isDesktop ? '' : ' On iPhone it may pause audio when the screen locks.'}</small></div><div class="r"><button class="pill solid" data-eng>Turn on</button></div></div>` : ''}
    <div class="opt"><div class="l"><b>Equalizer</b></div><div class="r"><select class="inp" id="preset" style="width:160px;height:34px">${Object.keys(EQ_PRESETS).map((p) => `<option ${S.eqPreset === p ? 'selected' : ''}>${p}</option>`).join('')}<option ${!EQ_PRESETS[S.eqPreset] ? 'selected' : ''}>Custom</option></select><div class="tog ${S.eqOn ? 'on' : ''}" id="eqOn"></div></div></div>
    <div class="eq">${EQ_FREQS.map((f, i) => `<div class="band"><b>${(S.eq[i] > 0 ? '+' : '') + S.eq[i]}</b><input type="range" min="-12" max="12" step="1" value="${S.eq[i]}" data-band="${i}"><span>${f >= 1000 ? f / 1000 + 'k' : f}</span></div>`).join('')}</div>
    <div class="opt"><div class="l"><b>Preamp</b></div><div class="r"><input type="range" min="-12" max="6" step="0.5" value="${S.preamp}" id="pre"><span class="val" id="preV">${S.preamp} dB</span></div></div>
    <div class="opt"><div class="l"><b>Playback speed</b><small>Applies to all songs</small></div><div class="r"><input type="range" min="0.5" max="2" step="0.05" value="${S.speed}" id="spd"><span class="val" id="spdV">${S.speed.toFixed(2)}×</span></div></div>
    <div class="opt"><div class="l"><b>Keep pitch when changing speed</b></div><div class="r"><div class="tog ${S.keepPitch ? 'on' : ''}" id="pitch"></div></div></div>
    <div class="opt"><div class="l"><b>Crossfade</b></div><div class="r"><input type="range" min="0" max="12" step="1" value="${S.crossfade}" id="xf"><span class="val" id="xfV">${S.crossfade ? S.crossfade + 's' : 'Off'}</span></div></div>
    <div class="opt"><div class="l"><b>Volume leveler</b><small>Evens out loudness between songs</small></div><div class="r"><div class="tog ${S.leveler ? 'on' : ''}" id="lev"></div></div></div>
    <div class="opt"><div class="l"><b>Sleep timer</b><small id="slpV">${sleepLabel()}</small></div><div class="r"><button class="pill" id="slp">${ico('moon')}Set</button></div></div>`);
  const save = () => { app.saveS(); };
  m.querySelector('[data-eng]')?.addEventListener('click', () => { S.engine = 'on'; player.enableEngine(); save(); closeLayer(); soundPanel(); });
  const eqOn = m.querySelector('#eqOn'); eqOn.onclick = () => { S.eqOn = !S.eqOn; eqOn.classList.toggle('on', S.eqOn); player.applyEQ(); save(); };
  const sel = m.querySelector('#preset');
  sel.onchange = () => { const p = EQ_PRESETS[sel.value]; if (!p) return; S.eq = [...p]; S.eqPreset = sel.value; S.eqOn = true; eqOn.classList.add('on'); $$('[data-band]', m).forEach((r, i) => { r.value = S.eq[i]; r.previousElementSibling.textContent = (S.eq[i] > 0 ? '+' : '') + S.eq[i]; }); player.applyEQ(); save(); };
  m.addEventListener('input', (e) => {
    const b = e.target.closest('[data-band]');
    if (b) { const i = +b.dataset.band; S.eq[i] = +b.value; b.previousElementSibling.textContent = (S.eq[i] > 0 ? '+' : '') + S.eq[i]; S.eqPreset = 'Custom'; sel.value = 'Custom'; if (!S.eqOn) { S.eqOn = true; eqOn.classList.add('on'); } player.applyEQ(); save(); }
    if (e.target.id === 'pre') { S.preamp = +e.target.value; m.querySelector('#preV').textContent = S.preamp + ' dB'; player.applyEQ(); save(); }
    if (e.target.id === 'spd') { S.speed = +e.target.value; m.querySelector('#spdV').textContent = S.speed.toFixed(2) + '×'; player.applySpeed(); save(); }
    if (e.target.id === 'xf') { S.crossfade = +e.target.value; m.querySelector('#xfV').textContent = S.crossfade ? S.crossfade + 's' : 'Off'; save(); }
  });
  m.querySelector('#spd').ondblclick = () => { S.speed = 1; m.querySelector('#spd').value = 1; m.querySelector('#spdV').textContent = '1.00×'; player.applySpeed(); save(); };
  const pitch = m.querySelector('#pitch'); pitch.onclick = () => { S.keepPitch = !S.keepPitch; pitch.classList.toggle('on', S.keepPitch); player.applySpeed(); save(); };
  const lev = m.querySelector('#lev'); lev.onclick = () => { S.leveler = !S.leveler; lev.classList.toggle('on', S.leveler); player.applyLeveler(); save(); };
  m.querySelector('#slp').onclick = (e) => sleepMenu({ el: e.currentTarget, right: true });
}
function sleepLabel() { const s = player.sleep; if (!s) return 'Off'; if (s.mode === 'track') return 'Stops at end of this song'; const l = Math.max(0, s.end - Date.now()); return `Stops in ${Math.ceil(l / 60000)} min`; }
export function sleepMenu(at) {
  menu([{ header: 'Sleep timer — ' + sleepLabel() }, ...[5, 10, 15, 30, 45, 60, 90].map((m) => ({ label: `${m} minutes`, icon: 'moon', action: () => { player.setSleep(m); toast(`Sleep timer set for ${m} min`); } })), { label: 'End of this song', icon: 'note', action: () => { player.setSleep('track'); toast('Stopping after this song'); } }, player.sleep && '-', player.sleep && { label: 'Turn off timer', icon: 'x', action: () => { player.setSleep(null); toast('Sleep timer off'); } }], at);
}

// ---------------- Mini player (desktop) ----------------
export const MINI_SIZES = { bar: [420, 104], card: [300, 440], square: [270, 270], strip: [440, 46], art: [220, 220] };
let saved = null;
// Keep the mini player fully on the screen it's on (after dragging, resizing or switching layouts)
export async function keepOnScreen() {
  if (!app.isDesktop) return; const W = app.P.win; const dpr = devicePixelRatio || 1;
  try {
    const p = await W.getPos(); const sc = screen; const w = innerWidth * dpr, h = innerHeight * dpr;
    const L = (sc.availLeft || 0) * dpr, T = (sc.availTop || 0) * dpr, R = L + sc.availWidth * dpr, B = T + sc.availHeight * dpr;
    const x = Math.round(Math.min(Math.max(p.x, L), R - w)), y = Math.round(Math.min(Math.max(p.y, T), B - h));
    if (x !== p.x || y !== p.y) await W.move(x, y);
    return { x, y };
  } catch { return null; }
}
// beginDrag hands the move to Windows, so watch the position until it settles, then pull it back on screen
async function afterDrag() {
  const pos = await keepOnScreen(); if (!pos) return;
  if (app.companion) companionSend('geom', pos); else { app.S.mini.x = pos.x; app.S.mini.y = pos.y; app.saveS(); }
}
export async function enterMini() {
  if (!app.isDesktop || document.body.classList.contains('mini')) return;
  if (app.S.mini.separate) { (await import('./companion.js')).openCompanion(); return; }
  const W = app.P.win; closeNP(); closeLayer();
  try { saved = { size: await W.getSize(), pos: await W.getPos(), max: await W.isMax() }; if (saved.max) await W.unmax(); } catch {}
  document.body.classList.add('mini'); applyMini(); updateMini(true);
  const [w, h] = MINI_SIZES[app.S.mini.layout] || MINI_SIZES.bar;
  const mw = app.S.mini.w?.[app.S.mini.layout], mh = app.S.mini.h?.[app.S.mini.layout];
  await W.setSize(mw || w, mh || h);
  if (app.S.mini.x != null) await W.move(app.S.mini.x, app.S.mini.y);
  W.onTop(app.S.mini.onTop); keepOnScreen();
  if (app.S.mini.desktopBlur) app.P.fixFrame?.(true);
}
export async function exitMini() {
  if (app.companion) { companionSend('exit'); setTimeout(() => window.Neutralino.app.exit(), 200); return; }
  if (!document.body.classList.contains('mini')) return; const W = app.P.win;
  if (app.S.mini.desktopBlur) app.P.fixFrame?.(false);
  try { const p = await W.getPos(); app.S.mini.x = p.x; app.S.mini.y = p.y; const s = await W.getSize(); (app.S.mini.w ||= {})[app.S.mini.layout] = s.width; (app.S.mini.h ||= {})[app.S.mini.layout] = s.height; app.saveS(); } catch {}
  document.body.classList.remove('mini'); W.onTop(false);
  if (saved) { await W.setSize(saved.size.width, saved.size.height); W.move(saved.pos.x, saved.pos.y); if (saved.max) W.toggleMax(); }
}
export function applyMini() {
  const M = app.S.mini, mini = $('#mini');
  mini.className = 'miniplayer l-' + M.layout + (player.playing ? '' : ' paused');
  const st = mini.style; st.setProperty('--mini-a', M.opacity); st.setProperty('--mini-blur', M.blur + 'px'); st.setProperty('--mini-r', M.radius + 'px'); st.setProperty('--mini-art', M.art ? 0.9 : 0);
  document.body.classList.toggle('mini-noart', !M.art); document.body.classList.toggle('mini-noprog', !M.progress); document.body.classList.toggle('mini-notimes', !M.times);
  $('#mini [data-m=pin]').classList.toggle('on', M.onTop);
  miniModes();
}
export function miniModes() {
  const m = $('#mini'); if (!m) return;
  m.querySelector('[data-m=shuffle]').classList.toggle('on', player.shuffle);
  m.querySelector('[data-m=repeat]').classList.toggle('on', player.repeat !== 'off');
  m.querySelector('[data-m=repeat] use').setAttribute('href', player.repeat === 'one' ? '#i-repeat1' : '#i-repeat');
  const v = app.S.muted ? 0 : app.S.volume;
  m.querySelector('[data-m=mute] use').setAttribute('href', v === 0 ? '#i-vol-x' : v < 0.5 ? '#i-vol-low' : '#i-vol');
  miniVol?.update(v); m.querySelector('#miniVol').style.setProperty('--v', v);
}
let lastMini = null;
export async function updateMini(force) {
  if (!document.body.classList.contains('mini') && !force) return;
  const t = player.track; const mini = $('#mini');
  mini.classList.toggle('paused', !player.playing);
  $('#mini [data-m=play]').classList.toggle('is-playing', player.playing);
  if (!t) return;
  setLikeBtn($('#mini [data-m=like]'), lib.isLiked(t.id));
  if (lastMini !== t.id || force) {
    lastMini = t.id; $('#miniTitle').textContent = t.title; $('#miniArtist').textContent = t.artist || 'Unknown Artist';
    setImg($('.mini-art img'), t.cover, app.S.mini.layout === 'strip' || app.S.mini.layout === 'bar');
    const u = t.cover ? await app.P.coverURL(t.cover, true) : null; const bg = $('.mini-bg img'); if (u) bg.src = u; else bg.removeAttribute('src');
    marquee($('#mini .marq'));
  }
}
export function miniTime() {
  const d = player.duration, c = player.time;
  miniSeek?.update(d ? c / d : 0);
  flip($('#miniCur'), fmtTime(c)); flip($('#miniDur'), fmtTime(d));
}
let miniSeek, miniVol;
function wireMini() {
  const mini = $('#mini');
  mini.addEventListener('click', async (e) => {
    if (e.target.closest('.mini-hover .trig')) { e.target.closest('.mini-hover').classList.toggle('open'); return; }
    const b = e.target.closest('[data-m]'); if (!b) return; const k = b.dataset.m; const M = app.S.mini;
    if (k === 'play') player.toggle(); else if (k === 'next') player.next(); else if (k === 'prev') player.prev();
    else if (k === 'shuffle') { player.toggleShuffle(); miniModes(); }
    else if (k === 'repeat') { player.cycleRepeat(); miniModes(); }
    else if (k === 'mute') { player.toggleMute(); miniModes(); }
    else if (k === 'like') { const t = player.track; if (t) { lib.like(t.id); updateMini(); } }
    else if (k === 'exit') exitMini();
    else if (k === 'pin') { M.onTop = !M.onTop; app.P.win.onTop(M.onTop); applyMini(); app.saveS(); toast(M.onTop ? 'Always on top' : 'Not on top'); }
    else if (k === 'layout') {
      const order = ['bar', 'card', 'square', 'strip', 'art']; const W = app.P.win;
      try { const s = await W.getSize(); (M.w ||= {})[M.layout] = s.width; (M.h ||= {})[M.layout] = s.height; } catch {}
      M.layout = order[(order.indexOf(M.layout) + 1) % order.length]; app.saveS(); applyMini(); updateMini(true);
      const [w, h] = MINI_SIZES[M.layout]; await W.setSize(M.w?.[M.layout] || w, M.h?.[M.layout] || h); keepOnScreen();
    } else if (k === 'custom') { if (app.companion) companionSend('custom'); else await exitMiniForCustom(); }
  });
  // drag window from anywhere that's not a control
  // every layout drags from anywhere that isn't a control (images can't start an HTML drag and steal it)
  mini.addEventListener('dragstart', (e) => e.preventDefault());
  mini.addEventListener('pointerdown', (e) => { if (e.button !== 0 || e.target.closest('button, .slider, .mini-hover.open')) return; e.preventDefault(); app.P.win.dragFrom(e, (moved) => moved && afterDrag()); });
  mini.addEventListener('dblclick', (e) => { if (!e.target.closest('button, .slider')) exitMini(); });
  mini.addEventListener('wheel', (e) => { player.setVolume(app.S.volume - Math.sign(e.deltaY) * 0.05); toast(`Volume ${Math.round(app.S.volume * 100)}%`, 700); }, { passive: true });
  mini.addEventListener('contextmenu', (e) => { e.preventDefault(); miniMenu({ x: e.clientX, y: e.clientY }); });
  miniSeek = slider($('#miniSeek'), { get: () => player.duration ? player.time / player.duration : 0, set: (v) => player.seek(v * player.duration) });
  miniVol = slider($('#miniVol'), { get: () => app.S.volume, set: (v) => { player.setVolume(v); miniModes(); }, preview: (v, hover) => { if (!hover) player.setVolume(v); } });
  player.on((e) => { if (e === 'mode' || e === 'volume') miniModes(); });
}
function miniMenu(at) {
  const M = app.S.mini;
  menu([{ header: 'Layout' }, ...[['bar', 'Bar'], ['card', 'Card'], ['square', 'Square cover'], ['strip', 'Slim strip'], ['art', 'Cover only']].map(([k, l]) => ({ label: l, checked: M.layout === k, action: async () => { M.layout = k; app.saveS(); applyMini(); updateMini(true); const [w, h] = MINI_SIZES[k]; await app.P.win.setSize(M.w?.[k] || w, M.h?.[k] || h); keepOnScreen(); } })), '-', { label: 'Customize…', icon: 'palette', action: () => (app.companion ? companionSend('custom') : exitMiniForCustom()) }, { label: M.onTop ? 'Unpin from top' : 'Always on top', icon: 'pin', action: () => { M.onTop = !M.onTop; app.P.win.onTop(M.onTop); applyMini(); app.saveS(); } }, { label: 'Back to full player', icon: 'expand', action: exitMini }], at);
}
async function exitMiniForCustom() { await exitMini(); miniCustomize(); }
export function miniCustomize() {
  const M = app.S.mini;
  const seg = (k, opts) => `<div class="seg" data-mseg="${k}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(M[k]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const tg = (k) => `<div class="tog ${M[k] ? 'on' : ''}" data-mtog="${k}"></div>`;
  const rg = (k, min, max, step, fmt) => `<input type="range" min="${min}" max="${max}" step="${step}" value="${k === 'transp' ? 1 - M.opacity : M[k]}" data-mr="${k}"><span class="val">${fmt(k === 'transp' ? 1 - M.opacity : M[k])}</span>`;
  const pct = (v) => Math.round(v * 100) + '%', px = (v) => v + 'px';
  const m = modal(`<h2>Mini player <button class="ib sm" data-close>${ico('x')}</button></h2>
    <p class="mc-live">${ico('mini')}<span>Your real mini player is open next to Pulse — changes show on it as you make them.</span></p>
    <div class="opt"><div class="l"><b>Opens as</b><small>A separate window keeps the main app open alongside it</small></div><div class="r">${seg('separate', [['false', 'Replaces the main window'], ['true', 'Separate window']])}</div></div>
    <div class="opt"><div class="l"><b>Layout</b></div><div class="r">${seg('layout', [['bar', 'Bar'], ['card', 'Card'], ['square', 'Square'], ['strip', 'Strip'], ['art', 'Cover']])}</div></div>
    <div class="opt"><div class="l"><b>Transparency</b><small>How much of your desktop shows through</small></div><div class="r">${rg('transp', 0, 1, 0.01, pct)}</div></div>
    <div class="opt"><div class="l"><b>Blur the desktop behind it</b><small>Real Windows 11 blur under the see-through parts (Windows rounds the corners itself when this is on)</small></div><div class="r">${tg('desktopBlur')}</div></div>
    <div class="opt"><div class="l"><b>Album-art glow</b><small>Blurred cover behind the controls</small></div><div class="r">${tg('art')}</div></div>
    <div class="opt"><div class="l"><b>Glow blur</b></div><div class="r">${rg('blur', 0, 90, 1, px)}</div></div>
    <div class="opt"><div class="l"><b>Corner roundness</b></div><div class="r">${rg('radius', 0, 32, 1, px)}</div></div>
    <div class="opt"><div class="l"><b>Progress bar</b></div><div class="r">${tg('progress')}</div></div>
    <div class="opt"><div class="l"><b>Show times</b></div><div class="r">${tg('times')}</div></div>
    <div class="opt"><div class="l"><b>Always on top</b></div><div class="r">${tg('onTop')}</div></div>
    <p style="opacity:.6;font-size:12.5px;margin:12px 0 0">Drag it anywhere, resize from the edges, scroll on it to change volume, right-click for layouts, double-click to close it.</p>
    <div class="row"><button class="pill solid" data-close>Done</button></div>`);
  m.classList.add('wide'); m.style.width = 'min(640px, calc(100vw - 28px))';
  // show the real thing while customizing; close it afterwards unless it's meant to stay as its own window
  const wasOpen = host.alive; if (app.isDesktop) openCompanion();
  const gone = new MutationObserver(() => { if (!m.isConnected) { gone.disconnect(); if (!wasOpen && !app.S.mini.separate) closeCompanion(); } });
  gone.observe($('#layer'), { childList: true, subtree: true });
  const changed = () => { app.saveS(); pushState(true); };
  m.addEventListener('click', (e) => {
    const s = e.target.closest('[data-mseg] button'); if (s) { const k = s.parentElement.dataset.mseg; M[k] = k === 'separate' ? s.dataset.v === 'true' : s.dataset.v; $$('button', s.parentElement).forEach((b) => b.classList.toggle('on', b === s)); changed(); }
    const t = e.target.closest('[data-mtog]'); if (t) { const k = t.dataset.mtog; M[k] = !M[k]; t.classList.toggle('on', M[k]); changed(); }
  });
  m.addEventListener('input', (e) => {
    const r = e.target.closest('[data-mr]'); if (!r) return; const k = r.dataset.mr; const v = +r.value;
    if (k === 'transp') { M.opacity = +(1 - v).toFixed(2); r.nextElementSibling.textContent = pct(v); } else { M[k] = v; r.nextElementSibling.textContent = px(v); }
    changed();
  });
}

function wireMiniHandle() {
  const mini = $('#mini');
  // reveal the options handle only when the pointer comes close to it
  const hov = mini.querySelector('.mini-hover');
  mini.addEventListener('pointermove', (e) => {
    const r = mini.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + 10;
    const near = Math.abs(e.clientX - cx) < 70 && e.clientY - r.top < 34;
    mini.classList.toggle('near', near || hov.matches(':hover'));
  });
  mini.addEventListener('pointerleave', () => { mini.classList.remove('near'); hov.classList.remove('open'); });
}
export function initNP() { wireNP(); wireMiniHandle(); if (app.isDesktop) wireMini(); }
export function npTick() {
  if (npLyr?.sync) npLyr.sync(); if (panelLyrics?.sync) panelLyrics.sync();
}
export function refreshArt() { lastNPTrack = null; lastMini = null; updateNP(); updateMini(); drawPanel(); }
export function onTrackChange() {
  autoCover(player.track);
  if (app.S.panel === 'lyrics' || app.S.panel === 'info' || app.S.panel === 'queue') drawPanel();
  updateNP(); updateMini();
}
export function onQueueChange() { if (app.S.panel === 'queue') drawPanel(); if (npTab === 'queue') { npTab = null; npRight('queue'); } }
