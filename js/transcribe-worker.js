// Runs Whisper (speech-to-text) entirely on this device via transformers.js. The model downloads once, then is cached.
let asr = null;
self.onmessage = async (e) => {
  const { audio, model } = e.data;
  try {
    if (!asr) {
      const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
      env.allowLocalModels = false;
      asr = await pipeline('automatic-speech-recognition', model || 'Xenova/whisper-base.en', {
        quantized: true,
        progress_callback: (p) => { if (p.status === 'progress' && p.file?.endsWith('.onnx')) self.postMessage({ type: 'download', pct: p.progress || 0 }); }
      });
    }
    self.postMessage({ type: 'listening' });
    let done = 0; const total = Math.ceil(audio.length / 16000 / 25);
    const out = await asr(audio, { chunk_length_s: 30, stride_length_s: 5, return_timestamps: true,
      callback_function: () => { done++; self.postMessage({ type: 'progress', pct: Math.min(99, (done / Math.max(1, total)) * 100) }); } });
    self.postMessage({ type: 'done', chunks: out.chunks || [], text: out.text || '' });
  } catch (err) { self.postMessage({ type: 'error', message: String(err?.message || err) }); }
};
