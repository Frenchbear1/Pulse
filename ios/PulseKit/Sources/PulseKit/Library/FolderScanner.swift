#if os(iOS)
import Foundation

/// One audio file found while walking a root folder.
struct ScannedFile: Sendable {
    var url: URL
    var relativePath: String
    var fileName: String
    var directories: [String]
    var size: Int64
    var modified: Date?
    /// Relative path of a same-named .lrc next to the file.
    var lyricsSidecar: String?
    /// cover.jpg / folder.jpg ... in the same folder, used when the file has no embedded art.
    var folderArt: URL?
}

/// Walks a folder (off the main thread) and lists playable audio files.
enum FolderScanner {
    /// Formats AVFoundation can decode on iOS. OGG/Opus-in-OGG and WMA are left out on purpose:
    /// they would be listed but never play (see docs/IOS_PLAN.md, "Honest limits").
    static let audioExtensions: Set<String> = ["mp3", "m4a", "m4b", "mp4", "aac", "alac", "flac", "wav", "wave",
                                               "aif", "aiff", "aifc", "caf"]
    static let folderArtNames = ["cover", "folder", "front", "album", "albumart", "albumartsmall"]
    static let imageExtensions: Set<String> = ["jpg", "jpeg", "png", "heic", "webp"]

    static func list(_ base: URL) -> (files: [ScannedFile], pendingDownloads: Int) {
        let fm = FileManager.default
        let keys: [URLResourceKey] = [.isRegularFileKey, .isDirectoryKey, .fileSizeKey, .contentModificationDateKey,
                                      .isUbiquitousItemKey, .ubiquitousItemDownloadingStatusKey]
        // Not .skipsHiddenFiles: iCloud Drive can represent not-yet-downloaded files as hidden
        // ".Name.mp3.icloud" placeholders that we want to notice (and ask to download).
        guard let walker = fm.enumerator(at: base, includingPropertiesForKeys: keys,
                                         options: [.skipsPackageDescendants]) else { return ([], 0) }
        let basePath = base.standardizedFileURL.path
        var audio: [URL] = []
        var lrc = Set<String>()                  // lowercased relative paths without extension
        var art: [String: URL] = [:]             // relative dir (lowercased) -> art file
        var pending = 0

        for case let url as URL in walker {
            let name = url.lastPathComponent
            if name.hasPrefix(".") {
                if name.hasSuffix(".icloud") {
                    // ".Song.mp3.icloud" -> ask iCloud for "Song.mp3"; it'll be picked up next scan.
                    let real = url.deletingLastPathComponent()
                        .appendingPathComponent(String(name.dropFirst().dropLast(".icloud".count)))
                    if audioExtensions.contains(real.pathExtension.lowercased()) {
                        try? fm.startDownloadingUbiquitousItem(at: real); pending += 1
                    }
                }
                if (try? url.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true { walker.skipDescendants() }
                continue
            }
            guard let rv = try? url.resourceValues(forKeys: Set(keys)), rv.isRegularFile == true else { continue }
            let ext = url.pathExtension.lowercased()
            let rel = relative(url, to: basePath)
            if ext == "lrc" {
                lrc.insert((rel as NSString).deletingPathExtension.lowercased())
            } else if imageExtensions.contains(ext),
                      folderArtNames.contains(url.deletingPathExtension().lastPathComponent.lowercased()) {
                let dir = (rel as NSString).deletingLastPathComponent.lowercased()
                if art[dir] == nil { art[dir] = url }
            } else if audioExtensions.contains(ext) {
                if rv.isUbiquitousItem == true, rv.ubiquitousItemDownloadingStatus != .current {
                    try? fm.startDownloadingUbiquitousItem(at: url); pending += 1
                    continue
                }
                audio.append(url)
            }
        }

        let files: [ScannedFile] = audio.compactMap { url in
            let rv = try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
            let rel = relative(url, to: basePath)
            let stem = (rel as NSString).deletingPathExtension
            let dirs = (rel as NSString).deletingLastPathComponent.split(separator: "/").map(String.init)
            return ScannedFile(
                url: url, relativePath: rel, fileName: url.lastPathComponent, directories: dirs,
                size: Int64(rv?.fileSize ?? 0), modified: rv?.contentModificationDate,
                lyricsSidecar: lrc.contains(stem.lowercased()) ? stem + ".lrc" : nil,
                folderArt: art[(rel as NSString).deletingLastPathComponent.lowercased()])
        }
        return (files, pending)
    }

    private static func relative(_ url: URL, to basePath: String) -> String {
        let p = url.standardizedFileURL.path
        guard p.hasPrefix(basePath) else { return url.lastPathComponent }
        return String(p.dropFirst(basePath.count)).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }
}
#endif
