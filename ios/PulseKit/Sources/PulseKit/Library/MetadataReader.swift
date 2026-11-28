#if os(iOS)
import AVFoundation
import CoreMedia

/// Tags, duration, audio format and embedded artwork for one file, read with AVFoundation.
public struct SongMetadata: Sendable {
    public var title: String?
    public var artist: String?
    public var albumArtist: String?
    public var album: String?
    public var genre: String?
    public var composer: String?
    public var year: Int = 0
    public var trackNumber: Int = 0
    public var discNumber: Int = 0
    public var bpm: Int = 0
    public var isrc: String?
    public var lyrics: String?
    public var artwork: Data?
    public var duration: TimeInterval = 0
    public var bitrate: Int = 0
    public var sampleRate: Int = 0
}

/// Reads metadata with `AVURLAsset` and the async `load(...)` API (iOS 16+).
///
/// Coverage, honestly:
///  - MP3 (ID3v2), M4A/AAC/ALAC (iTunes atoms), WAV/AIFF (ID3 chunks): full tags + artwork.
///  - FLAC: AVFoundation plays it; Vorbis-comment tags and pictures are exposed on recent iOS
///    versions under string keys, which the key fallback below picks up. If a FLAC shows up
///    untagged, the title falls back to the filename like the web app does.
///  - OGG Vorbis / Opus in .ogg: not decodable by AVFoundation at all -> skipped by the scanner.
public enum MetadataReader {
    public static func read(_ url: URL) async throws -> SongMetadata {
        let asset = AVURLAsset(url: url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: false])
        var m = SongMetadata()

        let (duration, common, formats) = try await asset.load(.duration, .commonMetadata, .availableMetadataFormats)
        m.duration = duration.seconds.isFinite ? duration.seconds : 0

        var items = common
        for format in formats {
            if let more = try? await asset.loadMetadata(for: format) { items.append(contentsOf: more) }
        }

        for item in items {
            let id = item.identifier
            switch id {
            case .commonIdentifierTitle?, .id3MetadataTitleDescription?, .iTunesMetadataSongName?:
                if m.title == nil { m.title = await string(item) }
            case .commonIdentifierArtist?, .id3MetadataLeadPerformer?, .iTunesMetadataArtist?:
                if m.artist == nil { m.artist = await string(item) }
            case .iTunesMetadataAlbumArtist?, .id3MetadataBand?:
                if m.albumArtist == nil { m.albumArtist = await string(item) }
            case .commonIdentifierAlbumName?, .id3MetadataAlbumTitle?, .iTunesMetadataAlbum?:
                if m.album == nil { m.album = await string(item) }
            case .iTunesMetadataUserGenre?, .id3MetadataContentType?, .quickTimeMetadataGenre?:
                if m.genre == nil { m.genre = (await string(item)).map(cleanID3Genre) }
            case .iTunesMetadataComposer?, .id3MetadataComposer?, .quickTimeMetadataComposer?:
                if m.composer == nil { m.composer = await string(item) }
            case .iTunesMetadataReleaseDate?, .id3MetadataYear?, .id3MetadataRecordingTime?,
                 .commonIdentifierCreationDate?, .quickTimeMetadataYear?:
                if m.year == 0, let s = await string(item) { m.year = leadingYear(s) }
            case .iTunesMetadataTrackNumber?:
                if m.trackNumber == 0 { m.trackNumber = await iTunesPair(item).0 }
            case .id3MetadataTrackNumber?:
                if m.trackNumber == 0, let s = await string(item) { m.trackNumber = leadingInt(s) }
            case .iTunesMetadataDiscNumber?:
                if m.discNumber == 0 { m.discNumber = await iTunesPair(item).0 }
            case .id3MetadataPartOfASet?:
                if m.discNumber == 0, let s = await string(item) { m.discNumber = leadingInt(s) }
            case .iTunesMetadataBeatsPerMin?, .id3MetadataBeatsPerMinute?:
                if m.bpm == 0, let n = try? await item.load(.numberValue) { m.bpm = n.intValue }
                else if m.bpm == 0, let s = await string(item) { m.bpm = leadingInt(s) }
            case .id3MetadataInternationalStandardRecordingCode?:
                if m.isrc == nil { m.isrc = await string(item) }
            case .iTunesMetadataLyrics?, .id3MetadataUnsynchronizedLyric?:
                if m.lyrics == nil { m.lyrics = await string(item) }
            case .commonIdentifierArtwork?, .id3MetadataAttachedPicture?, .iTunesMetadataCoverArt?:
                if m.artwork == nil { m.artwork = try? await item.load(.dataValue) }
            default:
                await applyKeyFallback(item, to: &m)
            }
        }

        // Audio format details for the Info sheet.
        if let track = try? await asset.loadTracks(withMediaType: .audio).first {
            if let info = try? await track.load(.estimatedDataRate, .formatDescriptions) {
                m.bitrate = Int(info.0 / 1000)
                if let d = info.1.first, let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(d)?.pointee {
                    m.sampleRate = Int(asbd.mSampleRate)
                }
            }
        }
        return m
    }

    // Vorbis-comment style keys (FLAC) and other formats that only expose a raw string key.
    private static func applyKeyFallback(_ item: AVMetadataItem, to m: inout SongMetadata) async {
        guard let rawKey = (item.key as? String)?.uppercased() else { return }
        switch rawKey {
        case "TITLE": if m.title == nil { m.title = await string(item) }
        case "ARTIST": if m.artist == nil { m.artist = await string(item) }
        case "ALBUMARTIST", "ALBUM ARTIST": if m.albumArtist == nil { m.albumArtist = await string(item) }
        case "ALBUM": if m.album == nil { m.album = await string(item) }
        case "GENRE": if m.genre == nil { m.genre = await string(item) }
        case "COMPOSER": if m.composer == nil { m.composer = await string(item) }
        case "DATE", "YEAR": if m.year == 0, let s = await string(item) { m.year = leadingYear(s) }
        case "TRACKNUMBER": if m.trackNumber == 0, let s = await string(item) { m.trackNumber = leadingInt(s) }
        case "DISCNUMBER": if m.discNumber == 0, let s = await string(item) { m.discNumber = leadingInt(s) }
        case "BPM": if m.bpm == 0, let s = await string(item) { m.bpm = leadingInt(s) }
        case "ISRC": if m.isrc == nil { m.isrc = await string(item) }
        case "LYRICS", "UNSYNCEDLYRICS": if m.lyrics == nil { m.lyrics = await string(item) }
        default: break
        }
    }

    private static func string(_ item: AVMetadataItem) async -> String? {
        guard let s = try? await item.load(.stringValue) else { return nil }
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }

    /// iTunes `trkn` / `disk` atoms: 8 bytes, [0,0, n_hi,n_lo, total_hi,total_lo, 0,0].
    private static func iTunesPair(_ item: AVMetadataItem) async -> (Int, Int) {
        if let data = try? await item.load(.dataValue), data.count >= 6 {
            let b = [UInt8](data)
            return (Int(b[2]) << 8 | Int(b[3]), Int(b[4]) << 8 | Int(b[5]))
        }
        if let s = await string(item) { return (leadingInt(s), 0) }
        return (0, 0)
    }

    static func leadingInt(_ s: String) -> Int { Int(s.prefix { $0.isNumber }) ?? 0 }

    static func leadingYear(_ s: String) -> Int {
        guard let r = s.range(of: #"\d{4}"#, options: .regularExpression) else { return 0 }
        return Int(s[r]) ?? 0
    }

    /// ID3v1-style "(17)" or "(17)Rock" genre references.
    static func cleanID3Genre(_ s: String) -> String {
        if let r = s.range(of: #"^\(\d+\)"#, options: .regularExpression) {
            let rest = s[r.upperBound...].trimmingCharacters(in: .whitespaces)
            if !rest.isEmpty { return rest }
            let n = Int(s.dropFirst().prefix { $0.isNumber }) ?? -1
            return id3Genres.indices.contains(n) ? id3Genres[n] : s
        }
        return s
    }

    private static let id3Genres = ["Blues", "Classic Rock", "Country", "Dance", "Disco", "Funk", "Grunge", "Hip-Hop",
        "Jazz", "Metal", "New Age", "Oldies", "Other", "Pop", "R&B", "Rap", "Reggae", "Rock", "Techno", "Industrial",
        "Alternative", "Ska", "Death Metal", "Pranks", "Soundtrack", "Euro-Techno", "Ambient", "Trip-Hop", "Vocal",
        "Jazz+Funk", "Fusion", "Trance", "Classical", "Instrumental", "Acid", "House", "Game", "Sound Clip", "Gospel",
        "Noise", "Alternative Rock", "Bass", "Soul", "Punk", "Space", "Meditative", "Instrumental Pop",
        "Instrumental Rock", "Ethnic", "Gothic", "Darkwave", "Techno-Industrial", "Electronic", "Pop-Folk",
        "Eurodance", "Dream", "Southern Rock", "Comedy", "Cult", "Gangsta", "Top 40", "Christian Rap", "Pop/Funk",
        "Jungle", "Native American", "Cabaret", "New Wave", "Psychedelic", "Rave", "Showtunes", "Trailer", "Lo-Fi",
        "Tribal", "Acid Punk", "Acid Jazz", "Polka", "Retro", "Musical", "Rock & Roll", "Hard Rock"]
}
#endif
