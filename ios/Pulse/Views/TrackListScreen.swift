import SwiftUI
import PulseKit

/// Generic song list with a hero header and sort (albums, genres, Liked, Recently Played, ...).
struct TrackListScreen: View {
    @Environment(LibraryStore.self) private var library
    @Environment(PlayerEngine.self) private var player
    @Environment(AppServices.self) private var services
    let title: String
    let kind: String
    let subtitle: String
    let ids: [SongID]
    let source: PlaybackSource
    var artworkKey: String?
    var symbol: String?
    var numbered = false
    var sortable = true
    var showHero = true
    @State private var filter = ""

    var body: some View {
        @Bindable var services = services
        let list = displayed
        List {
            if showHero {
                HeroHeader(kind: kind, title: title, subtitle: subtitle.isEmpty ? "\(ids.count) songs" : subtitle,
                           art: { heroArt }, onPlay: { player.play(list, from: source, shuffle: false) },
                           onShuffle: { player.play(list, from: source, shuffle: true) })
                    .listRowBackground(Color.clear).listRowSeparator(.hidden)
            }
            ForEach(Array(list.enumerated()), id: \.element) { i, id in
                if let song = library.song(id) {
                    TrackRow(song: song, showArt: !numbered, trackNumber: numbered ? song.trackNumber : nil)
                        .onTapGesture { player.play(list, startingAt: i, from: source) }
                        .listRowBackground(Color.clear)
                }
            }
        }
        .listStyle(.plain)
        .searchable(text: $filter, placement: .navigationBarDrawer(displayMode: .automatic), prompt: "Filter")
        .overlay { if ids.isEmpty { ContentUnavailableView("Nothing here yet", systemImage: symbol ?? "music.note") } }
        .navigationTitle(showHero ? "" : title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if sortable {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Picker("Sort by", selection: $services.appearance.songSort) {
                            ForEach(SongSort.allCases) { Text($0.label).tag($0) }
                        }
                        Toggle("Ascending", isOn: $services.appearance.songSortAscending)
                    } label: { Image(systemName: "arrow.up.arrow.down") }
                }
            }
        }
    }

    @ViewBuilder private var heroArt: some View {
        if let artworkKey {
            ArtworkView(key: artworkKey, size: .large, radius: 18)
        } else {
            RoundedRectangle(cornerRadius: 18, style: .continuous).fill(services.theme.gradient)
                .overlay(Image(systemName: symbol ?? "music.note").font(.system(size: 64, weight: .semibold)).foregroundStyle(.white))
        }
    }

    private var displayed: [SongID] {
        var out = sortable ? services.appearance.songSort.sorted(ids, in: library.db, ascending: services.appearance.songSortAscending) : ids
        if !filter.isEmpty {
            let toks = TextNormalizer.norm(filter).split(separator: " ").map(String.init)
            out = out.filter { id in
                guard let s = library.song(id) else { return false }
                let hay = TextNormalizer.norm("\(s.title) \(s.artist) \(s.album)")
                return toks.allSatisfy(hay.contains)
            }
        }
        return out
    }
}

struct ArtistView: View {
    @Environment(LibraryStore.self) private var library
    @Environment(PlayerEngine.self) private var player
    let artist: LibraryIndex.Artist

    var body: some View {
        let source = PlaybackSource(kind: .artist, label: artist.name, reference: artist.id)
        let top = artist.songIDs.sorted { (library.db.playCounts[$0] ?? 0) > (library.db.playCounts[$1] ?? 0) }
        List {
            HeroHeader(kind: "Artist", title: artist.name, subtitle: "\(artist.songIDs.count) songs · \(artist.albumIDs.count) albums",
                       art: { ArtworkView(key: artist.artworkKey, size: .large, radius: 110, placeholderSymbol: "music.mic") },
                       onPlay: { player.play(top, from: source, shuffle: false) },
                       onShuffle: { player.play(top, from: source, shuffle: true) })
                .listRowBackground(Color.clear).listRowSeparator(.hidden)
            Section("Top songs") {
                ForEach(Array(top.prefix(10).enumerated()), id: \.element) { i, id in
                    if let s = library.song(id) {
                        TrackRow(song: s).onTapGesture { player.play(top, startingAt: i, from: source) }.listRowBackground(Color.clear)
                    }
                }
            }
            Section("Albums") {
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(spacing: 14) {
                        ForEach(artist.albumIDs.compactMap { library.index.album($0) }) { a in
                            NavigationLink(value: Route.album(a.id)) {
                                Card(title: a.name, subtitle: a.year > 0 ? String(a.year) : "Album") { ArtworkView(key: a.artworkKey, radius: 14) }
                            }.buttonStyle(.plain)
                        }
                    }
                }
                .listRowBackground(Color.clear)
            }
        }
        .listStyle(.plain)
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct AlbumsGrid: View {
    @Environment(LibraryStore.self) private var library
    var body: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 14)], spacing: 18) {
                ForEach(library.index.albums) { a in
                    NavigationLink(value: Route.album(a.id)) {
                        Card(title: a.name, subtitle: a.artist, width: 160) { ArtworkView(key: a.artworkKey, radius: 14) }
                    }.buttonStyle(.plain)
                }
            }
            .padding()
        }
        .navigationTitle("Albums")
    }
}

struct ArtistsList: View {
    @Environment(LibraryStore.self) private var library
    var body: some View {
        List(library.index.artists) { a in
            NavigationLink(value: Route.artist(a.id)) {
                HStack(spacing: 12) {
                    ArtworkView(key: a.artworkKey, radius: 24, placeholderSymbol: "music.mic").frame(width: 48, height: 48)
                    VStack(alignment: .leading) {
                        Text(a.name).lineLimit(1)
                        Text("\(a.songIDs.count) songs").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            .listRowBackground(Color.clear)
        }
        .listStyle(.plain)
        .navigationTitle("Artists")
    }
}

struct GenresList: View {
    @Environment(LibraryStore.self) private var library
    var body: some View {
        List(library.index.genres) { g in
            NavigationLink(value: Route.genre(g.id)) {
                LabeledContent(g.name, value: "\(g.songIDs.count)")
            }
            .listRowBackground(Color.clear)
        }
        .listStyle(.plain)
        .navigationTitle("Genres")
    }
}

/// On-disk folder tree (web "Folders" view): sub-folders first, then songs; can be turned into
/// a tiered set of playlists (web mirrorFolder()).
struct DiskFolderView: View {
    @Environment(LibraryStore.self) private var library
    @Environment(PlayerEngine.self) private var player
    @Environment(UIState.self) private var ui
    let path: String

    var body: some View {
        if let node = library.index.diskFolder(path) {
            let source = PlaybackSource(kind: .diskFolder, label: node.name, reference: path)
            List {
                if !node.children.isEmpty {
                    Section {
                        ForEach(node.children) { c in
                            NavigationLink(value: Route.diskFolder(c.id)) {
                                HStack(spacing: 12) {
                                    ArtworkView(key: c.artworkKey, radius: 8, placeholderSymbol: "folder").frame(width: 44, height: 44)
                                    VStack(alignment: .leading) {
                                        Text(c.name).lineLimit(1)
                                        Text("\(c.allSongIDs.count) songs").font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                            }
                            .listRowBackground(Color.clear)
                        }
                    }
                }
                ForEach(Array(node.songIDs.enumerated()), id: \.element) { i, id in
                    if let s = library.song(id) {
                        TrackRow(song: s).onTapGesture { player.play(node.songIDs, startingAt: i, from: source) }.listRowBackground(Color.clear)
                    }
                }
            }
            .listStyle(.plain)
            .navigationTitle(path.isEmpty ? "Folders" : node.name)
            .toolbar {
                if !path.isEmpty {
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            Button { player.play(node.allSongIDs, from: source, shuffle: false) } label: { Label("Play All", systemImage: "play") }
                            Button { player.play(node.allSongIDs, from: source, shuffle: true) } label: { Label("Shuffle All", systemImage: "shuffle") }
                            Button { mirror(node) } label: { Label("Make Playlists from Folder", systemImage: "folder.badge.gearshape") }
                        } label: { Image(systemName: "ellipsis.circle") }
                    }
                }
            }
        } else {
            ContentUnavailableView("Folder not found", systemImage: "folder")
        }
    }

    /// Recreate the folder structure as library folders + playlists.
    private func mirror(_ node: LibraryIndex.DiskFolder) {
        library.mutate { db in
            func make(_ n: LibraryIndex.DiskFolder, in parent: String?) {
                if n.children.isEmpty {
                    db.createPlaylist(named: n.name, in: parent, songIDs: n.songIDs)
                } else {
                    let f = db.createFolder(named: n.name, in: parent)
                    if !n.songIDs.isEmpty { db.createPlaylist(named: n.name + " (loose)", in: f.id, songIDs: n.songIDs) }
                    n.children.forEach { make($0, in: f.id) }
                }
            }
            make(node, in: nil)
        }
        ui.toast = "Playlists created from “\(node.name)”"
    }
}

/// Search across songs, albums, artists and playlists.
struct SearchView: View {
    @Environment(LibraryStore.self) private var library
    @Environment(PlayerEngine.self) private var player
    @State private var query = ""

    var body: some View {
        let ids = query.isEmpty ? [] : library.index.search(query, in: library.db)
        let q = TextNormalizer.norm(query)
        List {
            if query.isEmpty {
                Section("Browse") {
                    ForEach(library.index.genres.prefix(24)) { g in
                        NavigationLink(g.name, value: Route.genre(g.id)).listRowBackground(Color.clear)
                    }
                }
            } else {
                let albums = library.index.albums.filter { TextNormalizer.norm($0.name).contains(q) }.prefix(8)
                let artists = library.index.artists.filter { TextNormalizer.norm($0.name).contains(q) }.prefix(8)
                let playlists = library.db.flattenedPlaylists().filter { TextNormalizer.norm($0.playlist.name).contains(q) }.prefix(8)
                if !artists.isEmpty {
                    Section("Artists") {
                        ForEach(Array(artists)) { a in NavigationLink(a.name, value: Route.artist(a.id)).listRowBackground(Color.clear) }
                    }
                }
                if !albums.isEmpty {
                    Section("Albums") {
                        ForEach(Array(albums)) { a in
                            NavigationLink(value: Route.album(a.id)) {
                                HStack { ArtworkView(key: a.artworkKey, radius: 6).frame(width: 40, height: 40); Text(a.name) }
                            }.listRowBackground(Color.clear)
                        }
                    }
                }
                if !playlists.isEmpty {
                    Section("Playlists") {
                        ForEach(Array(playlists), id: \.playlist.id) { e in
                            NavigationLink(e.playlist.name, value: Route.playlist(e.playlist.id)).listRowBackground(Color.clear)
                        }
                    }
                }
                Section("Songs") {
                    ForEach(Array(ids.prefix(100).enumerated()), id: \.element) { i, id in
                        if let s = library.song(id) {
                            TrackRow(song: s)
                                .onTapGesture { player.play(ids, startingAt: i, from: PlaybackSource(kind: .search, label: "Search: \(query)")) }
                                .listRowBackground(Color.clear)
                        }
                    }
                }
            }
        }
        .listStyle(.plain)
        .searchable(text: $query, prompt: "Songs, artists, albums")
        .navigationTitle("Search")
    }
}
