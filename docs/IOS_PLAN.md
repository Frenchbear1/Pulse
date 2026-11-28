# Pulse native iOS plan

This explains, in plain language, what the native iPhone / Apple Watch / CarPlay version of Pulse
is, what is already written, what you'll need to finish it, and what it can't do.

The short version: **the code for a real iPhone app is now in `ios/`, but it has never been built.**
Building it needs a Mac. Publishing it needs a paid Apple Developer account, and CarPlay needs
Apple's permission on top of that. Meanwhile the web app (PWA) keeps working exactly as it does today.

---

## 1. What's already written (`ios/`)

Everything below exists as Swift source code. None of it has been compiled or run yet (see section 6).

| Area | What's there |
| --- | --- |
| **Project setup** | `project.yml` for XcodeGen. It generates the Xcode project with 4 targets: the iPhone/iPad app, the widgets, the watch app and the watch complication. It also includes the background-audio and Files-app settings, the CarPlay scene, App Group, the CarPlay entitlement placeholder, the app icon (made from the web icon), and privacy manifests. |
| **PulseKit** (shared code) | The data model (songs, playlists, folders nested to any depth, likes, play counts, history), the library (folders picked in Files, read again on launch; tags and cover art; lyrics from `.lrc` files), and the playback engine. The engine does the queue, smart shuffle, repeat, gapless playback, crossfade, speed 0.5–2× with pitch lock, the 10-band EQ with the web app's 15 presets, volume leveler, A–B loop, sleep timer, and Lock Screen / headphone / Control Center controls. It also handles phone calls and unplugged headphones. |
| **iPhone app screens** | Home, Library (list or grid, sorting, folders, move/rename), Playlist, Albums / Artists / Genres / disk folders, Search, Now Playing (blurred cover background, glass controls, lyrics, sleep timer, AirPlay), Queue, Sound (EQ, speed, crossfade), Settings (folders, Theme Studio presets, Apple Watch status, backup import). |
| **Import from the web app** | Reads the web/Windows app's `pulse-backup.json` and rebuilds playlists, folders, likes and play counts by matching songs on title and artist, then by file name. |
| **Siri & Shortcuts** | "Play ⟨playlist⟩ in Pulse", play/pause, next, previous, like. The same actions power the widget and Live Activity buttons. |
| **Widgets** | Now Playing (small/medium, with working play/pause, next and like buttons), Jump Back In (recent playlists with play buttons), Lock Screen widgets (circle, rectangle, inline). |
| **Live Activity** | Now Playing on the Lock Screen and in the Dynamic Island, with a progress bar and buttons. |
| **CarPlay** | Tabs: Recents, Playlists (folders open inside each other), Library (Liked, On Repeat, Albums, Artists, Shuffle All). Uses the system Now Playing screen with shuffle, repeat, like, speed and Up Next. Audio only. |
| **Apple Watch** | A remote for the phone (title, progress, play/pause/skip, like, Digital Crown volume). You can also copy playlists to the watch and play them without the phone, through Bluetooth headphones. There's also a watch face complication. |

What hasn't been ported from the web app yet: video playback, Spotify import, M3U files,
"Made for you" mixes, listening stats, the practice-mode speed trainer, the visualizers and custom
wallpapers. These are listed under milestone 3.

---

## 2. What you need (and what it costs)

| You need | Why | Cost |
| --- | --- | --- |
| **A Mac** (any Apple-silicon Mac is plenty) | Xcode, Apple's build tool, only runs on macOS. There is no supported way to build or sign an iPhone app on Windows or Linux. | Hardware you may already have access to |
| **Xcode 15.4 or newer** | Builds and runs the app, simulators for iPhone, Watch and CarPlay | Free (Mac App Store) |
| **XcodeGen** | Turns `project.yml` into the Xcode project (`brew install xcodegen`) | Free |
| **Apple Developer Program** | Needed for TestFlight, the App Store, App Groups (widgets and the watch rely on them) and the CarPlay entitlement | **$99 per year** |

**Don't sign up for anything yet.** You can get all the way to "it runs in the simulator" with
just a Mac and the free Apple ID that's already on it. With a free Apple ID you can also install
the app on your own iPhone, but it expires after 7 days and some features won't work. App Groups
in particular may be refused, so widgets and the watch won't see the app's data. The app still
runs, because it falls back to its own folder. Join the $99/year program only once you've decided
to put the app on TestFlight or the App Store.

Steps once you have a Mac are in `ios/README.md`: `brew install xcodegen`, `cd ios && xcodegen`,
`open Pulse.xcodeproj`, choose your team, then press Run.

---

## 3. CarPlay: asking Apple for permission

CarPlay apps need an extra permission ("entitlement") that Apple grants by hand:

1. Join the Apple Developer Program (above).
2. Go to **developer.apple.com/contact/carplay** and request the **CarPlay Audio** entitlement.
   Say that Pulse is an audio app that plays music files the user owns, and describe the CarPlay
   screens (Recents, Playlists, Library, Now Playing).
3. Wait. It's usually days to a few weeks, and Apple may ask questions. Approval isn't guaranteed.
4. Once granted, it shows on your App ID in Certificates, Identifiers & Profiles. Xcode's
   automatic signing picks it up. If not, regenerate the provisioning profile.

Until then:
* The **CarPlay Simulator** works without the entitlement. In the iOS Simulator, use
  I/O > External Displays > CarPlay. Apple also offers a separate "CarPlay Simulator" app in the
  Additional Tools for Xcode download.
* To run on a **real iPhone** before approval, comment out the `carplay-audio` key in
  `ios/Pulse/Pulse.entitlements`. Otherwise signing fails. Everything except CarPlay still works.

---

## 4. App Store review: things that matter for Pulse

* **Your own files are fine.** Players for files the user owns are an established category. Pulse
  doesn't download, stream or sell music, and nothing copyrighted ships inside the app.
* **Screenshots and the preview video** must not show real album covers or song names you don't
  have rights to. Use made-up titles and your own artwork.
* **Give the reviewer something to play.** The reviewer's phone has no music. In the review notes,
  explain how to add songs (Files app > On My iPhone > Pulse, or Settings > Add Music Folder).
  Attach or link a couple of royalty-free tracks they can use.
* **Name.** "Pulse" may already be taken on the App Store. You might need something like
  "Pulse Player". Don't use other apps' names, logos or look-alike icons anywhere.
* **Privacy.** Pulse collects nothing and has no account, ads or analytics. The App Store privacy
  label is "Data Not Collected". The privacy manifests (`PrivacyInfo.xcprivacy`) are included.
* **Background audio** is allowed because Pulse really plays audio in the background. Apple
  rejects apps that claim it without using it.
* **Encryption question:** answer "No". `ITSAppUsesNonExemptEncryption` is already set to false.
* **Apple Watch:** the watch app is installed together with the iPhone app. It's not a separate purchase.

---

## 5. Honest limits

**Video in CarPlay: treat it as not possible.** Apple only lets music and audio apps use its fixed
CarPlay templates: lists, grids and the Now Playing screen. There is no way for an app like Pulse
to put video on the car's screen. Any video features in cars are controlled by Apple and the
carmaker, are limited to when the car is parked, and aren't open to apps like this. Pulse in
CarPlay is audio only. That's also what keeps CarPlay approval realistic.

**Videos and movies on the iPhone itself** are possible later, as in the web app: your own video
files, subtitles, picture-in-picture, AirPlay to a TV. Pulse should only ever play files you own,
or stream from a server you run yourself (for example a home media server). Streaming or
downloading movies from sources that don't hold the rights would get the app rejected, and isn't
something Pulse should do.

**File formats.** iPhone's built-in audio support covers MP3, AAC/M4A, ALAC, FLAC, WAV and AIFF.
**OGG Vorbis and Opus files are not supported yet.** They'd need an extra decoder library, so
they're skipped when scanning. The web app plays them, so a few songs may show up there but not on
the phone until that's added.

**Apple Watch offline playlists:**
* Copying songs to the watch is slow: minutes for a big playlist, done in the background when
  iOS decides. It's faster when the watch is on its charger near the phone.
* Watch storage is small, so lossless files are converted to AAC before sending.
* Listening on the watch without the phone generally needs Bluetooth headphones.
* No EQ or crossfade on the watch, and plays on the watch aren't counted on the phone yet.
* Adding a playlist to the watch needs the iPhone nearby with Pulse installed.

**Other limits to expect:**
* **The code has never been compiled.** It was written carefully, but the first build on a Mac
  will almost certainly need a round of small fixes. Nothing here has been tested on a device.
* iOS limits how often widgets refresh. Progress bars animate on their own, but a widget may lag a
  moment behind a song change.
* A Live Activity can last at most about 8 hours. Pulse ends it after 10 minutes paused.
* Folders on USB drives or other apps' storage can lose access if the drive is renamed or the
  provider app is removed. Pulse will ask you to add the folder again.
* iCloud Drive files that aren't downloaded yet are requested and appear on the next scan.
* Pulse can't read your Apple Music library or songs bought in iTunes. Those are protected and
  would need Apple's MusicKit, a separate project.
* If iOS restarts its audio system (rare), playback stops and you press play again.
  Recovery isn't automatic yet.

---

## 6. Milestones

1. **First build** (needs a Mac): install Xcode and XcodeGen, generate the project, fix compile
   errors, run in the iPhone simulator. Try the CarPlay simulator and a paired Watch simulator.
   Expect roughly a day or two of fixes.
2. **On your own iPhone**: free Apple ID, 7-day installs. Add your music folder, import your web
   backup, and use it daily to find rough edges: audio interruptions, AirPods, locking the phone,
   large libraries.
3. **Feature parity and polish**: video player, listening stats, "Made for you", Spotify/M3U
   import, visualizers, iPad layout, VoiceOver pass, OGG/Opus decoding.
4. **Beta**: join the Developer Program ($99/yr), request the CarPlay Audio entitlement, then send
   TestFlight builds to yourself and friends. Test in a real car once CarPlay is approved.
5. **App Store**: choose the final name, write the screenshots and description, add review notes
   with sample royalty-free songs, then submit. CarPlay can ship in a later update if approval
   takes longer.

---

## 7. The web app in the meantime

Nothing changes for the PWA. It stays the main way to use Pulse on iPhone (Safari > Share > Add to
Home Screen) and on Windows. The two apps share ideas and data, not code:

* The same concepts and names: songs, playlists, nested folders, likes, play counts, queue, Theme
  Studio presets, EQ presets.
* **Backups move you over.** Export a backup from the web app (Settings > Data > Backup library > Export) and import it in
  the native app (Settings > Import Pulse Backup…).
* The version number in `ios/project.yml` (`MARKETING_VERSION`) follows the repo's `VERSION` file.

Keep improving the web app as usual. When a feature lands there, add it to milestone 3 above so the
native app can catch up.
