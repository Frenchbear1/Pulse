import XCTest
@testable import PulseKit

/// Pure-logic tests (no audio, no files). Run on a Mac with `swift test` inside ios/PulseKit,
/// or Cmd-U in Xcode.
final class PlayQueueTests: XCTestCase {
    struct SeededRNG: RandomNumberGenerator {
        var state: UInt64
        mutating func next() -> UInt64 { state = state &* 6364136223846793005 &+ 1442695040888963407; return state }
    }

    func testNaturalOrderAdvancesAndStops() {
        var q = PlayQueue()
        XCTAssertEqual(q.start(["a", "b", "c"], at: 1, source: nil), "b")
        XCTAssertEqual(q.advance(manual: false, current: "b"), "c")
        XCTAssertNil(q.advance(manual: false, current: "c"))
    }

    func testRepeatAllWrapsAndRepeatOneHolds() {
        var q = PlayQueue()
        q.start(["a", "b"], source: nil)
        q.repeatMode = .all
        XCTAssertEqual(q.advance(manual: false, current: "a"), "b")
        XCTAssertEqual(q.advance(manual: false, current: "b"), "a")
        q.repeatMode = .one
        XCTAssertEqual(q.advance(manual: false, current: "a"), "a")
        XCTAssertEqual(q.advance(manual: true, current: "a"), "b", "Next still moves on with repeat-one")
    }

    func testUpNextJumpsAhead() {
        var q = PlayQueue()
        q.start(["a", "b", "c"], source: nil)
        q.addToQueue(["x"])
        q.playNext(["y"])
        XCTAssertEqual(q.peekNext(current: "a"), "y")
        XCTAssertEqual(q.advance(manual: true, current: "a"), "y")
        XCTAssertEqual(q.advance(manual: true, current: "y"), "x")
        XCTAssertEqual(q.advance(manual: true, current: "x"), "b")
    }

    func testShuffleKeepsStartFirstAndVisitsEverything() {
        var q = PlayQueue()
        var rng = SeededRNG(state: 42)
        let ids = (0..<50).map { "s\($0)" }
        XCTAssertEqual(q.start(ids, at: 7, source: nil, shuffle: true, using: &rng), "s7")
        var seen: Set<SongID> = ["s7"]
        var cur: SongID? = "s7"
        while let n = q.advance(manual: false, current: cur) { seen.insert(n); cur = n }
        XCTAssertEqual(seen.count, 50)
    }

    func testSmartShuffleAvoidsSameArtistBackToBack() {
        var q = PlayQueue()
        var rng = SeededRNG(state: 7)
        let ids = (0..<20).map { "s\($0)" }
        let artist: (SongID) -> String? = { Int($0.dropFirst())! < 10 ? "A" : "B" }
        q.start(ids, source: nil, shuffle: true, artistOf: artist, using: &rng)
        var prev: SongID? = q.currentContextSong
        var repeats = 0
        while let n = q.advance(manual: false, current: prev) {
            if let p = prev, artist(p) == artist(n) { repeats += 1 }
            prev = n
        }
        XCTAssertLessThanOrEqual(repeats, 3)
    }

    func testMoveUpNext() {
        var q = PlayQueue()
        q.addToQueue(["a", "b", "c", "d"])
        q.moveUpNext(from: [0], to: 3)
        XCTAssertEqual(q.upNext, ["b", "c", "a", "d"])
    }
}

final class LibraryDatabaseTests: XCTestCase {
    private func db(with songs: [SongID]) -> LibraryDatabase {
        var db = LibraryDatabase()
        for id in songs { db.songs[id] = Song(id: id, rootID: "r", relativePath: id, fileName: id, directories: [], title: id) }
        return db
    }

    func testNestedFoldersPlayEverythingUniquely() {
        var d = db(with: ["a", "b", "c"])
        let f = d.createFolder(named: "Workout")
        let sub = d.createFolder(named: "Running", in: f.id)
        let p1 = d.createPlaylist(named: "Warmup", in: f.id, songIDs: ["a", "b"])
        _ = d.createPlaylist(named: "Long run", in: sub.id, songIDs: ["b", "c"])
        XCTAssertEqual(d.songIDs(in: .folder(f.id)), ["a", "b", "c"])
        XCTAssertEqual(d.path(to: sub.id).map(\.name), ["Workout", "Running"])
        XCTAssertEqual(d.addSongs(["a", "c", "zzz"], toPlaylist: p1.id), 1)
    }

    func testCannotMoveFolderIntoItsOwnChild() {
        var d = LibraryDatabase()
        let a = d.createFolder(named: "A")
        let b = d.createFolder(named: "B", in: a.id)
        XCTAssertFalse(d.move(.folder(a.id), to: b.id))
        XCTAssertTrue(d.move(.folder(b.id), to: nil, at: 0))
        XCTAssertEqual(d.rootItems.first, .folder(b.id))
    }

    func testDeleteFolderDeletesChildren() {
        var d = LibraryDatabase()
        let a = d.createFolder(named: "A")
        let p = d.createPlaylist(named: "P", in: a.id)
        d.delete(.folder(a.id))
        XCTAssertNil(d.playlists[p.id])
        XCTAssertTrue(d.rootItems.isEmpty)
    }

    func testRecordPlayKeepsHistoryUnique() {
        var d = db(with: ["a", "b"])
        d.recordPlay("a"); d.recordPlay("b"); d.recordPlay("a")
        XCTAssertEqual(d.history, ["a", "b"])
        XCTAssertEqual(d.playCounts["a"], 2)
    }
}

final class TextAndLyricsTests: XCTestCase {
    func testPrimaryArtist() {
        XCTAssertEqual(TextNormalizer.primaryArtist("Daft Punk feat. Pharrell Williams"), "Daft Punk")
        XCTAssertEqual(TextNormalizer.allArtists("Simon & Garfunkel"), ["Simon", "Garfunkel"])
        XCTAssertEqual(TextNormalizer.sortKey("The Beatles"), "beatles")
        XCTAssertEqual(TextNormalizer.norm("Beyoncé"), "beyonce")
    }

    func testFilenameGuess() {
        let g = TextNormalizer.guessFromFileName("03 - Massive Attack - Teardrop.mp3")
        XCTAssertEqual(g.artist, "Massive Attack")
        XCTAssertEqual(g.title, "Teardrop")
    }

    func testLRC() {
        let lrc = "[offset:+500]\n[00:01.00]One\n[00:02.50][00:10.00]Two\n[00:05.00]Three"
        let l = LyricsParser.parse(lrc, source: "test")
        XCTAssertEqual(l.synced?.map(\.text), ["One", "Two", "Three", "Two"])
        XCTAssertEqual(l.synced?.first?.time ?? 0, 0.5, accuracy: 0.001)
        XCTAssertEqual(l.activeLineIndex(at: 2.2), 1)
    }

    func testAccentIsReadableOnDark() {
        let c = AccentPalette.tuned("#101010")
        XCTAssertGreaterThan(c.luminance, 0.4)
        XCTAssertEqual(AccentPalette.rgb(fromHex: "#ff0000")?.r, 1)
    }

    func testSnapshotExtrapolates() {
        let t0 = Date()
        let s = NowPlayingSnapshot(songID: "a", isPlaying: true, elapsed: 10, duration: 100, capturedAt: t0)
        XCTAssertEqual(s.elapsed(at: t0.addingTimeInterval(5)), 15, accuracy: 0.01)
    }
}
