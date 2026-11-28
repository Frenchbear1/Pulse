import Foundation

/// The commands that App Intents (Siri, Shortcuts, widget buttons, Live Activity buttons), CarPlay
/// and the watch can send. The app registers its PlayerEngine-backed handler at launch.
///
/// Why a router instead of calling PlayerEngine directly from intents: intent files are compiled
/// into the widget extension too. Playback intents conform to `AudioPlaybackIntent`, which makes
/// the system run them in the *app's* process (launching it in the background if needed), where the
/// handler is registered. If an intent ever ends up running in the extension, there is no handler
/// and it fails cleanly instead of spinning up a second audio engine in the widget.
@MainActor
public protocol PlaybackCommandHandling: AnyObject {
    /// Load the library etc. if the app was just launched in the background to run an intent.
    func prepare() async
    func togglePlayPause()
    func play()
    func pause()
    func nextTrack()
    func previousTrack()
    /// Like/unlike the current song; returns the new state (nil when nothing is playing).
    func toggleLikeCurrent() -> Bool?
    /// Start a playlist (or "liked") by id; returns false if it doesn't exist or is empty.
    func playLibraryItem(id: String, shuffle: Bool) -> Bool
}

@MainActor
public enum PlaybackCommandRouter {
    public static weak var handler: PlaybackCommandHandling?
}

public enum PulseIntentError: Error, CustomLocalizedStringResourceConvertible {
    case appNotRunning, notFound, nothingPlaying
    public var localizedStringResource: LocalizedStringResource {
        switch self {
        case .appNotRunning: return "Open Pulse once, then try again."
        case .notFound: return "That playlist isn't in your Pulse library."
        case .nothingPlaying: return "Nothing is playing in Pulse."
        }
    }
}
