#if os(iOS)
import AVFoundation

/// AVAudioSession setup and the notifications every music app must handle.
@MainActor
final class AudioSessionController {
    enum Event {
        /// A call, alarm or Siri took the audio. `shouldResume` = the system says it's fine to resume.
        case interruptionBegan
        case interruptionEnded(shouldResume: Bool)
        /// Headphones unplugged / Bluetooth disconnected: Apple's guideline is to pause.
        case oldDeviceUnavailable
        /// Any other route change (AirPlay, CarPlay connected...): no action, but refresh UI.
        case routeChanged
        /// mediaserverd restarted: every audio object is invalid and must be rebuilt.
        case mediaServicesReset
    }

    var onEvent: ((Event) -> Void)?
    private var observers: [NSObjectProtocol] = []

    func configure() {
        let session = AVAudioSession.sharedInstance()
        do {
            // .longFormAudio routes like Music/Podcasts (AirPlay 2 aware, shows in the route picker).
            try session.setCategory(.playback, mode: .default, policy: .longFormAudio, options: [])
        } catch {
            try? session.setCategory(.playback, mode: .default)
        }
        observe()
    }

    /// Activate right before playing (not at launch, so Pulse doesn't stop other apps' audio
    /// just by opening).
    @discardableResult
    func activate() -> Bool {
        do { try AVAudioSession.sharedInstance().setActive(true); return true } catch { return false }
    }

    func deactivate() {
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }

    private func observe() {
        guard observers.isEmpty else { return }
        let nc = NotificationCenter.default
        let session = AVAudioSession.sharedInstance()

        observers.append(nc.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: .main) { [weak self] n in
            guard let info = n.userInfo,
                  let raw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
            let optRaw = info[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
            MainActor.assumeIsolated {
                switch type {
                case .began: self?.onEvent?(.interruptionBegan)
                case .ended: self?.onEvent?(.interruptionEnded(shouldResume: AVAudioSession.InterruptionOptions(rawValue: optRaw).contains(.shouldResume)))
                @unknown default: break
                }
            }
        })

        observers.append(nc.addObserver(forName: AVAudioSession.routeChangeNotification, object: session, queue: .main) { [weak self] n in
            let raw = n.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt ?? 0
            let reason = AVAudioSession.RouteChangeReason(rawValue: raw)
            MainActor.assumeIsolated {
                self?.onEvent?(reason == .oldDeviceUnavailable ? .oldDeviceUnavailable : .routeChanged)
            }
        })

        observers.append(nc.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: session, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.configureAfterReset()
                self?.onEvent?(.mediaServicesReset)
            }
        })
    }

    private func configureAfterReset() {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, policy: .longFormAudio, options: [])
    }

    /// Name of the current output ("AirPods Pro", "Speaker", a car's name over CarPlay...).
    var currentOutputName: String {
        AVAudioSession.sharedInstance().currentRoute.outputs.first?.portName ?? "iPhone"
    }
}
#endif
