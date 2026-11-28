import SwiftUI
import WidgetKit
import UIKit
import PulseKit

/// Helpers for the widget extension. Widgets get ~30 MB of memory and no network, so everything
/// they draw comes from small files the app writes into the App Group.
enum WidgetArt {
    /// Loads a cover thumbnail the app exported (ArtworkCache.exportWidgetThumbnail).
    static func image(_ fileName: String?) -> UIImage? {
        guard let fileName, !fileName.isEmpty, !fileName.contains("/") else { return nil }
        let url = AppGroup.widgetArtDirectory.appendingPathComponent(fileName)
        guard let data = try? Data(contentsOf: url) else { return nil }
        return UIImage(data: data)
    }
}

extension Color {
    /// Same parsing as the app's Color(hex:), kept local to the extension.
    init(widgetHex hex: String) {
        let rgb = AccentPalette.rgb(fromHex: hex) ?? AccentPalette.rgb(fromHex: AccentPalette.defaultHex)!
        self.init(red: rgb.r, green: rgb.g, blue: rgb.b)
    }

    static func accent(_ hex: String?) -> Color {
        let tuned = AccentPalette.tuned(hex ?? AccentPalette.defaultHex)
        return Color(red: tuned.r, green: tuned.g, blue: tuned.b)
    }
}

/// Square cover with a soft gradient placeholder when there's no art.
struct WidgetCover: View {
    let fileName: String?
    let accentHex: String?
    var cornerRadius: CGFloat = 10

    var body: some View {
        Group {
            if let ui = WidgetArt.image(fileName) {
                Image(uiImage: ui).resizable().scaledToFill()
            } else {
                ZStack {
                    LinearGradient(colors: [.accent(accentHex), .accent(accentHex).opacity(0.45)],
                                   startPoint: .topLeading, endPoint: .bottomTrailing)
                    Image(systemName: "music.note").font(.title2.weight(.semibold)).foregroundStyle(.white.opacity(0.85))
                }
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
    }
}

/// Dark, art-tinted background used by the system-family widgets (glass look on the Home Screen).
struct WidgetBackdrop: View {
    let accentHex: String?
    var body: some View {
        ZStack {
            Color(red: 0.05, green: 0.05, blue: 0.08)
            LinearGradient(colors: [.accent(accentHex).opacity(0.55), .clear],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
            RadialGradient(colors: [.accent(accentHex).opacity(0.35), .clear],
                           center: .bottomTrailing, startRadius: 4, endRadius: 220)
        }
    }
}

/// Elapsed / remaining progress that animates on its own while playing.
struct SnapshotProgress: View {
    let snapshot: NowPlayingSnapshot
    var tint: Color

    var body: some View {
        if snapshot.isPlaying, let range = snapshot.timerInterval {
            ProgressView(timerInterval: range, countsDown: false) { EmptyView() } currentValueLabel: { EmptyView() }
                .progressViewStyle(.linear)
                .tint(tint)
        } else {
            ProgressView(value: snapshot.duration > 0 ? min(1, snapshot.elapsed / snapshot.duration) : 0)
                .progressViewStyle(.linear)
                .tint(tint)
        }
    }
}
