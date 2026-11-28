import CarPlay
import PulseKit

/// Builds and refreshes Pulse's CarPlay UI:
///
///   Tab bar:  Recents | Playlists | Library
///   Now Playing: the system CPNowPlayingTemplate (shuffle, repeat, like, speed, Up Next),
///                pushed whenever something starts playing. The car's own "Now Playing" button also
///                opens it - CarPlay doesn't allow Now Playing as a tab.
///
/// List sizes are capped at CPListTemplate.maximumItemCount (varies by car); long lists start with
/// a "Shuffle all" row so everything is still one tap away.
@MainActor
final class CarPlayCoordinator: NSObject {
    static let shared = CarPlayCoordinator()

    private var interface: CPInterfaceController?
    private let recents = CPListTemplate(title: "Recents", sections: [])
    private let playlists = CPListTemplate(title: "Playlists", sections: [])
    private let browse = CPListTemplate(title: "Library", sections: [])
    private var refreshTask: Task<Void, Never>?

    private var services: AppServices { .shared }
    private var library: LibraryStore { services.library }
    private var player: PlayerEngine { services.player }

    // MARK: Lifecycle

    func connect(_ ic: CPInterfaceController) {
        interface = ic
        recents.tabTitle = "Recents"; recents.tabImage = UIImage(systemName: "clock.fill")
        playlists.tabTitle = "Playlists"; playlists.tabImage = UIImage(systemName: "music.note.list")
        browse.tabTitle = "Library"; browse.tabImage = UIImage(systemName: "square.stack.fill")
        recents.emptyViewTitleVariants = ["Nothing played yet"]
        recents.emptyViewSubtitleVariants = ["Songs you play show up here."]
        playlists.emptyViewTitleVariants = ["No playlists yet"]
        playlists.emptyViewSubtitleVariants = ["Create playlists on your iPhone."]

        let tabs = CPTabBarTemplate(templates: [recents, playlists, browse])
        ic.setRootTemplate(tabs, animated: false, completion: nil)
        configureNowPlaying()
        Task {
            await services.start()   // CarPlay can launch Pulse before the phone UI ever opens
            rebuildAll()
            if player.currentSongID != nil { showNowPlaying(animated: false) }
        }
    }

    func disconnect() {
        interface = nil
        CPNowPlayingTemplate.shared.remove(self)
    }

    func libraryChanged() { scheduleRefresh() }

    func playerChanged(_ change: PlayerEngine.StateChange) {
        guard interface != nil else { return }
        if change == .track || change == .playState {
            updateNowPlayingButtons()
            scheduleRefresh()  // move the "now playing" indicator in lists
        }
    }

    private func scheduleRefresh() {
        guard interface != nil else { return }
        refreshTask?.cancel()
        refreshTask = Task {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            rebuildAll()
        }
    }

    private func rebuildAll() {
        recents.updateSections(recentsSections())
        playlists.updateSections([CPListSection(items: folderItems(in: nil))])
        browse.updateSections(browseSections())
    }

    // MARK: Tabs

    private func recentsSections() -> [CPListSection] {
        var sections: [CPListSection] = []
        let recentItems = library.db.recentItems.prefix(6).compactMap(libraryItemRow)
        if !recentItems.isEmpty { sections.append(CPListSection(items: Array(recentItems), header: "Playlists", sectionIndexTitle: nil)) }
        let ids = library.recentlyPlayedIDs
        let songs = capped(ids).enumerated().compactMap { i, id in
            library.song(id).map { songRow($0, list: ids, index: i, source: PlaybackSource(kind: .recent, label: "Recently played")) }
        }
        if !songs.isEmpty { sections.append(CPListSection(items: songs, header: "Recently Played", sectionIndexTitle: nil)) }
        return sections
    }

    private func browseSections() -> [CPListSection] {
        let liked = library.likedSongIDs
        let all = Array(library.db.songs.keys)
        let rows: [CPListItem] = [
            navRow("Liked Songs", "\(liked.count) songs", symbol: "heart.fill") { [weak self] in
                self?.trackList(title: "Liked Songs", ids: liked, source: PlaybackSource(kind: .liked, label: "Liked Songs"))
            },
            navRow("On Repeat", "Your most played", symbol: "repeat") { [weak self] in
                guard let self else { return nil }
                return self.trackList(title: "On Repeat", ids: self.library.mostPlayedIDs, source: PlaybackSource(kind: .mostPlayed, label: "On repeat"))
            },
            navRow("Albums", "\(library.index.albums.count)", symbol: "square.stack") { [weak self] in self?.albumsList() },
            navRow("Artists", "\(library.index.artists.count)", symbol: "music.mic") { [weak self] in self?.artistsList() },
            actionRow("Shuffle All Songs", "\(all.count) songs", symbol: "shuffle") { [weak self] in
                self?.player.play(all, from: .allSongs, shuffle: true)
            }
        ]
        return [CPListSection(items: rows)]
    }

    // MARK: Library tree (folders nest to any depth)

    private func folderItems(in folderID: String?) -> [CPListItem] {
        capped(library.db.children(of: folderID)).compactMap(libraryItemRow)
    }

    private func libraryItemRow(_ item: LibraryItemID) -> CPListItem? {
        let name = library.db.name(of: item)
        guard !name.isEmpty else { return nil }
        let count = library.db.songIDs(in: item).count
        let row = CPListItem(text: name, detailText: item.isFolder ? "Folder" : "\(count) songs",
                             image: artwork(library.artworkKey(for: item)) ?? UIImage(systemName: item.isFolder ? "folder.fill" : "music.note.list"))
        row.accessoryType = .disclosureIndicator
        row.handler = { [weak self] _, done in
            guard let self else { done(); return }
            let ids = self.library.db.songIDs(in: item)
            let source = PlaybackSource(kind: item.isFolder ? .folder : .playlist, label: name, reference: item.rawID)
            let t: CPListTemplate
            if item.isFolder {
                var sections = [CPListSection(items: [self.actionRow("Shuffle All", "\(ids.count) songs", symbol: "shuffle") { [weak self] in
                    self?.player.play(ids, from: source, shuffle: true)
                }])]
                sections.append(CPListSection(items: self.folderItems(in: item.rawID)))
                t = CPListTemplate(title: name, sections: sections)
            } else {
                t = self.trackList(title: name, ids: ids, source: source)
            }
            self.library.noteOpened(item)
            self.interface?.pushTemplate(t, animated: true, completion: nil)
            done()
        }
        return row
    }

    // MARK: Track lists

    private func trackList(title: String, ids: [SongID], source: PlaybackSource) -> CPListTemplate {
        let shuffle = actionRow("Shuffle", "\(ids.count) songs", symbol: "shuffle") { [weak self] in
            self?.player.play(ids, from: source, shuffle: true)
        }
        let rows = capped(ids, reserve: 1).enumerated().compactMap { i, id in
            library.song(id).map { songRow($0, list: ids, index: i, source: source) }
        }
        let t = CPListTemplate(title: title, sections: [CPListSection(items: [shuffle]), CPListSection(items: rows)])
        t.emptyViewTitleVariants = ["No songs"]
        return t
    }

    private func albumsList() -> CPListTemplate {
        let rows = capped(library.index.albums).map { a -> CPListItem in
            let r = CPListItem(text: a.name, detailText: a.artist, image: artwork(a.artworkKey))
            r.accessoryType = .disclosureIndicator
            r.handler = { [weak self] _, done in
                guard let self else { done(); return }
                self.interface?.pushTemplate(self.trackList(title: a.name, ids: a.songIDs, source: PlaybackSource(kind: .album, label: a.name, reference: a.id)),
                                             animated: true, completion: nil)
                done()
            }
            return r
        }
        return CPListTemplate(title: "Albums", sections: [CPListSection(items: rows)])
    }

    private func artistsList() -> CPListTemplate {
        let rows = capped(library.index.artists).map { a -> CPListItem in
            let r = CPListItem(text: a.name, detailText: "\(a.songIDs.count) songs", image: artwork(a.artworkKey))
            r.accessoryType = .disclosureIndicator
            r.handler = { [weak self] _, done in
                guard let self else { done(); return }
                let ids = a.songIDs.sorted { (self.library.db.playCounts[$0] ?? 0) > (self.library.db.playCounts[$1] ?? 0) }
                self.interface?.pushTemplate(self.trackList(title: a.name, ids: ids, source: PlaybackSource(kind: .artist, label: a.name, reference: a.id)),
                                             animated: true, completion: nil)
                done()
            }
            return r
        }
        return CPListTemplate(title: "Artists", sections: [CPListSection(items: rows)])
    }

    // MARK: Rows

    private func songRow(_ s: Song, list: [SongID], index: Int, source: PlaybackSource) -> CPListItem {
        let r = CPListItem(text: s.title, detailText: s.displayArtist, image: artwork(s.artworkKey))
        r.isPlaying = player.currentSongID == s.id
        r.playingIndicatorLocation = .trailing
        r.handler = { [weak self] _, done in
            self?.player.play(list, startingAt: index, from: source)
            self?.showNowPlaying(animated: true)
            done()
        }
        return r
    }

    private func navRow(_ title: String, _ detail: String, symbol: String, make: @escaping () -> CPListTemplate?) -> CPListItem {
        let r = CPListItem(text: title, detailText: detail, image: UIImage(systemName: symbol))
        r.accessoryType = .disclosureIndicator
        r.handler = { [weak self] _, done in
            if let t = make() { self?.interface?.pushTemplate(t, animated: true, completion: nil) }
            done()
        }
        return r
    }

    private func actionRow(_ title: String, _ detail: String, symbol: String, run: @escaping () -> Void) -> CPListItem {
        let r = CPListItem(text: title, detailText: detail, image: UIImage(systemName: symbol))
        r.handler = { [weak self] _, done in
            run()
            self?.showNowPlaying(animated: true)
            done()
        }
        return r
    }

    private func artwork(_ key: String?) -> UIImage? { library.artwork.image(for: key, size: .small) }

    private func capped<T>(_ list: [T], reserve: Int = 0) -> [T] {
        Array(list.prefix(max(1, Int(CPListTemplate.maximumItemCount) - reserve)))
    }

    // MARK: Now Playing

    private func configureNowPlaying() {
        let np = CPNowPlayingTemplate.shared
        np.isUpNextButtonEnabled = true
        np.upNextTitle = "Up Next"
        np.isAlbumArtistButtonEnabled = true
        np.add(self)
        updateNowPlayingButtons()
    }

    private func updateNowPlayingButtons() {
        let liked = library.isLiked(player.currentSongID)
        let shuffle = CPNowPlayingShuffleButton { [weak self] _ in self?.player.toggleShuffle() }
        let repeatButton = CPNowPlayingRepeatButton { [weak self] _ in self?.player.cycleRepeat() }
        let like = CPNowPlayingImageButton(image: UIImage(systemName: liked ? "heart.fill" : "heart")!) { [weak self] _ in
            _ = self?.player.toggleLikeCurrent()
            self?.updateNowPlayingButtons()
        }
        // Rate button cycles 1x -> 1.25x -> 1.5x -> 2x -> 0.75x -> 1x (pitch stays locked if enabled).
        let rate = CPNowPlayingPlaybackRateButton { [weak self] _ in
            guard let self else { return }
            let steps: [Float] = [1, 1.25, 1.5, 2, 0.75]
            let i = steps.firstIndex(of: self.player.settings.speed) ?? 0
            self.player.settings.speed = steps[(i + 1) % steps.count]
        }
        CPNowPlayingTemplate.shared.updateNowPlayingButtons([shuffle, repeatButton, like, rate])
    }

    private func showNowPlaying(animated: Bool) {
        guard let ic = interface, ic.topTemplate !== CPNowPlayingTemplate.shared else { return }
        ic.pushTemplate(CPNowPlayingTemplate.shared, animated: animated, completion: nil)
    }

    private func upNextTemplate() -> CPListTemplate {
        let q = player.queue
        let upNext = q.upNext.enumerated().compactMap { i, id -> CPListItem? in
            guard let s = library.song(id) else { return nil }
            let r = CPListItem(text: s.title, detailText: s.displayArtist, image: artwork(s.artworkKey))
            r.handler = { [weak self] _, done in self?.player.jumpToUpNext(i); self?.interface?.popTemplate(animated: true, completion: nil); done() }
            return r
        }
        let rest = q.upcoming(max: 60).compactMap { e -> CPListItem? in
            guard let s = library.song(e.id) else { return nil }
            let r = CPListItem(text: s.title, detailText: s.displayArtist, image: artwork(s.artworkKey))
            r.handler = { [weak self] _, done in self?.player.jumpToContext(orderPosition: e.orderPosition); self?.interface?.popTemplate(animated: true, completion: nil); done() }
            return r
        }
        var sections: [CPListSection] = []
        if !upNext.isEmpty { sections.append(CPListSection(items: upNext, header: "Up Next", sectionIndexTitle: nil)) }
        if !rest.isEmpty { sections.append(CPListSection(items: rest, header: "Next from \(q.source?.label ?? "Library")", sectionIndexTitle: nil)) }
        let t = CPListTemplate(title: "Up Next", sections: sections)
        t.emptyViewTitleVariants = ["Nothing queued"]
        return t
    }
}

extension CarPlayCoordinator: CPNowPlayingTemplateObserver {
    nonisolated func nowPlayingTemplateUpNextButtonTapped(_ nowPlayingTemplate: CPNowPlayingTemplate) {
        MainActor.assumeIsolated { interface?.pushTemplate(upNextTemplate(), animated: true, completion: nil) }
    }

    nonisolated func nowPlayingTemplateAlbumArtistButtonTapped(_ nowPlayingTemplate: CPNowPlayingTemplate) {
        MainActor.assumeIsolated {
            guard let s = player.currentSong, let album = library.index.album(library.index.albumID(for: s)) else { return }
            interface?.pushTemplate(trackList(title: album.name, ids: album.songIDs,
                                              source: PlaybackSource(kind: .album, label: album.name, reference: album.id)),
                                    animated: true, completion: nil)
        }
    }
}
