import SwiftUI
import PulseKit

/// Tabs (Home, Library, Search, Settings) over the ambient background, with the mini player
/// floating above the tab bar and Now Playing as a full-screen cover.
struct RootView: View {
    @Environment(AppServices.self) private var services
    @Environment(UIState.self) private var ui
    @Environment(LibraryStore.self) private var library

    var body: some View {
        @Bindable var ui = ui
        ZStack(alignment: .bottom) {
            AmbientBackground()
            TabView(selection: $ui.selectedTab) {
                tab(.home) { HomeView() }
                    .tabItem { Label("Home", systemImage: "house.fill") }
                tab(.library) { LibraryView() }
                    .tabItem { Label("Library", systemImage: "square.stack.fill") }
                tab(.search) { SearchView() }
                    .tabItem { Label("Search", systemImage: "magnifyingglass") }
                tab(.settings) { SettingsView() }
                    .tabItem { Label("Settings", systemImage: "gearshape.fill") }
            }
            if let t = ui.toast {
                ToastView(text: t).padding(.bottom, 140).zIndex(2)
            }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: ui.toast)
        .fullScreenCover(isPresented: $ui.showNowPlaying) { NowPlayingView() }
        .sheet(item: Binding(get: { ui.addToPlaylist.map(SongIDList.init) }, set: { ui.addToPlaylist = $0?.ids })) { list in
            AddToPlaylistSheet(songIDs: list.ids)
        }
        .overlay {
            if !library.isLoaded { ProgressView().controlSize(.large) }
        }
    }

    /// Each tab gets its own NavigationStack bound to UIState.paths, the route table, and the
    /// mini player pinned above the tab bar.
    private func tab<Content: View>(_ which: AppTab, @ViewBuilder _ content: () -> Content) -> some View {
        NavigationStack(path: Binding(get: { ui.paths[which] ?? [] }, set: { ui.paths[which] = $0 })) {
            content()
                .navigationDestination(for: Route.self) { RouteView(route: $0) }
                .scrollContentBackground(.hidden)
                .background(Color.clear)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { MiniPlayerBar().padding(.horizontal, 10).padding(.bottom, 6) }
        .toolbarBackground(.ultraThinMaterial, for: .tabBar)
        .tag(which)
    }
}

private struct SongIDList: Identifiable {
    let ids: [SongID]
    var id: String { ids.joined(separator: ",") }
}

/// Resolves a Route to its screen.
struct RouteView: View {
    @Environment(LibraryStore.self) private var library
    let route: Route

    var body: some View {
        switch route {
        case .playlist(let id): PlaylistView(playlistID: id)
        case .folder(let id): LibraryFolderView(folderID: id)
        case .album(let id):
            if let a = library.index.album(id) {
                TrackListScreen(title: a.name, kind: "Album", subtitle: [a.artist, a.year > 0 ? String(a.year) : nil].compactMap { $0 }.joined(separator: " · "),
                                ids: a.songIDs, source: PlaybackSource(kind: .album, label: a.name, reference: id),
                                artworkKey: a.artworkKey, numbered: true, sortable: false)
            } else { ContentUnavailableView("Album not found", systemImage: "square.stack") }
        case .artist(let id):
            if let a = library.index.artist(id) {
                ArtistView(artist: a)
            } else { ContentUnavailableView("Artist not found", systemImage: "music.mic") }
        case .genre(let id):
            let g = library.index.genres.first { $0.id == id }
            TrackListScreen(title: g?.name ?? "Genre", kind: "Genre", subtitle: "", ids: g?.songIDs ?? [],
                            source: PlaybackSource(kind: .genre, label: g?.name ?? "Genre", reference: id))
        case .diskFolder(let path): DiskFolderView(path: path)
        case .songs:
            TrackListScreen(title: "Songs", kind: "Library", subtitle: "", ids: Array(library.db.songs.keys), source: .allSongs, showHero: false)
        case .albums: AlbumsGrid()
        case .artists: ArtistsList()
        case .genres: GenresList()
        case .diskFolders: DiskFolderView(path: "")
        case .liked:
            TrackListScreen(title: "Liked Songs", kind: "Playlist", subtitle: "", ids: library.likedSongIDs,
                            source: PlaybackSource(kind: .liked, label: "Liked Songs"), symbol: "heart.fill", sortable: false)
        case .recent:
            TrackListScreen(title: "Recently Played", kind: "History", subtitle: "", ids: library.recentlyPlayedIDs,
                            source: PlaybackSource(kind: .recent, label: "Recently played"), symbol: "clock.fill", sortable: false)
        case .mostPlayed:
            TrackListScreen(title: "On Repeat", kind: "Your top songs", subtitle: "", ids: library.mostPlayedIDs,
                            source: PlaybackSource(kind: .mostPlayed, label: "On repeat"), symbol: "repeat", sortable: false)
        }
    }
}
