import SwiftUI
import PulseKit

/// Queue: now playing, Up Next (drag to reorder, swipe to remove, clear), then the rest of the
/// context ("Next from <playlist>") - same split as the web side panel.
struct QueueView: View {
    @Environment(PlayerEngine.self) private var player
    @Environment(LibraryStore.self) private var library

    var body: some View {
        NavigationStack {
            List {
                if let s = player.currentSong {
                    Section("Now Playing") { TrackRow(song: s).listRowBackground(Color.clear) }
                }
                if !player.queue.upNext.isEmpty {
                    Section {
                        ForEach(Array(player.queue.upNext.enumerated()), id: \.offset) { i, id in
                            if let s = library.song(id) {
                                TrackRow(song: s).onTapGesture { player.jumpToUpNext(i) }.listRowBackground(Color.clear)
                            }
                        }
                        .onMove { player.moveUpNext(from: $0, to: $1) }
                        .onDelete { player.removeFromUpNext(at: $0) }
                    } header: {
                        HStack {
                            Text("Up Next")
                            Spacer()
                            Button("Clear") { player.clearUpNext() }.font(.caption.weight(.semibold))
                        }
                    }
                }
                let upcoming = player.queue.upcoming(max: 200)
                if !upcoming.isEmpty {
                    Section("Next from \(player.queue.source?.label ?? "Library")") {
                        ForEach(upcoming, id: \.orderPosition) { entry in
                            if let s = library.song(entry.id) {
                                TrackRow(song: s).onTapGesture { player.jumpToContext(orderPosition: entry.orderPosition) }
                                    .listRowBackground(Color.clear)
                            }
                        }
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .navigationTitle("Queue")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    HStack {
                        Button { player.toggleShuffle() } label: { Image(systemName: "shuffle").foregroundStyle(player.settings.shuffle ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary)) }
                        Button { player.cycleRepeat() } label: {
                            Image(systemName: player.settings.repeatMode == .one ? "repeat.1" : "repeat")
                                .foregroundStyle(player.settings.repeatMode == .off ? AnyShapeStyle(.secondary) : AnyShapeStyle(.tint))
                        }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) { EditButton() }
            }
        }
    }
}

/// Synced lyrics that follow the song (tap a line to jump there), or plain lyrics.
struct LyricsView: View {
    @Environment(PlayerEngine.self) private var player
    @Environment(LibraryStore.self) private var library
    let song: Song
    @State private var lyrics: Lyrics?
    @State private var loaded = false

    var body: some View {
        Group {
            if let synced = lyrics?.synced {
                ScrollViewReader { proxy in
                    ScrollView(showsIndicators: false) {
                        let active = lyrics?.activeLineIndex(at: player.currentTime)
                        VStack(alignment: .leading, spacing: 18) {
                            ForEach(synced) { line in
                                Text(line.text.isEmpty ? "♪" : line.text)
                                    .font(.title2.bold())
                                    .opacity(line.id == active ? 1 : (active.map { line.id < $0 } ?? false) ? 0.35 : 0.55)
                                    .scaleEffect(line.id == active ? 1.02 : 1, anchor: .leading)
                                    .animation(.easeOut(duration: 0.25), value: active)
                                    .id(line.id)
                                    .onTapGesture { player.seek(to: line.time + 0.01); if !player.isPlaying { player.play() } }
                            }
                            Text(lyrics?.sourceDescription ?? "").font(.caption).opacity(0.5).padding(.top, 20)
                        }
                        .padding(.vertical, 120)
                        .onChange(of: active) { _, a in
                            guard let a else { return }
                            withAnimation(.easeInOut(duration: 0.45)) { proxy.scrollTo(a, anchor: UnitPoint(x: 0, y: 0.38)) }
                        }
                    }
                }
            } else if let plain = lyrics?.plain, !plain.isEmpty {
                ScrollView { Text(plain).font(.title3.weight(.semibold)).frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 40) }
            } else if loaded {
                ContentUnavailableView("No lyrics", systemImage: "quote.bubble",
                                       description: Text("Put a .lrc file with the same name next to the song for synced lyrics."))
            } else {
                ProgressView()
            }
        }
        .task(id: song.id) {
            loaded = false
            lyrics = await library.lyrics(for: song)
            loaded = true
        }
    }
}
