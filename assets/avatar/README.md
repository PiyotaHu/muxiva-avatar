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
| `idle` | no active user speech, model work, or playback | user-adjusted breathing idle |
| `listening` | `muxiva.voice.speech.started` until speech stop/transcript completion | attentive listening |
| `thinking` | `muxiva.agent.response.started` until completion/failure | thoughtful loop |
| `speaking` | PCM is actually being consumed by the browser audio player | conversational talking loop |

The precedence is actual playback, then live user speech, then model thinking,
then idle. VAD events only change presentation; they do not interrupt audio,
commit a turn, call the Agent, or create new turn semantics.

`web/avatar-animation.mjs` is the only body-rig writer in the active VRM path.
It crossfades the configured clips and falls back to the loaded idle if an
optional state clip cannot load. The Rocketbox clips already contain arms, wrists and finger tracks. The selected
character therefore has no `restPoseProfile` that would overwrite authored motion
after the mixer. Small model-specific `poseOffsets` are baked into every loaded
clip before playback, so the mixer remains the only body-rig writer. The current
profile leaves these offsets empty: its reviewed hand/arm adjustments are
already authored into `avatar-sample-a-idle-refined.vrma`.

The original user idle is a derivative of `rocketbox-idle.vrma`. It was
exported from Blender after recovering the manual pose at frame 211 and applying
the same local rotation deltas over frames 1-250 (24 fps). The original idle
remains available for comparison. Listening, thinking and speaking keep their
existing clips; the custom idle does not replace those states.

The selected `avatar-sample-a-idle-refined.vrma` relaxes the previously straight
fingers, removes the asymmetric thumb twist, and lowers the chin by 6 degrees.
Arm, wrist, torso, leg and translation tracks remain byte-identical to the user
export, as do all keyframe timestamps. The source export is not overwritten.
Reproduce this asset with:

```sh
node scripts/refine-vrma-pose.mjs assets/avatar/animations/avatar-sample-a-idle.vrma assets/avatar/animations/avatar-sample-a-idle-refinement.json assets/avatar/animations/avatar-sample-a-idle-refined.vrma
```

This is offline asset authoring, not another runtime bone writer.

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
Gaze targets the actual camera in world space through the VRM LookAt range maps,
not fixed head-local yaw/pitch. The animated raw head matrix is synchronized
before LookAt so eye contact is evaluated against the current pose, not the
previous frame. This applies to idle, listening, thinking and speaking. Emotion, blink,
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
