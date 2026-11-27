# Pulse

A lightweight, animated music player for your own song files.

- **Windows**: a single ~3 MB `Pulse.exe` (Neutralinojs + the built-in Edge WebView2). Reads your music folders directly, streams with instant seeking, caches covers to disk, watches folders for changes.
- **iPhone / iPad**: the same app as an installable web app (PWA). Songs you import are stored inside the app so they play offline.

Both share one codebase: the web app lives at the repo root (served by GitHub Pages), and `desktop/` wraps it into the exe.

**Download for Windows:** download [`download/Pulse.exe`](https://github.com/Frenchbear1/Pulse/raw/main/download/Pulse.exe).
**iPhone / iPad:** open https://frenchbear1.github.io/Pulse/ in Safari → Share → Add to Home Screen.

## Features
- Library: Songs, Albums, Artists, Genres, on-disk Folders (any depth), Liked Songs, Recently Played, On Repeat
- Your Library: playlists and folders nested to unlimited depth; drag to reorder/nest, drag songs onto playlists
- Playlist covers: import any image, auto mosaic, or copy a ready-made AI image prompt (7 styles)
- Full metadata + embedded covers for MP3, FLAC, M4A/AAC/ALAC, OGG/Opus, WAV; folder art fallback (cover.jpg etc.)
- Synced lyrics from `.lrc` files next to songs, or embedded lyrics
- Queue with play next / add to queue / drag reorder, smart shuffle, repeat all/one
- 10-band EQ with 15 presets, preamp, volume leveler, crossfade (0–12 s), near-gapless preloading, speed 0.5–2× with pitch lock, sleep timer
- Now Playing with blurred animated art, 3D-tilt cover, 3 visualizer styles
- Mini player (Windows): bar, card, square, strip, cover-only; adjustable transparency, blur, corner radius, always-on-top
- Dynamic accent color from the album art, dark/black/light themes, window transparency, compact mode
- Lock-screen / media-key controls (Media Session), tray icon, keyboard shortcuts
- Backup/restore of playlists, likes and play counts; M3U import/export

## Build the Windows exe
```
npm i -g @neutralinojs/neu
cd desktop && neu update && cd ..
./build.sh        # -> desktop/dist/Pulse.exe
```

## Web app hosting
GitHub Pages serves the repo root (Settings → Pages → Deploy from a branch → `main` / `(root)`).
