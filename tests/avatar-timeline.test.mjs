import assert from 'node:assert/strict';
import test from 'node:test';
import {AvatarTimeline} from '../web/avatar-timeline.mjs';

const event = (sequence, frames) => ({topic: 'muxiva.avatar.animation', payload: {
  schema_version: 1, stream_id: 'assistant', sequence, sample_rate_hz: 24000,
  keyframes: frames.map(([sample_offset, sample_count, mouth_open]) => ({sample_offset, sample_count, mouth_open}))
}});
const clock = (sequence, sampleOffset, playing = true) => ({sequence, sampleOffset, playing, sampleRateHz: 24000});

test('does not animate before actual audio playback', () => {
  const timeline = new AvatarTimeline();
  timeline.queue(event(1, [[0, 480, 0.8], [480, 480, 0.2]]));
  assert.equal(timeline.sample(clock(1, 0, false)), 0);
  assert.equal(timeline.sample(clock(1, 0)), 0.8);
  assert.equal(timeline.sample(clock(1, 479)), 0.8);
  assert.equal(timeline.sample(clock(1, 480)), 0.2);
  assert.equal(timeline.sample(clock(1, 960)), 0);
});

test('cancel watermark drops late events but accepts new speech', () => {
  const timeline = new AvatarTimeline();
  timeline.queue(event(1, [[0, 480, 0.8]]));
  timeline.reset({beforeSequence: 2});
  assert.equal(timeline.queue(event(1, [[480, 480, 1]])), false);
  assert.equal(timeline.sample(clock(1, 0)), 0);
  timeline.queue(event(2, [[0, 480, 0.4]]));
  assert.equal(timeline.sample(clock(2, 0)), 0.4);
});

test('queues are bounded without jumping imminent speech into the future', () => {
  const timeline = new AvatarTimeline({maxKeyframes: 2});
  timeline.queue(event(1, [[0, 10, 0.2], [10, 10, 0.4], [20, 10, 0.9]]));
  assert.equal(timeline.dropped, 1);
  assert.equal(timeline.sample(clock(1, 0)), 0.2);
  assert.equal(timeline.sample(clock(1, 20)), 0);
});

test('wrong rate and duplicate past frames do not corrupt the clock', () => {
  const timeline = new AvatarTimeline();
  timeline.queue(event(1, [[0, 480, 0.6]]));
  assert.equal(timeline.sample({...clock(1, 0), sampleRateHz: 16000}), 0);
  assert.equal(timeline.sample(clock(1, 480)), 0);
  timeline.queue(event(1, [[0, 480, 1]]));
  assert.equal(timeline.sample(clock(1, 490)), 0);
});

test('strict cancellation keeps the generation equal to the watermark', () => {
  const timeline = new AvatarTimeline();
  timeline.queue(event(2, [[0, 480, 0.6]]));
  timeline.reset({beforeSequence: 2});
  timeline.reset({beforeSequence: 1});
  assert.equal(timeline.sample(clock(2, 0)), 0.6);
  assert.equal(timeline.queue(event(1, [[0, 480, 1]])), false);
});

test('late animation closes expired windows and supports the current window', () => {
  const timeline = new AvatarTimeline();
  timeline.queue(event(1, [[0, 480, 0.6]]));
  assert.equal(timeline.sample(clock(1, 700)), 0);
  timeline.queue(event(1, [[0, 480, 1], [480, 480, 0.4]]));
  assert.equal(timeline.sample(clock(1, 700)), 0.4);
  assert.equal(timeline.sample(clock(1, 700, false)), 0);
});

test('new graph session can restart its sequence after clear', () => {
  const timeline = new AvatarTimeline();
  timeline.reset({beforeSequence: 900});
  timeline.clear();
  timeline.queue(event(0, [[0, 480, 0.8]]));
  assert.equal(timeline.sample(clock(0, 0)), 0.8);
});

test('malformed reset cannot poison a valid timeline', () => {
  const timeline = new AvatarTimeline();
  timeline.queue(event(1, [[0, 480, 0.7]]));
  assert.equal(timeline.queue({topic: 'muxiva.avatar.reset', payload: {
    schema_version: 1, stream_id: 'assistant', before_sequence: NaN,
  }}), false);
  assert.equal(timeline.sample(clock(1, 0)), 0.7);
});
