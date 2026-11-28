import Foundation
import WidgetKit
import PulseKit

/// Writes the small JSON snapshots widgets read from the App Group, and asks WidgetKit to reload.
/// Reloads are budgeted by the system, so they're only requested when something visible changed;
/// progress bars animate on their own from the snapshot's timestamps.
@MainActor
final class WidgetBridge {
    enum Kind {
        static let nowPlaying = "PulseNowPlaying"
        static let playlists = "PulsePlaylists"
        static let accessory = "PulseAccessory"
    }

    private var lastNowPlaying: NowPlayingSnapshot?

    func publish(_ snap: NowPlayingSnapshot, reloadTimelines: Bool = true) {
        snap.save()
        defer { lastNowPlaying = snap }
        guard reloadTimelines else { return }
        let prev = lastNowPlaying
        let visibleChange = prev == nil || prev?.songID != snap.songID || prev?.isPlaying != snap.isPlaying
            || prev?.isLiked != snap.isLiked || prev?.title != snap.title
        if visibleChange {
            WidgetCenter.shared.reloadTimelines(ofKind: Kind.nowPlaying)
            WidgetCenter.shared.reloadTimelines(ofKind: Kind.accessory)
        }
    }

    func publish(_ snap: LibrarySnapshot) {
        snap.save()
        WidgetCenter.shared.reloadTimelines(ofKind: Kind.playlists)
    }
}
