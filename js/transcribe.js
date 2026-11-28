// "Transcribe lyrics" — when no lyrics exist anywhere, listen to the song with Whisper (on-device AI) and build
// time-synced lines. Singing over music is harder than speech, so results are a best effort; they can be edited.
import { app, lib } from './core.js';

let worker = null;
const fmt = (s) => { const m = Math.floor(s / 60), x = s - m * 60; return `[${String(m).padStart(2, '0')}:${x.toFixed(2).padStart(5, '0')}]`; };
async function decode16k(t) {
  const url = await app.P.audioURL(t); const buf = await (await fetch(url)).arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)(); const a = await ctx.decodeAudioData(buf); ctx.close();
  const off = new OfflineAudioContext(1, Math.ceil(a.duration * 16000), 16000);
  const src = off.createBufferSource(); src.buffer = a; src.connect(off.destination); src.start();
  return (await off.startRendering()).getChannelData(0);
}
export async function transcribeLyrics(t, onStatus) {
  if (!t || t.virtual) return null;
  onStatus?.('Reading the song…', 0);
  const audio = await decode16k(t);
  worker ||= new Worker(new URL('./transcribe-worker.js', import.meta.url), { type: 'module' });
  const res = await new Promise((resolve, reject) => {
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'download') onStatus?.('Downloading the AI model (one time, ~75 MB)…', m.pct);
      else if (m.type === 'listening') onStatus?.('Listening to the song…', 0);
      else if (m.type === 'progress') onStatus?.('Listening to the song…', m.pct);
      else if (m.type === 'done') resolve(m); else if (m.type === 'error') reject(new Error(m.message));
    };
    worker.postMessage({ audio }, [audio.buffer]);
  });
  // Whisper hallucinates on instrumentals ("Thank you.", "[Music]"): drop those
  const lines = (res.chunks || []).map((c) => ({ t: c.timestamp?.[0] ?? 0, txt: (c.text || '').trim() }))
    .filter((l) => l.txt && !/^[\[\(♪].*[\]\)♪]?$/.test(l.txt) && !/^(thank you\.?|thanks for watching!?|you)$/i.test(l.txt));
  if (lines.length < 2) return null;
  const lrc = lines.map((l) => fmt(l.t) + l.txt).join('\n');
  lib.db.lyrics[t.id] = lrc; (lib.db.lyricSrc ||= {})[t.id] = 'ai'; delete lib.db.noLyrics?.[t.id]; t.hasLyrics = true; lib.save();
  return lrc;
}
