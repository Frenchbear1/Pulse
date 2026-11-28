// iPhone / iPad / browser adapter. Songs you import are copied into the app's private
// storage (IndexedDB) so they keep working offline and after the Files app moves things around.
import { isAudio } from './tags.js';
import { hashStr, cachedReader } from './util.js';

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('pulse', 2); // v2 adds 'videos' (video files + their subtitles); existing stores are kept
    r.onupgradeneeded = () => { const d = r.result; for (const s of ['kv', 'files', 'covers', 'videos']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s); };
    r.onsuccess = () => { const d = r.result; d.onversionchange = () => { d.close(); dbp = null; }; d.onclose = () => { dbp = null; }; res(d); }; r.onerror = () => rej(r.error);
    r.onblocked = () => console.warn('IndexedDB upgrade waiting for another Pulse tab to close');
  });
}
let dbp;
const tx = async (store, mode, fn, retry = true) => {
  try { return await tx1(store, mode, fn); } catch (e) {
    // iOS closes IndexedDB connections while the app sits in the background: reconnect once
    if (retry && /InvalidState|UnknownError|connection/i.test((e && (e.name + ' ' + e.message)) || '')) { dbp = null; return tx(store, mode, fn, false); }
    throw e;
  }
};
const tx1 = async (store, mode, fn) => { const d = await (dbp ||= idb()); return new Promise((res, rej) => { const t = d.transaction(store, mode); const s = t.objectStore(store); let out; Promise.resolve(fn(s)).then((v) => { out = v; }); t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); };
const get = (store, k) => tx(store, 'readonly', (s) => s.get(k));
const put = (store, k, v) => tx(store, 'readwrite', (s) => s.put(v, k));
const del = (store, k) => tx(store, 'readwrite', (s) => s.delete(k));

export function createWebPlatform() {
  const coverCache = new Map();
  const urls = []; // keep a couple of blob URLs alive (current + preloaded next)
  const listeners = new Set();
  const pending = new Map(); // id -> File (fresh import, not yet read back)

  const p = {
    kind: 'web',
    canWindow: false,
    async init() {
      try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch {}
    },
    on(fn) { listeners.add(fn); },
    emit(type, data) { listeners.forEach((f) => f(type, data)); },
    // Missing = first run (null). Anything else throws, so the app never saves an empty library over a real one.
    async loadDB() { const v = await get('kv', 'library'); return v ? JSON.parse(v) : null; },
    async saveDB(db) { await put('kv', 'library', JSON.stringify(db)); },

    // Opens the system picker. folder=true asks for a whole folder (tiers kept).
    pickFiles(folder) {
      return new Promise((res) => {
        const i = document.createElement('input'); i.type = 'file'; i.multiple = true;
        i.accept = 'audio/*,.mp3,.m4a,.flac,.ogg,.opus,.wav,.aac,.lrc,image/*';
        if (folder) { i.webkitdirectory = true; i.setAttribute('webkitdirectory', ''); }
        i.style.display = 'none'; document.body.appendChild(i);
        i.onchange = () => { res([...i.files]); i.remove(); };
        i.oncancel = () => { res([]); i.remove(); };
        i.click();
      });
    },
    // Convert picked File objects to track stubs (and stash files for import)
    prepareFiles(files, rootId) {
      const art = new Map(), lrcs = new Map(), out = [];
      for (const f of files) {
        const rel = (f.webkitRelativePath || f.name).replace(/\\/g, '/');
        const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
        const lower = f.name.toLowerCase();
        if (/\.(jpe?g|png|webp)$/.test(lower)) { if (!art.has(dir) || /^(cover|folder|front)/.test(lower)) art.set(dir, f); }
        else if (lower.endsWith('.lrc')) lrcs.set(rel.replace(/\.lrc$/i, '').toLowerCase(), f);
        else if (isAudio(f.name) || f.type.startsWith('audio/')) out.push({ f, rel, dir });
      }
      return out.map(({ f, rel, dir }) => {
        const id = hashStr(rel + '|' + f.size + '|' + f.lastModified);
        pending.set(id, { file: f, art: art.get(dir) || null, lrc: lrcs.get(rel.replace(/\.[^.]+$/, '').toLowerCase()) || null });
        return { id, root: rootId, rel, name: f.name, dirs: dir ? dir.split('/') : [], size: f.size, folderArt: art.has(dir) ? 'yes' : null, lrc: null };
      });
    },
    async commitFile(t) { // copy the file into storage
      const pd = pending.get(t.id); if (!pd) return;
      await put('files', t.id, pd.file);
      if (pd.lrc) { t.lrc = 'stored'; await put('kv', 'lrc:' + t.id, await pd.lrc.text()); }
    },
    finishImport() { pending.clear(); },
    async reader(t) {
      const pd = pending.get(t.id);
      const file = pd ? pd.file : await get('files', t.id);
      if (!file) throw new Error('missing file');
      return cachedReader(file.size, (pos, len) => file.slice(pos, pos + len).arrayBuffer(), 262144);
    },
    async readFolderArt(t) { const pd = pending.get(t.id); if (!pd?.art) return null; return { data: new Uint8Array(await pd.art.arrayBuffer()), mime: pd.art.type }; },
    async readLrc(t) { if (!t.lrc) return null; return (await get('kv', 'lrc:' + t.id)) || null; },
    async audioURL(t) {
      if (t.url) return t.url;
      const f = await get('files', t.id); if (!f) return null;
      const u = URL.createObjectURL(f); urls.push(u);
      // free old URLs, but never one an audio element is still using (iOS re-reads it on seek/resume)
      if (urls.length > 4) {
        const live = new Set([...document.querySelectorAll('audio')].map((a) => a.src));
        for (let i = 0; i < urls.length - 4;) { if (live.has(urls[i])) i++; else URL.revokeObjectURL(urls.splice(i, 1)[0]); }
      }
      return u;
    },
    releaseAudio() {},
    async deleteTrackFile(t) { await del('files', t.id); try { await del('kv', 'lrc:' + t.id); } catch {} },
    async hasCover(key) { return !!(await get('covers', key + '_s')); },
    async saveCover(key, big, small) { await put('covers', key, big); await put('covers', key + '_s', small); for (const k of [key, key + '_s']) { const v = coverCache.get(k); if (v) { coverCache.delete(k); setTimeout(() => v.then((u) => u && URL.revokeObjectURL(u)), 30000); } } },
    async deleteCover(key) { await del('covers', key); await del('covers', key + '_s'); },
    async coverURL(key, small) {
      if (!key) return null;
      if (/^(https?|data|blob):/.test(key)) return key;
      const k = key + (small ? '_s' : '');
      if (coverCache.has(k)) { const v = coverCache.get(k); coverCache.delete(k); coverCache.set(k, v); return v; } // most recent last
      const prom = get('covers', k).then((b) => (b ? URL.createObjectURL(b) : null));
      coverCache.set(k, prom);
      // keep memory flat on big libraries: forget the least recently used covers
      while (coverCache.size > 600) { const [ok, ov] = coverCache.entries().next().value; coverCache.delete(ok); setTimeout(() => ov.then((u) => u && URL.revokeObjectURL(u)), 30000); }
      return prom;
    },
    coverURLSync(key) { return /^(https?|data|blob):/.test(key || '') ? key : null; },
    async findExports() { return []; },
    async stat() { return null; },
    openURL(u) { window.open(u, '_blank', 'noopener'); },
    async storageInfo() { try { return await navigator.storage.estimate(); } catch { return null; } },
    async writeClipboard(t) { try { await navigator.clipboard.writeText(t); return true; } catch { return false; } },
    // ---- videos (kept apart from songs, in their own store) ----
    saveVideoFile(id, blob) { return put('videos', id, blob); },
    getVideoFile(id) { return get('videos', id); },
    async deleteVideoFile(id) { await del('videos', id); try { await del('videos', 'sub:' + id); } catch {} },
    saveVideoSub(id, vtt) { return put('videos', 'sub:' + id, vtt); },
    async getVideoSub(id) { return (await get('videos', 'sub:' + id)) || null; },
    win: null
  };
  return p;
}
