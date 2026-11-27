// Pulse — fast, dependency-free audio tag reader.
// Reads only the bytes it needs (header / atoms / tail) so huge libraries scan quickly.
// Supports: MP3 (ID3v2.2/2.3/2.4 + ID3v1 + Xing/VBRI/CBR duration), FLAC, M4A/MP4/ALAC/AAC,
// OGG Vorbis / Opus, WAV (RIFF INFO + id3 chunk).
// reader = { size:number, read(pos, len) => Promise<Uint8Array> }

const td = (enc) => { try { return new TextDecoder(enc); } catch { return new TextDecoder('utf-8'); } };
const UTF8 = td('utf-8'), LATIN1 = td('latin1'), UTF16 = td('utf-16le'), UTF16BE = td('utf-16be');

const str = (b, s, l) => { let o = ''; for (let i = s; i < s + l && i < b.length; i++) o += String.fromCharCode(b[i]); return o; };
const u32 = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const u16 = (b, o) => (b[o] << 8) | b[o + 1];
const u32le = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const u24 = (b, o) => (b[o] << 16) | (b[o + 1] << 8) | b[o + 2];
const syncsafe = (b, o) => (b[o] & 0x7f) << 21 | (b[o + 1] & 0x7f) << 14 | (b[o + 2] & 0x7f) << 7 | (b[o + 3] & 0x7f);
const clean = (s) => (s || '').replace(/\u0000+$/g, '').replace(/^﻿/, '').trim();

function decodeText(enc, b) {
  if (!b.length) return '';
  switch (enc) {
    case 0: return clean(LATIN1.decode(b));
    case 1: { // UTF-16 with BOM
      if (b[0] === 0xfe && b[1] === 0xff) return clean(UTF16BE.decode(b.subarray(2)));
      if (b[0] === 0xff && b[1] === 0xfe) return clean(UTF16.decode(b.subarray(2)));
      return clean(UTF16.decode(b));
    }
    case 2: return clean(UTF16BE.decode(b));
    default: return clean(UTF8.decode(b));
  }
}
// find terminator for an encoding, returns index of terminator start
function findTerm(b, start, enc) {
  if (enc === 1 || enc === 2) {
    for (let i = start; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i;
    return b.length;
  }
  for (let i = start; i < b.length; i++) if (b[i] === 0) return i;
  return b.length;
}
const termLen = (enc) => (enc === 1 || enc === 2 ? 2 : 1);

function mimeFromBytes(b) {
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57) return 'image/webp';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  return 'image/jpeg';
}

const GENRES = ['Blues','Classic Rock','Country','Dance','Disco','Funk','Grunge','Hip-Hop','Jazz','Metal','New Age','Oldies','Other','Pop','R&B','Rap','Reggae','Rock','Techno','Industrial','Alternative','Ska','Death Metal','Pranks','Soundtrack','Euro-Techno','Ambient','Trip-Hop','Vocal','Jazz+Funk','Fusion','Trance','Classical','Instrumental','Acid','House','Game','Sound Clip','Gospel','Noise','AlternRock','Bass','Soul','Punk','Space','Meditative','Instrumental Pop','Instrumental Rock','Ethnic','Gothic','Darkwave','Techno-Industrial','Electronic','Pop-Folk','Eurodance','Dream','Southern Rock','Comedy','Cult','Gangsta','Top 40','Christian Rap','Pop/Funk','Jungle','Native American','Cabaret','New Wave','Psychadelic','Rave','Showtunes','Trailer','Lo-Fi','Tribal','Acid Punk','Acid Jazz','Polka','Retro','Musical','Rock & Roll','Hard Rock'];
function fixGenre(g) {
  if (!g) return '';
  const m = /^\((\d+)\)(.*)$/.exec(g) || /^(\d+)$/.exec(g);
  if (m) return (m[2] && m[2].trim()) || GENRES[+m[1]] || g;
  return g;
}
const num = (v) => { const n = parseInt(String(v || '').split('/')[0], 10); return isNaN(n) ? 0 : n; };

// ---------------- MP3 / ID3 ----------------
async function readID3v2(r, out) {
  const h = await r.read(0, 10);
  if (str(h, 0, 3) !== 'ID3') return 0;
  const ver = h[3], flags = h[5];
  let size = syncsafe(h, 6) + 10;
  if (flags & 0x10) size += 10;
  const b = await r.read(0, Math.min(size, r.size));
  let p = 10;
  if (flags & 0x40 && ver >= 3) p += ver === 4 ? syncsafe(b, 10) : u32(b, 10) + 4;
  const v22 = ver === 2;
  const unsync = (flags & 0x80) && ver < 4;
  let data = b;
  if (unsync) { // remove 0xFF00 unsynchronisation (v2.2/2.3 whole-tag)
    const o = []; for (let i = 0; i < b.length; i++) { o.push(b[i]); if (b[i] === 0xff && b[i + 1] === 0) i++; }
    data = Uint8Array.from(o);
  }
  const hdr = v22 ? 6 : 10;
  while (p + hdr < data.length && p < size) {
    const id = str(data, p, v22 ? 3 : 4);
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
    let fsz = v22 ? u24(data, p + 3) : ver === 4 ? syncsafe(data, p + 4) : u32(data, p + 4);
    if (ver === 4 && fsz > 0 && p + hdr + fsz < data.length) { // some taggers write non-syncsafe in v2.4
      const raw = u32(data, p + 4);
      if (!/^[A-Z0-9]{4}$/.test(str(data, p + hdr + fsz, 4)) && /^[A-Z0-9]{4}$/.test(str(data, p + hdr + raw, 4))) fsz = raw;
    }
    const fflags = v22 ? 0 : u16(data, p + 8);
    let f = data.subarray(p + hdr, p + hdr + fsz);
    p += hdr + fsz;
    if (!fsz) continue;
    if (ver === 4 && (fflags & 0x02)) { const o = []; for (let i = 0; i < f.length; i++) { o.push(f[i]); if (f[i] === 0xff && f[i + 1] === 0) i++; } f = Uint8Array.from(o); }
    if (ver === 4 && (fflags & 0x01)) f = f.subarray(4);
    if (ver === 4 && (fflags & 0x0c)) continue; // compressed/encrypted: skip
    const key = v22 ? ({ TT2: 'TIT2', TP1: 'TPE1', TP2: 'TPE2', TAL: 'TALB', TYE: 'TYER', TCO: 'TCON', TRK: 'TRCK', TPA: 'TPOS', PIC: 'APIC', ULT: 'USLT', TCM: 'TCOM', TBP: 'TBPM' })[id] || id : id;
    const text = () => decodeText(f[0], f.subarray(1)).split('\u0000').filter(Boolean).join('; ');
    switch (key) {
      case 'TIT2': out.title ||= text(); break;
      case 'TPE1': out.artist ||= text(); break;
      case 'TPE2': out.albumArtist ||= text(); break;
      case 'TALB': out.album ||= text(); break;
      case 'TYER': case 'TDRC': case 'TDOR': out.year ||= num(text().slice(0, 4)); break;
      case 'TCON': out.genre ||= fixGenre(text()); break;
      case 'TRCK': out.track ||= num(text()); break;
      case 'TPOS': out.disc ||= num(text()); break;
      case 'TCOM': out.composer ||= text(); break;
      case 'TBPM': out.bpm ||= num(text()); break;
      case 'TLEN': out._tlen ||= num(text()) / 1000; break;
      case 'TSRC': out.isrc ||= text().toUpperCase().replace(/[^A-Z0-9]/g, ''); break;
      case 'USLT': {
        const enc = f[0]; const e = findTerm(f, 4, enc);
        const t = decodeText(enc, f.subarray(e + termLen(enc)));
        if (t && !out.lyrics) out.lyrics = t; break;
      }
      case 'SYLT': break;
      case 'APIC': {
        if (out.picture && out._picType === 3) break;
        const enc = f[0]; let q;
        let mime;
        if (v22) { mime = 'image/' + str(f, 1, 3).toLowerCase(); q = 4; }
        else { const me = findTerm(f, 1, 0); mime = str(f, 1, me - 1); q = me + 1; }
        const ptype = f[q]; q++;
        const de = findTerm(f, q, enc); q = de + termLen(enc);
        const img = f.slice(q);
        if (img.length > 64 && (!out.picture || ptype === 3)) { out.picture = { data: img, mime: mimeFromBytes(img) || mime }; out._picType = ptype; }
        break;
      }
    }
  }
  return size;
}

const MP3_BR = [
  [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448], // v1 l1
  [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],   // v1 l2
  [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],    // v1 l3
  [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],   // v2 l1
  [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]         // v2 l2/l3
];
const MP3_SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

async function mp3Duration(r, start) {
  const b = await r.read(start, 16384);
  for (let i = 0; i + 4 < b.length; i++) {
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) continue;
    const ver = (b[i + 1] >> 3) & 3, layer = (b[i + 1] >> 1) & 3, bri = b[i + 2] >> 4, sri = (b[i + 2] >> 2) & 3;
    if (ver === 1 || layer === 0 || bri === 0 || bri === 15 || sri === 3) continue;
    const sr = MP3_SR[ver][sri];
    const brRow = ver === 3 ? 3 - layer : (layer === 3 ? 3 : 4);
    const br = MP3_BR[brRow][bri];
    const spf = layer === 3 ? 384 : (layer === 2 || ver === 3 ? 1152 : 576);
    const mono = (b[i + 3] >> 6) === 3;
    const sideInfo = ver === 3 ? (mono ? 17 : 32) : (mono ? 9 : 17);
    const x = i + 4 + sideInfo;
    const tag = str(b, x, 4);
    if (tag === 'Xing' || tag === 'Info') {
      const fl = u32(b, x + 4);
      if (fl & 1) { const frames = u32(b, x + 8); if (frames) return { duration: frames * spf / sr, bitrate: br, sampleRate: sr }; }
    }
    if (str(b, i + 36, 4) === 'VBRI') { const frames = u32(b, i + 36 + 14); if (frames) return { duration: frames * spf / sr, bitrate: br, sampleRate: sr }; }
    // check that next frame is also a sync to avoid false positives
    const flen = layer === 3 ? Math.floor((12 * br * 1000 / sr + ((b[i + 2] >> 1) & 1)) * 4) : Math.floor(spf / 8 * br * 1000 / sr) + ((b[i + 2] >> 1) & 1);
    if (i + flen + 1 < b.length && !(b[i + flen] === 0xff && (b[i + flen + 1] & 0xe0) === 0xe0)) continue;
    return { duration: (r.size - start) * 8 / (br * 1000), bitrate: br, sampleRate: sr };
  }
  return {};
}

async function readID3v1(r, out) {
  if (r.size < 128) return;
  const b = await r.read(r.size - 128, 128);
  if (str(b, 0, 3) !== 'TAG') return;
  const f = (s, l) => clean(LATIN1.decode(b.subarray(s, s + l)));
  out.title ||= f(3, 30); out.artist ||= f(33, 30); out.album ||= f(63, 30); out.year ||= num(f(93, 4));
  if (b[125] === 0 && b[126]) out.track ||= b[126];
  if (b[127] < GENRES.length) out.genre ||= GENRES[b[127]];
}

async function parseMP3(r, out) {
  const tagSize = await readID3v2(r, out);
  const d = await mp3Duration(r, tagSize);
  Object.assign(out, d);
  if (out._tlen && !out.duration) out.duration = out._tlen;
  if (!out.title || !out.artist) await readID3v1(r, out);
}

// ---------------- Vorbis comments (FLAC/OGG) ----------------
function vorbisComments(b, o, out) {
  const vlen = u32le(b, o); o += 4 + vlen;
  const n = u32le(b, o); o += 4;
  for (let i = 0; i < n && o + 4 <= b.length; i++) {
    const l = u32le(b, o); o += 4;
    const s = UTF8.decode(b.subarray(o, o + l)); o += l;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const k = s.slice(0, eq).toUpperCase(), v = s.slice(eq + 1).trim();
    switch (k) {
      case 'TITLE': out.title ||= v; break;
      case 'ARTIST': out.artist = out.artist ? out.artist + '; ' + v : v; break;
      case 'ALBUMARTIST': case 'ALBUM ARTIST': out.albumArtist ||= v; break;
      case 'ALBUM': out.album ||= v; break;
      case 'DATE': case 'YEAR': out.year ||= num(v.slice(0, 4)); break;
      case 'GENRE': out.genre ||= v; break;
      case 'TRACKNUMBER': out.track ||= num(v); break;
      case 'DISCNUMBER': out.disc ||= num(v); break;
      case 'COMPOSER': out.composer ||= v; break;
      case 'LYRICS': case 'UNSYNCEDLYRICS': out.lyrics ||= v; break;
      case 'BPM': out.bpm ||= num(v); break;
      case 'ISRC': out.isrc ||= v.toUpperCase().replace(/[^A-Z0-9]/g, ''); break;
      case 'METADATA_BLOCK_PICTURE': if (!out.picture) { try { const bin = Uint8Array.from(atob(v), c => c.charCodeAt(0)); flacPicture(bin, 0, out); } catch {} } break;
    }
  }
}
function flacPicture(b, o, out) {
  const type = u32(b, o); o += 4;
  const ml = u32(b, o); o += 4; const mime = str(b, o, ml); o += ml;
  const dl = u32(b, o); o += 4 + dl;
  o += 16; const len = u32(b, o); o += 4;
  const img = b.slice(o, o + len);
  if (img.length > 64 && (!out.picture || type === 3)) out.picture = { data: img, mime: mimeFromBytes(img) || mime };
}

async function parseFLAC(r, out) {
  let p = 4;
  const id3 = await r.read(0, 10);
  if (str(id3, 0, 3) === 'ID3') { p = syncsafe(id3, 6) + 10 + 4; }
  for (let guard = 0; guard < 64 && p + 4 < r.size; guard++) {
    const h = await r.read(p, 4);
    const last = h[0] & 0x80, type = h[0] & 0x7f, len = u24(h, 1);
    if (type === 0 || type === 4 || type === 6) {
      const b = await r.read(p + 4, len);
      if (type === 0) {
        const sr = (b[10] << 12) | (b[11] << 4) | (b[12] >> 4);
        const total = ((b[13] & 0x0f) * 2 ** 32) + u32(b, 14);
        out.sampleRate = sr; out.bitDepth = (((b[12] & 1) << 4) | (b[13] >> 4)) + 1;
        if (sr && total) out.duration = total / sr;
      } else if (type === 4) vorbisComments(b, 0, out);
      else if (type === 6) flacPicture(b, 0, out);
    }
    p += 4 + len;
    if (last) break;
  }
  if (out.duration) out.bitrate = Math.round(r.size * 8 / out.duration / 1000);
}

// ---------------- OGG (Vorbis / Opus) ----------------
async function parseOGG(r, out) {
  const b = await r.read(0, Math.min(r.size, 512 * 1024));
  // reassemble packets from the first pages
  const packets = []; let cur = []; let p = 0;
  while (p + 27 < b.length && packets.length < 3) {
    if (str(b, p, 4) !== 'OggS') break;
    const segs = b[p + 26]; const table = b.subarray(p + 27, p + 27 + segs);
    let d = p + 27 + segs;
    for (const s of table) { cur.push(b.subarray(d, d + s)); d += s; if (s < 255) { const len = cur.reduce((a, c) => a + c.length, 0); const pk = new Uint8Array(len); let o = 0; for (const c of cur) { pk.set(c, o); o += c.length; } packets.push(pk); cur = []; } }
    p = d;
  }
  let rate = 0, preskip = 0;
  const id = packets[0];
  if (id && str(id, 1, 6) === 'vorbis') { rate = u32le(id, 12); out.sampleRate = rate; }
  else if (id && str(id, 0, 8) === 'OpusHead') { rate = 48000; preskip = id[10] | (id[11] << 8); out.sampleRate = 48000; }
  const c = packets[1];
  if (c && str(c, 1, 6) === 'vorbis') vorbisComments(c, 7, out);
  else if (c && str(c, 0, 8) === 'OpusTags') vorbisComments(c, 8, out);
  // duration from last page granule
  const tailLen = Math.min(r.size, 65536);
  const t = await r.read(r.size - tailLen, tailLen);
  for (let i = t.length - 14; i >= 0; i--) {
    if (t[i] === 0x4f && t[i + 1] === 0x67 && t[i + 2] === 0x67 && t[i + 3] === 0x53) {
      const lo = u32le(t, i + 6), hi = u32le(t, i + 10);
      const g = hi * 2 ** 32 + lo;
      if (rate && g) out.duration = Math.max(0, g - preskip) / rate;
      break;
    }
  }
  if (out.duration) out.bitrate = Math.round(r.size * 8 / out.duration / 1000);
}

// ---------------- MP4 / M4A ----------------
async function parseMP4(r, out) {
  const walk = async (start, end, depth) => {
    let p = start;
    while (p + 8 <= end) {
      const h = await r.read(p, 16);
      let size = u32(h, 0); const type = str(h, 4, 4); let hl = 8;
      if (size === 1) { size = u32(h, 8) * 2 ** 32 + u32(h, 12); hl = 16; }
      else if (size === 0) size = end - p;
      if (size < 8) break;
      if (type === 'moov' || type === 'trak' || type === 'mdia' || type === 'udta' || type === 'ilst') {
        await walk(p + hl, p + size, depth + 1);
      } else if (type === 'meta') {
        await walk(p + hl + 4, p + size, depth + 1);
      } else if (type === 'mvhd') {
        const b = await r.read(p + hl, 32);
        if (b[0] === 1) { const ts = u32(b, 20); const dur = u32(b, 24) * 2 ** 32 + u32(b, 28); if (ts) out.duration = dur / ts; }
        else { const ts = u32(b, 12); const dur = u32(b, 16); if (ts) out.duration = dur / ts; }
      } else if (depth >= 3 && size < 64 * 1024 * 1024) {
        // ilst item
        const b = await r.read(p + hl, size - hl);
        let q = 0; let val = null;
        while (q + 16 <= b.length) {
          const ds = u32(b, q); if (str(b, q + 4, 4) === 'data') { const dt = u32(b, q + 8) & 0xffffff; val = { t: dt, d: b.subarray(q + 16, q + ds) }; break; }
          if (ds < 8) break; q += ds;
        }
        if (val) {
          const s = () => clean(UTF8.decode(val.d));
          switch (type) {
            case '©nam': out.title ||= s(); break;
            case '©ART': out.artist ||= s(); break;
            case 'aART': out.albumArtist ||= s(); break;
            case '©alb': out.album ||= s(); break;
            case '©day': out.year ||= num(s().slice(0, 4)); break;
            case '©gen': out.genre ||= s(); break;
            case 'gnre': out.genre ||= GENRES[u16(val.d, 0) - 1] || ''; break;
            case '©wrt': out.composer ||= s(); break;
            case '©lyr': out.lyrics ||= s(); break;
            case 'trkn': out.track ||= u16(val.d, 2); break;
            case 'disk': out.disc ||= u16(val.d, 2); break;
            case 'tmpo': out.bpm ||= u16(val.d, 0); break;
            case 'covr': if (!out.picture && val.d.length > 64) { const img = val.d.slice(); out.picture = { data: img, mime: mimeFromBytes(img) }; } break;
          }
        }
      }
      p += size;
    }
  };
  await walk(0, r.size, 0);
  if (out.duration) out.bitrate = Math.round(r.size * 8 / out.duration / 1000);
}

// ---------------- WAV ----------------
async function parseWAV(r, out) {
  const b = await r.read(0, Math.min(r.size, 256 * 1024));
  let p = 12, byteRate = 0;
  while (p + 8 < b.length) {
    const id = str(b, p, 4), len = u32le(b, p + 4);
    if (id === 'fmt ') { out.sampleRate = u32le(b, p + 12); byteRate = u32le(b, p + 16); out.bitDepth = b[p + 22] | (b[p + 23] << 8); }
    else if (id === 'data') { if (byteRate) out.duration = len / byteRate; p += 8 + len + (len & 1); break; }
    else if (id === 'LIST' && str(b, p + 8, 4) === 'INFO') {
      let q = p + 12; while (q + 8 < p + 8 + len) { const k = str(b, q, 4), l = u32le(b, q + 4); const v = clean(UTF8.decode(b.subarray(q + 8, q + 8 + l)));
        if (k === 'INAM') out.title ||= v; if (k === 'IART') out.artist ||= v; if (k === 'IPRD') out.album ||= v; if (k === 'IGNR') out.genre ||= v; if (k === 'ICRD') out.year ||= num(v.slice(0, 4)); if (k === 'ITRK') out.track ||= num(v);
        q += 8 + l + (l & 1); }
    }
    p += 8 + len + (len & 1);
  }
  out.bitrate = byteRate ? Math.round(byteRate * 8 / 1000) : 0;
}

export const AUDIO_EXT = ['mp3', 'm4a', 'mp4', 'aac', 'flac', 'ogg', 'oga', 'opus', 'wav', 'wave', 'webm', 'alac', 'aiff', 'aif'];
export const isAudio = (name) => AUDIO_EXT.includes((name.split('.').pop() || '').toLowerCase());

function guessFromFilename(name, out) {
  const base = name.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
  let m = /^(\d{1,3})[\s.\-_]+(.+)$/.exec(base);
  let rest = base;
  if (m) { out.track ||= +m[1]; rest = m[2]; }
  const parts = rest.split(/\s+-\s+/);
  if (parts.length >= 2) { out.artist ||= parts[0].trim(); out.title ||= parts.slice(1).join(' - ').trim(); }
  else out.title ||= rest.trim();
}

export async function readTags(reader, name) {
  const out = {};
  const ext = (name.split('.').pop() || '').toLowerCase();
  try {
    const head = await reader.read(0, 12);
    const magic = str(head, 0, 4);
    if (magic === 'fLaC' || ext === 'flac') await parseFLAC(reader, out);
    else if (magic === 'OggS') await parseOGG(reader, out);
    else if (str(head, 4, 4) === 'ftyp') await parseMP4(reader, out);
    else if (magic === 'RIFF') await parseWAV(reader, out);
    else if (magic.startsWith('ID3') || ext === 'mp3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) await parseMP3(reader, out);
  } catch (e) { out._error = String(e && e.message || e); }
  guessFromFilename(name, out);
  delete out._tlen; delete out._picType;
  return out;
}
