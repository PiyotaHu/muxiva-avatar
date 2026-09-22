# Avatar assets and runtime contract

## Current character

`character.json` selects the local `AvatarSample_A.vrm` model. The VRM binary is
ignored by Git because its recorded source is local-use-only; provenance and the
expected SHA-256 remain in `AvatarSample_A.source.json`.

The removed custom VRMs and illustration assets are not runtime fallbacks. A user
may temporarily load a local `.vrm` through the browser file picker. Import stays
inside the browser, and a failed import leaves the current character running.

## State-driven body motion

Body motion is data, not Agent logic. `character.json` maps four presentation
states to four compatible VRMA clips:

| State | Evidence | Motion |
| --- | --- | --- |
| `idle` | no active user speech, model work, or playback | breathing idle |
| `listening` | `muxiva.voice.speech.started` until speech stop/transcript completion | attentive listening |
| `thinking` | `muxiva.agent.response.started` until completion/failure | thoughtful loop |
| `speaking` | PCM is actually being consumed by the browser audio player | conversational talking loop |

The precedence is actual playback, then live user speech, then model thinking,
then idle. VAD events only change presentation; they do not interrupt audio,
commit a turn, call the Agent, or create new turn semantics.

`web/avatar-animation.mjs` is the only body-rig writer in the active VRM path.
It crossfades the configured clips and falls back to the loaded idle if an
optional state clip cannot load. The Rocketbox clips already contain arms,
wrists and finger tracks, so the selected character intentionally has no
`restPoseProfile` that would overwrite authored hand motion after the mixer.

The four `rocketbox-*.vrma` files come from one Microsoft Rocketbox female
standing animation family. Do not mix base motions from another family because
different rest stances produce visible seams. Exact source commits, SHA-256
hashes and per-file provenance are in `animations/sources.json`; the required
MIT notice is in `animations/THIRD_PARTY_NOTICES.md`.

## Independent face, gaze and lip layers

`web/avatar-face.mjs` owns expressions and blinking. `web/avatar-lipsync.mjs`
derives five vowel-like weights from PCM supplied to the browser and samples
them using the audio player's consumed sample offset. Mouth movement therefore
starts and stops with audible playback, not with response text or packet arrival.
The gaze controller is evaluated separately after body motion. Emotion, blink,
gaze and lips are composed without letting an emotion preset take ownership of
the viseme channels.

The Graph's existing `avatar.animation` Node still emits a timestamped RMS
envelope for compatibility and diagnostics. It does not control body motion.
The browser PCM analyzer is the primary lip path because it observes the real
playback clock; the event timeline remains a fallback.

## Shared browser and desktop-pet runtime

The normal page and the Electron desktop pet load the same `web/` application,
character config and `AvatarRenderer`. Electron owns only transparent-window,
drag and native-menu concerns. It does not duplicate animation, speech, Agent,
or turn state. A fix to the avatar runtime therefore applies to both surfaces.

## Integration sketch

```js
import {AvatarRenderer} from './avatar.mjs';

const avatar=new AvatarRenderer(canvas,character.renderer);
await avatar.load(character.asset);
avatar.setActivity('listening');
avatar.queueAudio(pcmFrame);
avatar.update({deltaSeconds,streamId:'assistant',sequence,
  sampleOffset,sampleRateHz:24000,playing});
avatar.reset({streamId:'assistant',beforeSequence:newSequence});
```

Character resources are restricted to local paths below `/assets/avatar/`.
Animation state names and file paths belong in character configuration; no
model-name conditionals or Xiaozhi/personality policy belong in the renderer.
