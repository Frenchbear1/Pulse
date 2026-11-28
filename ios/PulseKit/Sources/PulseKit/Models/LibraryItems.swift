import Foundation

/// "Your Library" is a tree of playlists and folders nested to any depth, exactly like the web
/// app's `nodes` / `rootNodes`. Folders hold an ordered list of children; playlists hold songs.
public enum LibraryItemID: Codable, Hashable, Sendable, Identifiable {
    case playlist(String)
    case folder(String)

    public var id: String { rawID }
    public var rawID: String {
        switch self { case .playlist(let id), .folder(let id): return id }
    }
    public var isFolder: Bool { if case .folder = self { return true } else { return false } }
}

public struct Playlist: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var name: String
    /// Containing `LibraryFolder.id`, or nil at the top level.
    public var parentID: String?
    /// Ordered; duplicates are not allowed (same rule as the web app's addToPlaylist).
    public var songIDs: [SongID]
    /// Custom cover (imported image). Nil means "auto mosaic from the songs' art".
    public var artworkKey: String?
    /// Free-text description (web: `desc`).
    public var summary: String
    public var created: Date
    public var updated: Date

    public init(id: String = LibraryID.make(), name: String, parentID: String? = nil, songIDs: [SongID] = [],
                artworkKey: String? = nil, summary: String = "", created: Date = Date(), updated: Date = Date()) {
        self.id = id; self.name = name; self.parentID = parentID; self.songIDs = songIDs
        self.artworkKey = artworkKey; self.summary = summary; self.created = created; self.updated = updated
    }
}

public struct LibraryFolder: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var parentID: String?
    /// Ordered children (playlists and sub-folders mixed, in the user's custom order).
    public var children: [LibraryItemID]
    public var artworkKey: String?
    public var created: Date

    public init(id: String = LibraryID.make(), name: String, parentID: String? = nil,
                children: [LibraryItemID] = [], artworkKey: String? = nil, created: Date = Date()) {
        self.id = id; self.name = name; self.parentID = parentID; self.children = children
        self.artworkKey = artworkKey; self.created = created
    }
}

public enum LibraryID {
    /// Short random id, same flavour as the web app's uid().
    public static func make() -> String {
        let alphabet = Array("abcdefghijklmnopqrstuvwxyz0123456789")
        return String((0..<12).map { _ in alphabet.randomElement()! })
    }
}

/// Where the current queue came from; shown as "Playing from ..." and used by CarPlay/widgets.
public struct PlaybackSource: Codable, Hashable, Sendable {
    public enum Kind: String, Codable, Sendable {
        case songs, album, artist, genre, playlist, folder, diskFolder, liked, recent, mostPlayed, search, watch
    }
    public var kind: Kind
    public var label: String
    /// Playlist/folder/album key etc., when there is one.
    public var reference: String?
    public init(kind: Kind, label: String, reference: String? = nil) {
        self.kind = kind; self.label = label; self.reference = reference
    }
    public static let allSongs = PlaybackSource(kind: .songs, label: "All songs")
}
