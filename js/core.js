// Shared UI core: settings, theme, router, menus, modals, covers, helpers.
import { lib } from './library.js';
import { player } from './player.js';
import { $, $$, esc, h, debounce, toast, clamp } from './util.js';

export const DEFAULTS = {
  theme: 'dark', accentMode: 'dynamic', accent: '#1ed760', anim: 'full', compact: false, winOpacity: 1, glow: 1,
  volume: 0.8, muted: false, speed: 1, keepPitch: true, shuffle: false, repeat: 'off', crossfade: 0, fadePause: true, leveler: false,
  eqOn: false, eq: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], preamp: 0, eqPreset: 'Flat', engine: 'auto',
  sideMini: false, panel: null, viz: 'bars', blurLyrics: false, lastView: null, songsSort: { k: 'added', d: -1 }, albumSort: 'name', gridSize: 172,
  mini: { layout: 'bar', opacity: 0.9, blur: 40, art: true, onTop: true, progress: true, times: true, radius: 14 },
  closeToTray: false, rescanOnStart: true, watch: true, showSplash: true
};
export const app = {
  S: null, P: null, isDesktop: false, isMobile: false,
  hist: [], hi: -1, view: null, params: null, views: {}, renderers: {},
  saveS: null
};
app.saveS = debounce(() => { try { localStorage.setItem('pulse.settings', JSON.stringify(app.S)); } catch {} }, 300);
export function loadSettings() {
  let s = {}; try { s = JSON.parse(localStorage.getItem('pulse.settings') || '{}'); } catch {}
  const S = Object.assign(structuredClone(DEFAULTS), s); S.mini = Object.assign(structuredClone(DEFAULTS.mini), s.mini || {});
  return S;
}

// ---------- theming ----------
export function hexToRgb(hx) { const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hx || ''); return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [30, 215, 96]; }
function tuneAccent([r, g, b], light) {
  // lift dark colours / tame very bright so the accent always reads
  const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  let target = light ? Math.min(l, 0.45) : Math.max(l, 0.52);
  if (Math.abs(target - l) > 0.01) {
    const mix = light ? 0 : 255; const k = clamp(Math.abs(target - l) / Math.abs(mix / 255 - l || 1), 0, 0.85);
    r += (mix - r) * k; g += (mix - g) * k; b += (mix - b) * k;
  }
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx - mn < 30) { r = Math.min(255, r + 10); } // grey-ish: keep
  return [r, g, b].map((v) => Math.round(clamp(v, 0, 255)));
}
let lastAccent = null;
export function applyAccent(hex) {
  const S = app.S; const light = document.body.classList.contains('light');
  if (S.accentMode !== 'dynamic' || !hex) hex = S.accent;
  const rgb = tuneAccent(hexToRgb(hex), light);
  const key = rgb.join(','); if (key === lastAccent) return; lastAccent = key;
  const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  const st = document.documentElement.style;
  st.setProperty('--acc', `rgb(${key})`); st.setProperty('--acc-rgb', key); st.setProperty('--acc-ink', lum > 0.55 ? '#0a0a0c' : '#ffffff');
  const mb = hexToRgb(hex).map((v) => Math.round(v * 0.45 + 18)); st.setProperty('--mb', `rgb(${mb.join(',')})`);
  const meta = document.querySelector('meta[name=theme-color]'); if (meta && app.isMobile) meta.content = `rgb(${getComputedStyle(document.documentElement).getPropertyValue('--bg-rgb')})`;
}
export function applyTheme() {
  const S = app.S, b = document.body;
  let theme = S.theme; if (theme === 'auto') theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  b.classList.toggle('light', theme === 'light'); b.classList.toggle('amoled', theme === 'amoled');
  b.classList.toggle('compact', !!S.compact);
  b.classList.toggle('anim-off', S.anim === 'off'); b.classList.toggle('anim-low', S.anim === 'low');
  b.classList.toggle('side-mini', !!S.sideMini); b.classList.toggle('blur-lyrics', !!S.blurLyrics);
  const st = document.documentElement.style;
  st.setProperty('--alpha', app.isDesktop ? S.winOpacity : 1); st.setProperty('--glow', S.glow);
  st.setProperty('--card', S.gridSize + 'px');
  lastAccent = null; applyAccent(currentColor());
}
export function currentColor() { const t = player.track; return t?.cover ? lib.db.covers[t.cover]?.color : null; }

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
  const v = $('#view'); const fn = app.renderers[app.view] || app.renderers.home;
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
export function marquee(wrap) {
  if (!wrap) return; wrap.classList.remove('go'); const inner = wrap.firstElementChild; if (!inner) return;
  requestAnimationFrame(() => { const over = inner.scrollWidth - wrap.clientWidth; if (over > 4) { wrap.style.setProperty('--mx', -(over + 40) + 'px'); wrap.style.setProperty('--md', Math.max(6, over / 25) + 's'); wrap.classList.add('go'); } });
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

export { lib, player, toast };
