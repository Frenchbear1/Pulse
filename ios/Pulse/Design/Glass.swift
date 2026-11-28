import SwiftUI
import PulseKit

/// The Pulse look on iOS: frosted panels floating over a living background, like css/app.css's
/// `.glass` mixin (backdrop blur + hairline edge + top highlight + soft shadow).
struct GlassPanel: ViewModifier {
    var radius: CGFloat = 20
    var material: Material = .ultraThinMaterial

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        content
            .background(material, in: shape)
            .overlay(shape.strokeBorder(.white.opacity(0.08), lineWidth: 1))
            .overlay(alignment: .top) {
                // 1 px top highlight (web: inset 0 1px 0 var(--edge-hi))
                shape.strokeBorder(LinearGradient(colors: [.white.opacity(0.14), .clear], startPoint: .top, endPoint: .center), lineWidth: 1)
            }
            .shadow(color: .black.opacity(0.28), radius: 20, y: 10)
    }
}

extension View {
    func glass(radius: CGFloat = 20, material: Material = .ultraThinMaterial) -> some View {
        modifier(GlassPanel(radius: radius, material: material))
    }
}

/// Full-screen background behind every screen: blurred album art, slow aurora orbs, or solid.
struct AmbientBackground: View {
    @Environment(AppServices.self) private var services
    @Environment(PlayerEngine.self) private var player
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let theme = services.theme
        ZStack {
            theme.background
            switch theme.backgroundStyle {
            case .art:
                BlurredArtwork(key: player.currentSong?.artworkKey).opacity(0.42)
            case .aurora:
                Aurora(accent: theme.accent, partner: theme.partner, animate: !reduceMotion)
            case .solid:
                EmptyView()
            }
            // vignette (web .bg-vignette)
            RadialGradient(colors: [.clear, theme.background.opacity(0.7)], center: UnitPoint(x: 0.3, y: 0),
                           startRadius: 200, endRadius: 900)
        }
        .ignoresSafeArea()
        .animation(.easeInOut(duration: 1.2), value: theme.accent)
    }
}

/// Three huge blurred circles drifting slowly (web #bg .bg-a/.bg-b/.bg-c).
struct Aurora: View {
    var accent: Color
    var partner: Color
    var animate: Bool
    @State private var phase = false

    var body: some View {
        GeometryReader { geo in
            let m = max(geo.size.width, geo.size.height)
            ZStack {
                Circle().fill(accent).frame(width: m * 0.62).blur(radius: 100).opacity(0.3)
                    .offset(x: -m * 0.25 + (phase ? m * 0.18 : 0), y: -m * 0.3 + (phase ? m * 0.14 : 0))
                Circle().fill(partner).frame(width: m * 0.62).blur(radius: 100).opacity(0.2)
                    .offset(x: m * 0.3 - (phase ? m * 0.16 : 0), y: -m * 0.1 + (phase ? m * 0.2 : 0))
                Circle().fill(accent.blended(with: partner, 0.5)).frame(width: m * 0.62).blur(radius: 100).opacity(0.16)
                    .offset(x: m * 0.1 - (phase ? m * 0.14 : 0), y: m * 0.45 - (phase ? m * 0.12 : 0))
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .blendMode(.screen)
        }
        .onAppear {
            guard animate else { return }
            withAnimation(.easeInOut(duration: 40).repeatForever(autoreverses: true)) { phase = true }
        }
    }
}

extension Color {
    /// Simple sRGB mix (Color.mix(with:by:) is iOS 18+).
    func blended(with other: Color, _ t: Double) -> Color {
        let a = UIColor(self), b = UIColor(other)
        var (r1, g1, b1, a1): (CGFloat, CGFloat, CGFloat, CGFloat) = (0, 0, 0, 0)
        var (r2, g2, b2, a2): (CGFloat, CGFloat, CGFloat, CGFloat) = (0, 0, 0, 0)
        a.getRed(&r1, green: &g1, blue: &b1, alpha: &a1)
        b.getRed(&r2, green: &g2, blue: &b2, alpha: &a2)
        return Color(red: r1 + (r2 - r1) * t, green: g1 + (g2 - g1) * t, blue: b1 + (b2 - b1) * t)
    }
}

/// Large cover, heavily blurred and saturated, filling the screen (Now Playing + "art" background).
struct BlurredArtwork: View {
    let key: String?
    @State private var image: UIImage?

    var body: some View {
        GeometryReader { geo in
            ZStack {
                if let image {
                    Image(uiImage: image).resizable().scaledToFill()
                        .frame(width: geo.size.width * 1.3, height: geo.size.height * 1.3)
                        .blur(radius: 70).saturation(1.5)
                        .frame(width: geo.size.width, height: geo.size.height)
                        .clipped()
                        .transition(.opacity)
                }
            }
        }
        .ignoresSafeArea()
        .task(id: key) {
            let img = await ArtworkCache.shared.loadImage(for: key, size: .small) // small is plenty under a 70 pt blur
            withAnimation(.easeInOut(duration: 0.8)) { image = img }
        }
    }
}
