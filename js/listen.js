// "Radio & Sounds": endless generated sounds (offline) + free internet radio (Radio Browser), all playable like songs.
import { app, lib, player, toast, go, ico, hydrate } from './core.js';
import { esc, h, debounce } from './util.js';
import { SOUNDS, soundTrack } from './ambient.js';
import { radioSearch, onlineOn } from './online.js';

export const RADIO_TAGS = [
  ['lofi', 'Lo-fi'], ['christian', 'Christian'], ['worship', 'Worship'], ['chill', 'Chill'], ['jazz', 'Jazz'], ['classical', 'Classical'],
  ['ambient', 'Ambient'], ['study', 'Study'], ['piano', 'Piano'], ['pop', 'Pop'], ['hits', 'Hits'], ['rock', 'Rock'], ['hip hop', 'Hip-hop'],
  ['country', 'Country'], ['80s', '80s'], ['90s', '90s'], ['soundtrack', 'Soundtracks'], ['news', 'News'], ['talk', 'Talk']
];
const RADIO_ICON = (name) => 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1f2937"/><stop offset="1" stop-color="#111827"/></linearGradient></defs><rect width="300" height="300" fill="url(#g)"/><g fill="none" stroke="#a78bfa" stroke-width="10" stroke-linecap="round"><path d="M110 130a55 55 0 0 1 80 0"/><path d="M85 105a90 90 0 0 1 130 0"/></g><circle cx="150" cy="160" r="14" fill="#a78bfa"/><text x="150" y="250" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="800" font-size="26" fill="#fff">${(name || 'Radio').slice(0, 18).replace(/&/g, '&amp;').replace(/</g, '')}</text></svg>`);

export function playSound(id, list = SOUNDS) {
  const ids = list.map((s) => lib.addVirtual(soundTrack(s)));
  player.playList(ids, list.findIndex((s) => s.id === id), { type: 'sounds', label: 'Pulse Sounds' }, { shuffle: false });
}
function stationTrack(s) {
  return { id: 'v:radio:' + s.id, title: s.name, artist: [s.country, (s.tags || '').split(',').slice(0, 2).join(', ')].filter(Boolean).join(' • ') || 'Internet radio', album: 'Live radio', live: true, url: s.url, cover: s.img && /^https:/.test(s.img) ? s.img : RADIO_ICON(s.name), station: s };
}
export function playStations(list, i, label) {
  const ids = list.map((s) => lib.addVirtual(stationTrack(s)));
  player.playList(ids, i, { type: 'radio', label: label || 'Radio' }, { shuffle: false });
}
const soundCard = (s) => `<div class="card snd" data-snd="${s.id}"><div class="cv"><img src="${soundTrack(s).cover}" alt="" loading="lazy" class="ok"><button class="fab" data-play>${ico('play')}</button></div><b>${esc(s.name)}</b><small>${esc(s.desc)}</small></div>`;
const stationCard = (s, i) => `<div class="card st" data-st="${i}"><div class="cv st-cv">${s.img && /^https:/.test(s.img) ? `<img src="${esc(s.img)}" alt="" loading="lazy" onerror="this.remove()" onload="this.classList.add('ok')">` : ''}<span class="st-ph">${ico('cast')}</span><button class="fab" data-play>${ico('play')}</button></div><b>${esc(s.name)}</b><small>${esc([s.country, s.codec && s.bitrate ? `${s.codec} ${s.bitrate}k` : s.codec].filter(Boolean).join(' • '))}</small></div>`;

// rows for the Home page
export function homeSoundsRow() {
  const el = h(`<div><div class="sec"><h2>Focus & sleep sounds</h2><a data-go="listen">Radio & sounds</a></div><div class="grid row">${SOUNDS.slice(0, 10).map(soundCard).join('')}</div></div>`);
  el.addEventListener('click', (e) => { const c = e.target.closest('[data-snd]'); if (c) playSound(c.dataset.snd); const a = e.target.closest('a[data-go]'); if (a) go(a.dataset.go); });
  return el;
}

export function renderListen({ tag } = {}) {
  const el = h(`<div class="page listen">
    <div class="page-h"><h1>Radio & Sounds</h1></div>
    <div class="sec"><h2>Endless sounds</h2><small class="sec-note">Made live on your device — no internet needed, never repeats</small></div>
    <div class="grid snd-grid">${SOUNDS.map(soundCard).join('')}</div>
    <div class="sec"><h2>Live radio</h2><small class="sec-note">${onlineOn('radio') ? 'Free stations from radio-browser.info' : 'Turned off in Settings → Online'}</small></div>
    <div class="radio-bar"><label class="tb-search radio-q">${ico('search')}<input placeholder="Search stations…" spellcheck="false"></label></div>
    <div class="chips radio-tags">${RADIO_TAGS.map(([k, l]) => `<a class="chip ${k === (tag || 'lofi') ? 'on' : ''}" data-tag="${esc(k)}">${l}</a>`).join('')}</div>
    <div class="grid st-grid"><div class="tree-empty"><span class="spin"></span> Finding stations…</div></div>
  </div>`);
  let stations = []; let label = '';
  const grid = el.querySelector('.st-grid');
  const load = async (q) => {
    if (!onlineOn('radio')) { grid.innerHTML = '<div class="tree-empty">Live radio is off. Turn it on in Settings → Online.</div>'; return; }
    grid.innerHTML = '<div class="tree-empty"><span class="spin"></span> Finding stations…</div>';
    try { stations = await radioSearch(q); } catch { stations = []; }
    label = q.tag ? (RADIO_TAGS.find((x) => x[0] === q.tag)?.[1] || q.tag) + ' radio' : `“${q.name}”`;
    grid.innerHTML = stations.length ? stations.map(stationCard).join('') : `<div class="tree-empty">No stations found${navigator.onLine ? '' : ' — you look offline'}.</div>`;
  };
  load({ tag: tag || 'lofi' });
  el.querySelector('.radio-tags').addEventListener('click', (e) => { const c = e.target.closest('[data-tag]'); if (!c) return; el.querySelectorAll('.radio-tags .chip').forEach((x) => x.classList.toggle('on', x === c)); el.querySelector('.radio-q input').value = ''; load({ tag: c.dataset.tag }); });
  el.querySelector('.radio-q input').addEventListener('input', debounce((e) => { const v = e.target.value.trim(); if (v.length > 1) { el.querySelectorAll('.radio-tags .chip').forEach((x) => x.classList.remove('on')); load({ name: v }); } }, 450));
  el.addEventListener('click', (e) => {
    const s = e.target.closest('[data-snd]'); if (s) { playSound(s.dataset.snd); return; }
    const st = e.target.closest('[data-st]'); if (st) { playStations(stations, +st.dataset.st, label); toast('Tuning in…', 1200); }
  });
  hydrate(el);
  return el;
}
