import Foundation

/// Accent colour maths, ported from core.js (tuneAccent / applyAccent): the album-art colour is
/// pushed to a readable saturation and lightness for the current theme, and a second "partner"
/// colour is derived 48 degrees around the hue wheel for gradients.
public enum AccentPalette {
    /// Pulse's default violet (web --acc).
    public static let defaultHex = "#7c5cff"
    public static let defaultPartnerHex = "#22d3ee"

    public struct RGB: Equatable, Sendable {
        public var r: Double, g: Double, b: Double // 0...1
        public init(r: Double, g: Double, b: Double) { self.r = r; self.g = g; self.b = b }
        public var hex: String {
            String(format: "#%02x%02x%02x", Int((r * 255).rounded()), Int((g * 255).rounded()), Int((b * 255).rounded()))
        }
        /// Relative luminance; > 0.6 means dark text reads better on it.
        public var luminance: Double { 0.2126 * r + 0.7152 * g + 0.0722 * b }
    }

    public static func rgb(fromHex hex: String) -> RGB? {
        var s = hex.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        return RGB(r: Double((v >> 16) & 0xff) / 255, g: Double((v >> 8) & 0xff) / 255, b: Double(v & 0xff) / 255)
    }

    /// Keeps an accent readable: enough saturation, lightness clamped for light/dark themes.
    public static func tuned(_ hex: String, forLightTheme light: Bool = false) -> RGB {
        guard let c = rgb(fromHex: hex) else { return rgb(fromHex: defaultHex)! }
        var (h, s, l) = toHSL(c)
        if s > 0.12 { s = max(s, 0.55) }
        l = light ? min(max(l, 0.38), 0.52) : min(max(l, 0.56), 0.72)
        return fromHSL(h, s, l)
    }

    /// Gradient partner: 48 degrees around the wheel (or a darker grey for near-greys).
    public static func partner(of c: RGB) -> RGB {
        let (h, s, l) = toHSL(c)
        if s < 0.12 { return fromHSL(h, 0, max(0.3, l - 0.25)) }
        return fromHSL(h + 48, min(1, s + 0.05), l)
    }

    static func toHSL(_ c: RGB) -> (Double, Double, Double) {
        let mx = max(c.r, c.g, c.b), mn = min(c.r, c.g, c.b)
        let l = (mx + mn) / 2
        guard mx != mn else { return (0, 0, l) }
        let d = mx - mn
        let s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
        var h: Double
        if mx == c.r { h = (c.g - c.b) / d + (c.g < c.b ? 6 : 0) }
        else if mx == c.g { h = (c.b - c.r) / d + 2 }
        else { h = (c.r - c.g) / d + 4 }
        h /= 6
        return (h * 360, s, l)
    }

    static func fromHSL(_ hue: Double, _ s: Double, _ l: Double) -> RGB {
        let h = (hue.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360) / 360
        guard s > 0 else { return RGB(r: l, g: l, b: l) }
        func f(_ p: Double, _ q: Double, _ tt: Double) -> Double {
            var t = tt
            if t < 0 { t += 1 }
            if t > 1 { t -= 1 }
            if t < 1.0 / 6 { return p + (q - p) * 6 * t }
            if t < 0.5 { return q }
            if t < 2.0 / 3 { return p + (q - p) * (2.0 / 3 - t) * 6 }
            return p
        }
        let q = l < 0.5 ? l * (1 + s) : l + s - l * s
        let p = 2 * l - q
        return RGB(r: f(p, q, h + 1.0 / 3), g: f(p, q, h), b: f(p, q, h - 1.0 / 3))
    }
}
