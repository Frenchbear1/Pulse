import Foundation
import AVFoundation
import MediaPlayer
import WidgetKit
import PulseKit

/// Plays synced songs on the watch itself (Bluetooth headphones, or the speaker on models that
/// allow it). Deliberately simpler than the phone's engine: no EQ / crossfade - just a queue.
@MainActor @Observable
final class WatchPlayer {
    static let shared = WatchPlayer()

    private(set) var queue: [WatchSyncManifest.Item] = []
    private(set) var index = 0
    private(set) var isPlaying = false
    private(set) var playlistName: String?
    private(set) var accentHex = AccentPalette.defaultHex
    var current: WatchSyncManifest.Item? { queue.indices.contains(index) ? queue[index] : nil }
    var isActive: Bool { current != nil }

    @ObservationIgnored private let player = AVPlayer()
    @ObservationIgnored private var endObserver: NSObjectProtocol?
    @ObservationIgnored private var commandsRegistered = false

    private init() {
        endObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: nil, queue: .main) { [weak self] note in
            MainActor.assumeIsolated {
                guard let self, (note.object as? AVPlayerItem) === self.player.currentItem else { return }
                self.advance(autoplay: true)
            }
        }
    }

    // MARK: Control

    func play(_ manifest: WatchSyncManifest, startAt songID: SongID? = nil, shuffle: Bool = false) {
        var items = WatchStorage.shared.availableItems(in: manifest)
        guard !items.isEmpty else { return }
        if shuffle { items.shuffle() }
        queue = items
        index = songID.flatMap { id in items.firstIndex { $0.id == id } } ?? 0
        playlistName = manifest.name
        accentHex = manifest.accentHex
        registerRemoteCommands()
        // watchOS routes long-form audio to Bluetooth; activating may show the system route picker.
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .default, policy: .longFormAudio)
        session.activate(options: []) { [weak self] ok, _ in
            Task { @MainActor in
                guard ok, let self else { return }
                self.load(autoplay: true)
            }
        }
    }

    func togglePlayPause() { isPlaying ? pause() : resume() }

    func resume() {
        guard current != nil else { return }
        if player.currentItem == nil { load(autoplay: true); return }
        player.play(); isPlaying = true; publish()
    }

    func pause() { player.pause(); isPlaying = false; publish() }

    func next() { advance(autoplay: isPlaying) }

    func previous() {
        if player.currentTime().seconds > 3 { player.seek(to: .zero); publish(); return }
        index = max(0, index - 1); load(autoplay: isPlaying)
    }

    func stop() {
        player.pause(); player.replaceCurrentItem(with: nil)
        queue = []; index = 0; isPlaying = false; playlistName = nil
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        try? AVAudioSession.sharedInstance().setActive(false)
        publish()
    }

    // MARK: Private

    private func advance(autoplay: Bool) {
        guard !queue.isEmpty else { return }
        if index + 1 < queue.count { index += 1; load(autoplay: autoplay) } else { index = 0; load(autoplay: false) }
    }

    private func load(autoplay: Bool) {
        guard let item = current, let url = WatchStorage.shared.files[item.id] else {
            // File removed since the queue was built - skip it.
            if index + 1 < queue.count { index += 1; load(autoplay: autoplay) } else { pause() }
            return
        }
        player.replaceCurrentItem(with: AVPlayerItem(url: url))
        if autoplay { player.play() }
        isPlaying = autoplay
        publish()
    }

    private func registerRemoteCommands() {
        guard !commandsRegistered else { return }
        commandsRegistered = true
        let c = MPRemoteCommandCenter.shared()
        c.playCommand.addTarget { [weak self] _ in MainActor.assumeIsolated { self?.resume() }; return .success }
        c.pauseCommand.addTarget { [weak self] _ in MainActor.assumeIsolated { self?.pause() }; return .success }
        c.togglePlayPauseCommand.addTarget { [weak self] _ in MainActor.assumeIsolated { self?.togglePlayPause() }; return .success }
        c.nextTrackCommand.addTarget { [weak self] _ in MainActor.assumeIsolated { self?.next() }; return .success }
        c.previousTrackCommand.addTarget { [weak self] _ in MainActor.assumeIsolated { self?.previous() }; return .success }
    }

    /// Now Playing info for the system (and NowPlayingView), plus the complication snapshot.
    private func publish() {
        guard let item = current else {
            // Nothing local: let the complication fall back to what the phone is playing.
            WatchComplicationBridge.publish(WatchSessionManager.shared.phoneNowPlaying)
            return
        }
        let elapsed = player.currentTime().seconds.isFinite ? player.currentTime().seconds : 0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = [
            MPMediaItemPropertyTitle: item.title,
            MPMediaItemPropertyArtist: item.artist,
            MPMediaItemPropertyPlaybackDuration: item.duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: elapsed,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0,
            MPNowPlayingInfoPropertyPlaybackQueueIndex: index,
            MPNowPlayingInfoPropertyPlaybackQueueCount: queue.count
        ]
        WatchComplicationBridge.publish(NowPlayingSnapshot(songID: item.id, title: item.title, artist: item.artist,
                                                           isPlaying: isPlaying, elapsed: elapsed, duration: item.duration,
                                                           accentHex: accentHex, sourceLabel: playlistName.map { "On Watch · \($0)" }))
    }
}

/// The complication reads the watch's own App Group container (separate from the phone's).
enum WatchComplicationBridge {
    @MainActor private static var last: NowPlayingSnapshot?

    @MainActor static func publish(_ snap: NowPlayingSnapshot?) {
        let snap = snap ?? .empty
        let changed = last?.songID != snap.songID || last?.isPlaying != snap.isPlaying
        last = snap
        snap.save()
        if changed { WidgetCenter.shared.reloadAllTimelines() }
    }
}
