import { createModels, createProvider, type Model } from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import type { AgentLoopDefinition, AgentToolPackContext } from '@piyotahu/muxiva-pi-agent'
import { redactSecrets } from '../../../security.mjs'

export function resolveModelConfiguration(config: Record<string, unknown>, env = process.env) {
  const string = (key: string, variable: string, fallback = '') => String(env[variable] || config[key] || fallback).trim()
  const baseUrl = string('model_base_url', 'MUXIVA_MODEL_BASE_URL').replace(/\/+$/, '')
  const id = string('model_id', 'MUXIVA_MODEL_ID')
  const authMode = string('model_auth_mode', 'MUXIVA_MODEL_AUTH_MODE', 'api-key')
  const apiKey = (env.MUXIVA_MODEL_API_KEY || '').trim()
  if (!baseUrl || !id) throw new Error('Model backend is not configured: set MUXIVA_MODEL_BASE_URL and MUXIVA_MODEL_ID before starting the Graph.')
  let endpoint: URL
  try { endpoint = new URL(baseUrl) } catch { throw new Error('MUXIVA_MODEL_BASE_URL must be an absolute HTTP(S) URL.') }
  if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('MUXIVA_MODEL_BASE_URL must be an HTTP(S) API base without embedded credentials, query, or fragment.')
  }
  if (!['api-key', 'none'].includes(authMode)) throw new Error('MUXIVA_MODEL_AUTH_MODE must be api-key or none.')
  if (authMode === 'api-key' && !apiKey) throw new Error('Model API key is not configured: set MUXIVA_MODEL_API_KEY, or explicitly select MUXIVA_MODEL_AUTH_MODE=none for a keyless local server.')
  return { baseUrl, id, authMode, apiKey }
}

export function createModelRuntime({ config, fetch: request }: AgentToolPackContext) {
  const backend = resolveModelConfiguration(config)
  const maxTokens = Number(config.max_tokens ?? 512)
  const temperature = Number(config.temperature ?? 0.5)
  const model: Model<'openai-completions'> = {
    id: backend.id, name: backend.id, api: 'openai-completions', provider: 'avatar-configured',
    baseUrl: backend.baseUrl, reasoning: false, input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: Number(config.context_window ?? 32768), maxTokens,
  }
  const models = createModels()
  models.setProvider(createProvider({
    id: model.provider, name: 'Configured avatar application model', baseUrl: model.baseUrl,
    auth: { apiKey: {
      name: 'Application model authentication',
      resolve: async () => ({
        // Pi's OpenAI client requires a nonempty SDK key for local servers too.
        // The request boundary removes this placeholder in explicit keyless mode.
        auth: { apiKey: backend.authMode === 'none' ? 'local-keyless' : backend.apiKey },
        source: backend.authMode === 'none' ? 'explicit keyless backend' : 'MUXIVA_MODEL_API_KEY',
      }),
    } },
    models: [model], api: openAICompletionsApi(),
  }))
  const secrets = [backend.apiKey, process.env.DASHSCOPE_WORKSPACE_ID].filter(Boolean)
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (backend.authMode === 'none') {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
      headers.delete('authorization')
      init = { ...init, headers }
    }
    try {
      const response = await request(input, init)
      if (response.ok) return response
      // Providers can echo request credentials in error bodies. Clean them before SDK errors/logging.
      const text = redactSecrets(await response.text(), secrets)
      const headers = new Headers(response.headers)
      headers.delete('content-length'); headers.delete('content-encoding')
      return new Response(text, { status: response.status, statusText: redactSecrets(response.statusText, secrets), headers })
    } catch (error) {
      const safeError = new Error(redactSecrets(error instanceof Error ? error.message : String(error), secrets))
      if (error instanceof Error) safeError.name = error.name
      throw safeError
    }
  }
  const stream: ReturnType<AgentLoopDefinition['createModelRuntime']>['stream'] = (activeModel, context, options) =>
    models.streamSimple(activeModel, context, { ...options, fetch, maxTokens, temperature })
  return { model, stream }
}
