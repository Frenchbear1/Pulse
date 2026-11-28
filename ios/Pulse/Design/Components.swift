import SwiftUI
import PulseKit

/// Cover art from ArtworkCache with a soft placeholder; loads off the main thread.
struct ArtworkView: View {
    let key: String?
    var size: ArtworkCache.Size = .small
    var radius: CGFloat = 10
    var placeholderSymbol = "music.note"
    @State private var image: UIImage?

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        ZStack {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                shape.fill(.white.opacity(0.07))
                Image(systemName: placeholderSymbol).font(.title3).foregroundStyle(.secondary)
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .clipShape(shape)
        .overlay(shape.strokeBorder(.white.opacity(0.06)))
        .task(id: key) { image = await ArtworkCache.shared.loadImage(for: key, size: size) }
        .accessibilityHidden(true)
    }
}

/// Playlist cover: custom image, else a 2x2 mosaic of its songs' covers (web "auto mosaic").
struct LibraryItemArtwork: View {
    @Environment(LibraryStore.self) private var library
    let item: LibraryItemID
    var radius: CGFloat = 10

    var body: some View {
        let own: String? = {
            switch item {
            case .playlist(let id): library.db.playlists[id]?.artworkKey
            case .folder(let id): library.db.folders[id]?.artworkKey
            }
        }()
        let keys = library.mosaicArtworkKeys(for: item)
        Group {
            if let own {
                ArtworkView(key: own, radius: radius)
            } else if keys.count >= 4 {
                Grid(horizontalSpacing: 0, verticalSpacing: 0) {
                    GridRow { ArtworkView(key: keys[0], radius: 0); ArtworkView(key: keys[1], radius: 0) }
                    GridRow { ArtworkView(key: keys[2], radius: 0); ArtworkView(key: keys[3], radius: 0) }
                }
                .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            } else {
                ArtworkView(key: keys.first, radius: radius, placeholderSymbol: item.isFolder ? "folder" : "music.note.list")
            }
        }
    }
}

/// A song row: cover, title/artist, playing indicator, like, overflow menu.
struct TrackRow: View {
    @Environment(LibraryStore.self) private var library
    @Environment(PlayerEngine.self) private var player
    let song: Song
    var showArt = true
    var trackNumber: Int?
    /// Extra actions, e.g. "Remove from playlist".
    var extraActions: [TrackAction] = []

    struct TrackAction: Identifiable {
        let id = UUID()
        let title: String
        let systemImage: String
        var role: ButtonRole?
        let run: () -> Void
    }

    var body: some View {
        let isCurrent = player.currentSongID == song.id
        HStack(spacing: 12) {
            if let trackNumber {
                Text(trackNumber > 0 ? "\(trackNumber)" : "–").font(.subheadline.monospacedDigit())
                    .foregroundStyle(.secondary).frame(width: 26)
            } else if showArt {
                ArtworkView(key: song.artworkKey, radius: 8).frame(width: 46, height: 46)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(song.title).font(.body.weight(isCurrent ? .semibold : .regular))
                    .foregroundStyle(isCurrent ? AnyShapeStyle(.tint) : AnyShapeStyle(.primary)).lineLimit(1)
                Text(song.displayArtist).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 8)
            if isCurrent {
                Image(systemName: player.isPlaying ? "waveform" : "pause.fill")
                    .symbolEffect(.variableColor.iterative, isActive: player.isPlaying)
                    .foregroundStyle(.tint).font(.footnote)
            }
            if library.isLiked(song.id) {
                Image(systemName: "heart.fill").font(.caption).foregroundStyle(.tint)
            }
            Menu { TrackMenu(song: song, extra: extraActions) } label: {
                Image(systemName: "ellipsis").frame(width: 32, height: 40).contentShape(Rectangle())
            }
            .foregroundStyle(.secondary)
        }
        .contentShape(Rectangle())
        .contextMenu { TrackMenu(song: song, extra: extraActions) }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(song.title), \(song.displayArtist)")
    }
}

/// The song actions menu (web trackMenu()).
struct TrackMenu: View {
    @Environment(LibraryStore.self) private var library
    @Environment(PlayerEngine.self) private var player
    @Environment(UIState.self) private var ui
    let song: Song
    var extra: [TrackRow.TrackAction] = []

    var body: some View {
        Button { player.playNext([song.id]); ui.toast = "Playing next" } label: { Label("Play Next", systemImage: "text.line.first.and.arrowtriangle.forward") }
        Button { player.addToQueue([song.id]); ui.toast = "Added to queue" } label: { Label("Add to Queue", systemImage: "text.badge.plus") }
        Button { ui.addToPlaylist = [song.id] } label: { Label("Add to Playlist…", systemImage: "music.note.list") }
        Button { library.toggleLike(song.id) } label: {
            library.isLiked(song.id) ? Label("Unlike", systemImage: "heart.slash") : Label("Like", systemImage: "heart")
        }
        Divider()
        // Buttons + an explicit path (NavigationLinks inside menus don't navigate reliably).
        Button { ui.push(.album(library.index.albumID(for: song))) } label: { Label("Go to Album", systemImage: "square.stack") }
        Button { ui.push(.artist(TextNormalizer.norm(song.primaryArtist.isEmpty ? "Unknown Artist" : song.primaryArtist))) } label: {
            Label("Go to Artist", systemImage: "music.mic")
        }
        if let url = library.fileURL(for: song) {
            ShareLink(item: url) { Label("Share File", systemImage: "square.and.arrow.up") }
        }
        if !extra.isEmpty {
            Divider()
            ForEach(extra) { a in Button(role: a.role, action: a.run) { Label(a.title, systemImage: a.systemImage) } }
        }
    }
}

/// Header with big art, title, stats and Play / Shuffle buttons (web heroEl()).
struct HeroHeader<Art: View>: View {
    let kind: String
    let title: String
    let subtitle: String
    @ViewBuilder var art: () -> Art
    let onPlay: () -> Void
    let onShuffle: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            art().frame(width: 220, height: 220).shadow(color: .black.opacity(0.35), radius: 24, y: 12)
            VStack(spacing: 4) {
                Text(kind.uppercased()).font(.caption.weight(.semibold)).foregroundStyle(.secondary).tracking(1)
                Text(title).font(.title2.bold()).multilineTextAlignment(.center)
                Text(subtitle).font(.subheadline).foregroundStyle(.secondary)
            }
            HStack(spacing: 12) {
                Button(action: onPlay) { Label("Play", systemImage: "play.fill").frame(maxWidth: .infinity) }
                    .buttonStyle(PillButtonStyle(prominent: true))
                Button(action: onShuffle) { Label("Shuffle", systemImage: "shuffle").frame(maxWidth: .infinity) }
                    .buttonStyle(PillButtonStyle(prominent: false))
            }
            .padding(.horizontal, 24)
        }
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity)
    }
}

struct PillButtonStyle: ButtonStyle {
    @Environment(AppServices.self) private var services
    var prominent: Bool
    func makeBody(configuration: Configuration) -> some View {
        let theme = services.theme
        configuration.label
            .font(.headline)
            .padding(.vertical, 12).padding(.horizontal, 18)
            .foregroundStyle(prominent ? theme.accentInk : theme.accent)
            .background {
                if prominent { Capsule().fill(theme.gradient) } else { Capsule().fill(.ultraThinMaterial) }
            }
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .animation(.spring(response: 0.25, dampingFraction: 0.6), value: configuration.isPressed)
    }
}

/// Horizontal shelf on Home ("Jump back in", "Recently added", ...).
struct Shelf<Content: View>: View {
    let title: String
    var seeAll: Route?
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(title).font(.title3.bold())
                Spacer()
                if let seeAll { NavigationLink("See all", value: seeAll).font(.subheadline) }
            }
            .padding(.horizontal)
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: 14) { content() }.padding(.horizontal)
            }
        }
    }
}

/// Square card with art + two lines (albums, playlists, artists).
struct Card<Art: View>: View {
    let title: String
    let subtitle: String
    var width: CGFloat = 150
    var circle = false
    @ViewBuilder var art: () -> Art

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            art().frame(width: width, height: width)
                .clipShape(circle ? AnyShape(Circle()) : AnyShape(RoundedRectangle(cornerRadius: 14, style: .continuous)))
            Text(title).font(.subheadline.weight(.semibold)).lineLimit(1)
            Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
        .frame(width: width, alignment: .leading)
    }
}

/// Little floating message at the bottom (web toast()).
struct ToastView: View {
    let text: String
    var body: some View {
        Text(text).font(.subheadline.weight(.medium)).padding(.horizontal, 16).padding(.vertical, 10)
            .glass(radius: 999).transition(.move(edge: .bottom).combined(with: .opacity))
    }
}
