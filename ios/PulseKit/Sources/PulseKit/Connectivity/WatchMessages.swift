import Foundation

/// Messages between the iPhone app and the watch app over WatchConnectivity.
///
/// Channels used (and why):
///  - `updateApplicationContext`  phone -> watch now-playing state. Only the latest value is kept,
///                                which is exactly right for "what's playing" and survives the
///                                watch app not running.
///  - `sendMessage`               watch -> phone remote commands while both apps are reachable;
///                                the reply carries the fresh now-playing state.
///  - `transferFile`              phone -> watch song files for offline playlists (queued by the
///                                system, continues in the background, can take a while).
///  - `transferUserInfo`          phone -> watch sync manifests (guaranteed, in order).
public enum WatchKeys {
    public static let command = "cmd"
    public static let value = "value"
    public static let nowPlaying = "nowPlaying"
    public static let manifest = "manifest"
    public static let removePlaylist = "removePlaylist"
    public static let playlists = "playlists"
    public static let fileSongID = "songID"
    public static let filePlaylistID = "playlistID"
}

public enum WatchCommand: String, Codable, Sendable {
    case togglePlayPause, play, pause, next, previous, toggleLike
    /// value: Float 0...1
    case setVolume
    /// value: playlist id
    case playPlaylist
    /// Ask the phone for its playlist list (for the "Sync to watch" picker on the watch).
    case listPlaylists
    /// value: playlist id - ask the phone to start sending that playlist's files.
    case requestSync
}

/// One playlist copied to the watch for offline playback.
public struct WatchSyncManifest: Codable, Sendable, Identifiable, Equatable {
    public struct Item: Codable, Sendable, Equatable, Identifiable {
        public var id: SongID
        public var title: String
        public var artist: String
        public var duration: TimeInterval
        /// Name the watch stores the file under (inside its Synced/ folder).
        public var fileName: String
        public init(id: SongID, title: String, artist: String, duration: TimeInterval, fileName: String) {
            self.id = id; self.title = title; self.artist = artist; self.duration = duration; self.fileName = fileName
        }
    }
    public var id: String          // playlist id on the phone
    public var name: String
    public var accentHex: String
    public var items: [Item]
    public var created: Date
    public init(id: String, name: String, accentHex: String, items: [Item], created: Date = Date()) {
        self.id = id; self.name = name; self.accentHex = accentHex; self.items = items; self.created = created
    }
}

/// WatchConnectivity dictionaries only take property-list types, so Codable values travel as Data.
public enum WatchCoding {
    public static func encode<T: Encodable>(_ value: T) -> Data? { try? JSONFile.encoder.encode(value) }
    public static func decode<T: Decodable>(_ type: T.Type, from any: Any?) -> T? {
        guard let data = any as? Data else { return nil }
        return try? JSONFile.decoder.decode(T.self, from: data)
    }
}
