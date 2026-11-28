import Foundation
import PulseKit

/// Playlists copied from the iPhone for offline playback.
///
/// Layout (watch's own Application Support - not shared with anything):
///   Synced/manifests.json      [WatchSyncManifest]
///   Synced/<songID>.<ext>      song files (one copy even if a song is in several playlists)
@MainActor @Observable
final class WatchStorage {
    static let shared = WatchStorage()

    private(set) var manifests: [WatchSyncManifest] = []
    /// songID -> local file, for songs that have finished transferring.
    private(set) var files: [SongID: URL] = [:]

    nonisolated static let directory: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent("Synced", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        // Re-downloadable from the phone; keep it out of the watch's backup.
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        var d = dir; try? d.setResourceValues(values)
        return dir
    }()
    private var manifestURL: URL { Self.directory.appendingPathComponent("manifests.json") }

    init() {
        manifests = JSONFile.read([WatchSyncManifest].self, from: manifestURL) ?? []
        rescanFiles()
    }

    // MARK: Queries

    func availableItems(in manifest: WatchSyncManifest) -> [WatchSyncManifest.Item] {
        manifest.items.filter { files[$0.id] != nil }
    }

    func progress(of manifest: WatchSyncManifest) -> (done: Int, total: Int) {
        (availableItems(in: manifest).count, manifest.items.count)
    }

    var usedBytes: Int64 {
        files.values.reduce(0) { $0 + Int64((try? $1.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) }
    }

    // MARK: Changes (called by WatchSessionManager / UI)

    func upsert(_ manifest: WatchSyncManifest) {
        var dropped: Set<SongID> = []
        if let i = manifests.firstIndex(where: { $0.id == manifest.id }) {
            dropped = Set(manifests[i].items.map(\.id))
            manifests[i] = manifest
        } else {
            manifests.append(manifest)
        }
        save()
        deleteFiles(dropped)
    }

    func remove(playlistID: String) {
        let dropped = Set(manifests.first { $0.id == playlistID }?.items.map(\.id) ?? [])
        manifests.removeAll { $0.id == playlistID }
        save()
        deleteFiles(dropped)
    }

    /// A file finished arriving and was already moved into `directory` (see WatchSessionManager).
    func fileArrived(songID: SongID, at url: URL) {
        files[songID] = url
    }

    /// Moves a received file into place. Must run *synchronously* inside
    /// session(_:didReceive:) - WatchConnectivity deletes the temporary file when that returns.
    nonisolated static func adoptReceivedFile(_ tmp: URL, songID: SongID) -> URL? {
        let safeID = songID.replacingOccurrences(of: "/", with: "_")
        let ext = tmp.pathExtension.isEmpty ? "m4a" : tmp.pathExtension.lowercased()
        let dest = directory.appendingPathComponent("\(safeID).\(ext)")
        let fm = FileManager.default
        // Replace any older copy (possibly with a different extension).
        if let existing = try? fm.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) {
            for f in existing where f.deletingPathExtension().lastPathComponent == safeID { try? fm.removeItem(at: f) }
        }
        do { try fm.moveItem(at: tmp, to: dest); return dest } catch { return nil }
    }

    // MARK: Private

    private func save() { try? JSONFile.write(manifests, to: manifestURL) }

    private func rescanFiles() {
        let urls = (try? FileManager.default.contentsOfDirectory(at: Self.directory, includingPropertiesForKeys: nil)) ?? []
        var map: [SongID: URL] = [:]
        for u in urls where u.lastPathComponent != "manifests.json" {
            map[u.deletingPathExtension().lastPathComponent] = u
        }
        files = map
    }

    /// Deletes files for `candidates` that no remaining playlist uses. Only songs that just left a
    /// playlist are candidates: a file can arrive before its manifest (the two travel on different
    /// WatchConnectivity channels), so "not in any manifest yet" doesn't mean unwanted.
    private func deleteFiles(_ candidates: Set<SongID>) {
        let keep = Set(manifests.flatMap { $0.items.map(\.id) })
        for id in candidates.subtracting(keep) {
            if let url = files[id] { try? FileManager.default.removeItem(at: url) }
            files[id] = nil
        }
    }
}
