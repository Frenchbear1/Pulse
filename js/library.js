// Library: database, indexes, scanning/importing, playlists & tiered folders.
import { readTags } from './tags.js';
import { hashStr, hashBytes, pool, processCover, debounce, norm, sortKey, uid } from './util.js';

export const primaryArtist = (a) => String(a || '').split(/\s*(?:;|,|\/| feat\.? | ft\.? | featuring | & | x | with )\s*/i)[0].trim();
export const albumKeyOf = (t) => norm(t.albumArtist || primaryArtist(t.artist) || 'Unknown Artist') + '\u0001' + norm(t.album || 'Unknown Album');
export const lib = {
  db: null, P: null,
  idx: { albums: new Map(), artists: new Map(), genres: new Map(), folders: null, search: new Map() },
  listeners: new Set(),
  scanning: null,
  on(fn) { this.listeners.add(fn); },
  emit(what, data) { this.listeners.forEach((f) => f(what, data)); },

  async load(P) {
    this.P = P;
    const db = (await P.loadDB()) || {};
    this.db = Object.assign({ v: 1, roots: [], tracks: {}, lyrics: {}, covers: {}, nodes: {}, rootNodes: [], liked: {}, plays: {}, last: {}, history: [], session: null }, db);
    this.reindex();
  },
  save: null,
  saveNow() { return this.P.saveDB(this.db).catch((e) => console.warn('save failed', e)); },

  track(id) { return this.db.tracks[id]; },
  get allTracks() { return Object.values(this.db.tracks); },

  reindex(quiet) {
    const albums = new Map(), artists = new Map(), genres = new Map(), search = new Map();
    const folders = { name: 'Folders', children: new Map(), tracks: [], key: '' };
    for (const t of Object.values(this.db.tracks)) {
      const aa = t.albumArtist || primaryArtist(t.artist) || 'Unknown Artist';
      const ak = norm(aa) + '\u0001' + norm(t.album || 'Unknown Album');
      let al = albums.get(ak);
      if (!al) albums.set(ak, al = { key: ak, name: t.album || 'Unknown Album', artist: aa, year: t.year || 0, cover: t.cover, tracks: [] });
      al.tracks.push(t.id); if (!al.cover && t.cover) al.cover = t.cover; if (!al.year && t.year) al.year = t.year;
      const names = new Set(String(t.artist || 'Unknown Artist').split(/\s*(?:;|,|\/| feat\.? | ft\.? | & | x )\s*/i).filter(Boolean));
      if (t.albumArtist) names.add(t.albumArtist);
      for (const n of names) {
        const k = norm(n); let ar = artists.get(k);
        if (!ar) artists.set(k, ar = { key: k, name: n, tracks: [], albums: new Set(), cover: null });
        ar.tracks.push(t.id); ar.albums.add(ak); if (!ar.cover && t.cover) ar.cover = t.cover;
      }
      const g = t.genre || ''; if (g) { const gk = norm(g); if (!genres.has(gk)) genres.set(gk, { key: gk, name: g, tracks: [] }); genres.get(gk).tracks.push(t.id); }
      // physical folder tree: root -> dirs
      const root = this.db.roots.find((r) => r.id === t.root);
      let node = folders; const segs = [root ? root.name : 'Imported', ...(t.dirs || [])];
      let key = '';
      for (const s of segs) { key += '/' + s; if (!node.children.has(s)) node.children.set(s, { name: s, children: new Map(), tracks: [], key, cover: null }); node = node.children.get(s); if (!node.cover && t.cover) node.cover = t.cover; }
      node.tracks.push(t.id);
      search.set(t.id, norm([t.title, t.artist, t.album, t.albumArtist, t.genre, t.composer, t.year].join(' ')));
    }
    for (const al of albums.values()) al.tracks.sort((a, b) => { const x = this.db.tracks[a], y = this.db.tracks[b]; return (x.disc || 1) - (y.disc || 1) || (x.track || 0) - (y.track || 0) || sortKey(x.title).localeCompare(sortKey(y.title)); });
    this.idx = { albums, artists, genres, folders, search };
    this.emit('index', quiet ? { quiet: true } : null);
  },
  folderNode(key) {
    let n = this.idx.folders; if (!key) return n;
    for (const s of key.split('/').filter(Boolean)) { n = n.children.get(s); if (!n) return null; }
    return n;
  },
  folderAllTracks(n, out = []) { out.push(...n.tracks); for (const c of n.children.values()) this.folderAllTracks(c, out); return out; },

  search(q, limit = 300) {
    const toks = norm(q).split(/\s+/).filter(Boolean); if (!toks.length) return [];
    const res = [];
    for (const [id, s] of this.idx.search) {
      if (!toks.every((t) => s.includes(t))) continue;
      const t = this.db.tracks[id]; const ti = norm(t.title);
      let score = 0; if (ti.startsWith(toks[0])) score += 3; if (ti.includes(toks.join(' '))) score += 2; if (norm(t.artist).includes(toks[0])) score += 1; score += Math.min(2, (this.db.plays[id] || 0) / 10);
      res.push([score, id]);
    }
    return res.sort((a, b) => b[0] - a[0]).slice(0, limit).map((r) => r[1]);
  },

  // ----- scanning (desktop) / importing (web) -----
  coverJobs: new Map(),
  coverErrors: [],
  // Manual "find missing covers": clears give-up marks and waits for the queue to drain
  async repairCovers(onProgress) {
    const todo = Object.values(this.db.tracks).filter((t) => !t.cover).map((t) => t.id);
    if (!todo.length) return { fixed: 0, total: 0 };
    const Q = this.coverQ; for (const id of todo) Q.tried.delete(id);
    const f0 = Q.found, d0 = Q.done;
    this.wantCovers(todo, false);
    await new Promise((res) => { const iv = setInterval(() => { onProgress?.(Math.min(todo.length, Q.done - d0), todo.length); if (!Q.high.length && !Q.low.length && !Q.running) { clearInterval(iv); res(); } }, 300); });
    this.reindex(true); await this.saveNow();
    return { fixed: Q.found - f0, total: todo.length };
  },
  async ensureCover(key, getBytes) {
    if (this.db.covers[key]) return key;
    if (this.coverJobs.has(key)) return this.coverJobs.get(key);
    const job = (async () => {
      try {
        const pic = await getBytes(); if (!pic) return null;
        const { big, small, color } = await processCover(pic.data, pic.mime);
        if (!big || !small) return null;
        await this.P.saveCover(key, big, small);
        this.db.covers[key] = { color: color || '#666666' };
        return key;
      } catch (e) { console.warn('cover', e); this.coverErrors.unshift(String(e?.message || e)); this.coverErrors.length = Math.min(this.coverErrors.length, 5); return null; }
    })();
    this.coverJobs.set(key, job);
    return job;
  },
  async parseInto(stub) {
    const r = await this.P.reader(stub);
    const tags = await readTags(r, stub.name);
    const t = Object.assign({}, stub, {
      title: tags.title || stub.name, artist: tags.artist || '', albumArtist: tags.albumArtist || '', album: tags.album || (stub.dirs?.length ? stub.dirs[stub.dirs.length - 1] : ''), albumGuess: !tags.album,
      year: tags.year || 0, genre: tags.genre || '', track: tags.track || 0, disc: tags.disc || 0, duration: tags.duration || 0,
      bitrate: tags.bitrate || 0, sampleRate: tags.sampleRate || 0, bitDepth: tags.bitDepth || 0, composer: tags.composer || '', bpm: tags.bpm || 0, isrc: tags.isrc || '',
      size: r.size, mtime: stub.mtime || 0, added: stub.added || Date.now(), cover: null, hasLyrics: !!tags.lyrics || !!stub.lrc
    });
    if (tags.lyrics) this.db.lyrics[t.id] = tags.lyrics;
    if (tags.picture) t.cover = await this.ensureCover(hashBytes(tags.picture.data), async () => tags.picture);
    else if (stub.folderArt) t.cover = await this.ensureCover(hashStr((stub.root || '') + '|' + (stub.dirs || []).join('/') + '|' + stub.folderArt), () => this.P.readFolderArt(stub));
    return t;
  },
  async gcCovers() {
    const used = new Set(Object.values(this.db.tracks).map((t) => t.cover).filter(Boolean));
    for (const n of Object.values(this.db.nodes)) if (n.cover) used.add(n.cover);
    for (const k of Object.keys(this.db.covers)) if (!used.has(k)) { delete this.db.covers[k]; this.coverJobs.delete(k); try { await this.P.deleteCover(k); } catch {} }
  },
  removeTracks(ids) {
    const set = new Set(ids);
    for (const id of ids) { delete this.db.tracks[id]; delete this.db.lyrics[id]; delete this.db.liked[id]; delete this.db.plays[id]; delete this.db.last[id]; }
    for (const n of Object.values(this.db.nodes)) if (n.tracks) n.tracks = n.tracks.filter((x) => !set.has(x));
    this.db.history = this.db.history.filter((x) => !set.has(x));
  },

  async runJobs(stubs, label, commit) {
    const st = this.scanning = { label, done: 0, total: stubs.length };
    this.emit('scan', st);
    // during big imports: refresh the index + save at most every few seconds, in idle time, without telling the UI
    let lastFlush = 0; const idle = window.requestIdleCallback || ((f) => setTimeout(f, 50));
    const flush = () => { if (Date.now() - lastFlush < 4000) return; lastFlush = Date.now(); idle(() => { this.reindex(true); this.save(); }, { timeout: 2000 }); };
    await pool(stubs, this.P.kind === 'web' ? 3 : 6, async (s) => {
      try { if (commit) await commit(s); const t = await this.parseInto(s); this.db.tracks[t.id] = t; if (t.cover) this.emit('cover', { id: t.id, key: t.cover }); }
      catch (e) { console.warn('parse failed', s.rel, e); }
      st.done++; this.emit('scan', st); flush();
    });
    this.scanning = null; this.reindex(); await this.saveNow(); this.emit('scan', null);
  },

  async addRoot(root) {
    if (this.db.roots.some((r) => r.id === root.id)) return this.rescan(root);
    this.db.roots.push(root); await this.rescan(root);
  },
  async rescanAll() { for (const r of this.db.roots) if (r.path) await this.rescan(r); },
  STABLE_MS: 6000,
  async rescan(root) {
    if (this.P.kind !== 'desktop') return;
    if (this._rescanning) { this._rescanAgain = true; return; } // something changed mid-scan: run again after
    this._rescanning = true;
    let retryLater = false;
    try {
      const stubs = await this.P.listRoot(root);
      const have = new Set(stubs.map((s) => s.id));
      const gone = Object.values(this.db.tracks).filter((t) => t.root === root.id && !have.has(t.id)).map((t) => t.id);
      for (const s of stubs) { const t = this.db.tracks[s.id]; if (t) { t.lrc = s.lrc; if (s.lrc) t.hasLyrics = true; if (s.folderArt) t.folderArt = s.folderArt; } }
      if (gone.length) { this.removeTracks(gone); await this.gcCovers(); }
      const now = Date.now(), ready = [];
      // 1) new files: only read once they've stopped changing (downloaders add tags/cover after the audio)
      await pool(stubs.filter((s) => !this.db.tracks[s.id]), 8, async (s) => {
        const st = await this.P.stat(s).catch(() => null); if (!st) return;
        s.mtime = st.mtime; s.size = st.size;
        if (now - st.mtime < this.STABLE_MS) retryLater = true; else ready.push(s);
      });
      // 2) known files that changed since we read them (e.g. cover embedded later) get read again
      const check = Object.values(this.db.tracks).filter((t) => t.root === root.id && have.has(t.id) && (!t.cover || !t.mtime || now - (t.added || 0) < 30 * 60000));
      await pool(check, 8, async (t) => {
        const st = await this.P.stat(t).catch(() => null); if (!st) return;
        if (!t.mtime && t.cover) { t.mtime = st.mtime; t.size = st.size; return; } // older entry that's fine: just remember its stamp
        if (st.mtime === t.mtime && st.size === t.size) return;
        if (now - st.mtime < this.STABLE_MS) { retryLater = true; return; }
        ready.push({ id: t.id, root: t.root, rel: t.rel, name: t.name, dirs: t.dirs, lrc: t.lrc, folderArt: t.folderArt, added: t.added, mtime: st.mtime, size: st.size, _reread: true });
      });
      if (ready.length) await this.runJobs(ready, 'Scanning ' + root.name);
      else if (gone.length) { this.reindex(); await this.saveNow(); }
      this.P.watchRoot?.(root);
    } finally {
      this._rescanning = false;
      if (this._rescanAgain) { this._rescanAgain = false; setTimeout(() => this.rescanAll(), 300); }
      else if (retryLater) { clearTimeout(this._retryT); this._retryT = setTimeout(() => this.rescanAll(), this.STABLE_MS + 800); }
      this.wantCovers(Object.keys(this.db.tracks), false);
    }
  },

  // ----- cover queue: runs alongside scans; current song + queue jump the line -----
  coverQ: { high: [], low: [], queued: new Set(), active: new Set(), running: 0, tried: new Map(), done: 0, found: 0 },
  wantCovers(ids, high) {
    const Q = this.coverQ;
    for (const id of ids) {
      const t = this.db.tracks[id]; if (!t || t.cover) continue;
      const tr = Q.tried.get(id); if (tr && tr.mtime === t.mtime && tr.n >= 2) continue; // gave up on this exact file version
      if (Q.active.has(id)) continue; // already being worked on
      if (Q.queued.has(id)) { if (high && !Q.high.includes(id)) { Q.low = Q.low.filter((x) => x !== id); Q.high.push(id); } continue; }
      Q.queued.add(id); (high ? Q.high : Q.low).push(id);
    }
    if (high && Q.high.length > 1) { const order = new Map(ids.map((id, i) => [id, i])); Q.high.sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9)); }
    this.pumpCovers();
  },
  pumpCovers() {
    const Q = this.coverQ; const max = this.P.kind === 'web' ? 2 : 3;
    // priority songs get two reserved slots so they never wait behind the library backlog
    while ((Q.high.length && Q.running < max + 2) || (Q.low.length && Q.running < max)) {
      const id = Q.high.length ? Q.high.shift() : Q.low.shift();
      Q.running++; Q.active.add(id);
      this.coverOne(id).catch(() => {}).finally(() => { Q.running--; Q.queued.delete(id); Q.active.delete(id); if (!Q.high.length && !Q.low.length && !Q.running) this.emit('coversIdle'); this.pumpCovers(); });
    }
  },
  async coverOne(id) {
    const t = this.db.tracks[id]; if (!t || t.cover) return;
    const Q = this.coverQ;
    try {
      const r = await this.P.reader(t); const tags = await readTags(r, t.name);
      let key = null;
      if (tags.picture) key = await this.ensureCover(hashBytes(tags.picture.data), async () => tags.picture);
      if (!key && t.folderArt && this.P.kind === 'desktop') key = await this.ensureCover(hashStr((t.root || '') + '|' + (t.dirs || []).join('/') + '|' + t.folderArt), () => this.P.readFolderArt(t));
      // pick up tags that weren't there on the first read too
      if (tags.title && (t.title === t.name || !t.artist)) { t.title = tags.title; t.artist = tags.artist || t.artist; t.album = tags.album || t.album; if (tags.album) t.albumGuess = false; t.albumArtist = tags.albumArtist || t.albumArtist; t.year = tags.year || t.year; t.genre = tags.genre || t.genre; t.track = tags.track || t.track; }
      if (tags.lyrics && !this.db.lyrics[id]) { this.db.lyrics[id] = tags.lyrics; t.hasLyrics = true; }
      if (tags.isrc && !t.isrc) t.isrc = tags.isrc;
      if (key && this.db.tracks[id]) {
        t.cover = key; Q.found++; this.save(); this.emit('cover', { id, key });
        this._coverReindex ||= debounce(() => this.reindex(true), 1500); this._coverReindex();
      } else { const tr = Q.tried.get(id); Q.tried.set(id, { mtime: t.mtime, n: tr && tr.mtime === t.mtime ? tr.n + 1 : 1 }); }
    } catch (e) {
      this.coverErrors.unshift(String(e?.message || e)); this.coverErrors.length = Math.min(this.coverErrors.length, 5);
      const tr = Q.tried.get(id); Q.tried.set(id, { mtime: t.mtime, n: (tr?.n || 0) + 1 });
    } finally { Q.done++; }
  },
  async removeRoot(rootId) {
    this.db.roots = this.db.roots.filter((r) => r.id !== rootId);
    this.removeTracks(Object.values(this.db.tracks).filter((t) => t.root === rootId).map((t) => t.id));
    await this.gcCovers(); this.reindex(); await this.saveNow();
  },
  async importFiles(files) { // web
    if (!files.length) return 0;
    const rootId = 'import';
    if (!this.db.roots.some((r) => r.id === rootId)) this.db.roots.push({ id: rootId, name: 'On this device' });
    const stubs = this.P.prepareFiles(files, rootId).filter((s) => !this.db.tracks[s.id]);
    await this.runJobs(stubs, 'Importing songs', (s) => this.P.commitFile(s));
    this.P.finishImport();
    return stubs.length;
  },
  async deleteTracks(ids, fromDisk) {
    for (const id of ids) {
      const t = this.db.tracks[id]; if (!t) continue;
      const root = this.db.roots.find((r) => r.id === t.root);
      if (this.P.kind === 'web' || fromDisk) { try { await this.P.deleteTrackFile(t, root); } catch (e) { console.warn(e); } }
    }
    this.removeTracks(ids); await this.gcCovers(); this.reindex(); await this.saveNow();
  },

  // ----- stats -----
  like(id, v) { if (v ?? !this.db.liked[id]) this.db.liked[id] = Date.now(); else delete this.db.liked[id]; this.save(); this.emit('liked', id); },
  isLiked(id) { return !!this.db.liked[id]; },
  played(id) {
    this.db.plays[id] = (this.db.plays[id] || 0) + 1; this.db.last[id] = Date.now();
    this.db.history = [id, ...this.db.history.filter((x) => x !== id)].slice(0, 300); this.save();
  },
  setDuration(id, d) { const t = this.db.tracks[id]; if (t && d && isFinite(d) && Math.abs((t.duration || 0) - d) > 1) { t.duration = d; this.save(); } },

  // ----- tiered library (folders & playlists, unlimited depth) -----
  node(id) { return this.db.nodes[id]; },
  children(parentId) { return (parentId ? this.db.nodes[parentId]?.children : this.db.rootNodes) || []; },
  createNode(type, name, parentId = null, extra = {}) {
    const n = { id: uid(), type, name: name || (type === 'folder' ? 'New folder' : 'New playlist'), parent: parentId, children: [], tracks: [], cover: null, desc: '', created: Date.now(), ...extra };
    this.db.nodes[n.id] = n;
    (parentId ? this.db.nodes[parentId].children : this.db.rootNodes).push(n.id);
    this.save(); this.emit('nodes'); return n;
  },
  renameNode(id, name) { this.db.nodes[id].name = name; this.save(); this.emit('nodes'); },
  deleteNode(id) {
    const n = this.db.nodes[id]; if (!n) return;
    for (const c of [...n.children]) this.deleteNode(c);
    const list = n.parent ? this.db.nodes[n.parent]?.children : this.db.rootNodes;
    if (list) list.splice(list.indexOf(id), 1);
    delete this.db.nodes[id]; this.save(); this.emit('nodes');
  },
  isAncestor(a, b) { let n = this.db.nodes[b]; while (n) { if (n.id === a) return true; n = this.db.nodes[n.parent]; } return false; },
  moveNode(id, newParent, index = -1) {
    const n = this.db.nodes[id]; if (!n || id === newParent || (newParent && this.isAncestor(id, newParent))) return false;
    if (newParent && this.db.nodes[newParent].type !== 'folder') return false;
    const from = n.parent ? this.db.nodes[n.parent].children : this.db.rootNodes; from.splice(from.indexOf(id), 1);
    const to = newParent ? this.db.nodes[newParent].children : this.db.rootNodes;
    if (index < 0 || index > to.length) to.push(id); else to.splice(index, 0, id);
    n.parent = newParent; this.save(); this.emit('nodes'); return true;
  },
  addToPlaylist(pid, ids) {
    const n = this.db.nodes[pid]; if (!n || n.type !== 'playlist') return 0;
    const have = new Set(n.tracks); const add = ids.filter((i) => !have.has(i)); n.tracks.push(...add);
    n.updated = Date.now(); this.save(); this.emit('nodes'); return add.length;
  },
  removeFromPlaylist(pid, idxs) { const n = this.db.nodes[pid]; const s = new Set(idxs); n.tracks = n.tracks.filter((_, i) => !s.has(i)); this.save(); this.emit('nodes'); },
  reorderPlaylist(pid, from, to) { const n = this.db.nodes[pid]; const [x] = n.tracks.splice(from, 1); n.tracks.splice(to, 0, x); this.save(); this.emit('nodes'); },
  nodeTracks(id) { // folders play everything nested
    const n = this.db.nodes[id]; if (!n) return [];
    if (n.type === 'playlist') return n.tracks.filter((t) => this.db.tracks[t]);
    const out = []; for (const c of n.children) out.push(...this.nodeTracks(c)); return [...new Set(out)];
  },
  nodePath(id) { const p = []; let n = this.db.nodes[id]; while (n) { p.unshift(n); n = this.db.nodes[n.parent]; } return p; },
  async setNodeCover(id, pic) {
    const n = this.db.nodes[id]; const old = n.cover;
    if (pic) { const key = 'pl' + hashBytes(pic.data); n.cover = await this.ensureCover(key, async () => pic); }
    else n.cover = null;
    if (old && old !== n.cover) await this.gcCovers();
    this.save(); this.emit('nodes');
  },
  // Turn a disk folder into tiered playlists (mirrors the structure)
  mirrorFolder(folderKey, parentId = null) {
    const f = this.folderNode(folderKey); if (!f) return null;
    const make = (fn, parent) => {
      if (fn.children.size) {
        const folder = this.createNode('folder', fn.name, parent);
        if (fn.tracks.length) this.createNode('playlist', fn.name + ' (loose)', folder.id, { tracks: [...fn.tracks] });
        for (const c of fn.children.values()) make(c, folder.id);
        return folder;
      }
      return this.createNode('playlist', fn.name, parent, { tracks: [...fn.tracks] });
    };
    return make(f, parentId);
  },

  // Build a copyable AI image prompt for a playlist cover
  aiPrompt(id, style) {
    const n = this.db.nodes[id]; const ids = this.nodeTracks(id);
    const count = (key) => { const m = new Map(); for (const i of ids) { const v = this.db.tracks[i]?.[key]; if (v) for (const x of String(v).split(/;|,/)) { const k = x.trim(); if (k) m.set(k, (m.get(k) || 0) + 1); } } return [...m.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]); };
    const genres = count('genre').slice(0, 3), artists = count('artist').slice(0, 4);
    const years = ids.map((i) => this.db.tracks[i]?.year).filter(Boolean).sort();
    const era = years.length ? (years[0] === years[years.length - 1] ? `${years[0]}` : `${years[0]}–${years[years.length - 1]}`) : '';
    const colors = [...new Set(ids.map((i) => this.db.covers[this.db.tracks[i]?.cover]?.color).filter(Boolean))].slice(0, 4);
    const styles = {
      auto: 'a bold, modern, minimal album-cover aesthetic',
      photo: 'a cinematic, moody photograph with shallow depth of field and film grain',
      abstract: 'abstract generative art with flowing gradients, liquid shapes and soft glow',
      retro: 'a retro 80s/90s print look: risograph texture, halftone dots, slightly faded inks',
      anime: 'a lush anime-style illustration with dramatic lighting',
      minimal: 'an ultra-minimal design: one striking symbol on a clean background, lots of negative space',
      neon: 'a neon-lit night scene, synthwave glow, reflections on wet streets'
    };
    let s = `Create a square (1:1) playlist cover image, 2048×2048, for a music playlist called "${n.name}".`;
    if (n.desc) s += ` The playlist is about: ${n.desc}.`;
    if (genres.length) s += ` Musical vibe: ${genres.join(', ')}.`;
    if (artists.length) s += ` It features artists like ${artists.join(', ')} — capture their mood, but do not depict them or use their logos.`;
    if (era) s += ` Era: ${era}.`;
    s += ` Style: ${styles[style] || styles.auto}.`;
    if (colors.length) s += ` Suggested color palette: ${colors.join(', ')}.`;
    s += ` Strong central focal point that still reads well as a small thumbnail. No text, no letters, no watermarks, no borders.`;
    return s;
  },

  exportM3U(id) {
    const ids = this.nodeTracks(id); let s = '#EXTM3U\n';
    for (const i of ids) { const t = this.db.tracks[i]; const root = this.db.roots.find((r) => r.id === t.root); s += `#EXTINF:${Math.round(t.duration || 0)},${t.artist} - ${t.title}\n${root?.path ? root.path + '/' + t.rel : t.rel}\n`; }
    return s;
  },
  importM3U(text, name) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    const byRel = new Map(); for (const t of Object.values(this.db.tracks)) { const root = this.db.roots.find((r) => r.id === t.root); byRel.set(norm(root?.path ? root.path + '/' + t.rel : t.rel).replace(/\\/g, '/'), t.id); byRel.set(norm(t.name), byRel.get(norm(t.name)) || t.id); }
    const ids = []; for (const l of lines) { const k = norm(l).replace(/\\/g, '/'); const id = byRel.get(k) || byRel.get(k.split('/').pop()); if (id) ids.push(id); }
    return this.createNode('playlist', name, null, { tracks: ids });
  }
};
lib.save = debounce(() => lib.saveNow(), 800);
