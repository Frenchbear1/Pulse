import AppIntents
import PulseKit

/// Phrases Siri understands without any setup, and the tiles shown in the Shortcuts app.
/// App target only (an app may have exactly one AppShortcutsProvider). Every phrase must contain
/// the app name token.
struct PulseShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: PlayPlaylistIntent(),
                    phrases: ["Play \(\.$playlist) in \(.applicationName)",
                              "Play my \(\.$playlist) playlist in \(.applicationName)"],
                    shortTitle: "Play Playlist",
                    systemImageName: "music.note.list")
        AppShortcut(intent: PlayPauseIntent(),
                    phrases: ["Pause \(.applicationName)", "Resume \(.applicationName)"],
                    shortTitle: "Play / Pause",
                    systemImageName: "playpause.fill")
        AppShortcut(intent: NextTrackIntent(),
                    phrases: ["Skip this song in \(.applicationName)", "Next song in \(.applicationName)"],
                    shortTitle: "Next Song",
                    systemImageName: "forward.fill")
        AppShortcut(intent: LikeSongIntent(),
                    phrases: ["Like this song in \(.applicationName)", "Add this to my \(.applicationName) likes"],
                    shortTitle: "Like Song",
                    systemImageName: "heart.fill")
    }

    static var shortcutTileColor: ShortcutTileColor = .purple
}

/// Call after the library changes so Siri's parameter vocabulary ("Play <Workout> in Pulse") is fresh.
enum ShortcutsVocabulary {
    static func refresh() { PulseShortcuts.updateAppShortcutParameters() }
}
