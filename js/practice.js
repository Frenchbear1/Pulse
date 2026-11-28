// Practice mode: loop a section (A–B), slow it down, let the speed trainer build it back up,
// pause between repeats, and drop bookmarks on the parts you're working on.
import { app, modal, ico, toast, closeLayer, prompt } from './core.js';
import { player } from './player.js';
import { $, $$, esc, fmtTime, clamp } from './util.js';

const fmtP = (s) => { const t = fmtTime(s); const d = Math.floor((s % 1) * 10); return `${t}.${d}`; };

export function practicePanel() {
  const t = player.track;
  if (!t || player.liveMode) { toast('Play a song to practice with it'); return; }
  const S = app.S;
  const m = modal(`<h2><span style="display:flex;align-items:center;gap:10px">${ico('loop')}Practice</span><button class="ib sm" data-close>${ico('x')}</button></h2>
    <div class="pr-song"><b>${esc(t.title)}</b><small>${esc(t.artist || 'Unknown Artist')}</small></div>
    <div class="pr-tl" id="prTl"><div class="pr-buf"></div><div class="pr-loop"></div><div class="pr-head"></div><div class="pr-marks"></div><span class="pr-h a" data-h="a"></span><span class="pr-h b" data-h="b"></span></div>
    <div class="pr-times"><span id="prA">A —</span><span id="prNow">0:00</span><span id="prB">B —</span></div>
    <div class="pr-btns">
      <button class="pill" data-a="a" title="Set loop start here ( [ )">Set A</button>
      <button class="pill" data-a="b" title="Set loop end here ( ] )">Set B</button>
      <button class="pill" data-a="last" title="Loop the last few seconds">Last 5 s</button>
      <button class="pill" data-a="clear" title="Clear loop ( \\ )">${ico('x')}Clear</button>
    </div>
    <div class="pr-nudge"><span>Nudge</span><button class="ib sm" data-n="a:-0.1">A −</button><button class="ib sm" data-n="a:0.1">A +</button><button class="ib sm" data-n="b:-0.1">B −</button><button class="ib sm" data-n="b:0.1">B +</button><span class="pr-hits" id="prHits"></span></div>
    <div class="opt"><div class="l"><b>Pause between repeats</b><small>Time to reset your hands</small></div><div class="r"><div class="seg" id="prGap">${[0, 1, 2, 4].map((g) => `<button data-g="${g}" class="${(player.loop?.gap ?? S.loopGap ?? 0) === g ? 'on' : ''}">${g ? g + ' s' : 'Off'}</button>`).join('')}</div></div></div>
    <div class="opt"><div class="l"><b>Speed</b><small>${app.isMobile ? 'Tap the number to reset' : 'Double-click or tap the number to reset'}</small></div><div class="r"><input type="range" min="0.5" max="1.5" step="0.05" value="${S.speed}" id="prSpd"><span class="val" id="prSpdV" style="cursor:pointer" title="Back to 100%">${Math.round(S.speed * 100)}%</span></div></div>
    <div class="opt"><div class="l"><b>Keep pitch</b><small>Slower without sounding lower</small></div><div class="r"><div class="tog ${S.keepPitch ? 'on' : ''}" id="prPitch"></div></div></div>
    <div class="opt"><div class="l"><b>Speed trainer</b><small id="prTrDesc">Starts slow and speeds up as you nail each repeat</small></div><div class="r">
      <select class="inp" id="prTrFrom" style="width:84px;height:34px">${[50, 60, 70, 75, 80, 90].map((v) => `<option value="${v}" ${v === (S.trainer?.from ?? 70) ? 'selected' : ''}>${v}%</option>`).join('')}</select>
      <select class="inp" id="prTrStep" style="width:84px;height:34px">${[2, 5, 10].map((v) => `<option value="${v}" ${v === (S.trainer?.step ?? 5) ? 'selected' : ''}>+${v}%</option>`).join('')}</select>
      <select class="inp" id="prTrEvery" style="width:104px;height:34px">${[1, 2, 3, 4].map((v) => `<option value="${v}" ${v === (S.trainer?.every ?? 2) ? 'selected' : ''}>every ${v}×</option>`).join('')}</select>
      <div class="tog ${player.loop?.trainer ? 'on' : ''}" id="prTr"></div></div></div>
    <div class="opt" style="border:0;padding-bottom:4px"><div class="l"><b>Bookmarks</b><small>${app.isMobile ? 'Mark the parts you are working on' : 'Press B anytime to drop one'}</small></div><div class="r"><button class="pill" data-a="mark">${ico('flag')}Add here</button></div></div>
    <div class="pr-mlist" id="prMarks"></div>`);
  m.classList.add('practice');
  const tl = m.querySelector('#prTl');
  const frac = (x) => { const d = player.duration; return d ? clamp(x / d, 0, 1) : 0; };
  const draw = () => {
    if (!m.isConnected) return;
    const L = player.loop, d = player.duration;
    tl.style.setProperty('--p', frac(player.time));
    tl.classList.toggle('has-loop', !!L);
    if (L) { tl.style.setProperty('--a', frac(L.a)); tl.style.setProperty('--b', frac(L.b)); }
    m.querySelector('#prA').textContent = L ? 'A ' + fmtP(L.a) : 'A —';
    m.querySelector('#prB').textContent = L ? 'B ' + fmtP(L.b) : 'B —';
    m.querySelector('#prNow').textContent = fmtTime(player.time) + ' / ' + fmtTime(d);
    m.querySelector('#prHits').textContent = L?.hits ? `Repeat ${L.hits + 1}` : '';
    const sp = S.speed; m.querySelector('#prSpd').value = sp; m.querySelector('#prSpdV').textContent = Math.round(sp * 100) + '%';
  };
  const drawMarks = () => {
    const ms = player.marks(); const d = player.duration;
    m.querySelector('.pr-marks').innerHTML = ms.map((x) => `<i style="left:${frac(x.t) * 100}%" title="${esc(x.label || fmtTime(x.t))}"></i>`).join('');
    m.querySelector('#prMarks').innerHTML = ms.length ? ms.map((x, i) => `<div class="pr-m" data-i="${i}"><button class="pr-mt" data-jump="${i}">${fmtTime(x.t)}</button><span>${esc(x.label || 'Bookmark ' + (i + 1))}</span>${ms[i + 1] ? `<button class="ib sm" data-loopm="${i}" title="Loop from here to the next bookmark">${ico('loop')}</button>` : (d ? `<button class="ib sm" data-loopm="${i}" title="Loop from here to the end">${ico('loop')}</button>` : '')}<button class="ib sm" data-rm="${i}" title="Remove">${ico('trash')}</button></div>`).join('') : '<div class="pr-empty">No bookmarks yet.</div>';
  };
  draw(); drawMarks();
  const onP = (e) => { if (!m.isConnected) { player.listeners.delete(onP); return; } if (e === 'time' || e === 'loop' || e === 'speed' || e === 'settings') draw(); if (e === 'marks') drawMarks(); if (e === 'track') { closeLayer(); } };
  player.on(onP);

  // timeline: click to seek, drag the A/B handles
  tl.addEventListener('pointerdown', (e) => {
    const r = tl.getBoundingClientRect(); const at = (ev) => clamp((ev.clientX - r.left) / r.width, 0, 1) * player.duration;
    const hdl = e.target.closest('[data-h]')?.dataset.h;
    if (!hdl) { player.seek(at(e)); draw(); return; }
    e.preventDefault(); tl.setPointerCapture(e.pointerId);
    const mv = (ev) => { const L = player.loop; if (!L) return; const v = at(ev); if (hdl === 'a') player.setLoop(Math.min(v, L.b - 0.3), L.b); else player.setLoop(L.a, Math.max(v, L.a + 0.3)); };
    const up = () => { tl.removeEventListener('pointermove', mv); tl.removeEventListener('pointerup', up); tl.removeEventListener('pointercancel', up); };
    tl.addEventListener('pointermove', mv); tl.addEventListener('pointerup', up); tl.addEventListener('pointercancel', up);
  });
  m.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'a' || a === 'b') player.setLoopPoint(a);
    if (a === 'last') { const now = player.time; player.setLoop(Math.max(0, now - 5), now); }
    if (a === 'clear') { player.clearLoop(); if (S.trainerWas) { S.speed = S.trainerWas; delete S.trainerWas; player.applySpeed(); app.saveS(); } m.querySelector('#prTr').classList.remove('on'); }
    if (a === 'mark') { const at = player.time; const label = await prompt('Bookmark name', '', 'e.g. Solo, Chorus 2'); player.addMark(label || '', at); if (!m.isConnected) practicePanel(); }
    const n = e.target.closest('[data-n]')?.dataset.n;
    if (n && player.loop) { const [w, dv] = n.split(':'); const L = player.loop; if (w === 'a') player.setLoop(L.a + +dv, L.b); else player.setLoop(L.a, L.b + +dv); }
    const g = e.target.closest('[data-g]');
    if (g) { const v = +g.dataset.g; S.loopGap = v; app.saveS(); if (player.loop) player.loop.gap = v; $$('#prGap button', m).forEach((b) => b.classList.toggle('on', b === g)); }
    const j = e.target.closest('[data-jump]'); if (j) { player.seek(player.marks()[+j.dataset.jump].t); if (!player.playing) player.play(); }
    const lm = e.target.closest('[data-loopm]'); if (lm) { const ms = player.marks(); const i = +lm.dataset.loopm; player.setLoop(ms[i].t, ms[i + 1]?.t ?? player.duration); if (!player.playing) player.play(); }
    const rm = e.target.closest('[data-rm]'); if (rm) player.removeMark(+rm.dataset.rm);
    draw();
  });
  const spd = m.querySelector('#prSpd');
  spd.addEventListener('input', () => { S.speed = +spd.value; player.applySpeed(); app.saveS(); draw(); });
  const reset = () => { S.speed = 1; player.applySpeed(); app.saveS(); draw(); };
  spd.addEventListener('dblclick', reset); m.querySelector('#prSpdV').addEventListener('click', reset);
  const pitch = m.querySelector('#prPitch'); pitch.onclick = () => { S.keepPitch = !S.keepPitch; pitch.classList.toggle('on', S.keepPitch); player.applySpeed(); app.saveS(); };
  const tr = m.querySelector('#prTr');
  const readTr = () => ({ from: +m.querySelector('#prTrFrom').value, step: +m.querySelector('#prTrStep').value, every: +m.querySelector('#prTrEvery').value });
  tr.onclick = () => {
    const on = !tr.classList.contains('on'); tr.classList.toggle('on', on);
    const cfg = S.trainer = readTr(); app.saveS();
    if (on) {
      if (!player.loop) { const now = player.time; player.setLoop(Math.max(0, now - 8), Math.min(player.duration, now + 8)); }
      S.trainerWas = S.speed; S.speed = cfg.from / 100; player.applySpeed();
      player.loop.trainer = { to: 1, step: cfg.step / 100, every: cfg.every }; player.loop.hits = 0; player.seek(player.loop.a);
      if (!player.playing) player.play();
      toast(`Speed trainer: ${cfg.from}% → 100%, +${cfg.step}% every ${cfg.every === 1 ? 'repeat' : cfg.every + ' repeats'}`);
    } else { if (player.loop) player.loop.trainer = null; if (S.trainerWas) { S.speed = S.trainerWas; delete S.trainerWas; player.applySpeed(); } }
    app.saveS(); draw();
  };
  m.addEventListener('change', (e) => { if (e.target.closest('#prTrFrom, #prTrStep, #prTrEvery')) { S.trainer = readTr(); app.saveS(); if (player.loop?.trainer) { const c = S.trainer; player.loop.trainer = { to: 1, step: c.step / 100, every: c.every }; } } });
}

// Keyboard: [ and ] set the loop, \ clears it, B drops a bookmark, Shift+P opens Practice
export function practiceKeys(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  const k = e.key;
  if (k === '[') { player.setLoopPoint('a'); toast('Loop start set'); return true; }
  if (k === ']') { player.setLoopPoint('b'); toast('Loop end set — looping'); return true; }
  if (k === '\\') { if (player.loop) { player.clearLoop(); toast('Loop cleared'); } return true; }
  if (k === 'b' || k === 'B') { if (!player.track || player.liveMode) return true; player.addMark('', player.time); toast('Bookmark added at ' + fmtTime(player.time)); return true; }
  if (k === 'P' && e.shiftKey) { practicePanel(); return true; }
  return false;
}
