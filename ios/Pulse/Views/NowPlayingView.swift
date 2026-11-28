import SwiftUI
import AVKit
import PulseKit

/// Full-screen Now Playing: blurred animated art behind, big cover (swipe to skip, double-tap to
/// like), glass controls, scrubber, and a bottom bar for lyrics / queue / sound / sleep / A-B loop /
/// AirPlay. Mirrors the web np.js overlay.
struct NowPlayingView: View {
    @Environment(PlayerEngine.self) private var player
    @Environment(LibraryStore.self) private var library
    @Environment(AppServices.self) private var services
    @Environment(UIState.self) private var ui
    @Environment(\.dismiss) private var dismiss
    @State private var panel: Panel?
    @State private var scrubbing: TimeInterval?
    @State private var artDrag: CGFloat = 0
    @State private var likeBurst = 0
    @State private var showLyrics = false

    enum Panel: String, Identifiable { case queue, sound, info; var id: String { rawValue } }

    var body: some View {
        let song = player.currentSong
        let theme = services.theme
        ZStack {
            theme.background.ignoresSafeArea()
            BlurredArtwork(key: song?.artworkKey).opacity(0.75)
            LinearGradient(colors: [.black.opacity(0.1), .black.opacity(0.55)], startPoint: .top, endPoint: .bottom).ignoresSafeArea()

            VStack(spacing: 18) {
                header(song)
                Spacer(minLength: 0)
                if showLyrics, let song {
                    LyricsView(song: song).frame(maxHeight: .infinity).transition(.opacity)
                } else {
                    cover(song).transition(.scale(scale: 0.9).combined(with: .opacity))
                }
                Spacer(minLength: 0)
                titleRow(song)
                scrubber
                transport
                bottomBar
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 12)
        }
        .foregroundStyle(.white)
        .environment(\.colorScheme, .dark)
        .tint(theme.accent)
        .gesture(DragGesture(minimumDistance: 30).onEnded { v in
            if v.translation.height > 120 && abs(v.translation.width) < 80 { dismiss() }   // swipe down to close
        })
        .sheet(item: $panel) { p in
            switch p {
            case .queue: QueueView().presentationDetents([.medium, .large]).presentationBackground(.ultraThinMaterial)
            case .sound: SoundSheet().presentationDetents([.medium, .large]).presentationBackground(.ultraThinMaterial)
            case .info: if let song { SongInfoSheet(song: song).presentationDetents([.medium]).presentationBackground(.ultraThinMaterial) }
            }
        }
        .animation(.spring(response: 0.4, dampingFraction: 0.85), value: showLyrics)
        .onChange(of: ui.showQueue) { _, v in if v { panel = .queue; ui.showQueue = false } }
    }

    // MARK: Pieces

    private func header(_ song: Song?) -> some View {
        HStack {
            Button { dismiss() } label: { Image(systemName: "chevron.down").font(.title3.weight(.semibold)) }
                .accessibilityLabel("Close")
            Spacer()
            VStack(spacing: 1) {
                Text("PLAYING FROM").font(.caption2.weight(.semibold)).opacity(0.6).tracking(1)
                Text(player.queue.source?.label ?? "Library").font(.footnote.weight(.semibold)).lineLimit(1)
            }
            Spacer()
            Menu {
                if let song {
                    TrackMenu(song: song)
                    Button { panel = .info } label: { Label("Song Info", systemImage: "info.circle") }
                }
            } label: { Image(systemName: "ellipsis").font(.title3.weight(.semibold)).frame(width: 32, height: 32) }
        }
        .padding(.top, 8)
    }

    private func cover(_ song: Song?) -> some View {
        ArtworkView(key: song?.artworkKey, size: .large, radius: 22)
            .shadow(color: .black.opacity(0.45), radius: 30, y: 18)
            .scaleEffect(player.isPlaying ? 1 : 0.88)
            .animation(.spring(response: 0.5, dampingFraction: 0.7), value: player.isPlaying)
            .offset(x: artDrag)
            .rotation3DEffect(.degrees(Double(artDrag) / 12), axis: (x: 0, y: 1, z: 0))   // web 3D-tilt cover
            .overlay {
                Image(systemName: "heart.fill").font(.system(size: 90)).foregroundStyle(.white)
                    .opacity(likeBurst > 0 ? 0.9 : 0).scaleEffect(likeBurst > 0 ? 1 : 0.4)
                    .animation(.spring(response: 0.3, dampingFraction: 0.5), value: likeBurst)
            }
            .gesture(DragGesture()
                .onChanged { artDrag = $0.translation.width }
                .onEnded { v in
                    if v.translation.width < -90 { player.next() } else if v.translation.width > 90 { player.previous() }
                    withAnimation(.spring) { artDrag = 0 }
                })
            .onTapGesture(count: 2) {
                guard let id = song?.id else { return }
                library.setLiked(id, true)
                likeBurst += 1
                Task { try? await Task.sleep(for: .milliseconds(650)); likeBurst = 0 }
            }
            .sensoryFeedback(.success, trigger: likeBurst) { _, new in new > 0 }
            .padding(.horizontal, 6)
            .id(song?.id)   // fresh transition per song
    }

    private func titleRow(_ song: Song?) -> some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 3) {
                Text(song?.title ?? "Not Playing").font(.title2.bold()).lineLimit(1)
                Text(song?.displayArtist ?? "").font(.title3).opacity(0.7).lineLimit(1)
            }
            Spacer()
            if let song {
                Button { library.toggleLike(song.id) } label: {
                    Image(systemName: library.isLiked(song.id) ? "heart.fill" : "heart").font(.title2)
                        .foregroundStyle(library.isLiked(song.id) ? AnyShapeStyle(.tint) : AnyShapeStyle(.white))
                        .contentTransition(.symbolEffect(.replace))
                }
                .sensoryFeedback(.impact, trigger: library.isLiked(song.id))
                .accessibilityLabel(library.isLiked(song.id) ? "Unlike" : "Like")
            }
        }
    }

    private var scrubber: some View {
        let d = max(player.duration, 0.01)
        let shown = scrubbing ?? player.currentTime
        return VStack(spacing: 4) {
            Slider(value: Binding(get: { shown }, set: { scrubbing = $0 }), in: 0...d) { editing in
                if !editing, let t = scrubbing { player.seek(to: t); scrubbing = nil }
            }
            .overlay(alignment: .leading) { abMarkers(duration: d) }
            HStack {
                Text(shown.clockString)
                Spacer()
                if player.settings.speed != 1 { Text(String(format: "%.2g×", player.settings.speed)).foregroundStyle(.tint) }
                Spacer()
                Text("-" + max(0, d - shown).clockString)
            }
            .font(.caption.monospacedDigit()).opacity(0.7)
        }
    }

    @ViewBuilder private func abMarkers(duration d: TimeInterval) -> some View {
        if let l = player.abLoop {
            GeometryReader { geo in
                let x0 = geo.size.width * l.start / d
                let x1 = geo.size.width * (l.end ?? l.start) / d
                Capsule().fill(.tint.opacity(0.35)).frame(width: max(3, x1 - x0), height: 6)
                    .offset(x: x0, y: geo.size.height / 2 - 3)
            }
            .allowsHitTesting(false)
        }
    }

    private var transport: some View {
        HStack {
            Button { player.toggleShuffle() } label: {
                Image(systemName: "shuffle").foregroundStyle(player.settings.shuffle ? AnyShapeStyle(.tint) : AnyShapeStyle(.white.opacity(0.7)))
            }
            .accessibilityLabel(player.settings.shuffle ? "Shuffle on" : "Shuffle off")
            Spacer()
            Button { player.previous() } label: { Image(systemName: "backward.fill").font(.title) }
                .accessibilityLabel("Previous")
            Spacer()
            Button { player.togglePlayPause() } label: {
                Image(systemName: player.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                    .font(.system(size: 76)).symbolRenderingMode(.hierarchical)
                    .contentTransition(.symbolEffect(.replace.downUp))
            }
            .sensoryFeedback(.impact(weight: .medium), trigger: player.isPlaying)
            .accessibilityLabel(player.isPlaying ? "Pause" : "Play")
            Spacer()
            Button { player.next() } label: { Image(systemName: "forward.fill").font(.title) }
                .accessibilityLabel("Next")
            Spacer()
            Button { player.cycleRepeat() } label: {
                Image(systemName: player.settings.repeatMode == .one ? "repeat.1" : "repeat")
                    .foregroundStyle(player.settings.repeatMode == .off ? AnyShapeStyle(.white.opacity(0.7)) : AnyShapeStyle(.tint))
            }
            .accessibilityLabel("Repeat \(player.settings.repeatMode.rawValue)")
        }
        .font(.title3)
    }

    private var bottomBar: some View {
        HStack(spacing: 0) {
            barButton(showLyrics ? "quote.bubble.fill" : "quote.bubble", "Lyrics") { showLyrics.toggle() }
            barButton("list.bullet", "Queue") { panel = .queue }
            barButton("slider.vertical.3", "Sound") { panel = .sound }
            SleepMenu().frame(maxWidth: .infinity)
            barButton(abIcon, "A-B loop") { player.cycleABLoop() }
            AirPlayButton().frame(width: 44, height: 44).frame(maxWidth: .infinity)
        }
        .padding(.vertical, 6)
        .glass(radius: 18)
    }

    private var abIcon: String {
        guard let l = player.abLoop else { return "repeat.circle" }
        return l.end == nil ? "a.circle.fill" : "repeat.circle.fill"
    }

    private func barButton(_ symbol: String, _ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { Image(systemName: symbol).font(.body.weight(.medium)).frame(maxWidth: .infinity, minHeight: 44) }
            .accessibilityLabel(label)
    }
}

/// Sleep timer menu (web sleep timer): presets, end of song, off; shows the countdown.
struct SleepMenu: View {
    @Environment(PlayerEngine.self) private var player
    var body: some View {
        Menu {
            ForEach(SleepTimer.presets, id: \.self) { m in Button("\(m) minutes") { player.setSleepTimer(minutes: m) } }
            Button("End of song") { player.setSleepAtEndOfSong() }
            if player.sleepTimer.isActive { Button("Turn off", role: .destructive) { player.setSleepTimer(minutes: nil) } }
        } label: {
            TimelineView(.periodic(from: .now, by: 1)) { _ in
                VStack(spacing: 0) {
                    Image(systemName: player.sleepTimer.isActive ? "moon.zzz.fill" : "moon.zzz")
                    if case .at = player.sleepTimer { Text(player.sleepTimer.label).font(.system(size: 8).monospacedDigit()) }
                }
                .frame(minHeight: 44)
            }
        }
        .accessibilityLabel("Sleep timer, \(player.sleepTimer.label)")
    }
}

/// System AirPlay / Bluetooth route picker (web "Devices").
struct AirPlayButton: UIViewRepresentable {
    func makeUIView(context: Context) -> AVRoutePickerView {
        let v = AVRoutePickerView()
        v.tintColor = .white
        v.prioritizesVideoDevices = false
        return v
    }
    func updateUIView(_ uiView: AVRoutePickerView, context: Context) {}
}

/// File + tag details (web "Info" tab).
struct SongInfoSheet: View {
    @Environment(LibraryStore.self) private var library
    let song: Song
    var body: some View {
        NavigationStack {
            List {
                LabeledContent("Title", value: song.title)
                LabeledContent("Artist", value: song.displayArtist)
                LabeledContent("Album", value: song.displayAlbum)
                if song.year > 0 { LabeledContent("Year", value: String(song.year)) }
                if !song.genre.isEmpty { LabeledContent("Genre", value: song.genre) }
                if !song.composer.isEmpty { LabeledContent("Composer", value: song.composer) }
                if song.bpm > 0 { LabeledContent("BPM", value: String(song.bpm)) }
                LabeledContent("Length", value: song.duration.clockString)
                LabeledContent("Plays", value: String(library.db.playCounts[song.id] ?? 0))
                if song.bitrate > 0 { LabeledContent("Bitrate", value: "\(song.bitrate) kbps") }
                if song.sampleRate > 0 { LabeledContent("Sample rate", value: String(format: "%.1f kHz", Double(song.sampleRate) / 1000)) }
                LabeledContent("File", value: song.relativePath)
                LabeledContent("Size", value: ByteCountFormatter.string(fromByteCount: song.fileSize, countStyle: .file))
            }
            .navigationTitle("Song Info")
            .navigationBarTitleDisplayMode(.inline)
            .scrollContentBackground(.hidden)
        }
    }
}
