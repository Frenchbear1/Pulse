import Foundation
import WatchConnectivity
import PulseKit

/// Watch side of WatchConnectivity: shows/controls what the phone is playing, and receives
/// playlists the phone sends for offline playback. See WatchMessages.swift for the channels.
@MainActor @Observable
final class WatchSessionManager: NSObject {
    static let shared = WatchSessionManager()

    private(set) var phoneNowPlaying: NowPlayingSnapshot = .empty
    private(set) var phonePlaylists: [LibrarySnapshot.PlaylistSummary] = []
    private(set) var isReachable = false
    private(set) var lastError: String?
    /// Playlist ids the user asked for that haven't produced a manifest yet.
    private(set) var requestedSyncs: Set<String> = []

    func activate() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    // MARK: Commands to the phone

    func send(_ command: WatchCommand, value: Any? = nil) {
        guard WCSession.default.activationState == .activated, WCSession.default.isReachable else {
            lastError = "Open Pulse on your iPhone"
            return
        }
        var msg: [String: Any] = [WatchKeys.command: command.rawValue]
        if let value { msg[WatchKeys.value] = value }
        // Optimistic UI for the obvious ones; the reply corrects it.
        if command == .togglePlayPause { phoneNowPlaying.isPlaying.toggle() }
        if command == .toggleLike { phoneNowPlaying.isLiked.toggle() }
        WCSession.default.sendMessage(msg, replyHandler: { reply in
            let box = UncheckedSendableBox(reply)
            Task { @MainActor in self.apply(box.value) }
        }, errorHandler: { error in
            let text = error.localizedDescription
            Task { @MainActor in self.lastError = text }
        })
    }

    func refreshPlaylists() { send(.listPlaylists) }

    func requestSync(_ playlistID: String) {
        requestedSyncs.insert(playlistID)
        send(.requestSync, value: playlistID)
    }

    // MARK: Incoming

    private func apply(_ dict: [String: Any]) {
        lastError = nil
        if let snap = WatchCoding.decode(NowPlayingSnapshot.self, from: dict[WatchKeys.nowPlaying]) {
            phoneNowPlaying = snap
            if !WatchPlayer.shared.isActive { WatchComplicationBridge.publish(snap) }
        }
        if let lists = WatchCoding.decode([LibrarySnapshot.PlaylistSummary].self, from: dict[WatchKeys.playlists]) {
            phonePlaylists = lists
        }
        if let manifest = WatchCoding.decode(WatchSyncManifest.self, from: dict[WatchKeys.manifest]) {
            requestedSyncs.remove(manifest.id)
            WatchStorage.shared.upsert(manifest)
        }
        if let removed = dict[WatchKeys.removePlaylist] as? String {
            WatchStorage.shared.remove(playlistID: removed)
        }
    }

    private func refreshReachability() {
        isReachable = WCSession.default.isReachable
        if isReachable { lastError = nil }
    }
}

extension WatchSessionManager: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        let context = UncheckedSendableBox(session.receivedApplicationContext)
        Task { @MainActor in
            self.refreshReachability()
            self.apply(context.value)
        }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        Task { @MainActor in
            self.refreshReachability()
            if self.isReachable && self.phonePlaylists.isEmpty { self.refreshPlaylists() }
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        let box = UncheckedSendableBox(applicationContext)
        Task { @MainActor in self.apply(box.value) }
    }

    nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        let box = UncheckedSendableBox(userInfo)
        Task { @MainActor in self.apply(box.value) }
    }

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        let box = UncheckedSendableBox(message)
        Task { @MainActor in self.apply(box.value) }
    }

    nonisolated func session(_ session: WCSession, didReceive file: WCSessionFile) {
        // The system deletes file.fileURL as soon as this method returns: move it right here.
        guard let songID = file.metadata?[WatchKeys.fileSongID] as? String,
              let dest = WatchStorage.adoptReceivedFile(file.fileURL, songID: songID) else { return }
        Task { @MainActor in WatchStorage.shared.fileArrived(songID: songID, at: dest) }
    }
}

/// WatchConnectivity hands over non-Sendable dictionaries on its own queue.
struct UncheckedSendableBox<T>: @unchecked Sendable { let value: T; init(_ v: T) { value = v } }
