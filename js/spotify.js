// Spotify import: Exportify CSV/ZIP -> matched against your local files -> Pulse playlists.
// Keeps a link to the original Spotify track list so missing songs are filled in automatically
// as soon as they appear in your music folders.
import { app, lib, player, toast, go, modal, closeLayer, coverImg, hydrate, ico, copyText, refresh } from './core.js';
import { $, $$, esc, h, fmtTime, norm, debounce, uid } from './util.js';
import { primaryArtist } from './library.js';

// =====================================================================
// Parsing
// =====================================================================
export function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = []; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const COLS = {
  title: /^(track name|name|title|song)$/i, artist: /^(artist name\(s\)|artist names?|artists?)$/i, album: /^(album name|album)$/i,
  albumArtist: /^album artist name\(s\)$/i, dur: /^(track )?duration( \(ms\))?$/i, isrc: /^isrc$/i, uri: /^(track uri|spotify id|uri)$/i,
  added: /^added at$/i, year: /^(album )?release date$/i, track: /^track number$/i, image: /^album image url$/i, genres: /^(artist )?genres$/i, label: /^record label$/i, explicit: /^explicit$/i
};
export function exportifyToItems(text) {
  const rows = parseCSV(text); if (rows.length < 2) return null;
  const head = rows[0].map((x) => x.trim()); const idx = {};
  for (const [k, re] of Object.entries(COLS)) idx[k] = head.findIndex((x) => re.test(x));
  if (idx.title < 0 || idx.artist < 0) return null;
  const g = (r, k) => (idx[k] >= 0 ? (r[idx[k]] || '').trim() : '');
  return rows.slice(1).filter((r) => g(r, 'title')).map((r) => {
    let d = +g(r, 'dur') || 0; if (d && d < 20000 && /duration$/i.test(head[idx.dur] || '')) d *= 1000; // seconds → ms
    return { t: g(r, 'title'), a: g(r, 'artist'), al: g(r, 'album'), d, isrc: g(r, 'isrc').toUpperCase().replace(/[^A-Z0-9]/g, ''), uri: g(r, 'uri'), added: Date.parse(g(r, 'added')) || 0, img: g(r, 'image'), year: parseInt(g(r, 'year').slice(0, 4), 10) || 0, genre: (g(r, 'genres').split(',')[0] || '').trim().replace(/\b\w/g, (c) => c.toUpperCase()), label: g(r, 'label'), explicit: /true/i.test(g(r, 'explicit')) };
  });
}
export function nameFromFile(fn) {
  let n = fn.replace(/^.*[\\/]/, '').replace(/\.csv$/i, '');
  if (!/\s/.test(n)) n = n.replace(/_+/g, ' ');
  n = n.trim(); if (/^liked songs$/i.test(n)) return 'Liked Songs';
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : 'Spotify playlist';
}
// Minimal ZIP reader (stored + deflate), so "Export All" zips can be used directly
export async function unzip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a zip file');
  const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true); const out = [];
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nlen)); p += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    const ds = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true); const raw = bytes.subarray(ds, ds + csize);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    else continue;
    out.push({ name, data });
  }
  return out;
}
// Turn picked/downloaded files into [{name, items}]
export async function loadExports(files) {
  const lists = [];
  const addCSV = (name, text) => { const items = exportifyToItems(text); if (items && items.length) lists.push({ id: uid(), file: name.replace(/^.*[\\/]/, ''), name: nameFromFile(name), items }); };
  for (const f of files) {
    const bytes = f instanceof Blob ? new Uint8Array(await f.arrayBuffer()) : f.bytes; const nm = f.name;
    if (/\.zip$/i.test(nm) || (bytes[0] === 0x50 && bytes[1] === 0x4b)) { for (const e of await unzip(bytes)) if (/\.csv$/i.test(e.name)) addCSV(e.name, new TextDecoder().decode(e.data)); }
    else addCSV(nm, new TextDecoder().decode(bytes));
  }
  return lists;
}

// =====================================================================
// Matching engine
// =====================================================================
const JUNK = /\b(remaster(ed)?( \d{4})?|\d{4} remaster(ed)?|digital(ly)? remaster(ed)?|radio edit|single version|album version|original mix|explicit|clean|mono|stereo|bonus track|deluxe( edition)?|expanded edition|from .{1,40} soundtrack|feat\.? .*|ft\.? .*|featuring .*|with .*)\b/g;
export function normTitle(s) {
  let x = norm(s).replace(/[’'`]/g, '');
  x = x.replace(/\s+-\s+.*$/, (m) => (JUNK.test(m) ? '' : m)); JUNK.lastIndex = 0;
  x = x.replace(/[([{][^)\]}]*[)\]}]/g, (m) => { const r = JUNK.test(m) ? '' : m; JUNK.lastIndex = 0; return r; });
  x = x.replace(/&/g, ' and ').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return x;
}
const splitArtists = (s) => String(s || '').split(/\s*(?:,|;|\/| feat\.? | ft\.? | featuring | & | x | with | and )\s*/i).map((a) => norm(a).replace(/[^a-z0-9]/g, '')).filter(Boolean);
function lev(a, b) {
  if (a === b) return 0; if (!a.length) return b.length; if (!b.length) return a.length;
  a = a.slice(0, 80); b = b.slice(0, 80); let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { const cur = [i]; for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[b.length];
}
function titleSim(a, b) {
  if (!a || !b) return 0; if (a === b) return 1;
  if ((a.includes(b) || b.includes(a)) && Math.min(a.length, b.length) / Math.max(a.length, b.length) > 0.55) return 0.9;
  return 1 - lev(a, b) / Math.max(a.length, b.length);
}
function artistSim(sa, la) {
  if (!la.length) return 0.45; if (!sa.length) return 0.5;
  let best = 0; for (const x of sa) for (const y of la) { if (x === y) return 1; if (x.length > 3 && y.length > 3 && (x.includes(y) || y.includes(x))) best = Math.max(best, 0.85); else best = Math.max(best, 1 - lev(x, y) / Math.max(x.length, y.length)); }
  return best;
}
function durSim(ms, sec) { if (!ms || !sec) return 0.6; const d = Math.abs(ms / 1000 - sec); return d <= 2.5 ? 1 : d <= 6 ? 0.8 : d <= 12 ? 0.5 : d <= 30 ? 0.2 : 0; }

let M = null; // matcher index, rebuilt when the library changes
export function buildIndex() {
  const byTitle = new Map(), byWord = new Map(), byIsrc = new Map(), byArtist = new Map(); const meta = new Map();
  for (const t of Object.values(lib.db.tracks)) {
    const nt = normTitle(t.title); const ar = splitArtists([t.artist, t.albumArtist].filter(Boolean).join(', '));
    // untagged files: try "Artist - Title" from the file name too
    let alt = null; const base = (t.name || '').replace(/\.[^.]+$/, '').replace(/^\d{1,3}[\s.\-_]+/, ''); const m = /^(.+?)\s+-\s+(.+)$/.exec(base); if (m) alt = { t: normTitle(m[2]), a: splitArtists(m[1]) };
    meta.set(t.id, { nt, ar, nal: normTitle(t.album), dur: t.duration, alt });
    const push = (map, k) => { if (!k) return; let s = map.get(k); if (!s) map.set(k, s = []); s.push(t.id); };
    push(byTitle, nt); if (alt) push(byTitle, alt.t);
    const w = nt.split(' ').filter((x) => x.length > 2); push(byWord, w[0] || nt); if (w[1]) push(byWord, w[1]);
    if (t.isrc) push(byIsrc, t.isrc);
    for (const a of ar) push(byArtist, a);
  }
  M = { byTitle, byWord, byIsrc, byArtist, meta, n: Object.keys(lib.db.tracks).length };
  return M;
}
const ensureIndex = () => (M && M.n === Object.keys(lib.db.tracks).length ? M : buildIndex());
lib.on((e) => { if (e === 'index') M = null; });

export function matchItem(it, prefer) {
  const I = ensureIndex();
  if (it.isrc && I.byIsrc.has(it.isrc)) return { id: I.byIsrc.get(it.isrc)[0], score: 1, why: 'ISRC' };
  const nt = normTitle(it.t), sa = splitArtists(it.a), nal = normTitle(it.al);
  const cand = new Set(I.byTitle.get(nt) || []);
  const w = nt.split(' ').filter((x) => x.length > 2);
  for (const k of [w[0] || nt, w[1]]) for (const id of I.byWord.get(k) || []) cand.add(id);
  if (cand.size < 3) for (const a of sa) for (const id of I.byArtist.get(a) || []) cand.add(id);
  if (prefer) for (const id of prefer) cand.add(id); // songs in the folder named after this playlist
  let best = null, second = 0;
  for (const id of cand) {
    const m = I.meta.get(id); if (!m) continue;
    let ts = titleSim(nt, m.nt), as = artistSim(sa, m.ar);
    if (m.alt) { const ts2 = titleSim(nt, m.alt.t), as2 = artistSim(sa, m.alt.a); if (ts2 * 0.6 + as2 * 0.25 > ts * 0.6 + as * 0.25) { ts = ts2; as = as2; } }
    if (ts < 0.5) continue;
    let s = ts * 0.6 + as * 0.25 + durSim(it.d, m.dur) * 0.15;
    if (nal && m.nal && nal === m.nal) s += 0.05;
    if (as < 0.4) s -= 0.12; // right title, wrong artist (covers, same-name songs)
    if (prefer?.has(id)) s += 0.08;
    s = Math.min(1, s);
    if (!best || s > best.score) { if (best) second = best.score; best = { id, score: s }; } else if (s > second) second = s;
  }
  if (!best) return null;
  best.close = second > 0 && best.score - second < 0.03; // ambiguous
  return best;
}
export const AUTO = 0.84, REVIEW = 0.6;
export function classify(r) { if (!r || r.score < REVIEW) return 'missing'; if (r.score >= AUTO && !r.close) return 'matched'; return 'review'; }

// Run matching for many playlists in parallel-ish batches, yielding to keep the UI smooth
// Your downloads live in folders named after playlists: find the folder that goes with a playlist
const loose = (x) => norm(x).replace(/[^a-z0-9]+/g, ' ').trim();
export function folderFor(name) {
  const want = loose(name); if (!want || !lib.idx.folders) return null; let hit = null;
  const walk = (n) => { for (const c of n.children.values()) { if (!hit && loose(c.name) === want) hit = c; walk(c); } }; walk(lib.idx.folders);
  return hit;
}
export async function matchLists(lists, onProgress) {
  buildIndex(); const cache = new Map(); let done = 0; const total = lists.reduce((a, l) => a + l.items.length, 0);
  for (const l of lists) {
    l.res = [];
    const folder = folderFor(l.name); l.folder = folder ? folder.name : null; l.folderKey = folder ? folder.key : null;
    const prefer = folder ? new Set(lib.folderAllTracks(folder)) : null;
    for (let i = 0; i < l.items.length; i++) {
      const it = l.items[i]; const key = (prefer ? l.name + '|' : '') + (it.uri || it.isrc || it.t + '|' + it.a + '|' + it.d);
      let r = cache.get(key); if (r === undefined) { r = matchItem(it, prefer); cache.set(key, r); }
      const st = classify(r);
      l.res.push({ r, st, use: st === 'matched' || (st === 'review' && r.score >= 0.72) ? r.id : null });
      if (++done % 150 === 0) { onProgress?.(done, total, l); await new Promise((ok) => setTimeout(ok, 0)); }
    }
    onProgress?.(done, total, l);
  }
  return lists;
}

// =====================================================================
// Creating playlists & keeping them synced
// =====================================================================
function rebuildTracks(n) {
  const sp = n.spotify; const fromSp = new Set(sp.map.filter(Boolean));
  const extras = n.tracks.filter((id) => !fromSp.has(id) && !sp.prevMapped?.includes(id));
  n.tracks = [...sp.map.filter((id) => id && lib.track(id)), ...extras];
  sp.prevMapped = sp.map.filter(Boolean);
}
const sortKeyOf = (id) => (lib.track(id)?.title || '').toLowerCase();
// Fill in what the files are missing (album, year, genre, label, ISRC) from Spotify's data
function enrich(id, it) {
  const t = lib.track(id); if (!t) return 0; let n = 0;
  const weakAlbum = !t.album || t.albumGuess === true;
  if (it.al && weakAlbum && t.album !== it.al) { t.album = it.al; t.albumGuess = false; n++; }
  if (it.year && !t.year) { t.year = it.year; n++; }
  if (it.genre && !t.genre) { t.genre = it.genre; n++; }
  if (it.isrc && !t.isrc) { t.isrc = it.isrc; n++; }
  if (it.label && !t.label) { t.label = it.label; n++; }
  if (it.uri && !t.spotify) { t.spotify = it.uri; }
  if (!t.artist && it.a) { t.artist = it.a.replace(/,(?=\S)/g, ', '); n++; }
  return n ? 1 : 0;
}
export function createFromLists(lists, opt) {
  let parent = opt.parent; let enriched = 0;
  if (parent === '__new') parent = lib.createNode('folder', opt.folderName || 'Spotify').id;
  const made = [];
  // "group like my folders": recreate the parent folders of each playlist's music folder inside Pulse
  const groupCache = new Map();
  const parentSegs = (l) => l.folderKey.split('/').filter(Boolean).slice(1, -1); // drop the music root and the playlist folder itself
  const keyed = lists.filter((l) => l.include && l.folderKey).map(parentSegs);
  let common = keyed.length ? keyed[0].length : 0; // folders every playlist shares (e.g. the folder you imported) aren't real groups
  for (const a of keyed) { let i = 0; while (i < common && i < a.length && a[i] === keyed[0][i]) i++; common = i; }
  const groupFor = (l) => {
    if (!opt.mirror || !l.folderKey) return parent || null;
    const segs = parentSegs(l).slice(common);
    let at = parent || null, path = '';
    for (const sname of segs) {
      path += '/' + sname; if (groupCache.has(path)) { at = groupCache.get(path); continue; }
      const ex = Object.values(lib.db.nodes).find((x) => x.type === 'folder' && x.name === sname && (x.parent || null) === at);
      at = (ex || lib.createNode('folder', sname, at)).id; groupCache.set(path, at);
    }
    return at;
  };
  for (const l of lists) {
    if (!l.include) continue;
    const home = groupFor(l);
    const map = l.res.map((x) => x.use || null);
    if (opt.enrich) map.forEach((id, i) => { if (id) enriched += enrich(id, l.items[i]); });
    const addedAt = {}; map.forEach((id, i) => { if (id && l.items[i].added) addedAt[id] = l.items[i].added; });
    const spotify = { file: l.file, items: l.items.map(({ t, a, al, d, isrc, uri }) => ({ t, a, al, d, isrc, uri })), map, imported: Date.now(), sync: opt.sync };
    if (l.isLiked && opt.likedToLiked) { let c = 0; map.forEach((id, i) => { if (id && !lib.isLiked(id)) { lib.db.liked[id] = l.items[i].added || Date.now(); c++; } }); lib.save(); lib.emit('liked'); }
    if (l.isLiked && opt.likedToLiked && !opt.likedAlsoPlaylist) continue;
    let n = Object.values(lib.db.nodes).find((x) => x.type === 'playlist' && x.name === l.name && (x.parent || null) === (home || null));
    if (n && opt.dupes === 'replace') { n.spotify = spotify; n.tracks = []; rebuildTracks(n); n.addedAt = addedAt; }
    else if (n && opt.dupes === 'merge') { const have = new Set(n.tracks); n.spotify = spotify; for (const id of map) if (id && !have.has(id)) { n.tracks.push(id); have.add(id); } n.spotify.prevMapped = map.filter(Boolean); }
    else { n = lib.createNode('playlist', l.name, home || null, { spotify, addedAt, desc: `Imported from Spotify (${l.items.length} songs)` }); rebuildTracks(n); }
    // "whole folders": every song in the matching music folder goes in — Spotify's order first, the rest after
    if (opt.wholeFolders && l.folderKey) { const f = lib.folderNode(l.folderKey); if (f) { const have = new Set(n.tracks); for (const id of lib.folderAllTracks(f).sort((a, b) => sortKeyOf(a).localeCompare(sortKeyOf(b)))) if (!have.has(id)) { n.tracks.push(id); have.add(id); } } }
    if (!n.addedAt) n.addedAt = addedAt;
    n.updated = Date.now(); made.push(n);
  }
  if (enriched) lib.reindex(true);
  lib.save(); lib.emit('nodes');
  return { parent, made, enriched };
}
export function spotifyStats(n) {
  const sp = n.spotify; if (!sp) return null;
  const have = sp.map.filter((id) => id && lib.track(id)).length;
  return { total: sp.items.length, have, missing: sp.items.length - have };
}
// Fill gaps when new files show up (called after library re-index)
export const autoFill = debounce(() => {
  if (!Object.keys(lib.db.tracks).length) return;
  let filled = 0; const touched = [];
  for (const n of Object.values(lib.db.nodes)) {
    const sp = n.spotify; if (!sp?.sync) continue; let ch = 0;
    sp.map.forEach((id, i) => {
      if (id && lib.track(id)) return;
      if (id && !lib.track(id)) { sp.map[i] = null; ch++; }
      const r = matchItem(sp.items[i]); if (classify(r) === 'matched') { sp.map[i] = r.id; ch++; filled++; }
    });
    if (ch) { rebuildTracks(n); touched.push(n.name); }
  }
  if (touched.length) { lib.save(); lib.emit('nodes'); if (filled) toast(`Found ${filled} missing Spotify song${filled > 1 ? 's' : ''} — added to ${touched.slice(0, 2).join(', ')}${touched.length > 2 ? '…' : ''}`, 4000); }
}, 2500);

// =====================================================================
// UI helpers
// =====================================================================
const enc = encodeURIComponent;
export function findLinks(it) {
  const q = `${primaryArtist(it.a)} ${it.t}`;
  return [['Bandcamp', `https://bandcamp.com/search?q=${enc(q)}`], ['Apple Music', `https://music.apple.com/us/search?term=${enc(q)}`], ['Amazon', `https://www.amazon.com/s?k=${enc(q)}&i=digital-music`], ['Qobuz', `https://www.qobuz.com/us-en/search?q=${enc(q)}`]];
}
const openLink = (u) => app.P.openURL ? app.P.openURL(u) : window.open(u, '_blank');
const T = (id) => lib.track(id);
const stars = (s) => `<span class="conf" style="--c:${Math.round(s * 100)}">${Math.round(s * 100)}%</span>`;
function localRow(id) { const t = T(id); if (!t) return '<span class="sp-none">—</span>'; return `<div class="sp-local"><div class="th">${t.cover ? coverImg(t.cover, true) : ico('note')}</div><div class="tt"><b>${esc(t.title)}</b><small>${esc(t.artist || 'Unknown')} • ${fmtTime(t.duration)}</small></div></div>`; }
function spRow(it, i) { return `<div class="sp-src"><span class="sp-n">${i + 1}</span><div class="tt"><b>${esc(it.t)}</b><small>${esc(it.a.replace(/,(?=\S)/g, ", "))}${it.al ? ' • ' + esc(it.al) : ''}${it.d ? ' • ' + fmtTime(it.d / 1000) : ''}</small></div></div>`; }

// Pick any local track manually
function pickLocal(it) {
  return new Promise((res) => {
    const host = h(`<div class="scrim dim sp-pick-scrim"><div class="modal" style="width:min(560px,calc(100vw - 32px))"><h2>Match “${esc(it.t)}” <button class="ib sm" data-x>${ico('x')}</button></h2><label class="tb-search" style="margin-bottom:10px">${ico('search')}<input placeholder="Search your library" value="${esc(primaryArtist(it.a) + ' ' + it.t)}"></label><div class="sp-pick"></div></div></div>`);
    document.getElementById('layer').appendChild(host);
    const inp = host.querySelector('input'), list = host.querySelector('.sp-pick');
    const draw = () => { const ids = lib.search(inp.value, 40); list.innerHTML = ids.map((id) => `<div class="qrow" data-id="${id}">${localRow(id)}</div>`).join('') || '<p style="opacity:.6">No matches — try fewer words.</p>'; hydrate(list); };
    inp.oninput = debounce(draw, 120); draw(); setTimeout(() => { inp.focus(); inp.select(); }, 50);
    const done = (v) => { host.remove(); res(v); };
    host.querySelector('[data-x]').onclick = () => done(undefined);
    host.addEventListener('pointerdown', (e) => { if (e.target === host) done(undefined); });
    list.onclick = (e) => { const r = e.target.closest('[data-id]'); if (r) done(r.dataset.id); };
  });
}

// Review table for one playlist (used by the wizard and by the playlist "missing" view)
function reviewEl(l, onChange, tabInit = null) {
  const el = h('<div class="sp-review"></div>');
  const counts = () => ({ matched: l.res.filter((x) => x.st === 'matched').length, review: l.res.filter((x) => x.st === 'review').length, missing: l.res.filter((x) => x.st === 'missing').length });
  let tab = tabInit || (counts().review ? 'review' : counts().missing ? 'missing' : 'matched');
  const draw = () => {
    const c = counts();
    const rows = l.res.map((x, i) => [x, i]).filter(([x]) => x.st === tab);
    el.innerHTML = `<div class="seg sp-tabs">${[['matched', 'Matched', c.matched], ['review', 'Check these', c.review], ['missing', 'Not in library', c.missing]].map(([k, lab, n]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${lab} <span class="cnt">${n}</span></button>`).join('')}</div>
      ${tab === 'missing' && rows.length ? `<div class="sp-tools"><button class="pill" data-copy>${ico('copy')}Copy list</button><button class="pill" data-csv>${ico('export')}Save as CSV</button><span style="opacity:.6;font-size:12.5px">Pulse fills these in automatically once the files are in your music folder.</span></div>` : ''}
      ${tab === 'review' && rows.length ? `<div class="sp-tools"><button class="pill" data-acceptall>${ico('check')}Accept all</button><button class="pill" data-rejectall>${ico('x')}Reject all</button></div>` : ''}
      <div class="sp-rows">${rows.slice(0, 600).map(([x, i]) => {
        const it = l.items[i];
        if (tab === 'missing') return `<div class="sp-row miss" data-i="${i}">${spRow(it, i)}<div class="sp-acts">${findLinks(it).map(([n, u]) => `<a class="chip sm" data-url="${esc(u)}">${n}</a>`).join('')}<button class="ib sm" data-pick title="Pick a song from your library">${ico('search')}</button></div></div>`;
        return `<div class="sp-row ${x.use ? 'on' : 'off'}" data-i="${i}">${spRow(it, i)}<span class="sp-arrow">${ico('fwd')}</span>${localRow(x.use || x.r?.id)}<div class="sp-acts">${x.r ? stars(x.r.score) : ''}${tab === 'review' ? `<div class="tog ${x.use ? 'on' : ''}" data-use title="Use this match"></div>` : ''}<button class="ib sm" data-pick title="Pick a different song">${ico('edit')}</button>${tab === 'matched' ? `<button class="ib sm" data-unmatch title="Not the right song">${ico('x')}</button>` : ''}</div></div>`;
      }).join('') || `<div class="empty" style="padding:30px"><p>${tab === 'missing' ? 'Every song was found in your library.' : tab === 'review' ? 'Nothing needs checking.' : 'No matches yet.'}</p></div>`}${rows.length > 600 ? `<p style="opacity:.6">…and ${rows.length - 600} more</p>` : ''}</div>`;
    hydrate(el);
  };
  el.addEventListener('click', async (e) => {
    const t = e.target;
    const tb = t.closest('[data-tab]'); if (tb) { tab = tb.dataset.tab; draw(); return; }
    const u = t.closest('[data-url]'); if (u) { openLink(u.dataset.url); return; }
    const missing = l.res.map((x, i) => [x, i]).filter(([x]) => x.st === 'missing').map(([, i]) => l.items[i]);
    if (t.closest('[data-copy]')) { copyText(missing.map((it) => `${it.a} - ${it.t}${it.al ? ` (${it.al})` : ''}`).join('\n')); return; }
    if (t.closest('[data-csv]')) { const csv = 'Artist,Title,Album,Duration\n' + missing.map((it) => [it.a, it.t, it.al, fmtTime(it.d / 1000)].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `${l.name} - missing.csv`; a.click(); return; }
    if (t.closest('[data-acceptall]')) { l.res.forEach((x) => { if (x.st === 'review') x.use = x.r.id; }); draw(); onChange?.(); return; }
    if (t.closest('[data-rejectall]')) { l.res.forEach((x) => { if (x.st === 'review') x.use = null; }); draw(); onChange?.(); return; }
    const row = t.closest('.sp-row'); if (!row) return; const i = +row.dataset.i; const x = l.res[i];
    if (t.closest('[data-use]')) { x.use = x.use ? null : x.r.id; draw(); onChange?.(); return; }
    if (t.closest('[data-unmatch]')) { x.use = null; x.st = 'missing'; draw(); onChange?.(); return; }
    if (t.closest('[data-pick]')) { const id = await pickLocal(l.items[i]); if (id) { x.use = id; x.r = { id, score: 1 }; x.st = 'matched'; draw(); onChange?.(); } return; }
    if (t.closest('.sp-local') && (x.use || x.r?.id)) { const id = x.use || x.r.id; player.playList([id], 0, { type: 'preview', label: 'Preview' }); }
  });
  draw(); el.redraw = draw;
  return el;
}

// =====================================================================
// The wizard
// =====================================================================
export function openSpotifyImport() {
  if (!Object.keys(lib.db.tracks).length) { toast(app.isDesktop ? 'Add your music folder first so Pulse can match songs' : 'Import your songs first so Pulse can match them'); }
  const W = { step: 1, lists: [], sel: 0, poll: null, found: [], seen: new Set() };
  const m = modal('<div class="sp-wiz"></div>');
  m.classList.add('wide');
  const root = m.querySelector('.sp-wiz');
  const stop = () => clearInterval(W.poll);
  const obs = new MutationObserver(() => { if (!document.body.contains(m)) { stop(); obs.disconnect(); } }); obs.observe(document.getElementById('layer'), { childList: true });
  const steps = ['Export from Spotify', 'Load the export', 'Review matches', 'Import'];
  const header = () => `<div class="sp-head"><div class="sp-logo">${ico('import')}</div><div><h2 style="margin:0">Import from Spotify</h2><small>Rebuild your Spotify playlists from the music files you already have</small></div><button class="ib sm" data-close>${ico('x')}</button></div>
    <div class="sp-steps">${steps.map((s, i) => `<div class="sp-step ${W.step === i + 1 ? 'on' : W.step > i + 1 ? 'done' : ''}"><span>${W.step > i + 1 ? ico('check') : i + 1}</span><b>${s}</b></div>`).join('<i></i>')}</div>`;
  const render = () => {
    root.innerHTML = header() + `<div class="sp-body">${body()}</div>`;
    root.querySelector('[data-close]').onclick = () => { stop(); closeLayer(); };
    wire(); hydrate(root);
  };
  const body = () => {
    if (W.step === 1) return `
      <div class="sp-what"><b>What this does</b><p>Your music is already on your PC — this doesn't download anything. It takes your Spotify playlists and rebuilds them in Pulse from the songs you have:</p>
        <ul><li><b>Same playlists, same song order</b> — matched to your files, and to the folder named after each playlist when there is one</li><li><b>Your Liked Songs</b>, with the dates you liked them</li><li><b>“Date added”</b> for every song, so you can sort playlists like Spotify</li><li><b>Missing info filled in</b> — album, year, genre and label for files that don’t have them</li><li>A <b>“not in your library”</b> list for anything you don’t have yet — it fills itself in once those files show up</li></ul></div>
      <div class="sp-guide">
        <div class="sp-g"><span>1</span><div><b>Open Exportify</b><p>Exportify is a free, open-source site that saves your Spotify playlists as spreadsheet (CSV) files. Nothing is downloaded but the track lists.</p><button class="pill solid" data-open>${ico('export')}Open exportify.net</button></div></div>
        <div class="sp-g"><span>2</span><div><b>Log in with Spotify</b><p>Click <i>Get Started</i> and approve read-only access to your playlists.</p></div></div>
        <div class="sp-g"><span>3</span><div><b>Click “Export All”</b><p>Or the <i>Export</i> button next to just the playlists you want. Your browser saves a .zip or .csv file to Downloads.</p></div></div>
        <div class="sp-g"><span>4</span><div><b>Come back here</b><p>${app.isDesktop ? 'Pulse watches your Downloads folder and picks the file up automatically.' : 'Then choose the downloaded file on the next step.'}</p></div></div>
      </div>
      <div class="row"><button class="pill" data-skip>I already have the files</button><button class="pill solid" data-next>Next ${ico('fwd')}</button></div>`;
    if (W.step === 2) return `
      <div class="sp-drop" data-drop>${ico('import')}<b>Drop your Exportify .zip or .csv files here</b><small>Multiple files are fine — each CSV becomes a playlist</small><button class="pill solid" data-pickfiles>Choose files…</button></div>
      ${app.isDesktop ? `<div class="sp-found"><div class="q-h">Found in Downloads <small class="sp-watch"><span class="spin"></span>watching for new exports</small></div><div class="sp-found-list">${W.found.length ? W.found.map((f, i) => `<div class="qrow" data-found="${i}"><div class="th">${ico(/\.zip$/i.test(f.name) ? 'layers' : 'list')}</div><div class="tt"><b>${esc(f.name)}</b><small>${agoShort(f.mtime)} • ${(f.size / 1024).toFixed(0)} KB</small></div><button class="pill solid">Use this</button></div>`).join('') : '<p style="opacity:.6;margin:6px">No recent CSV or ZIP files yet. Finish the export and it’ll pop up here.</p>'}</div></div>` : ''}
      <div class="row"><button class="pill" data-back>${ico('back')}Back</button></div>`;
    if (W.step === 3) {
      const l = W.lists[W.sel];
      const tot = W.lists.filter((x) => x.include).reduce((a, x) => a + x.res.filter((r) => r.use).length, 0);
      const withFolder = W.lists.filter((x) => x.folderKey).length;
      const banner = withFolder ? `<div class="sp-whole ${W.whole ? 'on' : ''}"><div><b>${withFolder} of ${W.lists.length} playlists have a music folder with the same name</b><small>${W.whole ? 'Using whole folders: every song in those folders goes in the playlist, matched songs keep Spotify’s order.' : 'Song-by-song matching can miss files whose names or tags differ from Spotify. Skip that and just take the whole folder.'}</small></div><button class="pill ${W.whole ? '' : 'solid'}" data-whole>${W.whole ? 'Match song by song instead' : ico('folder') + 'Use whole folders'}</button></div>` : '';
      return banner + `<div class="sp-grid">
        <div class="sp-lists">${W.lists.map((x, i) => { const c = cnt(x); return `<div class="sp-li ${i === W.sel ? 'on' : ''}" data-sel="${i}"><div class="tog ${x.include ? 'on' : ''}" data-inc="${i}"></div><div class="tt"><b>${esc(x.name)}</b><small>${W.whole && x.folderKey ? `<span class="ok">whole folder</span> • ` : ""}<span class="ok">${c.use}</span> / ${x.items.length} found${c.review ? ` • <span class="rv">${c.review} to check</span>` : ''}${x.folder ? ` • ${ico('folder').replace('<svg>', '<svg class="fold">')} ${esc(x.folder)}` : ''}</small></div><div class="sp-bar"><i style="width:${(c.use / x.items.length) * 100}%"></i></div></div>`; }).join('')}</div>
        <div class="sp-detail"><div class="sp-dh"><input class="inp sp-name" value="${esc(l.name)}" title="Playlist name"><span>${l.items.length} songs on Spotify</span></div><div data-review></div></div>
      </div>
      <div class="row"><span style="flex:1;opacity:.7;font-size:13px;align-self:center">${W.lists.filter((x) => x.include).length} playlists • ${tot.toLocaleString()} songs will be added</span><button class="pill" data-back>${ico('back')}Back</button><button class="pill solid" data-next>Next ${ico('fwd')}</button></div>`;
    }
    if (W.step === 4) {
      const folders = []; const walk = (list, d) => { for (const id of list) { const n = lib.node(id); if (n?.type === 'folder') { folders.push([id, '  '.repeat(d) + n.name]); walk(n.children, d + 1); } } }; walk(lib.db.rootNodes, 0);
      const hasLiked = W.lists.some((x) => x.include && x.isLiked);
      return `<div class="sp-opts">
        <div class="opt"><div class="l"><b>Put the playlists in</b><small>Everything stays nested in your library — move them anytime</small></div><div class="r"><select class="inp" id="spParent" style="width:240px"><option value="__new">New folder “Spotify”</option><option value="">Top level of Your Library</option>${folders.map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join('')}</select></div></div>
        ${W.lists.some((x) => x.include && x.folderKey) ? `<div class="opt"><div class="l"><b>Group playlists like my music folders</b><small>Spotify doesn’t export its playlist folders, so Pulse copies the folder layout your music is stored in (e.g. Worship › UP! Radio)</small></div><div class="r"><div class="tog on" id="spMirror"></div></div></div>` : ''}
        <div class="opt"><div class="l"><b>If a playlist with the same name exists</b></div><div class="r"><div class="seg" id="spDup"><button data-v="merge" class="on">Merge</button><button data-v="replace">Replace</button><button data-v="new">Keep both</button></div></div></div>
        <div class="opt"><div class="l"><b>Fill in missing song info</b><small>Album, year, genre and label from Spotify — only where your files are blank or just use the folder name</small></div><div class="r"><div class="tog on" id="spEnrich"></div></div></div>
        <div class="opt"><div class="l"><b>Keep in sync with your music folder</b><small>When a missing song shows up later, Pulse adds it in the right spot automatically</small></div><div class="r"><div class="tog on" id="spSync"></div></div></div>
        ${hasLiked ? `<div class="opt"><div class="l"><b>Liked Songs → Pulse Liked Songs</b><small>Heart the matched songs instead of making a separate playlist</small></div><div class="r"><div class="tog on" id="spLiked"></div></div></div>` : ''}
      </div>
      <div class="sp-summary">${W.lists.filter((x) => x.include).map((x) => { const c = cnt(x); return `<div><b>${esc(x.name)}</b><span>${W.whole && x.folderKey ? `whole folder (${lib.folderAllTracks(lib.folderNode(x.folderKey) || { tracks: [], children: new Map() }).length} songs)` : `${c.use} of ${x.items.length}`}</span></div>`; }).join('')}</div>
      <div class="row"><button class="pill" data-back>${ico('back')}Back</button><button class="pill solid" data-import>${ico('check')}Import playlists</button></div>`;
    }
    return '';
  };
  const cnt = (x) => ({ use: x.res.filter((r) => r.use).length, review: x.res.filter((r) => r.st === 'review').length });
  const agoShort = (t) => { const s = (Date.now() - t) / 1000; return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' hr ago' : Math.round(s / 86400) + ' days ago'; };

  const loadFiles = async (files) => {
    root.querySelector('.sp-body').innerHTML = `<div class="sp-loading"><span class="spin"></span><b>Reading export…</b><div class="sp-prog"><i></i></div><small></small></div>`;
    let lists;
    try { lists = await loadExports(files); } catch (e) { toast('Could not read that file: ' + e.message); render(); return; }
    if (!lists.length) { toast("That doesn't look like an Exportify export"); render(); return; }
    lists.forEach((x) => { x.include = true; x.isLiked = /^liked songs$/i.test(x.name); });
    const prog = root.querySelector('.sp-prog i'), lab = root.querySelector('.sp-loading small'), b = root.querySelector('.sp-loading b');
    b.textContent = `Matching ${lists.length} playlist${lists.length > 1 ? 's' : ''} against ${Object.keys(lib.db.tracks).length.toLocaleString()} songs…`;
    await matchLists(lists, (d, t, l) => { prog.style.width = (d / t) * 100 + '%'; lab.textContent = `${d.toLocaleString()} / ${t.toLocaleString()} • ${l.name}`; });
    W.lists = lists.sort((a, b2) => (b2.isLiked - a.isLiked) || a.name.localeCompare(b2.name)); W.sel = 0; W.step = 3; stop(); render();
  };
  const poll = async () => {
    if (W.step !== 2 || !app.isDesktop) return;
    const f = await app.P.findExports(); const fresh = f.filter((x) => !W.seen.has(x.path + x.mtime));
    const changed = JSON.stringify(f.map((x) => x.path + x.mtime)) !== JSON.stringify(W.found.map((x) => x.path + x.mtime));
    W.found = f;
    if (changed && W.step === 2) render();
    // auto-pick a brand-new Exportify download that finished while the wizard was open
    const auto = fresh.find((x) => W.started && x.mtime > W.started && (/\.zip$/i.test(x.name) || /spotify|exportify|liked/i.test(x.name) || true));
    f.forEach((x) => W.seen.add(x.path + x.mtime));
    if (auto) { toast('Found ' + auto.name); loadFiles([{ name: auto.name, bytes: await app.P.readFileBytes(auto.path) }]); }
  };
  const wire = () => {
    const q = (s) => root.querySelector(s);
    q('[data-open]')?.addEventListener('click', () => { openLink('https://exportify.net/'); W.started = Date.now(); });
    q('[data-skip]')?.addEventListener('click', () => { W.step = 2; startPoll(); render(); });
    q('[data-back]')?.addEventListener('click', () => { W.step = W.step === 3 ? 2 : W.step - 1; if (W.step === 2) startPoll(); render(); });
    if (W.step === 1) q('[data-next]').onclick = () => { W.step = 2; W.started ||= Date.now() - 5 * 60000; startPoll(); render(); };
    if (W.step === 2) {
      q('[data-pickfiles]').onclick = () => { const i = document.createElement('input'); i.type = 'file'; i.multiple = true; i.accept = '.csv,.zip,text/csv,application/zip'; i.onchange = () => i.files.length && loadFiles([...i.files]); i.click(); };
      const dz = q('[data-drop]');
      dz.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); dz.classList.add('over'); });
      dz.addEventListener('dragleave', () => dz.classList.remove('over'));
      dz.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); dz.classList.remove('over'); if (e.dataTransfer.files.length) loadFiles([...e.dataTransfer.files]); });
      root.querySelectorAll('[data-found]').forEach((r) => (r.onclick = async () => { const f = W.found[+r.dataset.found]; loadFiles([{ name: f.name, bytes: await app.P.readFileBytes(f.path) }]); }));
    }
    if (W.step === 3) {
      const l = W.lists[W.sel];
      const rv = reviewEl(l, () => { const keep = root.querySelector('.sp-lists').scrollTop; render(); root.querySelector('.sp-lists').scrollTop = keep; }, W.tab);
      q('[data-review]').appendChild(rv);
      rv.addEventListener('click', (e) => { const tb = e.target.closest('[data-tab]'); if (tb) W.tab = tb.dataset.tab; });
      q('.sp-name').onchange = (e) => { l.name = e.target.value.trim() || l.name; render(); };
      root.querySelector('.sp-lists').addEventListener('click', (e) => {
        const inc = e.target.closest('[data-inc]'); if (inc) { const x = W.lists[+inc.dataset.inc]; x.include = !x.include; render(); return; }
        const s = e.target.closest('[data-sel]'); if (s) { W.sel = +s.dataset.sel; W.tab = null; render(); }
      });
      q('[data-next]').onclick = () => { if (!W.lists.some((x) => x.include)) { toast('Turn on at least one playlist'); return; } W.step = 4; render(); };
      q('[data-whole]')?.addEventListener('click', () => { W.whole = !W.whole; render(); });
    }
    if (W.step === 4) {
      let dupes = 'merge';
      q('#spDup').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; dupes = b.dataset.v; $$('#spDup button', root).forEach((x) => x.classList.toggle('on', x === b)); };
      for (const id of ['#spSync', '#spLiked', '#spEnrich', '#spMirror']) q(id)?.addEventListener('click', (e) => e.currentTarget.classList.toggle('on'));
      q('[data-import]').onclick = () => {
        const res = createFromLists(W.lists, { parent: q('#spParent').value, folderName: 'Spotify', dupes, sync: q('#spSync').classList.contains('on'), likedToLiked: !!q('#spLiked')?.classList.contains('on'), enrich: !!q('#spEnrich')?.classList.contains('on'), wholeFolders: !!W.whole, mirror: !!q('#spMirror')?.classList.contains('on') });
        stop(); closeLayer();
        const songs = res.made.reduce((a, n) => a + n.tracks.length, 0);
        toast(`Imported ${res.made.length} playlist${res.made.length === 1 ? '' : 's'} • ${songs.toLocaleString()} songs${res.enriched ? ` • filled in info for ${res.enriched.toLocaleString()}` : ''}`, 4500);
        import('./views.js').then((v) => v.rerenderTrees());
        if (res.parent) go('node', { id: res.parent }); else if (res.made[0]) go('node', { id: res.made[0].id }); else go('liked');
      };
    }
  };
  const startPoll = () => { stop(); if (app.isDesktop) { poll(); W.poll = setInterval(poll, 2000); } };
  render();
}

// Missing/matches view for an already-imported playlist
export function openSpotifyReview(nodeId) {
  const n = lib.node(nodeId); const sp = n?.spotify; if (!sp) return;
  const l = { name: n.name, items: sp.items, res: sp.items.map((it, i) => { const id = sp.map[i] && lib.track(sp.map[i]) ? sp.map[i] : null; return { r: id ? { id, score: 1 } : null, st: id ? 'matched' : 'missing', use: id }; }) };
  const s = spotifyStats(n);
  const m = modal(`<h2>${esc(n.name)} <button class="ib sm" data-close>${ico('x')}</button></h2><p style="margin:-8px 0 12px;opacity:.7;font-size:13.5px">${s.have} of ${s.total} Spotify songs are in your library. <a data-recheck style="text-decoration:underline;cursor:pointer">Re-check now</a></p><div data-r></div><div class="row"><button class="pill solid" data-save>Save changes</button></div>`);
  m.classList.add('wide');
  const rv = reviewEl(l, null, s.missing ? 'missing' : 'matched'); m.querySelector('[data-r]').appendChild(rv);
  m.querySelector('[data-save]').onclick = () => { sp.map = l.res.map((x) => x.use || null); rebuildTracks(n); lib.save(); lib.emit('nodes'); closeLayer(); refresh(); toast('Playlist updated'); };
  m.querySelector('[data-recheck]').onclick = () => { buildIndex(); let f = 0; l.res.forEach((x, i) => { if (x.use) return; const r = matchItem(sp.items[i]); const st = classify(r); if (st !== 'missing') { x.r = r; x.st = st; if (st === 'matched') { x.use = r.id; f++; } } }); rv.redraw(); toast(f ? `Found ${f} more` : 'No new matches yet'); };
}
