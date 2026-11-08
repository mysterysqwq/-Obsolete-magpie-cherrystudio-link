import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeGateway, discoverGateway, inspectGateway, prepareImport } from '../lib/connection.mjs';
import { startServer } from '../lib/server.mjs';

async function mockGateway(t) {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ path: req.url, auth: req.headers.authorization, method: req.method });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/hello') return res.end(JSON.stringify({ name: 'magpie', version: 'test' }));
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [
      { id: 'provider/model', display_name: '测试模型', context_window: 200000 },
      { id: 'provider/model' }, { id: 'images/foo', kind: 'image' },
      { id: 'provider/other' }, { id: 12 },
    ] }));
    res.writeHead(404); res.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeIdleConnections(); }));
  return { url: `http://127.0.0.1:${server.address().port}`, requests };
}

test('normalizes /v1 and accepts only local gateway roots', () => {
  assert.deepEqual(normalizeGateway('http://localhost:3425/v1/'), { root: 'http://localhost:3425', baseUrl: 'http://localhost:3425/v1' });
  assert.equal(normalizeGateway('http://[::1]:3425').baseUrl, 'http://[::1]:3425/v1');
  for (const value of ['https://example.com', 'file:///tmp/x', 'http://user:secret@127.0.0.1', 'http://127.0.0.1/chat/completions', 'http://127.0.0.1/?key=secret']) {
    assert.throws(() => normalizeGateway(value));
  }
});

test('reads the gateway port without changing settings', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'cherry-port-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'magpie'));
  await writeFile(join(dir, 'magpie', 'settings.json'), '{"port":3456,"unrelated":true}');
  assert.equal(await discoverGateway({ env: { XDG_CONFIG_HOME: dir }, home: dir }), 'http://127.0.0.1:3456');
  assert.equal(await discoverGateway({ env: { MAGPIE_ADDR: '127.0.0.1:3499' }, home: dir }), 'http://127.0.0.1:3499');
});

test('generates an official import link that survives Cherry query decoding with Unicode', () => {
  const result = prepareImport({ gateway: 'http://127.0.0.1:3425/v1', name: '我的 Magpie 🍒', apiKey: 'key+/=中文' });
  const url = new URL(result.url);
  const processed = url.search.replaceAll('+', '_').replaceAll('/', '-');
  const encoded = new URLSearchParams(processed).get('data').replaceAll('_', '+').replaceAll('-', '/');
  const data = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  assert.deepEqual(data, { id: 'magpie', name: '我的 Magpie 🍒', type: 'openai', baseUrl: 'http://127.0.0.1:3425/v1', apiKey: 'key+/=中文' });
  assert.equal(url.host, 'providers');
  assert.equal(url.pathname, '/api-keys');
  assert.equal(url.searchParams.get('v'), '1');
  assert.throws(() => prepareImport({ apiKey: 'x\r\ny' }));
});

test('detects Magpie and lists models without sending a chat request', async (t) => {
  const gateway = await mockGateway(t);
  const result = await inspectGateway({ gateway: gateway.url });
  assert.equal(result.version, 'test');
  assert.deepEqual(result.models.map((m) => m.id), ['provider/model', 'provider/other']);
  assert.equal(result.models[0].context, 200000);
  assert.deepEqual(gateway.requests.map((r) => r.path), ['/api/hello', '/v1/models']);
  assert.ok(gateway.requests.every((r) => r.method === 'GET' && r.auth === 'Bearer magpie-cherrystudio'));
});

test('rejects other services, upstream errors and redirects', async () => {
  await assert.rejects(inspectGateway({}, async () => Response.json({ name: 'other' })), /不是 Magpie/);
  await assert.rejects(inspectGateway({}, async () => new Response('', { status: 401 })), /401/);
  await assert.rejects(inspectGateway({}, async (_, init) => { assert.equal(init.redirect, 'error'); throw new Error('redirect'); }), /连接不到/);
});

test('connector serves UI, requires session token, and opens only prepared links on explicit request', async (t) => {
  const gateway = await mockGateway(t);
  const opened = [];
  const service = await startServer({ port: 0, gateway: gateway.url, opener: async (url) => { opened.push(url); } });
  t.after(() => service.close());
  const page = await fetch(service.url);
  const html = await page.text();
  const token = html.match(/name="connector-token" content="([a-f0-9]+)"/)[1];
  assert.ok(page.headers.get('content-security-policy').includes('connect-src'));
  assert.equal((await fetch(`${service.url}/api/defaults`)).status, 403);
  assert.equal((await fetch(`${service.url}/api/defaults`, { headers: { 'x-cherry-connector-token': token, origin: 'https://example.com' } })).status, 403);
  const badHostStatus = await new Promise((resolve, reject) => {
    const req = httpRequest(service.url, { headers: { host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(badHostStatus, 403);
  const request = (path, body) => fetch(`${service.url}/api/${path}`, {
    method: 'POST', headers: { 'x-cherry-connector-token': token, 'content-type': 'application/json', origin: 'null' }, body: JSON.stringify(body),
  });
  const result = await request('inspect', { gateway: gateway.url });
  assert.equal(result.headers.get('access-control-allow-origin'), 'null');
  assert.equal((await result.json()).models.length, 2);
  const prepared = await (await request('prepare', { gateway: gateway.url })).json();
  assert.equal(opened.length, 0);
  assert.equal((await request('open', { id: 'not-issued' })).status, 400);
  assert.equal((await request('open', { id: prepared.id })).status, 200);
  assert.deepEqual(opened, [prepared.url]);
  assert.equal((await fetch(`${service.url}/../package.json`)).status, 404);
  assert.equal((await fetch(`${service.url}/app.js`)).status, 200);
});
