import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

test('a second host still registers Cherry provider when the page service port is already occupied', async (t) => {
  const owner = createServer((_, res) => res.end('occupied'));
  await new Promise((resolve) => owner.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => owner.close(resolve)));
  const { default: plugin } = await import('../index.mjs');
  const hooks = await plugin.server({}, { port: owner.address().port });
  assert.equal(hooks.auth.provider, 'cherrystudio');
  assert.equal(typeof hooks.config, 'function');
});
