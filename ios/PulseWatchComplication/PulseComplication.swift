import SwiftUI
import WidgetKit
import PulseKit

/// Watch-face complication (watchOS 10 complications are WidgetKit accessory widgets).
/// Reads the snapshot the watch app writes into the watch's own App Group container: either what's
/// playing on the watch, or the last state it heard from the iPhone. Tapping opens Pulse.
struct ComplicationEntry: TimelineEntry {
    var date: Date
    var snapshot: NowPlayingSnapshot
}

struct ComplicationProvider: TimelineProvider {
    func placeholder(in context: Context) -> ComplicationEntry {
        ComplicationEntry(date: Date(), snapshot: NowPlayingSnapshot(songID: "p", title: "Glass Hours", artist: "Night Arcade",
                                                                     isPlaying: true, elapsed: 60, duration: 200))
    }
    func getSnapshot(in context: Context, completion: @escaping (ComplicationEntry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : ComplicationEntry(date: Date(), snapshot: .load()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<ComplicationEntry>) -> Void) {
        let snap = NowPlayingSnapshot.load()
        // The watch app reloads on every change; also refresh after the current song should end.
        let policy: TimelineReloadPolicy = snap.isPlaying ? .after(snap.timerInterval?.upperBound ?? Date().addingTimeInterval(900)) : .never
        completion(Timeline(entries: [ComplicationEntry(date: Date(), snapshot: snap)], policy: policy))
    }
}

@main
struct PulseComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "PulseWatchComplication", provider: ComplicationProvider()) { entry in
            ComplicationView(snap: entry.snapshot)
                .containerBackground(for: .widget) { Color.clear }
        }
        .configurationDisplayName("Pulse")
        .description("What's playing.")
        .supportedFamilies([.accessoryCircular, .accessoryCorner, .accessoryRectangular, .accessoryInline])
    }
}

struct ComplicationView: View {
    @Environment(\.widgetFamily) private var family
    let snap: NowPlayingSnapshot

    private var fraction: Double { snap.duration > 0 ? min(1, snap.elapsed / snap.duration) : 0 }

    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                if snap.isPlaying, let range = snap.timerInterval {
                    ProgressView(timerInterval: range, countsDown: false) { EmptyView() } currentValueLabel: { EmptyView() }
                        .progressViewStyle(.circular)
                } else {
                    ProgressView(value: fraction).progressViewStyle(.circular)
                }
                Image(systemName: snap.isPlaying ? "waveform" : "music.note").font(.system(size: 15, weight: .semibold))
            }
            .widgetAccentable()
        case .accessoryCorner:
            Image(systemName: snap.isPlaying ? "waveform" : "music.note")
                .font(.title3)
                .widgetLabel { Text(snap.hasSong ? snap.title : "Pulse") }
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Label(snap.hasSong ? (snap.isPlaying ? "Playing" : "Paused") : "Pulse", systemImage: "waveform")
                    .font(.caption2).widgetAccentable()
                Text(snap.title).font(.headline).lineLimit(1)
                if !snap.artist.isEmpty { Text(snap.artist).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        default:
            Text(snap.hasSong ? "\(snap.title) · \(snap.artist)" : "Pulse")
        }
    }
}
