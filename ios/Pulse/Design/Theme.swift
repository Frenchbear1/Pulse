import SwiftUI
import PulseKit

/// Appearance preferences (the native slice of the web Theme Studio).
struct AppearanceSettings: Codable, Equatable {
    enum Mode: String, Codable, CaseIterable, Identifiable {
        case auto, dark, midnight, black, light
        var id: String { rawValue }
        var label: String { rawValue.capitalized }
    }
    enum AccentMode: String, Codable { case dynamic, fixed }
    enum Background: String, Codable, CaseIterable, Identifiable {
        case art, aurora, solid
        var id: String { rawValue }
        var label: String {
            switch self {
            case .art: "Album art"
            case .aurora: "Aurora"
            case .solid: "Solid"
            }
        }
    }

    var mode: Mode = .dark
    var accentMode: AccentMode = .dynamic
    var accentHex = AccentPalette.defaultHex
    /// nil = derive the partner colour automatically.
    var partnerHex: String?
    var background: Background = .aurora
    var preset = "pulse"
    var liveActivity = true
    var haptics = true
    var librarySort: LibrarySort = .recent
    var libraryGrid = false
    var songSort: SongSort = .added
    var songSortAscending = false

    var colorScheme: ColorScheme? {
        switch mode {
        case .auto: nil
        case .light: .light
        case .dark, .midnight, .black: .dark
        }
    }

    /// Same eight presets as the web app (core.js PRESETS), reduced to what applies natively.
    struct Preset: Identifiable {
        let id: String, name: String, mode: Mode, accentMode: AccentMode, accent: String, partner: String?, background: Background
    }
    static let presets: [Preset] = [
        .init(id: "pulse", name: "Pulse", mode: .dark, accentMode: .dynamic, accent: "#7c5cff", partner: nil, background: .aurora),
        .init(id: "midnight", name: "Midnight", mode: .midnight, accentMode: .fixed, accent: "#6d5dfc", partner: "#22d3ee", background: .aurora),
        .init(id: "vinyl", name: "Vinyl", mode: .dark, accentMode: .dynamic, accent: "#ff8a3d", partner: nil, background: .art),
        .init(id: "ember", name: "Ember", mode: .black, accentMode: .fixed, accent: "#ff7a1a", partner: "#ff3d6e", background: .aurora),
        .init(id: "frost", name: "Frost", mode: .light, accentMode: .fixed, accent: "#3b82f6", partner: "#22d3ee", background: .aurora),
        .init(id: "sakura", name: "Sakura", mode: .light, accentMode: .fixed, accent: "#f2558f", partner: "#a78bfa", background: .aurora),
        .init(id: "mono", name: "Mono", mode: .black, accentMode: .fixed, accent: "#e8e8ec", partner: "#8b8b96", background: .solid),
        .init(id: "lagoon", name: "Lagoon", mode: .dark, accentMode: .fixed, accent: "#14d8b0", partner: "#3b82f6", background: .aurora)
    ]

    mutating func apply(_ p: Preset) {
        preset = p.id; mode = p.mode; accentMode = p.accentMode; accentHex = p.accent; partnerHex = p.partner; background = p.background
    }
}

/// Resolved colours for the current moment (accent may follow the playing song's art).
struct PulseTheme: Equatable {
    var accent: Color
    var partner: Color
    var background: Color
    var accentInk: Color          // readable text on top of the accent
    var mode: AppearanceSettings.Mode
    var backgroundStyle: AppearanceSettings.Background

    init(appearance a: AppearanceSettings, artworkHex: String?) {
        let light = a.mode == .light
        let base = AccentPalette.tuned(artworkHex ?? a.accentHex, forLightTheme: light)
        let partnerRGB = a.partnerHex.map { AccentPalette.tuned($0, forLightTheme: light) } ?? AccentPalette.partner(of: base)
        accent = Color(base)
        partner = Color(partnerRGB)
        accentInk = base.luminance > 0.6 ? Color(red: 0.04, green: 0.04, blue: 0.05) : .white
        mode = a.mode
        backgroundStyle = a.background
        switch a.mode {
        case .midnight: background = Color(red: 7 / 255, green: 10 / 255, blue: 24 / 255)
        case .black: background = .black
        case .light: background = Color(red: 238 / 255, green: 239 / 255, blue: 245 / 255)
        case .dark, .auto: background = Color(red: 9 / 255, green: 9 / 255, blue: 14 / 255)
        }
    }

    var gradient: LinearGradient { LinearGradient(colors: [accent, partner], startPoint: .topLeading, endPoint: .bottomTrailing) }
}

extension Color {
    init(_ rgb: AccentPalette.RGB) { self.init(red: rgb.r, green: rgb.g, blue: rgb.b) }
    init(hex: String) { self.init(AccentPalette.rgb(fromHex: hex) ?? AccentPalette.rgb(fromHex: AccentPalette.defaultHex)!) }
}

/// Navigation destinations used by every tab's NavigationStack.
enum Route: Hashable {
    case playlist(String)
    case folder(String)
    case album(String)
    case artist(String)
    case genre(String)
    case diskFolder(String)
    case songs, albums, artists, genres, diskFolders
    case liked, recent, mostPlayed
}
