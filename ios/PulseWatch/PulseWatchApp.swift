import SwiftUI
import PulseKit

@main
struct PulseWatchApp: App {
    @State private var session = WatchSessionManager.shared
    @State private var storage = WatchStorage.shared
    @State private var player = WatchPlayer.shared

    init() { WatchSessionManager.shared.activate() }

    var body: some Scene {
        WindowGroup {
            WatchRootView()
                .environment(session)
                .environment(storage)
                .environment(player)
        }
    }
}

/// Vertical pages (watchOS 10 style): what the phone is playing, playlists on the watch, and
/// "add from iPhone". If something is playing locally, the local player comes first.
struct WatchRootView: View {
    @Environment(WatchPlayer.self) private var player
    @State private var page = 0

    var body: some View {
        NavigationStack {
            TabView(selection: $page) {
                RemoteView().tag(0)
                OnWatchView().tag(1)
                SyncFromPhoneView().tag(2)
            }
            .tabViewStyle(.verticalPage)
        }
        .onChange(of: player.isActive) { _, active in if active { page = 1 } }
    }
}
