import Foundation

/// Sleep timer state (web: player.setSleep). The engine checks it on every tick; the last 15 s of
/// a timed sleep fade the volume out instead of cutting off.
public enum SleepTimer: Equatable, Sendable {
    case off
    case at(Date)
    case endOfSong

    public static let presets: [Int] = [5, 10, 15, 30, 45, 60, 90]
    public static let fadeSeconds: TimeInterval = 15

    public var isActive: Bool { self != .off }

    public func remaining(from now: Date = Date()) -> TimeInterval? {
        if case .at(let end) = self { return max(0, end.timeIntervalSince(now)) }
        return nil
    }

    /// Volume multiplier for the fade-out (1 = no fade).
    public func fadeFactor(at now: Date = Date()) -> Float {
        guard let left = remaining(from: now), left < Self.fadeSeconds else { return 1 }
        return Float(left / Self.fadeSeconds)
    }

    public var label: String {
        switch self {
        case .off: return "Off"
        case .endOfSong: return "End of song"
        case .at: return remaining().map { "\(TimeInterval($0).clockString) left" } ?? ""
        }
    }
}
