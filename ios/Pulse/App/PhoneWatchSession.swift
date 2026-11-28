import Foundation
import AVFoundation
import WatchConnectivity
import PulseKit

/// iPhone side of WatchConnectivity: publishes now-playing to the watch, runs the watch's remote
/// commands, and copies playlists to the watch for offline listening.
@MainActor @Observable
final class PhoneWatchSession: NSObject {
    private(set) var isPaired = false
    private(set) var isWatchAppInstalled = false
    private(set) var isReachable = false
    /// Songs still queued for transfer to the watch.
    private(set) var pendingTransfers = 0

    @ObservationIgnored private weak var services: AppServices?
    @ObservationIgnored private var lastSent: NowPlayingSnapshot?

    var statusText: String {
        guard WCSession.isSupported() else { return "Not supported" }
        if !isPaired { return "No Apple Watch paired" }
        if !isWatchAppInstalled { return "Install Pulse on your watch" }
        if pendingTransfers > 0 { return "Sending \(pendingTransfers) song\(pendingTransfers == 1 ? "" : "s")…" }
        return isReachable ? "Connected" : "Ready"
    }

    func activate(services: AppServices) {
        self.services = services
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    private var session: WCSession? {
        guard WCSession.isSupported(), WCSession.default.activationState == .activated else { return nil }
        return WCSession.default
    }

    // MARK: Phone -> watch

    func sendNowPlaying(_ snap: NowPlayingSnapshot) {
        guard let s = session, s.isPaired, s.isWatchAppInstalled else { return }
        // Position-only changes are extrapolated on the watch; don't spam the context.
        if let last = lastSent, last.songID == snap.songID, last.isPlaying == snap.isPlaying, last.isLiked == snap.isLiked,
           abs(last.elapsed(at: Date()) - snap.elapsed) < 2 { return }
        lastSent = snap
        guard let data = WatchCoding.encode(snap) else { return }
        try? s.updateApplicationContext([WatchKeys.nowPlaying: data])
    }

    func sendPlaylistList() {
        guard let s = session, s.isReachable, let services else { return }
        if let data = WatchCoding.encode(services.library.makeSnapshot().playlists.filter { !$0.isFolder }) {
            s.sendMessage([WatchKeys.playlists: data], replyHandler: nil, errorHandler: nil)
        }
    }

    /// Copy a playlist to the watch. Large lossless files are converted to AAC first: watch storage
    /// is small and transfers go over Bluetooth/Wi-Fi in the background, so smaller is faster.
    func syncPlaylist(_ playlistID: String) {
        guard let s = session, s.isPaired, s.isWatchAppInstalled, let services,
              let playlist = services.library.db.playlists[playlistID] else {
            services?.ui.toast = "Pair an Apple Watch with Pulse installed to sync"
            return
        }
        let library = services.library
        let songs = library.db.songIDs(in: .playlist(playlistID)).compactMap { library.song($0) }
        let items = songs.map { WatchSyncManifest.Item(id: $0.id, title: $0.title, artist: $0.displayArtist,
                                                       duration: $0.duration, fileName: $0.id) }   // watch adds the extension it receives
        let accent = AccentPalette.tuned(library.accentHex(forArtwork: library.artworkKey(for: .playlist(playlistID)))).hex
        let manifest = WatchSyncManifest(id: playlistID, name: playlist.name, accentHex: accent, items: items)
        if let data = WatchCoding.encode(manifest) { s.transferUserInfo([WatchKeys.manifest: data]) }

        services.ui.toast = "Sending “\(playlist.name)” to Apple Watch"
        pendingTransfers += songs.count
        let files = songs.compactMap { song in library.fileURL(for: song).map { (song.id, $0) } }
        Task.detached(priority: .utility) {
            for (id, url) in files {
                let out = await WatchTranscoder.prepare(url, songID: id)
                await MainActor.run {
                    guard let out else { self.pendingTransfers = max(0, self.pendingTransfers - 1); return }
                    s.transferFile(out, metadata: [WatchKeys.fileSongID: id, WatchKeys.filePlaylistID: playlistID])
                }
            }
        }
    }

    // MARK: Watch -> phone

    private func handle(_ message: [String: Any]) -> [String: Any] {
        guard let raw = message[WatchKeys.command] as? String, let cmd = WatchCommand(rawValue: raw), let services else { return [:] }
        let player = services.player
        switch cmd {
        case .togglePlayPause: player.togglePlayPause()
        case .play: player.play()
        case .pause: player.pause()
        case .next: player.next()
        case .previous: player.previous()
        case .toggleLike: _ = player.toggleLikeCurrent()
        case .setVolume: if let v = message[WatchKeys.value] as? Double { player.setVolume(Float(v)) }
        case .playPlaylist: if let id = message[WatchKeys.value] as? String { _ = player.playLibraryItem(id: id, shuffle: false) }
        case .listPlaylists:
            let list = services.library.makeSnapshot().playlists.filter { !$0.isFolder }
            return WatchCoding.encode(list).map { [WatchKeys.playlists: $0] } ?? [:]
        case .requestSync: if let id = message[WatchKeys.value] as? String { syncPlaylist(id) }
        }
        let art = player.currentSong?.artworkKey.flatMap { services.library.artwork.exportWidgetThumbnail($0) }
        return WatchCoding.encode(player.snapshot(artworkFile: art)).map { [WatchKeys.nowPlaying: $0] } ?? [:]
    }

    private func refreshState() {
        guard WCSession.isSupported() else { return }
        let s = WCSession.default
        isPaired = s.isPaired
        isWatchAppInstalled = s.isWatchAppInstalled
        isReachable = s.isReachable
    }
}

extension PhoneWatchSession: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        Task { @MainActor in self.refreshState() }
    }
    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}
    nonisolated func sessionDidDeactivate(_ session: WCSession) { session.activate() } // switching watches
    nonisolated func sessionWatchStateDidChange(_ session: WCSession) { Task { @MainActor in self.refreshState() } }
    nonisolated func sessionReachabilityDidChange(_ session: WCSession) { Task { @MainActor in self.refreshState() } }

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any],
                             replyHandler: @escaping ([String: Any]) -> Void) {
        // Messages arrive on a background queue; hop to the main actor and reply from there.
        let box = UncheckedSendable(message)
        let reply = UncheckedSendable(replyHandler)
        Task { @MainActor in
            await AppServices.shared.start()
            reply.value(self.handle(box.value))
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        let box = UncheckedSendable(message)
        Task { @MainActor in _ = self.handle(box.value) }
    }

    nonisolated func session(_ session: WCSession, didFinish fileTransfer: WCSessionFileTransfer, error: Error?) {
        // Temporary transcodes are ours to clean up.
        let url = fileTransfer.file.fileURL
        if url.path.hasPrefix(FileManager.default.temporaryDirectory.path) { try? FileManager.default.removeItem(at: url) }
        Task { @MainActor in self.pendingTransfers = max(0, self.pendingTransfers - 1) }
    }
}

/// WatchConnectivity hands us non-Sendable dictionaries/closures on its own queue.
struct UncheckedSendable<T>: @unchecked Sendable { let value: T; init(_ v: T) { value = v } }

/// Makes a watch-friendly copy of a song: AAC files are sent as-is, anything else (FLAC, WAV,
/// ALAC, big MP3s) is converted to AAC .m4a with AVAssetExportSession.
enum WatchTranscoder {
    static func prepare(_ url: URL, songID: SongID) async -> URL? {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let tmp = FileManager.default.temporaryDirectory
        let ext = url.pathExtension.lowercased()
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        if (ext == "m4a" || ext == "aac" || ext == "mp3") && size < 12_000_000 {
            // Keep the original extension: the watch's player picks the decoder from it.
            let dest = tmp.appendingPathComponent("watch-\(songID).\(ext)")
            try? FileManager.default.removeItem(at: dest)
            // Copy so the transfer has a stable file even if the original moves.
            return (try? FileManager.default.copyItem(at: url, to: dest)).map { dest }
        }
        let dest = tmp.appendingPathComponent("watch-\(songID).m4a")
        try? FileManager.default.removeItem(at: dest)
        let asset = AVURLAsset(url: url)
        guard let export = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A) else { return nil }
        export.outputURL = dest
        export.outputFileType = .m4a
        await export.export()
        return export.status == .completed ? dest : nil
    }
}
