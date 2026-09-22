import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import test from 'node:test'
import { PiAgentNode } from '../.muxiva/nodes/pi_agent/node.ts'
import { resolveModelConfiguration } from '../.muxiva/nodes/pi_agent/model-runtime.ts'

test('missing model configuration fails explicitly and keys are never Graph defaults', () => {
  assert.throws(() => resolveModelConfiguration({}, {}), /not configured/)
  assert.throws(() => resolveModelConfiguration({ model_base_url: 'http://localhost:1234/v1', model_id: 'local' }, {}), /API key is not configured/)
  assert.throws(() => resolveModelConfiguration({ model_base_url: 'https://user:secret@example.test/v1', model_id: 'local', model_auth_mode: 'none' }, {}), /without embedded credentials/)
  assert.equal(resolveModelConfiguration({ model_base_url: 'http://localhost:1234/v1', model_id: 'local', model_auth_mode: 'none' }, {}).authMode, 'none')
})

async function fixture(run) {
  const requests = []
  const server = createServer(async (request, response) => {
    let text = ''
    for await (const chunk of request) text += chunk
    const body = JSON.parse(text)
    requests.push({ body, authorization: request.headers.authorization, url: request.url })
    const content = body.messages.at(-1)?.content
    const last = typeof content === 'string' ? content : (content ?? []).map(part => part.text ?? '').join('')
    const slow = last === 'slow'
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    const write = (delta, finish_reason = null) => {
      if (!response.destroyed) response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture-model', choices: [{ index: 0, delta, finish_reason }] })}\n\n`)
    }
    write({ role: 'assistant', content: slow ? '旧的' : requests.length === 1 ? '你好。' : '我记得前面的对话。' })
    if (slow) await new Promise(resolve => setTimeout(resolve, 300))
    if (slow) write({ content: '不应继续播放。' })
    write({}, 'stop')
    if (!response.destroyed) response.end('data: [DONE]\n\n')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const keys = ['MUXIVA_MODEL_BASE_URL', 'MUXIVA_MODEL_ID', 'MUXIVA_MODEL_API_KEY', 'MUXIVA_MODEL_AUTH_MODE']
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  for (const key of keys) delete process.env[key]
  const node = new PiAgentNode({
    model_base_url: `http://127.0.0.1:${server.address().port}/v1`, model_id: 'fixture-model', model_auth_mode: 'none',
    system_prompt: 'Answer the user accurately.', max_history_messages: 24,
    agent_first_output_timeout_ms: 5000, agent_request_timeout_ms: 10000,
  })
  const outputs = []
  const context = { inputPort: 'prompt_in', emit: (port, frame) => outputs.push({ port, frame }), scheduleNextTick: () => {} }
  const wait = async predicate => {
    const deadline = Date.now() + 10000
    while (!predicate()) {
      assert.ok(Date.now() < deadline, 'timed out waiting for real Pi Node output')
      await new Promise(resolve => setTimeout(resolve, 5))
      node.onProcess(undefined, { ...context, inputPort: undefined })
    }
  }
  const prompt = (text, sequence) => node.onProcess({ kind: 'text', text, sequence }, context)
  try { await run({ node, outputs, requests, wait, prompt, context }) }
  finally {
    await node.onFinish()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
  }
}

const completed = (outputs, sequence) => outputs.some(({ frame }) => frame.topic === 'muxiva.agent.response.completed' && frame.sequence === sequence)

test('thin Pi Node calls the configured HTTP model and keeps one conversation history', async () => {
  await fixture(async ({ prompt, wait, outputs, requests }) => {
    prompt('hello', 1)
    await wait(() => completed(outputs, 1))
    prompt('what did you just say?', 2)
    await wait(() => completed(outputs, 2))
    assert.equal(requests.length, 2)
    assert.ok(requests.every(request => request.url === '/v1/chat/completions'))
    assert.ok(requests.every(request => request.authorization === undefined), 'keyless mode must omit Authorization')
    assert.equal(requests[0].body.model, 'fixture-model')
    assert.ok(requests[1].body.messages.some(message => message.role === 'assistant' && message.content === '你好。'))
    assert.equal(outputs.filter(({ port, frame }) => port === 'text_out' && frame.sequence === 1).map(({ frame }) => frame.text).join(''), '你好。')
    assert.ok(!outputs.some(({ frame }) => frame.topic === 'muxiva.agent.response.failed'))
  })
})

test('existing AgentNodeAdapter cancels an in-flight model and suppresses its late text', async () => {
  await fixture(async ({ node, context, prompt, wait, outputs }) => {
    prompt('slow', 10)
    await wait(() => outputs.some(({ port, frame }) => port === 'text_out' && frame.sequence === 10))
    assert.ok(!completed(outputs, 10), 'fixture must still be streaming when cancellation arrives')
    node.onSignal({ kind: 'signal', name: 'muxiva.turn.cancelled', sequence: 11 }, context)
    const cancellationIndex = outputs.length
    prompt('new question', 11)
    await wait(() => completed(outputs, 11))
    await new Promise(resolve => setTimeout(resolve, 350))
    node.onProcess(undefined, { ...context, inputPort: undefined })
    assert.ok(!outputs.slice(cancellationIndex).some(({ port, frame }) => port === 'text_out' && frame.sequence === 10))
    assert.ok(outputs.some(({ port, frame }) => port === 'text_out' && frame.sequence === 11))
  })
})
