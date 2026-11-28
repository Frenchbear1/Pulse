// Pulse online: free, no-account sources, everything cached locally and switchable in Settings → Online.
//   Lyrics ........ LRCLIB (lrclib.net) — free, open, synced (time-stamped) lyrics
//   Song info ..... iTunes Search API (genre, release date, album) + Wikipedia (artist photo & bio)
//   Cover art ..... iTunes artwork, then MusicBrainz + Cover Art Archive
//   Radio ......... Radio Browser (radio-browser.info) — 50,000+ free internet radio stations
import { app, lib } from './core.js';
import { hashStr, norm } from './util.js';

const UA = 'Pulse/1.5 (+https://github.com/Frenchbear1/Pulse)';
const N = () => window.Neutralino;
export const onlineOn = (k) => app.S.online?.[k] !== false;

// JSON GET. On desktop use the native HTTP client (no browser CORS limits, can send a User-Agent); else fetch.
export async function getJSON(url, { timeout = 9000 } = {}) {
  if (app.isDesktop && N()?.net?.get) {
    try {
      const r = await N().net.get(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, timeout });
      if (r.status === 404) return null;
      if (r.status >= 200 && r.status < 300) return JSON.parse(r.body);
    } catch (e) { /* fall through to fetch */ }
  }
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), timeout);
  try { const r = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } }); if (r.status === 404) return null; if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
  finally { clearTimeout(tm); }
}
const enc = encodeURIComponent;
const cleanTitle = (s) => (s || '').replace(/\s*[\(\[](feat\.?|ft\.?|with|prod\.?)[^\)\]]*[\)\]]/gi, '').replace(/\s*-\s*(remaster(ed)?|live|radio edit|single version|mono|stereo)\b.*$/i, '').trim();
const firstArtist = (s) => (s || '').split(/\s*(?:,|;|&| feat\.? | ft\.? | x | with )\s*/i)[0].trim();

// small persistent cache (localStorage) for info lookups
const CK = 'pulse.online.v1'; let cache = null;
const C = () => (cache ||= (() => { try { return JSON.parse(localStorage.getItem(CK) || '{}'); } catch { return {}; } })());
const saveC = () => { try { const c = C(); const keys = Object.keys(c); if (keys.length > 600) keys.sort((a, b) => (c[a].t || 0) - (c[b].t || 0)).slice(0, keys.length - 500).forEach((k) => delete c[k]); localStorage.setItem(CK, JSON.stringify(c)); } catch {} };
async function cached(key, days, fn) {
  const c = C(); const hit = c[key]; if (hit && Date.now() - hit.t < days * 864e5) return hit.v;
  const v = await fn(); c[key] = { t: Date.now(), v }; saveC(); return v;
}

// ---------------- Lyrics (LRCLIB) ----------------
export async function fetchLyrics(t) {
  if (!t || !onlineOn('lyrics') || !t.title) return null;
  const neg = lib.db.noLyrics?.[t.id]; if (neg && Date.now() - neg < 5 * 864e5) return null;
  const title = cleanTitle(t.title), artist = firstArtist(t.artist), dur = Math.round(t.duration || 0);
  let r = null;
  try {
    if (artist) r = await getJSON(`https://lrclib.net/api/get?artist_name=${enc(artist)}&track_name=${enc(title)}${t.album ? `&album_name=${enc(t.album)}` : ''}${dur ? `&duration=${dur}` : ''}`);
    if (!r || (!r.syncedLyrics && !r.plainLyrics)) {
      const list = await getJSON(`https://lrclib.net/api/search?track_name=${enc(title)}${artist ? `&artist_name=${enc(artist)}` : ''}`) || [];
      const score = (x) => (x.syncedLyrics ? 0 : 30) + (dur && x.duration ? Math.abs(x.duration - dur) : 15) + (norm(x.artistName || '').includes(norm(artist)) ? 0 : 40);
      r = list.filter((x) => x.syncedLyrics || x.plainLyrics).sort((a, b) => score(a) - score(b))[0] || null;
      if (r && dur && r.duration && Math.abs(r.duration - dur) > 12) r = null; // probably a different version
    }
  } catch { return null; } // offline / blocked — try again next time
  const text = r?.syncedLyrics || r?.plainLyrics || null;
  (lib.db.noLyrics ||= {});
  if (!text) { lib.db.noLyrics[t.id] = Date.now(); lib.save(); return null; }
  delete lib.db.noLyrics[t.id]; lib.db.lyrics[t.id] = text; (lib.db.lyricSrc ||= {})[t.id] = 'LRCLIB'; t.hasLyrics = true; lib.save();
  return text;
}

// ---------------- Song + artist info ----------------
export async function songInfo(t) {
  if (!t || !onlineOn('info')) return null;
  const artist = firstArtist(t.artist), title = cleanTitle(t.title);
  return cached('song:' + norm(artist + '|' + title), 30, async () => {
    const j = await getJSON(`https://itunes.apple.com/search?media=music&entity=song&limit=8&term=${enc(artist + ' ' + title)}`).catch(() => null);
    const res = (j?.results || []).filter((x) => norm(x.artistName).includes(norm(artist)) || norm(artist).includes(norm(x.artistName)));
    const best = res.find((x) => norm(cleanTitle(x.trackName)) === norm(title)) || res[0];
    if (!best) return null;
    return { genre: best.primaryGenreName || '', year: best.releaseDate ? +best.releaseDate.slice(0, 4) : 0, album: best.collectionName || '', art: (best.artworkUrl100 || '').replace('100x100bb', '600x600bb'), explicit: best.trackExplicitness === 'explicit', url: best.trackViewUrl, preview: best.previewUrl };
  });
}
export async function artistInfo(name) {
  name = firstArtist(name); if (!name || !onlineOn('info')) return null;
  return cached('artist:' + norm(name), 30, async () => {
    for (const q of [`${name} (musician)`, `${name} (band)`, `${name} (singer)`, name]) {
      const j = await getJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${enc(q.replace(/ /g, '_'))}`).catch(() => null);
      if (j && j.type !== 'disambiguation' && j.extract && /music|sing|band|rapper|song|album|record|worship|artist|duo|group/i.test(j.extract)) return { bio: j.extract, img: j.thumbnail?.source || j.originalimage?.source || '', url: j.content_urls?.desktop?.page || '' };
    }
    return null;
  });
}
// write what the file is missing (never overwrite real tags)
export function fillFromInfo(t, info) {
  if (!t || !info) return false; let ch = false;
  if (info.genre && !t.genre) { t.genre = info.genre; ch = true; }
  if (info.year && !t.year) { t.year = info.year; ch = true; }
  if (info.album && (!t.album || t.albumGuess)) { t.album = info.album; t.albumGuess = false; ch = true; }
  if (ch) { lib.save(); lib.reindex(true); }
  return ch;
}

// ---------------- Cover art ----------------
async function imageBytes(url) {
  const r = await fetch(url, { mode: 'cors' }); if (!r.ok) throw new Error('HTTP ' + r.status);
  const b = await r.blob(); if (!/^image\//.test(b.type)) throw new Error('not an image');
  return { data: new Uint8Array(await b.arrayBuffer()), mime: b.type };
}
export async function findCover(t) {
  if (!t || t.cover || !onlineOn('covers')) return null;
  const artist = firstArtist(t.artist); if (!artist && !t.album) return null;
  const urls = [];
  const info = await songInfo(t).catch(() => null); if (info?.art) urls.push(info.art);
  if (t.album && !t.albumGuess) {
    const mb = await getJSON(`https://musicbrainz.org/ws/2/release/?fmt=json&limit=3&query=${enc(`release:"${t.album}" AND artist:"${artist}"`)}`).catch(() => null);
    for (const r of mb?.releases || []) urls.push(`https://coverartarchive.org/release/${r.id}/front-500`);
  }
  for (const u of urls) {
    try {
      const pic = await imageBytes(u);
      const key = await lib.ensureCover(hashStr('online|' + u), async () => pic);
      if (!key) continue;
      // give it to every cover-less song on the same album
      const ak = norm((t.album || '') + '|' + artist);
      for (const x of Object.values(lib.db.tracks)) if (!x.cover && (x.id === t.id || (t.album && norm((x.album || '') + '|' + firstArtist(x.artist)) === ak))) { x.cover = key; lib.emit('cover', { id: x.id, key }); }
      lib.save(); lib.reindex(true); return key;
    } catch { /* try next source */ }
  }
  return null;
}

// ---------------- Internet radio (Radio Browser) ----------------
const RB = ['https://de1.api.radio-browser.info', 'https://nl1.api.radio-browser.info', 'https://at1.api.radio-browser.info'];
export async function radioSearch({ tag, name, limit = 40 } = {}) {
  const qs = `hidebroken=true&order=clickcount&reverse=true&limit=${limit}${tag ? `&tag=${enc(tag)}&tagExact=false` : ''}${name ? `&name=${enc(name)}` : ''}`;
  return cached('radio:' + qs, 1, async () => {
    for (const host of RB) {
      try { const j = await getJSON(`${host}/json/stations/search?${qs}`); if (Array.isArray(j)) return j.filter((s) => s.url_resolved && s.lastcheckok && (app.isDesktop || location.protocol !== 'https:' || /^https:/.test(s.url_resolved))).map((s) => ({ id: s.stationuuid, name: s.name.trim(), url: s.url_resolved, img: s.favicon || '', tags: s.tags, country: s.countrycode, codec: s.codec, bitrate: s.bitrate })); } catch {}
    }
    return [];
  });
}

// Settings → "Find missing covers": one lookup per album, gently paced (MusicBrainz asks for ≤1 request/second)
export async function findMissingCovers(onProgress) {
  if (!onlineOn('covers')) return 0;
  const seen = new Set(), todo = [];
  for (const t of Object.values(lib.db.tracks)) { if (t.cover) continue; const k = norm((t.album || t.title) + '|' + firstArtist(t.artist)); if (seen.has(k)) continue; seen.add(k); todo.push(t); }
  let found = 0;
  for (let i = 0; i < todo.length; i++) {
    onProgress?.(i, todo.length);
    if (todo[i].cover) continue;
    if (await findCover(todo[i]).catch(() => null)) found++;
    await new Promise((r) => setTimeout(r, 1100));
  }
  onProgress?.(todo.length, todo.length);
  return found;
}
