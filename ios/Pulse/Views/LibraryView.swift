import SwiftUI
import PulseKit

/// "Your Library": the playlists/folders tree at the top level, with chips for the browse views
/// (Songs, Albums, Artists, Genres, Folders), list/grid layouts and sorting (web LIB_SORTS).
struct LibraryView: View {
    @Environment(LibraryStore.self) private var library
    @Environment(AppServices.self) private var services
    @State private var newName = ""
    @State private var creating: CreateKind?
    enum CreateKind: Identifiable { case playlist, folder; var id: Self { self } }

    var body: some View {
        LibraryItemsList(folderID: nil, title: "Library", header: AnyView(chips))
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button { creating = .playlist } label: { Label("New Playlist", systemImage: "music.note.list") }
                        Button { creating = .folder } label: { Label("New Folder", systemImage: "folder.badge.plus") }
                    } label: { Image(systemName: "plus") }
                }
            }
            .alert(creating == .folder ? "New folder" : "New playlist", isPresented: Binding(get: { creating != nil }, set: { if !$0 { creating = nil } })) {
                TextField("Name", text: $newName)
                Button("Create") {
                    let isFolder = creating == .folder
                    let name = newName.isEmpty ? (isFolder ? "New folder" : "New playlist") : newName
                    library.mutate { db in
                        if isFolder { _ = db.createFolder(named: name) } else { _ = db.createPlaylist(named: name) }
                    }
                    newName = ""
                }
                Button("Cancel", role: .cancel) { newName = "" }
            }
    }

    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chip("Songs", "music.note", .songs)
                chip("Albums", "square.stack", .albums)
                chip("Artists", "music.mic", .artists)
                chip("Genres", "guitars", .genres)
                chip("Folders", "folder", .diskFolders)
                chip("Liked", "heart", .liked)
            }
            .padding(.horizontal)
        }
    }

    private func chip(_ title: String, _ symbol: String, _ route: Route) -> some View {
        NavigationLink(value: route) {
            Label(title, systemImage: symbol).font(.subheadline.weight(.medium))
                .padding(.horizontal, 14).padding(.vertical, 8).glass(radius: 999)
        }
        .buttonStyle(.plain)
    }
}

/// Lists one level of the playlists/folders tree (top level or inside a folder), in list or grid
/// layout, with sort, reorder (custom order), rename, delete and move.
struct LibraryItemsList: View {
    @Environment(LibraryStore.self) private var library
    @Environment(AppServices.self) private var services
    let folderID: String?
    let title: String
    var header: AnyView? = nil
    @State private var renaming: LibraryItemID?
    @State private var renameText = ""
    @State private var moving: LibraryItemID?

    var body: some View {
        @Bindable var services = services
        let items = sortedItems
        Group {
            if services.appearance.libraryGrid {
                ScrollView {
                    header?.padding(.vertical, 8)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 14)], spacing: 18) {
                        ForEach(items, id: \.self) { item in
                            NavigationLink(value: route(item)) {
                                Card(title: library.db.name(of: item), subtitle: subtitle(item), width: 160) { LibraryItemArtwork(item: item, radius: 14) }
                            }
                            .buttonStyle(.plain)
                            .contextMenu { itemMenu(item) }
                        }
                    }
                    .padding()
                }
            } else {
                List {
                    if let header { header.listRowInsets(EdgeInsets()).listRowBackground(Color.clear).listRowSeparator(.hidden) }
                    ForEach(items, id: \.self) { item in
                        NavigationLink(value: route(item)) {
                            HStack(spacing: 12) {
                                LibraryItemArtwork(item: item, radius: 8).frame(width: 52, height: 52)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(library.db.name(of: item)).font(.body.weight(.medium)).lineLimit(1)
                                    Text(subtitle(item)).font(.subheadline).foregroundStyle(.secondary)
                                }
                            }
                        }
                        .contextMenu { itemMenu(item) }
                        .listRowBackground(Color.clear)
                    }
                    .onMove(perform: services.appearance.librarySort == .custom ? move : nil)
                }
                .listStyle(.plain)
            }
        }
        .overlay {
            if items.isEmpty && folderID != nil {
                ContentUnavailableView("Empty folder", systemImage: "folder", description: Text("Drag playlists here, or create one with +."))
            }
        }
        .navigationTitle(title)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker("Sort", selection: $services.appearance.librarySort) {
                        ForEach(LibrarySort.allCases) { Text($0.label).tag($0) }
                    }
                    Toggle(isOn: $services.appearance.libraryGrid) { Label("Grid", systemImage: "square.grid.2x2") }
                    if services.appearance.librarySort == .custom { EditButton() }
                } label: { Image(systemName: "arrow.up.arrow.down") }
            }
        }
        .alert("Rename", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Name", text: $renameText)
            Button("Save") { if let r = renaming { library.mutate { $0.rename(r, to: renameText) } } }
            Button("Cancel", role: .cancel) {}
        }
        .sheet(item: $moving) { item in MoveItemSheet(item: item) }
    }

    @ViewBuilder private func itemMenu(_ item: LibraryItemID) -> some View {
        Button { _ = services.player.playLibraryItem(id: item.rawID, shuffle: false) } label: { Label("Play", systemImage: "play") }
        Button { _ = services.player.playLibraryItem(id: item.rawID, shuffle: true) } label: { Label("Shuffle", systemImage: "shuffle") }
        Button { services.player.addToQueue(library.db.songIDs(in: item)) } label: { Label("Add to Queue", systemImage: "text.badge.plus") }
        Divider()
        Button { renameText = library.db.name(of: item); renaming = item } label: { Label("Rename", systemImage: "pencil") }
        Button { moving = item } label: { Label("Move to Folder…", systemImage: "folder") }
        if case .playlist(let id) = item {
            Button { services.watch.syncPlaylist(id) } label: { Label("Sync to Apple Watch", systemImage: "applewatch") }
        }
        Button(role: .destructive) { library.mutate { $0.delete(item) } } label: { Label("Delete", systemImage: "trash") }
    }

    private func route(_ item: LibraryItemID) -> Route { item.isFolder ? .folder(item.rawID) : .playlist(item.rawID) }

    private func subtitle(_ item: LibraryItemID) -> String {
        switch item {
        case .folder(let id):
            let n = library.db.folders[id]?.children.count ?? 0
            return "Folder · \(n) item\(n == 1 ? "" : "s")"
        case .playlist:
            let n = library.db.songIDs(in: item).count
            return "Playlist · \(n) song\(n == 1 ? "" : "s")"
        }
    }

    private var sortedItems: [LibraryItemID] {
        let items = library.db.children(of: folderID)
        let db = library.db
        switch services.appearance.librarySort {
        case .custom: return items
        case .alphabetical: return items.sorted { TextNormalizer.sortKey(db.name(of: $0)) < TextNormalizer.sortKey(db.name(of: $1)) }
        case .added:
            func created(_ i: LibraryItemID) -> Date { i.isFolder ? db.folders[i.rawID]?.created ?? .distantPast : db.playlists[i.rawID]?.created ?? .distantPast }
            return items.sorted { created($0) > created($1) }
        case .recent:
            let rank = Dictionary(uniqueKeysWithValues: db.recentItems.enumerated().map { ($0.element, $0.offset) })
            return items.sorted { (rank[$0] ?? Int.max) < (rank[$1] ?? Int.max) }
        case .plays:
            func plays(_ i: LibraryItemID) -> Int { db.songIDs(in: i).reduce(0) { $0 + (db.playCounts[$1] ?? 0) } }
            return items.sorted { plays($0) > plays($1) }
        }
    }

    private func move(from source: IndexSet, to destination: Int) {
        var items = library.db.children(of: folderID)
        items.move(fromOffsets: source, toOffset: destination)
        library.mutate { db in
            for (i, item) in items.enumerated() { db.move(item, to: folderID, at: i) }
        }
    }
}

/// Pick a destination folder for a playlist/folder (web drag-to-nest, made tap-friendly).
struct MoveItemSheet: View {
    @Environment(LibraryStore.self) private var library
    @Environment(\.dismiss) private var dismiss
    let item: LibraryItemID

    var body: some View {
        NavigationStack {
            List {
                Button { library.mutate { _ = $0.move(item, to: nil) }; dismiss() } label: { Label("Top level", systemImage: "tray") }
                ForEach(folders, id: \.folder.id) { entry in
                    Button { library.mutate { _ = $0.move(item, to: entry.folder.id) }; dismiss() } label: {
                        Label(entry.folder.name, systemImage: "folder").padding(.leading, CGFloat(entry.depth) * 16)
                    }
                    .disabled(library.db.isAncestor(item.rawID, of: .folder(entry.folder.id)) && item.isFolder)
                }
            }
            .navigationTitle("Move to")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }

    private var folders: [(folder: LibraryFolder, depth: Int)] {
        var out: [(LibraryFolder, Int)] = []
        func walk(_ items: [LibraryItemID], _ depth: Int) {
            for case .folder(let id) in items { if let f = library.db.folders[id] { out.append((f, depth)); walk(f.children, depth + 1) } }
        }
        walk(library.db.rootItems, 0)
        return out
    }
}

/// A folder inside "Your Library" (nested playlists/folders) with Play/Shuffle for everything inside.
struct LibraryFolderView: View {
    @Environment(LibraryStore.self) private var library
    @Environment(PlayerEngine.self) private var player
    let folderID: String

    var body: some View {
        let name = library.db.folders[folderID]?.name ?? "Folder"
        LibraryItemsList(folderID: folderID, title: name, header: AnyView(
            HeroHeader(kind: "Folder", title: name, subtitle: "\(library.db.songIDs(in: .folder(folderID)).count) songs",
                       art: { LibraryItemArtwork(item: .folder(folderID), radius: 18) },
                       onPlay: { _ = player.playLibraryItem(id: folderID, shuffle: false) },
                       onShuffle: { _ = player.playLibraryItem(id: folderID, shuffle: true) })))
            .onAppear { library.noteOpened(.folder(folderID)) }
    }
}
