import Foundation
import ActivityKit
import PulseKit

/// One Live Activity per listening session: started on first play, updated on every track /
/// play-state change, ended after a few minutes paused (so it doesn't linger on the Lock Screen).
/// Updates come from the app itself, which is allowed while it's playing audio in the background,
/// so no push-notification server is needed.
@MainActor
final class LiveActivityController {
    private var activity: Activity<NowPlayingActivityAttributes>?
    private var endTask: Task<Void, Never>?
    private var lastState: NowPlayingActivityAttributes.ContentState?

    func update(with snap: NowPlayingSnapshot, enabled: Bool) {
        guard enabled, ActivityAuthorizationInfo().areActivitiesEnabled else { end(); return }
        guard snap.hasSong else { end(); return }
        let state = NowPlayingActivityAttributes.ContentState(snapshot: snap)
        guard state != lastState else { return }
        lastState = state
        // Paused for 10 minutes -> end; stale date tells the system the timer stopped meaning anything.
        let stale = snap.isPlaying ? state.endDate.addingTimeInterval(5) : Date().addingTimeInterval(600)
        let content = ActivityContent(state: state, staleDate: stale)

        endTask?.cancel()
        if !snap.isPlaying {
            endTask = Task { [weak self] in
                try? await Task.sleep(for: .seconds(600))
                if !Task.isCancelled { self?.end() }
            }
        }

        if let activity, activity.activityState == .active {
            Task { await activity.update(content) }
        } else if snap.isPlaying {
            // Only start while actually playing; iOS may refuse to start from the background.
            activity = try? Activity.request(attributes: NowPlayingActivityAttributes(), content: content, pushType: nil)
        }
    }

    func end() {
        endTask?.cancel()
        lastState = nil
        guard let activity else { return }
        self.activity = nil
        Task { await activity.end(nil, dismissalPolicy: .immediate) }
    }
}
