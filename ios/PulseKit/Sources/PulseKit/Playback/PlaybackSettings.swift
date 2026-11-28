import Foundation

/// Playback preferences (web: the playback half of DEFAULTS in core.js).
public struct PlaybackSettings: Codable, Sendable, Equatable {
    public var volume: Float = 0.8
    public var muted = false
    /// 0.5 ... 2.0
    public var speed: Float = 1
    /// true: speed changes keep the pitch (AVAudioUnitTimePitch); false: tape-style (Varispeed).
    public var keepPitch = true
    public var shuffle = false
    public var repeatMode: RepeatMode = .off
    /// Seconds, 0 ... 12. 0 = gapless.
    public var crossfade: Double = 0
    /// Short fade instead of a hard cut on pause/play.
    public var fadeOnPause = true
    /// Gentle compressor that evens out loud and quiet songs.
    public var leveler = false
    public var eqEnabled = false
    /// Gains in dB for EQBands.frequencies, -12 ... +12.
    public var eqGains: [Float] = Array(repeating: 0, count: EQBands.frequencies.count)
    /// dB, -12 ... +12
    public var preamp: Float = 0
    public var eqPreset: String = "Flat"

    public init() {}

    public static let speedRange: ClosedRange<Float> = 0.5...2.0
    public static let crossfadeRange: ClosedRange<Double> = 0...12
}

public enum EQBands {
    public static let frequencies: [Float] = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
    public static let gainRange: ClosedRange<Float> = -12...12

    public static func label(for hz: Float) -> String { hz >= 1000 ? "\(Int(hz / 1000))k" : "\(Int(hz))" }

    /// Same 15 presets (and values) as the web app's EQ_PRESETS, in the same order.
    public static let presets: [(name: String, gains: [Float])] = [
        ("Flat", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        ("Bass Boost", [6, 5, 4, 2, 0, 0, 0, 0, 0, 0]),
        ("Bass Cut", [-6, -5, -3, -1, 0, 0, 0, 0, 0, 0]),
        ("Treble Boost", [0, 0, 0, 0, 0, 1, 2, 4, 5, 6]),
        ("Vocal", [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1]),
        ("Rock", [4, 3, 2, 0, -1, -1, 1, 2, 3, 4]),
        ("Pop", [-1, 0, 2, 3, 4, 3, 1, 0, -1, -1]),
        ("Hip-Hop", [5, 4, 2, 3, -1, -1, 1, 0, 2, 3]),
        ("Electronic", [4, 3, 1, 0, -2, 1, 0, 1, 3, 4]),
        ("Jazz", [3, 2, 1, 2, -1, -1, 0, 1, 2, 3]),
        ("Classical", [4, 3, 2, 1, -1, -1, 0, 2, 3, 4]),
        ("Acoustic", [3, 3, 2, 1, 1, 1, 2, 2, 2, 1]),
        ("Late Night", [3, 2, 1, 0, -1, -1, 0, 0, -1, -2]),
        ("Loudness", [5, 4, 1, 0, -1, 0, 0, 1, 4, 5]),
        ("Small Speakers", [5, 4, 3, 2, 1, 0, 0, 0, 1, 1])
    ]

    public static func gains(forPreset name: String) -> [Float]? { presets.first { $0.name == name }?.gains }
}

/// A-B loop: repeat the section between `start` and `end` of the current song.
public struct ABLoop: Equatable, Sendable {
    public var start: TimeInterval
    /// nil while the user has set A but not B yet.
    public var end: TimeInterval?
    public init(start: TimeInterval, end: TimeInterval? = nil) { self.start = start; self.end = end }
    public var isComplete: Bool { (end ?? 0) > start + 0.2 }
}

/// Persists Codable settings in the shared (App Group) defaults.
public struct SettingsStore<Value: Codable> {
    let key: String
    let defaults: UserDefaults
    public init(key: String, defaults: UserDefaults = AppGroup.defaults) { self.key = key; self.defaults = defaults }
    public func load(or fallback: @autoclosure () -> Value) -> Value {
        guard let data = defaults.data(forKey: key), let v = try? JSONDecoder().decode(Value.self, from: data) else { return fallback() }
        return v
    }
    public func save(_ value: Value) {
        if let data = try? JSONEncoder().encode(value) { defaults.set(data, forKey: key) }
    }
}
