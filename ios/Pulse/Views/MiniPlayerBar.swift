import SwiftUI
import PulseKit

/// The floating mini player above the tab bar (web #mbar): tap to open Now Playing, swipe up too,
/// swipe left/right to skip, thin progress line along the bottom.
struct MiniPlayerBar: View {
    @Environment(PlayerEngine.self) private var player
    @Environment(LibraryStore.self) private var library
    @Environment(UIState.self) private var ui
    @Environment(AppServices.self) private var services
    @State private var drag: CGFloat = 0

    var body: some View {
        if let song = player.currentSong {
            HStack(spacing: 12) {
                ArtworkView(key: song.artworkKey, radius: 8).frame(width: 42, height: 42)
                VStack(alignment: .leading, spacing: 1) {
                    Text(song.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                    Text(song.displayArtist).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                .offset(x: drag * 0.4)
                Spacer(minLength: 4)
                Button { library.toggleLike(song.id) } label: {
                    Image(systemName: library.isLiked(song.id) ? "heart.fill" : "heart")
                        .contentTransition(.symbolEffect(.replace))
                }
                .sensoryFeedback(.impact(weight: .light), trigger: library.isLiked(song.id))
                .accessibilityLabel(library.isLiked(song.id) ? "Unlike" : "Like")
                Button { player.togglePlayPause() } label: {
                    Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                        .font(.title3).frame(width: 36, height: 36)
                        .contentTransition(.symbolEffect(.replace))
                }
                .accessibilityLabel(player.isPlaying ? "Pause" : "Play")
                Button { player.next() } label: { Image(systemName: "forward.fill") }
                    .accessibilityLabel("Next")
            }
            .foregroundStyle(.primary)
            .padding(.horizontal, 12).padding(.vertical, 8)
            .overlay(alignment: .bottom) {
                GeometryReader { geo in
                    Capsule().fill(services.theme.accent)
                        .frame(width: geo.size.width * progress, height: 2)
                }
                .frame(height: 2).padding(.horizontal, 14)
            }
            .glass(radius: 16)
            .contentShape(Rectangle())
            .onTapGesture { ui.showNowPlaying = true }
            .gesture(DragGesture(minimumDistance: 12)
                .onChanged { v in if abs(v.translation.width) > abs(v.translation.height) { drag = v.translation.width } }
                .onEnded { v in
                    if v.translation.height < -40 { ui.showNowPlaying = true }
                    else if v.translation.width < -70 { player.next() }
                    else if v.translation.width > 70 { player.previous() }
                    withAnimation(.spring) { drag = 0 }
                })
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }

    private var progress: CGFloat {
        player.duration > 0 ? CGFloat(min(1, player.currentTime / player.duration)) : 0
    }
}
