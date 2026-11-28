import CarPlay
import PulseKit

/// CarPlay entry point (declared in Info.plist under CPTemplateApplicationSceneSessionRoleApplication).
/// CarPlay audio apps can only use Apple's templates - no custom drawing and no video - which keeps
/// them glanceable and safe; Pulse is audio-only there.
final class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
    func templateApplicationScene(_ templateApplicationScene: CPTemplateApplicationScene,
                                  didConnect interfaceController: CPInterfaceController) {
        CarPlayCoordinator.shared.connect(interfaceController)
    }

    func templateApplicationScene(_ templateApplicationScene: CPTemplateApplicationScene,
                                  didDisconnectInterfaceController interfaceController: CPInterfaceController) {
        CarPlayCoordinator.shared.disconnect()
    }
}
