import SwiftUI
import UniformTypeIdentifiers
import PulseKit

/// Settings: library folders, appearance (Theme Studio presets), playback, Live Activity,
/// Apple Watch, backup import, about.
struct SettingsView: View {
    @Environment(LibraryStore.self) private var library
    @Environment(AppServices.self) private var services
    @Environment(UIState.self) private var ui
    /// One .fileImporter for all three uses: SwiftUI only honours one fileImporter per view.
    @State private var importer: Importer?
    @State private var lastImporter: Importer = .folder
    @State private var showSound = false

    enum Importer {
        case folder, songs, backup
        var types: [UTType] {
            switch self {
            case .folder: [.folder]
            case .songs: [.audio]
            case .backup: [.json]
            }
        }
    }

    private func present(_ i: Importer) { lastImporter = i; importer = i }

    var body: some View {
        @Bindable var services = services
        Form {
            Section {
                ForEach(library.db.roots) { root in
                    HStack {
                        Image(systemName: root.kind == .appDocuments ? "iphone" : "folder.fill").foregroundStyle(.tint)
                        VStack(alignment: .leading) {
                            Text(root.name)
                            let n = library.db.songs.values.filter { $0.rootID == root.id }.count
                            Text("\(n) songs" + (root.lastScan.map { " · scanned \($0.formatted(.relative(presentation: .named)))" } ?? ""))
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .swipeActions {
                        if root.kind == .bookmarkedFolder {
                            Button(role: .destructive) { library.removeRoot(root.id) } label: { Label("Remove", systemImage: "trash") }
                        }
                        Button { Task { await library.rescan(rootID: root.id) } } label: { Label("Rescan", systemImage: "arrow.clockwise") }
                    }
                }
                Button { present(.folder) } label: { Label("Add Music Folder…", systemImage: "folder.badge.plus") }
                Button { present(.songs) } label: { Label("Import Songs…", systemImage: "square.and.arrow.down") }
                Button { Task { await library.rescanAll() } } label: { Label("Rescan All", systemImage: "arrow.clockwise") }
                    .disabled(library.scan != nil)
                if let scan = library.scan {
                    VStack(alignment: .leading) {
                        ProgressView(value: scan.fraction) { Text(scan.label).font(.caption) }
                        if scan.waitingForDownload > 0 {
                            Text("\(scan.waitingForDownload) songs are downloading from iCloud; they'll appear on the next scan.")
                                .font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                }
            } header: { Text("Library") } footer: {
                Text("Pulse reads your own files. Removing a folder only removes it from Pulse - your files stay where they are.")
            }

            Section("Appearance") {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(AppearanceSettings.presets) { p in
                            Button { services.appearance.apply(p) } label: {
                                VStack(spacing: 6) {
                                    Circle().fill(LinearGradient(colors: [Color(hex: p.accent), Color(hex: p.partner ?? p.accent)], startPoint: .topLeading, endPoint: .bottomTrailing))
                                        .frame(width: 44, height: 44)
                                        .overlay(Circle().strokeBorder(.white, lineWidth: services.appearance.preset == p.id ? 2 : 0))
                                    Text(p.name).font(.caption)
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.vertical, 4)
                }
                Picker("Mode", selection: $services.appearance.mode) {
                    ForEach(AppearanceSettings.Mode.allCases) { Text($0.label).tag($0) }
                }
                Toggle("Accent from album art", isOn: Binding(get: { services.appearance.accentMode == .dynamic },
                                                             set: { services.appearance.accentMode = $0 ? .dynamic : .fixed }))
                if services.appearance.accentMode == .fixed {
                    ColorPicker("Accent", selection: Binding(get: { Color(hex: services.appearance.accentHex) },
                                                             set: { services.appearance.accentHex = $0.hexString }), supportsOpacity: false)
                }
                Picker("Background", selection: $services.appearance.background) {
                    ForEach(AppearanceSettings.Background.allCases) { Text($0.label).tag($0) }
                }
            }

            Section("Playback") {
                Button { showSound = true } label: { Label("Sound: EQ, speed, crossfade…", systemImage: "slider.vertical.3") }
                Toggle("Live Activity while playing", isOn: $services.appearance.liveActivity)
            }

            Section {
                LabeledContent("Status", value: services.watch.statusText)
                Text("Open a playlist's menu and choose “Sync to Apple Watch” to listen without your phone.")
                    .font(.caption).foregroundStyle(.secondary)
            } header: { Text("Apple Watch") }

            Section("Data") {
                Button { present(.backup) } label: { Label("Import Pulse Backup…", systemImage: "arrow.down.doc") }
                LabeledContent("Songs", value: "\(library.db.songs.count)")
                LabeledContent("Playlists", value: "\(library.db.playlists.count)")
                LabeledContent("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "-")
            }
        }
        .scrollContentBackground(.hidden)
        .navigationTitle("Settings")
        .fileImporter(isPresented: Binding(get: { importer != nil }, set: { if !$0 { importer = nil } }),
                      allowedContentTypes: (importer ?? lastImporter).types,
                      allowsMultipleSelection: (importer ?? lastImporter) != .backup) { r in
            guard case .success(let urls) = r else { return }
            switch lastImporter {
            case .folder:
                Task { for u in urls { await library.addFolder(u) } }
            case .songs:
                Task { let n = await library.importFiles(urls); ui.toast = "Imported \(n) song\(n == 1 ? "" : "s")" }
            case .backup:
                guard let url = urls.first else { return }
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                do {
                    let res = try library.importBackup(Data(contentsOf: url))
                    ui.toast = "Restored \(res.playlists) playlists · \(res.matchedSongs) songs matched"
                } catch { ui.toast = error.localizedDescription }
            }
        }
        .sheet(isPresented: $showSound) { SoundSheet().presentationDetents([.large]) }
    }
}

extension Color {
    var hexString: String {
        let c = UIColor(self)
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        c.getRed(&r, green: &g, blue: &b, alpha: &a)
        return AccentPalette.RGB(r: Double(min(max(r, 0), 1)), g: Double(min(max(g, 0), 1)), b: Double(min(max(b, 0), 1))).hex
    }
}
