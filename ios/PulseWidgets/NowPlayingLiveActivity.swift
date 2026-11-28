import SwiftUI
import WidgetKit
import ActivityKit
import AppIntents
import PulseKit

/// Lock Screen banner + Dynamic Island for the song that's playing. The app starts and updates the
/// activity (LiveActivityController); buttons run App Intents in the app's process.
struct NowPlayingLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: NowPlayingActivityAttributes.self) { context in
            LockScreenNowPlaying(state: context.state)
                .activityBackgroundTint(Color(red: 0.06, green: 0.06, blue: 0.09).opacity(0.82))
                .activitySystemActionForegroundColor(.white)
                .widgetURL(URL(string: "pulse://nowplaying"))
        } dynamicIsland: { context in
            let s = context.state
            let accent = Color.accent(s.accentHex)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    WidgetCover(fileName: s.artworkFile, accentHex: s.accentHex, cornerRadius: 12)
                        .frame(width: 56, height: 56)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(s.title).font(.headline).lineLimit(1)
                        Text(s.artist).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Button(intent: LikeSongIntent()) {
                        Image(systemName: s.isLiked ? "heart.fill" : "heart")
                            .font(.title3)
                            .foregroundStyle(s.isLiked ? accent : .white)
                    }
                    .buttonStyle(.plain)
                    .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 8) {
                        ActivityProgress(state: s, tint: accent)
                        ActivityControls(state: s, tint: accent)
                    }
                    .padding(.horizontal, 4)
                }
            } compactLeading: {
                WidgetCover(fileName: s.artworkFile, accentHex: s.accentHex, cornerRadius: 6)
                    .frame(width: 24, height: 24)
            } compactTrailing: {
                // Equalizer-style glyph while playing, pause symbol while paused.
                Image(systemName: s.isPlaying ? "waveform" : "pause.fill")
                    .foregroundStyle(accent)
                    .symbolEffect(.variableColor.iterative, isActive: s.isPlaying)
            } minimal: {
                Image(systemName: s.isPlaying ? "waveform" : "pause.fill").foregroundStyle(accent)
            }
            .keylineTint(accent)
            .widgetURL(URL(string: "pulse://nowplaying"))
        }
    }
}

struct LockScreenNowPlaying: View {
    let state: NowPlayingActivityAttributes.ContentState

    var body: some View {
        let accent = Color.accent(state.accentHex)
        HStack(spacing: 14) {
            WidgetCover(fileName: state.artworkFile, accentHex: state.accentHex, cornerRadius: 12)
                .frame(width: 64, height: 64)
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(state.title).font(.headline).lineLimit(1)
                        Text(state.artist).font(.subheadline).foregroundStyle(.white.opacity(0.7)).lineLimit(1)
                    }
                    Spacer(minLength: 8)
                    Button(intent: LikeSongIntent()) {
                        Image(systemName: state.isLiked ? "heart.fill" : "heart").foregroundStyle(state.isLiked ? accent : .white)
                    }
                    .buttonStyle(.plain)
                }
                ActivityProgress(state: state, tint: accent)
                ActivityControls(state: state, tint: accent)
            }
        }
        .padding(16)
        .foregroundStyle(.white)
    }
}

struct ActivityProgress: View {
    let state: NowPlayingActivityAttributes.ContentState
    let tint: Color

    var body: some View {
        HStack(spacing: 8) {
            if state.isPlaying {
                Text(timerInterval: state.startDate...state.endDate, countsDown: false)
                    .font(.caption2.monospacedDigit()).frame(width: 40, alignment: .leading)
                ProgressView(timerInterval: state.startDate...state.endDate, countsDown: false) { EmptyView() } currentValueLabel: { EmptyView() }
                    .tint(tint)
            } else {
                Text(state.pausedElapsed.clockString).font(.caption2.monospacedDigit()).frame(width: 40, alignment: .leading)
                ProgressView(value: state.duration > 0 ? min(1, state.pausedElapsed / state.duration) : 0).tint(tint)
            }
            Text(state.duration.clockString).font(.caption2.monospacedDigit()).foregroundStyle(.white.opacity(0.6))
                .frame(width: 40, alignment: .trailing)
        }
    }
}

struct ActivityControls: View {
    let state: NowPlayingActivityAttributes.ContentState
    let tint: Color

    var body: some View {
        HStack(spacing: 34) {
            Button(intent: PreviousTrackIntent()) { Image(systemName: "backward.fill") }
            Button(intent: PlayPauseIntent()) {
                Image(systemName: state.isPlaying ? "pause.fill" : "play.fill")
                    .font(.title2)
                    .contentTransition(.symbolEffect(.replace))
            }
            Button(intent: NextTrackIntent()) { Image(systemName: "forward.fill") }
        }
        .font(.title3)
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity)
    }
}
