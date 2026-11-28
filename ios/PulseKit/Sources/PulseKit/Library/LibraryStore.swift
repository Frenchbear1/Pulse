#if os(iOS)
import Foundation
import Observation

public struct ScanProgress: Equatable, Sendable {
    public var label: String
    public var done: Int
    public var total: Int
    /// iCloud files that were asked to download and will be picked up on the next scan.
    public var waitingForDownload: Int
    public var fraction: Double { total > 0 ? Double(done) / Double(total) : 0 }
}

/// Owns the library: folders added from the Files app, scanning, metadata, artwork, playlists,
/// likes and play counts. Persists to `library.json` in the App Group (JSON rather than SwiftData:
/// it mirrors the web app's db one-to-one, makes backups trivial, and the widget/intents can read
/// a small snapshot without a database stack).
@MainActor @Observable
public final class LibraryStore {
    public static let shared = LibraryStore()

    public private(set) var db = LibraryDatabase()
    public private(set) var index = LibraryIndex()
    public private(set) var scan: ScanProgress?
    public private(set) var isLoaded = false
    public private(set) var lastError: String?

    /// Called after any change (debounced) - the app uses it to refresh widgets and the watch.
    @ObservationIgnored public var onDidChange: (() -> Void)?

    @ObservationIgnored private var saveTask: Task<Void, Never>?
    @ObservationIgnored private var changeTask: Task<Void, Never>?
    /// Resolved root URLs whose security-scoped access is currently open (rootID -> URL).
    @ObservationIgnored private var openRoots: [String: URL] = [:]
    /// Roots asked to rescan while another scan was running; picked up when it finishes.
    @ObservationIgnored private var rescanQueue: [String] = []
    @ObservationIgnored public let artwork = ArtworkCache.shared

    public init() {}

    // MARK: - Loading & saving

    public func load() async {
        guard !isLoaded else { return }
        let url = AppGroup.libraryURL
        let loaded = await Task.detached(priority: .userInitiated) { JSONFile.read(LibraryDatabase.self, from: url) }.value
        db = loaded ?? LibraryDatabase()
        db.repairTree()
        ensureDocumentsRoot()
        reindex()
        isLoaded = true
    }

    /// Apply a change to the database, then save (debounced) and notify.
    public func mutate(reindex needsIndex: Bool = false, _ change: (inout LibraryDatabase) -> Void) {
        change(&db)
        if needsIndex { reindex() }
        scheduleSave()
    }

    public func saveNow() async {
        saveTask?.cancel()
        let snapshot = db, url = AppGroup.libraryURL
        await Task.detached(priority: .utility) { try? JSONFile.write(snapshot, to: url) }.value
    }

    private func scheduleSave() {
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(800))
            guard !Task.isCancelled, let self else { return }
            await self.saveNow()
        }
        changeTask?.cancel()
        changeTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            self?.onDidChange?()
        }
    }

    private func reindex() { index = LibraryIndex(db) }

    // MARK: - Convenience mutations used across the app

    public func song(_ id: SongID?) -> Song? { id.flatMap { db.songs[$0] } }
    public func isLiked(_ id: SongID?) -> Bool { id.map(db.isLiked) ?? false }
    public func toggleLike(_ id: SongID) { mutate { $0.setLiked(id, !$0.isLiked(id)) } }
    public func setLiked(_ id: SongID, _ v: Bool) { mutate { $0.setLiked(id, v) } }
    public func recordPlay(_ id: SongID) { mutate { $0.recordPlay(id) } }
    public func noteOpened(_ item: LibraryItemID) { mutate { $0.noteOpened(item) } }

    /// Liked songs, newest like first (web "Liked Songs").
    public var likedSongIDs: [SongID] {
        db.liked.filter { db.songs[$0.key] != nil }.sorted { $0.value > $1.value }.map(\.key)
    }
    public var recentlyPlayedIDs: [SongID] { db.history.filter { db.songs[$0] != nil } }
    /// "On Repeat": most played, top 200.
    public var mostPlayedIDs: [SongID] {
        db.playCounts.filter { db.songs[$0.key] != nil }.sorted { $0.value > $1.value }.prefix(200).map(\.key)
    }
    public var recentlyAddedAlbums: [LibraryIndex.Album] {
        Array(index.albums.sorted { $0.added > $1.added }.prefix(14))
    }

    /// Up to four distinct covers for an auto-mosaic playlist cover.
    public func mosaicArtworkKeys(for item: LibraryItemID) -> [String] {
        var seen = Set<String>(), out: [String] = []
        for id in db.songIDs(in: item) {
            guard let k = db.songs[id]?.artworkKey, seen.insert(k).inserted else { continue }
            out.append(k)
            if out.count == 4 { break }
        }
        return out
    }

    /// A playlist/folder's own cover, else its first song's.
    public func artworkKey(for item: LibraryItemID) -> String? {
        switch item {
        case .playlist(let id): if let k = db.playlists[id]?.artworkKey { return k }
        case .folder(let id): if let k = db.folders[id]?.artworkKey { return k }
        }
        return mosaicArtworkKeys(for: item).first
    }

    public func accentHex(forArtwork key: String?) -> String {
        key.flatMap { db.artwork[$0]?.colorHex } ?? AccentPalette.defaultHex
    }

    /// Custom cover for a playlist or folder from image bytes (Photos / Files).
    public func setCover(_ data: Data?, for item: LibraryItemID) {
        var key: String?
        if let data, let stored = artwork.store(data, keyPrefix: "pl") {
            key = stored.key
            db.artwork[stored.key] = stored.info
        }
        mutate { db in
            switch item {
            case .playlist(let id): db.playlists[id]?.artworkKey = key
            case .folder(let id): db.folders[id]?.artworkKey = key
            }
        }
        collectArtworkGarbage()
    }

    // MARK: - Roots (folders from the Files app)

    /// Pulse's Documents folder is always a root, so files dropped in via Files/Finder appear.
    private func ensureDocumentsRoot() {
        if !db.roots.contains(where: { $0.id == LibraryRoot.documentsID }) {
            db.roots.insert(LibraryRoot(id: LibraryRoot.documentsID, name: "On This iPhone", kind: .appDocuments), at: 0)
        }
    }

    public static var documentsURL: URL { FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0] }
    public static var importedURL: URL {
        let u = documentsURL.appendingPathComponent("Imported", isDirectory: true)
        try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
        return u
    }

    /// Add a folder picked with `.fileImporter(allowedContentTypes: [.folder])`.
    /// The picker hands us a security-scoped URL; we turn it into a bookmark so access survives
    /// relaunches (iOS has no `.withSecurityScope` option - plain bookmark data from a scoped URL
    /// carries the scope on iOS).
    public func addFolder(_ url: URL) async {
        let didStart = url.startAccessingSecurityScopedResource()
        do {
            let bookmark = try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
            let id = "r" + StableHash.fnv1a64(url.standardizedFileURL.path)
            if !db.roots.contains(where: { $0.id == id }) {
                db.roots.append(LibraryRoot(id: id, name: url.lastPathComponent, kind: .bookmarkedFolder, bookmark: bookmark))
            } else if let i = db.roots.firstIndex(where: { $0.id == id }) {
                db.roots[i].bookmark = bookmark
            }
            openRoots[id] = url
            scheduleSave()
            await rescan(rootID: id)
        } catch {
            if didStart { url.stopAccessingSecurityScopedResource() }
            lastError = "Couldn't add \(url.lastPathComponent): \(error.localizedDescription)"
        }
    }

    public func removeRoot(_ rootID: String) {
        guard rootID != LibraryRoot.documentsID else { return }
        openRoots.removeValue(forKey: rootID)?.stopAccessingSecurityScopedResource()
        mutate(reindex: true) { db in
            db.roots.removeAll { $0.id == rootID }
            db.removeSongs(db.songs.values.filter { $0.rootID == rootID }.map(\.id))
        }
        collectArtworkGarbage()
    }

    /// Resolve (and open access to) a root's folder.
    public func url(for root: LibraryRoot) -> URL? {
        if let open = openRoots[root.id] { return open }
        switch root.kind {
        case .appDocuments:
            return Self.documentsURL
        case .bookmarkedFolder:
            guard let data = root.bookmark else { return nil }
            var stale = false
            guard let url = try? URL(resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale) else {
                lastError = "Pulse lost access to “\(root.name)”. Add the folder again in Settings > Library."
                return nil
            }
            // Access stays open for the app's lifetime; playback reads files at any moment.
            _ = url.startAccessingSecurityScopedResource()
            if stale, let fresh = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil),
               let i = db.roots.firstIndex(where: { $0.id == root.id }) {
                db.roots[i].bookmark = fresh
                scheduleSave()
            }
            openRoots[root.id] = url
            return url
        }
    }

    /// File URL for playback / sharing / watch sync.
    public func fileURL(for song: Song) -> URL? {
        guard let root = db.roots.first(where: { $0.id == song.rootID }), let base = url(for: root) else { return nil }
        return base.appendingPathComponent(song.relativePath)
    }

    // MARK: - Importing single files ("Open in Pulse", share sheet, file picker)

    /// Copies files into Documents/Imported and scans them. Returns how many were added.
    @discardableResult
    public func importFiles(_ urls: [URL]) async -> Int {
        let dest = Self.importedURL
        var copied = 0
        for src in urls {
            let scoped = src.startAccessingSecurityScopedResource()
            defer { if scoped { src.stopAccessingSecurityScopedResource() } }
            guard FolderScanner.audioExtensions.contains(src.pathExtension.lowercased()) else { continue }
            var target = dest.appendingPathComponent(src.lastPathComponent)
            var n = 2
            while FileManager.default.fileExists(atPath: target.path) {
                let stem = src.deletingPathExtension().lastPathComponent
                target = dest.appendingPathComponent("\(stem) \(n).\(src.pathExtension)"); n += 1
            }
            // NSFileCoordinator so files from iCloud Drive / file providers are fully materialised.
            var coordError: NSError?
            var copyError: Error?
            NSFileCoordinator().coordinate(readingItemAt: src, options: .forUploading, error: &coordError) { readURL in
                do { try FileManager.default.copyItem(at: readURL, to: target) } catch { copyError = error }
            }
            if coordError == nil, copyError == nil { copied += 1 }
        }
        if copied > 0 { await rescan(rootID: LibraryRoot.documentsID) }
        return copied
    }

    // MARK: - Scanning

    public func rescanAll() async {
        for root in db.roots { await rescan(rootID: root.id) }
    }

    /// Diff a root against the library: new and changed files are read, missing ones removed.
    public func rescan(rootID: String) async {
        guard scan == nil else {
            if !rescanQueue.contains(rootID) { rescanQueue.append(rootID) }
            return
        }
        guard let root = db.roots.first(where: { $0.id == rootID }), let base = url(for: root) else { return }
        scan = ScanProgress(label: "Scanning \(root.name)", done: 0, total: 0, waitingForDownload: 0)
        defer {
            scan = nil
            if !rescanQueue.isEmpty {
                let nextID = rescanQueue.removeFirst()
                Task { await self.rescan(rootID: nextID) }
            }
        }

        let (files, pending) = await Task.detached(priority: .userInitiated) { FolderScanner.list(base) }.value
        let byID = Dictionary(files.map { (Song.makeID(rootID: rootID, relativePath: $0.relativePath), $0) },
                              uniquingKeysWith: { a, _ in a })

        // Missing files leave the library (and their playlists / stats).
        let gone = db.songs.values.filter { $0.rootID == rootID && byID[$0.id] == nil }.map(\.id)
        if !gone.isEmpty { db.removeSongs(gone) }

        // New files, or files whose size/date changed since we read them (e.g. tags edited).
        let todo = byID.filter { id, f in
            guard let s = db.songs[id] else { return true }
            if s.lyricsSidecar != f.lyricsSidecar { db.songs[id]?.lyricsSidecar = f.lyricsSidecar; db.songs[id]?.hasLyrics = f.lyricsSidecar != nil || db.lyrics[id] != nil }
            return s.fileSize != f.size || s.modified != f.modified
        }
        scan?.total = todo.count
        scan?.waitingForDownload = pending

        let cache = artwork
        var applied = 0
        await withTaskGroup(of: SongBuild?.self) { group in
            var it = todo.makeIterator()
            func addNext() -> Bool {
                guard let (id, file) = it.next() else { return false }
                let previous = db.songs[id]
                group.addTask { await SongBuild.make(id: id, rootID: rootID, file: file, previous: previous, artwork: cache) }
                return true
            }
            for _ in 0..<4 { if !addNext() { break } }   // 4 files at a time keeps the UI smooth
            while let result = await group.next() {
                if let b = result { apply(b); applied += 1 }
                scan?.done += 1
                if applied % 250 == 0 { reindex() }      // let big first scans show up as they go
                _ = addNext()
            }
        }

        if let i = db.roots.firstIndex(where: { $0.id == rootID }) { db.roots[i].lastScan = Date() }
        db.session?.queue.prune { db.songs[$0] != nil }
        reindex()
        scheduleSave()
        collectArtworkGarbage()
    }

    private func apply(_ b: SongBuild) {
        db.songs[b.song.id] = b.song
        if let art = b.artwork { db.artwork[art.key] = art.info }
        if let lyr = b.lyrics { db.lyrics[b.song.id] = lyr }
    }

    private func collectArtworkGarbage() {
        let used = db.referencedArtworkKeys
        db.artwork = db.artwork.filter { used.contains($0.key) }
        let cache = artwork
        Task.detached(priority: .background) { cache.collectGarbage(keeping: used) }
    }

    // MARK: - Lyrics

    public func lyrics(for song: Song) async -> Lyrics? {
        if let rel = song.lyricsSidecar, let root = db.roots.first(where: { $0.id == song.rootID }),
           let base = url(for: root) {
            let url = base.appendingPathComponent(rel)
            if let text = await Task.detached(operation: { try? String(contentsOf: url, encoding: .utf8) }).value {
                return LyricsParser.parse(text, source: "Synced lyrics (.lrc)")
            }
        }
        if let text = db.lyrics[song.id] { return LyricsParser.parse(text, source: "Embedded lyrics") }
        return nil
    }

    // MARK: - Deleting

    /// Remove songs from Pulse. With `deleteFiles`, files are also deleted from disk (only offered
    /// in the UI for files inside Pulse's own Documents folder).
    public func remove(_ ids: [SongID], deleteFiles: Bool) {
        if deleteFiles {
            for id in ids { if let s = db.songs[id], let url = fileURL(for: s) { try? FileManager.default.removeItem(at: url) } }
        }
        mutate(reindex: true) { $0.removeSongs(ids) }
        collectArtworkGarbage()
    }

    // MARK: - Widget / Siri snapshot

    public func makeSnapshot() -> LibrarySnapshot {
        func summary(_ item: LibraryItemID) -> LibrarySnapshot.PlaylistSummary? {
            let name = db.name(of: item)
            guard !name.isEmpty else { return nil }
            let path = db.parentID(of: item).map { db.path(to: $0).map(\.name).joined(separator: " / ") } ?? ""
            let art = artworkKey(for: item)
            return .init(id: item.rawID, name: name, folderPath: path, songCount: db.songIDs(in: item).count,
                         accentHex: accentHex(forArtwork: art), artworkFile: art.flatMap { artwork.exportWidgetThumbnail($0) },
                         isFolder: item.isFolder)
        }
        let playlists = db.flattenedPlaylists().compactMap { summary(.playlist($0.playlist.id)) }
        return LibrarySnapshot(playlists: playlists, recent: db.recentItems.prefix(8).compactMap(summary),
                               likedCount: likedSongIDs.count, songCount: db.songs.count)
    }

    // MARK: - Backup (web <-> native)

    /// Restore playlists, folders, likes and play counts from a Pulse backup made by the web or
    /// Windows app (Settings > Data > Backup library).
    public func importBackup(_ data: Data) throws -> BackupImporter.Result {
        var copy = db
        let result = try BackupImporter.apply(data, to: &copy)
        mutate(reindex: false) { $0 = copy }
        return result
    }
}

/// Everything learned about one file, built off the main actor.
struct SongBuild: Sendable {
    var song: Song
    var artwork: (key: String, info: ArtworkInfo)?
    var lyrics: String?

    static func make(id: SongID, rootID: String, file: ScannedFile, previous: Song?, artwork cache: ArtworkCache) async -> SongBuild? {
        let meta = (try? await MetadataReader.read(file.url)) ?? SongMetadata()
        let guess = TextNormalizer.guessFromFileName(file.fileName)

        var art: (key: String, info: ArtworkInfo)?
        if let data = meta.artwork, let stored = cache.store(data) { art = stored }
        else if let folderArt = file.folderArt, let data = try? Data(contentsOf: folderArt), let stored = cache.store(data) { art = stored }

        let song = Song(
            id: id, rootID: rootID, relativePath: file.relativePath, fileName: file.fileName, directories: file.directories,
            title: meta.title ?? guess.title,
            artist: meta.artist ?? guess.artist ?? "",
            albumArtist: meta.albumArtist ?? "",
            album: meta.album ?? file.directories.last ?? "",
            albumIsGuess: meta.album == nil,
            year: meta.year, genre: meta.genre ?? "", trackNumber: meta.trackNumber, discNumber: meta.discNumber,
            duration: meta.duration, bitrate: meta.bitrate, sampleRate: meta.sampleRate, composer: meta.composer ?? "",
            bpm: meta.bpm, isrc: meta.isrc ?? "", artworkKey: art?.key ?? previous?.artworkKey,
            hasLyrics: meta.lyrics != nil || file.lyricsSidecar != nil, lyricsSidecar: file.lyricsSidecar,
            fileSize: file.size, modified: file.modified,
            added: previous?.added ?? Date())   // keep "Recently added" stable across re-reads
        return SongBuild(song: song, artwork: art, lyrics: meta.lyrics)
    }
}
#endif
