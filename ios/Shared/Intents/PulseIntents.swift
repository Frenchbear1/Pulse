import AppIntents
import PulseKit

// App Intents shared by the app (Siri, Shortcuts, Spotlight, Action button, CarPlay Siri) and the
// widget extension (interactive widget buttons, Live Activity buttons).
//
// Playback intents adopt `AudioPlaybackIntent`; Like adopts `LiveActivityIntent`. Both make the
// system run `perform()` in the *app's* process - launching it in the background if necessary -
// even when the button lives in a widget. The app registers PlaybackCommandRouter.handler at launch.

@MainActor
private func commandHandler() async throws -> PlaybackCommandHandling {
    guard let handler = PlaybackCommandRouter.handler else { throw PulseIntentError.appNotRunning }
    await handler.prepare()
    return handler
}

// MARK: - Playlist entity (what Siri/Shortcuts can pick from)

struct PlaylistEntity: AppEntity, Identifiable {
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Playlist"
    static var defaultQuery = PlaylistQuery()

    var id: String
    var name: String
    var detail: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)", subtitle: detail.isEmpty ? nil : "\(detail)")
    }

    init(id: String, name: String, detail: String) {
        self.id = id; self.name = name; self.detail = detail
    }

    init(_ summary: LibrarySnapshot.PlaylistSummary) {
        let count = "\(summary.songCount) song\(summary.songCount == 1 ? "" : "s")"
        self.init(id: summary.id, name: summary.name,
                  detail: summary.folderPath.isEmpty ? count : "\(summary.folderPath) · \(count)")
    }

    static func liked(count: Int) -> PlaylistEntity {
        PlaylistEntity(id: LibrarySnapshot.likedSongsID, name: "Liked Songs", detail: "\(count) songs")
    }
}

/// Reads the small library snapshot from the App Group, so this works from the widget extension
/// and from Siri without loading the full library.
struct PlaylistQuery: EntityStringQuery {
    private func all() -> [PlaylistEntity] {
        let snap = LibrarySnapshot.load()
        let lists = snap.playlists.filter { !$0.isFolder }.map(PlaylistEntity.init)
        return [PlaylistEntity.liked(count: snap.likedCount)] + lists
    }

    func entities(for identifiers: [String]) async throws -> [PlaylistEntity] {
        let wanted = Set(identifiers)
        return all().filter { wanted.contains($0.id) }
    }

    func entities(matching string: String) async throws -> [PlaylistEntity] {
        let q = TextNormalizer.norm(string)
        guard !q.isEmpty else { return all() }
        return all().filter { TextNormalizer.norm($0.name).contains(q) }
    }

    func suggestedEntities() async throws -> [PlaylistEntity] {
        // Recently opened first, then the rest - that's what people ask Siri for.
        let snap = LibrarySnapshot.load()
        let recentIDs = snap.recent.map(\.id)
        let everything = all()
        let recent = recentIDs.compactMap { id in everything.first { $0.id == id } }
        return recent + everything.filter { !recentIDs.contains($0.id) }
    }
}

// MARK: - Intents

struct PlayPlaylistIntent: AudioPlaybackIntent {
    static var title: LocalizedStringResource = "Play Playlist"
    static var description = IntentDescription("Plays one of your Pulse playlists, or your Liked Songs.")

    @Parameter(title: "Playlist") var playlist: PlaylistEntity
    @Parameter(title: "Shuffle", default: false) var shuffle: Bool

    static var parameterSummary: some ParameterSummary {
        Summary("Play \(\.$playlist)") { \.$shuffle }
    }

    init() {}
    init(playlist: PlaylistEntity, shuffle: Bool = false) {
        self.playlist = playlist
        self.shuffle = shuffle
    }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let handler = try await commandHandler()
        guard handler.playLibraryItem(id: playlist.id, shuffle: shuffle) else { throw PulseIntentError.notFound }
        return .result(dialog: "Playing \(playlist.name)")
    }
}

struct PlayPauseIntent: AudioPlaybackIntent {
    static var title: LocalizedStringResource = "Play or Pause"
    static var description = IntentDescription("Toggles playback in Pulse.")
    static var isDiscoverable = true

    init() {}

    @MainActor
    func perform() async throws -> some IntentResult {
        try await commandHandler().togglePlayPause()
        return .result()
    }
}

struct NextTrackIntent: AudioPlaybackIntent {
    static var title: LocalizedStringResource = "Next Song"
    static var description = IntentDescription("Skips to the next song in Pulse.")

    init() {}

    @MainActor
    func perform() async throws -> some IntentResult {
        try await commandHandler().nextTrack()
        return .result()
    }
}

struct PreviousTrackIntent: AudioPlaybackIntent {
    static var title: LocalizedStringResource = "Previous Song"
    static var description = IntentDescription("Goes back to the previous song (or the start of this one).")

    init() {}

    @MainActor
    func perform() async throws -> some IntentResult {
        try await commandHandler().previousTrack()
        return .result()
    }
}

struct LikeSongIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Like Current Song"
    static var description = IntentDescription("Adds the song playing in Pulse to Liked Songs, or removes it.")

    init() {}

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let liked = try await commandHandler().toggleLikeCurrent() else { throw PulseIntentError.nothingPlaying }
        return .result(dialog: liked ? "Added to Liked Songs" : "Removed from Liked Songs")
    }
}
