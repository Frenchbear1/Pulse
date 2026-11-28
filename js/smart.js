// Smart mixes ("Made for you") and listening stats, built only from what's on this device:
// your plays, likes, skips, when songs were added and the tags in your files. Nothing leaves the app.
import { lib, primaryArtist } from './library.js';
import { player } from './player.js';
import { app, ico, coverImg, go, hydrate, refresh } from './core.js';
import { h, esc, norm, fmtLong } from './util.js';

const DAY = 86400000;
const T = (id) => lib.db.tracks[id];
// same picks all day, new ones tomorrow
function seeded(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const today = () => Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / DAY);
function shuffleWith(arr, rnd) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const artistOf = (t) => norm(primaryArtist(t.artist) || t.albumArtist || '');

let cache = null;
lib.on?.((e) => { if (e === 'index' || e === 'liked') cache = null; });
player.on?.((e) => { if (e === 'played') cache = null; });

export function mixes() {
  const key = today() + ':' + Object.keys(lib.db.tracks).length;
  if (cache?.key === key) return cache.list;
  const all = Object.values(lib.db.tracks); const out = [];
  if (all.length < 12) { cache = { key, list: out }; return out; }
  const plays = lib.db.plays || {}, last = lib.db.last || {}, liked = lib.db.liked || {}, skips = lib.db.skips || {};
  const rnd = seeded(today() * 2654435761);
  const now = Date.now();

  // Daily mixes: built around the artists you actually play, padded with songs that share their genre
  const artistPlays = new Map(); const byArtist = new Map(); const byGenre = new Map();
  for (const t of all) {
    const a = artistOf(t); if (!a) continue;
    if (!byArtist.has(a)) byArtist.set(a, []); byArtist.get(a).push(t.id);
    artistPlays.set(a, (artistPlays.get(a) || 0) + (plays[t.id] || 0) + (liked[t.id] ? 3 : 0));
    const g = norm(t.genre); if (g) { if (!byGenre.has(g)) byGenre.set(g, []); byGenre.get(g).push(t.id); }
  }
  const seeds = [...artistPlays.entries()].filter((e) => e[1] > 0).sort((a, b) => b[1] - a[1]).map((e) => e[0]);
  const used = new Set();
  for (let m = 0; m < 4 && seeds.length; m++) {
    const lead = seeds.find((s) => !used.has(s)); if (!lead) break; used.add(lead);
    const leadTracks = byArtist.get(lead) || []; const genres = new Map();
    for (const id of leadTracks) { const g = norm(T(id).genre); if (g) genres.set(g, (genres.get(g) || 0) + 1); }
    const topG = [...genres.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map((e) => e[0]);
    // other played artists in the same genres join the mix
    const friends = seeds.filter((s) => s !== lead && (byArtist.get(s) || []).some((id) => topG.includes(norm(T(id).genre)))).slice(0, 5);
    friends.forEach((f) => used.add(f));
    let pool = [...leadTracks, ...friends.flatMap((f) => byArtist.get(f) || [])];
    for (const g of topG) pool.push(...shuffleWith(byGenre.get(g) || [], rnd).slice(0, 30));
    pool = [...new Set(pool)].filter((id) => (skips[id] || 0) < 4);
    if (pool.length < 8) continue;
    const ids = shuffleWith(pool, rnd).slice(0, 50);
    const names = [lead, ...friends].map((a) => (byArtist.get(a)?.[0] && primaryArtist(T(byArtist.get(a)[0]).artist)) || a).slice(0, 3);
    out.push({ key: 'daily' + (m + 1), name: 'Daily Mix ' + (m + 1), desc: names.join(', ') + (friends.length > 2 ? ' and more' : ''), ids, hue: (m * 77 + 260) % 360 });
  }

  // Forgotten favorites: songs you loved that haven't come up in a while
  const forgotten = all.filter((t) => (liked[t.id] || (plays[t.id] || 0) >= 3) && now - (last[t.id] || 0) > 45 * DAY)
    .sort((a, b) => (plays[b.id] || 0) + (liked[b.id] ? 5 : 0) - (plays[a.id] || 0) - (liked[a.id] ? 5 : 0)).slice(0, 60).map((t) => t.id);
  if (forgotten.length >= 6) out.push({ key: 'forgotten', name: 'Forgotten Favorites', desc: "Songs you love that you haven't played lately", ids: shuffleWith(forgotten, rnd), hue: 330 });

  // Fresh finds: recently added, not played yet
  const fresh = all.filter((t) => now - (t.added || 0) < 30 * DAY && !plays[t.id]).sort((a, b) => (b.added || 0) - (a.added || 0)).slice(0, 80).map((t) => t.id);
  if (fresh.length >= 5) out.push({ key: 'fresh', name: 'Fresh Imports', desc: "New in your library and still unplayed", ids: fresh, hue: 160 });

  // Deep cuts: never-played songs by artists you play a lot
  const topArtists = new Set(seeds.slice(0, 25));
  const deep = all.filter((t) => !plays[t.id] && topArtists.has(artistOf(t)) && !fresh.includes(t.id)).map((t) => t.id);
  if (deep.length >= 6) out.push({ key: 'deep', name: 'Deep Cuts', desc: 'Unplayed songs from artists you play most', ids: shuffleWith(deep, rnd).slice(0, 60), hue: 210 });

  // Tempo mixes from BPM tags (when your files have them)
  const withBpm = all.filter((t) => t.bpm > 40);
  if (withBpm.length >= 20) {
    const band = (lo, hi) => withBpm.filter((t) => t.bpm >= lo && t.bpm <= hi).map((t) => t.id);
    const run = band(150, 185), gym = band(120, 150), calm = band(55, 95);
    if (gym.length >= 8) out.push({ key: 'tempo-gym', name: 'Workout Tempo', desc: '120–150 BPM, steady energy', ids: shuffleWith(gym, rnd).slice(0, 60), hue: 15 });
    if (run.length >= 8) out.push({ key: 'tempo-run', name: 'Running Tempo', desc: '150–185 BPM, in step with a run', ids: shuffleWith(run, rnd).slice(0, 60), hue: 45 });
    if (calm.length >= 8) out.push({ key: 'tempo-calm', name: 'Slow & Calm', desc: 'Under 95 BPM', ids: shuffleWith(calm, rnd).slice(0, 60), hue: 190 });
  }

  // A random-but-stable "time capsule" from your oldest imports
  const oldest = all.slice().sort((a, b) => (a.added || 0) - (b.added || 0)).slice(0, Math.max(30, Math.floor(all.length * 0.25))).map((t) => t.id);
  if (all.length > 60) out.push({ key: 'capsule', name: 'Time Capsule', desc: 'From the first songs you added', ids: shuffleWith(oldest, rnd).slice(0, 50), hue: 35 });

  cache = { key, list: out }; return out;
}
export const mixByKey = (k) => mixes().find((m) => m.key === k);

export function mixCover(m, small) {
  const keys = []; for (const id of m.ids) { const c = T(id)?.cover; if (c && !keys.includes(c)) keys.push(c); if (keys.length === 4) break; }
  const art = keys.length >= 4 ? `<div class="mosaic">${keys.map((k) => coverImg(k, true)).join('')}</div>` : keys.length ? coverImg(keys[0], !!small) : '';
  return `<div class="mix-cv" style="--mh:${m.hue}">${art}<span class="mix-tag">${esc(m.name.replace(/^Daily Mix /, 'Mix '))}</span></div>`;
}
export function mixCard(m, i) {
  return `<div class="card" data-mix="${esc(m.key)}" style="--i:${Math.min(i, 20)}"><div class="cv">${mixCover(m)}<button class="fab" data-play>${ico('play')}</button></div><b>${esc(m.name)}</b><small>${esc(m.desc)}</small></div>`;
}
// Home row
export function mixesRow() {
  const list = mixes(); if (!list.length) return null;
  const el = h(`<div><div class="sec"><h2>Made for you</h2><a data-go="stats">Your stats</a></div><div class="grid row">${list.map(mixCard).join('')}</div></div>`);
  el.addEventListener('click', (e) => {
    const c = e.target.closest('[data-mix]'); if (!c) return; e.stopPropagation();
    const m = mixByKey(c.dataset.mix); if (!m) return;
    if (e.target.closest('[data-play]')) player.playList(m.ids, 0, { type: 'mix', id: m.key, label: m.name });
    else go('mix', { key: m.key });
  });
  hydrate(el); return el;
}

// ---------------- Your stats ----------------
const dayKey = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const mins = (s) => Math.round((s || 0) / 60);
export function renderStats() {
  const st = lib.db.stats || { days: {}, artists: {}, tracks: {} };
  const el = h('<div class="page stats"></div>');
  const range = app.S.statsRange || 30;
  const days = []; const now = new Date();
  for (let i = range - 1; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i); days.push({ d, k: dayKey(d), s: st.days?.[dayKey(d)]?.s || 0 }); }
  const total = days.reduce((a, x) => a + x.s, 0); const allTime = Object.values(st.days || {}).reduce((a, x) => a + x.s, 0);
  let streak = 0; for (let i = 0; ; i++) { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i); if ((st.days?.[dayKey(d)]?.s || 0) >= 60) streak++; else if (i > 0) break; if (i > 3650) break; }
  const hours = new Array(24).fill(0); for (const x of days) { const hh = st.days?.[x.k]?.h; if (hh) hh.forEach((v, i) => (hours[i] += v)); }
  const peak = hours.indexOf(Math.max(...hours)); const peakTxt = total ? new Date(2000, 0, 1, peak).toLocaleTimeString([], { hour: 'numeric' }) : '—';
  const maxDay = Math.max(1, ...days.map((x) => x.s)); const maxH = Math.max(1, ...hours);
  const lib0 = Object.values(lib.db.tracks); const libDur = lib0.reduce((a, t) => a + (t.duration || 0), 0);
  const topArtists = Object.entries(st.artists || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const topSongs = Object.entries(st.tracks || {}).filter(([id]) => T(id)).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const plays = Object.values(lib.db.plays || {}).reduce((a, b) => a + b, 0);
  const since = st.since ? new Date(st.since).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : null;
  el.innerHTML = `<div class="page-h"><h1>Your stats</h1><div class="seg" id="stRange">${[[7, '7 days'], [30, '30 days'], [365, 'Year']].map(([v, l]) => `<button data-r="${v}" class="${range === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div class="st-big">
      <div class="st-n"><b>${mins(total).toLocaleString()}</b><span>minutes listened</span></div>
      <div class="st-n"><b>${streak}</b><span>day streak</span></div>
      <div class="st-n"><b>${peakTxt}</b><span>favorite hour</span></div>
      <div class="st-n"><b>${plays.toLocaleString()}</b><span>plays all time</span></div>
    </div>
    <div class="sec"><h2>Minutes per day</h2></div>
    <div class="st-bars ${range > 60 ? 'dense' : ''}">${days.map((x) => `<i style="--v:${x.s / maxDay}" title="${x.d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}: ${mins(x.s)} min"></i>`).join('')}</div>
    <div class="sec"><h2>When you listen</h2></div>
    <div class="st-hours">${hours.map((v, i) => `<i style="--v:${v / maxH}" title="${new Date(2000, 0, 1, i).toLocaleTimeString([], { hour: 'numeric' })}: ${mins(v)} min"><span>${i % 6 === 0 ? new Date(2000, 0, 1, i).toLocaleTimeString([], { hour: 'numeric' }) : ''}</span></i>`).join('')}</div>
    <div class="st-cols">
      <div><div class="sec"><h2>Top artists</h2></div>${topArtists.length ? topArtists.map(([n, s], i) => { const ar = lib.idx.artists.get(norm(n)); return `<a class="st-row" ${ar ? `data-artist="${esc(ar.key)}"` : ''}><span class="st-rank">${i + 1}</span><span class="stx-cv round">${ar?.cover ? coverImg(ar.cover, true) : ico('artist')}</span><span class="st-t"><b>${esc(n)}</b><small>${mins(s)} min</small></span></a>`; }).join('') : '<p class="st-none">Play some music and your top artists show up here.</p>'}</div>
      <div><div class="sec"><h2>Top songs</h2></div>${topSongs.length ? topSongs.map(([id, s], i) => { const t = T(id); return `<a class="st-row" data-tid="${id}"><span class="st-rank">${i + 1}</span><span class="stx-cv">${t.cover ? coverImg(t.cover, true) : ico('note')}</span><span class="st-t"><b>${esc(t.title)}</b><small>${esc(t.artist || 'Unknown Artist')} • ${mins(s)} min</small></span></a>`; }).join('') : '<p class="st-none">Nothing yet.</p>'}</div>
    </div>
    <div class="sec"><h2>Your library</h2></div>
    <div class="st-big small">
      <div class="st-n"><b>${lib0.length.toLocaleString()}</b><span>songs</span></div>
      <div class="st-n"><b>${lib.idx.albums.size.toLocaleString()}</b><span>albums</span></div>
      <div class="st-n"><b>${lib.idx.artists.size.toLocaleString()}</b><span>artists</span></div>
      <div class="st-n"><b>${fmtLong(libDur)}</b><span>of music</span></div>
      <div class="st-n"><b>${Object.keys(lib.db.liked || {}).length.toLocaleString()}</b><span>liked</span></div>
      <div class="st-n"><b>${mins(allTime).toLocaleString()}</b><span>minutes all time</span></div>
    </div>
    <p class="st-note">Counted on this device${since ? ` since ${since}` : ''}. Only time you actually hear counts, not skipped or seeked-past parts.</p>`;
  el.addEventListener('click', (e) => {
    const r = e.target.closest('[data-r]'); if (r) { app.S.statsRange = +r.dataset.r; app.saveS(); refresh(); return; }
    const a = e.target.closest('[data-artist]'); if (a) { go('artist', { key: a.dataset.artist }); return; }
    const s = e.target.closest('[data-tid]'); if (s) { const ids = topSongs.map((x) => x[0]); player.playList(ids, ids.indexOf(s.dataset.tid), { type: 'stats', label: 'Your top songs' }); }
  });
  hydrate(el); return el;
}
