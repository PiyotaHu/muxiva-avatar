import { StringDecoder } from 'node:string_decoder';

// Application output boundary only: credentials never belong in diagnostics or media events.
export function redactSecrets(value, secrets = []) {
  let text = String(value);
  for (const secret of secrets.filter(value => typeof value === 'string' && value.length >= 4).sort((a,b)=>b.length-a.length)) {
    for (const variant of new Set([secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1,-1)])) {
      text = text.split(variant).join('[REDACTED]');
    }
  }
  return text.replace(/\bsk-ws-[A-Za-z0-9._-]+/g, '[REDACTED]')
    .replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [REDACTED]');
}

export function redactValue(value, secrets = []) {
  if (typeof value === 'string') return redactSecrets(value, secrets);
  if (Array.isArray(value)) return value.map(item => redactValue(item, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,redactValue(item,secrets)]));
  return value;
}

export function createLogRedactor(secrets, write) {
  const decoder = new StringDecoder('utf8');
  let pending = '', dropping = false, ended = false;
  const accept = text => {
    for (const [index, part] of text.split('\n').entries()) {
      if (index > 0) {
        if (!dropping) write(redactSecrets(pending, secrets) + '\n');
        pending = ''; dropping = false;
      }
      if (!dropping) {
        pending += part;
        if (pending.length > 65536) {
          pending = ''; dropping = true;
          write('[MUXIVA] Oversized diagnostic line omitted.\n');
        }
      }
    }
  };
  return {
    write(chunk) { if (!ended) accept(decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))); },
    end() { if (ended) return; accept(decoder.end()); if (!dropping && pending) write(redactSecrets(pending, secrets)); pending=''; ended=true; },
  };
}
