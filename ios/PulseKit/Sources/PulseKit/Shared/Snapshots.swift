import Foundation

/// What widgets, the Live Activity, the watch and the complication need to draw "now playing".
/// Written by the app to the App Group (and sent to the watch); small on purpose.
public struct NowPlayingSnapshot: Codable, Sendable, Equatable {
    public var songID: SongID?
    public var title: String
    public var artist: String
    public var album: String
    public var isPlaying: Bool
    public var isLiked: Bool
    /// Position when the snapshot was taken, and when that was; readers extrapolate
    /// (`elapsed(at:)`) so progress bars move without the app writing every second.
    public var elapsed: TimeInterval
    public var duration: TimeInterval
    public var capturedAt: Date
    public var rate: Double
    /// Accent derived from the album art, already tuned for dark backgrounds.
    public var accentHex: String
    /// "Playing from <label>"
    public var sourceLabel: String?
    public var upNextTitles: [String]
    /// File name (in AppGroup.widgetArtDirectory) of a small JPEG of the cover, if any.
    public var artworkFile: String?

    public init(songID: SongID? = nil, title: String = "Not Playing", artist: String = "", album: String = "",
                isPlaying: Bool = false, isLiked: Bool = false, elapsed: TimeInterval = 0, duration: TimeInterval = 0,
                capturedAt: Date = Date(), rate: Double = 1, accentHex: String = AccentPalette.defaultHex,
                sourceLabel: String? = nil, upNextTitles: [String] = [], artworkFile: String? = nil) {
        self.songID = songID; self.title = title; self.artist = artist; self.album = album
        self.isPlaying = isPlaying; self.isLiked = isLiked; self.elapsed = elapsed; self.duration = duration
        self.capturedAt = capturedAt; self.rate = rate; self.accentHex = accentHex; self.sourceLabel = sourceLabel
        self.upNextTitles = upNextTitles; self.artworkFile = artworkFile
    }

    public static let empty = NowPlayingSnapshot()

    public var hasSong: Bool { songID != nil }

    public func elapsed(at date: Date) -> TimeInterval {
        guard isPlaying else { return elapsed }
        return min(duration, elapsed + date.timeIntervalSince(capturedAt) * rate)
    }

    /// Start/end dates for `ProgressView(timerInterval:)` / `Text(timerInterval:)`, which animate
    /// on their own inside widgets and Live Activities.
    public var timerInterval: ClosedRange<Date>? {
        guard duration > 0 else { return nil }
        let rate = max(0.1, self.rate)
        let start = capturedAt.addingTimeInterval(-elapsed / rate)
        return start...start.addingTimeInterval(duration / rate)
    }

    public static func load() -> NowPlayingSnapshot {
        JSONFile.read(NowPlayingSnapshot.self, from: AppGroup.nowPlayingURL) ?? .empty
    }
    public func save() { try? JSONFile.write(self, to: AppGroup.nowPlayingURL) }
}

/// The parts of the library that widgets, Shortcuts/Siri (App Intents) and the watch can see
/// without loading the full library.json.
public struct LibrarySnapshot: Codable, Sendable {
    public struct PlaylistSummary: Codable, Sendable, Hashable, Identifiable {
        public var id: String
        public var name: String
        /// Breadcrumb of containing folders, e.g. "Workout / Running".
        public var folderPath: String
        public var songCount: Int
        public var accentHex: String
        public var artworkFile: String?
        public var isFolder: Bool
        public init(id: String, name: String, folderPath: String, songCount: Int, accentHex: String,
                    artworkFile: String?, isFolder: Bool) {
            self.id = id; self.name = name; self.folderPath = folderPath; self.songCount = songCount
            self.accentHex = accentHex; self.artworkFile = artworkFile; self.isFolder = isFolder
        }
    }

    public var playlists: [PlaylistSummary]
    /// Recently opened playlists/folders first (Home "Jump back in").
    public var recent: [PlaylistSummary]
    public var likedCount: Int
    public var songCount: Int
    public var updated: Date

    public init(playlists: [PlaylistSummary] = [], recent: [PlaylistSummary] = [], likedCount: Int = 0,
                songCount: Int = 0, updated: Date = Date()) {
        self.playlists = playlists; self.recent = recent; self.likedCount = likedCount
        self.songCount = songCount; self.updated = updated
    }

    public static func load() -> LibrarySnapshot {
        JSONFile.read(LibrarySnapshot.self, from: AppGroup.librarySnapshotURL) ?? LibrarySnapshot()
    }
    public func save() { try? JSONFile.write(self, to: AppGroup.librarySnapshotURL) }

    /// Special id used for "Liked Songs" in intents/widgets.
    public static let likedSongsID = "liked"
}
