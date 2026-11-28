#if os(iOS)
import AVFoundation
import Observation
import UIKit

/// Pulse's playback engine: the native counterpart of js/player.js.
///
/// Audio graph (AVAudioEngine):
///
///     deck A (AVAudioPlayerNode) ─┐
///                                 ├─> deckMixer ─> varispeed ─> timePitch ─> EQ (10 bands) ─> leveler ─> mainMixer ─> output
///     deck B (AVAudioPlayerNode) ─┘
///
/// - Two decks so the next song can fade in while the current one fades out (crossfade 0-12 s).
/// - With crossfade off, the next file is scheduled on the *same* deck right behind the current
///   one, which AVAudioPlayerNode plays back sample-accurately: gapless albums stay gapless.
/// - Speed 0.5-2x: `timePitch.rate` keeps pitch ("pitch lock"), `varispeed.rate` changes it like a
///   tape. Only one of them is ever != 1.
/// - Position is measured in the *player node's* timeline (before the rate units), so it's the
///   position in the song no matter the speed.
/// - Every scheduled segment carries a generation number. Stopping a node (seek, skip) fires the
///   completion handlers of what was scheduled; stale generations are ignored so a seek is never
///   mistaken for "song ended".
@MainActor @Observable
public final class PlayerEngine {
    public static let shared = PlayerEngine()

    // MARK: Public state (observed by SwiftUI, CarPlay, widgets)

    public private(set) var currentSongID: SongID?
    public private(set) var isPlaying = false
    public private(set) var currentTime: TimeInterval = 0
    public private(set) var duration: TimeInterval = 0
    public private(set) var queue = PlayQueue()
    public private(set) var abLoop: ABLoop?
    public private(set) var sleepTimer: SleepTimer = .off
    public private(set) var lastError: String?
    public private(set) var outputName = "iPhone"

    public var settings: PlaybackSettings {
        didSet {
            guard settings != oldValue else { return }
            applySettings()
            settingsStore.save(settings)
            if settings.speed != oldValue.speed { publishNowPlaying(positionOnly: true) }
        }
    }

    public var currentSong: Song? { library?.song(currentSongID) }

    /// Fires on track change / play state change / queue change (debounce on the receiving end).
    @ObservationIgnored public var onStateChange: ((StateChange) -> Void)?
    public enum StateChange { case track, playState, queue, position }

    // MARK: Private

    @ObservationIgnored private weak var library: LibraryStore?
    @ObservationIgnored private let settingsStore = SettingsStore<PlaybackSettings>(key: "pulse.playback")
    @ObservationIgnored private let session = AudioSessionController()
    @ObservationIgnored private let nowPlaying = NowPlayingController()

    @ObservationIgnored private let engine = AVAudioEngine()
    @ObservationIgnored private let decks = [Deck(), Deck()]
    @ObservationIgnored private var active = 0
    @ObservationIgnored private let deckMixer = AVAudioMixerNode()
    @ObservationIgnored private let varispeed = AVAudioUnitVarispeed()
    @ObservationIgnored private let timePitch = AVAudioUnitTimePitch()
    @ObservationIgnored private let eq = AVAudioUnitEQ(numberOfBands: EQBands.frequencies.count)
    @ObservationIgnored private let leveler = AVAudioUnitEffect(audioComponentDescription: AudioComponentDescription(
        componentType: kAudioUnitType_Effect, componentSubType: kAudioUnitSubType_DynamicsProcessor,
        componentManufacturer: kAudioUnitManufacturer_Apple, componentFlags: 0, componentFlagsMask: 0))

    @ObservationIgnored private var ticker: Timer?
    @ObservationIgnored private var fadeTimer: Timer?
    @ObservationIgnored private var crossfading = false
    @ObservationIgnored private var countedPlay = false
    @ObservationIgnored private var artworkImage: UIImage?
    @ObservationIgnored private var configObserver: NSObjectProtocol?
    @ObservationIgnored private var userVolumeScale: Float = 1   // pause/play fades and sleep fade

    private var deck: Deck { decks[active] }
    private var otherDeck: Deck { decks[1 - active] }

    /// One AVAudioPlayerNode plus what it is currently playing.
    final class Deck {
        let node = AVAudioPlayerNode()
        var file: AVAudioFile?
        var songID: SongID?
        /// Frame in the file where the current segment started (seek target).
        var segmentStart: AVAudioFramePosition = 0
        /// Player-timeline sample time at which the current segment started.
        var sampleBase: AVAudioFramePosition = 0
        var generation = 0
        /// Next song already scheduled behind the current one for gapless playback.
        var gaplessNext: (songID: SongID, file: AVAudioFile)?
        /// Position cached while paused/stopped (playerTime is unreliable then).
        var frozenTime: TimeInterval = 0

        var sampleRate: Double { file?.processingFormat.sampleRate ?? 44_100 }
        var fileDuration: TimeInterval { file.map { Double($0.length) / $0.processingFormat.sampleRate } ?? 0 }

        func position(isRunning: Bool) -> TimeInterval {
            guard let file else { return 0 }
            guard isRunning, node.isPlaying, let nt = node.lastRenderTime, let pt = node.playerTime(forNodeTime: nt) else {
                return frozenTime
            }
            let t = Double(segmentStart) / file.processingFormat.sampleRate + Double(pt.sampleTime - sampleBase) / pt.sampleRate
            return min(max(0, t), fileDuration)
        }
    }

    // MARK: - Setup

    public init() {
        settings = SettingsStore<PlaybackSettings>(key: "pulse.playback").load(or: PlaybackSettings())
        buildGraph()
        session.onEvent = { [weak self] e in self?.handleSessionEvent(e) }
        session.configure()
        outputName = session.currentOutputName
        nowPlaying.register(.init(
            play: { [weak self] in self?.play() },
            pause: { [weak self] in self?.pause() },
            toggle: { [weak self] in self?.togglePlayPause() },
            next: { [weak self] in self?.next() },
            previous: { [weak self] in self?.previous() },
            seek: { [weak self] t in self?.seek(to: t) },
            setShuffle: { [weak self] on in self?.setShuffle(on) },
            setRepeat: { [weak self] m in self?.setRepeat(m) },
            setRate: { [weak self] r in self?.settings.speed = min(max(r, 0.5), 2) },
            like: { [weak self] v in self?.setLikedCurrent(v) }))
        queue.repeatMode = settings.repeatMode
    }

    /// Connect to the library (needed to resolve songs to files). Restores the last session.
    public func attach(library: LibraryStore) {
        self.library = library
        if let s = library.db.session, let current = s.currentSongID, library.song(current) != nil {
            queue = s.queue
            queue.prune { library.song($0) != nil }
            load(current, autoplay: false, startAt: s.position)
        }
    }

    private func buildGraph() {
        for d in decks { engine.attach(d.node) }
        [deckMixer, varispeed, timePitch, eq, leveler].forEach { engine.attach($0) }

        let hwRate = engine.outputNode.outputFormat(forBus: 0).sampleRate
        let fmt = AVAudioFormat(standardFormatWithSampleRate: hwRate > 0 ? hwRate : 44_100, channels: 2)
        for (i, d) in decks.enumerated() { engine.connect(d.node, to: deckMixer, fromBus: 0, toBus: i, format: fmt) }
        engine.connect(deckMixer, to: varispeed, format: fmt)
        engine.connect(varispeed, to: timePitch, format: fmt)
        engine.connect(timePitch, to: eq, format: fmt)
        engine.connect(eq, to: leveler, format: fmt)
        engine.connect(leveler, to: engine.mainMixerNode, format: fmt)

        for (i, band) in eq.bands.enumerated() {
            band.frequency = EQBands.frequencies[i]
            band.filterType = i == 0 ? .lowShelf : (i == eq.bands.count - 1 ? .highShelf : .parametric)
            band.bandwidth = 1.25   // octaves; ~Q 1.1 like the web BiquadFilters
            band.bypass = false
        }
        // Gentle "volume leveler" settings, close to the web DynamicsCompressor (-20 dB, 3.5:1).
        let au = leveler.audioUnit
        AudioUnitSetParameter(au, kDynamicsProcessorParam_Threshold, kAudioUnitScope_Global, 0, -20, 0)
        AudioUnitSetParameter(au, kDynamicsProcessorParam_HeadRoom, kAudioUnitScope_Global, 0, 6, 0)
        AudioUnitSetParameter(au, kDynamicsProcessorParam_AttackTime, kAudioUnitScope_Global, 0, 0.01, 0)
        AudioUnitSetParameter(au, kDynamicsProcessorParam_ReleaseTime, kAudioUnitScope_Global, 0, 0.3, 0)
        AudioUnitSetParameter(au, kDynamicsProcessorParam_OverallGain, kAudioUnitScope_Global, 0, 2, 0)

        engine.prepare()
        applySettings()

        // Output hardware changed sample rate/channels (e.g. AirPods connected): the engine stops
        // itself and must be restarted, re-scheduling from where we were.
        configObserver = NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.recoverEngine() }
        }
    }

    private func startEngineIfNeeded() -> Bool {
        guard !engine.isRunning else { return true }
        session.activate()
        do { try engine.start(); return true } catch {
            lastError = "Couldn't start audio: \(error.localizedDescription)"
            return false
        }
    }

    /// Re-open the current song at the last known position (the 10 Hz tick keeps currentTime fresh).
    private func recoverEngine() {
        let wasPlaying = isPlaying
        isPlaying = false
        stopTicker()
        if let id = currentSongID { load(id, autoplay: wasPlaying, startAt: currentTime) }
    }

    // MARK: - Settings -> graph

    private func applySettings() {
        let s = settings
        let speed = min(max(s.speed, PlaybackSettings.speedRange.lowerBound), PlaybackSettings.speedRange.upperBound)
        timePitch.rate = s.keepPitch ? speed : 1
        varispeed.rate = s.keepPitch ? 1 : speed
        for (i, band) in eq.bands.enumerated() {
            band.gain = s.eqEnabled ? (s.eqGains.indices.contains(i) ? s.eqGains[i] : 0) : 0
        }
        eq.globalGain = s.eqEnabled ? s.preamp : 0
        leveler.bypass = !s.leveler
        applyVolume()
        if queue.repeatMode != s.repeatMode { queue.repeatMode = s.repeatMode; invalidateGapless() }
        if queue.shuffle != s.shuffle { queue.setShuffle(s.shuffle, artistOf: artistOf); invalidateGapless(); onStateChange?(.queue) }
        nowPlaying.syncModes(shuffle: s.shuffle, repeatMode: s.repeatMode, liked: library?.isLiked(currentSongID) ?? false)
    }

    private func applyVolume() {
        let base = settings.muted ? 0 : pow(min(max(settings.volume, 0), 1), 1.6) // same curve as the web app
        engine.mainMixerNode.outputVolume = base * userVolumeScale * sleepTimer.fadeFactor()
    }

    public func setEQPreset(_ name: String) {
        guard let g = EQBands.gains(forPreset: name) else { return }
        settings.eqGains = g; settings.eqPreset = name; settings.eqEnabled = true
    }

    // MARK: - Starting playback

    /// Play `ids` starting at `index` (web playList()).
    public func play(_ ids: [SongID], startingAt index: Int = 0, from source: PlaybackSource?, shuffle: Bool? = nil) {
        guard let library else { return }
        let valid = ids.filter { library.song($0) != nil }
        guard !valid.isEmpty else { return }
        if let shuffle { settings.shuffle = shuffle }
        let startID = index < ids.count ? ids[index] : valid[0]
        let startIdx = valid.firstIndex(of: startID) ?? 0
        guard let first = queue.start(valid, at: startIdx, source: source, shuffle: settings.shuffle,
                                      randomStart: settings.shuffle && index == 0 && shuffle == true,
                                      artistOf: artistOf) else { return }
        queue.repeatMode = settings.repeatMode
        load(first, autoplay: true)
        onStateChange?(.queue)
    }

    private func artistOf(_ id: SongID) -> String? { library?.song(id)?.primaryArtist }

    /// Open the file and schedule it on the active deck.
    private func load(_ id: SongID, autoplay: Bool, startAt: TimeInterval = 0) {
        cancelCrossfade()
        guard let library, let song = library.song(id), let url = library.fileURL(for: song) else {
            lastError = "That song's file isn't available."
            return
        }
        let file: AVAudioFile
        do { file = try AVAudioFile(forReading: url) } catch {
            lastError = "Couldn't open \(song.fileName)."
            // Skip unreadable files like the web player does, without looping forever.
            if autoplay, queue.peekNext(current: id) != id { DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in self?.next() } }
            return
        }
        let d = deck
        stop(d)
        connect(d, for: file)
        d.file = file
        d.songID = id
        currentSongID = id
        duration = d.fileDuration
        countedPlay = false
        abLoop = nil
        artworkImage = library.artwork.image(for: song.artworkKey, size: .large)
        schedule(d, from: startAt)
        currentTime = startAt
        d.frozenTime = startAt
        if autoplay { play() } else { publishNowPlaying() }
        onStateChange?(.track)
    }

    /// Reconnect a deck if the file's format (sample rate / channels) differs from the connection;
    /// AVAudioPlayerNode requires them to match. Reconnecting a mixer input is legal while running.
    private func connect(_ d: Deck, for file: AVAudioFile) {
        let bus = decks.firstIndex { $0 === d } ?? 0
        let current = d.node.outputFormat(forBus: 0)
        let want = file.processingFormat
        if current.sampleRate != want.sampleRate || current.channelCount != want.channelCount {
            engine.disconnectNodeOutput(d.node)
            engine.connect(d.node, to: deckMixer, fromBus: 0, toBus: bus, format: want)
        }
    }

    private func schedule(_ d: Deck, from time: TimeInterval) {
        guard let file = d.file else { return }
        d.generation += 1
        let gen = d.generation
        let start = AVAudioFramePosition(max(0, min(time, d.fileDuration - 0.05)) * file.processingFormat.sampleRate)
        let frames = AVAudioFrameCount(max(0, file.length - start))
        d.segmentStart = start
        d.sampleBase = 0 // the node's timeline restarts at 0 after stop()
        d.gaplessNext = nil
        guard frames > 0 else { return }
        d.node.scheduleSegment(file, startingFrame: start, frameCount: frames, at: nil,
                               completionCallbackType: .dataPlayedBack) { [weak self, weak d] _ in
            DispatchQueue.main.async {
                MainActor.assumeIsolated { if let d { self?.segmentFinished(d, generation: gen, frames: frames) } }
            }
        }
    }

    private func stop(_ d: Deck) {
        d.generation += 1   // invalidate pending completion callbacks before stop() fires them
        d.node.stop()
        d.gaplessNext = nil
    }

    // MARK: - Transport

    public func play() {
        guard currentSongID != nil else {
            // Nothing loaded: shuffle everything (web behaviour when pressing play on an empty player).
            if let all = library?.db.songs.keys, !all.isEmpty { play(Array(all), from: .allSongs, shuffle: true) }
            return
        }
        guard startEngineIfNeeded() else { return }
        rampTimer?.invalidate()
        userVolumeScale = settings.fadeOnPause ? 0.0001 : 1
        applyVolume()
        deck.node.play()
        isPlaying = true
        startTicker()
        if settings.fadeOnPause { ramp(to: 1, over: 0.18) }
        publishNowPlaying()
        onStateChange?(.playState)
    }

    public func pause() {
        guard isPlaying else { return }
        cancelCrossfade()
        deck.frozenTime = deck.position(isRunning: engine.isRunning)
        currentTime = deck.frozenTime
        isPlaying = false
        let finish = { [weak self] in
            guard let self, !self.isPlaying else { return }
            self.decks.forEach { $0.node.pause() }
            self.stopTicker()
        }
        if settings.fadeOnPause { ramp(to: 0.0001, over: 0.16, then: finish) } else { finish() }
        publishNowPlaying(positionOnly: true)
        onStateChange?(.playState)
    }

    public func togglePlayPause() { isPlaying ? pause() : play() }

    public func next() {
        guard let id = queue.advance(manual: true, current: currentSongID) else { endOfQueue(); return }
        load(id, autoplay: true)
        onStateChange?(.queue)
    }

    /// Back restarts the song when >3 s in (or at the very start of the list), else goes back.
    public func previous() {
        if currentTime > 3 { seek(to: 0); return }
        guard let id = queue.retreat() else { seek(to: 0); return }
        load(id, autoplay: true)
        onStateChange?(.queue)
    }

    public func seek(to time: TimeInterval) {
        guard currentSongID != nil else { return }
        cancelCrossfade()
        let t = min(max(0, time), max(0, duration - 0.25))
        let wasPlaying = isPlaying
        stop(deck)
        schedule(deck, from: t)
        currentTime = t
        deck.frozenTime = t
        if wasPlaying, startEngineIfNeeded() { deck.node.play() }
        publishNowPlaying(positionOnly: true)
        onStateChange?(.position)
    }

    public func seek(by delta: TimeInterval) { seek(to: currentTime + delta) }

    public func setShuffle(_ on: Bool) { settings.shuffle = on }
    public func toggleShuffle() { settings.shuffle.toggle() }
    public func setRepeat(_ m: RepeatMode) { settings.repeatMode = m }
    public func cycleRepeat() { settings.repeatMode = settings.repeatMode.next }
    public func setVolume(_ v: Float) { settings.volume = min(max(v, 0), 1); settings.muted = false }

    private func endOfQueue() {
        pause()
        seek(to: 0)
        onStateChange?(.track)
    }

    // MARK: - Queue editing (Up Next)

    public func playNext(_ ids: [SongID]) { queue.playNext(ids); invalidateGapless(); onStateChange?(.queue) }
    public func addToQueue(_ ids: [SongID]) { queue.addToQueue(ids); invalidateGapless(); onStateChange?(.queue) }
    public func removeFromUpNext(at offsets: IndexSet) { queue.removeUpNext(at: offsets); invalidateGapless(); onStateChange?(.queue) }
    public func moveUpNext(from: IndexSet, to: Int) { queue.moveUpNext(from: from, to: to); invalidateGapless(); onStateChange?(.queue) }
    public func clearUpNext() { queue.clearUpNext(); invalidateGapless(); onStateChange?(.queue) }
    public func jumpToUpNext(_ index: Int) { if let id = queue.jump(toUpNextIndex: index) { load(id, autoplay: true); onStateChange?(.queue) } }
    public func jumpToContext(orderPosition p: Int) { if let id = queue.jump(toOrderPosition: p) { load(id, autoplay: true); onStateChange?(.queue) } }

    // MARK: - A-B loop

    /// First tap sets A, second sets B, third clears.
    public func cycleABLoop() {
        switch abLoop {
        case nil: abLoop = ABLoop(start: currentTime)
        case let l? where l.end == nil:
            if currentTime > l.start + 0.5 { abLoop?.end = currentTime; invalidateGapless() } else { abLoop = nil }
        default: abLoop = nil
        }
    }
    public func clearABLoop() { abLoop = nil }

    // MARK: - Sleep timer

    public func setSleepTimer(minutes: Int?) {
        sleepTimer = minutes.map { .at(Date().addingTimeInterval(TimeInterval($0) * 60)) } ?? .off
        applyVolume()
    }
    public func setSleepAtEndOfSong() {
        sleepTimer = .endOfSong
        invalidateGapless(force: true)   // a follower queued in the last 8 s would play straight past the timer
    }

    private func sleepFire() {
        sleepTimer = .off
        pause()
        applyVolume()
    }

    // MARK: - Likes

    public func setLikedCurrent(_ v: Bool) {
        guard let id = currentSongID else { return }
        library?.setLiked(id, v)
        nowPlaying.syncModes(shuffle: settings.shuffle, repeatMode: settings.repeatMode, liked: v)
        onStateChange?(.track)
    }

    public func toggleLikeCurrent() -> Bool? {
        guard let id = currentSongID, let library else { return nil }
        let v = !library.isLiked(id)
        setLikedCurrent(v)
        return v
    }

    // MARK: - Tick (10 Hz while playing): position, play counting, preload, crossfade, A-B, sleep

    private func startTicker() {
        guard ticker == nil else { return }
        let t = Timer(timeInterval: 0.1, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.tick() } }
        RunLoop.main.add(t, forMode: .common)   // keep ticking while the user scrolls
        ticker = t
    }
    private func stopTicker() { ticker?.invalidate(); ticker = nil }

    private func tick() {
        guard isPlaying else { return }
        let t = deck.position(isRunning: engine.isRunning)
        currentTime = t
        let d = duration

        // Count a play after 30 s or half the song (web parity).
        if !countedPlay, let id = currentSongID, t > 30 || (d > 0 && t > d * 0.5) {
            countedPlay = true
            library?.recordPlay(id)
        }

        // A-B loop (100 ms resolution is plenty for practice loops).
        if let l = abLoop, let end = l.end, t >= end { seek(to: l.start); return }

        // Sleep timer.
        switch sleepTimer {
        case .at(let end):
            if Date() >= end { sleepFire(); return }
            applyVolume()
        case .endOfSong:
            if d > 0 && d - t < 0.3 { sleepFire(); return }
        case .off: break
        }

        guard d > 0, abLoop?.end == nil, sleepTimer != .endOfSong else { return }
        let remaining = d - t
        let xf = settings.crossfade
        if xf > 0 {
            if remaining <= xf && !crossfading && settings.repeatMode != .one { startCrossfade(seconds: min(xf, remaining)) }
        } else if remaining < 8 && deck.gaplessNext == nil {
            scheduleGaplessNext()
        }
    }

    /// Queue the next file behind the current one on the same deck (sample-accurate, no gap).
    private func scheduleGaplessNext() {
        guard let library, let nextID = queue.peekNext(current: currentSongID), nextID != currentSongID,
              let song = library.song(nextID), let url = library.fileURL(for: song),
              let file = try? AVAudioFile(forReading: url), let cur = deck.file,
              file.processingFormat == cur.processingFormat else { return } // different format: normal switch at the end
        let d = deck
        let gen = d.generation
        d.gaplessNext = (nextID, file)
        d.node.scheduleFile(file, at: nil, completionCallbackType: .dataPlayedBack) { [weak self, weak d] _ in
            DispatchQueue.main.async {
                MainActor.assumeIsolated { if let d { self?.segmentFinished(d, generation: gen, frames: AVAudioFrameCount(file.length)) } }
            }
        }
    }

    /// The queue changed after the next song was pre-scheduled: re-schedule the current song from
    /// where it is (one tiny re-buffer) so the wrong song doesn't follow.
    private func invalidateGapless(force: Bool = false) {
        guard let pending = deck.gaplessNext, force || pending.songID != queue.peekNext(current: currentSongID) else { return }
        let wasPlaying = isPlaying
        let t = deck.position(isRunning: engine.isRunning)
        stop(deck)
        schedule(deck, from: t)
        if wasPlaying { deck.node.play() }
    }

    private func segmentFinished(_ d: Deck, generation: Int, frames: AVAudioFrameCount) {
        guard d === deck, generation == d.generation else { return }  // stale: seek/skip/crossfade
        if let next = d.gaplessNext {
            // The gapless follower is already playing: just move the bookkeeping over.
            _ = queue.advance(manual: false, current: currentSongID)
            // The finished segment occupied `frames` samples of the node's timeline (same format,
            // so file frames == player samples); the follower starts right after, at file frame 0.
            d.sampleBase += AVAudioFramePosition(frames)
            d.segmentStart = 0
            d.file = next.file
            d.songID = next.songID
            d.gaplessNext = nil
            currentSongID = next.songID
            duration = d.fileDuration
            countedPlay = false
            artworkImage = library?.artwork.image(for: library?.song(next.songID)?.artworkKey, size: .large)
            publishNowPlaying()
            onStateChange?(.track)
            onStateChange?(.queue)
            return
        }
        trackEnded()
    }

    private func trackEnded() {
        if sleepTimer == .endOfSong { sleepFire(); return }
        if settings.repeatMode == .one, let id = currentSongID { load(id, autoplay: true); return }
        guard let id = queue.advance(manual: false, current: currentSongID) else { endOfQueue(); return }
        load(id, autoplay: true)
        onStateChange?(.queue)
    }

    // MARK: - Crossfade

    private func startCrossfade(seconds: TimeInterval) {
        guard let library, let nextID = queue.peekNext(current: currentSongID), let song = library.song(nextID),
              let url = library.fileURL(for: song), let file = try? AVAudioFile(forReading: url) else { return }
        _ = queue.advance(manual: false, current: currentSongID)
        crossfading = true
        let from = deck, to = otherDeck
        stop(to)
        connect(to, for: file)
        to.file = file; to.songID = nextID
        to.node.volume = 0
        schedule(to, from: 0)
        to.node.play()
        active = 1 - active
        currentSongID = nextID
        duration = to.fileDuration
        countedPlay = false
        artworkImage = library.artwork.image(for: song.artworkKey, size: .large)
        publishNowPlaying()
        onStateChange?(.track)
        onStateChange?(.queue)

        let began = Date()
        fadeTimer?.invalidate()
        let t = Timer(timeInterval: 0.03, repeats: true) { [weak self] timer in
            MainActor.assumeIsolated {
                let p = Float(min(1, Date().timeIntervalSince(began) / max(0.05, seconds)))
                // equal-power curve so the middle of the fade doesn't dip
                to.node.volume = sin(p * .pi / 2)
                from.node.volume = cos(p * .pi / 2)
                if p >= 1 {
                    timer.invalidate()
                    self?.stop(from); from.node.volume = 1; to.node.volume = 1
                    self?.crossfading = false
                }
            }
        }
        RunLoop.main.add(t, forMode: .common)
        fadeTimer = t
    }

    private func cancelCrossfade() {
        guard crossfading else { return }
        fadeTimer?.invalidate(); fadeTimer = nil
        stop(otherDeck)
        decks.forEach { $0.node.volume = 1 }
        crossfading = false
    }

    /// Short volume ramps for fade-on-pause.
    private func ramp(to target: Float, over seconds: TimeInterval, then done: (() -> Void)? = nil) {
        rampTimer?.invalidate()   // a new press wins over a fade still running
        let startVal = userVolumeScale
        let began = Date()
        let t = Timer(timeInterval: 0.016, repeats: true) { [weak self] timer in
            MainActor.assumeIsolated {
                guard let self else { timer.invalidate(); return }
                let p = Float(min(1, Date().timeIntervalSince(began) / seconds))
                self.userVolumeScale = startVal + (target - startVal) * p
                self.applyVolume()
                if p >= 1 { timer.invalidate(); self.rampTimer = nil; done?() }
            }
        }
        RunLoop.main.add(t, forMode: .common)
        rampTimer = t
    }
    @ObservationIgnored private var rampTimer: Timer?

    // MARK: - Audio session events

    private func handleSessionEvent(_ e: AudioSessionController.Event) {
        switch e {
        case .interruptionBegan:
            if isPlaying { pause(); resumeAfterInterruption = true }
        case .interruptionEnded(let shouldResume):
            if shouldResume && resumeAfterInterruption { play() }
            resumeAfterInterruption = false
        case .oldDeviceUnavailable:
            pause()
            outputName = session.currentOutputName
        case .routeChanged:
            outputName = session.currentOutputName
        case .mediaServicesReset:
            // Rare (the system audio daemon restarted). Apple's guidance is to rebuild every audio
            // object; this scaffold restarts the existing engine and reloads the song, which covers
            // most cases. If testing shows silence after a reset, recreate `engine` + nodes here.
            engine.stop()
            engine.reset()
            recoverEngine()
        }
    }
    @ObservationIgnored private var resumeAfterInterruption = false

    // MARK: - Now Playing / persistence

    private func publishNowPlaying(positionOnly: Bool = false) {
        let rate = settings.speed
        if positionOnly {
            nowPlaying.updatePosition(elapsed: currentTime, rate: rate, isPlaying: isPlaying)
        } else {
            let upcoming = queue.upNext.count + queue.upcoming(max: 500).count
            nowPlaying.update(song: currentSong, artwork: artworkImage, elapsed: currentTime, duration: duration,
                              rate: rate, isPlaying: isPlaying, queueIndex: 0, queueCount: upcoming + 1)
            nowPlaying.syncModes(shuffle: settings.shuffle, repeatMode: settings.repeatMode,
                                 liked: library?.isLiked(currentSongID) ?? false)
        }
        saveSession()
    }

    private func saveSession() {
        guard let library else { return }
        let s = PlaybackSession(queue: queue, currentSongID: currentSongID, position: currentTime)
        if library.db.session != s { library.mutate { $0.session = s } }
    }

    /// Call when the app goes to the background so the exact position is saved.
    public func persistPosition() {
        if isPlaying { currentTime = deck.position(isRunning: engine.isRunning) }
        saveSession()
    }

    /// Snapshot for widgets / Live Activity / watch.
    public func snapshot(artworkFile: String?) -> NowPlayingSnapshot {
        guard let song = currentSong else { return .empty }
        let accent = AccentPalette.tuned(library?.accentHex(forArtwork: song.artworkKey) ?? AccentPalette.defaultHex).hex
        let upNext = (queue.upNext + queue.upcoming(max: 3).map(\.id)).prefix(3).compactMap { library?.song($0)?.title }
        return NowPlayingSnapshot(songID: song.id, title: song.title, artist: song.displayArtist, album: song.album,
                                  isPlaying: isPlaying, isLiked: library?.isLiked(song.id) ?? false,
                                  elapsed: currentTime, duration: duration, capturedAt: Date(),
                                  rate: Double(settings.speed), accentHex: accent,
                                  sourceLabel: queue.source?.label, upNextTitles: Array(upNext), artworkFile: artworkFile)
    }
}

// MARK: - Commands used by Siri, Shortcuts, widgets, Live Activity, CarPlay and the watch
// (the app's PlaybackCommandHandling implementation forwards here).

extension PlayerEngine {
    public func nextTrack() { next() }
    public func previousTrack() { previous() }

    public func playLibraryItem(id: String, shuffle: Bool) -> Bool {
        guard let library else { return false }
        let ids: [SongID]
        let source: PlaybackSource
        if id == LibrarySnapshot.likedSongsID {
            ids = library.likedSongIDs; source = PlaybackSource(kind: .liked, label: "Liked Songs")
        } else if let p = library.db.playlists[id] {
            ids = library.db.songIDs(in: .playlist(id)); source = PlaybackSource(kind: .playlist, label: p.name, reference: id)
            library.noteOpened(.playlist(id))
        } else if let f = library.db.folders[id] {
            ids = library.db.songIDs(in: .folder(id)); source = PlaybackSource(kind: .folder, label: f.name, reference: id)
            library.noteOpened(.folder(id))
        } else { return false }
        guard !ids.isEmpty else { return false }
        play(ids, startingAt: 0, from: source, shuffle: shuffle ? true : nil)
        return true
    }
}
#endif
