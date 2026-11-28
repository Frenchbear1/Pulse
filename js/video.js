// Videos: your own video files, kept apart from songs. Desktop plays them straight from folders you pick
// (served by the local server, like music); iPhone/iPad/browser copies imported files into private storage.
// Full-screen glass player with resume, subtitles, speed, PiP, folder next/previous and Media Session.
import { app, lib, player, toast, menu, modal, closeLayer, prompt, confirmBox, coverImg, hydrate, ico, slider } from './core.js';
import { $, esc, h, fmtTime, fmtBytes, hashStr, clamp, norm } from './util.js';

const VIDEO_RE = /\.(mp4|m4v|mov|webm|mkv)$/i, SUB_RE = /\.(vtt|srt)$/i;
const EXT_OF = { 'video/mp4': '.mp4', 'video/x-m4v': '.m4v', 'video/quicktime': '.mov', 'video/webm': '.webm', 'video/x-matroska': '.mkv', 'video/matroska': '.mkv' };
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
// Streaming services: Pulse never saves from these — only files you own or have the rights to.
const STREAMING = ['youtube.com', 'youtu.be', 'youtube-nocookie.com', 'netflix.com', 'hulu.com', 'disneyplus.com', 'max.com', 'hbomax.com', 'primevideo.com', 'tiktok.com', 'instagram.com', 'vimeo.com', 'spotify.com', 'music.apple.com', 'tv.apple.com', 'twitch.tv', 'dailymotion.com', 'facebook.com', 'peacocktv.com', 'paramountplus.com', 'crunchyroll.com'];

// ---------- icons this module needs (added once to the page's sprite set) ----------
const ICONS = {
  vfilm: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M7.5 4v16M16.5 4v16M3 9h4.5M3 15h4.5M16.5 9H21M16.5 15H21"/>',
  vpip: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><rect x="11.5" y="11" width="7" height="5.5" rx="1.3" fill="currentColor" stroke="none"/>',
  vcc: '<rect x="3" y="5.5" width="18" height="13" rx="3"/><path d="M10.6 10.3a2.2 2.2 0 1 0 0 3.4M16.8 10.3a2.2 2.2 0 1 0 0 3.4"/>',
  vback10: '<path d="M5 12.5a7.5 7.5 0 1 0 2.4-5.5"/><path d="M7.6 3.2 7.4 7l3.7.3"/><text x="12.6" y="15.6" text-anchor="middle" font-size="7.2" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor" stroke="none">10</text>',
  vfwd10: '<path d="M19 12.5a7.5 7.5 0 1 1-2.4-5.5"/><path d="m16.4 3.2.2 3.8-3.7.3"/><text x="11.4" y="15.6" text-anchor="middle" font-size="7.2" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor" stroke="none">10</text>',
  vlink: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  vreplay: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 4.5V9H9"/>'
};
function addIcons() {
  if (typeof document === 'undefined' || document.getElementById('i-vfilm')) return;
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('aria-hidden', 'true'); s.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  s.innerHTML = Object.entries(ICONS).map(([k, d]) => `<symbol id="i-${k}" viewBox="0 0 24 24">${d}</symbol>`).join('');
  (document.body || document.documentElement).appendChild(s);
}

// ---------- data ----------
const P = () => app.P;
const isDesk = () => P()?.kind === 'desktop';
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const V = () => (lib.db.videos ||= {});
const vroots = () => (lib.db.videoRoots ||= []);
const hiddenV = () => (lib.db.videoHidden ||= {});
const save = () => (lib.save ? lib.save() : lib.saveNow());
const titleOf = (v) => v.title || v.name.replace(/\.[^.]+$/, '');
const rootOf = (v) => vroots().find((r) => r.id === v.root);
const groupKey = (v) => v.root + '|' + (v.dirs || []).join('/');
const groupLabel = (v) => { const base = v.stored ? 'On this device' : rootOf(v)?.name || 'Videos'; return [base, ...(v.dirs || [])].join(' › '); };
const natural = (a, b) => titleOf(a).localeCompare(titleOf(b), undefined, { numeric: true, sensitivity: 'base' });
const stemKeys = (rel) => { const s = rel.replace(SUB_RE, '').toLowerCase(); return [s, s.replace(/\.[a-z]{2,3}(-[a-z]{2})?$/, '')]; };
const once = (el, ev, ms = 15000) => new Promise((res, rej) => {
  const t = setTimeout(() => { off(); rej(new Error('timeout: ' + ev)); }, ms);
  const ok = () => { off(); res(); }, bad = () => { off(); rej(el.error || new Error('media error')); };
  const off = () => { clearTimeout(t); el.removeEventListener(ev, ok); el.removeEventListener('error', bad); };
  el.addEventListener(ev, ok); el.addEventListener('error', bad);
});

// SRT -> WebVTT (and tidy an existing VTT)
export function toVTT(text) {
  let t = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
  if (/^WEBVTT/.test(t)) return t + '\n';
  t = t.replace(/(\d+):(\d{2}):(\d{2})[,.](\d{1,3})/g, (m, hh, mm, ss, ms) => `${hh.padStart(2, '0')}:${mm}:${ss}.${ms.padEnd(3, '0')}`)
    .replace(/\{\\[^}]*\}/g, '').replace(/<\/?font[^>]*>/gi, '');
  return 'WEBVTT\n\n' + t + '\n';
}

// ---------- desktop folders ----------
const mounted = new Set();
async function ensureMounted(rootId) {
  if (!isDesk() || mounted.has(rootId)) return;
  const r = vroots().find((x) => x.id === rootId); if (!r) throw new Error('This video folder is no longer in Pulse');
  await P().mountRoot(r); mounted.add(rootId);
}
async function scanRoot(r) {
  const list = await P().listVideoRoot(r); mounted.add(r.id);
  const db = V(), hid = hiddenV(), seen = new Set();
  for (const f of list) {
    seen.add(f.id); if (hid[f.id]) continue;
    const old = db[f.id];
    db[f.id] = old ? Object.assign(old, { rel: f.rel, name: f.name, dirs: f.dirs, sub: f.sub }) : { ...f, size: 0, duration: 0, added: Date.now(), poster: null, pos: 0 };
  }
  for (const v of Object.values(db)) if (v.root === r.id && !v.stored && !seen.has(v.id)) dropVideo(v); // the file is gone from disk
  return list.length;
}
let scannedThisSession = false;
async function rescanAll(quiet) {
  let n = 0;
  for (const r of vroots()) { try { n += await scanRoot(r); } catch (e) { console.warn('video scan', r.path, e); if (!quiet) toast(`Couldn't read “${r.name}”`); } }
  scannedThisSession = true; save(); redraw();
  return n;
}
async function addVideoFolder() {
  const r = await P().pickRoot(); if (!r) return;
  if (!vroots().some((x) => x.id === r.id)) vroots().push(r);
  busy(`Scanning ${r.name}…`);
  try { const n = await scanRoot(r); toast(n ? `Found ${n} video${n === 1 ? '' : 's'} in “${r.name}”` : `No videos found in “${r.name}” (MP4, M4V, MOV, WebM, MKV)`); }
  catch (e) { console.warn(e); toast(`Couldn't read “${r.name}”`); }
  busy(null); save(); redraw();
}
async function removeVideoFolder(r) {
  if (!(await confirmBox(`Remove “${r.name}”?`, 'Pulse stops showing videos from this folder. Nothing is deleted from your computer.', 'Remove'))) return;
  for (const v of Object.values(V())) if (v.root === r.id && !v.stored) dropVideo(v);
  for (const [id, root] of Object.entries(hiddenV())) if (root === r.id) delete hiddenV()[id];
  lib.db.videoRoots = vroots().filter((x) => x.id !== r.id); mounted.delete(r.id);
  save(); redraw(); toast(`Removed “${r.name}”`);
}
function dropVideo(v) {
  if (v.poster) P().deleteCover(v.poster).catch(() => {});
  delete V()[v.id];
}

// ---------- web: import files into storage ----------
function pickVideoFiles(folder) {
  return new Promise((res) => {
    const i = document.createElement('input'); i.type = 'file'; i.multiple = true;
    i.accept = 'video/*,.mp4,.m4v,.mov,.webm,.mkv,.vtt,.srt';
    if (folder) { i.webkitdirectory = true; i.setAttribute('webkitdirectory', ''); }
    i.style.display = 'none'; document.body.appendChild(i);
    i.onchange = () => { res([...i.files]); i.remove(); };
    i.oncancel = () => { res([]); i.remove(); };
    i.click();
  });
}
function pickSubFile() {
  return new Promise((res) => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = '.vtt,.srt,text/vtt';
    i.style.display = 'none'; document.body.appendChild(i);
    i.onchange = () => { res(i.files[0] || null); i.remove(); }; i.oncancel = () => { res(null); i.remove(); };
    i.click();
  });
}
const quotaMsg = (e) => /quota/i.test(e?.name + ' ' + e?.message) ? 'Not enough storage space on this device' : 'Could not save';
export async function importVideoFiles(files) {
  const subs = new Map(), vids = [];
  for (const f of files) {
    const rel = (f.webkitRelativePath || f.name).replace(/\\/g, '/');
    if (SUB_RE.test(f.name)) { for (const k of stemKeys(rel)) if (!subs.has(k) || /\.vtt$/i.test(f.name)) subs.set(k, f); }
    else if (VIDEO_RE.test(f.name) || f.type.startsWith('video/')) vids.push({ f, rel });
  }
  if (!vids.length) { if (files.length) toast('No videos in that selection (MP4, M4V, MOV, WebM, MKV)'); return 0; }
  let n = 0;
  for (const [k, { f, rel }] of vids.entries()) {
    busy(`Importing ${k + 1} of ${vids.length}…`);
    const id = hashStr('v|web|' + rel + '|' + f.size + '|' + f.lastModified);
    if (V()[id]) continue;
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    try { await P().saveVideoFile(id, f); } catch (e) { console.warn(e); toast(`${quotaMsg(e)} — stopped at “${f.name}”`, 4200); break; }
    const v = V()[id] = { id, root: 'device', stored: true, rel, name: f.name, dirs: dir ? dir.split('/') : [], size: f.size, duration: 0, added: Date.now(), poster: null, pos: 0, mime: f.type || '' };
    const sf = subs.get(rel.replace(/\.[^.]+$/, '').toLowerCase());
    if (sf) { try { await P().saveVideoSub(id, toVTT(await sf.text())); v.sub = 'stored'; } catch (e) { console.warn('subtitles', e); } }
    n++; redrawSoon();
  }
  busy(null); save(); redraw();
  if (n) toast(`Imported ${n} video${n === 1 ? '' : 's'}`); else toast('Those videos are already in Pulse');
  return n;
}
async function importFlow(at) {
  const run = async (folder) => { const files = await pickVideoFiles(folder); if (files.length) await importVideoFiles(files); };
  if (!('webkitdirectory' in HTMLInputElement.prototype) || isIOS) return run(false);
  menu([{ label: 'Choose videos', icon: 'vfilm', action: () => run(false) }, { label: 'Choose a folder', icon: 'folder', action: () => run(true) }], at);
}

// ---------- add from a direct link to a file you own ----------
export function checkLink(raw) {
  let u; try { u = new URL(String(raw || '').trim()); } catch { return { err: 'That doesn’t look like a web address. Paste a direct link to a video file.' }; }
  if (!/^https?:$/.test(u.protocol)) return { err: 'Only http:// or https:// links to a video file work here.' };
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (STREAMING.some((d) => host === d || host.endsWith('.' + d))) return { err: 'Pulse only saves video files you own or have the rights to — it can’t save from streaming sites like this one.' };
  if (/\.(m3u8|mpd)$/i.test(u.pathname)) return { err: 'That’s a streaming playlist, not a single file. Use a direct link to one video file.' };
  if (/\.(html?|php|aspx?|jsp)$/i.test(u.pathname)) return { err: 'That link opens a web page, not a video file. Use a direct download link (it usually ends in .mp4).' };
  if (location.protocol === 'https:' && u.protocol === 'http:') return { err: 'Pulse runs on a secure page, so it can only download https:// links.' };
  return { u };
}
function fileNameFor(u, r, ct) {
  let name = '';
  const cd = r.headers.get('content-disposition') || '';
  const m = /filename\*=UTF-8''([^;]+)/i.exec(cd) || /filename="?([^";]+)"?/i.exec(cd);
  if (m) { try { name = decodeURIComponent(m[1]); } catch { name = m[1]; } }
  if (!name) { try { name = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || ''); } catch { name = ''; } }
  name = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Video';
  if (!VIDEO_RE.test(name)) name = name.replace(/\.[a-z0-9]{1,5}$/i, '') + (EXT_OF[ct] || '.mp4');
  return name;
}
async function addFromLink() {
  const raw = await prompt('Add a video from a link', '', 'https://example.com/my-video.mp4');
  if (!raw) return;
  const { u, err } = checkLink(raw); if (err) { toast(err, 5200); return; }
  // desktop: save into one of your video folders (falls back to Pulse's own storage when there isn't one)
  let root = null;
  if (isDesk() && vroots().length) {
    root = vroots().length === 1 ? vroots()[0] : await new Promise((res) => { const m = menu([{ header: 'Save into' }, ...vroots().map((r) => ({ label: r.name, icon: 'folder', action: () => res(r) }))], { x: innerWidth / 2 - 120, y: innerHeight / 3 }); const obs = new MutationObserver(() => { if (!m.isConnected) { obs.disconnect(); setTimeout(() => res(null), 0); } }); obs.observe($('#layer'), { childList: true }); });
    if (!root) return;
  }
  const ac = new AbortController(); let cancelled = false;
  const dlg = modal(`<h2>Downloading</h2><p class="vdl-name">${esc(u.hostname)}</p><div class="vdl-bar"><i></i></div><p class="vdl-sub">Connecting…</p><div class="row"><button class="pill" id="vdlCancel">Cancel</button></div>`);
  dlg.classList.add('vdl');
  // the modal closes on a click outside; keep the download going but make Cancel the only way to stop it
  dlg.querySelector('#vdlCancel').onclick = () => { cancelled = true; ac.abort(); closeLayer(); };
  const set = (p, txt) => { if (!dlg.isConnected) return; dlg.querySelector('.vdl-bar i').style.width = (p == null ? 30 : p * 100) + '%'; dlg.querySelector('.vdl-bar').classList.toggle('ind', p == null); if (txt) dlg.querySelector('.vdl-sub').textContent = txt; };
  const fail = (msg) => { if (dlg.isConnected) closeLayer(); toast(msg, 6000); };
  let r;
  try { r = await fetch(u.href, { signal: ac.signal, credentials: 'omit', redirect: 'follow' }); }
  catch (e) { if (cancelled) return toast('Download cancelled'); return fail('That server doesn’t let apps download from it (it blocks cross-site requests, called CORS). Download the file in your browser, then import it.'); }
  if (!r.ok) return fail(`The server answered ${r.status}${r.statusText ? ' ' + r.statusText : ''} — check the link.`);
  const fin = checkLink(r.url || u.href); if (fin.err && !/secure page/.test(fin.err)) { ac.abort(); return fail(fin.err); }
  const ct = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const okType = !ct || ct.startsWith('video/') || ct === 'application/octet-stream' || ct === 'binary/octet-stream' || ct === 'application/mp4';
  if (!okType) { ac.abort(); return fail(ct.startsWith('text/') || ct.includes('json') ? 'That link opens a web page, not a video file. Use a direct download link to the file itself.' : `That link isn’t a video file (${ct}).`); }
  const name = fileNameFor(new URL(r.url || u.href), r, ct);
  if (!VIDEO_RE.test(name)) { ac.abort(); return fail('Pulse can play MP4, M4V, MOV, WebM and MKV files.'); }
  dlg.querySelector('.vdl-name').textContent = name;
  const total = +(r.headers.get('content-length') || 0);
  const reader = r.body.getReader();
  let got = 0, path = null, wrote = false, pend = [], pendN = 0, blob = new Blob([]);
  if (root) { path = root.path.replace(/\/+$/, '') + '/' + name; for (let k = 2; await P().pathExists(path); k++) path = root.path.replace(/\/+$/, '') + '/' + name.replace(/(\.[^.]+)$/, ` (${k})$1`); }
  const flush = async () => {
    if (!pendN) return; const buf = new Uint8Array(pendN); let o = 0; for (const c of pend) { buf.set(c, o); o += c.length; } pend = []; pendN = 0;
    if (path) { await P().writeChunk(path, buf.buffer, wrote); wrote = true; } else blob = new Blob([blob, buf], { type: ct || 'video/mp4' });
  };
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      pend.push(value); pendN += value.length; got += value.length;
      if (pendN >= (path ? 4 : 16) * 1048576) await flush();
      set(total ? got / total : null, total ? `${fmtBytes(got)} of ${fmtBytes(total)}` : fmtBytes(got));
    }
    await flush();
  } catch (e) {
    if (path && wrote) await P().removeFile(path);
    if (cancelled) return toast('Download cancelled');
    console.warn(e); return fail(/quota/i.test(e?.name + e?.message) ? 'Not enough storage space for this video.' : 'The download stopped before it finished. Try again.');
  }
  if (cancelled) { if (path && wrote) await P().removeFile(path); return; }
  set(1, 'Saving…');
  let v;
  if (path) {
    await scanRoot(root); const rel = path.slice(root.path.replace(/\/+$/, '').length + 1);
    v = Object.values(V()).find((x) => x.root === root.id && x.rel === rel);
  } else {
    const id = hashStr('v|link|' + u.href + '|' + got);
    try { await P().saveVideoFile(id, blob); } catch (e) { console.warn(e); return fail(`${quotaMsg(e)} “${name}”.`); }
    v = V()[id] = { id, root: 'device', stored: true, rel: name, name, dirs: ['Saved from links'], size: got, duration: 0, added: Date.now(), poster: null, pos: 0, mime: ct, from: u.hostname };
  }
  if (dlg.isConnected) closeLayer();
  save(); redraw(); toast(`Saved “${v ? titleOf(v) : name}”`);
}

// ---------- posters (a frame ~10% in, made on this device) ----------
const posterQ = [], posterTried = new Set(); let posterBusy = false;
function wantPosters(list) { for (const v of list) if (!v.poster && !v.noPoster && !posterTried.has(v.id)) { posterTried.add(v.id); posterQ.push(v.id); } runPosters(); }
async function runPosters() {
  if (posterBusy) return; posterBusy = true;
  try { while (posterQ.length) { const v = V()[posterQ.shift()]; if (!v || v.poster) continue; try { await makePoster(v); } catch (e) { console.debug('poster', v.name, e?.message || e); } } }
  finally { posterBusy = false; }
}
async function srcFor(v) {
  if (v.stored) {
    const f = await P().getVideoFile(v.id); if (!f) return null;
    const url = URL.createObjectURL(f); return { url, revoke: () => URL.revokeObjectURL(url) };
  }
  await ensureMounted(v.root); return { url: P().videoURL(v), revoke() {} };
}
async function makePoster(v) {
  if (isDesk() && !v.stored && !v.size) { const r = rootOf(v); const st = r && (await P().videoStat(v, r)); if (st) v.size = st.size; }
  const src = await srcFor(v); if (!src) { v.missing = true; save(); updateCard(v); return; }
  const vid = document.createElement('video'); vid.muted = true; vid.playsInline = true; vid.setAttribute('playsinline', ''); vid.preload = 'auto';
  vid.style.cssText = 'position:fixed;left:-10px;top:-10px;width:2px;height:2px;opacity:0;pointer-events:none'; // in the page so phones decode a frame
  document.body.appendChild(vid);
  try {
    vid.src = src.url;
    await once(vid, 'loadedmetadata');
    if (isFinite(vid.duration) && vid.duration > 0) v.duration = vid.duration;
    v.w = vid.videoWidth || 0; v.h = vid.videoHeight || 0;
    if (!vid.videoWidth) { v.noPoster = true; return; } // audio-only or a codec this device can't decode
    const d = v.duration || 0;
    vid.currentTime = d ? Math.min(d * 0.1, Math.max(0, d - 0.5)) : 1;
    await once(vid, 'seeked');
    await new Promise((r) => { const t = setTimeout(r, 350); vid.requestVideoFrameCallback?.(() => { clearTimeout(t); r(); }); });
    const mk = (W, q) => { const c = document.createElement('canvas'); const s = Math.min(1, W / vid.videoWidth); c.width = Math.round(vid.videoWidth * s); c.height = Math.round(vid.videoHeight * s); c.getContext('2d').drawImage(vid, 0, 0, c.width, c.height); return new Promise((ok) => c.toBlob(ok, 'image/jpeg', q)); };
    const [big, small] = await Promise.all([mk(640, 0.82), mk(360, 0.76)]);
    if (!big || !small) throw new Error('could not encode poster');
    const key = 'v_' + v.id; await P().saveCover(key, big, small); v.poster = key;
  } finally { vid.removeAttribute('src'); try { vid.load(); } catch {} vid.remove(); src.revoke(); save(); updateCard(v); }
}

// ---------- page ----------
let pageEl = null, busyText = null;
const redraw = () => pageEl?._draw?.();
let rdT = 0; const redrawSoon = () => { clearTimeout(rdT); rdT = setTimeout(redraw, 300); };
function busy(t) { busyText = t; const s = pageEl?.querySelector('.v-status'); if (s) { s.classList.toggle('show', !!t); if (t) s.querySelector('span:last-child').textContent = t; } }
const leftOf = (v) => v.duration ? Math.max(0, v.duration - (v.pos || 0)) : 0;
// the last few % (credits) count as finished: 3 s for a short clip, up to 2 min for a film
const endZone = (d) => Math.min(Math.max(d * 0.05, 3), 120);
function cardHTML(v, i, cont) {
  const prog = v.duration && v.pos > 5 && !v.watched ? clamp(v.pos / v.duration, 0.02, 1) : 0;
  const q = v.h >= 2000 ? '4K' : v.h >= 700 ? 'HD' : v.h ? v.h + 'p' : '';
  const sub = cont ? (leftOf(v) < 60 ? `${Math.round(leftOf(v))} sec left` : `${Math.round(leftOf(v) / 60)} min left`) : v.missing ? 'File not found' : v.watched ? 'Watched' : [q, v.size ? fmtBytes(v.size) : ''].filter(Boolean).join(' • ') || (v.stored ? 'On this device' : (v.name.split('.').pop() || '').toUpperCase());
  return `<div class="card vcard${v.missing ? ' missing' : ''}" data-vid="${esc(v.id)}" style="--i:${Math.min(i, 24)}"><div class="cv vcv">${v.poster ? coverImg(v.poster, true) : `<div class="gen-cover vph">${ico('vfilm')}</div>`}${v.duration ? `<span class="vdur">${fmtTime(v.duration)}</span>` : ''}${v.watched ? `<span class="vseen" title="Watched">${ico('check')}</span>` : ''}${v.sub ? '<span class="vcc-b" title="Has subtitles">CC</span>' : ''}${prog ? `<i class="vprog" style="--p:${prog.toFixed(3)}"></i>` : ''}<button class="fab" data-play title="Play">${ico('play')}</button><button class="ib sm vmore" data-more title="More">${ico('more')}</button></div><b title="${esc(titleOf(v))}">${esc(titleOf(v))}</b><small>${esc(sub)}</small></div>`;
}
function updateCard(v) {
  if (!pageEl) return;
  for (const c of pageEl.querySelectorAll(`[data-vid="${v.id}"]`)) { if (!V()[v.id]) { c.remove(); continue; } const n = h(cardHTML(v, 0, !!c.closest('.v-cont'))); n.style.animation = 'none'; c.replaceWith(n); hydrate(n); }
}
function longPress(el, fn) {
  let t = null, sx = 0, sy = 0;
  const stop = (e) => { e.stopPropagation(); e.preventDefault(); };
  el.addEventListener('touchstart', (e) => { const c = e.target.closest('[data-vid]'); if (!c) return; sx = e.touches[0].clientX; sy = e.touches[0].clientY; t = setTimeout(() => { t = null; navigator.vibrate?.(8); fn(c, { x: sx, y: sy }); el.addEventListener('click', stop, { capture: true, once: true }); }, 480); }, { passive: true });
  el.addEventListener('touchmove', (e) => { if (t && Math.hypot(e.touches[0].clientX - sx, e.touches[0].clientY - sy) > 10) { clearTimeout(t); t = null; } }, { passive: true });
  el.addEventListener('touchend', () => { clearTimeout(t); t = null; });
}

export function renderVideos(params = {}) {
  addIcons();
  const desk = isDesk();
  const el = h(`<div class="page videos">
    <div class="page-h"><h1>Videos</h1>
      ${desk ? `<button class="pill solid" data-a="addfolder">${ico('folder')}<span>Add video folder</span></button>` : `<button class="pill solid" data-a="import">${ico('import')}<span>Import videos</span></button>`}
      <button class="pill" data-a="link" title="Save a video file from a direct link">${ico('vlink')}<span>Add from link</span></button>
      ${desk ? `<button class="ib" data-a="rescan" title="Rescan video folders">${ico('refresh')}</button><button class="ib" data-a="folders" title="Video folders">${ico('more')}</button>` : ''}
    </div>
    <div class="v-bar"><label class="tb-search v-q">${ico('search')}<input placeholder="Filter videos" spellcheck="false"></label><button class="pill v-sort">${ico('sort')}<span></span></button><span class="v-status scan-pill"><span class="spin"></span><span></span></span></div>
    <div class="v-body"></div>
  </div>`);
  pageEl = el;
  const prevCleanup = app.cleanup; app.cleanup = () => { prevCleanup?.(); if (pageEl === el) pageEl = null; };
  const body = el.querySelector('.v-body'), qIn = el.querySelector('.v-q input'), sortB = el.querySelector('.v-sort');
  let q = params.q || ''; qIn.value = q;
  const sorts = [['name', 'Name'], ['added', 'Recently added'], ['length', 'Length']];
  const sortFn = () => ({ added: (a, b) => (b.added || 0) - (a.added || 0) || natural(a, b), length: (a, b) => (b.duration || 0) - (a.duration || 0) || natural(a, b) }[app.S.videoSort] || natural);
  el._draw = () => {
    const all = Object.values(V());
    sortB.querySelector('span').textContent = sorts.find((s) => s[0] === (app.S.videoSort || 'name'))[1];
    el.querySelector('.v-bar').classList.toggle('hidden', !all.length);
    if (!all.length) {
      body.innerHTML = `<div class="empty">${ico('vfilm')}<h3>Your videos</h3><p>${desk ? 'Add a folder of your own videos — movies, lessons, home videos. Pulse plays them right from your drive, with resume, subtitles and picture-in-picture.' : 'Import videos from Files or Photos. They’re kept privately in Pulse on this device and play offline, with resume and subtitles.'}</p><div class="btns">${desk ? `<button class="pill solid" data-a="addfolder">${ico('folder')}Add video folder</button>` : `<button class="pill solid" data-a="import">${ico('import')}Import videos</button>`}<button class="pill" data-a="link">${ico('vlink')}Add from link</button></div></div>`;
      return;
    }
    const nq = norm(q).trim(); const list = nq ? all.filter((v) => norm(titleOf(v) + ' ' + groupLabel(v)).includes(nq)) : all;
    let html = '';
    const cont = nq ? [] : all.filter((v) => v.pos > 5 && !v.watched && v.duration && leftOf(v) > endZone(v.duration)).sort((a, b) => (b.last || 0) - (a.last || 0)).slice(0, 12);
    if (cont.length) html += `<div class="sec"><h2>Continue watching</h2></div><div class="grid row vgrid v-cont">${cont.map((v, i) => cardHTML(v, i, true)).join('')}</div>`;
    const groups = new Map(); for (const v of list) { const k = groupKey(v); if (!groups.has(k)) groups.set(k, { label: groupLabel(v), items: [] }); groups.get(k).items.push(v); }
    const gs = [...groups.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));
    const fn = sortFn();
    for (const g of gs) { g.items.sort(fn); const segs = g.label.split(' › '); html += `<div class="sec v-sec"><h2>${segs.map((s, i) => i < segs.length - 1 ? `<span class="v-crumb">${esc(s)}</span>` : esc(s)).join(`<span class="v-crumb">${ico('fwd')}</span>`)}</h2><small class="sec-note">${g.items.length} video${g.items.length === 1 ? '' : 's'}</small></div><div class="grid vgrid">${g.items.map((v, i) => cardHTML(v, i)).join('')}</div>`; }
    if (!list.length) html += `<div class="tree-empty">No videos match “${esc(q)}”.</div>`;
    body.innerHTML = html; hydrate(body);
    wantPosters(list);
  };
  el._draw(); busy(busyText);
  qIn.addEventListener('input', () => { q = qIn.value; el._draw(); });
  qIn.addEventListener('keydown', (e) => { if (e.key === 'Escape' && qIn.value) { e.stopPropagation(); qIn.value = q = ''; el._draw(); } });
  sortB.onclick = () => menu(sorts.map(([k, l]) => ({ label: l, checked: (app.S.videoSort || 'name') === k, action: () => { app.S.videoSort = k; app.saveS(); el._draw(); } })), { el: sortB, right: true });
  el.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]');
    if (a) {
      const k = a.dataset.a;
      if (k === 'addfolder') addVideoFolder();
      else if (k === 'import') importFlow({ el: a });
      else if (k === 'link') addFromLink();
      else if (k === 'rescan') { busy('Rescanning…'); rescanAll().then((n) => { busy(null); toast(`${n} video${n === 1 ? '' : 's'} in your folders`); }); }
      else if (k === 'folders') menu([{ header: 'Video folders' }, ...vroots().map((r) => ({ label: r.name, icon: 'folder', sub: [{ label: 'Rescan', icon: 'refresh', action: () => scanRoot(r).then(() => { save(); redraw(); }) }, { label: 'Remove from Pulse', icon: 'x', danger: true, action: () => removeVideoFolder(r) }] })), vroots().length ? '-' : null, { label: 'Add video folder', icon: 'plus', action: addVideoFolder }], { el: a, right: true });
      return;
    }
    const c = e.target.closest('[data-vid]'); if (!c) return;
    if (e.target.closest('[data-more]')) { e.stopPropagation(); videoMenu(c.dataset.vid, { el: e.target.closest('[data-more]'), right: true }); return; }
    openVideo(c.dataset.vid);
  });
  el.addEventListener('contextmenu', (e) => { const c = e.target.closest('[data-vid]'); if (!c) return; e.preventDefault(); videoMenu(c.dataset.vid, { x: e.clientX, y: e.clientY }); });
  longPress(el, (c, at) => videoMenu(c.dataset.vid, at));
  if (desk && vroots().length && !scannedThisSession) { scannedThisSession = true; setTimeout(() => rescanAll(true), 400); }
  return el;
}

// ---------- per-video menu ----------
function videoMenu(id, at) {
  const v = V()[id]; if (!v) return;
  const resume = v.pos > 5 && !v.watched;
  menu([
    { label: resume ? `Resume (${fmtTime(v.pos)})` : 'Play', icon: 'play', action: () => openVideo(id) },
    resume && { label: 'Play from beginning', icon: 'vreplay', action: () => openVideo(id, { fromStart: true }) },
    '-',
    { label: v.watched ? 'Mark as unwatched' : 'Mark as watched', icon: 'check', action: () => { v.watched = !v.watched; v.pos = 0; save(); updateCard(v); redrawSoon(); } },
    { label: 'Rename', icon: 'edit', action: () => renameVideo(v) },
    { label: v.sub ? 'Replace subtitles…' : 'Add subtitles…', icon: 'vcc', action: () => loadSubsFor(v) },
    { label: 'Make new thumbnail', icon: 'image', action: () => { if (v.poster) P().deleteCover(v.poster).catch(() => {}); v.poster = null; v.noPoster = false; posterTried.delete(v.id); updateCard(v); wantPosters([v]); } },
    { label: 'Show info', icon: 'info', action: () => showInfo(v) },
    isDesk() && !v.stored && { label: 'Show in File Explorer', icon: 'folder', action: () => { const r = rootOf(v); if (r) P().revealTrack(v, r); } },
    '-',
    { label: 'Remove from Pulse', icon: 'trash', danger: true, action: () => removeVideo(v) }
  ], at, { head: `<div class="mh">${esc(titleOf(v))}</div>` });
}
async function renameVideo(v) {
  const n = await prompt('Rename video', titleOf(v)); if (!n) return;
  v.title = n === v.name.replace(/\.[^.]+$/, '') ? undefined : n; save(); updateCard(v);
  if (S?.v === v) S.el.querySelector('.vp-title b').textContent = titleOf(v);
}
async function removeVideo(v) {
  const ok = await confirmBox(`Remove “${titleOf(v)}”?`, v.stored ? 'This deletes the copy stored in Pulse on this device.' : 'Pulse stops showing it. The file stays on your computer.', 'Remove');
  if (!ok) return;
  if (S?.v === v) closeVideo();
  if (v.stored) { try { await P().deleteVideoFile(v.id); } catch (e) { console.warn(e); } } else hiddenV()[v.id] = v.root;
  dropVideo(v); save(); redraw(); toast('Removed from Pulse');
}
async function loadSubsFor(v) {
  const f = await pickSubFile(); if (!f) return;
  try { const vtt = toVTT(await f.text()); await P().saveVideoSub(v.id, vtt); if (v.stored) v.sub = 'stored'; else { v.subStored = true; v.sub = v.sub || 'stored'; } save(); updateCard(v); toast('Subtitles added'); if (S?.v === v) attachSubs(vtt, true); }
  catch (e) { console.warn(e); toast('Couldn’t read those subtitles'); }
}
function showInfo(v) {
  const r = rootOf(v);
  const rows = [['Name', v.name], ['Folder', groupLabel(v)], v.duration && ['Length', fmtTime(v.duration)], v.w && ['Resolution', `${v.w} × ${v.h}`], v.size && ['Size', fmtBytes(v.size)], ['Type', (v.name.split('.').pop() || '').toUpperCase()], ['Subtitles', v.sub ? (v.sub === 'stored' || v.subStored ? 'Added in Pulse' : v.sub.split('/').pop()) : 'None'], v.pos > 5 && !v.watched && ['Resume at', fmtTime(v.pos)], v.watched && ['Status', 'Watched'], ['Added', new Date(v.added || Date.now()).toLocaleString()], v.from && ['Saved from', v.from], isDesk() && !v.stored && r && ['Location', r.path + '/' + v.rel], v.stored && ['Stored', 'Inside Pulse on this device']].filter(Boolean);
  modal(`<h2>${esc(titleOf(v))}<button class="ib sm" data-close>${ico('x')}</button></h2><div class="v-info">${rows.map(([k, x]) => `<span>${esc(k)}</span><b>${esc(x)}</b>`).join('')}</div>`);
}

// =====================================================================
// Player overlay
// =====================================================================
let S = null; // the open session
const canVolume = (() => { try { const a = document.createElement('video'); a.volume = 0.5; return a.volume === 0.5 && !isIOS; } catch { return false; } })();
const pipOK = () => (document.pictureInPictureEnabled && !!HTMLVideoElement.prototype.requestPictureInPicture) || !!HTMLVideoElement.prototype.webkitSetPresentationMode;
const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
const siblings = (v) => Object.values(V()).filter((x) => groupKey(x) === groupKey(v)).sort(natural);

function buildPlayer() {
  addIcons();
  const el = h(`<div class="vplayer" role="dialog" aria-label="Video player">
    <video playsinline webkit-playsinline preload="auto"></video>
    <div class="vp-hit"></div>
    <div class="vp-shade"></div>
    <div class="vp-spin"><span class="spin"></span></div>
    <div class="vp-msg hidden"><b></b><span></span></div>
    <div class="vp-flash"></div>
    <div class="vp-top">
      <button class="vp-b" data-a="close" title="Close (Esc)">${ico('back')}</button>
      <div class="vp-title"><b></b><small></small></div>
      <button class="vp-b vp-cc vp-mob" data-a="subs" title="Subtitles">${ico('vcc')}</button>
      ${pipOK() ? `<button class="vp-b vp-mob" data-a="pip" title="Picture in picture">${ico('vpip')}</button>` : ''}
      <button class="vp-b" data-a="more" title="More">${ico('more')}</button>
    </div>
    <div class="vp-mid">
      <button class="vp-b vp-big" data-a="back10" title="Back 10 seconds (←)">${ico('vback10')}</button>
      <button class="vp-b vp-pp" data-a="toggle" title="Play / pause (Space)">${ico('play')}</button>
      <button class="vp-b vp-big" data-a="fwd10" title="Forward 10 seconds (→)">${ico('vfwd10')}</button>
    </div>
    <div class="vp-resume hidden"><span></span><button data-a="restart">Start over</button></div>
    <div class="vp-next hidden"><div class="vp-next-art"></div><div class="vp-next-t"><small>Up next</small><b></b></div><div class="vp-next-btns"><button class="pill solid" data-a="nextnow">${ico('play')}Play now</button><button class="pill" data-a="nextcancel">Cancel</button></div><i class="vp-next-bar"></i></div>
    <div class="vp-bar">
      <div class="seek-row vp-seek"><span class="vp-cur">0:00</span><div class="slider seek"><div class="buf"></div><div class="fill"></div><div class="knob"></div><div class="tip"></div></div><span class="vp-dur">0:00</span></div>
      <div class="vp-ctl">
        <button class="vp-b" data-a="prev" title="Previous in folder (Shift+P)">${ico('prev')}</button>
        <button class="vp-b vp-pp2" data-a="toggle" title="Play / pause">${ico('play')}</button>
        <button class="vp-b" data-a="next" title="Next in folder (Shift+N)">${ico('next')}</button>
        ${canVolume ? `<div class="vp-vol"><button class="vp-b" data-a="mute" title="Mute (M)">${ico('vol')}</button><div class="slider"><div class="fill"></div><div class="knob"></div></div></div>` : ''}
        <span class="grow"></span>
        <button class="vp-pill" data-a="speed" title="Speed (&lt; &gt;)">1×</button>
        <button class="vp-b vp-cc vp-desk" data-a="subs" title="Subtitles (C)">${ico('vcc')}</button>
        ${pipOK() ? `<button class="vp-b vp-desk" data-a="pip" title="Picture in picture (I)">${ico('vpip')}</button>` : ''}
        <button class="vp-b" data-a="fs" title="Full screen (F)">${ico('expand')}</button>
      </div>
    </div>
  </div>`);
  document.body.appendChild(el);
  const video = el.querySelector('video');
  const s = S = { el, video, v: null, src: null, subURL: null, idle: false, hideT: 0, lastSave: 0, lastPos: 0, speed: 1, offs: [] };
  if (app.S.sink && app.S.sink !== 'default' && video.setSinkId) video.setSinkId(app.S.sink).catch(() => {});
  video.volume = clamp(app.S.videoVol ?? 1, 0, 1); video.muted = !!app.S.videoMuted;

  // seek + volume
  const seekEl = el.querySelector('.vp-seek .slider');
  const dur = () => (isFinite(video.duration) && video.duration > 0 ? video.duration : s.v?.duration || 0);
  s.seek = slider(seekEl, { get: () => (dur() ? video.currentTime / dur() : 0), set: (x) => { if (dur()) video.currentTime = x * dur(); poke(); }, preview: (x, hover) => { seekEl.querySelector('.tip').textContent = fmtTime(x * dur()); if (!hover) el.querySelector('.vp-cur').textContent = fmtTime(x * dur()); poke(); } });
  const volEl = el.querySelector('.vp-vol .slider');
  if (volEl) s.vol = slider(volEl, { get: () => (video.muted ? 0 : video.volume), set: (x) => setVol(x), preview: (x, hover) => { if (!hover) setVol(x); } });

  // media events
  const on = (t, ev, f, o) => { t.addEventListener(ev, f, o); s.offs.push(() => t.removeEventListener(ev, f, o)); };
  on(video, 'play', () => { if (player.playing) player.pause(); setPP(true); hideMsg(); poke(); msState(); });
  on(video, 'pause', () => { setPP(false); saveProgress(true); poke(true); msState(); });
  on(video, 'waiting', () => el.classList.add('buffering'));
  on(video, 'playing', () => el.classList.remove('buffering'));
  on(video, 'canplay', () => el.classList.remove('buffering'));
  on(video, 'timeupdate', onTime);
  on(video, 'progress', () => { try { const b = video.buffered; if (b.length && dur()) seekEl.style.setProperty('--b', b.end(b.length - 1) / dur()); } catch {} });
  on(video, 'loadedmetadata', onMeta);
  on(video, 'ended', onEnded);
  on(video, 'ratechange', () => { el.querySelector('[data-a=speed]').textContent = fmtSpeed(video.playbackRate); msPos(); });
  on(video, 'volumechange', updateVol);
  on(video, 'error', () => { if (!video.getAttribute('src')) return; el.classList.remove('buffering'); showMsg('Can’t play this video here', isDesk() ? 'This file’s format or codec isn’t supported. MP4 (H.264/AAC) and WebM play best.' : 'This device can’t play this file’s format. MP4 (H.264/AAC) and MOV from iPhone play best.'); });
  on(video, 'enterpictureinpicture', () => el.classList.add('pip-away'));
  on(video, 'leavepictureinpicture', () => el.classList.remove('pip-away'));
  on(video, 'webkitpresentationmodechanged', () => el.classList.toggle('pip-away', video.webkitPresentationMode === 'picture-in-picture'));
  on(document, 'fullscreenchange', onFS); on(document, 'webkitfullscreenchange', onFS);
  on(document, 'visibilitychange', () => { if (document.hidden) saveProgress(true); });
  on(window, 'keydown', onKey, { capture: true });
  on(window, 'pagehide', () => saveProgress(true));

  // controls
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return; e.stopPropagation(); poke();
    const k = b.dataset.a;
    ({ close: closeVideo, toggle, back10: () => seekBy(-10), fwd10: () => seekBy(10), prev: () => step(-1), next: () => step(1), mute: () => { video.muted = !video.muted; if (!video.muted && video.volume < 0.02) video.volume = 0.5; }, speed: () => speedMenu(b), subs: () => subsAction(b), pip: togglePiP, fs: toggleFS, more: () => moreMenu(b), restart: () => { video.currentTime = 0; hideResume(); video.play().catch(() => {}); }, nextnow: () => step(1), nextcancel: cancelNext })[k]?.();
  });
  // tap / click on the picture
  const hit = el.querySelector('.vp-hit'); let lastTap = 0, tapT = 0;
  hit.addEventListener('pointerup', (e) => {
    const now = performance.now(), dbl = now - lastTap < 300; lastTap = dbl ? 0 : now; clearTimeout(tapT);
    if (e.pointerType === 'mouse') { if (dbl) toggleFS(); else tapT = setTimeout(toggle, 230); poke(); return; }
    const x = e.clientX / innerWidth;
    if (dbl) { if (x < 0.36) { seekBy(-10); ripple('l'); } else if (x > 0.64) { seekBy(10); ripple('r'); } else toggle(); poke(); return; }
    tapT = setTimeout(() => { if (s.idle) poke(); else hideNow(); }, 260);
  });
  el.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') poke(); });
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); });
  // desktop: drag the window by the top bar's empty space
  if (isDesk() && P().win?.dragFrom) el.querySelector('.vp-top').addEventListener('pointerdown', (e) => { if (e.button === 0 && !e.target.closest('button') && !fsEl() && !P().win._max) P().win.dragFrom(e); });
  updateVol();
  requestAnimationFrame(() => el.classList.add('on'));
  return s;
}
const fmtSpeed = (r) => (Math.round(r * 100) / 100) + '×';
function setPP(playing) { for (const b of S.el.querySelectorAll('.vp-pp, .vp-pp2')) b.innerHTML = ico(playing ? 'pause' : 'play'); S.el.classList.toggle('paused', !playing); }
function setVol(x) { const v = S.video; v.volume = clamp(x, 0, 1); v.muted = x < 0.01; }
function updateVol() {
  const v = S.video; app.S.videoVol = v.volume; app.S.videoMuted = v.muted; app.saveS();
  const b = S.el.querySelector('[data-a=mute]'); if (b) b.innerHTML = ico(v.muted || v.volume < 0.01 ? 'vol-x' : v.volume < 0.5 ? 'vol-low' : 'vol');
  S.vol?.update(v.muted ? 0 : v.volume);
}
function onTime() {
  const s = S, v = s.video, d = isFinite(v.duration) && v.duration > 0 ? v.duration : s.v.duration || 0;
  s.seek.update(d ? v.currentTime / d : 0);
  s.el.querySelector('.vp-cur').textContent = fmtTime(v.currentTime);
  const now = Date.now();
  if (now - s.lastSave > 15000) saveProgress();
  if (now - (s.lastMs || 0) > 1000) { s.lastMs = now; msPos(); }
  if (s.resumeShown && v.currentTime > (s.resumeAt || 0) + 8) hideResume();
}
function onMeta() {
  const s = S, v = s.v, d = s.video.duration;
  if (isFinite(d) && d > 0 && Math.abs((v.duration || 0) - d) > 0.5) { v.duration = d; save(); }
  if (s.video.videoWidth) { v.w = s.video.videoWidth; v.h = s.video.videoHeight; }
  s.el.querySelector('.vp-dur').textContent = fmtTime(d);
  const from = s.resumeFrom || 0; s.ready = true;
  if (from > 5 && (!d || d - from > endZone(d))) {
    s.video.currentTime = from; s.resumeAt = from; s.lastPos = from; s.resumeShown = true;
    const r = s.el.querySelector('.vp-resume'); r.querySelector('span').textContent = `Resumed at ${fmtTime(from)}`; r.classList.remove('hidden');
    clearTimeout(s.resumeT); s.resumeT = setTimeout(hideResume, 7000);
  }
  if (s.speed !== 1) s.video.playbackRate = s.speed;
  msPos();
}
function hideResume() { if (!S) return; S.resumeShown = false; S.el.querySelector('.vp-resume').classList.add('hidden'); }
function saveProgress(force) {
  const s = S; if (!s?.v || !s.ready || !V()[s.v.id]) return; const v = s.v, t = s.video.currentTime || 0, d = (isFinite(s.video.duration) && s.video.duration) || v.duration || 0;
  if (!force && Math.abs(t - s.lastPos) < 1) return;
  s.lastSave = Date.now(); s.lastPos = t;
  if (d && t > 0 && d - t < endZone(d)) { v.watched = true; v.pos = 0; }
  else if (t > 5) { v.pos = Math.round(t * 10) / 10; v.watched = false; v.last = Date.now(); }
  else if (force && t <= 5) v.pos = 0;
  save();
}
function onEnded() {
  saveProgress(true);
  const list = siblings(S.v), i = list.findIndex((x) => x.id === S.v.id), nx = list[i + 1];
  poke(true);
  if (!nx) return;
  const box = S.el.querySelector('.vp-next');
  box.querySelector('b').textContent = titleOf(nx);
  box.querySelector('.vp-next-art').innerHTML = nx.poster ? coverImg(nx.poster, true) : ico('vfilm'); hydrate(box);
  box.classList.remove('hidden'); box.classList.remove('run'); void box.offsetWidth; box.classList.add('run');
  clearTimeout(S.nextT); S.nextT = setTimeout(() => step(1), 6000);
}
function cancelNext() { if (!S) return; clearTimeout(S.nextT); S.el.querySelector('.vp-next').classList.add('hidden'); }
function toggle() { const v = S.video; if (S.el.classList.contains('msg')) return; if (v.paused || v.ended) { cancelNext(); v.play().catch((e) => { if (e.name !== 'AbortError') console.warn(e); }); } else v.pause(); }
function seekBy(dt) { const v = S.video; const d = isFinite(v.duration) ? v.duration : S.v.duration || 0; v.currentTime = clamp(v.currentTime + dt, 0, d ? d - 0.1 : v.currentTime + dt); flash(dt < 0 ? `−${Math.abs(dt)}s` : `+${dt}s`); }
function step(dir) {
  const list = siblings(S.v), i = list.findIndex((x) => x.id === S.v.id), nx = list[i + dir];
  if (!nx) { flash(dir > 0 ? 'Last video in folder' : 'First video in folder'); return; }
  saveProgress(true); loadVideo(nx, {});
}
function flash(txt) { const f = S.el.querySelector('.vp-flash'); f.textContent = txt; f.classList.remove('show'); void f.offsetWidth; f.classList.add('show'); }
function ripple(side) { const r = h(`<div class="vp-ripple ${side}">${ico(side === 'l' ? 'vback10' : 'vfwd10')}</div>`); S.el.appendChild(r); setTimeout(() => r.remove(), 650); }
function showMsg(t, sub) { const m = S.el.querySelector('.vp-msg'); m.querySelector('b').textContent = t; m.querySelector('span').textContent = sub || ''; m.classList.remove('hidden'); S.el.classList.add('msg'); poke(true); }
function hideMsg() { if (!S) return; S.el.querySelector('.vp-msg').classList.add('hidden'); S.el.classList.remove('msg'); }

// auto-hide controls
function poke(stay) {
  const s = S; if (!s) return; clearTimeout(s.hideT);
  if (s.idle) { s.idle = false; s.el.classList.remove('idle'); }
  if (stay) return;
  s.hideT = setTimeout(() => { if (!S || S.video.paused || $('#layer').children.length || S.el.querySelector('.vp-bar:hover') || S.el.querySelector('.slider.drag')) return poke(); hideNow(); }, 2800);
}
function hideNow() { const s = S; if (!s || s.video.paused) return; clearTimeout(s.hideT); s.idle = true; s.el.classList.add('idle'); }

function speedMenu(b) {
  menu([{ header: 'Playback speed' }, ...SPEEDS.map((r) => ({ label: r === 1 ? 'Normal' : fmtSpeed(r), checked: Math.abs(S.video.playbackRate - r) < 0.01, action: () => setSpeed(r) }))], { el: b, up: true, right: true });
}
function setSpeed(r) { r = clamp(Math.round(r * 100) / 100, 0.5, 2); S.speed = r; S.video.playbackRate = r; S.video.preservesPitch = true; flash(fmtSpeed(r)); }
function moreMenu(b) {
  const v = S.v;
  menu([
    { label: v.sub ? 'Replace subtitles…' : 'Add subtitles…', icon: 'vcc', action: () => loadSubsFor(v) },
    { label: 'Rename', icon: 'edit', action: () => renameVideo(v) },
    { label: 'Show info', icon: 'info', action: () => showInfo(v) },
    { label: 'Keyboard shortcuts', icon: 'keyboard', action: shortcuts }
  ], { el: b, right: true });
}
function shortcuts() {
  const k = [['Space / K', 'Play or pause'], ['← → / J L', 'Back or forward 10 seconds'], ['↑ ↓', 'Volume'], ['M', 'Mute'], ['F', 'Full screen'], ['C', 'Subtitles on or off'], ['I', 'Picture in picture'], ['< >', 'Slower or faster'], ['Shift+N / Shift+P', 'Next or previous in folder'], ['0 – 9', 'Jump to 0% … 90%'], ['Esc', 'Close the player']];
  modal(`<h2>Video shortcuts<button class="ib sm" data-close>${ico('x')}</button></h2><div class="v-info">${k.map(([a, b]) => `<span><kbd>${esc(a)}</kbd></span><b>${esc(b)}</b>`).join('')}</div>`);
}

// subtitles
function attachSubs(vtt, show) {
  const s = S; if (!s) return;
  s.video.querySelectorAll('track').forEach((t) => t.remove()); if (s.subURL) { URL.revokeObjectURL(s.subURL); s.subURL = null; }
  if (!vtt) { s.el.classList.remove('has-subs'); s.el.querySelectorAll('.vp-cc').forEach((b) => b.classList.remove('on')); return; }
  s.subURL = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
  const tr = document.createElement('track'); tr.kind = 'subtitles'; tr.label = 'Subtitles'; tr.srclang = 'en'; tr.src = s.subURL; tr.default = true;
  s.video.appendChild(tr); s.el.classList.add('has-subs');
  const want = show || app.S.videoSubs !== false;
  const apply = () => { const t = s.video.textTracks[0]; if (t) t.mode = want ? 'showing' : 'hidden'; markCC(); };
  apply(); tr.addEventListener('load', apply);
}
function markCC() { const t = S.video.textTracks[0]; const on = !!t && t.mode === 'showing'; S.el.querySelectorAll('.vp-cc').forEach((b) => b.classList.toggle('on', on)); }
function subsAction(b) {
  const t = S.video.textTracks[0];
  if (!t) { loadSubsFor(S.v); return; }
  t.mode = t.mode === 'showing' ? 'hidden' : 'showing'; app.S.videoSubs = t.mode === 'showing'; app.saveS(); markCC(); flash(t.mode === 'showing' ? 'Subtitles on' : 'Subtitles off');
}
async function subsFor(v) {
  try {
    if (v.stored || v.subStored) { const t = await P().getVideoSub(v.id); if (t) return t; }
    if (!v.stored && v.sub && v.sub !== 'stored') return toVTT(await P().readText(v, v.sub));
  } catch (e) { console.warn('subtitles', e); }
  return null;
}

// picture-in-picture + full screen
async function togglePiP() {
  const v = S.video;
  try {
    if (document.pictureInPictureElement) { await document.exitPictureInPicture(); return; }
    if (v.requestPictureInPicture && document.pictureInPictureEnabled) { await v.requestPictureInPicture(); return; }
    if (v.webkitSetPresentationMode) v.webkitSetPresentationMode(v.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture');
  } catch (e) { console.warn(e); toast('Picture in picture isn’t available right now'); }
}
async function toggleFS() {
  const d = document;
  if (fsEl()) { try { await (d.exitFullscreen || d.webkitExitFullscreen).call(d); } catch {} return; }
  const el = S.el, v = S.video;
  try {
    if (el.requestFullscreen) { await el.requestFullscreen({ navigationUI: 'hide' }); return; }
    if (el.webkitRequestFullscreen) { el.webkitRequestFullscreen(); return; }
  } catch {}
  if (v.webkitEnterFullscreen) { try { v.webkitEnterFullscreen(); } catch {} } // iPhone: the system player
}
function onFS() {
  const s = S; if (!s) return; const on = fsEl() === s.el;
  s.el.classList.toggle('fs', on);
  const b = s.el.querySelector('[data-a=fs]'); if (b) b.innerHTML = ico(on ? 'collapse' : 'expand');
  // Windows app: fill the monitor too, then put the window back
  if (isDesk() && P().win) { if (on && !P().win._max) { s.maxedByUs = true; P().win.maximize().catch?.(() => {}); } else if (!on && s.maxedByUs) { s.maxedByUs = false; P().win.restore().catch?.(() => {}); } }
}

// keyboard (captured while the player is open so music shortcuts don't fire underneath)
function onKey(e) {
  const s = S; if (!s || s.el.classList.contains('pip-away')) return;
  if (e.target.matches?.('input, textarea, select, [contenteditable]')) return;
  if ($('#layer').children.length) { if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); closeLayer(); } return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key, v = s.video; let handled = true;
  switch (k) {
    case ' ': case 'k': case 'K': case 'MediaPlayPause': toggle(); break;
    case 'ArrowLeft': case 'j': case 'J': seekBy(-10); break;
    case 'ArrowRight': case 'l': case 'L': seekBy(10); break;
    case 'ArrowUp': if (canVolume) { setVol((v.muted ? 0 : v.volume) + 0.05); flash(`Volume ${Math.round(v.volume * 100)}%`); } break;
    case 'ArrowDown': if (canVolume) { setVol((v.muted ? 0 : v.volume) - 0.05); flash(v.muted ? 'Muted' : `Volume ${Math.round(v.volume * 100)}%`); } break;
    case 'm': case 'M': v.muted = !v.muted; flash(v.muted ? 'Muted' : 'Sound on'); break;
    case 'f': case 'F': toggleFS(); break;
    case 'c': case 'C': subsAction(); break;
    case 'i': case 'I': if (pipOK()) togglePiP(); break;
    case '<': case ',': setSpeed(SPEEDS[Math.max(0, SPEEDS.findIndex((r) => r >= v.playbackRate - 0.01) - 1)] ?? 0.5); break;
    case '>': case '.': setSpeed(SPEEDS.find((r) => r > v.playbackRate + 0.01) ?? 2); break;
    case 'N': if (e.shiftKey) step(1); break;
    case 'P': if (e.shiftKey) step(-1); break;
    case 'MediaTrackNext': step(1); break; case 'MediaTrackPrevious': step(-1); break;
    case 'Home': v.currentTime = 0; break;
    case 'End': if (isFinite(v.duration)) v.currentTime = Math.max(0, v.duration - 0.5); break;
    case 'Escape': if (fsEl()) { (document.exitFullscreen || document.webkitExitFullscreen)?.call(document); } else closeVideo(); break;
    default:
      if (/^[0-9]$/.test(k)) { if (isFinite(v.duration)) v.currentTime = v.duration * (+k / 10); }
      else handled = k.length === 1; // swallow other letters so music shortcuts don't fire underneath
  }
  if (handled) { e.preventDefault(); e.stopImmediatePropagation(); poke(); }
}

// Media Session (lock screen, media keys, Windows overlay) while a video is open
async function setMediaSession(v) {
  if (!('mediaSession' in navigator)) return; const ms = navigator.mediaSession;
  const H = (a, f) => { try { ms.setActionHandler(a, f); } catch {} };
  const list = siblings(v), i = list.findIndex((x) => x.id === v.id);
  H('play', () => S?.video.play().catch(() => {})); H('pause', () => S?.video.pause()); H('stop', () => closeVideo());
  H('seekbackward', (d) => S && seekBy(-(d.seekOffset || 10))); H('seekforward', (d) => S && seekBy(d.seekOffset || 10));
  H('seekto', (d) => { if (S) { S.video.currentTime = d.seekTime; msPos(); } });
  H('previoustrack', i > 0 ? () => S && step(-1) : null); H('nexttrack', i < list.length - 1 ? () => S && step(1) : null);
  let art = null; try { art = v.poster ? await P().coverURL(v.poster, false) : null; } catch {}
  try { if (S?.v === v) ms.metadata = new MediaMetadata({ title: titleOf(v), artist: groupLabel(v), album: 'Pulse Videos', artwork: art ? [{ src: art, sizes: '640x360', type: 'image/jpeg' }] : [] }); } catch {}
}
function msState() { try { if ('mediaSession' in navigator && S) navigator.mediaSession.playbackState = S.video.paused ? 'paused' : 'playing'; } catch {} }
function msPos() { try { const v = S?.video; if (v && isFinite(v.duration) && v.duration > 0 && 'setPositionState' in navigator.mediaSession) navigator.mediaSession.setPositionState({ duration: v.duration, position: clamp(v.currentTime, 0, v.duration), playbackRate: v.playbackRate || 1 }); } catch {} }
function restoreMusicSession() {
  if (!('mediaSession' in navigator)) return;
  try { navigator.mediaSession.setPositionState?.(); } catch {}
  player.setupMediaSession?.(); player.updateMediaSession?.();
  try { navigator.mediaSession.playbackState = player.playing ? 'playing' : 'paused'; player.updatePosition?.(); } catch {}
}

async function loadVideo(v, opts) {
  const s = S; cancelNext(); hideResume(); hideMsg();
  if (s.src) { s.src.revoke(); s.src = null; }
  attachSubs(null);
  s.v = v; s.opts = opts || {}; s.lastPos = 0; s.ready = false;
  s.resumeFrom = !s.opts.fromStart && v.pos > 5 && !v.watched ? v.pos : 0;
  s.el.querySelector('.vp-title b').textContent = titleOf(v);
  s.el.querySelector('.vp-title small').textContent = groupLabel(v);
  s.el.querySelector('.vp-dur').textContent = v.duration ? fmtTime(v.duration) : '0:00';
  s.el.querySelector('.vp-cur').textContent = '0:00'; s.seek.update(0);
  s.video.poster = ''; if (v.poster) P().coverURL(v.poster, false).then((u) => { if (u && S?.v === v) S.video.poster = u; }).catch(() => {});
  const list = siblings(v), i = list.findIndex((x) => x.id === v.id);
  s.el.querySelector('[data-a=prev]').disabled = i <= 0; s.el.querySelector('[data-a=next]').disabled = i < 0 || i >= list.length - 1;
  s.el.classList.add('buffering');
  let src = null;
  try { src = await srcFor(v); } catch (e) { console.warn(e); }
  if (S !== s || s.v !== v) { src?.revoke(); return; }
  if (!src) { s.el.classList.remove('buffering'); showMsg('Video not found', v.stored ? 'The stored copy is missing. Remove it and import it again.' : 'The file may have been moved or renamed. Try Rescan on the Videos page.'); return; }
  s.src = src; s.video.src = src.url;
  v.last = Date.now(); v.missing = false;
  s.video.play().catch((e) => { if (e.name === 'NotAllowedError') { setPP(false); poke(true); } else if (e.name !== 'AbortError') console.warn(e); });
  setMediaSession(v);
  const vtt = await subsFor(v); if (S === s && s.v === v && vtt) attachSubs(vtt);
}

export async function openVideo(id, opts = {}) {
  const v = V()[id]; if (!v) { toast('That video is no longer in Pulse'); return; }
  if (player.playing) player.pause();
  closeLayer();
  if (!S) buildPlayer(); else saveProgress(true);
  poke();
  await loadVideo(v, opts);
}

export function closeVideo() {
  const s = S; if (!s) return;
  saveProgress(true);
  S = null;
  clearTimeout(s.hideT); clearTimeout(s.nextT); clearTimeout(s.resumeT);
  try { if (document.pictureInPictureElement === s.video) document.exitPictureInPicture().catch(() => {}); } catch {}
  try { if (fsEl()) (document.exitFullscreen || document.webkitExitFullscreen).call(document)?.catch?.(() => {}); } catch {}
  if (s.maxedByUs && isDesk()) P().win.restore().catch?.(() => {});
  s.offs.forEach((f) => f()); s.offs = [];
  s.video.pause(); s.video.removeAttribute('src'); try { s.video.load(); } catch {}
  s.src?.revoke(); if (s.subURL) URL.revokeObjectURL(s.subURL);
  s.el.classList.remove('on'); s.el.classList.add('out');
  setTimeout(() => s.el.remove(), app.S.anim === 'off' ? 0 : 320);
  restoreMusicSession();
  if (s.v && V()[s.v.id]) { updateCard(s.v); redrawSoon(); }
}
export const isVideoOpen = () => !!S;
