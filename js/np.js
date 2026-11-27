// Now Playing overlay, side panel (queue / lyrics / info), visualizer, sound panel, sleep timer, mini player.
import { app, lib, player, toast, go, menu, modal, closeLayer, coverImg, hydrate, ico, setImg, setLikeBtn, burst, marquee, slider, applyAccent, hexToRgb } from './core.js';
import { $, $$, esc, h, fmtTime, clamp, debounce } from './util.js';
import { EQ_FREQS, EQ_PRESETS } from './player.js';
import { trackMenu, albumKey, longPress } from './views.js';

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
  if (!text && lib.db.lyrics[t.id]) { text = lib.db.lyrics[t.id]; src = 'Embedded lyrics'; }
  if (!text) { lyricCache.set(t.id, null); return null; }
  const synced = /\[\d{1,3}:\d{1,2}/.test(text) ? parseLRC(text) : null;
  const r = { synced: synced && synced.length > 2 ? synced : null, plain: text.replace(/\[[^\]]*\]/g, '').trim(), src };
  lyricCache.set(t.id, r); return r;
}
export async function lyricsEl(t) {
  const L = await getLyrics(t);
  if (!t) return h('<div class="empty"><p>Play something to see lyrics.</p></div>');
  if (!L) return h(`<div class="empty" style="padding:40px 10px"><svg><use href="#i-lyrics"/></svg><h3>No lyrics for this song</h3><p>${app.isDesktop ? 'Add lyrics to the file\'s tags, or drop a matching <b>.lrc</b> file next to the song for synced, karaoke-style lyrics.' : 'Embed lyrics in the file\'s tags or import a matching .lrc file alongside the song.'}</p></div>`);
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
function infoEl() {
  const t = player.track; if (!t) return h('<div class="empty"><p>Nothing playing.</p></div>');
  const el = h(`<div><div class="np-card">${t.cover ? coverImg(t.cover, false) : ''}<div class="pad"><h3>${esc(t.title)}</h3><p>${esc(t.artist)}</p></div></div>
    <dl class="kv">${[['Album', t.album], ['Year', t.year || ''], ['Genre', t.genre], ['Plays', lib.db.plays[t.id] || 0], ['Quality', [t.bitrate && t.bitrate + ' kbps', t.sampleRate && t.sampleRate / 1000 + ' kHz', t.bitDepth && t.bitDepth + '-bit', (t.name.split('.').pop() || '').toUpperCase()].filter(Boolean).join(' · ')], ['File', t.rel]].filter((r) => r[1] !== '' && r[1] != null).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    <div style="display:flex;gap:8px;flex-wrap:wrap;padding:10px 6px"><button class="pill" data-al>${ico('album')}Album</button><button class="pill" data-ar>${ico('artist')}Artist</button><button class="pill" data-mo>${ico('more')}More</button></div></div>`);
  hydrate(el);
  el.querySelector('[data-al]').onclick = () => go('album', { key: albumKey(t) });
  el.querySelector('[data-ar]').onclick = () => go('artist', { key: albumKey(t).split('\u0001')[0] });
  el.querySelector('[data-mo]').onclick = (e) => trackMenu([t.id], { el: e.currentTarget });
  return el;
}

// ---------------- Side panel ----------------
let panelLyrics = null;
export async function openPanel(tab) {
  const S = app.S;
  if (app.isMobile) { openNP(); npRight(tab === 'info' ? 'queue' : tab); return; }
  if (S.panel === tab && document.body.classList.contains('panel-open') && tab) { closePanel(); return; }
  S.panel = tab; app.saveS(); document.body.classList.add('panel-open');
  $$('[data-ptab]').forEach((b) => b.classList.toggle('on', b.dataset.ptab === tab));
  $('#bQueue').classList.toggle('on', tab === 'queue'); $('#bLyrics').classList.toggle('on', tab === 'lyrics');
  await drawPanel();
}
export function closePanel() { app.S.panel = null; app.saveS(); document.body.classList.remove('panel-open'); $('#bQueue').classList.remove('on'); $('#bLyrics').classList.remove('on'); panelLyrics = null; }
export async function drawPanel() {
  const tab = app.S.panel; if (!tab || !document.body.classList.contains('panel-open')) return;
  const body = $('#panelBody'); const st = body.scrollTop;
  const el = tab === 'queue' ? queueEl() : tab === 'lyrics' ? await lyricsEl(player.track) : infoEl();
  body.innerHTML = ''; body.appendChild(el); panelLyrics = tab === 'lyrics' ? el : null;
  if (tab === 'queue') body.scrollTop = st;
}

// ---------------- Now playing overlay ----------------
let npOpen = false, npTab = null, npLyr = null;
export function isNPOpen() { return npOpen; }
export function openNP() {
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
  const el = tab === 'lyrics' ? await lyricsEl(player.track) : queueEl(true);
  r.innerHTML = ''; r.appendChild(el); npLyr = tab === 'lyrics' ? el : null;
}
let lastNPTrack = null;
export async function updateNP() {
  const t = player.track; const np = $('#np');
  np.classList.toggle('paused', !player.playing);
  $('#npPlay').classList.toggle('is-playing', player.playing);
  if (!t) return;
  $('#npTitle').textContent = t.title; $('#npArtist').textContent = t.artist || 'Unknown Artist';
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
  art.addEventListener('dblclick', () => { const t = player.track; if (t) { lib.like(t.id); burst($('#npLike')); } });
  // gestures: swipe down to close, swipe on art to skip
  let sx = 0, sy = 0, st = 0, dragging = false; const np = $('#np');
  np.addEventListener('touchstart', (e) => { if (e.target.closest('.np-right, .slider')) return; sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now(); dragging = true; }, { passive: true });
  np.addEventListener('touchmove', (e) => { if (!dragging) return; const dy = e.touches[0].clientY - sy, dx = e.touches[0].clientX - sx; if (dy > 0 && Math.abs(dy) > Math.abs(dx)) { np.style.transition = 'none'; np.style.transform = `translateY(${dy}px)`; } else if (Math.abs(dx) > Math.abs(dy) && e.target.closest('#npArt')) { inner.style.transform = `translateX(${dx * 0.6}px) rotate(${dx * 0.02}deg)`; } }, { passive: true });
  np.addEventListener('touchend', (e) => {
    if (!dragging) return; dragging = false; const dy = e.changedTouches[0].clientY - sy, dx = e.changedTouches[0].clientX - sx; const v = Math.abs(dy) / (Date.now() - st);
    np.style.transition = ''; np.style.transform = ''; inner.style.transform = '';
    if (dy > 140 || (dy > 50 && v > 0.6)) { if (history.state?.np) history.back(); else closeNP(); }
    else if (e.target.closest('#npArt') && Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy)) dx < 0 ? player.next() : player.prev();
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
const MINI_SIZES = { bar: [420, 104], card: [300, 440], square: [270, 270], strip: [440, 46], art: [220, 220] };
let saved = null;
export async function enterMini() {
  if (!app.isDesktop || document.body.classList.contains('mini')) return;
  const W = app.P.win; closeNP(); closeLayer();
  try { saved = { size: await W.getSize(), pos: await W.getPos(), max: await W.isMax() }; if (saved.max) await W.unmax(); } catch {}
  document.body.classList.add('mini'); applyMini(); updateMini(true);
  const [w, h] = MINI_SIZES[app.S.mini.layout] || MINI_SIZES.bar;
  const mw = app.S.mini.w?.[app.S.mini.layout], mh = app.S.mini.h?.[app.S.mini.layout];
  await W.setSize(mw || w, mh || h, true);
  if (app.S.mini.x != null) W.move(app.S.mini.x, app.S.mini.y);
  W.onTop(app.S.mini.onTop);
}
export async function exitMini() {
  if (!document.body.classList.contains('mini')) return; const W = app.P.win;
  try { const p = await W.getPos(); app.S.mini.x = p.x; app.S.mini.y = p.y; const s = await W.getSize(); (app.S.mini.w ||= {})[app.S.mini.layout] = s.width; (app.S.mini.h ||= {})[app.S.mini.layout] = s.height; app.saveS(); } catch {}
  document.body.classList.remove('mini'); W.onTop(false);
  if (saved) { await W.setSize(saved.size.width, saved.size.height, true); W.move(saved.pos.x, saved.pos.y); if (saved.max) W.toggleMax(); }
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
  $('#miniCur').textContent = fmtTime(c); $('#miniDur').textContent = fmtTime(d);
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
      const [w, h] = MINI_SIZES[M.layout]; await W.setSize(M.w?.[M.layout] || w, M.h?.[M.layout] || h, true);
    } else if (k === 'custom') { await exitMiniForCustom(); }
  });
  // drag window from anywhere that's not a control
  mini.addEventListener('pointerdown', (e) => { if (e.button !== 0 || e.target.closest('button, .slider')) return; app.P.win.drag(); });
  mini.addEventListener('dblclick', (e) => { if (!e.target.closest('button, .slider')) exitMini(); });
  mini.addEventListener('wheel', (e) => { player.setVolume(app.S.volume - Math.sign(e.deltaY) * 0.05); toast(`Volume ${Math.round(app.S.volume * 100)}%`, 700); }, { passive: true });
  mini.addEventListener('contextmenu', (e) => { e.preventDefault(); miniMenu({ x: e.clientX, y: e.clientY }); });
  miniSeek = slider($('#miniSeek'), { get: () => player.duration ? player.time / player.duration : 0, set: (v) => player.seek(v * player.duration) });
  miniVol = slider($('#miniVol'), { get: () => app.S.volume, set: (v) => { player.setVolume(v); miniModes(); }, preview: (v, hover) => { if (!hover) player.setVolume(v); } });
  player.on((e) => { if (e === 'mode' || e === 'volume') miniModes(); });
}
function miniMenu(at) {
  const M = app.S.mini;
  menu([{ header: 'Layout' }, ...[['bar', 'Bar'], ['card', 'Card'], ['square', 'Square cover'], ['strip', 'Slim strip'], ['art', 'Cover only']].map(([k, l]) => ({ label: l, checked: M.layout === k, action: async () => { M.layout = k; app.saveS(); applyMini(); updateMini(true); const [w, h] = MINI_SIZES[k]; await app.P.win.setSize(M.w?.[k] || w, M.h?.[k] || h, true); } })), '-', { label: 'Customize…', icon: 'palette', action: exitMiniForCustom }, { label: M.onTop ? 'Unpin from top' : 'Always on top', icon: 'pin', action: () => { M.onTop = !M.onTop; app.P.win.onTop(M.onTop); applyMini(); app.saveS(); } }, { label: 'Back to full player', icon: 'expand', action: exitMini }], at);
}
async function exitMiniForCustom() { await exitMini(); miniCustomize(); }
export function miniCustomize() {
  const M = app.S.mini;
  const seg = (k, opts) => `<div class="seg" data-mseg="${k}">${opts.map(([v, l]) => `<button data-v="${v}" class="${M[k] === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const tg = (k) => `<div class="tog ${M[k] ? 'on' : ''}" data-mtog="${k}"></div>`;
  const m = modal(`<h2>Mini player <button class="ib sm" data-close>${ico('x')}</button></h2>
    <div class="mini-stage" id="miniStage"><small></small></div>
    <div class="opt"><div class="l"><b>Layout</b></div><div class="r">${seg('layout', [['bar', 'Bar'], ['card', 'Card'], ['square', 'Square'], ['strip', 'Strip'], ['art', 'Cover']])}</div></div>
    <div class="opt"><div class="l"><b>Background opacity</b><small>Lower = see-through to your desktop</small></div><div class="r"><input type="range" min="0" max="1" step="0.01" value="${M.opacity}" data-mr="opacity"><span class="val">${Math.round(M.opacity * 100)}%</span></div></div>
    <div class="opt"><div class="l"><b>Album-art glow</b><small>Blurred cover behind the controls</small></div><div class="r">${tg('art')}</div></div>
    <div class="opt"><div class="l"><b>Blur strength</b></div><div class="r"><input type="range" min="0" max="90" step="1" value="${M.blur}" data-mr="blur"><span class="val">${M.blur}px</span></div></div>
    <div class="opt"><div class="l"><b>Corner roundness</b></div><div class="r"><input type="range" min="0" max="32" step="1" value="${M.radius}" data-mr="radius"><span class="val">${M.radius}px</span></div></div>
    <div class="opt"><div class="l"><b>Progress bar</b></div><div class="r">${tg('progress')}</div></div>
    <div class="opt"><div class="l"><b>Show times</b></div><div class="r">${tg('times')}</div></div>
    <div class="opt"><div class="l"><b>Always on top</b></div><div class="r">${tg('onTop')}</div></div>
    <p style="opacity:.6;font-size:12.5px;margin:12px 0 0">Tips: drag anywhere to move it, resize from the edges, scroll to change volume, right-click for layouts, double-click to go back.</p>
    <div class="row"><button class="pill" data-close>Done</button><button class="pill solid" data-open>${ico('mini')}Open mini player</button></div>`);
  m.classList.add('wide'); m.style.width = 'min(640px, calc(100vw - 28px))';
  const stage = m.querySelector('#miniStage');
  const drawPreview = async () => {
    applyMini(); await updateMini(true);
    stage.querySelector('.miniplayer')?.remove();
    const [dw, dh] = MINI_SIZES[M.layout] || MINI_SIZES.bar; const w = M.w?.[M.layout] || dw, hh = M.h?.[M.layout] || dh;
    const c = $('#mini').cloneNode(true); c.id = 'miniPreview'; c.classList.add('preview');
    c.querySelectorAll('[id]').forEach((x) => x.removeAttribute('id'));
    c.style.width = w + 'px'; c.style.height = hh + 'px';
    const sc = Math.min(1, (stage.clientWidth - 30) / w, (stage.clientHeight - 30) / hh);
    stage.style.height = Math.max(150, Math.min(340, hh * sc + 60)) + 'px';
    const sc2 = Math.min(1, (stage.clientWidth - 30) / w, (Math.min(340, hh + 60) - 30) / hh);
    c.style.transform = sc2 < 1 ? `scale(${sc2})` : ''; c.style.transformOrigin = 'center';
    stage.appendChild(c);
    stage.querySelector(':scope > small').textContent = `${w} × ${hh}${sc2 < 1 ? ` • shown at ${Math.round(sc2 * 100)}%` : ' • actual size'}`;
  };
  requestAnimationFrame(drawPreview);
  m.addEventListener('click', (e) => {
    const s = e.target.closest('[data-mseg] button'); if (s) { M[s.parentElement.dataset.mseg] = s.dataset.v; $$('button', s.parentElement).forEach((b) => b.classList.toggle('on', b === s)); app.saveS(); drawPreview(); }
    const t = e.target.closest('[data-mtog]'); if (t) { const k = t.dataset.mtog; M[k] = !M[k]; t.classList.toggle('on', M[k]); app.saveS(); drawPreview(); }
    if (e.target.closest('[data-open]')) { closeLayer(); enterMini(); }
  });
  m.addEventListener('input', (e) => { const r = e.target.closest('[data-mr]'); if (!r) return; const k = r.dataset.mr; M[k] = +r.value; r.nextElementSibling.textContent = k === 'opacity' ? Math.round(M[k] * 100) + '%' : M[k] + 'px'; app.saveS(); applyMini(); const pv = stage.querySelector('.miniplayer'); if (pv) { for (const v of ['--mini-a', '--mini-blur', '--mini-r', '--mini-art']) pv.style.setProperty(v, $('#mini').style.getPropertyValue(v)); } });
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
export function onTrackChange() {
  if (app.S.panel === 'lyrics' || app.S.panel === 'info' || app.S.panel === 'queue') drawPanel();
  updateNP(); updateMini();
}
export function onQueueChange() { if (app.S.panel === 'queue') drawPanel(); if (npTab === 'queue') { npTab = null; npRight('queue'); } }
