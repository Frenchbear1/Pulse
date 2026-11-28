# Pulse for iPhone, Apple Watch and CarPlay

Native SwiftUI groundwork for Pulse. It mirrors the web app: your own song files, playlists in
folders nested as deep as you like, likes, play counts, a queue, and the glass design with the
accent color taken from album art.

> **Status:** source files only. They were written without a Mac, so they have **never been compiled**.
> Expect a round of small compiler fixes the first time you build. See `../docs/IOS_PLAN.md`.

## Build and run (needs a Mac with Xcode 15.4 or newer)

```sh
brew install xcodegen          # one-time
cd ios
xcodegen                       # generates Pulse.xcodeproj from project.yml
open Pulse.xcodeproj
```

1. Select the **Pulse** target, open **Signing & Capabilities** and choose your **Team**. Do the
   same for **PulseWidgets**, **PulseWatch** and **PulseWatchComplication**. You can also set
   `DEVELOPMENT_TEAM` once in `project.yml`.
2. If Xcode complains about the bundle ID or App Group, change `PULSE_BUNDLE_ID` and
   `PULSE_APP_GROUP` in `project.yml` to your own reverse-DNS names and run `xcodegen` again.
3. To build for a **real iPhone** before Apple has granted the CarPlay entitlement, comment out the
   `com.apple.developer.carplay-audio` key in `Pulse/Pulse.entitlements`. The Simulator doesn't
   need this. (Use I/O > External Displays > CarPlay to see the CarPlay screen.)
4. Choose the **Pulse** scheme, pick a simulator or your iPhone and press **Run**.
   For the watch, choose the **PulseWatch** scheme with a paired watch simulator.

`Pulse.xcodeproj` is generated, so don't commit it. Run `xcodegen` again after adding or moving files.

## Getting music in

* **Settings > Add Music Folder…** picks a folder in Files (On My iPhone, iCloud Drive, or a USB
  drive). Pulse keeps a bookmark and scans it again on launch.
* **Files app > On My iPhone > Pulse**: anything you drop here is picked up automatically.
* **Share sheet / Open in Pulse** on an audio file copies it into the library.
* **Settings > Import Pulse Backup…** reads the `pulse-backup.json` from the web or Windows app
  and rebuilds playlists, folders, likes and play counts by matching song titles and file names.

## Layout

| Path | What it is |
| --- | --- |
| `project.yml` | XcodeGen spec: 4 targets plus the local `PulseKit` package |
| `PulseKit/` | Shared Swift package: models, library store, playback engine, snapshots for widgets and the watch |
| `Pulse/` | iOS app: SwiftUI screens, CarPlay scene, Live Activity controller, watch sync, Siri phrases |
| `Shared/Intents/` | App Intents built into both the app and the widget extension |
| `PulseWidgets/` | Home Screen, Lock Screen and Live Activity / Dynamic Island widgets |
| `PulseWatch/` | Watch app: remote for the phone, plus playlists copied to the watch for offline listening |
| `PulseWatchComplication/` | Watch face complication |

### How the pieces talk

* **App ↔ widgets / Live Activity**: the app writes small JSON snapshots and 160 px cover
  thumbnails into the App Group container. Widget buttons run App Intents, which iOS runs inside
  the app's process, so there is only ever one audio engine.
* **App ↔ watch**: WatchConnectivity. The phone sends "now playing" as application context, the
  watch sends commands as messages, and playlists for offline listening are sent as a manifest
  plus files. Large lossless files are converted to AAC first.
* **CarPlay**: `CarPlaySceneDelegate` hands the interface to `CarPlayCoordinator`, which builds the
  Recents / Playlists / Library tabs and uses the system Now Playing screen. CarPlay is audio only.

## Tests

`PulseKit` has unit tests for the queue, the playlist and folder tree, text matching, lyrics
parsing and snapshots. On a Mac, run `cd ios/PulseKit && swift test`, or run them from Xcode.
