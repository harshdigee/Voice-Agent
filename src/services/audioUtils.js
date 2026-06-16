/**
 * audioUtils.js
 * Handles all audio format conversions for Twilio Media Streams ↔ Groq pipeline.
 *
 * Twilio sends/receives: G.711 μ-law (mulaw), 8000 Hz, 8-bit, mono
 * Groq Whisper wants:    WAV, 16-bit PCM (8kHz is fine)
 * Groq PlayAI TTS gives: WAV, 16-bit PCM, typically 24000 Hz
 */

// ─── Precomputed mulaw → PCM16 decode table ─────────────────────────────────
const MULAW_DECODE = (() => {
  const table = new Int16Array(256);
  for (let i = 0; i < 256; i++) {
    const ulaw = ~i & 0xff;
    const sign = ulaw & 0x80 ? -1 : 1;
    const exponent = (ulaw >> 4) & 0x07;
    const mantissa = ulaw & 0x0f;
    table[i] = sign * (((mantissa | 0x10) << (exponent + 3)) - 0x84);
  }
  return table;
})();

/**
 * Decode a Buffer of mulaw bytes → Int16Array of PCM samples
 */
export function decodeMulaw(mulawBuf) {
  const pcm = new Int16Array(mulawBuf.length);
  for (let i = 0; i < mulawBuf.length; i++) {
    pcm[i] = MULAW_DECODE[mulawBuf[i]];
  }
  return pcm;
}

/**
 * Encode a single 16-bit PCM sample → mulaw byte (G.711 standard)
 */
function encodeSample(s) {
  const BIAS = 0x84;
  const CLIP = 32635;
  let sign = 0;
  if (s < 0) { sign = 0x80; s = -s; }
  if (s > CLIP) s = CLIP;
  s += BIAS;
  let exp = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exp > 0; exp--, mask >>= 1) {}
  const mantissa = (s >> (exp + 3)) & 0x0f;
  return (~(sign | (exp << 4) | mantissa)) & 0xff;
}

/**
 * Encode Int16Array PCM samples → Buffer of mulaw bytes
 */
export function encodeMulaw(pcm) {
  const buf = Buffer.alloc(pcm.length);
  for (let i = 0; i < pcm.length; i++) buf[i] = encodeSample(pcm[i]);
  return buf;
}

/**
 * Linear interpolation resampler — Int16Array in, Int16Array out
 */
export function resample(samples, fromRate, toRate) {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const len = Math.floor(samples.length / ratio);
  const out = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    const src = i * ratio;
    const lo = Math.floor(src);
    const hi = Math.min(lo + 1, samples.length - 1);
    const frac = src - lo;
    out[i] = Math.round(samples[lo] * (1 - frac) + samples[hi] * frac);
  }
  return out;
}

/**
 * Build a minimal WAV header + PCM data into a single Buffer
 */
export function buildWav(pcm, sampleRate = 8000, channels = 1, bitsPerSample = 16) {
  const dataBytes = pcm.length * (bitsPerSample / 8);
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);                                         // PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  buf.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < pcm.length; i++) buf.writeInt16LE(pcm[i], 44 + i * 2);
  return buf;
}

/**
 * Parse a WAV Buffer → { samples: Int16Array, sampleRate, channels }
 * Handles 16-bit and 8-bit PCM (not compressed formats).
 */
export function parseWav(wav) {
  const dv = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const channels = dv.getUint16(22, true);
  const sampleRate = dv.getUint32(24, true);
  const bitsPerSample = dv.getUint16(34, true);

  // Find "data" chunk offset
  let offset = 12;
  while (offset < wav.length - 8) {
    const id = String.fromCharCode(wav[offset], wav[offset + 1], wav[offset + 2], wav[offset + 3]);
    const size = dv.getUint32(offset + 4, true);
    if (id === "data") { offset += 8; break; }
    offset += 8 + size;
  }

  const bytesPerSample = bitsPerSample / 8;
  const frameCount = Math.floor((wav.length - offset) / (bytesPerSample * channels));
  const samples = new Int16Array(frameCount);

  for (let i = 0; i < frameCount; i++) {
    const pos = offset + i * bytesPerSample * channels;
    samples[i] = bitsPerSample === 16 ? dv.getInt16(pos, true) : (wav[pos] - 128) * 256;
  }

  return { samples, sampleRate, channels };
}

/**
 * Convert accumulated mulaw chunks → 8 kHz WAV Buffer (for Groq Whisper)
 */
export function mulawChunksToWav(chunks) {
  const raw = Buffer.concat(chunks);
  const pcm = decodeMulaw(raw);
  return buildWav(pcm, 8000, 1, 16);
}

/**
 * Convert a WAV Buffer (any sample rate) → mulaw Buffer at 8 kHz (for Twilio)
 */
export function wavToMulaw8k(wavBuf) {
  const { samples, sampleRate, channels } = parseWav(wavBuf);

  // Mix stereo → mono
  let mono = samples;
  if (channels === 2) {
    mono = new Int16Array(samples.length / 2);
    for (let i = 0; i < mono.length; i++) mono[i] = (samples[i * 2] + samples[i * 2 + 1]) >> 1;
  }

  // Resample → 8000 Hz
  const at8k = resample(mono, sampleRate, 8000);

  return encodeMulaw(at8k);
}
