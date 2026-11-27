#!/usr/bin/env bash
# Builds Pulse.exe (single file, resources embedded) from the web app at the repo root.
# Needs Node.js + `npm i -g @neutralinojs/neu`. First time only: `cd desktop && neu update && cd ..`
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT/desktop"
rm -rf resources dist && mkdir resources
cp -r "$ROOT/index.html" "$ROOT/css" "$ROOT/js" "$ROOT/icons" resources/
cp neutralino.js resources/js/neutralino.js
node -e "
const fs=require('fs');const p='resources/index.html';let s=fs.readFileSync(p,'utf8');
s=s.replace('<!--DESKTOP-->','<script>window.PULSE_DESKTOP=true</script>\n<script src=\"js/neutralino.js\"></script>');
s=s.replace('<link rel=\"manifest\" href=\"manifest.webmanifest\">\n','');fs.writeFileSync(p,s);"
neu build --release --embed-resources
cp dist/Pulse/Pulse-win_x64.exe dist/Pulse.exe
echo "Built desktop/dist/Pulse.exe"
