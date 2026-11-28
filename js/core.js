// Shared UI core: settings, theme, router, menus, modals, covers, helpers.
import { lib } from './library.js';
import { player } from './player.js';
import { $, $$, esc, h, debounce, toast, clamp } from './util.js';

export const DEFAULTS = {
  theme: 'dark', accentMode: 'dynamic', accent: '#7c5cff', accent2: 'auto', bgMode: 'aurora', wallpaper: null, blur: 28, glass: 0.35, radius: 20, font: 'system', preset: 'pulse',
  anim: 'full', compact: false, winOpacity: 1, glow: 1,
  volume: 0.8, muted: false, speed: 1, keepPitch: true, shuffle: false, repeat: 'off', crossfade: 0, fadePause: true, leveler: false,
  eqOn: false, eq: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], preamp: 0, eqPreset: 'Flat', engine: 'auto',
  sideMini: false, panel: null, viz: 'bars', blurLyrics: false, lastView: null, songsSort: { k: 'added', d: -1 }, albumSort: 'name', gridSize: 172,
  mini: { layout: 'bar', opacity: 0.9, blur: 40, art: true, onTop: true, progress: true, times: true, radius: 14 },
  closeToTray: false, rescanOnStart: true, watch: true, showSplash: true,
  npView: 'auto',
  gest: { right: 'queue', left: 'like', miniSwipe: true, miniUp: true, npDown: true, artSwipe: true, artDouble: true, haptics: true }
};
export const VERSION = '1.3.0';
export const REPO = 'Frenchbear1/Pulse';
export const app = {
  S: null, P: null, isDesktop: false, isMobile: false,
  hist: [], hi: -1, view: null, params: null, views: {}, renderers: {},
  saveS: null
};
app.saveS = debounce(() => { try { localStorage.setItem('pulse.settings', JSON.stringify(app.S)); } catch {} }, 300);
export function loadSettings() {
  let s = {}; try { s = JSON.parse(localStorage.getItem('pulse.settings') || '{}'); } catch {}
  const S = Object.assign(structuredClone(DEFAULTS), s); S.mini = Object.assign(structuredClone(DEFAULTS.mini), s.mini || {}); S.gest = Object.assign(structuredClone(DEFAULTS.gest), s.gest || {});
  return S;
}

// ---------- theming ----------
export const PRESETS = {
  pulse:    { name: 'Pulse',    theme: 'dark',     accentMode: 'dynamic', accent: '#7c5cff', accent2: 'auto',    bgMode: 'aurora', blur: 28, glass: 0.35, radius: 20, font: 'system',  glow: 1,   pv: ['#0b0b12', '#7c5cff', '#22d3ee'] },
  midnight: { name: 'Midnight', theme: 'midnight', accentMode: 'fixed',   accent: '#6d5dfc', accent2: '#22d3ee', bgMode: 'aurora', blur: 30, glass: 0.25, radius: 20, font: 'system',  glow: 1.1, pv: ['#070a18', '#6d5dfc', '#22d3ee'] },
  vinyl:    { name: 'Vinyl',    theme: 'dark',     accentMode: 'dynamic', accent: '#ff8a3d', accent2: 'auto',    bgMode: 'art',    blur: 40, glass: 0.22, radius: 24, font: 'system',  glow: 1,   pv: ['#120c0a', '#ff8a3d', '#c2410c'] },
  ember:    { name: 'Ember',    theme: 'black',    accentMode: 'fixed',   accent: '#ff7a1a', accent2: '#ff3d6e', bgMode: 'aurora', blur: 26, glass: 0.2,  radius: 18, font: 'system',  glow: 0.9, pv: ['#000000', '#ff7a1a', '#ff3d6e'] },
  frost:    { name: 'Frost',    theme: 'light',    accentMode: 'fixed',   accent: '#3b82f6', accent2: '#22d3ee', bgMode: 'aurora', blur: 34, glass: 0.55, radius: 22, font: 'system',  glow: 1,   pv: ['#eef0f6', '#3b82f6', '#22d3ee'] },
  sakura:   { name: 'Sakura',   theme: 'light',    accentMode: 'fixed',   accent: '#f2558f', accent2: '#a78bfa', bgMode: 'aurora', blur: 30, glass: 0.5,  radius: 26, font: 'rounded', glow: 1.1, pv: ['#f6eef3', '#f2558f', '#a78bfa'] },
  mono:     { name: 'Mono',     theme: 'black',    accentMode: 'fixed',   accent: '#e8e8ec', accent2: '#8b8b96', bgMode: 'solid',  blur: 18, glass: 0.35, radius: 8,  font: 'mono',    glow: 0,   pv: ['#000000', '#e8e8ec', '#55555e'] },
  lagoon:   { name: 'Lagoon',   theme: 'dark',     accentMode: 'fixed',   accent: '#14d8b0', accent2: '#3b82f6', bgMode: 'aurora', blur: 32, glass: 0.28, radius: 20, font: 'rounded', glow: 1.2, pv: ['#061214', '#14d8b0', '#3b82f6'] }
};
export function applyPreset(k) { const p = PRESETS[k]; if (!p) return; const { name, pv, ...vals } = p; Object.assign(app.S, vals, { preset: k }); app.saveS(); applyTheme(); }
export function hexToRgb(hx) { const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hx || ''); return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [124, 92, 255]; }
const toHsl = ([r, g, b]) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0; const l = (mx + mn) / 2; if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; } return [h * 360, s, l]; };
const fromHsl = ([h, s, l]) => { h = ((h % 360) + 360) % 360 / 360; const f = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; }; if (!s) return [l, l, l].map((v) => Math.round(v * 255)); const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; return [f(p, q, h + 1 / 3), f(p, q, h), f(p, q, h - 1 / 3)].map((v) => Math.round(v * 255)); };
function tuneAccent(rgb, light) {
  // keep the accent readable: enough saturation and the right lightness for the theme
  let [h, s, l] = toHsl(rgb);
  if (s > 0.12) s = Math.max(s, 0.55);
  l = light ? Math.min(Math.max(l, 0.38), 0.52) : Math.min(Math.max(l, 0.56), 0.72);
  return fromHsl([h, s, l]);
}
let lastAccent = null;
export function applyAccent(hex) {
  const S = app.S; const light = document.body.classList.contains('light');
  if (S.accentMode !== 'dynamic' || !hex) hex = S.accent;
  const rgb = tuneAccent(hexToRgb(hex), light);
  let rgb2;
  if (S.accent2 && S.accent2 !== 'auto') rgb2 = tuneAccent(hexToRgb(S.accent2), light);
  else { const [h, s2, l] = toHsl(rgb); rgb2 = s2 < 0.12 ? fromHsl([h, 0, Math.max(0.3, l - 0.25)]) : fromHsl([h + 48, Math.min(1, s2 + 0.05), l]); }
  const key = rgb.join(',') + '|' + rgb2.join(','); if (key === lastAccent) return; lastAccent = key;
  const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  const st = document.documentElement.style;
  st.setProperty('--acc', `rgb(${rgb.join(',')})`); st.setProperty('--acc-rgb', rgb.join(',')); st.setProperty('--acc2-rgb', rgb2.join(',')); st.setProperty('--acc-ink', lum > 0.6 ? '#0a0a0c' : '#ffffff');
}
export function applyTheme() {
  const S = app.S, b = document.body;
  if (S.theme === 'amoled') S.theme = 'black';
  let theme = S.theme; if (theme === 'auto') theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  for (const t of ['light', 'black', 'midnight']) b.classList.toggle(t, theme === t);
  for (const m of ['aurora', 'art', 'wall', 'solid']) b.classList.toggle('bg-' + m, (S.bgMode === 'wallpaper' ? 'wall' : S.bgMode) === m);
  for (const f of ['rounded', 'serif', 'mono']) b.classList.toggle('f-' + f, S.font === f);
  b.classList.toggle('compact', !!S.compact);
  b.classList.toggle('anim-off', S.anim === 'off'); b.classList.toggle('anim-low', S.anim === 'low');
  b.classList.toggle('side-mini', !!S.sideMini); b.classList.toggle('blur-lyrics', !!S.blurLyrics);
  const st = document.documentElement.style; const light = theme === 'light';
  st.setProperty('--alpha', app.isDesktop ? S.winOpacity : 1); st.setProperty('--glow', S.glow);
  st.setProperty('--card', S.gridSize + 'px');
  st.setProperty('--blur', S.blur + 'px');
  st.setProperty('--panel-a', (light ? 0.3 + S.glass * 0.6 : 0.015 + S.glass * 0.22).toFixed(3));
  st.setProperty('--r', S.radius + 'px'); st.setProperty('--r-sm', Math.round(S.radius * 0.65) + 'px');
  const wall = document.querySelector('#bg .bg-wall'); if (wall) wall.style.backgroundImage = S.wallpaper ? `url(${S.wallpaper})` : '';
  const meta = document.querySelector('meta[name=theme-color]'); if (meta) meta.content = getComputedStyle(b).getPropertyValue('--bg-rgb') ? `rgb(${getComputedStyle(b).getPropertyValue('--bg-rgb')})` : '#09090e';
  lastAccent = null; applyAccent(currentColor());
}
export function currentColor() { const t = player.track; return t?.cover ? lib.db.covers[t.cover]?.color : null; }
export async function setBgArt(key) {
  const img = document.querySelector('#bg .bg-art img'); if (!img) return;
  if (!key) { img.removeAttribute('src'); return; }
  const u = await app.P.coverURL(key, true); if (u) img.src = u;
}

// ---------- covers ----------
export function coverImg(key, small = true, cls = '') {
  if (!key) return '';
  const sync = app.P.coverURLSync(key, small);
  if (sync) return `<img class="${cls}" src="${sync}" loading="lazy" decoding="async" alt="" onload="this.classList.add('ok')">`;
  return `<img class="${cls} lazy" data-ck="${key}" data-cs="${small ? 1 : 0}" alt="" decoding="async">`;
}
const io = 'IntersectionObserver' in window ? new IntersectionObserver((ents) => { for (const e of ents) if (e.isIntersecting) { io.unobserve(e.target); loadLazy(e.target); } }, { rootMargin: '300px' }) : null;
function loadLazy(img) { app.P.coverURL(img.dataset.ck, img.dataset.cs === '1').then((u) => { if (u) { img.onload = () => img.classList.add('ok'); img.src = u; } }); }
export function hydrate(root) { for (const img of root.querySelectorAll('img.lazy:not([src])')) { if (io) io.observe(img); else loadLazy(img); } }
export async function setImg(img, key, small = false) {
  const wrap = img.parentElement;
  if (!key) { img.removeAttribute('src'); wrap.classList.remove('has-art'); return; }
  const u = await app.P.coverURL(key, small);
  if (u) { img.src = u; wrap.classList.add('has-art'); } else { img.removeAttribute('src'); wrap.classList.remove('has-art'); }
}
// Playlist/collection cover: custom > mosaic of up to 4 album covers > generated gradient
export function collectionCover(node, ids) {
  if (node?.cover) return coverImg(node.cover, false);
  const keys = []; for (const id of ids) { const c = lib.track(id)?.cover; if (c && !keys.includes(c)) keys.push(c); if (keys.length === 4) break; }
  if (keys.length >= 4) return `<div class="mosaic">${keys.map((k) => coverImg(k, true)).join('')}</div>`;
  if (keys.length) return coverImg(keys[0], false);
  return genCover(node?.name || '', node?.type === 'folder' ? 'i-folder' : 'i-playlist');
}
export function genCover(name, icon) {
  let hsh = 0; for (const c of name) hsh = (hsh * 31 + c.charCodeAt(0)) | 0;
  const a = Math.abs(hsh) % 360, b = (a + 50 + (Math.abs(hsh >> 3) % 80)) % 360;
  return `<div class="gen-cover" style="--gc:linear-gradient(135deg,hsl(${a} 65% 46%),hsl(${b} 70% 22%))"><svg><use href="#${icon}"/></svg></div>`;
}
export const ico = (n) => `<svg><use href="#i-${n}"/></svg>`;

// ---------- router ----------
export function go(view, params = {}, opts = {}) {
  if (!opts.replace && !opts.back) {
    if (app.hi >= 0) app.hist[app.hi].scroll = $('#view').scrollTop;
    app.hist = app.hist.slice(0, app.hi + 1); app.hist.push({ view, params }); app.hi = app.hist.length - 1;
    if (app.hist.length > 60) { app.hist.shift(); app.hi--; }
  } else if (opts.replace && app.hi >= 0) app.hist[app.hi] = { view, params };
  app.view = view; app.params = params;
  if (!['settings'].includes(view)) { app.S.lastView = { view, params }; app.saveS(); }
  render(opts.keepScroll ? $('#view').scrollTop : (opts.back ? app.hist[app.hi]?.scroll || 0 : 0));
}
export function back() { if (app.hi > 0) { app.hist[app.hi].scroll = $('#view').scrollTop; app.hi--; const e = app.hist[app.hi]; go(e.view, e.params, { back: true }); } }
export function fwd() { if (app.hi < app.hist.length - 1) { app.hi++; const e = app.hist[app.hi]; go(e.view, e.params, { back: true }); } }
export function render(scroll = 0, animate = true) {
  const v = $('#view'); if (animate) v.classList.remove('quiet'); const fn = app.renderers[app.view] || app.renderers.home;
  if (app.cleanup) { try { app.cleanup(); } catch {} app.cleanup = null; }
  v.innerHTML = '';
  let el; try { el = fn(app.params || {}); } catch (e) { console.error(e); el = h(`<div class="page"><div class="empty"><h3>Something went wrong</h3><p>${esc(e.message)}</p></div></div>`); }
  if (animate && app.S.anim !== 'off') el.classList.add('view-in');
  v.appendChild(el); hydrate(el);
  v.scrollTop = scroll;
  v.dispatchEvent(new Event('scroll'));
  markNav();
}
export function refresh() { render($('#view').scrollTop, false); }
export const refreshSoon = debounce(() => { if (!$('.menu, .modal, .sheet')) refresh(); else refreshPending = true; }, 250);
let refreshPending = false;
export function markNav() {
  const v = app.view, p = app.params || {};
  $$('[data-go]').forEach((a) => a.classList.toggle('on', a.dataset.go === v || (a.dataset.go === 'library' && app.isMobile && ['albums', 'artists', 'songs', 'folders', 'node', 'liked', 'recent', 'album', 'artist'].includes(v))));
  $$('.tnode').forEach((n) => n.classList.toggle('on', v === 'node' && p.id === n.dataset.id));
  $('#navBack').disabled = app.hi <= 0; $('#navFwd').disabled = app.hi >= app.hist.length - 1;
}

// ---------- layer: menus / sheets / modals ----------
export function closeLayer() {
  const l = $('#layer'); l.innerHTML = '';
  if (refreshPending) { refreshPending = false; refresh(); }
}
export function menu(items, at, opts = {}) {
  const layer = $('#layer'); closeLayer();
  const scrim = h('<div class="scrim"></div>');
  const mobile = app.isMobile;
  if (mobile) scrim.classList.add('dim');
  scrim.addEventListener('pointerdown', (e) => { if (e.target === scrim) closeLayer(); });
  scrim.addEventListener('contextmenu', (e) => { e.preventDefault(); closeLayer(); });
  layer.appendChild(scrim);
  const m = buildMenu(items, mobile, opts);
  scrim.appendChild(m);
  if (!mobile) place(m, at);
  return m;
}
function buildMenu(items, mobile, opts) {
  const m = h(`<div class="${mobile ? 'sheet' : 'menu'}"></div>`);
  if (mobile && opts.head) m.appendChild(h(opts.head));
  if (opts.search) {
    const inp = h('<input class="msearch" placeholder="Find a playlist">'); m.appendChild(inp);
    inp.addEventListener('input', () => { const q = inp.value.toLowerCase(); $$('.mi', m).forEach((x) => { if (x.dataset.f) x.style.display = x.dataset.f.includes(q) ? '' : 'none'; }); });
    setTimeout(() => !mobile && inp.focus(), 30);
  }
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { m.appendChild(h('<div class="sep"></div>')); continue; }
    if (it.header) { m.appendChild(h(`<div class="mh">${esc(it.header)}</div>`)); continue; }
    if (it.el) { m.appendChild(typeof it.el === 'function' ? it.el() : it.el); continue; }
    const el = h(`<div class="mi${it.danger ? ' danger' : ''}${it.checked ? ' checked' : ''}" ${it.filter ? `data-f="${esc(it.filter.toLowerCase())}"` : ''}>${it.icon ? ico(it.icon) : ''}<span>${esc(it.label)}</span>${it.sub ? `<span class="sub">${ico('fwd')}</span>` : ''}${it.kbd ? `<span class="kbd">${esc(it.kbd)}</span>` : ''}</div>`);
    if (it.indent) el.style.paddingLeft = 10 + it.indent * 16 + 'px';
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (it.sub) { const sub = typeof it.sub === 'function' ? it.sub() : it.sub; const r = el.getBoundingClientRect(); menu(sub, { x: r.right - 4, y: r.top - 5, alignSub: r.left }, { search: it.searchSub }); return; }
      closeLayer(); it.action?.();
    });
    m.appendChild(el);
  }
  return m;
}
function place(m, at) {
  const r = m.getBoundingClientRect(); const W = innerWidth, H = innerHeight;
  let x = at.x, y = at.y;
  if (at.el) { const b = at.el.getBoundingClientRect(); x = at.right ? b.right - r.width : b.left; y = at.up ? b.top - r.height - 6 : b.bottom + 6; if (y + r.height > H - 8) y = b.top - r.height - 6; }
  if (x + r.width > W - 8) x = at.alignSub != null ? at.alignSub - r.width + 4 : W - r.width - 8;
  if (y + r.height > H - 8) y = Math.max(8, H - r.height - 8);
  m.style.left = Math.max(8, x) + 'px'; m.style.top = Math.max(8, y) + 'px';
  m.style.setProperty('--ox', `${at.x > x + r.width / 2 ? 'right' : 'left'} ${at.y > y + r.height / 2 ? 'bottom' : 'top'}`);
}
export function modal(html, onMount) {
  closeLayer();
  const scrim = h('<div class="scrim dim"></div>');
  scrim.addEventListener('pointerdown', (e) => { if (e.target === scrim) closeLayer(); });
  const m = h(`<div class="modal">${html}</div>`);
  scrim.appendChild(m); $('#layer').appendChild(scrim);
  $$('[data-close]', m).forEach((b) => b.addEventListener('click', closeLayer));
  onMount?.(m);
  const f = m.querySelector('[autofocus]'); if (f) setTimeout(() => { f.focus(); f.select?.(); }, 40);
  return m;
}
export function prompt(title, value = '', placeholder = '') {
  return new Promise((res) => {
    const m = modal(`<h2>${esc(title)}</h2><input class="inp" autofocus value="${esc(value)}" placeholder="${esc(placeholder)}"><div class="row"><button class="pill" data-close>Cancel</button><button class="pill solid" id="ok">Save</button></div>`);
    const inp = m.querySelector('input'); const ok = () => { const v = inp.value.trim(); closeLayer(); res(v || null); };
    m.querySelector('#ok').onclick = ok; inp.onkeydown = (e) => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') { closeLayer(); res(null); } };
  });
}
export function confirmBox(title, text, okLabel = 'Delete', danger = true) {
  return new Promise((res) => {
    const m = modal(`<h2>${esc(title)}</h2><p style="opacity:.75;margin:0">${esc(text)}</p><div class="row"><button class="pill" id="no">Cancel</button><button class="pill solid" id="yes" ${danger ? 'style="background:#e5484d;color:#fff"' : ''}>${esc(okLabel)}</button></div>`);
    m.querySelector('#no').onclick = () => { closeLayer(); res(false); };
    m.querySelector('#yes').onclick = () => { closeLayer(); res(true); };
  });
}
export function pickImage() {
  return new Promise((res) => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*';
    i.onchange = async () => { const f = i.files[0]; if (!f) return res(null); res({ data: new Uint8Array(await f.arrayBuffer()), mime: f.type }); };
    i.click();
  });
}
export async function copyText(t) {
  const ok = await app.P.writeClipboard(t);
  if (!ok) { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch {} ta.remove(); }
  toast('Copied to clipboard');
}
export function burst(el) {
  if (app.S.anim === 'off') return;
  const r = el.getBoundingClientRect(); const b = h('<div class="burst"></div>');
  b.style.left = r.left + r.width / 2 + 'px'; b.style.top = r.top + r.height / 2 + 'px';
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; const d = 18 + Math.random() * 14; const p = document.createElement('i'); p.style.setProperty('--x', Math.cos(a) * d + 'px'); p.style.setProperty('--y', Math.sin(a) * d + 'px'); p.style.left = '-3px'; p.style.top = '-3px'; b.appendChild(p); }
  document.body.appendChild(b); setTimeout(() => b.remove(), 700);
  el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
}
export function setLikeBtn(btn, on) { if (!btn) return; btn.classList.toggle('on', on); const u = btn.querySelector('use'); if (u) u.setAttribute('href', on ? '#i-heart-f' : '#i-heart'); }
// Long titles: rest, glide slowly to the end, rest, fade out, fade back in at the start.
// Only runs when the text actually doesn't fit, and re-checks whenever the space changes.
export function marquee(wrap) {
  if (!wrap) return; const inner = wrap.firstElementChild; if (!inner) return;
  if (!wrap._ro && 'ResizeObserver' in window) { wrap._ro = new ResizeObserver(() => { clearTimeout(wrap._rt); wrap._rt = setTimeout(() => marquee(wrap), 200); }); wrap._ro.observe(wrap); }
  requestAnimationFrame(() => {
    const over = inner.scrollWidth - wrap.clientWidth;
    const key = over + '|' + inner.textContent;
    if (wrap._key === key && wrap._anim) return; // nothing changed: keep the current loop running smoothly
    wrap._key = key; wrap._anim?.cancel(); wrap._anim = null; wrap.classList.remove('go');
    if (over <= 2 || !wrap.clientWidth || app.S?.anim === 'off') return;
    wrap.classList.add('go');
    const dist = over + 28, speed = app.S?.anim === 'low' ? 18 : 26; // px per second — slow and calm
    const hold = 2800, move = (dist / speed) * 1000, rest = 2000, fade = 900, back = 900;
    const total = hold + move + rest + fade + back; const at = (ms) => ms / total;
    wrap._anim = inner.animate([
      { transform: 'translateX(0)', opacity: 1, offset: 0 },
      { transform: 'translateX(0)', opacity: 1, offset: at(hold), easing: 'cubic-bezier(.45,.05,.55,.95)' },
      { transform: `translateX(${-dist}px)`, opacity: 1, offset: at(hold + move) },
      { transform: `translateX(${-dist}px)`, opacity: 1, offset: at(hold + move + rest), easing: 'cubic-bezier(.4,0,.2,1)' },
      { transform: `translateX(${-dist}px)`, opacity: 0, offset: at(hold + move + rest + fade) },
      { transform: 'translateX(0)', opacity: 0, offset: Math.min(1, at(hold + move + rest + fade) + 0.0005), easing: 'cubic-bezier(.4,0,.2,1)' },
      { transform: 'translateX(0)', opacity: 1, offset: 1 }
    ], { duration: total, iterations: Infinity });
  });
}

// Rolling digit counters: each digit is a little reel that glides to its new value.
export function flip(el, text) {
  if (!el) return; text = String(text);
  if (el._flip === text) return;
  const prev = el._flip; el._flip = text;
  if (app.S?.anim === 'off') { el.textContent = text; el._reels = null; return; }
  const shape = (t) => t.replace(/\d/g, '0');
  if (!el._reels || prev == null || shape(prev) !== shape(text)) {
    el.classList.add('flipnum'); el.textContent = '';
    el._reels = [...text].map((ch) => {
      if (!/\d/.test(ch)) { const s = document.createElement('span'); s.textContent = ch; el.appendChild(s); return null; }
      const r = document.createElement('span'); r.className = 'reel';
      const st = document.createElement('span'); st.className = 'strip'; st.textContent = '0123456789'.split('').join('\n');
      r.appendChild(st); el.appendChild(r);
      st.style.transform = `translateY(${-(prev ? 0 : +ch) * 10}%)`; return st;
    });
    if (prev == null) { [...text].forEach((ch, i) => { if (el._reels[i]) el._reels[i].style.transform = `translateY(${-ch * 10}%)`; }); return; }
    requestAnimationFrame(() => [...text].forEach((ch, i) => { if (el._reels[i]) el._reels[i].style.transform = `translateY(${-ch * 10}%)`; }));
    return;
  }
  [...text].forEach((ch, i) => { const st = el._reels[i]; if (st) st.style.transform = `translateY(${-ch * 10}%)`; });
}

// Slider helper (pointer drag, keyboard)
export function slider(el, { get, set, preview, onEnd }) {
  let dragging = false;
  const val = (e) => { const r = el.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1); };
  el.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; dragging = true; el.classList.add('drag'); el.setPointerCapture(e.pointerId); const v = val(e); el.style.setProperty('--v', v); preview?.(v); e.preventDefault(); });
  el.addEventListener('pointermove', (e) => { const v = val(e); el.style.setProperty('--h', v); if (dragging) { el.style.setProperty('--v', v); preview?.(v); } else preview?.(v, true); });
  const end = (e) => { if (!dragging) return; dragging = false; el.classList.remove('drag'); set(val(e)); onEnd?.(); };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', () => { dragging = false; el.classList.remove('drag'); });
  el.addEventListener('wheel', (e) => { e.preventDefault(); set(clamp(get() - Math.sign(e.deltaY) * 0.05, 0, 1)); }, { passive: false });
  return { isDragging: () => dragging, update: (v) => { if (!dragging) el.style.setProperty('--v', v); } };
}

// ---------- updates (GitHub Releases) ----------
const verNum = (v) => String(v || '').replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0);
export const isNewer = (a, b) => { const x = verNum(a), y = verNum(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
export async function checkForUpdate(manual) {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) return null; const j = await r.json(); const version = String(j.tag_name || '').replace(/^v/i, '');
    app.S.lastUpdateCheck = Date.now(); app.saveS();
    return { version, newer: isNewer(version, VERSION), url: j.html_url };
  } catch { return null; }
}
// once a day on desktop, quietly tell you when a newer release exists
export async function autoUpdateCheck() {
  if (!app.isDesktop || Date.now() - (app.S.lastUpdateCheck || 0) < 20 * 3600 * 1000) return;
  const u = await checkForUpdate(); if (!u?.newer) return;
  const t = toast(`Pulse ${u.version} is available — open Settings to download`, 6000);
}

export const haptic = (ms = 8) => { if (app.S?.gest?.haptics !== false) navigator.vibrate?.(ms); };
// Spotify-style row swipe actions
export const SWIPE_ACTIONS = { queue: ['Add to queue', 'queue'], next: ['Play next', 'next'], like: ['Like', 'heart-f'], playlist: ['Add to playlist', 'playlist'], off: ['Off', 'x'] };

export { lib, player, toast };
