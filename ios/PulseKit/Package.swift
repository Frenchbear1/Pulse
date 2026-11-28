// swift-tools-version: 5.9
// PulseKit: everything the Pulse app, its widgets, the watch app and the complication share.
//
// Layout
//   Models/        Codable data model (mirrors the web app's db: tracks, nodes, liked, plays, history)
//   Library/       LibraryStore (Files-app folders via security-scoped bookmarks), metadata, artwork, index
//   Playback/      PlayerEngine (AVAudioEngine), PlayQueue, EQ presets, audio session, Now Playing
//   Shared/        App Group container, widget/watch snapshots, accent colour maths
//   Connectivity/  WatchConnectivity message + sync manifest types
//   Activity/      ActivityKit attributes for the Now Playing Live Activity
//
// iOS-only pieces (engine, file import, CarPlay-facing APIs) are wrapped in `#if os(iOS)` so the
// package still builds for watchOS, where only the models, snapshots and messages are used.
import PackageDescription

let package = Package(
    name: "PulseKit",
    platforms: [.iOS(.v17), .watchOS(.v10)],
    products: [
        .library(name: "PulseKit", targets: ["PulseKit"])
    ],
    targets: [
        .target(name: "PulseKit", path: "Sources/PulseKit"),
        .testTarget(name: "PulseKitTests", dependencies: ["PulseKit"], path: "Tests/PulseKitTests")
    ]
)
