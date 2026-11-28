import Foundation

/// The whole persisted library, one Codable value written as JSON to the App Group container.
/// Deliberately the same shape as the web app's IndexedDB/JSON `db` so concepts map 1:1:
///
///   web `tracks`     -> songs          web `nodes`/`rootNodes` -> playlists + folders + rootItems
///   web `liked`      -> liked          web `plays` / `last`    -> playCounts / lastPlayed
///   web `history`    -> history        web `covers`            -> artwork
///   web `session`    -> session        web `lyrics`            -> lyrics
///
/// Pure value type: every mutation here is synchronous and testable; LibraryStore wraps it with
/// persistence, scanning and observation.
public struct LibraryDatabase: Codable, Sendable {
    public static let currentVersion = 1

    public var version = LibraryDatabase.currentVersion
    public var roots: [LibraryRoot] = []
    public var songs: [SongID: Song] = [:]
    public var artwork: [String: ArtworkInfo] = [:]
    public var lyrics: [SongID: String] = [:]

    public var playlists: [String: Playlist] = [:]
    public var folders: [String: LibraryFolder] = [:]
    /// Top level of "Your Library", in custom order.
    public var rootItems: [LibraryItemID] = []

    public var liked: [SongID: Date] = [:]
    public var playCounts: [SongID: Int] = [:]
    public var lastPlayed: [SongID: Date] = [:]
    /// Most recent first, unique, capped at 300 (web parity).
    public var history: [SongID] = []
    /// Recently opened playlists/folders, for Home + CarPlay "Recents".
    public var recentItems: [LibraryItemID] = []

    /// Queue + position restored on next launch.
    public var session: PlaybackSession?

    public init() {}

    // MARK: - Stats

    public func isLiked(_ id: SongID) -> Bool { liked[id] != nil }

    public mutating func setLiked(_ id: SongID, _ value: Bool) {
        guard songs[id] != nil else { return }
        if value { liked[id] = liked[id] ?? Date() } else { liked[id] = nil }
    }

    /// Counted once a song has played 30 s or half its length (see PlayerEngine).
    public mutating func recordPlay(_ id: SongID, at date: Date = Date()) {
        guard songs[id] != nil else { return }
        playCounts[id, default: 0] += 1
        lastPlayed[id] = date
        history.removeAll { $0 == id }
        history.insert(id, at: 0)
        if history.count > 300 { history.removeLast(history.count - 300) }
    }

    public mutating func noteOpened(_ item: LibraryItemID) {
        recentItems.removeAll { $0 == item }
        recentItems.insert(item, at: 0)
        if recentItems.count > 30 { recentItems.removeLast(recentItems.count - 30) }
    }

    /// Remove songs everywhere they are referenced (stats, playlists, history, session).
    public mutating func removeSongs(_ ids: some Sequence<SongID>) {
        let set = Set(ids)
        guard !set.isEmpty else { return }
        for id in set {
            songs[id] = nil; lyrics[id] = nil; liked[id] = nil; playCounts[id] = nil; lastPlayed[id] = nil
        }
        for key in playlists.keys { playlists[key]?.songIDs.removeAll { set.contains($0) } }
        history.removeAll { set.contains($0) }
    }

    /// Artwork keys still referenced by a song, playlist or folder.
    public var referencedArtworkKeys: Set<String> {
        var used = Set(songs.values.compactMap(\.artworkKey))
        used.formUnion(playlists.values.compactMap(\.artworkKey))
        used.formUnion(folders.values.compactMap(\.artworkKey))
        return used
    }

    // MARK: - Library tree (playlists & folders, unlimited depth)

    public func children(of folderID: String?) -> [LibraryItemID] {
        guard let folderID else { return rootItems }
        return folders[folderID]?.children ?? []
    }

    public func name(of item: LibraryItemID) -> String {
        switch item {
        case .playlist(let id): return playlists[id]?.name ?? ""
        case .folder(let id): return folders[id]?.name ?? ""
        }
    }

    public func parentID(of item: LibraryItemID) -> String? {
        switch item {
        case .playlist(let id): return playlists[id]?.parentID
        case .folder(let id): return folders[id]?.parentID
        }
    }

    @discardableResult
    public mutating func createPlaylist(named name: String = "New playlist", in folderID: String? = nil,
                                        songIDs: [SongID] = []) -> Playlist {
        let p = Playlist(name: name, parentID: validFolder(folderID), songIDs: Self.dedupe(songIDs))
        playlists[p.id] = p
        appendChild(.playlist(p.id), to: p.parentID)
        return p
    }

    @discardableResult
    public mutating func createFolder(named name: String = "New folder", in folderID: String? = nil) -> LibraryFolder {
        let f = LibraryFolder(name: name, parentID: validFolder(folderID))
        folders[f.id] = f
        appendChild(.folder(f.id), to: f.parentID)
        return f
    }

    public mutating func rename(_ item: LibraryItemID, to name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        switch item {
        case .playlist(let id): playlists[id]?.name = trimmed; playlists[id]?.updated = Date()
        case .folder(let id): folders[id]?.name = trimmed
        }
    }

    /// Deletes a playlist, or a folder together with everything nested inside it.
    public mutating func delete(_ item: LibraryItemID) {
        if case .folder(let id) = item, let f = folders[id] {
            for child in f.children { delete(child) }
        }
        removeFromParent(item)
        switch item {
        case .playlist(let id): playlists[id] = nil
        case .folder(let id): folders[id] = nil
        }
        recentItems.removeAll { $0 == item }
    }

    /// True if `ancestorFolderID` contains `item` at any depth (or is it).
    public func isAncestor(_ ancestorFolderID: String, of item: LibraryItemID) -> Bool {
        if case .folder(let id) = item, id == ancestorFolderID { return true }
        var parent = parentID(of: item)
        while let p = parent {
            if p == ancestorFolderID { return true }
            parent = folders[p]?.parentID
        }
        return false
    }

    /// Move an item into `folderID` (nil = top level) at `index` (nil/out of range = end).
    /// Refuses to move a folder into itself or one of its descendants.
    @discardableResult
    public mutating func move(_ item: LibraryItemID, to folderID: String?, at index: Int? = nil) -> Bool {
        if let folderID {
            guard folders[folderID] != nil else { return false }
            if case .folder = item, isAncestor(item.rawID, of: .folder(folderID)) { return false }
        }
        removeFromParent(item)
        switch item {
        case .playlist(let id): playlists[id]?.parentID = folderID
        case .folder(let id): folders[id]?.parentID = folderID
        }
        var list = children(of: folderID)
        if let index, index >= 0, index <= list.count { list.insert(item, at: index) } else { list.append(item) }
        setChildren(list, of: folderID)
        return true
    }

    /// Returns how many songs were actually added (already-present songs are skipped).
    @discardableResult
    public mutating func addSongs(_ ids: [SongID], toPlaylist playlistID: String) -> Int {
        guard var p = playlists[playlistID] else { return 0 }
        let have = Set(p.songIDs)
        let add = Self.dedupe(ids).filter { !have.contains($0) && songs[$0] != nil }
        p.songIDs.append(contentsOf: add)
        p.updated = Date()
        playlists[playlistID] = p
        return add.count
    }

    public mutating func removeSongs(at offsets: IndexSet, fromPlaylist playlistID: String) {
        guard var p = playlists[playlistID] else { return }
        for i in offsets.sorted(by: >) where p.songIDs.indices.contains(i) { p.songIDs.remove(at: i) }
        p.updated = Date()
        playlists[playlistID] = p
    }

    public mutating func moveSongs(from source: IndexSet, to destination: Int, inPlaylist playlistID: String) {
        guard var p = playlists[playlistID] else { return }
        let moving = source.sorted().map { p.songIDs[$0] }
        var remaining = p.songIDs.enumerated().filter { !source.contains($0.offset) }.map(\.element)
        let shift = source.filter { $0 < destination }.count
        let at = max(0, min(remaining.count, destination - shift))
        remaining.insert(contentsOf: moving, at: at)
        p.songIDs = remaining
        p.updated = Date()
        playlists[playlistID] = p
    }

    /// Songs a library item plays: a playlist's songs, or everything nested in a folder (unique,
    /// in tree order) - the web app's nodeTracks().
    public func songIDs(in item: LibraryItemID) -> [SongID] {
        switch item {
        case .playlist(let id):
            return (playlists[id]?.songIDs ?? []).filter { songs[$0] != nil }
        case .folder(let id):
            var seen = Set<SongID>(), out: [SongID] = []
            for child in folders[id]?.children ?? [] {
                for s in songIDs(in: child) where seen.insert(s).inserted { out.append(s) }
            }
            return out
        }
    }

    /// Breadcrumb from the top level down to (and including) `folderID`.
    public func path(to folderID: String) -> [LibraryFolder] {
        var out: [LibraryFolder] = []
        var cur = folders[folderID]
        while let f = cur { out.insert(f, at: 0); cur = f.parentID.flatMap { folders[$0] } }
        return out
    }

    /// Every playlist in tree order with its depth (for "Add to playlist" pickers).
    public func flattenedPlaylists() -> [(playlist: Playlist, depth: Int)] {
        var out: [(Playlist, Int)] = []
        func walk(_ items: [LibraryItemID], _ depth: Int) {
            for item in items {
                switch item {
                case .playlist(let id): if let p = playlists[id] { out.append((p, depth)) }
                case .folder(let id): walk(folders[id]?.children ?? [], depth + 1)
                }
            }
        }
        walk(rootItems, 0)
        return out
    }

    /// Repairs dangling references (e.g. after a partial restore). Cheap; run after loading.
    public mutating func repairTree() {
        func clean(_ list: [LibraryItemID]) -> [LibraryItemID] {
            var seen = Set<LibraryItemID>()
            return list.filter { item in
                let exists: Bool
                switch item {
                case .playlist(let id): exists = playlists[id] != nil
                case .folder(let id): exists = folders[id] != nil
                }
                return exists && seen.insert(item).inserted
            }
        }
        rootItems = clean(rootItems)
        for key in folders.keys { folders[key]?.children = clean(folders[key]?.children ?? []) }
        // Anything not reachable from the top goes back to the top level.
        var reachable = Set<LibraryItemID>()
        func mark(_ items: [LibraryItemID]) {
            for i in items where reachable.insert(i).inserted {
                if case .folder(let id) = i { mark(folders[id]?.children ?? []) }
            }
        }
        mark(rootItems)
        for id in playlists.keys where !reachable.contains(.playlist(id)) {
            playlists[id]?.parentID = nil; rootItems.append(.playlist(id))
        }
        for id in folders.keys where !reachable.contains(.folder(id)) {
            folders[id]?.parentID = nil; rootItems.append(.folder(id))
        }
        recentItems = clean(recentItems)
    }

    // MARK: - Helpers

    private func validFolder(_ id: String?) -> String? {
        guard let id, folders[id] != nil else { return nil }
        return id
    }

    private mutating func appendChild(_ item: LibraryItemID, to folderID: String?) {
        var list = children(of: folderID)
        list.append(item)
        setChildren(list, of: folderID)
    }

    private mutating func setChildren(_ list: [LibraryItemID], of folderID: String?) {
        if let folderID { folders[folderID]?.children = list } else { rootItems = list }
    }

    private mutating func removeFromParent(_ item: LibraryItemID) {
        let parent = parentID(of: item)
        var list = children(of: parent)
        list.removeAll { $0 == item }
        setChildren(list, of: parent)
    }

    static func dedupe(_ ids: [SongID]) -> [SongID] {
        var seen = Set<SongID>()
        return ids.filter { seen.insert($0).inserted }
    }
}

/// Saved queue so the app reopens where you left off (web: `db.session`).
public struct PlaybackSession: Codable, Sendable, Equatable {
    public var queue: PlayQueue
    public var currentSongID: SongID?
    public var position: TimeInterval
    public init(queue: PlayQueue, currentSongID: SongID?, position: TimeInterval) {
        self.queue = queue; self.currentSongID = currentSongID; self.position = position
    }
}
