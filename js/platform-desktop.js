// Windows desktop adapter (Neutralinojs). Reads music straight from your folders,
// streams via the built-in local server (with HTTP range support) and caches covers as files.
import { isAudio } from './tags.js';
import { hashStr, cachedReader, debounce } from './util.js';

const N = () => window.Neutralino;
const IMG_NAMES = ['cover', 'folder', 'front', 'album', 'albumart', 'albumartsmall'];

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
      try { await N().server.mount('/covers', coverDir); } catch {}
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
    async mountRoot(root) {
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
    trackURL(t) { return location.origin + '/m_' + t.root + '/' + t.rel.split('/').map(encodeURIComponent).join('/'); },
    audioURL(t) { return Promise.resolve(p.trackURL(t)); },
    releaseAudio() {},
    async reader(t) {
      const url = p.trackURL(t);
      const first = await fetch(url, { headers: { Range: 'bytes=0-65535' } });
      const cr = first.headers.get('Content-Range');
      const size = cr ? +cr.split('/')[1] : +(first.headers.get('Content-Length') || 0);
      const firstBuf = await first.arrayBuffer();
      const raw = async (pos, len) => {
        if (pos === 0 && len <= firstBuf.byteLength) return firstBuf.slice(0, len);
        const r = await fetch(url, { headers: { Range: `bytes=${pos}-${pos + len - 1}` } });
        return r.arrayBuffer();
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
    async hasCover(key) { try { await N().filesystem.getStats(coverDir + '/' + key + '.jpg'); return true; } catch { return false; } },
    async saveCover(key, big, small) {
      await N().filesystem.writeBinaryFile(coverDir + '/' + key + '.jpg', await big.arrayBuffer());
      await N().filesystem.writeBinaryFile(coverDir + '/' + key + '_s.jpg', await small.arrayBuffer());
    },
    async deleteCover(key) { for (const s of ['.jpg', '_s.jpg']) { try { await N().filesystem.remove(coverDir + '/' + key + s); } catch {} } },
    coverURL(key, small) { return key ? Promise.resolve(location.origin + '/covers/' + key + (small ? '_s' : '') + '.jpg') : Promise.resolve(null); },
    coverURLSync(key, small) { return key ? location.origin + '/covers/' + key + (small ? '_s' : '') + '.jpg' : null; },

    // ---- window ----
    win: {
      minimize: () => N().window.minimize(),
      async toggleMax() { (await N().window.isMaximized()) ? N().window.unmaximize() : N().window.maximize(); },
      close: () => p.emit('close'),
      exit: () => N().app.exit(),
      drag: () => N().window.beginDrag().catch(() => {}),
      setSize: (w, h, resizable = true) => N().window.setSize({ width: Math.round(w), height: Math.round(h), resizable, minWidth: 200, minHeight: 60 }),
      getSize: () => N().window.getSize(),
      getPos: () => N().window.getPosition(),
      move: (x, y) => N().window.move(Math.round(x), Math.round(y)),
      onTop: (v) => N().window.setAlwaysOnTop(!!v),
      isMax: () => N().window.isMaximized(),
      unmax: () => N().window.unmaximize(),
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
