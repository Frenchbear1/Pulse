// Windows desktop adapter (Neutralinojs). Reads music straight from your folders,
// streams via the built-in local server (with HTTP range support) and caches covers as files.
import { isAudio } from './tags.js';
import { hashStr, cachedReader, debounce } from './util.js';

const N = () => window.Neutralino;
const IMG_NAMES = ['cover', 'folder', 'front', 'album', 'albumart', 'albumartsmall'];

let _db;
const idb = () => (_db ||= new Promise((res, rej) => { const r = indexedDB.open('pulse-covers', 1); r.onupgradeneeded = () => r.result.createObjectStore('c'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
const idbOp = async (mode, fn) => { const d = await idb(); return new Promise((res, rej) => { const t = d.transaction('c', mode); const q = fn(t.objectStore('c')); t.oncomplete = () => res(q?.result); t.onerror = () => rej(t.error); }); };
const idbPut = (k, v) => idbOp('readwrite', (s) => s.put(v, k));
const idbGet = (k) => idbOp('readonly', (s) => s.get(k));
const idbDel = (k) => idbOp('readwrite', (s) => s.delete(k));
const idbAllKeys = () => idbOp('readonly', (s) => s.getAllKeys());

export function createDesktopPlatform() {
  let dataDir = '', coverDir = '';
  const watchers = new Map();
  const listeners = new Set();

  const p = {
    kind: 'desktop',
    canWindow: true,
    async init() {
      N().init();
      await new Promise((res) => { if (window.NL_TOKEN) res(); else N().events.on('ready', res); setTimeout(res, 1500); });
      dataDir = (window.NL_DATAPATH || window.NL_PATH) + '/PulseData';
      coverDir = dataDir + '/covers';
      for (const d of [dataDir, coverDir]) { try { await N().filesystem.createDirectory(d); } catch {} }
      try { await N().server.mount('/covers', coverDir); } catch (e) { console.warn('mount covers failed', e); }
      try { for (const k of (await idbAllKeys()) || []) if (!String(k).endsWith('_s')) p.idbKeys.add(k); } catch {}
      N().events.on('windowClose', () => p.emit('close'));
      N().events.on('watchFile', debounce(() => p.emit('fschange'), 1500));
      N().events.on('trayMenuItemClicked', (e) => p.emit('tray', e.detail.id));
    },
    on(fn) { listeners.add(fn); },
    emit(type, data) { listeners.forEach((f) => f(type, data)); },

    async loadDB() {
      try { return JSON.parse(await N().filesystem.readFile(dataDir + '/library.json')); } catch { return null; }
    },
    async saveDB(db) {
      const tmp = dataDir + '/library.tmp';
      await N().filesystem.writeFile(tmp, JSON.stringify(db));
      try { await N().filesystem.move(tmp, dataDir + '/library.json'); } catch { await N().filesystem.writeFile(dataDir + '/library.json', JSON.stringify(db)); }
    },

    // ---- roots ----
    async pickRoot() {
      const path = await N().os.showFolderDialog('Choose a music folder', { defaultPath: await N().os.getPath('music').catch(() => '') });
      return path ? { id: hashStr(path), path: path.replace(/\\/g, '/'), name: path.split(/[\\/]/).filter(Boolean).pop() } : null;
    },
    roots: new Map(),
    async mountRoot(root) {
      p.roots.set(root.id, root);
      try { await N().server.unmount('/m_' + root.id); } catch {}
      await N().server.mount('/m_' + root.id, root.path);
    },
    async watchRoot(root) {
      if (watchers.has(root.id)) return;
      try { watchers.set(root.id, await N().filesystem.createWatcher(root.path)); } catch {}
    },
    async unwatchRoot(root) { const w = watchers.get(root.id); if (w != null) { try { await N().filesystem.removeWatcher(w); } catch {} watchers.delete(root.id); } },

    // List audio files under a root. Returns [{id, rel, name, dirs:[], lrc, folderArt}]
    async listRoot(root) {
      await p.mountRoot(root);
      const entries = await N().filesystem.readDirectory(root.path, { recursive: true });
      const base = root.path.replace(/\/+$/, '') + '/';
      const art = new Map(), lrc = new Set(), files = [];
      for (const e of entries) {
        if (e.type !== 'FILE') continue;
        const full = e.path.replace(/\\/g, '/');
        const rel = full.startsWith(base) ? full.slice(base.length) : e.entry;
        const lower = e.entry.toLowerCase();
        const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
        if (/\.(jpe?g|png|webp)$/.test(lower)) {
          const nm = lower.replace(/\.[^.]+$/, '');
          const prev = art.get(dir);
          const rank = IMG_NAMES.indexOf(nm) >= 0 ? IMG_NAMES.indexOf(nm) : 50;
          if (!prev || rank < prev.rank) art.set(dir, { rel, rank });
        } else if (lower.endsWith('.lrc')) lrc.add(rel.toLowerCase());
        else if (isAudio(e.entry)) files.push({ rel, name: e.entry, dir });
      }
      return files.map((f) => {
        const l = f.rel.replace(/\.[^.]+$/, '.lrc');
        return { id: hashStr(root.id + '|' + f.rel), root: root.id, rel: f.rel, name: f.name, dirs: f.dir ? f.dir.split('/') : [], lrc: lrc.has(l.toLowerCase()) ? l : null, folderArt: art.get(f.dir)?.rel || null };
      });
    },
    async stat(t) { const root = p.roots.get(t.root); if (!root) throw new Error('root not mounted'); const st = await N().filesystem.getStats(root.path + '/' + t.rel); return { size: st.size, mtime: st.modifiedAt }; },
    trackURL(t) { return location.origin + '/m_' + t.root + '/' + t.rel.split('/').map(encodeURIComponent).join('/'); },
    audioURL(t) { return Promise.resolve(p.trackURL(t)); },
    releaseAudio() {},
    async reader(t) {
      try { return await p.httpReader(t); }
      catch (e) {
        console.warn('http reader failed, using native read', e);
        const root = p.roots?.get(t.root); if (!root) throw e;
        const path = root.path + '/' + t.rel; const st = await N().filesystem.getStats(path);
        return cachedReader(st.size, (pos, len) => N().filesystem.readBinaryFile(path, { pos, size: len }));
      }
    },
    async httpReader(t) {
      const url = p.trackURL(t);
      const first = await fetch(url, { headers: { Range: 'bytes=0-65535' } });
      const cr = first.headers.get('Content-Range');
      const size = cr ? +cr.split('/')[1] : +(first.headers.get('Content-Length') || 0);
      if (!first.ok) throw new Error('HTTP ' + first.status);
      const firstBuf = await first.arrayBuffer();
      if (first.status === 200 && firstBuf.byteLength > 65536 && size === firstBuf.byteLength) { // server ignored Range: use the whole file
        return cachedReader(size, async (pos, len) => firstBuf.slice(pos, pos + len));
      }
      const raw = async (pos, len) => {
        if (pos === 0 && len <= firstBuf.byteLength) return firstBuf.slice(0, len);
        const r = await fetch(url, { headers: { Range: `bytes=${pos}-${pos + len - 1}` } });
        const buf = await r.arrayBuffer();
        if (r.status === 200 && buf.byteLength !== len) return buf.slice(pos, pos + len); // Range ignored
        return buf;
      };
      return cachedReader(size, raw);
    },
    async readFolderArt(t) {
      const url = location.origin + '/m_' + t.root + '/' + t.folderArt.split('/').map(encodeURIComponent).join('/');
      const r = await fetch(url); const b = new Uint8Array(await r.arrayBuffer());
      return { data: b, mime: r.headers.get('Content-Type') || 'image/jpeg' };
    },
    async readLrc(t) {
      if (!t.lrc) return null;
      const r = await fetch(location.origin + '/m_' + t.root + '/' + t.lrc.split('/').map(encodeURIComponent).join('/'));
      return r.ok ? r.text() : null;
    },
    async deleteTrackFile(t, root) {
      await N().os.trashItem?.(root.path + '/' + t.rel).catch(async () => { await N().filesystem.remove(root.path + '/' + t.rel); });
    },
    revealTrack(t, root) { N().os.execCommand(`explorer.exe /select,"${(root.path + '/' + t.rel).replace(/\//g, '\\')}"`, { background: true }); },

    // ---- covers ----
    // Covers are cached as files (served by the local server). If that ever fails,
    // they go into the app's IndexedDB instead, so art always shows.
    idbKeys: new Set(),
    async hasCover(key) { try { await N().filesystem.getStats(coverDir + '/' + key + '.jpg'); return true; } catch { return p.idbKeys.has(key); } },
    async saveCover(key, big, small) {
      try {
        await N().filesystem.writeBinaryFile(coverDir + '/' + key + '.jpg', await big.arrayBuffer());
        await N().filesystem.writeBinaryFile(coverDir + '/' + key + '_s.jpg', await small.arrayBuffer());
        const chk = await fetch(location.origin + '/covers/' + key + '_s.jpg', { method: 'GET' }); if (!chk.ok) throw new Error('cover not served (' + chk.status + ')');
        return 'file';
      } catch (e) {
        console.warn('cover file write failed, using IndexedDB', e);
        await idbPut(key, big); await idbPut(key + '_s', small); p.idbKeys.add(key);
        return 'idb';
      }
    },
    async deleteCover(key) { for (const s of ['.jpg', '_s.jpg']) { try { await N().filesystem.remove(coverDir + '/' + key + s); } catch {} } try { await idbDel(key); await idbDel(key + '_s'); } catch {} p.idbKeys.delete(key); },
    blobURLs: new Map(),
    coverURL(key, small) {
      if (!key) return Promise.resolve(null);
      if (p.idbKeys.has(key)) { const k = key + (small ? '_s' : ''); if (!p.blobURLs.has(k)) p.blobURLs.set(k, idbGet(k).then((b) => (b ? URL.createObjectURL(b) : null))); return p.blobURLs.get(k); }
      return Promise.resolve(location.origin + '/covers/' + key + (small ? '_s' : '') + '.jpg');
    },
    coverURLSync(key, small) { return key && !p.idbKeys.has(key) ? location.origin + '/covers/' + key + (small ? '_s' : '') + '.jpg' : null; },

    // ---- window ----
    win: {
      minimize: () => N().window.minimize(),
      // Maximize = true fullscreen (fills the whole monitor, exact pixels, restores the old size/position).
      // Uses SetWindowPos instead of SW_MAXIMIZE, which misroutes clicks on borderless transparent windows.
      _max: false,
      async toggleMax() { return p.win._max ? p.win.restore() : p.win.maximize(); },
      async maximize() { if (p.win._max) return; await N().window.setFullScreen(); p.win._max = true; p.emit('maxchange', true); },
      async restore() { if (!p.win._max) return; await N().window.exitFullScreen(); p.win._max = false; p.emit('maxchange', false); },
      setSize: (w, h) => N().window.setSize({ width: Math.round(w), height: Math.round(h), resizable: false }),
      getSize: () => N().window.getSize(),
      getPos: () => N().window.getPosition(),
      move: (x, y) => N().window.move(Math.round(x), Math.round(y)),
      onTop: (v) => N().window.setAlwaysOnTop(!!v),
      isMax: async () => p.win._max,
      unmax: () => p.win.restore(),
      hide: () => N().window.hide(),
      show: async () => { await N().window.show(); await N().window.focus(); },
      setTray(items) { return N().os.setTray({ icon: '/resources/icons/tray.png', menuItems: items }).catch(() => {}); },
      notify: (title, body) => N().os.showNotification(title, body).catch(() => {}),
      openURL: (u) => N().os.open(u)
    },
    // Recent Exportify downloads (CSV / ZIP) in the user's Downloads folder
    async findExports(sinceMs = 1000 * 60 * 60 * 24 * 3) {
      let dir; try { dir = (await N().os.getPath('downloads')).replace(/\\/g, '/'); } catch { return []; }
      let entries = []; try { entries = await N().filesystem.readDirectory(dir); } catch { return []; }
      const out = [];
      for (const e of entries) {
        if (e.type !== 'FILE' || !/\.(csv|zip)$/i.test(e.entry)) continue;
        const path = e.path.replace(/\\/g, '/');
        try {
          const st = await N().filesystem.getStats(path);
          if (Date.now() - st.modifiedAt > sinceMs || st.size > 200 * 1024 * 1024) continue;
          out.push({ name: e.entry, path, size: st.size, mtime: st.modifiedAt });
        } catch {}
      }
      return out.sort((a, b) => b.mtime - a.mtime).slice(0, 12);
    },
    async readFileBytes(path) { return new Uint8Array(await N().filesystem.readBinaryFile(path)); },
    openURL(u) { return N().os.open(u); },
    async storageInfo() { return null; },
    async writeClipboard(t) { try { await N().clipboard.writeText(t); return true; } catch { return false; } }
  };
  return p;
}
