import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cherryProviderHooks } from '../lib/cherry-provider.mjs';

test('Cherry provider discovers account models and forwards requests with its gateway key', async (t) => {
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({ path: req.url, auth: req.headers.authorization, body: Buffer.concat(chunks).toString() });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/models') res.end(JSON.stringify({ data: [{ id: 'upstream:model/name', name: 'Cherry model' }, { id: 'magpie:cherrystudio/upstream:model/name' }] }));
    else res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'mock' } }] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeIdleConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  const auth = { type: 'api', key: 'gateway-test-key', metadata: { gateway: base } };
  const hooks = cherryProviderHooks();
  const cfg = {};
  await hooks.config(cfg);
  assert.equal(cfg.provider.cherrystudio.npm, '@ai-sdk/openai-compatible');
  const models = await hooks.provider.models({ models: {
    'upstream:model/name': { name: 'Custom name', capabilities: { toolcall: true }, limit: { context: 16000, output: 2000 } },
  } }, { auth });
  assert.deepEqual(Object.keys(models), ['upstream:model/name']);
  assert.equal(models['upstream:model/name'].api.id, 'upstream:model/name');
  assert.equal(models['upstream:model/name'].name, 'Custom name');
  assert.equal(models['upstream:model/name'].capabilities.toolcall, true);
  assert.equal(models['upstream:model/name'].limit.context, 16000);
  const loader = await hooks.auth.loader(async () => auth);
  assert.equal(loader.baseURL, base);
  const body = JSON.stringify({ model: 'upstream:model/name', messages: [{ role: 'user', content: 'mock' }], stream: false });
  const response = await loader.fetch(`${base}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  assert.equal((await response.json()).choices[0].message.content, 'mock');
  assert.equal(requests[1].body, body);
  assert.ok(requests.every((req) => req.auth === 'Bearer gateway-test-key'));
  await assert.rejects(loader.fetch('https://example.com/chat/completions'), /不属于/);
});
