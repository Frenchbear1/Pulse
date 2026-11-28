import SwiftUI
import PulseKit

/// Home: same shelves as the web app (views.js home()): Jump back in, Your library,
/// Recently added, Your top artists, plus quick tiles for Liked / Recently Played / On Repeat.
struct HomeView: View {
    @Environment(LibraryStore.self) private var library
    @Environment(PlayerEngine.self) private var player
    @Environment(UIState.self) private var ui
    @State private var showImporter = false

    var body: some View {
        ScrollView {
            if library.isLoaded && library.db.songs.isEmpty {
                EmptyLibraryView(showImporter: $showImporter).padding(.top, 60)
            } else {
                VStack(alignment: .leading, spacing: 26) {
                    quickTiles
                    if !jumpBackIn.isEmpty {
                        Shelf(title: "Jump back in") {
                            ForEach(jumpBackIn) { album in
                                NavigationLink(value: Route.album(album.id)) {
                                    Card(title: album.name, subtitle: album.artist) { ArtworkView(key: album.artworkKey, radius: 14) }
                                }.buttonStyle(.plain)
                            }
                        }
                    }
                    if !library.db.rootItems.isEmpty {
                        Shelf(title: "Your library", seeAll: nil) {
                            ForEach(recentItems, id: \.self) { item in
                                NavigationLink(value: item.isFolder ? Route.folder(item.rawID) : Route.playlist(item.rawID)) {
                                    Card(title: library.db.name(of: item), subtitle: item.isFolder ? "Folder" : "\(library.db.songIDs(in: item).count) songs") {
                                        LibraryItemArtwork(item: item, radius: 14)
                                    }
                                }.buttonStyle(.plain)
                            }
                        }
                    }
                    Shelf(title: "Recently added", seeAll: .albums) {
                        ForEach(library.recentlyAddedAlbums) { album in
                            NavigationLink(value: Route.album(album.id)) {
                                Card(title: album.name, subtitle: album.artist) { ArtworkView(key: album.artworkKey, radius: 14) }
                            }.buttonStyle(.plain)
                        }
                    }
                    if !topArtists.isEmpty {
                        Shelf(title: "Your top artists", seeAll: .artists) {
                            ForEach(topArtists) { artist in
                                NavigationLink(value: Route.artist(artist.id)) {
                                    Card(title: artist.name, subtitle: "Artist", width: 130, circle: true) {
                                        ArtworkView(key: artist.artworkKey, radius: 65, placeholderSymbol: "music.mic")
                                    }
                                }.buttonStyle(.plain)
                            }
                        }
                    }
                }
                .padding(.vertical)
            }
        }
        .navigationTitle(greeting)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { player.play(Array(library.db.songs.keys), from: .allSongs, shuffle: true) } label: {
                    Image(systemName: "shuffle")
                }
                .accessibilityLabel("Shuffle all songs")
                .disabled(library.db.songs.isEmpty)
            }
        }
        .fileImporter(isPresented: $showImporter, allowedContentTypes: [.folder], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result { Task { for u in urls { await library.addFolder(u) } } }
        }
    }

    private var quickTiles: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
            tile("Liked Songs", "heart.fill", .liked, count: library.likedSongIDs.count)
            tile("Recently Played", "clock.fill", .recent, count: library.recentlyPlayedIDs.count)
            tile("On Repeat", "repeat", .mostPlayed, count: nil)
            tile("All Songs", "music.note", .songs, count: library.db.songs.count)
        }
        .padding(.horizontal)
    }

    private func tile(_ title: String, _ symbol: String, _ route: Route, count: Int?) -> some View {
        NavigationLink(value: route) {
            HStack(spacing: 10) {
                Image(systemName: symbol).font(.headline).foregroundStyle(.tint).frame(width: 36, height: 36)
                    .background(.tint.opacity(0.15), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                VStack(alignment: .leading, spacing: 0) {
                    Text(title).font(.subheadline.weight(.semibold)).lineLimit(1)
                    if let count { Text("\(count)").font(.caption).foregroundStyle(.secondary) }
                }
                Spacer(minLength: 0)
            }
            .padding(8).glass(radius: 14)
        }
        .buttonStyle(.plain)
    }

    /// Albums of recently played songs, most recent first.
    private var jumpBackIn: [LibraryIndex.Album] {
        var seen = Set<String>(), out: [LibraryIndex.Album] = []
        for id in library.recentlyPlayedIDs {
            guard let s = library.song(id) else { continue }
            let aid = library.index.albumID(for: s)
            if seen.insert(aid).inserted, let a = library.index.album(aid) { out.append(a) }
            if out.count == 14 { break }
        }
        return out
    }

    private var recentItems: [LibraryItemID] {
        let recent = library.db.recentItems
        let rest = library.db.flattenedPlaylists().map { LibraryItemID.playlist($0.playlist.id) }.filter { !recent.contains($0) }
        return Array((recent + rest).prefix(14))
    }

    private var topArtists: [LibraryIndex.Artist] {
        var counts: [String: Int] = [:]
        for (id, n) in library.db.playCounts {
            guard let s = library.song(id) else { continue }
            counts[TextNormalizer.norm(s.primaryArtist), default: 0] += n
        }
        return counts.sorted { $0.value > $1.value }.prefix(12).compactMap { library.index.artist($0.key) }
    }

    private var greeting: String {
        let h = Calendar.current.component(.hour, from: Date())
        return h < 5 ? "Late night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"
    }
}

/// First-run state: explain the two ways music gets into Pulse.
struct EmptyLibraryView: View {
    @Binding var showImporter: Bool
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "waveform").font(.system(size: 52, weight: .semibold)).foregroundStyle(.tint)
                .symbolEffect(.variableColor.iterative.reversing)
            Text("Your music, your files").font(.title2.bold())
            Text("Add a folder from the Files app (iCloud Drive, On My iPhone, a USB drive…), or drop songs into **On My iPhone › Pulse** in Files.")
                .multilineTextAlignment(.center).foregroundStyle(.secondary).padding(.horizontal, 30)
            Button { showImporter = true } label: { Label("Add a music folder", systemImage: "folder.badge.plus") }
                .buttonStyle(PillButtonStyle(prominent: true))
        }
        .frame(maxWidth: .infinity)
    }
}
