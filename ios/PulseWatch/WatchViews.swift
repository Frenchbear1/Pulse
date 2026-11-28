import SwiftUI
import WatchKit
import PulseKit

private func accent(_ hex: String) -> Color {
    let c = AccentPalette.tuned(hex)
    return Color(red: c.r, green: c.g, blue: c.b)
}

// MARK: - Phone remote

/// Controls Pulse on the iPhone. Digital Crown changes Pulse's volume on the phone.
struct RemoteView: View {
    @Environment(WatchSessionManager.self) private var session
    @State private var volume = 0.8
    @State private var volumeTask: Task<Void, Never>?

    var body: some View {
        let np = session.phoneNowPlaying
        VStack(spacing: 6) {
            if np.hasSong {
                Text(np.title).font(.headline).lineLimit(2).multilineTextAlignment(.center)
                Text(np.artist).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                TimelineView(.periodic(from: .now, by: 1)) { ctx in
                    ProgressView(value: np.duration > 0 ? min(1, np.elapsed(at: ctx.date) / np.duration) : 0)
                        .tint(accent(np.accentHex))
                }
                HStack {
                    Button { session.send(.previous) } label: { Image(systemName: "backward.fill") }
                    Button { session.send(.togglePlayPause) } label: {
                        Image(systemName: np.isPlaying ? "pause.fill" : "play.fill").font(.title2)
                    }
                    Button { session.send(.next) } label: { Image(systemName: "forward.fill") }
                }
                .buttonStyle(.plain)
                .font(.title3)
                .padding(.top, 4)
                Button { session.send(.toggleLike) } label: {
                    Image(systemName: np.isLiked ? "heart.fill" : "heart").foregroundStyle(np.isLiked ? accent(np.accentHex) : .primary)
                }
                .buttonStyle(.plain)
            } else {
                Image(systemName: "iphone").font(.title2).foregroundStyle(.secondary)
                Text("Nothing playing on iPhone").font(.footnote).multilineTextAlignment(.center)
            }
            if let err = session.lastError { Text(err).font(.caption2).foregroundStyle(.orange) }
        }
        .padding(.horizontal, 4)
        .containerBackground(accent(np.accentHex).gradient.opacity(0.35), for: .tabView)
        .navigationTitle("iPhone")
        .focusable()
        .digitalCrownRotation($volume, from: 0, through: 1, by: 0.02, sensitivity: .low, isContinuous: false, isHapticFeedbackEnabled: true)
        .onChange(of: volume) { _, v in
            // Throttle: one message per 150 ms while the crown spins.
            volumeTask?.cancel()
            volumeTask = Task {
                try? await Task.sleep(for: .milliseconds(150))
                if !Task.isCancelled { session.send(.setVolume, value: v) }
            }
        }
    }
}

// MARK: - Playlists stored on the watch

struct OnWatchView: View {
    @Environment(WatchStorage.self) private var storage
    @Environment(WatchPlayer.self) private var player

    var body: some View {
        List {
            if let item = player.current {
                Section("Playing on Watch") {
                    NavigationLink { LocalNowPlayingView() } label: {
                        VStack(alignment: .leading) {
                            Text(item.title).lineLimit(1)
                            Text(item.artist).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                }
            }
            Section {
                if storage.manifests.isEmpty {
                    Text("Add a playlist from your iPhone to listen without it.").font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(storage.manifests) { m in
                    let p = storage.progress(of: m)
                    NavigationLink { WatchPlaylistView(manifest: m) } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(m.name).lineLimit(1)
                            Text(p.done == p.total ? "\(p.total) songs" : "\(p.done) of \(p.total) downloaded")
                                .font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                    .listItemTint(accent(m.accentHex))
                    .swipeActions {
                        Button(role: .destructive) { storage.remove(playlistID: m.id) } label: { Label("Remove", systemImage: "trash") }
                    }
                }
            } header: { Text("On Watch") } footer: {
                if !storage.manifests.isEmpty {
                    Text(ByteCountFormatter.string(fromByteCount: storage.usedBytes, countStyle: .file) + " used")
                }
            }
        }
        .navigationTitle("On Watch")
    }
}

struct WatchPlaylistView: View {
    @Environment(WatchStorage.self) private var storage
    @Environment(WatchPlayer.self) private var player
    let manifest: WatchSyncManifest
    @State private var showPlayer = false

    var body: some View {
        let available = Set(storage.availableItems(in: manifest).map(\.id))
        List {
            HStack {
                Button { player.play(manifest); showPlayer = true } label: { Label("Play", systemImage: "play.fill") }
                Button { player.play(manifest, shuffle: true); showPlayer = true } label: { Label("Shuffle", systemImage: "shuffle") }
            }
            .disabled(available.isEmpty)
            ForEach(manifest.items) { item in
                Button { player.play(manifest, startAt: item.id); showPlayer = true } label: {
                    VStack(alignment: .leading) {
                        Text(item.title).lineLimit(1)
                        Text(available.contains(item.id) ? item.artist : "Waiting for iPhone…")
                            .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                .disabled(!available.contains(item.id))
            }
        }
        .navigationTitle(manifest.name)
        .navigationDestination(isPresented: $showPlayer) { LocalNowPlayingView() }
    }
}

/// The system's Now Playing view: big controls, crown volume, route picker. It reads the
/// MPNowPlayingInfoCenter info that WatchPlayer publishes.
struct LocalNowPlayingView: View {
    var body: some View {
        NowPlayingView()
    }
}

// MARK: - Choose playlists to copy from the iPhone

struct SyncFromPhoneView: View {
    @Environment(WatchSessionManager.self) private var session
    @Environment(WatchStorage.self) private var storage

    var body: some View {
        List {
            if !session.isReachable {
                Text("Open Pulse on your iPhone to add playlists.").font(.footnote).foregroundStyle(.secondary)
            }
            ForEach(session.phonePlaylists) { p in
                let onWatch = storage.manifests.contains { $0.id == p.id }
                let pending = session.requestedSyncs.contains(p.id)
                Button { session.requestSync(p.id) } label: {
                    HStack {
                        VStack(alignment: .leading) {
                            Text(p.name).lineLimit(1)
                            Text("\(p.songCount) songs").font(.caption2).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Image(systemName: onWatch ? "checkmark.circle.fill" : pending ? "arrow.down.circle.dotted" : "arrow.down.circle")
                            .foregroundStyle(onWatch ? .green : .secondary)
                    }
                }
                .disabled(pending)
            }
        }
        .navigationTitle("Add from iPhone")
        .onAppear { if session.isReachable { session.refreshPlaylists() } }
    }
}
