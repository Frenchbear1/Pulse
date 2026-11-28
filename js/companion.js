// Separate mini-player window ("companion"). Neutralino runs every window as its own process, so the main window
// (which plays the audio) and the mini window talk through two tiny files in PulseData/ipc:
//   state.json  main → mini  (what's playing, play state, mini settings; the mini extrapolates the time itself)
//   cmd.json    mini → main  (button presses as a short numbered queue, plus a heartbeat)
import { app, lib, player, toast } from './core.js';
import * as NP from './np.js';

const N = () => window.Neutralino;
const F = (n) => app.P.dataDir + '/ipc/' + n;
async function readJSON(n) { try { return JSON.parse(await N().filesystem.readFile(F(n))); } catch { return null; } }
async function writeJSON(n, o) {
  const s = JSON.stringify(o);
  try { await N().filesystem.writeFile(F(n) + '.tmp', s); await N().filesystem.move(F(n) + '.tmp', F(n)); }
  catch { try { await N().filesystem.writeFile(F(n), s); } catch {} }
}

// ======================= main window side =======================
export const host = { alive: false, closing: false, lastSeq: 0, spawned: 0, poll: null, keep: null, rev: 0 };
function snapshot() {
  const t = player.track; const cs = getComputedStyle(document.documentElement);
  return {
    at: Date.now(), rev: ++host.rev, close: host.closing,
    playing: player.playing, time: player.time, dur: player.duration, shuffle: player.shuffle, repeat: player.repeat,
    volume: app.S.volume, muted: !!app.S.muted, liked: t ? lib.isLiked(t.id) : false,
    track: t ? { id: t.id, title: t.title, artist: t.artist, cover: t.cover || null, duration: t.duration } : null,
    mini: app.S.mini, theme: app.S.theme, font: app.S.font,
    acc: cs.getPropertyValue('--acc-rgb').trim(), acc2: cs.getPropertyValue('--acc2-rgb').trim()
  };
}
let pushT = null;
export function pushState(now) {
  if (!host.alive && !host.closing) return;
  clearTimeout(pushT); pushT = setTimeout(() => writeJSON('state.json', snapshot()), now ? 0 : 50);
}
export async function openCompanion() {
  if (!app.isDesktop) return;
  if (host.alive) { pushState(true); return; }
  try { await N().filesystem.createDirectory(app.P.dataDir + '/ipc'); } catch {}
  host.closing = false; host.lastSeq = 0;
  await writeJSON('cmd.json', { hb: 0, q: [] });
  await writeJSON('state.json', snapshot());
  const M = app.S.mini; const [dw, dh] = NP.MINI_SIZES[M.layout] || NP.MINI_SIZES.bar;
  const w = M.w?.[M.layout] || dw, h = M.h?.[M.layout] || dh;
  const opts = { width: w, height: h, borderless: true, transparent: true, alwaysOnTop: !!M.onTop, resizable: false, title: 'Pulse mini player', skipTaskbar: true, enableInspector: false, exitProcessOnClose: true, processArgs: '--port=0' };
  if (M.cx != null) { opts.x = M.cx; opts.y = M.cy; } else { opts.center = true; }
  try { await N().window.create('/index.html?mini=1', opts); }
  catch (e) { toast('Couldn’t open the mini player window'); console.warn(e); return; }
  host.alive = true; host.spawned = Date.now();
  clearInterval(host.poll); host.poll = setInterval(pollCommands, 200);
  clearInterval(host.keep); host.keep = setInterval(() => pushState(true), 1000);
}
export async function closeCompanion() {
  if (!host.alive) return;
  host.closing = true; host.alive = false; await writeJSON('state.json', snapshot());
  clearInterval(host.poll); clearInterval(host.keep); setTimeout(() => { host.closing = false; }, 1500);
}
async function pollCommands() {
  const c = await readJSON('cmd.json'); if (!c) return;
  if (Date.now() - host.spawned > 12000 && Date.now() - (c.hb || 0) > 6000) { host.alive = false; clearInterval(host.poll); clearInterval(host.keep); return; } // mini window closed/crashed
  for (const it of c.q || []) { if (it.seq <= host.lastSeq) continue; host.lastSeq = it.seq; run(it.cmd, it.arg); }
}
function run(cmd, arg) {
  const t = player.track;
  switch (cmd) {
    case 'toggle': player.toggle(); break;
    case 'next': player.next(); break;
    case 'prev': player.prev(); break;
    case 'seek': player.seek(arg); break;
    case 'like': if (t) lib.like(t.id); break;
    case 'shuffle': player.toggleShuffle(); break;
    case 'repeat': player.cycleRepeat(); break;
    case 'mute': player.toggleMute(); break;
    case 'volume': player.setVolume(arg); break;
    case 'mini': Object.assign(app.S.mini, arg || {}); app.saveS(); break;
    case 'geom': if (arg) { app.S.mini.cx = arg.x; app.S.mini.cy = arg.y; app.saveS(); } break;
    case 'custom': app.P.win.show(); NP.miniCustomize(); break;
    case 'main': app.P.win.show(); break;
    case 'exit': host.alive = false; clearInterval(host.poll); clearInterval(host.keep); if (app.S.mini.separate === false) app.P.win.show(); break;
  }
  pushState();
}

// ======================= mini window side =======================
let st = null, seq = 0; const queue = [];
function send(cmd, arg) { queue.push({ seq: ++seq, cmd, arg }); while (queue.length > 12) queue.shift(); writeJSON('cmd.json', { hb: Date.now(), q: queue }); }
export function companionSend(cmd, arg) { send(cmd, arg); }
const now = () => (st ? Math.min(st.dur || 0, st.time + (st.playing ? (Date.now() - st.at) / 1000 : 0)) : 0);

export async function runCompanion() {
  // the mini window has no audio and no library — it mirrors the main window and forwards button presses
  const def = (k, get) => Object.defineProperty(player, k, { get, set() {}, configurable: true });
  def('track', () => st?.track || null); def('time', now); def('duration', () => st?.dur || 0);
  def('playing', () => !!st?.playing); def('shuffle', () => !!st?.shuffle); def('repeat', () => st?.repeat || 'off');
  const opt = (fn) => { fn(); NP.updateMini(); NP.miniModes(); };
  player.toggle = () => { send('toggle'); if (st) { st.time = now(); st.at = Date.now(); opt(() => (st.playing = !st.playing)); } };
  player.play = () => { if (!st?.playing) player.toggle(); }; player.pause = () => { if (st?.playing) player.toggle(); };
  player.next = () => send('next'); player.prev = () => send('prev');
  player.seek = (sec) => { send('seek', sec); if (st) { st.time = sec; st.at = Date.now(); } };
  player.toggleShuffle = () => { send('shuffle'); if (st) opt(() => (st.shuffle = !st.shuffle)); };
  player.cycleRepeat = () => { send('repeat'); if (st) opt(() => (st.repeat = { off: 'all', all: 'one', one: 'off' }[st.repeat])); };
  player.toggleMute = () => { send('mute'); app.S.muted = !app.S.muted; NP.miniModes(); };
  player.setVolume = (v) => { v = Math.max(0, Math.min(1, v)); send('volume', v); app.S.volume = v; app.S.muted = false; NP.miniModes(); };
  lib.isLiked = () => !!st?.liked;
  lib.like = () => { send('like'); if (st) { st.liked = !st.liked; NP.updateMini(); } };
  app.saveS = () => send('mini', app.S.mini); // settings belong to the main window
  try { await N().filesystem.createDirectory(app.P.dataDir + '/ipc'); } catch {}
  setInterval(() => writeJSON('cmd.json', { hb: Date.now(), q: queue }), 1000);
  let lastRev = -1, lastTrack = null, lastBlur = null, lastTop = null, lastLayout = null;
  const tick = async () => {
    const s = await readJSON('state.json');
    if (s && s.rev !== lastRev) {
      lastRev = s.rev; st = s;
      if (s.close) { N().app.exit(); return; }
      const root = document.documentElement.style; if (s.acc) root.setProperty('--acc-rgb', s.acc); if (s.acc2) root.setProperty('--acc2-rgb', s.acc2);
      app.S.mini = s.mini; app.S.volume = s.volume; app.S.muted = s.muted;
      NP.applyMini(); NP.updateMini(lastTrack !== s.track?.id); lastTrack = s.track?.id;
      const M = s.mini;
      if (lastTop !== M.onTop) { lastTop = M.onTop; app.P.win.onTop(!!M.onTop); }
      if (lastBlur !== !!M.desktopBlur) { lastBlur = !!M.desktopBlur; app.P.fixFrame?.(lastBlur); }
      if (lastLayout !== null && lastLayout !== M.layout) { const [w, h] = NP.MINI_SIZES[M.layout]; await app.P.win.setSize(M.w?.[M.layout] || w, M.h?.[M.layout] || h); NP.keepOnScreen(); }
      lastLayout = M.layout;
    } else if (s && Date.now() - s.at > 9000) { N().app.exit(); return; } // main window is gone
  };
  setInterval(tick, 250); await tick();
  const loop = () => { NP.miniTime(); requestAnimationFrame(loop); }; requestAnimationFrame(loop);
  N().events.on('windowClose', () => { send('exit'); setTimeout(() => N().app.exit(), 150); });
}
