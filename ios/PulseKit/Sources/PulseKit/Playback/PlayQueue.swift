import Foundation

public enum RepeatMode: String, Codable, Sendable, CaseIterable {
    case off, all, one
    public var next: RepeatMode {
        switch self {
        case .off: .all
        case .all: .one
        case .one: .off
        }
    }
}

/// The play queue, ported from the web player (player.js): a *context* list (the album/playlist you
/// started from) played in `order` (natural or shuffled), plus an "Up Next" list that jumps ahead of
/// the context (Play Next / Add to Queue). Pure value type so it is easy to test and to persist.
public struct PlayQueue: Codable, Sendable, Equatable {
    public private(set) var context: [SongID] = []
    /// Indices into `context`, in play order.
    public private(set) var order: [Int] = []
    /// Position inside `order` of the current context song (-1 = nothing yet).
    public private(set) var position: Int = -1
    public private(set) var upNext: [SongID] = []
    /// True while an Up Next song plays in front of the context song at `position`, so Previous goes back to that song.
    public private(set) var playingFromUpNext: Bool? = nil
    public private(set) var shuffle = false
    public var repeatMode: RepeatMode = .off
    public private(set) var source: PlaybackSource?

    public init() {}

    public var isEmpty: Bool { context.isEmpty && upNext.isEmpty }
    public var currentContextSong: SongID? {
        order.indices.contains(position) ? context[order[position]] : nil
    }

    // MARK: Starting

    /// Start playing `ids` at `startIndex`. With shuffle on and `randomStart`, a random song leads.
    /// `artistOf` lets the smart shuffle avoid the same artist twice in a row.
    @discardableResult
    public mutating func start<G: RandomNumberGenerator>(
        _ ids: [SongID], at startIndex: Int = 0, source: PlaybackSource?, shuffle: Bool? = nil,
        randomStart: Bool = false, artistOf: (SongID) -> String? = { _ in nil }, using rng: inout G
    ) -> SongID? {
        guard !ids.isEmpty else { return nil }
        context = ids
        playingFromUpNext = nil
        self.source = source
        if let shuffle { self.shuffle = shuffle }
        var start = min(max(0, startIndex), ids.count - 1)
        if self.shuffle && randomStart && startIndex == 0 { start = Int.random(in: 0..<ids.count, using: &rng) }
        buildOrder(startingWith: start, artistOf: artistOf, using: &rng)
        position = self.shuffle ? 0 : start
        return currentContextSong
    }

    @discardableResult
    public mutating func start(_ ids: [SongID], at startIndex: Int = 0, source: PlaybackSource?, shuffle: Bool? = nil,
                               randomStart: Bool = false, artistOf: (SongID) -> String? = { _ in nil }) -> SongID? {
        var rng = SystemRandomNumberGenerator()
        return start(ids, at: startIndex, source: source, shuffle: shuffle, randomStart: randomStart,
                     artistOf: artistOf, using: &rng)
    }

    /// Shuffled order keeps `startIdx` first, then a Fisher-Yates shuffle softened so the same
    /// artist doesn't play back-to-back when there's any alternative (web "smart shuffle").
    mutating func buildOrder<G: RandomNumberGenerator>(startingWith startIdx: Int, artistOf: (SongID) -> String?,
                                                        using rng: inout G) {
        var o = Array(context.indices)
        guard shuffle, !o.isEmpty else { order = o; return }
        o.remove(at: startIdx)
        o.shuffle(using: &rng)
        o.insert(startIdx, at: 0)
        if o.count > 2 {
            for i in 1..<o.count {
                guard let a = artistOf(context[o[i - 1]]), !a.isEmpty, artistOf(context[o[i]]) == a else { continue }
                if let k = o.indices.first(where: { $0 > i && artistOf(context[o[$0]]) != a }) { o.swapAt(i, k) }
            }
        }
        order = o
    }

    public mutating func setShuffle(_ on: Bool, artistOf: (SongID) -> String? = { _ in nil }) {
        guard on != shuffle else { return }
        shuffle = on
        guard !context.isEmpty else { return }
        let cur = order.indices.contains(position) ? order[position] : 0
        var rng = SystemRandomNumberGenerator()
        buildOrder(startingWith: cur, artistOf: artistOf, using: &rng)
        position = shuffle ? 0 : cur
    }

    // MARK: Moving through the queue

    /// What would play next, without moving (used to preload for gapless/crossfade).
    public func peekNext(current: SongID?) -> SongID? {
        if repeatMode == .one { return current }
        if let first = upNext.first { return first }
        if position + 1 < order.count { return context[order[position + 1]] }
        if repeatMode == .all, let first = order.first { return context[first] }
        return nil
    }

    /// Move to the next song. `manual` = the user pressed Next (repeat-one doesn't trap them, and
    /// the end of the list wraps around).
    public mutating func advance(manual: Bool, current: SongID?) -> SongID? {
        if repeatMode == .one && !manual { return current }
        if !upNext.isEmpty { playingFromUpNext = true; return upNext.removeFirst() }
        playingFromUpNext = nil
        if position + 1 < order.count { position += 1; return context[order[position]] }
        if repeatMode == .all || (manual && !order.isEmpty) {
            if shuffle && repeatMode == .all, let first = order.first {
                var rng = SystemRandomNumberGenerator()
                buildOrder(startingWith: first, artistOf: { _ in nil }, using: &rng)
            }
            position = 0
            return context[order[0]]
        }
        return nil
    }

    /// Previous song, or nil meaning "restart the current one" (also when >3 s in; caller decides).
    public mutating func retreat() -> SongID? {
        if playingFromUpNext == true {
            playingFromUpNext = nil
            if order.indices.contains(position) { return context[order[position]] }   // back to the song Up Next interrupted
        }
        if position > 0 { position -= 1 } else if repeatMode == .all, !order.isEmpty { position = order.count - 1 } else { return nil }
        return context[order[position]]
    }

    /// Jump to a context song shown in the queue list (`orderPosition` from `upcoming`).
    public mutating func jump(toOrderPosition p: Int) -> SongID? {
        guard order.indices.contains(p) else { return nil }
        position = p
        playingFromUpNext = nil
        return context[order[p]]
    }

    /// Jump to an Up Next entry: everything before it is dropped.
    public mutating func jump(toUpNextIndex i: Int) -> SongID? {
        guard upNext.indices.contains(i) else { return nil }
        let id = upNext[i]
        upNext.removeFirst(i + 1)
        playingFromUpNext = true
        return id
    }

    /// Context songs after the current one (wrapping when repeat-all), with their order position.
    public func upcoming(max: Int = 80) -> [(id: SongID, orderPosition: Int)] {
        var out: [(SongID, Int)] = []
        var p = position + 1
        while p < order.count && out.count < max { out.append((context[order[p]], p)); p += 1 }
        if repeatMode == .all {
            p = 0
            while p <= position && p < order.count && out.count < max { out.append((context[order[p]], p)); p += 1 }
        }
        return out
    }

    // MARK: Up Next editing

    public mutating func playNext(_ ids: [SongID]) { upNext.insert(contentsOf: ids, at: 0) }
    public mutating func addToQueue(_ ids: [SongID]) { upNext.append(contentsOf: ids) }
    public mutating func removeUpNext(at offsets: IndexSet) {
        for i in offsets.sorted(by: >) where upNext.indices.contains(i) { upNext.remove(at: i) }
    }
    public mutating func moveUpNext(from source: IndexSet, to destination: Int) {
        let moving = source.sorted().map { upNext[$0] }
        var rest = upNext.enumerated().filter { !source.contains($0.offset) }.map(\.element)
        let at = max(0, min(rest.count, destination - source.filter { $0 < destination }.count))
        rest.insert(contentsOf: moving, at: at)
        upNext = rest
    }
    public mutating func clearUpNext() { upNext.removeAll() }

    /// Drop songs that no longer exist (after a rescan or restore).
    public mutating func prune(keeping exists: (SongID) -> Bool) {
        let current = currentContextSong
        upNext.removeAll { !exists($0) }
        let keptIdx = context.indices.filter { exists(context[$0]) }
        guard keptIdx.count != context.count else { return }
        let remap = Dictionary(uniqueKeysWithValues: keptIdx.enumerated().map { ($0.element, $0.offset) })
        context = keptIdx.map { context[$0] }
        order = order.compactMap { remap[$0] }
        position = current.flatMap { c in order.firstIndex { context[$0] == c } } ?? min(position, order.count - 1)
    }
}
