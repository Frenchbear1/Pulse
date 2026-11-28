import Foundation

/// String helpers that match the web app's util.js (norm, sortKey) and library.js (primaryArtist),
/// so search, sorting and album/artist grouping behave the same on every platform.
public enum TextNormalizer {
    /// Lowercase + strip diacritics ("Beyoncé" -> "beyonce").
    public static func norm(_ s: String) -> String {
        s.folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: nil)
    }

    /// Sort key that ignores a leading "the", "a" or "an".
    public static func sortKey(_ s: String) -> String {
        let n = norm(s)
        for prefix in ["the ", "a ", "an "] where n.hasPrefix(prefix) {
            return String(n.dropFirst(prefix.count))
        }
        return n
    }

    // Separators used by the web app when splitting artist credits.
    private static let creditSplit = try! NSRegularExpression(
        pattern: #"\s*(?:;|,|/| feat\.? | ft\.? | featuring | & | x | with )\s*"#,
        options: [.caseInsensitive])
    private static let artistListSplit = try! NSRegularExpression(
        pattern: #"\s*(?:;|,|/| feat\.? | ft\.? | & | x )\s*"#,
        options: [.caseInsensitive])

    /// First credited artist: "A feat. B" -> "A".
    public static func primaryArtist(_ artist: String) -> String {
        split(artist, with: creditSplit).first ?? ""
    }

    /// Every credited artist, for the Artists index ("A & B" appears under both).
    public static func allArtists(_ artist: String) -> [String] {
        split(artist.isEmpty ? "Unknown Artist" : artist, with: artistListSplit)
    }

    private static func split(_ s: String, with re: NSRegularExpression) -> [String] {
        let ns = s as NSString
        var parts: [String] = []
        var last = 0
        for m in re.matches(in: s, range: NSRange(location: 0, length: ns.length)) {
            parts.append(ns.substring(with: NSRange(location: last, length: m.range.location - last)))
            last = m.range.location + m.range.length
        }
        parts.append(ns.substring(from: last))
        return parts.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }

    /// "Artist - Title" from a bare filename when a file has no tags.
    public static func guessFromFileName(_ fileName: String) -> (artist: String?, title: String) {
        var base = (fileName as NSString).deletingPathExtension
        // drop a leading track number: "01 ", "01. ", "1 - "
        if let r = base.range(of: #"^\d{1,3}\s*[.\-_)]?\s+"#, options: .regularExpression) {
            base.removeSubrange(r)
        }
        let parts = base.components(separatedBy: " - ")
        if parts.count >= 2 {
            return (parts[0].trimmingCharacters(in: .whitespaces),
                    parts.dropFirst().joined(separator: " - ").trimmingCharacters(in: .whitespaces))
        }
        return (nil, base.trimmingCharacters(in: .whitespaces))
    }
}

/// Deterministic, dependency-free hash for ids (CryptoKit is used for artwork; this is for keys
/// that must be identical across launches and devices).
public enum StableHash {
    public static func fnv1a64(_ s: String) -> String {
        var h: UInt64 = 0xcbf2_9ce4_8422_2325
        for b in s.utf8 { h ^= UInt64(b); h = h &* 0x0000_0100_0000_01B3 }
        return String(h, radix: 36)
    }
}

public extension TimeInterval {
    /// 3:07 / 1:02:09
    var clockString: String {
        guard isFinite, self >= 0 else { return "0:00" }
        let s = Int(self.rounded(.down))
        let h = s / 3600, m = (s % 3600) / 60, sec = s % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, sec) : String(format: "%d:%02d", m, sec)
    }
}
