/** A bounded sample-position timeline. This class never starts an audio clock. */
export class AvatarTimeline {
  constructor({maxKeyframes = 3000} = {}) {
    this.maxKeyframes = maxKeyframes;
    this.streams = new Map();
    this.watermarks = new Map();
    this.dropped = 0;
  }

  reset({streamId = 'assistant', beforeSequence = Number.MAX_SAFE_INTEGER} = {}) {
    this.watermarks.set(streamId, Math.max(this.watermarks.get(streamId) ?? 0, beforeSequence));
    for (const [key, stream] of this.streams) {
      if (stream.streamId === streamId && stream.sequence < beforeSequence) this.streams.delete(key);
    }
  }

  clear() {
    this.streams.clear();
    this.watermarks.clear();
  }

  queue(event) {
    const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;
    if (!payload || payload.schema_version !== 1) return false;
    if (event.topic === 'muxiva.avatar.reset') {
      if (typeof payload.stream_id !== 'string' || !Number.isSafeInteger(payload.before_sequence) || payload.before_sequence < 0) return false;
      this.reset({streamId: payload.stream_id, beforeSequence: payload.before_sequence});
      return true;
    }
    if (event.topic !== 'muxiva.avatar.animation') return false;
    const {stream_id: streamId, sequence, sample_rate_hz: rate, keyframes} = payload;
    if (typeof streamId !== 'string' || !Number.isSafeInteger(sequence) || sequence < 0 ||
        !Number.isInteger(rate) || rate < 8000 || rate > 192000 || !Array.isArray(keyframes)) return false;
    if (sequence < (this.watermarks.get(streamId) ?? 0)) return false;
    const key = JSON.stringify([streamId, sequence]);
    let stream = this.streams.get(key);
    if (!stream) {
      // A graph session has a serial assistant stream. Bound inactive generations
      // as well as frames, even if the consumer has disconnected or stopped.
      for (const [oldKey, old] of this.streams) {
        if (old.streamId === streamId && old.sequence < sequence) this.streams.delete(oldKey);
      }
      if (this.streams.size >= 8) {
        this.streams.delete(this.streams.keys().next().value);
        this.dropped++;
      }
      stream = {streamId, sequence, rate, frames: [], consumedThrough: -1};
      this.streams.set(key, stream);
    }
    if (stream.rate !== rate) return false;
    for (const frame of keyframes) {
      if (!Number.isSafeInteger(frame.sample_offset) || frame.sample_offset < 0 ||
          !Number.isSafeInteger(frame.sample_count) || frame.sample_count <= 0 ||
          !Number.isFinite(frame.mouth_open)) continue;
      if (frame.sample_offset + frame.sample_count <= stream.consumedThrough) continue;
      const tail = stream.frames.at(-1);
      if (tail && frame.sample_offset < tail.sample_offset + tail.sample_count) continue;
      stream.frames.push({...frame, mouth_open: Math.max(0, Math.min(1, frame.mouth_open))});
      if (stream.frames.length > this.maxKeyframes) {
        // Preserve imminent frames; a full queue must not jump the avatar into
        // distant future speech. Playback may continue with a closed mouth.
        stream.frames.pop();
        this.dropped++;
      }
    }
    return true;
  }

  sample({streamId = 'assistant', sequence, sampleOffset = 0, sampleRateHz, playing = false} = {}) {
    if (!playing || !Number.isFinite(sampleOffset) || sampleOffset < 0) return 0;
    if (sequence < (this.watermarks.get(streamId) ?? 0)) return 0;
    const stream = this.streams.get(JSON.stringify([streamId, sequence]));
    if (!stream || stream.rate !== sampleRateHz) return 0;
    stream.consumedThrough = Math.max(stream.consumedThrough, sampleOffset);
    while (stream.frames.length && stream.frames[0].sample_offset + stream.frames[0].sample_count <= sampleOffset) {
      stream.frames.shift();
    }
    const frame = stream.frames[0];
    return frame && sampleOffset >= frame.sample_offset ? frame.mouth_open : 0;
  }
}
