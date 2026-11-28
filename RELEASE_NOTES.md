## Download
- **Pulse-Setup.exe** — recommended. Installs Pulse for your user (no admin needed), adds Start Menu and optional Desktop shortcuts, and an uninstaller under Windows Settings → Apps. Running it again updates Pulse and keeps your library.
- **Pulse.exe** — portable single file, no install. Keep the name `Pulse.exe` so your settings follow it.

Windows may show "Windows protected your PC" because the app isn't code-signed — click **More info → Run anyway**.

## What's new in 1.4.0
- **Side panel is now a built-in card** next to your library (open by default), following your blur/transparency/roundness. One button in the player bar (or P) shows/hides it; tabs are Now playing, Queue, Lyrics, Devices
- **Mini player can be its own window** next to the full app (Settings → Mini player → Opens as: Separate window). Customizing it opens your real mini player beside Pulse — no more mock preview
- Mini player: Transparency, real Windows 11 desktop blur (optional), glow blur; every layout can be dragged from anywhere and it always stays on screen
- Theme Studio: "Glass tint" replaced by **Transparency** (how much background shows through panels); whole-window transparency removed
- Numbers morph smoothly into the next digit
- Home button next to the search bar; the Home/Search card is gone; library chips are one scrollable row
- Overlay scrollbars that don't eat into headers or corners

## What's new in 1.3.2
- Narrow windows keep the title bar (minimize / maximize / close / drag) and the resize edges
- The sidebar opens as a drawer over the content when the window is too narrow, instead of refusing to expand
- Phone-width player bar redone: everything vertically centered, full-width progress line, Devices + Like + Play
- Full-screen player shrinks the cover to fit short windows so the controls never get cut off
- Fixed clipped shadows on the sidebar and on scrolling rows of cards; slim scrollbar on desktop
- Square window corners/outline removed; Windows blur is now opt-in (Settings → Window)
- Taskbar hover previews show the real window again

## What's new in 1.3.1
- **Fixed clicks going through Pulse to apps behind it, and the top bar freezing after maximize.** Neutralino made the see-through window a "layered" window that Windows hit-tested against an empty surface. Pulse now switches it to DWM transparency at launch, so every pixel of Pulse is Pulse (and Windows 11 can blur what's behind the see-through parts). Status shows in Settings → Window.
- F11 toggles full screen
- Clicking the cover in the player bar opens Now Playing in the side panel next to Queue, Lyrics and Devices; the ⤢ button opens the full-screen player
- Sidebar collapse/expand animates cleanly instead of jumping
- Numbers simply fade to the new digit (no rolling), and the colon in times is back in place
- "Ctrl K" in the search bar only shows on hover

## What's new in 1.3.0
- **Devices panel** (speaker button in the player bar): send Pulse to any Bluetooth headphones or speaker, your TV/monitor over HDMI, USB headsets — without changing the Windows default. It remembers your pick, pauses if the device disconnects and switches back when it reconnects. On iPhone it opens the AirPlay picker.
- **Library layouts like Spotify**: search your library, a "Recents" sort button (Recents, Recently added, Alphabetical, Most played, Custom order) and four views — compact list, list, grid, large grid

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
