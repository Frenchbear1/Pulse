// Pulse cover worker: decodes, resizes and colour-samples album art off the main thread,
// so importing thousands of songs never makes the app stutter.
function pickColor(d) {
  let best = null, bestScore = -1, ar = 0, ag = 0, ab = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2]; ar += r; ag += g; ab += b;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b); const sat = mx ? (mx - mn) / mx : 0; const lum = mx / 255;
    const score = sat * 1.4 + (lum > 0.25 && lum < 0.95 ? 0.6 : 0) - Math.abs(lum - 0.65) * 0.5;
    if (score > bestScore) { bestScore = score; best = [r, g, b]; }
  }
  const n = d.length / 4; if (!best || bestScore < 0.35) best = [ar / n, ag / n, ab / n];
  return '#' + best.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}
self.onmessage = async (e) => {
  const { id, bytes, mime } = e.data;
  try {
    const bmp = await createImageBitmap(new Blob([bytes], { type: mime || 'image/jpeg' }));
    const mk = (sz, q) => { const r = Math.min(1, sz / Math.max(bmp.width, bmp.height)); const w = Math.max(1, Math.round(bmp.width * r)), h = Math.max(1, Math.round(bmp.height * r)); const c = new OffscreenCanvas(w, h); const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(bmp, 0, 0, w, h); return c.convertToBlob({ type: 'image/jpeg', quality: q }); };
    const [big, small] = await Promise.all([mk(640, 0.86), mk(176, 0.8)]);
    const c = new OffscreenCanvas(24, 24); const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0, 24, 24);
    const color = pickColor(x.getImageData(0, 0, 24, 24).data); bmp.close();
    self.postMessage({ id, big, small, color });
  } catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); }
};
