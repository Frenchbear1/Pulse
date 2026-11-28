import Foundation
import ImageIO
import CoreGraphics
import CryptoKit
import UniformTypeIdentifiers
#if os(iOS)
import UIKit
#endif

/// Album/playlist covers on disk, keyed by a hash of the original image bytes (so 12 songs from one
/// album share one file, like the web app's cover store). Each cover is stored twice:
///   <key>.jpg     up to 1024 px, for Now Playing and the blurred background
///   <key>_s.jpg   300 px, for lists, grids, CarPlay, widgets
/// ImageIO thumbnails decode straight to the target size, so big embedded art never sits in memory
/// at full resolution.
public final class ArtworkCache: @unchecked Sendable {
    public static let shared = ArtworkCache()

    public enum Size { case large, small }

    private let directory: URL
    #if os(iOS)
    private let memory = NSCache<NSString, UIImage>()
    #endif

    public init(directory: URL = AppGroup.artworkDirectory) {
        self.directory = directory
        #if os(iOS)
        memory.countLimit = 400
        #endif
    }

    public static func key(for data: Data, prefix: String = "") -> String {
        let digest = SHA256.hash(data: data)
        return prefix + digest.prefix(12).map { String(format: "%02x", $0) }.joined()
    }

    public func url(for key: String, size: Size) -> URL {
        directory.appendingPathComponent(size == .large ? "\(key).jpg" : "\(key)_s.jpg")
    }

    public func exists(_ key: String) -> Bool {
        FileManager.default.fileExists(atPath: url(for: key, size: .small).path)
    }

    /// Store raw image bytes (JPEG/PNG/HEIC from tags or an imported image). Returns the key and the
    /// average colour, or nil if the bytes aren't a decodable image.
    public func store(_ data: Data, keyPrefix: String = "") -> (key: String, info: ArtworkInfo)? {
        let key = Self.key(for: data, prefix: keyPrefix)
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        guard let large = Self.thumbnail(source, maxPixel: 1024),
              let small = Self.thumbnail(source, maxPixel: 300) else { return nil }
        if !exists(key) {
            Self.writeJPEG(large, to: url(for: key, size: .large), quality: 0.86)
            Self.writeJPEG(small, to: url(for: key, size: .small), quality: 0.8)
        }
        return (key, ArtworkInfo(colorHex: Self.averageColorHex(small)))
    }

    public func remove(_ key: String) {
        try? FileManager.default.removeItem(at: url(for: key, size: .large))
        try? FileManager.default.removeItem(at: url(for: key, size: .small))
        #if os(iOS)
        memory.removeObject(forKey: "\(key)L" as NSString); memory.removeObject(forKey: "\(key)S" as NSString)
        #endif
    }

    /// Delete covers nothing references any more (web gcCovers()).
    public func collectGarbage(keeping used: Set<String>) {
        let fm = FileManager.default
        guard let files = try? fm.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else { return }
        for f in files {
            let name = f.deletingPathExtension().lastPathComponent
            let key = name.hasSuffix("_s") ? String(name.dropLast(2)) : name
            if !used.contains(key) { try? fm.removeItem(at: f) }
        }
    }

    /// Writes a tiny (default 160 px) copy into the widget folder and returns its file name.
    /// Widgets and Live Activities have tight memory limits, so they never load the 1024 px file.
    public func exportWidgetThumbnail(_ key: String, maxPixel: Int = 160) -> String? {
        let name = "\(key)_w\(maxPixel).jpg"
        let dest = AppGroup.widgetArtDirectory.appendingPathComponent(name)
        if FileManager.default.fileExists(atPath: dest.path) { return name }
        guard let src = CGImageSourceCreateWithURL(url(for: key, size: .small) as CFURL, nil),
              let img = Self.thumbnail(src, maxPixel: maxPixel) else { return nil }
        Self.writeJPEG(img, to: dest, quality: 0.75)
        return name
    }

    #if os(iOS)
    public func image(for key: String?, size: Size = .small) -> UIImage? {
        guard let key else { return nil }
        let mk = "\(key)\(size == .large ? "L" : "S")" as NSString
        if let hit = memory.object(forKey: mk) { return hit }
        guard let img = UIImage(contentsOfFile: url(for: key, size: size).path) else { return nil }
        memory.setObject(img, forKey: mk)
        return img
    }

    /// Off-main-thread load for scrolling lists.
    public func loadImage(for key: String?, size: Size = .small) async -> UIImage? {
        guard let key else { return nil }
        if let hit = memory.object(forKey: "\(key)\(size == .large ? "L" : "S")" as NSString) { return hit }
        return await Task.detached(priority: .utility) { [self] in
            guard let img = UIImage(contentsOfFile: self.url(for: key, size: size).path) else { return nil }
            let decoded = img.preparingForDisplay() ?? img
            self.memory.setObject(decoded, forKey: "\(key)\(size == .large ? "L" : "S")" as NSString)
            return decoded
        }.value
    }
    #endif

    // MARK: ImageIO helpers

    static func thumbnail(_ source: CGImageSource, maxPixel: Int) -> CGImage? {
        let opts: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixel
        ]
        return CGImageSourceCreateThumbnailAtIndex(source, 0, opts as CFDictionary)
    }

    static func writeJPEG(_ image: CGImage, to url: URL, quality: Double) {
        guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else { return }
        CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        CGImageDestinationFinalize(dest)
    }

    /// Average colour by drawing the image into a 1x1 bitmap (the GPU-free equivalent of the web
    /// app's canvas sampling).
    static func averageColorHex(_ image: CGImage) -> String {
        var px = [UInt8](repeating: 0, count: 4)
        let space = CGColorSpaceCreateDeviceRGB()
        let ok: Bool = px.withUnsafeMutableBytes { buf in
            guard let ctx = CGContext(data: buf.baseAddress, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                                      space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            ctx.interpolationQuality = .medium
            ctx.draw(image, in: CGRect(x: 0, y: 0, width: 1, height: 1))
            return true
        }
        guard ok else { return "#666666" }
        return String(format: "#%02x%02x%02x", px[0], px[1], px[2])
    }
}
