import { defineAgentNode } from '@muxiva/agent'
import { createAgentLoopDriver } from '@piyotahu/muxiva-pi-agent'
import { createModelRuntime } from './model-runtime.ts'

// Application composition; existing packages own the persistent loop and lifecycle.
export const PiAgentNode = defineAgentNode({
  createDriver: ({ config, state }) => createAgentLoopDriver({ createModelRuntime }, { config, state }),
})
