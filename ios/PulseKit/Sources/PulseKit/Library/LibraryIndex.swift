import Foundation

/// Derived views of the library (Albums, Artists, Genres, on-disk Folders, search), rebuilt from
/// `LibraryDatabase` whenever songs change - the web app's lib.reindex().
public struct LibraryIndex: Sendable {
    public struct Album: Identifiable, Hashable, Sendable {
        public var id: String           // normalised "artist\u{1}album"
        public var name: String
        public var artist: String
        public var year: Int
        public var artworkKey: String?
        public var songIDs: [SongID]    // disc, track, title order
        public var added: Date
    }
    public struct Artist: Identifiable, Hashable, Sendable {
        public var id: String
        public var name: String
        public var songIDs: [SongID]
        public var albumIDs: [String]
        public var artworkKey: String?
    }
    public struct Genre: Identifiable, Hashable, Sendable {
        public var id: String
        public var name: String
        public var songIDs: [SongID]
    }
    /// A real folder on disk (root -> sub-folders), for the Folders view.
    public final class DiskFolder: Identifiable, @unchecked Sendable {
        public let id: String           // "/Root/Sub/Sub2"
        public let name: String
        public fileprivate(set) var children: [DiskFolder] = []
        public fileprivate(set) var songIDs: [SongID] = []
        public fileprivate(set) var artworkKey: String?
        fileprivate var childMap: [String: DiskFolder] = [:]
        init(id: String, name: String) { self.id = id; self.name = name }

        /// Every song at any depth below this folder.
        public var allSongIDs: [SongID] { songIDs + children.flatMap(\.allSongIDs) }
    }

    public private(set) var albums: [Album] = []
    public private(set) var artists: [Artist] = []
    public private(set) var genres: [Genre] = []
    public private(set) var diskFolders = DiskFolder(id: "", name: "Folders")
    private var albumByID: [String: Int] = [:]
    private var artistByID: [String: Int] = [:]
    private var searchText: [SongID: String] = [:]

    public init() {}

    public init(_ db: LibraryDatabase) {
        var albums: [String: Album] = [:]
        var artists: [String: Artist] = [:]
        var genres: [String: Genre] = [:]
        let root = DiskFolder(id: "", name: "Folders")
        let rootNames = Dictionary(uniqueKeysWithValues: db.roots.map { ($0.id, $0.name) })

        for song in db.songs.values {
            let aa = song.groupingArtist
            let albumID = TextNormalizer.norm(aa) + "\u{1}" + TextNormalizer.norm(song.displayAlbum)
            if albums[albumID] == nil {
                albums[albumID] = Album(id: albumID, name: song.displayAlbum, artist: aa, year: song.year,
                                        artworkKey: song.artworkKey, songIDs: [], added: song.added)
            }
            albums[albumID]!.songIDs.append(song.id)
            if albums[albumID]!.artworkKey == nil { albums[albumID]!.artworkKey = song.artworkKey }
            if albums[albumID]!.year == 0 { albums[albumID]!.year = song.year }
            albums[albumID]!.added = max(albums[albumID]!.added, song.added)

            var names = TextNormalizer.allArtists(song.artist)
            if !song.albumArtist.isEmpty, !names.contains(song.albumArtist) { names.append(song.albumArtist) }
            for n in names {
                let k = TextNormalizer.norm(n)
                if artists[k] == nil { artists[k] = Artist(id: k, name: n, songIDs: [], albumIDs: [], artworkKey: nil) }
                artists[k]!.songIDs.append(song.id)
                if !artists[k]!.albumIDs.contains(albumID) { artists[k]!.albumIDs.append(albumID) }
                if artists[k]!.artworkKey == nil { artists[k]!.artworkKey = song.artworkKey }
            }

            if !song.genre.isEmpty {
                let gk = TextNormalizer.norm(song.genre)
                if genres[gk] == nil { genres[gk] = Genre(id: gk, name: song.genre, songIDs: []) }
                genres[gk]!.songIDs.append(song.id)
            }

            // Disk folder tree: root name, then each directory.
            var node = root
            var path = ""
            for seg in [rootNames[song.rootID] ?? "Imported"] + song.directories {
                path += "/" + seg
                if let next = node.childMap[seg] { node = next } else {
                    let next = DiskFolder(id: path, name: seg)
                    node.childMap[seg] = next; node.children.append(next); node = next
                }
                if node.artworkKey == nil { node.artworkKey = song.artworkKey }
            }
            node.songIDs.append(song.id)

            searchText[song.id] = TextNormalizer.norm([song.title, song.artist, song.album, song.albumArtist,
                                                       song.genre, song.composer, song.year > 0 ? String(song.year) : ""]
                .joined(separator: " "))
        }

        func trackOrder(_ a: SongID, _ b: SongID) -> Bool {
            guard let x = db.songs[a], let y = db.songs[b] else { return false }
            let dx = max(1, x.discNumber), dy = max(1, y.discNumber)
            if dx != dy { return dx < dy }
            if x.trackNumber != y.trackNumber { return x.trackNumber < y.trackNumber }
            return TextNormalizer.sortKey(x.title) < TextNormalizer.sortKey(y.title)
        }
        for k in albums.keys { albums[k]!.songIDs.sort(by: trackOrder) }

        func sortTree(_ n: DiskFolder) {
            n.children.sort { TextNormalizer.sortKey($0.name) < TextNormalizer.sortKey($1.name) }
            n.songIDs.sort { (db.songs[$0]?.fileName ?? "").localizedStandardCompare(db.songs[$1]?.fileName ?? "") == .orderedAscending }
            n.children.forEach(sortTree)
        }
        sortTree(root)

        self.albums = albums.values.sorted { TextNormalizer.sortKey($0.name) < TextNormalizer.sortKey($1.name) }
        self.artists = artists.values.sorted { TextNormalizer.sortKey($0.name) < TextNormalizer.sortKey($1.name) }
        self.genres = genres.values.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        self.diskFolders = root
        self.albumByID = Dictionary(uniqueKeysWithValues: self.albums.enumerated().map { ($0.element.id, $0.offset) })
        self.artistByID = Dictionary(uniqueKeysWithValues: self.artists.enumerated().map { ($0.element.id, $0.offset) })
    }

    public func album(_ id: String) -> Album? { albumByID[id].map { albums[$0] } }
    public func artist(_ id: String) -> Artist? { artistByID[id].map { artists[$0] } }
    public func albumID(for song: Song) -> String {
        TextNormalizer.norm(song.groupingArtist) + "\u{1}" + TextNormalizer.norm(song.displayAlbum)
    }

    public func diskFolder(_ path: String) -> DiskFolder? {
        var node = diskFolders
        for seg in path.split(separator: "/").map(String.init) {
            guard let next = node.childMap[seg] else { return nil }
            node = next
        }
        return node
    }

    /// Every query word must appear; titles that start with the query rank first, then play count
    /// (same scoring as lib.search on the web).
    public func search(_ query: String, in db: LibraryDatabase, limit: Int = 300) -> [SongID] {
        let tokens = TextNormalizer.norm(query).split(whereSeparator: \.isWhitespace).map(String.init)
        guard let first = tokens.first else { return [] }
        let joined = tokens.joined(separator: " ")
        var scored: [(Double, SongID)] = []
        for (id, hay) in searchText where tokens.allSatisfy({ hay.contains($0) }) {
            guard let s = db.songs[id] else { continue }
            let title = TextNormalizer.norm(s.title)
            var score = 0.0
            if title.hasPrefix(first) { score += 3 }
            if title.contains(joined) { score += 2 }
            if TextNormalizer.norm(s.artist).contains(first) { score += 1 }
            score += min(2, Double(db.playCounts[id] ?? 0) / 10)
            scored.append((score, id))
        }
        return scored.sorted { $0.0 > $1.0 }.prefix(limit).map(\.1)
    }
}

/// Sort options shared by song lists (web: Songs sort menu).
public enum SongSort: String, CaseIterable, Codable, Sendable, Identifiable {
    case added, title, artist, album, year, duration, plays
    public var id: String { rawValue }
    public var label: String {
        switch self {
        case .added: "Recently added"
        case .title: "Title"
        case .artist: "Artist"
        case .album: "Album"
        case .year: "Year"
        case .duration: "Duration"
        case .plays: "Most played"
        }
    }

    public func sorted(_ ids: [SongID], in db: LibraryDatabase, ascending: Bool) -> [SongID] {
        let songs = ids.compactMap { db.songs[$0] }
        let out: [Song]
        switch self {
        case .added: out = songs.sorted { $0.added < $1.added }
        case .title: out = songs.sorted { TextNormalizer.sortKey($0.title) < TextNormalizer.sortKey($1.title) }
        case .artist: out = songs.sorted { TextNormalizer.sortKey($0.artist) < TextNormalizer.sortKey($1.artist) }
        case .album: out = songs.sorted { TextNormalizer.sortKey($0.album) < TextNormalizer.sortKey($1.album) }
        case .year: out = songs.sorted { $0.year < $1.year }
        case .duration: out = songs.sorted { $0.duration < $1.duration }
        case .plays: out = songs.sorted { (db.playCounts[$0.id] ?? 0) < (db.playCounts[$1.id] ?? 0) }
        }
        return (ascending ? out : out.reversed()).map(\.id)
    }
}

/// Sort options for "Your Library" (web LIB_SORTS).
public enum LibrarySort: String, CaseIterable, Codable, Sendable, Identifiable {
    case recent, added, alphabetical, plays, custom
    public var id: String { rawValue }
    public var label: String {
        switch self {
        case .recent: "Recents"
        case .added: "Recently added"
        case .alphabetical: "Alphabetical"
        case .plays: "Most played"
        case .custom: "Custom order"
        }
    }
}
