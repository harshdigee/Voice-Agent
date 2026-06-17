/**
 * vadService.js — Energy-based Voice Activity Detection
 *
 * Works on 8 kHz μ-law audio (Twilio Media Streams format).
 * Fires onSpeechStart when the caller begins speaking and
 * onSpeechEnd(audioBuffer) when they stop — passing the full speech chunk.
 *
 * Barge-in: onSpeechStart fires even while the agent is talking,
 * allowing the controller to clear the outgoing audio immediately.
 */

const FRAME_MS        = 20;           // process 20 ms frames
const SAMPLE_RATE     = 8000;
const FRAME_BYTES     = (SAMPLE_RATE * FRAME_MS) / 1000; // 160 bytes

const ENERGY_THRESHOLD  = 550;        // mulaw-decoded RMS threshold (higher = less line-noise triggers)
const SPEECH_ON_FRAMES  = 4;          // ~80 ms to confirm speech started
const SILENCE_OFF_FRAMES = 30;        // ~600 ms silence before end — Hindi has natural pauses between words
const MIN_SPEECH_BYTES  = 4800;       // ~600 ms @ 8 kHz — reject tiny/noisy chunks Whisper hallucinates on

// Inline mulaw→PCM lookup (avoid circular import)
const MULAW_TABLE = (() => {
  const t = new Int16Array(256);
  for (let i = 0; i < 256; i++) {
    const u = ~i & 0xff;
    const sign = u & 0x80 ? -1 : 1;
    const exp = (u >> 4) & 0x07;
    const mant = u & 0x0f;
    t[i] = sign * (((mant | 0x10) << (exp + 3)) - 0x84);
  }
  return t;
})();

function rms(frame) {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) {
    const s = MULAW_TABLE[frame[i]];
    sum += s * s;
  }
  return Math.sqrt(sum / frame.length);
}

export class VadDetector {
  constructor({ onSpeechStart, onSpeechEnd } = {}) {
    this.onSpeechStart  = onSpeechStart  || (() => {});
    this.onSpeechEnd    = onSpeechEnd    || (() => {});
    this._speaking      = false;
    this._speechFrames  = 0;
    this._silenceFrames = 0;
    this._speechBuf     = [];
    this._partial       = Buffer.alloc(0);
  }

  /** Feed an arbitrary-size mulaw chunk from Twilio */
  feed(chunk) {
    this._partial = Buffer.concat([this._partial, chunk]);
    while (this._partial.length >= FRAME_BYTES) {
      this._processFrame(this._partial.subarray(0, FRAME_BYTES));
      this._partial = this._partial.subarray(FRAME_BYTES);
    }
  }

  _processFrame(frame) {
    const active = rms(frame) > ENERGY_THRESHOLD;

    if (active) {
      this._silenceFrames = 0;
      this._speechFrames++;
      this._speechBuf.push(Buffer.from(frame));

      if (!this._speaking && this._speechFrames >= SPEECH_ON_FRAMES) {
        this._speaking = true;
        this.onSpeechStart();
      }
    } else {
      if (this._speaking) {
        this._speechBuf.push(Buffer.from(frame));
        this._silenceFrames++;

        if (this._silenceFrames >= SILENCE_OFF_FRAMES) {
          const audio = Buffer.concat(this._speechBuf);
          this._reset();
          if (audio.length >= MIN_SPEECH_BYTES) {
            this.onSpeechEnd(audio);
          }
        }
      } else {
        this._speechFrames = Math.max(0, this._speechFrames - 1);
      }
    }
  }

  _reset() {
    this._speaking      = false;
    this._speechFrames  = 0;
    this._silenceFrames = 0;
    this._speechBuf     = [];
  }

  reset() {
    this._reset();
    this._partial = Buffer.alloc(0);
  }

  // Discard only the accumulated speech buffer (keeps the frame accumulator).
  // Called on barge-in so the echo that triggered barge-in is not transcribed.
  resetSpeechBuffer() {
    this._speechBuf     = [];
    this._speechFrames  = 0;
    this._silenceFrames = 0;
    // Leave _speaking = true so silence-timeout still runs for real caller audio
  }

  get isSpeaking() { return this._speaking; }
}
