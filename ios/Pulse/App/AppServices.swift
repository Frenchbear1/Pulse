import SwiftUI
import WidgetKit
import PulseKit

/// Wires the shared pieces together: library <-> player <-> widgets / Live Activity / watch.
@MainActor @Observable
final class AppServices {
    static let shared = AppServices()

    let library = LibraryStore.shared
    let player = PlayerEngine.shared
    let ui = UIState()
    @ObservationIgnored let widgets = WidgetBridge()
    @ObservationIgnored let liveActivity = LiveActivityController()
    @ObservationIgnored let watch = PhoneWatchSession()

    var appearance: AppearanceSettings {
        didSet { appearanceStore.save(appearance) }
    }
    @ObservationIgnored private let appearanceStore = SettingsStore<AppearanceSettings>(key: "pulse.appearance")

    /// Accent + partner colours for the current song (when "accent from album art" is on).
    var theme: PulseTheme {
        PulseTheme(appearance: appearance,
                   artworkHex: appearance.accentMode == .dynamic ? library.accentHex(forArtwork: player.currentSong?.artworkKey) : nil)
    }

    @ObservationIgnored private var started = false
    @ObservationIgnored private var startTask: Task<Void, Never>?

    private init() {
        appearance = SettingsStore<AppearanceSettings>(key: "pulse.appearance").load(or: AppearanceSettings())
    }

    /// Idempotent; also awaited by intents when the app was launched in the background.
    func start() async {
        if let startTask { await startTask.value; return }
        let t = Task { await self.boot() }
        startTask = t
        await t.value
    }

    private func boot() async {
        await library.load()
        player.attach(library: library)
        player.onStateChange = { [weak self] change in self?.playerChanged(change) }
        library.onDidChange = { [weak self] in self?.libraryChanged() }
        watch.activate(services: self)
        libraryChanged()
        playerChanged(.track)
        // Pick up files dropped into Pulse's folder in Files, and changes in linked folders.
        Task { await library.rescanAll() }
    }

    // MARK: - Fan-out of state changes

    private func playerChanged(_ change: PlayerEngine.StateChange) {
        switch change {
        case .track, .playState, .queue:
            let art = player.currentSong?.artworkKey.flatMap { library.artwork.exportWidgetThumbnail($0) }
            let snap = player.snapshot(artworkFile: art)
            widgets.publish(snap)
            liveActivity.update(with: snap, enabled: appearance.liveActivity)
            watch.sendNowPlaying(snap)
        case .position:
            // Seeks: widgets/Live Activity extrapolate from the new timestamp.
            let snap = player.snapshot(artworkFile: player.currentSong?.artworkKey.flatMap { library.artwork.exportWidgetThumbnail($0) })
            widgets.publish(snap, reloadTimelines: false)
            liveActivity.update(with: snap, enabled: appearance.liveActivity)
        }
        CarPlayCoordinator.shared.playerChanged(change)
    }

    private func libraryChanged() {
        widgets.publish(library.makeSnapshot())
        CarPlayCoordinator.shared.libraryChanged()
        watch.sendPlaylistList()
        ShortcutsVocabulary.refresh()
    }

    // MARK: - App lifecycle

    func didEnterBackground() {
        player.persistPosition()
        Task { await library.saveNow() }
    }

    func didBecomeActive() {
        widgets.publish(player.snapshot(artworkFile: nil), reloadTimelines: false)
    }

    /// Files opened with Pulse (share sheet / "Open in"): audio is imported, a .json is treated as
    /// a Pulse backup. Also handles pulse://nowplaying, pulse://liked and pulse://playlist/<id> from widgets.
    func open(_ url: URL) {
        if url.scheme == "pulse" {
            if url.host == "nowplaying" { ui.showNowPlaying = true }
            if url.host == "liked" {
                ui.showNowPlaying = false
                ui.selectedTab = .library
                ui.push(.liked)
            }
            if url.host == "playlist", let id = url.pathComponents.dropFirst().first {
                ui.showNowPlaying = false
                ui.selectedTab = .library
                ui.push(.playlist(id))
            }
            return
        }
        if url.pathExtension.lowercased() == "json" {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            if let data = try? Data(contentsOf: url) {
                do {
                    let r = try library.importBackup(data)
                    ui.toast = "Restored \(r.playlists) playlists, \(r.likes) likes (\(r.matchedSongs) songs matched)"
                } catch { ui.toast = error.localizedDescription }
            }
            return
        }
        Task {
            let n = await library.importFiles([url])
            ui.toast = n > 0 ? "Added to On This iPhone" : "Pulse can't play that file"
        }
    }
}

/// App-side implementation of the intent/CarPlay/watch command surface.
@MainActor
final class AppCommandHandler: PlaybackCommandHandling {
    static let shared = AppCommandHandler()
    private var player: PlayerEngine { .shared }

    func prepare() async { await AppServices.shared.start() }
    func togglePlayPause() { player.togglePlayPause() }
    func play() { player.play() }
    func pause() { player.pause() }
    func nextTrack() { player.next() }
    func previousTrack() { player.previous() }
    func toggleLikeCurrent() -> Bool? { player.toggleLikeCurrent() }
    func playLibraryItem(id: String, shuffle: Bool) -> Bool { player.playLibraryItem(id: id, shuffle: shuffle) }
}

enum AppTab: Hashable { case home, library, search, settings }

/// Transient UI state shared across screens.
@MainActor @Observable
final class UIState {
    var showNowPlaying = false
    var showQueue = false
    var toast: String? {
        didSet {
            guard toast != nil else { return }
            toastTask?.cancel()
            toastTask = Task { [weak self] in
                try? await Task.sleep(for: .seconds(2.6))
                if !Task.isCancelled { self?.toast = nil }
            }
        }
    }
    var selectedTab: AppTab = .home
    /// One navigation path per tab, so "Go to Album" from a menu pushes onto the visible stack.
    var paths: [AppTab: [Route]] = [:]
    func push(_ route: Route) {
        showNowPlaying = false
        showQueue = false
        paths[selectedTab, default: []].append(route)
    }
    /// Songs waiting for the "Add to playlist" sheet.
    var addToPlaylist: [SongID]?
    @ObservationIgnored private var toastTask: Task<Void, Never>?
}
