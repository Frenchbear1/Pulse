// Playback engine: queue/context, shuffle, repeat, crossfade, preloading (near-gapless),
// 10-band EQ, loudness leveler, visualizer analyser, speed, sleep timer, Media Session.
import { lib } from './library.js';
import { clamp } from './util.js';

export const EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EQ_PRESETS = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 'Bass Boost': [6, 5, 4, 2, 0, 0, 0, 0, 0, 0], 'Bass Cut': [-6, -5, -3, -1, 0, 0, 0, 0, 0, 0],
  'Treble Boost': [0, 0, 0, 0, 0, 1, 2, 4, 5, 6], Vocal: [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1], Rock: [4, 3, 2, 0, -1, -1, 1, 2, 3, 4],
  Pop: [-1, 0, 2, 3, 4, 3, 1, 0, -1, -1], 'Hip-Hop': [5, 4, 2, 3, -1, -1, 1, 0, 2, 3], Electronic: [4, 3, 1, 0, -2, 1, 0, 1, 3, 4],
  Jazz: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3], Classical: [4, 3, 2, 1, -1, -1, 0, 2, 3, 4], Acoustic: [3, 3, 2, 1, 1, 1, 2, 2, 2, 1],
  'Late Night': [3, 2, 1, 0, -1, -1, 0, 0, -1, -2], Loudness: [5, 4, 1, 0, -1, 0, 0, 1, 4, 5], 'Small Speakers': [5, 4, 3, 2, 1, 0, 0, 0, 1, 1]
};

const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const player = {
  P: null, settings: null,
  els: [], active: 0, ctx: null, nodes: null, engineOn: false,
  ctxList: [], order: [], pos: -1, source: null, upNext: [], current: null,
  shuffle: false, repeat: 'off', playing: false, loading: false,
  listeners: new Set(), sleep: null, fading: false, countedPlay: false, preloaded: null,
  on(fn) { this.listeners.add(fn); },
  emit(e, d) { this.listeners.forEach((f) => f(e, d)); },
  get el() { return this.liveMode ? this.live : this.els[this.active]; },
  liveMode: false, live: null,
  get other() { return this.els[1 - this.active]; },
  get track() { return this.current ? lib.track(this.current) : null; },
  get time() { return this.el?.currentTime || 0; },
  get duration() { const d = this.el?.duration; return isFinite(d) && d > 0 ? d : (this.track?.duration || 0); },

  init(P, settings) {
    this.P = P; this.settings = settings;
    this.shuffle = !!settings.shuffle; this.repeat = settings.repeat || 'off';
    for (let i = 0; i < 2; i++) {
      const a = new Audio(); a.preload = 'auto'; a.crossOrigin = 'anonymous'; a.setAttribute('playsinline', ''); a.playsInline = true;
      a.addEventListener('timeupdate', () => i === this.active && this.onTime());
      a.addEventListener('ended', () => i === this.active && this.onEnded());
      a.addEventListener('play', () => i === this.active && this.setPlaying(true));
      a.addEventListener('pause', () => i === this.active && !this.fading && this.setPlaying(false));
      a.addEventListener('loadedmetadata', () => { if (i === this.active) { lib.setDuration(this.current, a.duration); this.emit('time'); this.updatePosition(); } });
      a.addEventListener('waiting', () => i === this.active && this.emit('buffer', true));
      a.addEventListener('playing', () => i === this.active && this.emit('buffer', false));
      a.addEventListener('error', () => { if (i === this.active && this.current) { this.emit('error', this.track); setTimeout(() => this.next(true), 600); } });
      this.els.push(a);
    }
    // radio / generated sound: a separate element outside the effects graph (streams rarely allow processing)
    const L = this.live = new Audio(); L.preload = 'none'; L.setAttribute('playsinline', '');
    L.addEventListener('play', () => this.liveMode && this.setPlaying(true));
    L.addEventListener('timeupdate', () => this.liveMode && this.emit('time'));
    L.addEventListener('pause', () => this.liveMode && this.setPlaying(false));
    L.addEventListener('waiting', () => this.liveMode && this.emit('buffer', true));
    L.addEventListener('playing', () => this.liveMode && this.emit('buffer', false));
    L.addEventListener('error', () => { if (this.liveMode && L.src) { this.emit('error', this.track); this.setPlaying(false); } });
    this.applyVolume(); this.applySpeed();
    const want = settings.engine === 'on' || (settings.engine !== 'off' && !isIOS);
    if (want) this.enableEngine();
    this.setupMediaSession();
  },

  // ---------- Web Audio engine ----------
  // ---- output device (Bluetooth, HDMI, USB…) ----
  canPickOutput() { return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype; },
  async outputs(unlock) {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    let list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput');
    if (unlock && list.length && list.every((d) => !d.label)) {
      // Browsers hide device names until audio permission is granted; ask once, then let go of the mic straight away
      try { const st = await navigator.mediaDevices.getUserMedia({ audio: true }); st.getTracks().forEach((t) => t.stop()); list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput'); } catch {}
    }
    return list.filter((d) => d.deviceId !== 'communications');
  },
  get sink() { return this.settings.sink || 'default'; },
  async setOutput(id, label) {
    id = id || 'default'; const sid = id === 'default' ? '' : id;
    if (this.engineOn && this.ctx?.setSinkId) await this.ctx.setSinkId(sid);
    else if (this.canPickOutput()) await Promise.all(this.els.map((a) => a.setSinkId(sid)));
    if (this.live?.setSinkId) await this.live.setSinkId(sid).catch(() => {});
    else throw new Error('unsupported');
    this.settings.sink = id; this.settings.sinkLabel = label || ''; this.save?.(); this.emit('output');
  },
  async restoreOutput() {
    const id = this.settings.sink; if (!id || id === 'default') return;
    const list = await this.outputs(false).catch(() => []);
    if (list.some((d) => d.deviceId === id)) await this.setOutput(id, this.settings.sinkLabel).catch(() => {});
    else this.emit('output-lost');
  },
  enableEngine() {
    if (this.engineOn) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext; const ctx = new AC({ latencyHint: 'playback' });
      const pre = ctx.createGain();
      const eq = EQ_FREQS.map((f, i) => { const b = ctx.createBiquadFilter(); b.type = i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking'; b.frequency.value = f; b.Q.value = 1.1; return b; });
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -20; comp.knee.value = 12; comp.ratio.value = 3.5; comp.attack.value = 0.01; comp.release.value = 0.3;
      const bypassComp = ctx.createGain(); const compIn = ctx.createGain(); const master = ctx.createGain();
      const analyser = ctx.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.78;
      const gains = this.els.map((a) => { const s = ctx.createMediaElementSource(a); const g = ctx.createGain(); s.connect(g); g.connect(pre); return g; });
      let n = pre; for (const b of eq) { n.connect(b); n = b; }
      n.connect(compIn); compIn.connect(comp); comp.connect(master); n.connect(bypassComp); bypassComp.connect(master);
      master.connect(analyser); analyser.connect(ctx.destination);
      this.ctx = ctx; this.nodes = { pre, eq, comp, compIn, bypassComp, master, analyser, gains };
      this.engineOn = true;
      this.els.forEach((a) => (a.volume = 1));
      gains[1 - this.active].gain.value = 0;
      this.applyEQ(); this.applyLeveler(); this.applyVolume();
      if (this.settings.sink && this.settings.sink !== 'default' && ctx.setSinkId) ctx.setSinkId(this.settings.sink).catch(() => {});
      const resume = () => ctx.state !== 'running' && ctx.resume();
      document.addEventListener('pointerdown', resume, { capture: true }); document.addEventListener('keydown', resume, { capture: true });
    } catch (e) { console.warn('audio engine unavailable', e); }
  },
  applyEQ() {
    if (!this.nodes) return;
    const s = this.settings; const on = s.eqOn;
    this.nodes.eq.forEach((b, i) => b.gain.setTargetAtTime(on ? (s.eq?.[i] || 0) : 0, this.ctx.currentTime, 0.05));
    const pre = on ? (s.preamp || 0) : 0;
    this.nodes.pre.gain.setTargetAtTime(Math.pow(10, pre / 20), this.ctx.currentTime, 0.05);
  },
  applyLeveler() { if (!this.nodes) return; const on = !!this.settings.leveler; this.nodes.compIn.gain.value = on ? 1 : 0; this.nodes.bypassComp.gain.value = on ? 0 : 1; },
  applyVolume() {
    const v = this.settings.muted ? 0 : Math.pow(clamp(this.settings.volume ?? 0.8, 0, 1), 1.6);
    if (this.engineOn) this.nodes.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03);
    else this.els.forEach((a) => (a.volume = v));
    if (this.live) this.live.volume = v;
    this.emit('volume');
  },
  applySpeed() { for (const a of this.els) { a.playbackRate = this.settings.speed || 1; a.preservesPitch = a.webkitPreservesPitch = this.settings.keepPitch !== false; } },
  setVolume(v) { this.settings.volume = clamp(v, 0, 1); this.settings.muted = false; this.applyVolume(); this.saveSettings(); },
  toggleMute() { this.settings.muted = !this.settings.muted; this.applyVolume(); this.saveSettings(); },
  saveSettings() { this.emit('settings'); },

  // ---------- queue / context ----------
  playList(ids, startIndex = 0, source = null, opts = {}) {
    ids = ids.filter((i) => lib.track(i)); if (!ids.length) return;
    this.ctxList = ids.slice(); this.source = source;
    if (opts.shuffle != null) { this.shuffle = opts.shuffle; this.settings.shuffle = this.shuffle; }
    if (this.shuffle && opts.randomStart && startIndex === 0) startIndex = Math.floor(Math.random() * ids.length);
    this.buildOrder(startIndex);
    this.pos = this.shuffle ? 0 : startIndex;
    this.load(this.ctxList[this.order[this.pos]], true);
    this.emit('queue'); this.emit('mode');
  },
  buildOrder(startIdx) {
    const n = this.ctxList.length; const o = Array.from({ length: n }, (_, i) => i);
    if (this.shuffle) {
      o.splice(startIdx, 1);
      for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; }
      // soften: avoid the same artist back-to-back when possible
      for (let i = 1; i < o.length; i++) { const a = lib.track(this.ctxList[o[i - 1]])?.artist, b = lib.track(this.ctxList[o[i]])?.artist; if (a && a === b) { const k = o.findIndex((x, j) => j > i && lib.track(this.ctxList[x])?.artist !== a); if (k > 0) [o[i], o[k]] = [o[k], o[i]]; } }
      o.unshift(startIdx);
    } else { /* natural */ }
    this.order = o;
    if (!this.shuffle) this.pos = startIdx;
  },
  toggleShuffle() {
    this.shuffle = !this.shuffle; this.settings.shuffle = this.shuffle;
    if (this.ctxList.length) {
      const curIdx = this.order[this.pos] ?? 0;
      this.buildOrder(curIdx); this.pos = this.shuffle ? 0 : curIdx;
    }
    this.preloaded = null; this.emit('mode'); this.emit('queue'); this.saveSettings();
  },
  cycleRepeat() { this.repeat = { off: 'all', all: 'one', one: 'off' }[this.repeat]; this.settings.repeat = this.repeat; this.preloaded = null; this.emit('mode'); this.saveSettings(); },
  playNext(ids) { this.upNext.unshift(...ids); this.preloaded = null; this.emit('queue'); },
  addToQueue(ids) { this.upNext.push(...ids); this.preloaded = null; this.emit('queue'); },
  removeUpNext(i) { this.upNext.splice(i, 1); this.preloaded = null; this.emit('queue'); },
  clearUpNext() { this.upNext = []; this.preloaded = null; this.emit('queue'); },
  moveUpNext(from, to) { const [x] = this.upNext.splice(from, 1); this.upNext.splice(to, 0, x); this.preloaded = null; this.emit('queue'); },
  upcomingContext(max = 80) { const out = []; for (let p = this.pos + 1; p < this.order.length && out.length < max; p++) out.push({ id: this.ctxList[this.order[p]], p }); if (this.repeat === 'all') for (let p = 0; p <= this.pos && out.length < max; p++) out.push({ id: this.ctxList[this.order[p]], p }); return out; },
  jumpTo(p) { this.pos = p; this.load(this.ctxList[this.order[p]], true); this.emit('queue'); },
  peekNext() {
    if (this.repeat === 'one') return this.current;
    if (this.upNext.length) return this.upNext[0];
    if (this.pos + 1 < this.order.length) return this.ctxList[this.order[this.pos + 1]];
    if (this.repeat === 'all' && this.order.length) return this.ctxList[this.order[0]];
    return null;
  },
  advance(manual) { // move pointers and return next id
    if (this.repeat === 'one' && !manual) return this.current;
    if (this.upNext.length) { return this.upNext.shift(); }
    if (this.pos + 1 < this.order.length) { this.pos++; return this.ctxList[this.order[this.pos]]; }
    if (this.repeat === 'all' || (manual && this.order.length)) {
      if (this.shuffle && this.repeat === 'all') { this.buildOrder(this.order[0]); }
      this.pos = 0; return this.ctxList[this.order[0]];
    }
    return null;
  },
  next(manual = true) {
    const id = this.advance(manual);
    if (!id) { this.pause(); this.el.currentTime = 0; this.emit('ended'); return; }
    this.load(id, true); this.emit('queue');
  },
  prev() {
    if (this.time > 3 || this.pos <= 0 && !this.upNext.length && this.repeat !== 'all') { this.seek(0); return; }
    if (this.pos > 0) this.pos--; else if (this.repeat === 'all') this.pos = this.order.length - 1;
    this.load(this.ctxList[this.order[this.pos]], true); this.emit('queue');
  },

  async load(id, autoplay, startAt = 0) {
    const t = lib.track(id); if (!t) return;
    this.cancelFade();
    if (t.live) return this.loadLive(t, autoplay);
    if (this.liveMode) { lib.track(this.current)?.stop?.(); this.live.pause(); this.live.srcObject = null; this.live.removeAttribute('src'); this.liveMode = false; }
    this.current = id; this.countedPlay = false; this.loading = true;
    this.emit('track', t);
    let url, el = this.el;
    if (this.preloaded?.id === id && this.preloaded.el === this.other) {
      // swap to preloaded element: instant start
      this.el.pause(); this.active = 1 - this.active; el = this.el;
      if (this.engineOn) { this.nodes.gains[this.active].gain.value = 1; this.nodes.gains[1 - this.active].gain.value = 0; }
      this.preloaded = null;
    } else {
      url = await this.P.audioURL(t);
      if (this.current !== id) return;
      if (!url) { this.emit('error', t); return; }
      el.src = url;
      if (this.engineOn) { this.nodes.gains[this.active].gain.value = 1; this.nodes.gains[1 - this.active].gain.value = 0; }
    }
    this.applySpeed();
    if (startAt) { const set = () => { try { el.currentTime = startAt; } catch {} }; if (el.readyState >= 1) set(); else el.addEventListener('loadedmetadata', set, { once: true }); }
    this.loading = false;
    if (autoplay) this.play(); else this.emit('time');
    this.updateMediaSession();
    this.preloaded = null;
  },
  async loadLive(t, autoplay) {
    const prev = lib.track(this.current); if (prev?.live && prev !== t) prev.stop?.();
    this.els.forEach((a) => a.pause());
    this.liveMode = true; this.current = t.id; this.countedPlay = true; this.emit('track', t);
    const L = this.live; L.srcObject = null; L.removeAttribute('src');
    if (t.stream) L.srcObject = await t.stream(); else L.src = t.url;
    this.applyVolume(); this.updateMediaSession();
    if (autoplay) this.play(); else this.emit('time');
  },
  async play() {
    if (!this.current) { const all = Object.keys(lib.db.tracks); if (all.length) this.playList(all, 0, { type: 'songs', label: 'All songs' }, { randomStart: true }); return; }
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume();
    if (this.liveMode) { const t = this.track; t?.resume?.(); try { await this.live.play(); } catch (e) { if (e.name !== 'AbortError') console.warn(e); this.setPlaying(false); } return; }
    try {
      if (this.engineOn && this.settings.fadePause !== false) { const g = this.nodes.gains[this.active].gain; g.cancelScheduledValues(this.ctx.currentTime); g.setValueAtTime(0.0001, this.ctx.currentTime); g.exponentialRampToValueAtTime(1, this.ctx.currentTime + 0.18); }
      await this.el.play();
    } catch (e) { if (e.name !== 'AbortError') console.warn(e); this.setPlaying(false); }
  },
  pause() {
    if (this.liveMode) { this.live.pause(); this.track?.suspend?.(); return; }
    if (this.engineOn && this.settings.fadePause !== false && !this.el.paused) {
      const g = this.nodes.gains[this.active].gain; const el = this.el;
      g.cancelScheduledValues(this.ctx.currentTime); g.setValueAtTime(g.value || 1, this.ctx.currentTime); g.linearRampToValueAtTime(0.0001, this.ctx.currentTime + 0.16);
      this.setPlaying(false); setTimeout(() => { if (!this.playing) el.pause(); }, 170);
    } else this.el.pause();
  },
  toggle() { this.playing ? this.pause() : this.play(); },
  seek(t) { if (this.liveMode) return; const d = this.duration; if (!d && !t) { this.el.currentTime = 0; return; } this.el.currentTime = clamp(t, 0, Math.max(0, d - 0.25)); this.emit('time'); this.updatePosition(); },
  seekBy(dt) { this.seek(this.time + dt); },
  setPlaying(v) { if (this.playing === v) return; this.playing = v; this.emit('state', v); if ('mediaSession' in navigator) navigator.mediaSession.playbackState = v ? 'playing' : 'paused'; },

  onTime() {
    const t = this.time, d = this.duration;
    if (!this.countedPlay && this.current && (t > 30 || (d && t > d * 0.5))) { this.countedPlay = true; lib.played(this.current); this.emit('played'); }
    this.emit('time');
    if (!d) return;
    const remain = d - t;
    const xf = this.engineOn ? (this.settings.crossfade || 0) : 0;
    // preload the next track ~12s before the end for instant/gapless transitions
    if (remain < Math.max(12, xf + 4) && !this.preloaded && !this.fading && this.repeat !== 'one') this.preload();
    if (xf > 0 && remain <= xf && !this.fading && this.preloaded?.ready && this.playing) this.startCrossfade(xf, remain);
    // sleep timer
    if (this.sleep?.mode === 'track' && remain < 0.6) { this.sleepFire(); }
  },
  async preload() {
    const id = this.peekNext(); if (!id || id === this.current) return;
    const t = lib.track(id); const other = this.other;
    this.preloaded = { id, el: other, ready: false };
    const url = await this.P.audioURL(t);
    if (!url) { this.preloaded = { id: null }; return; }
    if (this.preloaded?.id !== id) return;
    other.src = url; other.load(); other.playbackRate = this.settings.speed || 1;
    other.addEventListener('canplay', () => { if (this.preloaded?.id === id) this.preloaded.ready = true; }, { once: true });
  },
  startCrossfade(xf, remain) {
    const id = this.advance(false); if (!id) return;
    this.fading = true;
    const from = this.active, to = 1 - this.active; const now = this.ctx.currentTime; const dur = Math.max(0.5, Math.min(xf, remain));
    const gF = this.nodes.gains[from].gain, gT = this.nodes.gains[to].gain;
    gT.cancelScheduledValues(now); gT.setValueAtTime(0.0001, now); gT.exponentialRampToValueAtTime(1, now + dur);
    gF.cancelScheduledValues(now); gF.setValueAtTime(gF.value || 1, now); gF.linearRampToValueAtTime(0.0001, now + dur);
    const elFrom = this.els[from]; this.els[to].play().catch(() => {});
    this.active = to; this.current = id; this.countedPlay = false; this.preloaded = null;
    this.emit('track', this.track); this.emit('queue'); this.updateMediaSession();
    this._fadeT = setTimeout(() => { elFrom.pause(); this.fading = false; }, dur * 1000 + 80);
  },
  cancelFade() { if (this.fading) { clearTimeout(this._fadeT); this.other.pause(); this.fading = false; } },
  onEnded() {
    if (this.sleep?.mode === 'track') { this.sleepFire(); return; }
    if (this.repeat === 'one') { this.seek(0); this.play(); return; }
    this.next(false);
  },

  // ---------- sleep timer ----------
  setSleep(mins) {
    clearInterval(this.sleep?.iv);
    if (mins === null) { this.sleep = null; this.emit('sleep'); return; }
    if (mins === 'track') { this.sleep = { mode: 'track' }; this.emit('sleep'); return; }
    const end = Date.now() + mins * 60000;
    this.sleep = { mode: 'time', end, iv: setInterval(() => { const left = end - Date.now(); if (left <= 0) this.sleepFire(); else if (left < 15000 && this.engineOn) this.nodes.master.gain.setTargetAtTime(Math.pow(this.settings.volume, 1.6) * left / 15000, this.ctx.currentTime, 0.2); this.emit('sleep'); }, 1000) };
    this.emit('sleep');
  },
  sleepFire() { clearInterval(this.sleep?.iv); this.sleep = null; this.el.pause(); this.setPlaying(false); setTimeout(() => this.applyVolume(), 400); this.emit('sleep'); this.emit('sleepDone'); },

  // ---------- Media Session (lock screen, media keys, Windows overlay) ----------
  setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession; const H = (a, f) => { try { ms.setActionHandler(a, f); } catch {} };
    H('play', () => this.play()); H('pause', () => this.pause()); H('stop', () => this.pause());
    H('previoustrack', () => this.prev()); H('nexttrack', () => this.next());
    H('seekbackward', (d) => this.seekBy(-(d.seekOffset || 10))); H('seekforward', (d) => this.seekBy(d.seekOffset || 10));
    H('seekto', (d) => this.seek(d.seekTime));
  },
  async updateMediaSession() {
    if (!('mediaSession' in navigator)) return; const t = this.track; if (!t) return;
    const art = t.cover ? await this.P.coverURL(t.cover, false) : null;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist || 'Unknown Artist', album: t.album || '', artwork: art ? [{ src: art, sizes: '640x640', type: 'image/jpeg' }] : [] });
    } catch {}
  },
  updatePosition() {
    try { const d = this.duration; if (d && 'setPositionState' in navigator.mediaSession) navigator.mediaSession.setPositionState({ duration: d, position: clamp(this.time, 0, d), playbackRate: this.el.playbackRate || 1 }); } catch {}
  },

  // ---------- session persistence ----------
  snapshot() {
    return { ctxList: this.ctxList, order: this.order, pos: this.pos, upNext: this.upNext, current: this.current, time: this.time, source: this.source };
  },
  restore(s) {
    if (!s || !s.current || !lib.track(s.current)) return;
    this.ctxList = (s.ctxList || []).filter((i) => lib.track(i));
    this.order = (s.order || []).filter((i) => i < this.ctxList.length);
    if (this.order.length !== this.ctxList.length) { this.order = this.ctxList.map((_, i) => i); }
    this.pos = clamp(s.pos || 0, 0, Math.max(0, this.order.length - 1));
    this.upNext = (s.upNext || []).filter((i) => lib.track(i)); this.source = s.source;
    this.load(s.current, false, s.time || 0); this.emit('queue');
  },
  analyser() { return this.nodes?.analyser || null; }
};
