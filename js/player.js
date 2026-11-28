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
      a.addEventListener('pause', () => i === this.active && !this.fading && !this._inGap && this.setPlaying(false));
      a.addEventListener('loadedmetadata', () => { if (i === this.active) { lib.setDuration(this.current, a.duration); this.emit('time'); this.updatePosition(); } });
      a.addEventListener('waiting', () => i === this.active && this.emit('buffer', true));
      a.addEventListener('playing', () => { if (i === this.active) { this._errRun = 0; this.emit('buffer', false); } });
      a.addEventListener('error', () => {
        if (i !== this.active) { if (this.preloaded?.el === a) this.preloaded = null; return; } // a broken preload: just forget it
        if (!this.current || !a.getAttribute('src')) return;
        this.emit('error', this.track);
        // skip to the next song, but stop if many in a row fail (moved/deleted folder) instead of spinning forever
        this._errRun = (this._errRun || 0) + 1;
        if (this._errRun >= Math.min(8, Math.max(2, this.ctxList.length))) { this._errRun = 0; this.setPlaying(false); this.emit('errorstop'); return; }
        clearTimeout(this._errT); this._errT = setTimeout(() => this.next(true), 600);
      });
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
    else throw new Error('unsupported');
    if (this.live?.setSinkId) await this.live.setSinkId(sid).catch(() => {});
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
      // smart shuffle: songs you keep skipping drift toward the back, liked / loved ones toward the front
      if (this.settings.smartShuffle !== false && o.length > 8) {
        const w = (x) => { const id = this.ctxList[x]; const sk = lib.db.skips?.[id] || 0, pl = lib.db.plays?.[id] || 0; return Math.min(3, sk * 0.6) - Math.min(0.8, pl * 0.04) - (lib.db.liked?.[id] ? 0.6 : 0); };
        const keyed = o.map((x, i) => [i / o.length * 4 + w(x) + Math.random() * 1.5, x]); keyed.sort((a, b) => a[0] - b[0]); o.splice(0, o.length, ...keyed.map((k) => k[1]));
      }
      const art = (x) => lib.track(this.ctxList[x])?.artist;
      for (let i = 1; i < o.length; i++) { const a = art(o[i - 1]); if (a && a === art(o[i])) { for (let k = i + 1; k < Math.min(o.length, i + 60); k++) if (art(o[k]) !== a) { [o[i], o[k]] = [o[k], o[i]]; break; } } }
      o.unshift(startIdx);
    } else { /* natural */ }
    this.order = o;
    if (!this.shuffle) this.pos = startIdx;
  },
  toggleShuffle() {
    this.shuffle = !this.shuffle; this.settings.shuffle = this.shuffle;
    if (this.ctxList.length) {
      const curIdx = this.order[this.pos] ?? 0;
      const heard = this.shuffle ? this.order.slice(0, Math.max(0, this.pos)) : [];
      this.buildOrder(curIdx); this.pos = this.shuffle ? 0 : curIdx;
      // keep what you've already heard behind you, so Previous still walks back through it
      if (this.shuffle && heard.length) { const hs = new Set(heard); this.order = [...heard, ...this.order.filter((x) => !hs.has(x))]; this.pos = heard.length; }
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
    // a skip early in a song teaches smart shuffle what you're not in the mood for
    if (manual && this.current && !this.liveMode && !this.countedPlay && this.time > 1 && this.time < 30) lib.skipped?.(this.current);
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
    if (this.loop && this.current !== id) this.clearLoop(true);
    this.current = id; this.countedPlay = false; this.loading = true;
    this.emit('track', t);
    let url, el = this.el;
    if (this.preloaded?.id === id && this.preloaded.el === this.other && !this.other.error && this.other.getAttribute('src')) {
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
    const rp = lib.db.resume?.[id]; if (!startAt && rp && this.settings.resumeLong !== false) startAt = rp;
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
    this._pauseTok = (this._pauseTok || 0) + 1; // cancels a pending fade-out pause
    if (this._inGap) { clearTimeout(this._gapT); this._inGap = false; }
    if (!this.current) { const all = Object.keys(lib.db.tracks); if (all.length) this.playList(all, 0, { type: 'songs', label: 'All songs' }, { randomStart: true }); return; }
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume();
    if (this.liveMode) { const t = this.track; t?.resume?.(); try { await this.live.play(); } catch (e) { if (e.name !== 'AbortError') console.warn(e); this.setPlaying(false); } return; }
    try {
      if (this.engineOn && this.settings.fadePause !== false) { const g = this.nodes.gains[this.active].gain; g.cancelScheduledValues(this.ctx.currentTime); g.setValueAtTime(0.0001, this.ctx.currentTime); g.exponentialRampToValueAtTime(1, this.ctx.currentTime + 0.18); }
      await this.el.play();
      if (!this.el.paused) this.setPlaying(true); // no 'play' event fires if the element never actually stopped
    } catch (e) { if (e.name !== 'AbortError') console.warn(e); this.setPlaying(false); }
  },
  pause() {
    if (this._inGap) { clearTimeout(this._gapT); this._inGap = false; this.setPlaying(false); return; }
    if (this.liveMode) { this.live.pause(); this.track?.suspend?.(); return; }
    if (this.engineOn && this.settings.fadePause !== false && !this.el.paused) {
      const g = this.nodes.gains[this.active].gain; const el = this.el;
      g.cancelScheduledValues(this.ctx.currentTime); g.setValueAtTime(g.value || 1, this.ctx.currentTime); g.linearRampToValueAtTime(0.0001, this.ctx.currentTime + 0.16);
      const tok = this._pauseTok = (this._pauseTok || 0) + 1;
      this.setPlaying(false); setTimeout(() => { if (tok === this._pauseTok && !this.playing) el.pause(); }, 170);
    } else this.el.pause();
  },
  toggle() { this.playing ? this.pause() : this.play(); },
  seek(t) { if (this.liveMode) return; const d = this.duration; if (!d && !t) { this.el.currentTime = 0; return; } this.el.currentTime = clamp(t, 0, Math.max(0, d - 0.25)); this.emit('time'); this.updatePosition(); },
  seekBy(dt) { this.seek(this.time + dt); },
  setPlaying(v) { if (this.playing === v) return; this.playing = v; this.emit('state', v); if ('mediaSession' in navigator) navigator.mediaSession.playbackState = v ? 'playing' : 'paused'; },

  onTime() {
    const t = this.time, d = this.duration;
    // listening stats: count real seconds heard (not seeks)
    const now = performance.now(); if (this._lid && this._lid !== this.current && this._acc) { lib.listened?.(this._lid, this._acc); this._acc = 0; }
    if (this.playing && this._lt && this._lid === this.current) { const dt = (now - this._lt) / 1000 * (this.el.playbackRate || 1); if (dt > 0 && dt < 3) this._acc = (this._acc || 0) + dt; }
    this._lt = now; this._lid = this.current; if (this._acc >= 10) { lib.listened?.(this.current, this._acc); this._acc = 0; }
    if (this.loop && this.loop.b > this.loop.a && t >= this.loop.b) { this.loopHit(); return; }
    if (!this.countedPlay && this.current && (t > 30 || (d && t > d * 0.5))) { this.countedPlay = true; lib.played(this.current); this.emit('played'); }
    this.emit('time');
    // long recordings (20 min+): remember where you were, so they pick up there next time
    if (d > 1200 && this.settings.resumeLong !== false && lib.db.tracks[this.current] && (!this._rpT || now - this._rpT > 30000)) {
      this._rpT = now; const rs = lib.db.resume ||= {};
      if (t > 30 && t < d - 60) rs[this.current] = Math.floor(t); else delete rs[this.current];
      lib.save();
    }
    if (!d || this.loop) return; // while practicing a loop, never preload/crossfade away
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
    if (this.loop) { this.loopHit(); return; }
    if (this.repeat === 'one') { this.seek(0); this.play(); return; }
    this.next(false);
  },

  // ---------- practice: A–B loop, speed trainer, pause between repeats ----------
  // loop = { a, b, hits, gap (s), trainer: { to, step, every } | null }
  loop: null,
  setLoopPoint(which, t = this.time) {
    if (this.liveMode || !this.current) return;
    const d = this.duration; t = clamp(t, 0, d || t);
    const L = this.loop || { a: 0, b: d || 0, hits: 0, gap: this.settings.loopGap || 0, trainer: null };
    if (which === 'a') { L.a = t; if (L.b <= t + 0.3) L.b = Math.min(d || t + 5, t + 5); }
    else { L.b = t; if (L.a >= t - 0.3) L.a = Math.max(0, t - 5); }
    this.loop = L; this.startLoopWatch(); this.emit('loop');
  },
  setLoop(a, b, opts = {}) {
    if (this.liveMode || !this.current) return; const d = this.duration;
    a = clamp(a, 0, d); b = clamp(b, 0, d); if (b - a < 0.3) return this.clearLoop();
    this.loop = Object.assign({ a, b, hits: 0, gap: this.settings.loopGap || 0, trainer: null }, this.loop && { gap: this.loop.gap, trainer: this.loop.trainer }, opts, { a, b });
    if (this.time < a || this.time > b) this.seek(a);
    this.startLoopWatch(); this.emit('loop');
  },
  clearLoop(quiet) { this.loop = null; clearInterval(this._loopIv); clearTimeout(this._gapT); this._loopIv = null; if (!quiet) this.emit('loop'); },
  // timeupdate only fires ~4×/s; check the loop end more often so repeats land on the beat
  startLoopWatch() { if (this._loopIv) return; this._loopIv = setInterval(() => { const L = this.loop; if (!L) return this.clearLoop(true); if (this.playing && !this.el.paused && this.el.currentTime >= L.b - 0.02) this.loopHit(); }, 25); },
  loopHit() {
    const L = this.loop; if (!L || this._inGap) return;
    L.hits++;
    const tr = L.trainer;
    if (tr && L.hits % (tr.every || 1) === 0) {
      const cur = this.settings.speed || 1; const nx = Math.round(Math.min(tr.to, cur + tr.step) * 100) / 100;
      if (nx !== cur) { this.settings.speed = nx; this.applySpeed(); this.saveSettings(); this.emit('speed', nx); }
    }
    this.el.currentTime = L.a; this.emit('loop'); this.emit('time');
    if (L.gap > 0) { this._inGap = true; this.el.pause(); this._gapT = setTimeout(() => { this._inGap = false; if (this.loop) this.el.play().catch(() => {}); }, L.gap * 1000); }
    else if (this.el.paused) this.el.play().catch(() => {});
  },
  // bookmarks inside a song (practice spots, favourite parts)
  marks(id = this.current) { return (lib.db.marks?.[id] || []).slice().sort((a, b) => a.t - b.t); },
  addMark(label, t = this.time) { const id = this.current; if (!id || this.liveMode || !lib.db.tracks[id]) return; const m = lib.db.marks ||= {}; (m[id] ||= []).push({ t: Math.round(t * 10) / 10, label: label || '' }); lib.save(); this.emit('marks'); },
  removeMark(i, id = this.current) { const list = lib.db.marks?.[id]; if (!list) return; const sorted = this.marks(id); const m = sorted[i]; list.splice(list.indexOf(m), 1); if (!list.length) delete lib.db.marks[id]; lib.save(); this.emit('marks'); },

  // ---------- sleep timer ----------
  setSleep(mins) {
    const wasFading = this.sleep?.faded; clearInterval(this.sleep?.iv);
    if (wasFading) this.applyVolume();
    if (mins === null) { this.sleep = null; this.emit('sleep'); return; }
    if (mins === 'track') { this.sleep = { mode: 'track' }; this.emit('sleep'); return; }
    const end = Date.now() + mins * 60000;
    const sl = this.sleep = { mode: 'time', end, iv: setInterval(() => {
      const left = end - Date.now(); if (left <= 0) { this.sleepFire(); return; }
      if (left < 15000 && this.playing && !this.settings.muted) { // gentle fade over the last 15 s
        sl.faded = true; const v = Math.pow(clamp(this.settings.volume ?? 0.8, 0, 1), 1.6) * left / 15000;
        if (this.engineOn) this.nodes.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.2); else this.els.forEach((a) => (a.volume = v));
        if (this.live) this.live.volume = v;
      }
      this.emit('sleep');
    }, 1000) };
    this.emit('sleep');
  },
  sleepFire() { clearInterval(this.sleep?.iv); this.sleep = null; this.cancelFade(); this.el.pause(); this.track?.suspend?.(); this.setPlaying(false); setTimeout(() => this.applyVolume(), 400); this.emit('sleep'); this.emit('sleepDone'); },

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
    const oldList = s.ctxList || []; const keep = oldList.map((i) => !!lib.track(i));
    const remap = []; let n = 0; keep.forEach((k, i) => { remap[i] = k ? n++ : -1; });
    this.ctxList = oldList.filter((_, i) => keep[i]);
    const oldOrder = (s.order || []).filter((i) => i >= 0 && i < oldList.length);
    this.order = oldOrder.map((i) => remap[i]).filter((i) => i >= 0);
    if (this.order.length !== this.ctxList.length) this.order = this.ctxList.map((_, i) => i);
    const curIdx = this.ctxList.indexOf(s.current); const at = this.order.indexOf(curIdx);
    this.pos = at >= 0 ? at : clamp(s.pos || 0, 0, Math.max(0, this.order.length - 1));
    this.upNext = (s.upNext || []).filter((i) => lib.track(i)); this.source = s.source;
    this.load(s.current, false, s.time || 0); this.emit('queue');
  },
  analyser() { return this.nodes?.analyser || null; }
};
