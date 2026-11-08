import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { DEFAULT_PORT, DEFAULT_KEY, discoverGateway, inspectGateway, prepareImport } from './connection.mjs';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);
const TOKEN_HEADER = 'x-cherry-connector-token';

export async function openCherry(url) {
  if (!url.startsWith('cherrystudio://providers/api-keys?v=1&data=')) throw new Error('无效的导入链接。');
  const [cmd, args] = process.platform === 'win32'
    ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { shell: false, windowsHide: true, stdio: 'ignore' });
    child.once('error', () => reject(new Error('无法打开 Cherry Studio，请确认已安装，或复制导入链接手动打开。')));
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error('系统未能打开 Cherry Studio，请复制导入链接手动打开。')));
  });
}

function sameSecret(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function bodyJSON(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16 * 1024) throw new Error('请求过大。');
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch { throw new Error('请求必须是 JSON 对象。'); }
}

export async function startServer({ port = DEFAULT_PORT, gateway, fetchImpl = fetch, opener = openCherry } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('连接器端口必须是 1–65535 的整数。');
  const token = randomBytes(32).toString('hex');
  const defaultGateway = gateway || await discoverGateway();
  const prepared = new Map();
  let origin;
  let hosts;
  const server = createServer(async (req, res) => {
    const send = (status, data, type = 'application/json; charset=utf-8', extra = {}) => {
      res.writeHead(status, {
        'content-type': type, 'cache-control': 'no-store',
        'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...extra,
      });
      res.end(typeof data === 'string' ? data : JSON.stringify(data));
    };
    if (!hosts?.has(String(req.headers.host || '').toLowerCase())) return send(403, { error: 'Host 不被允许。' });
    const requestOrigin = req.headers.origin;
    const allowedOrigin = !requestOrigin || requestOrigin === 'null' || requestOrigin === origin || requestOrigin === origin?.replace('127.0.0.1', 'localhost');
    const pathname = new URL(req.url, origin).pathname;
    if (req.method === 'OPTIONS') {
      if (!allowedOrigin) return send(403, { error: '来源不被允许。' });
      return send(204, '', 'text/plain', {
        'access-control-allow-origin': requestOrigin || origin,
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': `content-type, ${TOKEN_HEADER}`, 'vary': 'Origin',
      });
    }
    if (pathname.startsWith('/api/')) {
      if (!allowedOrigin || !sameSecret(req.headers[TOKEN_HEADER], token)) return send(403, { error: '连接器会话已失效，请重新打开连接页。' });
      if (requestOrigin) {
        res.setHeader('access-control-allow-origin', requestOrigin);
        res.setHeader('vary', 'Origin');
      }
      try {
        if (req.method === 'GET' && pathname === '/api/defaults') {
          return send(200, { gateway: defaultGateway, apiKey: DEFAULT_KEY, name: 'Magpie' });
        }
        if (req.method !== 'POST') return send(405, { error: '不支持的请求方法。' });
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) return send(415, { error: '请使用 application/json。' });
        const input = await bodyJSON(req);
        if (pathname === '/api/inspect') return send(200, await inspectGateway(input, fetchImpl));
        if (pathname === '/api/prepare') {
          const result = prepareImport(input);
          const id = randomBytes(16).toString('hex');
          const now = Date.now();
          for (const [key, item] of prepared) if (item.expires < now) prepared.delete(key);
          if (prepared.size >= 32) prepared.delete(prepared.keys().next().value);
          prepared.set(id, { url: result.url, expires: now + 10 * 60 * 1000 });
          return send(200, { ...result, id });
        }
        if (pathname === '/api/open') {
          const item = prepared.get(input.id);
          if (!item || item.expires < Date.now()) return send(400, { error: '导入链接已失效，请重新生成。' });
          await opener(item.url);
          return send(200, { opened: true, message: '已请求系统打开 Cherry Studio，请在 Cherry Studio 确认导入。' });
        }
        return send(404, { error: '接口不存在。' });
      } catch (error) {
        return send(400, { error: error.message || '操作失败，请重试。' });
      }
    }
    if (req.method !== 'GET') return send(405, { error: '不支持的请求方法。' });
    const asset = assets.get(pathname);
    if (!asset) return send(404, { error: '页面不存在。' });
    try {
      let text = await readFile(new URL(`../ui/${asset[0]}`, import.meta.url), 'utf8');
      if (pathname === '/') text = text.replace('__CONNECTOR_TOKEN__', token);
      return send(200, text, asset[1], {
        'content-security-policy': [
          "default-src 'none'", `script-src 'self' ${origin}`, `style-src 'self' ${origin}`,
          `connect-src 'self' ${origin}`, "img-src data:", "base-uri 'none'", "form-action 'none'",
        ].join('; '),
      });
    } catch { return send(500, { error: '连接器页面读取失败，请重新安装插件。' }); }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const actualPort = server.address().port;
      origin = `http://127.0.0.1:${actualPort}`;
      hosts = new Set([`127.0.0.1:${actualPort}`, `localhost:${actualPort}`]);
      resolve();
    });
  });
  return {
    server, url: origin, port: server.address().port,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeIdleConnections?.();
    }),
  };
}
