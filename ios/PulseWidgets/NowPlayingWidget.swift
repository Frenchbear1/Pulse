import SwiftUI
import WidgetKit
import AppIntents
import PulseKit

// MARK: - Timeline

struct NowPlayingEntry: TimelineEntry {
    var date: Date
    var snapshot: NowPlayingSnapshot
}

struct NowPlayingProvider: TimelineProvider {
    func placeholder(in context: Context) -> NowPlayingEntry {
        NowPlayingEntry(date: Date(), snapshot: NowPlayingSnapshot(songID: "preview", title: "Midnight Drive",
                                                                     artist: "Your Library", isPlaying: true,
                                                                     elapsed: 72, duration: 214))
    }

    func getSnapshot(in context: Context, completion: @escaping (NowPlayingEntry) -> Void) {
        let snap = NowPlayingSnapshot.load()
        completion(snap.hasSong || !context.isPreview ? NowPlayingEntry(date: Date(), snapshot: snap) : placeholder(in: context))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NowPlayingEntry>) -> Void) {
        let snap = NowPlayingSnapshot.load()
        let entry = NowPlayingEntry(date: Date(), snapshot: snap)
        // The app reloads this timeline on every track / play-state change. As a fallback, ask
        // for a refresh shortly after the current song should end.
        let policy: TimelineReloadPolicy
        if snap.isPlaying, let end = snap.timerInterval?.upperBound, end > Date() {
            policy = .after(end.addingTimeInterval(2))
        } else {
            policy = .never
        }
        completion(Timeline(entries: [entry], policy: policy))
    }
}

// MARK: - Home Screen widget (small / medium)

struct NowPlayingWidget: Widget {
    let kind = "PulseNowPlaying"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: NowPlayingProvider()) { entry in
            NowPlayingWidgetView(entry: entry)
                .containerBackground(for: .widget) { WidgetBackdrop(accentHex: entry.snapshot.accentHex) }
                .widgetURL(URL(string: "pulse://nowplaying"))
        }
        .configurationDisplayName("Now Playing")
        .description("What's playing in Pulse, with play/pause and skip.")
        .supportedFamilies([.systemSmall, .systemMedium])
        .contentMarginsDisabled()
    }
}

struct NowPlayingWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: NowPlayingEntry
    private var snap: NowPlayingSnapshot { entry.snapshot }
    private var accent: Color { .accent(snap.accentHex) }

    var body: some View {
        switch family {
        case .systemMedium: medium
        default: small
        }
    }

    private var small: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top) {
                WidgetCover(fileName: snap.artworkFile, accentHex: snap.accentHex, cornerRadius: 12)
                    .frame(width: 58, height: 58)
                    .shadow(color: .black.opacity(0.35), radius: 6, y: 3)
                Spacer(minLength: 0)
                if snap.hasSong { playButton(size: 34) }
            }
            Spacer(minLength: 0)
            titles(lines: 1)
            if snap.hasSong { SnapshotProgress(snapshot: snap, tint: accent) }
        }
        .padding(14)
        .foregroundStyle(.white)
    }

    private var medium: some View {
        HStack(spacing: 14) {
            WidgetCover(fileName: snap.artworkFile, accentHex: snap.accentHex, cornerRadius: 14)
                .frame(width: 118, height: 118)
                .shadow(color: .black.opacity(0.35), radius: 8, y: 4)
            VStack(alignment: .leading, spacing: 6) {
                if let source = snap.sourceLabel, snap.hasSong {
                    Text(source.uppercased()).font(.caption2.weight(.semibold)).foregroundStyle(.white.opacity(0.6)).lineLimit(1)
                }
                titles(lines: 2)
                Spacer(minLength: 0)
                if snap.hasSong {
                    SnapshotProgress(snapshot: snap, tint: accent)
                    HStack(spacing: 18) {
                        Button(intent: LikeSongIntent()) {
                            Image(systemName: snap.isLiked ? "heart.fill" : "heart")
                                .font(.system(size: 17, weight: .semibold))
                                .foregroundStyle(snap.isLiked ? accent : .white.opacity(0.85))
                        }
                        Spacer(minLength: 0)
                        playButton(size: 38)
                        Button(intent: NextTrackIntent()) {
                            Image(systemName: "forward.fill").font(.system(size: 18, weight: .semibold))
                        }
                    }
                    .buttonStyle(.plain)
                } else {
                    Text("Tap to open your library").font(.caption).foregroundStyle(.white.opacity(0.6))
                }
            }
        }
        .padding(14)
        .foregroundStyle(.white)
    }

    private func titles(lines: Int) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(snap.title).font(.headline).lineLimit(lines)
            if !snap.artist.isEmpty {
                Text(snap.artist).font(.subheadline).foregroundStyle(.white.opacity(0.7)).lineLimit(1)
            }
        }
    }

    private func playButton(size: CGFloat) -> some View {
        Button(intent: PlayPauseIntent()) {
            Image(systemName: snap.isPlaying ? "pause.fill" : "play.fill")
                .font(.system(size: size * 0.42, weight: .bold))
                .foregroundStyle(.black)
                .frame(width: size, height: size)
                .background(Circle().fill(.white))
                .contentTransition(.symbolEffect(.replace))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(snap.isPlaying ? "Pause" : "Play")
    }
}

// MARK: - Lock Screen / StandBy accessory widgets

struct NowPlayingAccessoryWidget: Widget {
    let kind = "PulseAccessory"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: NowPlayingProvider()) { entry in
            NowPlayingAccessoryView(snap: entry.snapshot)
                .containerBackground(for: .widget) { AccessoryWidgetBackground() }
                .widgetURL(URL(string: "pulse://nowplaying"))
        }
        .configurationDisplayName("Pulse")
        .description("Now playing on your Lock Screen.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

struct NowPlayingAccessoryView: View {
    @Environment(\.widgetFamily) private var family
    let snap: NowPlayingSnapshot

    var body: some View {
        switch family {
        case .accessoryCircular:
            if snap.hasSong {
                // Circular: progress ring with a play/pause button in the middle.
                Button(intent: PlayPauseIntent()) {
                    ZStack {
                        if snap.isPlaying, let range = snap.timerInterval {
                            ProgressView(timerInterval: range, countsDown: false) { EmptyView() } currentValueLabel: { EmptyView() }
                                .progressViewStyle(.circular)
                        } else {
                            ProgressView(value: snap.duration > 0 ? min(1, snap.elapsed / snap.duration) : 0)
                                .progressViewStyle(.circular)
                        }
                        Image(systemName: snap.isPlaying ? "pause.fill" : "play.fill").font(.system(size: 16, weight: .bold))
                    }
                }
                .buttonStyle(.plain)
                .widgetAccentable()
            } else {
                Image(systemName: "waveform").font(.title2).widgetAccentable()
            }
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Label(snap.hasSong ? (snap.isPlaying ? "Playing" : "Paused") : "Pulse", systemImage: "waveform")
                    .font(.caption2.weight(.semibold)).widgetAccentable()
                Text(snap.title).font(.headline).lineLimit(1)
                if !snap.artist.isEmpty { Text(snap.artist).font(.caption).lineLimit(1).foregroundStyle(.secondary) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        default:
            // Inline sits above the clock: one line of text plus an optional symbol.
            Label(snap.hasSong ? "\(snap.title) · \(snap.artist)" : "Pulse", systemImage: snap.isPlaying ? "waveform" : "music.note")
        }
    }
}

// MARK: - Previews

#Preview("Medium", as: .systemMedium) {
    NowPlayingWidget()
} timeline: {
    NowPlayingEntry(date: .now, snapshot: NowPlayingSnapshot(songID: "a", title: "Glass Hours", artist: "Night Arcade",
                                                             isPlaying: true, elapsed: 40, duration: 200, sourceLabel: "Late Drive"))
    NowPlayingEntry(date: .now, snapshot: .empty)
}
