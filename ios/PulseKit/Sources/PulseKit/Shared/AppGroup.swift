import Foundation

/// The App Group shared by the app, widgets and Live Activity (and, on the watch, by the watch app
/// and its complication - a separate container on that device).
public enum AppGroup {
    /// Read from the `PulseAppGroup` Info.plist key (set from the PULSE_APP_GROUP build setting) so
    /// changing the group id is a one-line edit in project.yml.
    public static let identifier: String =
        (Bundle.main.object(forInfoDictionaryKey: "PulseAppGroup") as? String).flatMap { $0.isEmpty ? nil : $0 }
        ?? "group.app.pulse.player"

    /// Shared container, or the app's own Application Support folder if the group isn't
    /// provisioned yet (e.g. first run before signing is set up) so nothing crashes.
    public static let containerURL: URL = {
        let fm = FileManager.default
        let base = fm.containerURL(forSecurityApplicationGroupIdentifier: identifier)
            ?? fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let url = base.appendingPathComponent("Pulse", isDirectory: true)
        try? fm.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }()

    public static let defaults: UserDefaults = UserDefaults(suiteName: identifier) ?? .standard

    public static func file(_ name: String) -> URL { containerURL.appendingPathComponent(name) }

    public static func directory(_ name: String) -> URL {
        let url = containerURL.appendingPathComponent(name, isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    // Well-known files
    public static var libraryURL: URL { file("library.json") }
    public static var nowPlayingURL: URL { file("nowplaying.json") }
    public static var nowPlayingArtURL: URL { file("nowplaying-art.jpg") }
    public static var librarySnapshotURL: URL { file("library-snapshot.json") }
    public static var artworkDirectory: URL { directory("Artwork") }
    public static var widgetArtDirectory: URL { directory("WidgetArt") }
}

/// Atomic JSON read/write helpers used for everything in the shared container.
public enum JSONFile {
    public static let encoder: JSONEncoder = {
        let e = JSONEncoder(); e.dateEncodingStrategy = .millisecondsSince1970; return e
    }()
    public static let decoder: JSONDecoder = {
        let d = JSONDecoder(); d.dateDecodingStrategy = .millisecondsSince1970; return d
    }()

    public static func read<T: Decodable>(_ type: T.Type, from url: URL) -> T? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? decoder.decode(T.self, from: data)
    }

    public static func write<T: Encodable>(_ value: T, to url: URL) throws {
        let data = try encoder.encode(value)
        // .atomic writes to a temp file and renames, so a widget never reads half a file.
        try data.write(to: url, options: [.atomic])
    }
}
