// Small shared helpers
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function hashStr(s) { // FNV-1a 32 -> base36, plus length salt
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36) + s.length.toString(36);
}
export function hashBytes(b) {
  let h = 0x811c9dc5; const step = Math.max(1, Math.floor(b.length / 8192));
  for (let i = 0; i < b.length; i += step) { h ^= b[i]; h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36) + b.length.toString(36);
}
export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export function throttle(fn, ms) { let last = 0, t; return (...a) => { const n = Date.now(); clearTimeout(t); if (n - last >= ms) { last = n; fn(...a); } else t = setTimeout(() => { last = Date.now(); fn(...a); }, ms - (n - last)); }; }
export function fmtTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
}
export function fmtLong(s) {
  s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h} hr ${m} min` : `${m} min`;
}
export function fmtBytes(n) { if (!n) return '0 B'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; const i = Math.floor(Math.log(n) / Math.log(1024)); return (n / 1024 ** i).toFixed(i ? 1 : 0) + ' ' + u[i]; }
export const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export const sortKey = (s) => norm(s).replace(/^(the|a|an)\s+/, '');
// Fast, natural ("Track 2" before "Track 10") text compare for big sorts; sort keys are cached
const COLL = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }); const SKC = new Map();
const skc = (s) => { s = String(s ?? ''); let k = SKC.get(s); if (k === undefined) { if (SKC.size > 200000) SKC.clear(); k = sortKey(s); SKC.set(s, k); } return k; };
export const cmpText = (a, b) => COLL.compare(skc(a), skc(b));
export function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

// Run async tasks with limited concurrency
export async function pool(items, n, fn) {
  let i = 0; const run = async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
}

// A block-cached range reader on top of a raw read(pos,len) function
export function cachedReader(size, rawRead, block = 65536) {
  const cache = new Map();
  const getBlock = (i) => { if (!cache.has(i)) cache.set(i, rawRead(i * block, Math.min(block, size - i * block))); return cache.get(i); };
  return {
    size,
    async read(pos, len) {
      pos = Math.max(0, pos); len = Math.max(0, Math.min(len, size - pos));
      if (len <= 0) return new Uint8Array(0);
      if (len > block * 4) return new Uint8Array(await rawRead(pos, len));
      const out = new Uint8Array(len); const first = Math.floor(pos / block), last = Math.floor((pos + len - 1) / block);
      const blocks = await Promise.all(Array.from({ length: last - first + 1 }, (_, k) => getBlock(first + k)));
      let o = 0;
      blocks.forEach((bl, k) => { const b = new Uint8Array(bl); const bs = (first + k) * block; const s = Math.max(pos, bs) - bs; const e = Math.min(pos + len, bs + b.length) - bs; out.set(b.subarray(s, e), o); o += e - s; });
      return out;
    }
  };
}

// Extract a vibrant-ish dominant color from an image element/bitmap
export function dominantColor(img) {
  try {
    const c = document.createElement('canvas'); c.width = c.height = 24;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, 24, 24);
    const d = x.getImageData(0, 0, 24, 24).data;
    let best = null, bestScore = -1, ar = 0, ag = 0, ab = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2]; ar += r; ag += g; ab += b;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b); const sat = mx ? (mx - mn) / mx : 0; const lum = mx / 255;
      const score = sat * 1.4 + (lum > 0.25 && lum < 0.95 ? 0.6 : 0) - Math.abs(lum - 0.65) * 0.5;
      if (score > bestScore) { bestScore = score; best = [r, g, b]; }
    }
    const n = d.length / 4;
    if (!best || bestScore < 0.35) best = [ar / n, ag / n, ab / n];
    return '#' + best.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  } catch { return null; }
}

// Resize image bytes to jpeg blobs (big + small) and get a color.
// Tries <img>, then createImageBitmap, then falls back to the original bytes.
let _cw = null, _cwOk = true, _cwSeq = 0; const _cwWait = new Map();
function coverWorker() {
  if (!_cwOk || typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return null;
  if (_cw) return _cw;
  try {
    _cw = new Worker(new URL('./coverworker.js', import.meta.url));
    _cw.onmessage = (e) => { const w = _cwWait.get(e.data.id); if (w) { _cwWait.delete(e.data.id); w(e.data); } };
    _cw.onerror = () => { _cwOk = false; for (const w of _cwWait.values()) w({ error: 'worker failed' }); _cwWait.clear(); };
    return _cw;
  } catch { _cwOk = false; return null; }
}
export async function processCover(bytes, mime) {
  const w = coverWorker();
  if (w) {
    const id = ++_cwSeq; const copy = bytes.slice();
    const res = await new Promise((ok) => { _cwWait.set(id, ok); w.postMessage({ id, bytes: copy, mime }, [copy.buffer]); setTimeout(() => { if (_cwWait.has(id)) { _cwWait.delete(id); ok({ error: 'timeout' }); } }, 8000); });
    if (!res.error && res.big && res.small) return { big: res.big, small: res.small, color: res.color };
  }
  return processCoverMain(bytes, mime);
}
async function processCoverMain(bytes, mime) {
  const type = mime && mime.startsWith('image/') ? mime : (bytes[0] === 0x89 ? 'image/png' : 'image/jpeg');
  const blob = new Blob([bytes], { type });
  let src = null, w = 0, hgt = 0, url = null;
  try {
    url = URL.createObjectURL(blob);
    src = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image decode failed')); i.src = url; });
    w = src.naturalWidth; hgt = src.naturalHeight;
  } catch (e1) {
    try { src = await createImageBitmap(blob); w = src.width; hgt = src.height; }
    catch (e2) { if (url) URL.revokeObjectURL(url); if (bytes.length > 200) return { big: blob, small: blob, color: null, raw: true }; throw e2; }
  }
  try {
    if (!w || !hgt) throw new Error('empty image');
    const mk = (sz, q) => { const c = document.createElement('canvas'); const s = Math.min(sz, Math.max(w, hgt)); const r = Math.min(s / w, s / hgt); c.width = Math.max(1, Math.round(w * r)); c.height = Math.max(1, Math.round(hgt * r)); const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, c.width, c.height); return new Promise((res) => c.toBlob((bl) => res(bl || blob), 'image/jpeg', q)); };
    const [big, small] = await Promise.all([mk(640, 0.86), mk(176, 0.8)]);
    return { big, small, color: dominantColor(src) };
  } finally { if (url) URL.revokeObjectURL(url); src?.close?.(); }
}

export function toast(msg, ms = 2400) {
  const t = h(`<div class="toast">${esc(msg)}</div>`);
  document.getElementById('toasts').appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, ms);
}

// Thin overlay scrollbar: floats over content (no gutter eating into sticky headers or rounded corners), fades when idle, draggable
export function overlayScroll(sc, host = sc.parentElement) {
  if (!sc || sc._ovs) return; sc._ovs = true; sc.classList.add('ovs-hide');
  const bar = document.createElement('div'); bar.className = 'ovs'; const th = document.createElement('div'); th.className = 'ovs-th'; bar.appendChild(th); host.appendChild(bar);
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  let idle = null, raf = 0;
  const place = () => {
    raf = 0; const sh = sc.scrollHeight, ch = sc.clientHeight; const show = sh > ch + 2; bar.style.display = show ? '' : 'none'; if (!show) return;
    const r = sc.getBoundingClientRect(), hr = host.getBoundingClientRect();
    bar.style.top = r.top - hr.top + 6 + 'px'; bar.style.height = ch - 12 + 'px'; bar.style.left = r.right - hr.left - 9 + 'px';
    const trackH = ch - 12, h = Math.max(28, trackH * ch / sh); th.style.height = h + 'px'; th.style.transform = `translateY(${(trackH - h) * sc.scrollTop / (sh - ch)}px)`;
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(place); bar.classList.add('on'); clearTimeout(idle); idle = setTimeout(() => bar.classList.remove('on'), 900); };
  sc.addEventListener('scroll', kick, { passive: true });
  new ResizeObserver(() => { if (!raf) raf = requestAnimationFrame(place); }).observe(sc);
  new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(place); }).observe(sc, { childList: true, subtree: true });
  th.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation(); th.setPointerCapture(e.pointerId); bar.classList.add('drag');
    const y0 = e.clientY, s0 = sc.scrollTop, trackH = sc.clientHeight - 12, ratio = (sc.scrollHeight - sc.clientHeight) / (trackH - th.offsetHeight);
    const mv = (ev) => { sc.scrollTop = s0 + (ev.clientY - y0) * ratio; };
    const up = () => { th.removeEventListener('pointermove', mv); th.removeEventListener('pointerup', up); bar.classList.remove('drag'); };
    th.addEventListener('pointermove', mv); th.addEventListener('pointerup', up);
  });
  bar.addEventListener('pointerenter', () => { bar.classList.add('on'); clearTimeout(idle); });
  bar.addEventListener('pointerleave', () => { idle = setTimeout(() => bar.classList.remove('on'), 600); });
  place();
}
