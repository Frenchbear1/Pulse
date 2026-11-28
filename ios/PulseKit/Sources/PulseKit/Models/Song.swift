import Foundation

public typealias SongID = String

/// One audio file in the library. Field names follow the web app's `track` objects
/// (title, artist, albumArtist, album, year, genre, track, disc, ...) so the two stay recognisably
/// the same product and a Pulse backup can be matched against native songs.
public struct Song: Codable, Hashable, Identifiable, Sendable {
    public var id: SongID
    /// `LibraryRoot.id` the file lives under.
    public var rootID: String
    /// Path inside the root, "/"-separated, e.g. "Albums/Kind of Blue/01 So What.m4a".
    public var relativePath: String
    public var fileName: String
    /// Folder names between the root and the file; drives the on-disk Folders view.
    public var directories: [String]

    public var title: String
    public var artist: String
    public var albumArtist: String
    public var album: String
    /// True when the album name was guessed from the parent folder (no album tag).
    public var albumIsGuess: Bool
    public var year: Int
    public var genre: String
    public var trackNumber: Int
    public var discNumber: Int
    public var duration: TimeInterval
    public var bitrate: Int
    public var sampleRate: Int
    public var composer: String
    public var bpm: Int
    public var isrc: String

    /// Key into `LibraryDatabase.artwork` / `ArtworkCache`; nil when the song has no art yet.
    public var artworkKey: String?
    public var hasLyrics: Bool
    /// Relative path of a matching `.lrc` file next to the song, if one exists.
    public var lyricsSidecar: String?

    public var fileSize: Int64
    public var modified: Date?
    public var added: Date

    public init(id: SongID, rootID: String, relativePath: String, fileName: String, directories: [String],
                title: String, artist: String = "", albumArtist: String = "", album: String = "",
                albumIsGuess: Bool = false, year: Int = 0, genre: String = "", trackNumber: Int = 0,
                discNumber: Int = 0, duration: TimeInterval = 0, bitrate: Int = 0, sampleRate: Int = 0,
                composer: String = "", bpm: Int = 0, isrc: String = "", artworkKey: String? = nil,
                hasLyrics: Bool = false, lyricsSidecar: String? = nil, fileSize: Int64 = 0,
                modified: Date? = nil, added: Date = Date()) {
        self.id = id; self.rootID = rootID; self.relativePath = relativePath; self.fileName = fileName
        self.directories = directories; self.title = title; self.artist = artist; self.albumArtist = albumArtist
        self.album = album; self.albumIsGuess = albumIsGuess; self.year = year; self.genre = genre
        self.trackNumber = trackNumber; self.discNumber = discNumber; self.duration = duration
        self.bitrate = bitrate; self.sampleRate = sampleRate; self.composer = composer; self.bpm = bpm
        self.isrc = isrc; self.artworkKey = artworkKey; self.hasLyrics = hasLyrics
        self.lyricsSidecar = lyricsSidecar; self.fileSize = fileSize; self.modified = modified; self.added = added
    }

    public var displayArtist: String { artist.isEmpty ? "Unknown Artist" : artist }
    public var displayAlbum: String { album.isEmpty ? "Unknown Album" : album }
    /// "Artist A feat. B" -> "Artist A" (same splitting rules as the web app's primaryArtist()).
    public var primaryArtist: String { TextNormalizer.primaryArtist(artist) }
    /// Album artist, falling back to the primary artist; used to group albums.
    public var groupingArtist: String {
        if !albumArtist.isEmpty { return albumArtist }
        let p = primaryArtist
        return p.isEmpty ? "Unknown Artist" : p
    }

    /// Stable id from where the file lives, so re-scanning the same folder keeps likes,
    /// play counts and playlist membership.
    public static func makeID(rootID: String, relativePath: String) -> SongID {
        "s" + StableHash.fnv1a64(rootID + "|" + relativePath.lowercased())
    }
}

/// A folder the user added from the Files app (or the app's own Documents folder).
public struct LibraryRoot: Codable, Hashable, Identifiable, Sendable {
    public enum Kind: String, Codable, Sendable {
        /// A folder picked in Files (iCloud Drive, On My iPhone, a USB drive, a file provider...).
        /// Access needs the security-scoped bookmark below.
        case bookmarkedFolder
        /// Pulse's own Documents folder ("On My iPhone > Pulse" in Files, thanks to
        /// UIFileSharingEnabled). Single files imported or opened in Pulse are copied into
        /// Documents/Imported, so they show up here too - the native "On this device".
        case appDocuments
    }

    public var id: String
    public var name: String
    public var kind: Kind
    /// Security-scoped bookmark for `.bookmarkedFolder` roots.
    public var bookmark: Data?
    public var lastScan: Date?

    public init(id: String, name: String, kind: Kind, bookmark: Data? = nil, lastScan: Date? = nil) {
        self.id = id; self.name = name; self.kind = kind; self.bookmark = bookmark; self.lastScan = lastScan
    }

    public static let documentsID = "documents"
}

/// Small, cached facts about an artwork image (the image files themselves live in ArtworkCache).
public struct ArtworkInfo: Codable, Hashable, Sendable {
    /// Average colour as "#rrggbb"; feeds the "accent from album art" theme mode.
    public var colorHex: String
    public init(colorHex: String) { self.colorHex = colorHex }
}
