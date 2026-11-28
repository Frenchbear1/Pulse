## Download
- **Pulse-Setup.exe** — recommended. Installs Pulse for your user (no admin needed), adds Start Menu and optional Desktop shortcuts, and an uninstaller under Windows Settings → Apps. Running it again updates Pulse and keeps your library.
- **Pulse.exe** — portable single file, no install. Keep the name `Pulse.exe` so your settings follow it.

Windows may show "Windows protected your PC" because the app isn't code-signed — click **More info → Run anyway**.

## What's new in 1.2.0
- **Now Playing side panel** on wide windows, like Spotify: clicking the cover shows big art, song info and what's next beside your library instead of a mostly-empty full screen (the ⤢ button still goes full screen; choose in Settings → Now playing view)
- **Maximize is real full screen**, and dragging the top bar while maximized no longer snaps the window back
- **Folders of playlists** with pin-to-top, plus Library sorting (custom, recently played, most played, recently added, A–Z) and views (all, playlists, folders, pinned); playlists no longer look indented
- **Liked folder detection** — a folder named "Liked" (or Favorites/Loved) can become your Liked Songs, optionally kept in sync
- **Spotify import does more**: keeps playlist order, brings in Liked Songs with their dates, adds "Date added" to every song, prefers the folder named after each playlist, and fills in missing album/year/genre/label
- **Mobile gestures**: swipe a song right to queue / left to like (configurable), swipe the mini player to skip or up to open Now Playing, all toggleable in Settings → Gestures
- **Theme Studio live preview** that shows blur, tint, glow, roundness and accent changing as you drag
- Smoother, slower title scrolling that only runs when the title doesn't fit, with no blur over the start of the title
- Rolling-digit number animations for times and import counts; the import status pill no longer jitters
- Imports run quietly in the background — no flashing or redraws while you use the app; cover work moved off the main thread
- Side panel opens as an overlay in smaller windows and animates in cleanly
- Fixed cut-off letters (g, q, y) in menus, the gray border on the mini player, and clicks passing through the window

## What's new in 1.1.0
- Covers load while songs are still importing — the song you're playing and your queue get theirs first
- Waits for downloads to finish writing before reading a file; re-reads files whose tags/cover were added later; keeps retrying missing covers
- Covers fill in live everywhere without redrawing the page
- Glass redesign + Theme Studio (8 presets, modes, accent + gradient partner, background, blur, tint, roundness, fonts)
- Spotify playlist import via Exportify with fuzzy matching and auto-fill
- Adaptive mini player with live preview while customizing; options handle appears only when your cursor is near
- Fixed maximize, see-through Now Playing, Task Manager name, off-center icon
- Version shown in Settings with a Check for updates button
