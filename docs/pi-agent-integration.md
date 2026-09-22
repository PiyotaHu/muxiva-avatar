# Persistent Pi Agent integration

`avatar.pi_agent` composes `defineAgentNode` from `@muxiva/agent` with
`createAgentLoopDriver` from the generic `main` of `@piyotahu/muxiva-pi-agent`
(0.2.1). One persistent model/tool loop belongs to each Node instance. Existing
framework code owns request lifecycle, explicit cancellation and late-output
suppression. The application adds no loop or turn controller.

Ports: `prompt_in` (Text), `signal_in` (Signal), `text_out` (Text deltas),
`event_out` (Event). Connect admitted prompts and canonical cancellation from
`builtin.voice_turn_controller`.

Set before starting the Graph:

- `MUXIVA_MODEL_BASE_URL`: OpenAI-compatible API base, e.g. `http://127.0.0.1:1234/v1`.
- `MUXIVA_MODEL_ID`: actual loaded model identifier.
- `MUXIVA_MODEL_API_KEY`: backend key; never stored in Graph JSON.
- `MUXIVA_MODEL_AUTH_MODE`: `api-key` by default; explicitly use `none` for a keyless local server.

Missing backend/model/key raises an explicit startup error. Model failures use
the existing `muxiva.agent.response.failed` event. No mock response or silent
cloud fallback exists. Keyless mode strips the SDK placeholder Authorization
header. The runtime uses Pi's official OpenAI-compatible streaming implementation.

Nonsecret Graph defaults `model_base_url`, `model_id`, `model_auth_mode` are
overridden by environment variables. Persona, temperature, output token limits
and history bounds are application configuration.

Install the Pi package as a link to the sibling source checkout, so Node 22.19+
loads its TypeScript export outside node_modules. The generic main stays clean.
Future tool packs enter the same `AgentLoopDefinition.toolPacks` collection.
Artwork/gallery/search are not deleted or reimplemented; this initial model-only
composition does not advertise those tools as enabled.

`node --test tests/pi-agent-integration.test.mjs` uses an in-process HTTP protocol
fixture to check real Pi streaming, persistent history, explicit configuration
errors and cancellation. A fixture pass is not evidence of a real model deployment.
