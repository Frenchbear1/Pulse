import SwiftUI
import WidgetKit
import AppIntents
import PulseKit

/// "Jump back in": recently opened playlists (falling back to all playlists), each with a play
/// button that starts it without opening the app. Tapping the tile itself opens the playlist.
struct PlaylistsEntry: TimelineEntry {
    var date: Date
    var items: [LibrarySnapshot.PlaylistSummary]
    var likedCount: Int
}

struct PlaylistsProvider: TimelineProvider {
    func placeholder(in context: Context) -> PlaylistsEntry {
        PlaylistsEntry(date: Date(), items: (1...6).map {
            .init(id: "p\($0)", name: ["Late Drive", "Focus", "Run Club", "Sunday", "Throwbacks", "New Finds"][$0 - 1],
                  folderPath: "", songCount: 20 + $0, accentHex: AccentPalette.defaultHex, artworkFile: nil, isFolder: false)
        }, likedCount: 128)
    }

    func getSnapshot(in context: Context, completion: @escaping (PlaylistsEntry) -> Void) {
        let entry = load()
        completion(entry.items.isEmpty && context.isPreview ? placeholder(in: context) : entry)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<PlaylistsEntry>) -> Void) {
        // The app reloads this kind whenever the library changes; nothing time-based to schedule.
        completion(Timeline(entries: [load()], policy: .never))
    }

    private func load() -> PlaylistsEntry {
        let snap = LibrarySnapshot.load()
        let recent = snap.recent.filter { !$0.isFolder }
        let rest = snap.playlists.filter { p in !p.isFolder && !recent.contains { $0.id == p.id } }
        return PlaylistsEntry(date: Date(), items: Array((recent + rest).prefix(8)), likedCount: snap.likedCount)
    }
}

struct PlaylistsWidget: Widget {
    let kind = "PulsePlaylists"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: PlaylistsProvider()) { entry in
            PlaylistsWidgetView(entry: entry)
                .containerBackground(for: .widget) { WidgetBackdrop(accentHex: entry.items.first?.accentHex) }
        }
        .configurationDisplayName("Jump Back In")
        .description("Your recent playlists, one tap to play.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

struct PlaylistsWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: PlaylistsEntry

    private var liked: LibrarySnapshot.PlaylistSummary {
        .init(id: LibrarySnapshot.likedSongsID, name: "Liked Songs", folderPath: "", songCount: entry.likedCount,
              accentHex: "#ff4d8d", artworkFile: nil, isFolder: false)
    }

    var body: some View {
        Group {
            if entry.items.isEmpty && entry.likedCount == 0 {
                VStack(spacing: 6) {
                    Image(systemName: "music.note.list").font(.title)
                    Text("Make a playlist in Pulse").font(.caption).multilineTextAlignment(.center)
                }
                .foregroundStyle(.white.opacity(0.75))
            } else {
                switch family {
                case .systemSmall: smallView
                case .systemLarge: listView(count: 6)
                default: gridView
                }
            }
        }
        .foregroundStyle(.white)
    }

    private var all: [LibrarySnapshot.PlaylistSummary] {
        (entry.likedCount > 0 ? [liked] : []) + entry.items
    }

    private var smallView: some View {
        let p = entry.items.first ?? liked
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                WidgetCover(fileName: p.artworkFile, accentHex: p.accentHex, cornerRadius: 12).frame(width: 64, height: 64)
                Spacer(minLength: 0)
                playButton(p, size: 32)
            }
            Spacer(minLength: 0)
            Text(p.name).font(.headline).lineLimit(2)
            Text("\(p.songCount) songs").font(.caption).foregroundStyle(.white.opacity(0.65))
        }
        .widgetURL(link(p))
    }

    private var gridView: some View {
        let items = Array(all.prefix(4))
        return Grid(horizontalSpacing: 10, verticalSpacing: 10) {
            ForEach(0..<2, id: \.self) { row in
                GridRow {
                    ForEach(0..<2, id: \.self) { col in
                        let i = row * 2 + col
                        if i < items.count { tile(items[i]) } else { Color.clear }
                    }
                }
            }
        }
    }

    private func tile(_ p: LibrarySnapshot.PlaylistSummary) -> some View {
        // Link and play button sit side by side (not nested) so each tap has one meaning.
        HStack(spacing: 8) {
            Link(destination: link(p)) {
                HStack(spacing: 8) {
                    WidgetCover(fileName: p.artworkFile, accentHex: p.accentHex, cornerRadius: 8).frame(width: 40, height: 40)
                    Text(p.name).font(.caption.weight(.semibold)).lineLimit(2)
                    Spacer(minLength: 0)
                }
            }
            playButton(p, size: 24)
        }
        .padding(6)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(.white.opacity(0.1)))
    }

    private func listView(count: Int) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Jump back in").font(.caption.weight(.semibold)).foregroundStyle(.white.opacity(0.65))
            ForEach(Array(all.prefix(count))) { p in
                HStack(spacing: 10) {
                    Link(destination: link(p)) {
                        HStack(spacing: 10) {
                            WidgetCover(fileName: p.artworkFile, accentHex: p.accentHex, cornerRadius: 8).frame(width: 42, height: 42)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(p.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                                Text(p.folderPath.isEmpty ? "\(p.songCount) songs" : "\(p.folderPath) · \(p.songCount) songs")
                                    .font(.caption2).foregroundStyle(.white.opacity(0.6)).lineLimit(1)
                            }
                            Spacer(minLength: 0)
                        }
                    }
                    playButton(p, size: 28)
                }
            }
            Spacer(minLength: 0)
        }
    }

    private func playButton(_ p: LibrarySnapshot.PlaylistSummary, size: CGFloat) -> some View {
        Button(intent: PlayPlaylistIntent(playlist: PlaylistEntity(p))) {
            Image(systemName: "play.fill")
                .font(.system(size: size * 0.42, weight: .bold))
                .foregroundStyle(.black)
                .frame(width: size, height: size)
                .background(Circle().fill(.white))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Play \(p.name)")
    }

    private func link(_ p: LibrarySnapshot.PlaylistSummary) -> URL {
        if p.id == LibrarySnapshot.likedSongsID { return URL(string: "pulse://liked")! }
        let id = p.id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? p.id
        return URL(string: "pulse://playlist/\(id)") ?? URL(string: "pulse://nowplaying")!
    }
}
