import SwiftUI
import PulseKit

@main
struct PulseApp: App {
    @State private var services = AppServices.shared
    @Environment(\.scenePhase) private var scenePhase

    init() {
        // Register as early as possible: when Siri / a widget button launches Pulse in the
        // background, the intent's perform() runs right after this.
        PlaybackCommandRouter.handler = AppCommandHandler.shared
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(services)
                .environment(services.library)
                .environment(services.player)
                .environment(services.ui)
                .task { await services.start() }
                .onOpenURL { url in services.open(url) }
                .preferredColorScheme(services.appearance.colorScheme)
                .tint(services.theme.accent)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { services.didEnterBackground() }
            if phase == .active { services.didBecomeActive() }
        }
    }
}
