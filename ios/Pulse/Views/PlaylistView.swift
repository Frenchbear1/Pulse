import SwiftUI
import PhotosUI
import PulseKit

/// A playlist: hero (cover / mosaic, name, description, count, length), Play / Shuffle,
/// reorder by drag, swipe to remove, custom cover from Photos, rename, sync to watch.
struct PlaylistView: View {
    @Environment(LibraryStore.self) private var library
    @Environment(PlayerEngine.self) private var player
    @Environment(AppServices.self) private var services
    let playlistID: String
    @State private var coverItem: PhotosPickerItem?
    @State private var editingDetails = false

    var body: some View {
        if let p = library.db.playlists[playlistID] {
            let ids = library.db.songIDs(in: .playlist(playlistID))
            List {
                HeroHeader(kind: "Playlist", title: p.name, subtitle: stats(ids),
                           art: { LibraryItemArtwork(item: .playlist(playlistID), radius: 18) },
                           onPlay: { play(ids, at: 0, shuffle: false) },
                           onShuffle: { play(ids, at: 0, shuffle: true) })
                    .listRowBackground(Color.clear).listRowSeparator(.hidden)
                if !p.summary.isEmpty {
                    Text(p.summary).font(.subheadline).foregroundStyle(.secondary)
                        .listRowBackground(Color.clear).listRowSeparator(.hidden)
                }
                ForEach(Array(ids.enumerated()), id: \.offset) { i, id in
                    if let song = library.song(id) {
                        TrackRow(song: song, extraActions: [
                            .init(title: "Remove from Playlist", systemImage: "minus.circle", role: .destructive) {
                                library.mutate { $0.removeSongs(at: IndexSet(integer: i), fromPlaylist: playlistID) }
                            }
                        ])
                        .onTapGesture { play(ids, at: i, shuffle: nil) }
                        .listRowBackground(Color.clear)
                    }
                }
                .onMove { from, to in library.mutate { $0.moveSongs(from: from, to: to, inPlaylist: playlistID) } }
                .onDelete { offsets in library.mutate { $0.removeSongs(at: offsets, fromPlaylist: playlistID) } }
            }
            .listStyle(.plain)
            .overlay {
                if ids.isEmpty {
                    ContentUnavailableView("No songs yet", systemImage: "music.note.list",
                                           description: Text("Use “Add to Playlist…” on any song."))
                }
            }
            .navigationTitle(p.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        EditButton()
                        Button { editingDetails = true } label: { Label("Edit Details", systemImage: "pencil") }
                        PhotosPicker(selection: $coverItem, matching: .images) { Label("Choose Cover", systemImage: "photo") }
                        if p.artworkKey != nil {
                            Button { library.setCover(nil, for: .playlist(playlistID)) } label: { Label("Use Auto Mosaic", systemImage: "square.grid.2x2") }
                        }
                        Button { services.watch.syncPlaylist(playlistID) } label: { Label("Sync to Apple Watch", systemImage: "applewatch") }
                        if !ids.isEmpty {
                            ShareLink(item: m3u(ids, name: p.name), preview: SharePreview("\(p.name).m3u")) { Label("Export M3U", systemImage: "square.and.arrow.up") }
                        }
                    } label: { Image(systemName: "ellipsis.circle") }
                }
            }
            .onChange(of: coverItem) { _, item in
                guard let item else { return }
                Task {
                    if let data = try? await item.loadTransferable(type: Data.self) { library.setCover(data, for: .playlist(playlistID)) }
                    coverItem = nil
                }
            }
            .sheet(isPresented: $editingDetails) { PlaylistDetailsSheet(playlist: p) }
            .onAppear { library.noteOpened(.playlist(playlistID)) }
        } else {
            ContentUnavailableView("Playlist not found", systemImage: "music.note.list")
        }
    }

    private func play(_ ids: [SongID], at i: Int, shuffle: Bool?) {
        let name = library.db.playlists[playlistID]?.name ?? "Playlist"
        player.play(ids, startingAt: i, from: PlaybackSource(kind: .playlist, label: name, reference: playlistID), shuffle: shuffle)
    }

    private func stats(_ ids: [SongID]) -> String {
        let total = ids.compactMap { library.song($0)?.duration }.reduce(0, +)
        let mins = Int(total / 60)
        let length = mins >= 60 ? "\(mins / 60) hr \(mins % 60) min" : "\(mins) min"
        return "\(ids.count) song\(ids.count == 1 ? "" : "s") · \(length)"
    }

    /// Plain-text M3U with relative paths (web exportM3U()).
    private func m3u(_ ids: [SongID], name: String) -> String {
        var s = "#EXTM3U\n"
        for id in ids {
            guard let t = library.song(id) else { continue }
            s += "#EXTINF:\(Int(t.duration)),\(t.displayArtist) - \(t.title)\n\(t.relativePath)\n"
        }
        return s
    }
}

struct PlaylistDetailsSheet: View {
    @Environment(LibraryStore.self) private var library
    @Environment(\.dismiss) private var dismiss
    let playlist: Playlist
    @State private var name = ""
    @State private var summary = ""

    var body: some View {
        NavigationStack {
            Form {
                TextField("Name", text: $name)
                TextField("Description", text: $summary, axis: .vertical).lineLimit(3...6)
            }
            .navigationTitle("Edit Details")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        library.mutate { db in
                            db.rename(.playlist(playlist.id), to: name)
                            db.playlists[playlist.id]?.summary = summary
                        }
                        dismiss()
                    }
                }
            }
            .onAppear { name = playlist.name; summary = playlist.summary }
        }
        .presentationDetents([.medium])
    }
}

/// Add songs to a playlist (or a new one), showing the folder tree with indentation.
struct AddToPlaylistSheet: View {
    @Environment(LibraryStore.self) private var library
    @Environment(UIState.self) private var ui
    @Environment(\.dismiss) private var dismiss
    let songIDs: [SongID]

    var body: some View {
        NavigationStack {
            List {
                Button {
                    library.mutate { _ = $0.createPlaylist(named: "New playlist", songIDs: songIDs) }
                    ui.toast = "Added to New playlist"
                    dismiss()
                } label: { Label("New Playlist", systemImage: "plus") }
                ForEach(library.db.flattenedPlaylists(), id: \.playlist.id) { entry in
                    Button {
                        var added = 0
                        library.mutate { added = $0.addSongs(songIDs, toPlaylist: entry.playlist.id) }
                        ui.toast = added > 0 ? "Added to \(entry.playlist.name)" : "Already in \(entry.playlist.name)"
                        dismiss()
                    } label: {
                        HStack {
                            LibraryItemArtwork(item: .playlist(entry.playlist.id), radius: 6).frame(width: 36, height: 36)
                            Text(entry.playlist.name)
                        }
                        .padding(.leading, CGFloat(entry.depth) * 14)
                    }
                    .foregroundStyle(.primary)
                }
            }
            .navigationTitle("Add to Playlist")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }
}
