import Foundation

/// Lyrics for one song: synced (from an .lrc file or LRC-formatted tag) or plain.
public struct Lyrics: Sendable, Equatable {
    public struct Line: Sendable, Equatable, Identifiable {
        public var id: Int
        public var time: TimeInterval
        public var text: String
    }
    public var synced: [Line]?
    public var plain: String
    public var sourceDescription: String

    /// Index of the line being sung at `time` (nil before the first line).
    public func activeLineIndex(at time: TimeInterval) -> Int? {
        guard let synced else { return nil }
        // small lead so the highlight lands as the word starts, same 0.15 s as the web app
        let t = time + 0.15
        var lo = 0, hi = synced.count - 1, found: Int?
        while lo <= hi {
            let mid = (lo + hi) / 2
            if synced[mid].time <= t { found = mid; lo = mid + 1 } else { hi = mid - 1 }
        }
        return found
    }
}

/// LRC parser ported from np.js parseLRC: supports multiple timestamps per line, [offset:+/-ms],
/// and strips word-level <mm:ss.xx> tags.
public enum LyricsParser {
    private static let stamp = try! NSRegularExpression(pattern: #"\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]"#)
    private static let offsetTag = try! NSRegularExpression(pattern: #"^\[offset:\s*([+-]?\d+)\]"#, options: .caseInsensitive)
    private static let anyTag = try! NSRegularExpression(pattern: #"\[[^\]]*\]"#)
    private static let wordTag = try! NSRegularExpression(pattern: #"<\d+:\d+(?:\.\d+)?>"#)

    public static func parse(_ text: String, source: String) -> Lyrics {
        var lines: [(TimeInterval, String)] = []
        var offset: TimeInterval = 0
        for raw in text.components(separatedBy: .newlines) {
            let ns = raw as NSString
            let full = NSRange(location: 0, length: ns.length)
            if let m = offsetTag.firstMatch(in: raw, range: full) {
                offset = (Double(ns.substring(with: m.range(at: 1))) ?? 0) / 1000
                continue
            }
            let stamps = stamp.matches(in: raw, range: full)
            guard !stamps.isEmpty else { continue }
            var txt = anyTag.stringByReplacingMatches(in: raw, range: full, withTemplate: "")
            txt = wordTag.stringByReplacingMatches(in: txt, range: NSRange(location: 0, length: (txt as NSString).length), withTemplate: "")
            txt = txt.trimmingCharacters(in: .whitespaces)
            for m in stamps {
                let min = Double(ns.substring(with: m.range(at: 1))) ?? 0
                let sec = Double(ns.substring(with: m.range(at: 2)).replacingOccurrences(of: ":", with: ".")) ?? 0
                lines.append((min * 60 + sec - offset, txt))
            }
        }
        lines.sort { $0.0 < $1.0 }
        let plain = anyTag.stringByReplacingMatches(in: text, range: NSRange(location: 0, length: (text as NSString).length), withTemplate: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let synced = lines.count > 2 ? lines.enumerated().map { Lyrics.Line(id: $0.offset, time: $0.element.0, text: $0.element.1) } : nil
        return Lyrics(synced: synced, plain: plain, sourceDescription: source)
    }
}
