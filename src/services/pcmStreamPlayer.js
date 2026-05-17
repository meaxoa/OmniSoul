// Progressive PCM playback via Web Audio API.
// Schedules each chunk back-to-back so streaming TTS audio plays without gaps.

export class PcmStreamPlayer {
  constructor({ sampleRate = 24000 } = {}) {
    this.sampleRate = sampleRate;
    this.ctx = null;
    this.nextStartTime = 0;
    this.activeSources = new Set();
    this.onEmpty = null;
    this.totalEnqueued = 0;
  }

  ensureContext() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctor({ sampleRate: this.sampleRate });
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  /**
   * Schedule a chunk of PCM16-LE bytes for playback.
   * Multiple calls queue tail-to-head with sample-accurate scheduling.
   */
  enqueuePcm16(int16Bytes) {
    if (!int16Bytes || !int16Bytes.length) return;
    const ctx = this.ensureContext();

    // PCM16-LE -> Float32 in [-1, 1]
    const sampleCount = int16Bytes.length >> 1;
    if (!sampleCount) return;
    const view = new DataView(int16Bytes.buffer, int16Bytes.byteOffset, int16Bytes.length);
    const float32 = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i += 1) {
      float32[i] = view.getInt16(i * 2, true) / 32768;
    }

    const buffer = ctx.createBuffer(1, sampleCount, this.sampleRate);
    buffer.copyToChannel(float32, 0);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const startAt = Math.max(this.nextStartTime, ctx.currentTime + 0.02);
    source.start(startAt);
    this.nextStartTime = startAt + buffer.duration;
    this.totalEnqueued += 1;

    this.activeSources.add(source);
    source.onended = () => {
      this.activeSources.delete(source);
      try { source.disconnect(); } catch { /* noop */ }
      if (this.activeSources.size === 0) {
        this.onEmpty?.();
      }
    };
  }

  stop() {
    for (const source of this.activeSources) {
      try { source.onended = null; } catch { /* noop */ }
      try { source.stop(); } catch { /* noop */ }
      try { source.disconnect(); } catch { /* noop */ }
    }
    this.activeSources.clear();
    this.nextStartTime = 0;
  }

  isBusy() {
    return this.activeSources.size > 0;
  }

  /**
   * Time (seconds) until all currently scheduled audio finishes playing.
   * Useful for sleeping until the queue drains.
   */
  remainingSeconds() {
    if (!this.ctx) return 0;
    return Math.max(0, this.nextStartTime - this.ctx.currentTime);
  }

  /** Resolve once every scheduled chunk has finished playing. */
  drained() {
    if (!this.isBusy()) return Promise.resolve();
    return new Promise((resolve) => {
      this.onEmpty = () => {
        this.onEmpty = null;
        resolve();
      };
    });
  }

  /** Permanently dispose the AudioContext. */
  destroy() {
    this.stop();
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}
