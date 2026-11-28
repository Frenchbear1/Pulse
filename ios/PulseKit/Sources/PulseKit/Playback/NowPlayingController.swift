#if os(iOS)
import MediaPlayer
import UIKit

/// Lock Screen / Control Center / CarPlay / AirPods / Apple Watch "Now Playing" integration.
///
/// With AVAudioEngine (unlike AVPlayer) iOS doesn't know the playback position, so we publish
/// elapsed time + rate on every play/pause/seek/track change; the system extrapolates in between.
@MainActor
final class NowPlayingController {
    struct Handlers {
        var play: () -> Void
        var pause: () -> Void
        var toggle: () -> Void
        var next: () -> Void
        var previous: () -> Void
        var seek: (TimeInterval) -> Void
        var setShuffle: (Bool) -> Void
        var setRepeat: (RepeatMode) -> Void
        var setRate: (Float) -> Void
        var like: (Bool) -> Void
    }

    private var targets: [(MPRemoteCommand, Any)] = []
    private let center = MPRemoteCommandCenter.shared()

    func register(_ h: Handlers) {
        unregister()
        func add(_ cmd: MPRemoteCommand, _ block: @escaping (MPRemoteCommandEvent) -> MPRemoteCommandHandlerStatus) {
            cmd.isEnabled = true
            targets.append((cmd, cmd.addTarget(handler: block)))
        }
        add(center.playCommand) { _ in h.play(); return .success }
        add(center.pauseCommand) { _ in h.pause(); return .success }
        add(center.togglePlayPauseCommand) { _ in h.toggle(); return .success }
        add(center.nextTrackCommand) { _ in h.next(); return .success }
        add(center.previousTrackCommand) { _ in h.previous(); return .success }
        add(center.changePlaybackPositionCommand) { e in
            guard let e = e as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            h.seek(e.positionTime); return .success
        }
        add(center.changeShuffleModeCommand) { e in
            guard let e = e as? MPChangeShuffleModeCommandEvent else { return .commandFailed }
            h.setShuffle(e.shuffleType != .off); return .success
        }
        add(center.changeRepeatModeCommand) { e in
            guard let e = e as? MPChangeRepeatModeCommandEvent else { return .commandFailed }
            h.setRepeat(e.repeatType == .one ? .one : e.repeatType == .all ? .all : .off); return .success
        }
        center.changePlaybackRateCommand.supportedPlaybackRates = [0.5, 0.75, 1, 1.25, 1.5, 2]
        add(center.changePlaybackRateCommand) { e in
            guard let e = e as? MPChangePlaybackRateCommandEvent else { return .commandFailed }
            h.setRate(e.playbackRate); return .success
        }
        center.likeCommand.localizedTitle = "Like"
        center.likeCommand.localizedShortTitle = "Like"
        add(center.likeCommand) { e in
            guard let e = e as? MPFeedbackCommandEvent else { return .commandFailed }
            h.like(!e.isNegative); return .success
        }
        // Skip-interval buttons would replace Next/Previous on the Lock Screen; a music player wants tracks.
        center.skipForwardCommand.isEnabled = false
        center.skipBackwardCommand.isEnabled = false
    }

    func unregister() {
        for (cmd, token) in targets { cmd.removeTarget(token) }
        targets.removeAll()
    }

    func syncModes(shuffle: Bool, repeatMode: RepeatMode, liked: Bool) {
        center.changeShuffleModeCommand.currentShuffleType = shuffle ? .items : .off
        center.changeRepeatModeCommand.currentRepeatType = repeatMode == .one ? .one : repeatMode == .all ? .all : .off
        center.likeCommand.isActive = liked
    }

    func update(song: Song?, artwork: UIImage?, elapsed: TimeInterval, duration: TimeInterval, rate: Float,
                isPlaying: Bool, queueIndex: Int, queueCount: Int) {
        let info = MPNowPlayingInfoCenter.default()
        guard let song else { info.nowPlayingInfo = nil; info.playbackState = .stopped; return }
        var d: [String: Any] = [
            MPMediaItemPropertyTitle: song.title,
            MPMediaItemPropertyArtist: song.displayArtist,
            MPMediaItemPropertyAlbumTitle: song.album,
            MPMediaItemPropertyPlaybackDuration: duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: elapsed,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? Double(rate) : 0.0,
            MPNowPlayingInfoPropertyDefaultPlaybackRate: 1.0,
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
            MPNowPlayingInfoPropertyPlaybackQueueIndex: queueIndex,
            MPNowPlayingInfoPropertyPlaybackQueueCount: queueCount
        ]
        if !song.albumArtist.isEmpty { d[MPMediaItemPropertyAlbumArtist] = song.albumArtist }
        if !song.genre.isEmpty { d[MPMediaItemPropertyGenre] = song.genre }
        if song.trackNumber > 0 { d[MPMediaItemPropertyAlbumTrackNumber] = song.trackNumber }
        if let artwork {
            // The handler may be called on any thread with any size; UIImage is thread-safe to draw.
            d[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: artwork.size) { _ in artwork }
        }
        info.nowPlayingInfo = d
        info.playbackState = isPlaying ? .playing : .paused
    }

    /// Cheap position-only update (after a seek or rate change).
    func updatePosition(elapsed: TimeInterval, rate: Float, isPlaying: Bool) {
        let info = MPNowPlayingInfoCenter.default()
        guard var d = info.nowPlayingInfo else { return }
        d[MPNowPlayingInfoPropertyElapsedPlaybackTime] = elapsed
        d[MPNowPlayingInfoPropertyPlaybackRate] = isPlaying ? Double(rate) : 0.0
        info.nowPlayingInfo = d
        info.playbackState = isPlaying ? .playing : .paused
    }
}
#endif
