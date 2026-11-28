import Foundation

/// Reads `pulse-backup.json` exported by the web/Windows app (Settings > Data > Backup library) and
/// merges its playlists, folders, likes and play counts into the native library.
///
/// Web song ids depend on where the file lived on that device, so songs are matched by the
/// `trackMeta` the backup carries: title + artist first, then file name.
public enum BackupImporter {
    public struct Result: Sendable, Equatable {
        public var playlists = 0
        public var folders = 0
        public var matchedSongs = 0
        public var unmatchedSongs = 0
        public var likes = 0
    }

    public enum ImportError: LocalizedError {
        case notABackup
        public var errorDescription: String? { "That file is not a Pulse backup." }
    }

    // Shapes of the web backup (only what we use; everything optional to be forgiving).
    struct WebBackup: Decodable {
        var nodes: [String: WebNode]?
        var rootNodes: [String]?
        var liked: [String: Double]?
        var plays: [String: Int]?
        var last: [String: Double]?
        var history: [String]?
        var trackMeta: [String: WebTrackMeta]?
    }
    struct WebNode: Decodable {
        var id: String
        var type: String          // "playlist" | "folder"
        var name: String?
        var parent: String?
        var children: [String]?
        var tracks: [String]?
        var desc: String?
        var created: Double?
    }
    struct WebTrackMeta: Decodable {
        var rel: String?
        var root: String?
        var title: String?
        var artist: String?
    }

    public static func apply(_ data: Data, to db: inout LibraryDatabase) throws -> Result {
        guard let backup = try? JSONDecoder().decode(WebBackup.self, from: data),
              backup.nodes != nil || backup.liked != nil else { throw ImportError.notABackup }
        var result = Result()

        // 1) Map web track ids -> native song ids.
        var byTitleArtist: [String: SongID] = [:]
        var byFileName: [String: SongID] = [:]
        for s in db.songs.values {
            byTitleArtist[key(s.title, s.artist)] = byTitleArtist[key(s.title, s.artist)] ?? s.id
            byFileName[TextNormalizer.norm(s.fileName)] = byFileName[TextNormalizer.norm(s.fileName)] ?? s.id
        }
        var map: [String: SongID] = [:]
        for (webID, meta) in backup.trackMeta ?? [:] {
            if let t = meta.title, let id = byTitleArtist[key(t, meta.artist ?? "")] { map[webID] = id; continue }
            if let rel = meta.rel, let name = rel.split(separator: "/").last,
               let id = byFileName[TextNormalizer.norm(String(name))] { map[webID] = id }
        }
        result.matchedSongs = map.count
        result.unmatchedSongs = (backup.trackMeta?.count ?? 0) - map.count

        // 2) Rebuild the tree under a top-level folder so nothing already here is disturbed.
        let nodes = backup.nodes ?? [:]
        let container = db.createFolder(named: "Imported from Pulse backup")
        func build(_ webID: String, into folderID: String) {
            guard let n = nodes[webID] else { return }
            if n.type == "folder" {
                let f = db.createFolder(named: n.name ?? "Folder", in: folderID)
                result.folders += 1
                for c in n.children ?? [] { build(c, into: f.id) }
            } else {
                var p = db.createPlaylist(named: n.name ?? "Playlist", in: folderID,
                                          songIDs: (n.tracks ?? []).compactMap { map[$0] })
                p.summary = n.desc ?? ""
                if let c = n.created { p.created = Date(timeIntervalSince1970: c / 1000) }
                db.playlists[p.id] = p
                result.playlists += 1
            }
        }
        for id in backup.rootNodes ?? [] { build(id, into: container.id) }
        if result.playlists == 0 && result.folders == 0 { db.delete(.folder(container.id)) }

        // 3) Likes, play counts, history (web timestamps are milliseconds).
        for (webID, ms) in backup.liked ?? [:] {
            guard let id = map[webID], db.liked[id] == nil else { continue }
            db.liked[id] = Date(timeIntervalSince1970: ms / 1000); result.likes += 1
        }
        for (webID, n) in backup.plays ?? [:] {
            guard let id = map[webID] else { continue }
            db.playCounts[id] = max(db.playCounts[id] ?? 0, n)
        }
        for (webID, ms) in backup.last ?? [:] {
            guard let id = map[webID] else { continue }
            let d = Date(timeIntervalSince1970: ms / 1000)
            if (db.lastPlayed[id] ?? .distantPast) < d { db.lastPlayed[id] = d }
        }
        if db.history.isEmpty { db.history = (backup.history ?? []).compactMap { map[$0] } }
        return result
    }

    private static func key(_ title: String, _ artist: String) -> String {
        TextNormalizer.norm(title) + "\u{1}" + TextNormalizer.norm(TextNormalizer.primaryArtist(artist))
    }
}
