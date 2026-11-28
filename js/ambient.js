// Endless generated sound — nothing is downloaded, nothing repeats exactly. Each "sound" builds a small Web Audio
// graph in its own AudioContext and hands Pulse a MediaStream, so it plays through the normal player (bar, mini
// player, media keys, volume, output device) like any song, and runs forever.

const SR = 44100;
function noiseBuffer(ctx, kind, secs = 8) {
  const n = ctx.sampleRate * secs, b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch); let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w * 0.5;
      else if (kind === 'pink') { b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898; d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926; }
      else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } // brown
    }
    // crossfade the loop seam
    const f = Math.min(4000, n / 4); for (let i = 0; i < f; i++) { const k = i / f; d[n - f + i] = d[n - f + i] * (1 - k) + d[i] * k; }
  }
  return b;
}
function reverb(ctx, secs = 3.2, decay = 2.6) {
  const n = ctx.sampleRate * secs, b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay); }
  const c = ctx.createConvolver(); c.buffer = b; return c;
}
const loop = (ctx, buf, dest, gain = 1) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.loopStart = Math.random() * 2; const g = ctx.createGain(); g.gain.value = gain; s.connect(g); g.connect(dest); s.start(0, Math.random() * buf.duration); return { s, g }; };
function lfo(ctx, param, rate, depth, base) { const o = ctx.createOscillator(); o.frequency.value = rate; const g = ctx.createGain(); g.gain.value = depth; o.connect(g); g.connect(param); if (base != null) param.value = base; o.start(); return o; }
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// ---- recipes: each gets (ctx, out) and returns { stop() } ----
const R = {
  rain(ctx, out) {
    const pink = noiseBuffer(ctx, 'pink'), white = noiseBuffer(ctx, 'white', 4);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 400; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000; hp.connect(lp); lp.connect(out);
    const bed = loop(ctx, pink, hp, 0.9); lfo(ctx, bed.g.gain, 0.07, 0.12, 0.85);
    const drops = ctx.createBiquadFilter(); drops.type = 'bandpass'; drops.frequency.value = 3200; drops.Q.value = 1.4; drops.connect(out);
    const pan = ctx.createStereoPanner(); pan.connect(drops);
    let alive = true;
    const drip = () => { if (!alive) return; const t = ctx.currentTime; const s = ctx.createBufferSource(); s.buffer = white; const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.25 + Math.random() * 0.35, t + 0.004); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05 + Math.random() * 0.06); pan.pan.setValueAtTime(Math.random() * 2 - 1, t); s.connect(g); g.connect(pan); s.start(t, Math.random() * 3, 0.15); setTimeout(drip, 25 + Math.random() * 140); };
    drip(); return { stop() { alive = false; } };
  },
  storm(ctx, out) {
    const r = R.rain(ctx, out); const brown = noiseBuffer(ctx, 'brown');
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 120; lp.connect(out);
    let alive = true;
    const thunder = () => { if (!alive) return; const t = ctx.currentTime; const s = ctx.createBufferSource(); s.buffer = brown; const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1.4, t + 0.6 + Math.random()); g.gain.exponentialRampToValueAtTime(0.001, t + 6 + Math.random() * 4); s.connect(g); g.connect(lp); s.start(t, Math.random() * 3); setTimeout(thunder, 18000 + Math.random() * 30000); };
    setTimeout(thunder, 6000); return { stop() { alive = false; r.stop(); } };
  },
  ocean(ctx, out) {
    const b = noiseBuffer(ctx, 'brown'), p = noiseBuffer(ctx, 'pink');
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500; lp.connect(out);
    const surf = loop(ctx, p, lp, 0.6), body = loop(ctx, b, lp, 0.5);
    let alive = true;
    const wave = () => { if (!alive) return; const t = ctx.currentTime, len = 7 + Math.random() * 6, peak = 0.6 + Math.random() * 0.5;
      for (const g of [surf.g.gain, body.g.gain]) { g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(peak, t + len * 0.45); g.linearRampToValueAtTime(0.12, t + len); }
      lp.frequency.cancelScheduledValues(t); lp.frequency.setValueAtTime(lp.frequency.value, t); lp.frequency.linearRampToValueAtTime(1400 + Math.random() * 900, t + len * 0.5); lp.frequency.linearRampToValueAtTime(350, t + len);
      setTimeout(wave, len * 1000 - 200); };
    wave(); return { stop() { alive = false; } };
  },
  creek(ctx, out) {
    const w = noiseBuffer(ctx, 'white');
    for (let i = 0; i < 3; i++) { const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2.5; bp.connect(out); loop(ctx, w, bp, 0.35); lfo(ctx, bp.frequency, 0.3 + Math.random() * 1.4, 500, 1200 + i * 700); }
    return { stop() {} };
  },
  fire(ctx, out) {
    const b = noiseBuffer(ctx, 'brown'), w = noiseBuffer(ctx, 'white', 3);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300; lp.connect(out); const bed = loop(ctx, b, lp, 1); lfo(ctx, bed.g.gain, 0.4, 0.25, 0.9);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800; hp.connect(out);
    let alive = true;
    const crack = () => { if (!alive) return; const t = ctx.currentTime, n = Math.random() < 0.25 ? 3 : 1;
      for (let k = 0; k < n; k++) { const s = ctx.createBufferSource(); s.buffer = w; const g = ctx.createGain(); const tt = t + k * 0.03; g.gain.setValueAtTime(0.6 * Math.random() + 0.2, tt); g.gain.exponentialRampToValueAtTime(0.001, tt + 0.02 + Math.random() * 0.03); s.connect(g); g.connect(hp); s.start(tt, Math.random() * 2, 0.08); }
      setTimeout(crack, 60 + Math.random() * 600); };
    crack(); return { stop() { alive = false; } };
  },
  brown(ctx, out) { const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.connect(out); loop(ctx, noiseBuffer(ctx, 'brown'), lp, 1); return { stop() {} }; },
  pink(ctx, out) { loop(ctx, noiseBuffer(ctx, 'pink'), out, 0.8); return { stop() {} }; },
  white(ctx, out) { const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 9000; lp.connect(out); loop(ctx, noiseBuffer(ctx, 'white'), lp, 0.45); return { stop() {} }; },
  binaural(ctx, out, { beat = 10, carrier = 200 } = {}) {
    const merger = ctx.createChannelMerger(2); const g = ctx.createGain(); g.gain.value = 0.22; merger.connect(g); g.connect(out);
    for (const [ch, f] of [[0, carrier], [1, carrier + beat]]) { const o = ctx.createOscillator(); o.frequency.value = f; o.connect(merger, 0, ch); o.start(); }
    const bed = ctx.createBiquadFilter(); bed.type = 'lowpass'; bed.frequency.value = 800; bed.connect(out); loop(ctx, noiseBuffer(ctx, 'pink'), bed, 0.25);
    return { stop() {} };
  },
  // Endless lo-fi: swung drums, jazzy 7th chords on a soft keys sound, bass, vinyl crackle. Progressions and melody are chosen as it plays.
  lofi(ctx, out) {
    const bpm = 70 + Math.floor(Math.random() * 14), beat = 60 / bpm, swing = 0.12;
    const master = ctx.createGain(); master.gain.value = 0.85; const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 3600; master.connect(tone); tone.connect(out);
    const verb = reverb(ctx, 2.4, 3); const wet = ctx.createGain(); wet.gain.value = 0.22; verb.connect(wet); wet.connect(master);
    const white = noiseBuffer(ctx, 'white', 2);
    // vinyl
    const crackle = ctx.createBiquadFilter(); crackle.type = 'highpass'; crackle.frequency.value = 2500; crackle.connect(out); loop(ctx, noiseBuffer(ctx, 'pink'), crackle, 0.035);
    const hiss = noiseBuffer(ctx, 'white', 2); let alive = true;
    const pop = () => { if (!alive) return; const t = ctx.currentTime; const s = ctx.createBufferSource(); s.buffer = hiss; const g = ctx.createGain(); g.gain.setValueAtTime(0.15 * Math.random(), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.01); s.connect(g); g.connect(crackle); s.start(t, Math.random(), 0.02); setTimeout(pop, 80 + Math.random() * 500); }; pop();
    const keys = (t, midi, dur, vel = 0.12) => { const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(); o1.type = 'sine'; o2.type = 'triangle'; o1.frequency.value = mtof(midi); o2.frequency.value = mtof(midi) * 1.002; const g = ctx.createGain(); const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(2400, t); f.frequency.exponentialRampToValueAtTime(700, t + dur);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel, t + 0.015); g.gain.exponentialRampToValueAtTime(vel * 0.4, t + 0.4); g.gain.exponentialRampToValueAtTime(0.0008, t + dur + 0.6);
      o1.connect(f); o2.connect(f); f.connect(g); g.connect(master); g.connect(verb); o1.start(t); o2.start(t); o1.stop(t + dur + 0.7); o2.stop(t + dur + 0.7); };
    const bass = (t, midi, dur) => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = mtof(midi); const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.32, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + dur); o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05); };
    const kick = (t) => { const o = ctx.createOscillator(); const g = ctx.createGain(); o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12); g.gain.setValueAtTime(0.75, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35); o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.4); };
    const snare = (t) => { const s = ctx.createBufferSource(); s.buffer = white; const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.7; const g = ctx.createGain(); g.gain.setValueAtTime(0.32, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18); s.connect(f); f.connect(g); g.connect(master); g.connect(verb); s.start(t, Math.random(), 0.25); };
    const hat = (t, v = 0.07) => { const s = ctx.createBufferSource(); s.buffer = white; const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000; const g = ctx.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.04); s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random(), 0.06); };
    // chord shapes (intervals from root) and progressions in scale degrees (semitones from key)
    const M7 = [0, 4, 7, 11, 14], m7 = [0, 3, 7, 10, 14], d7 = [0, 4, 7, 10, 14], m9 = [0, 3, 7, 10, 14];
    const PROGS = [[[2, m7], [7, d7], [0, M7], [0, M7]], [[0, M7], [9, m7], [2, m7], [7, d7]], [[5, M7], [4, m7], [2, m9], [0, M7]], [[9, m7], [5, M7], [0, M7], [7, d7]], [[2, m9], [5, M7], [4, m7], [9, m7]]];
    let key = 48 + [0, 2, 3, 5, 7, 8, 10][Math.floor(Math.random() * 7)], prog = PROGS[Math.floor(Math.random() * PROGS.length)], bar = 0, step = 0;
    let next = ctx.currentTime + 0.2;
    const PENTA = [0, 2, 4, 7, 9, 12, 14, 16];
    const tick = () => {
      if (!alive) return;
      while (next < ctx.currentTime + 0.3) {
        const sw = step % 2 ? beat / 2 * swing : 0, t = next + sw;
        const [deg, shape] = prog[bar % prog.length], root = key + deg;
        if (step === 0) { shape.slice(0, 4 + (Math.random() < 0.5)).forEach((iv, k) => keys(t + k * 0.012, root + 12 + iv - (iv > 11 ? 12 : 0), beat * 3.6, 0.07)); bass(t, root - 12, beat * 1.8); }
        if (step === 5 && Math.random() < 0.6) bass(t, root - 12 + (Math.random() < 0.5 ? 7 : 12), beat * 0.9);
        if (step % 4 === 2 && Math.random() < 0.18) keys(t, key + 24 + PENTA[Math.floor(Math.random() * PENTA.length)], beat * 0.9, 0.05);
        if (step === 0 || (step === 5 && Math.random() < 0.5) || step === 10) kick(t);
        if (step === 4 || step === 12) snare(t);
        if (step % 2 === 0) hat(t, step % 4 === 0 ? 0.06 : 0.035); else if (Math.random() < 0.3) hat(t, 0.02);
        step = (step + 1) % 16; next += beat / 2 * (step % 2 ? 1 + swing : 1 - swing) ;
        if (step === 0) { bar++; if (bar % 8 === 0) { prog = PROGS[Math.floor(Math.random() * PROGS.length)]; if (Math.random() < 0.3) key = 48 + [0, 2, 3, 5, 7, 8, 10][Math.floor(Math.random() * 7)]; } }
      }
    };
    const iv = setInterval(tick, 60); tick();
    return { stop() { alive = false; clearInterval(iv); } };
  },
  // Endless ambient pads with long reverb
  pads(ctx, out) {
    const verb = reverb(ctx, 5, 2); const wet = ctx.createGain(); wet.gain.value = 0.6; verb.connect(wet); wet.connect(out);
    const dry = ctx.createGain(); dry.gain.value = 0.4; dry.connect(out); let alive = true;
    const scale = [0, 2, 4, 7, 9]; let root = 45 + Math.floor(Math.random() * 7);
    const chord = () => { if (!alive) return; const t = ctx.currentTime, len = 9 + Math.random() * 6;
      const notes = [0, 7, 12, scale[Math.floor(Math.random() * 5)] + 12, scale[Math.floor(Math.random() * 5)] + 19];
      for (const n of notes) { const o = ctx.createOscillator(); o.type = Math.random() < 0.5 ? 'sine' : 'triangle'; o.frequency.value = mtof(root + n); o.detune.value = Math.random() * 10 - 5; const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900; const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + len * 0.4); g.gain.linearRampToValueAtTime(0, t + len * 1.3); o.connect(f); f.connect(g); g.connect(dry); g.connect(verb); o.start(t); o.stop(t + len * 1.35); }
      if (Math.random() < 0.4) root = 45 + [0, 2, 5, 7][Math.floor(Math.random() * 4)];
      setTimeout(chord, len * 700); };
    chord(); return { stop() { alive = false; } };
  }
};

export const SOUNDS = [
  { id: 'lofi', name: 'Endless Lo-fi', desc: 'Chill beats that never repeat', grad: ['#7c5cff', '#ff7ab6'], icon: 'note' },
  { id: 'rain', name: 'Rain', desc: 'Steady rain on the window', grad: ['#3b82f6', '#1e293b'], icon: 'wave' },
  { id: 'storm', name: 'Thunderstorm', desc: 'Rain with distant thunder', grad: ['#475569', '#0f172a'], icon: 'wave' },
  { id: 'ocean', name: 'Ocean', desc: 'Waves rolling in', grad: ['#06b6d4', '#0e7490'], icon: 'wave' },
  { id: 'creek', name: 'Creek', desc: 'Water over stones', grad: ['#10b981', '#065f46'], icon: 'wave' },
  { id: 'fire', name: 'Fireplace', desc: 'Crackling wood fire', grad: ['#f97316', '#7c2d12'], icon: 'spark' },
  { id: 'pads', name: 'Ambient Drift', desc: 'Slow, warm, evolving pads', grad: ['#a78bfa', '#312e81'], icon: 'spark' },
  { id: 'brown', name: 'Brown Noise', desc: 'Deep, soft rumble for focus', grad: ['#a16207', '#422006'], icon: 'wave' },
  { id: 'pink', name: 'Pink Noise', desc: 'Balanced, gentle static', grad: ['#f472b6', '#831843'], icon: 'wave' },
  { id: 'white', name: 'White Noise', desc: 'Bright masking noise', grad: ['#e5e7eb', '#6b7280'], icon: 'wave' },
  { id: 'focus', name: 'Binaural · Focus', desc: '16 Hz beta — use headphones', grad: ['#22d3ee', '#4f46e5'], icon: 'headphones', recipe: 'binaural', opt: { beat: 16, carrier: 220 } },
  { id: 'relax', name: 'Binaural · Relax', desc: '10 Hz alpha — use headphones', grad: ['#34d399', '#0f766e'], icon: 'headphones', recipe: 'binaural', opt: { beat: 10, carrier: 200 } },
  { id: 'meditate', name: 'Binaural · Meditate', desc: '6 Hz theta — use headphones', grad: ['#c084fc', '#6b21a8'], icon: 'headphones', recipe: 'binaural', opt: { beat: 6, carrier: 180 } },
  { id: 'sleep', name: 'Binaural · Sleep', desc: '3 Hz delta — use headphones', grad: ['#6366f1', '#0b1026'], icon: 'headphones', recipe: 'binaural', opt: { beat: 3, carrier: 150 } }
];
const GLYPH = {
  waves: [0, 1, 2, 3].map((i) => `<path d="M40 ${110 + i * 26} q 55 -26 110 0 t 110 0"/>`).join(''),
  drops: [[80, 70], [150, 100], [215, 60], [110, 150], [190, 170], [60, 190]].map(([x, y]) => `<path d="M${x} ${y} q -14 22 0 30 q 14 -8 0 -30z"/>`).join(''),
  flame: '<path d="M150 60 q 50 60 30 110 q 30 -10 25 -45 q 35 50 0 95 q -55 40 -110 0 q -35 -45 5 -95 q 0 35 25 45 q -25 -50 25 -110z"/>',
  notes: '<path d="M110 190 v-110 l90 -20 v110"/><circle cx="96" cy="190" r="16"/><circle cx="186" cy="170" r="16"/>',
  rings: [30, 55, 80].map((r) => `<circle cx="150" cy="125" r="${r}"/>`).join(''),
  noise: Array.from({ length: 13 }, (_, i) => `<path d="M${50 + i * 16} ${125 - (8 + ((i * 37) % 41))} v ${2 * (8 + ((i * 37) % 41))}"/>`).join(''),
  orbs: '<circle cx="110" cy="115" r="40"/><circle cx="185" cy="140" r="28"/><circle cx="150" cy="70" r="14"/>'
};
const GLYPH_OF = { lofi: 'notes', rain: 'drops', storm: 'drops', ocean: 'waves', creek: 'waves', fire: 'flame', pads: 'orbs', brown: 'noise', pink: 'noise', white: 'noise', focus: 'rings', relax: 'rings', meditate: 'rings', sleep: 'rings' };
const svgCover = (s) => 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${s.grad[0]}"/><stop offset="1" stop-color="${s.grad[1]}"/></linearGradient></defs><rect width="300" height="300" fill="url(#g)"/><g fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">${GLYPH[GLYPH_OF[s.id] || 'waves']}</g><text x="24" y="272" font-family="system-ui,Segoe UI,sans-serif" font-weight="800" font-size="28" fill="#fff">${s.name.replace(/&/g, '&amp;')}</text></svg>`);

// Make a virtual track for a sound (lib.addVirtual it, then play it like a song)
export function soundTrack(s) {
  let ctx = null, inst = null, dest = null;
  return {
    id: 'v:snd:' + s.id, title: s.name, artist: s.desc, album: 'Pulse Sounds', live: true, gen: true, cover: svgCover(s),
    async stream() {
      if (!ctx) {
        ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SR, latencyHint: 'playback' });
        dest = ctx.createMediaStreamDestination(); const out = ctx.createGain(); out.gain.value = 0; out.connect(dest);
        out.gain.linearRampToValueAtTime(1, ctx.currentTime + 2.5); // gentle fade-in
        inst = R[s.recipe || s.id](ctx, out, s.opt);
      }
      return dest.stream;
    },
    suspend() { ctx?.suspend(); }, resume() { ctx?.resume(); },
    stop() { try { inst?.stop(); ctx?.close(); } catch {} ctx = null; inst = null; dest = null; }
  };
}
