#if os(iOS) && canImport(ActivityKit)
import ActivityKit
import Foundation

/// Live Activity for the song that's playing: Lock Screen banner + Dynamic Island.
/// Lives in PulseKit because both the app (which starts/updates it) and the widget extension
/// (which draws it) must use the exact same type.
public struct NowPlayingActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable, Sendable {
        public var songID: SongID
        public var title: String
        public var artist: String
        public var isPlaying: Bool
        public var isLiked: Bool
        /// For `Text(timerInterval:)` / `ProgressView(timerInterval:)` while playing.
        public var startDate: Date
        public var endDate: Date
        /// Position shown while paused (timers can't be frozen).
        public var pausedElapsed: TimeInterval
        public var duration: TimeInterval
        public var accentHex: String
        /// Small JPEG in AppGroup.widgetArtDirectory. Live Activity data must stay under ~4 KB, so
        /// the image is passed by file name, never as bytes.
        public var artworkFile: String?
        /// "Playing from ..." label.
        public var sourceLabel: String?

        public init(songID: SongID, title: String, artist: String, isPlaying: Bool, isLiked: Bool,
                    startDate: Date, endDate: Date, pausedElapsed: TimeInterval, duration: TimeInterval,
                    accentHex: String, artworkFile: String?, sourceLabel: String?) {
            self.songID = songID; self.title = title; self.artist = artist; self.isPlaying = isPlaying
            self.isLiked = isLiked; self.startDate = startDate; self.endDate = endDate
            self.pausedElapsed = pausedElapsed; self.duration = duration; self.accentHex = accentHex
            self.artworkFile = artworkFile; self.sourceLabel = sourceLabel
        }

        public init(snapshot s: NowPlayingSnapshot) {
            let interval = s.timerInterval ?? (s.capturedAt...s.capturedAt.addingTimeInterval(max(1, s.duration)))
            self.init(songID: s.songID ?? "", title: s.title, artist: s.artist, isPlaying: s.isPlaying,
                      isLiked: s.isLiked, startDate: interval.lowerBound, endDate: interval.upperBound,
                      pausedElapsed: s.elapsed, duration: s.duration, accentHex: s.accentHex,
                      artworkFile: s.artworkFile, sourceLabel: s.sourceLabel)
        }
    }

    /// Nothing is fixed for the lifetime of a Pulse activity; one activity follows the whole
    /// listening session and every change goes through ContentState.
    public init() {}
}
#endif
