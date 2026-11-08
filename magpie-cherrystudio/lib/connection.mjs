import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_PORT = 3489;
export const DEFAULT_KEY = 'magpie-cherrystudio';

export function normalizeGateway(value) {
  let url;
  try { url = new URL(String(value).trim()); }
  catch { throw new Error('网关地址格式不正确，例如 http://127.0.0.1:3425'); }
  const host = url.hostname.toLowerCase();
  const local = host === 'localhost' || host === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(host);
  if (!local || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('此版本只连接本机 Magpie，请使用 localhost、127.0.0.1 或 [::1]。');
  }
  if (url.username || url.password || url.search || url.hash || !['', '/', '/v1', '/v1/'].includes(url.pathname)) {
    throw new Error('请填写网关根地址或 /v1 地址，不要包含凭据、参数或其他路径。');
  }
  return { root: url.origin, baseUrl: `${url.origin}/v1` };
}

export async function discoverGateway({ env = process.env, home = homedir() } = {}) {
  if (env.MAGPIE_ADDR) {
    try { return normalizeGateway(/^https?:\/\//.test(env.MAGPIE_ADDR) ? env.MAGPIE_ADDR : `http://${env.MAGPIE_ADDR}`).root; }
    catch { /* A wildcard bind address is not a client address. Use settings below. */ }
  }
  const dir = env.XDG_CONFIG_HOME ? join(env.XDG_CONFIG_HOME, 'magpie') : join(home, '.config', 'magpie');
  try {
    const settings = JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'));
    const port = Number(settings.port);
    if (Number.isInteger(port) && port > 0 && port <= 65535) return `http://127.0.0.1:${port}`;
  } catch { /* Magpie defaults to 3425 when no settings file exists. */ }
  return 'http://127.0.0.1:3425';
}

function cleanText(value, fallback = '', max = 240) {
  return typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, max) : fallback;
}

export function connectionFields(input = {}) {
  const gateway = normalizeGateway(input.gateway || 'http://127.0.0.1:3425');
  const apiKey = input.apiKey === undefined || input.apiKey === '' ? DEFAULT_KEY : input.apiKey;
  if (typeof apiKey !== 'string' || apiKey.length > 4096 || /[\x00-\x1f\x7f]/.test(apiKey)) {
    throw new Error('API Key 格式不正确。');
  }
  return { ...gateway, apiKey, name: cleanText(input.name, 'Magpie') || 'Magpie' };
}

async function fetchJSON(url, apiKey, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { authorization: `Bearer ${apiKey}`, 'user-agent': 'MagpieCherryStudio/0.1.0' },
      signal: AbortSignal.timeout(8000), redirect: 'error',
    });
  } catch {
    throw new Error('连接不到 Magpie。请启动 Magpie，并检查网关端口。');
  }
  if (!response.ok) throw new Error(`Magpie 返回 HTTP ${response.status}。请检查网关权限和 API Key。`);
  const text = await response.text();
  if (text.length > 4 * 1024 * 1024) throw new Error('网关返回的模型列表过大。');
  try { return JSON.parse(text); }
  catch { throw new Error('网关返回的内容不是 JSON，请检查地址是否指向 Magpie。'); }
}

export async function inspectGateway(input = {}, fetchImpl = fetch) {
  const fields = connectionFields(input);
  const hello = await fetchJSON(`${fields.root}/api/hello`, fields.apiKey, fetchImpl);
  if (String(hello.name).toLowerCase() !== 'magpie') throw new Error('该地址不是 Magpie 网关。');
  const catalog = await fetchJSON(`${fields.baseUrl}/models`, fields.apiKey, fetchImpl);
  if (!Array.isArray(catalog.data)) throw new Error('模型列表格式不正确。');
  const seen = new Set();
  const models = catalog.data.filter((m) => {
    if (!m || typeof m.id !== 'string' || !m.id || m.id.length > 512 || /[\x00-\x1f\x7f]/.test(m.id) || seen.has(m.id)) return false;
    seen.add(m.id);
    return !m.kind || m.kind === 'chat';
  }).slice(0, 5000).map((m) => ({
    id: m.id, name: cleanText(m.display_name || m.name, m.id) || m.id,
    provider: cleanText(m.owned_by),
    context: Number.isSafeInteger(m.context_window) && m.context_window > 0 ? m.context_window : null,
  }));
  return { gateway: fields.root, baseUrl: fields.baseUrl, version: cleanText(hello.version), models };
}

export function prepareImport(input = {}) {
  const fields = connectionFields(input);
  const provider = {
    id: 'magpie', name: fields.name, type: 'openai',
    baseUrl: fields.baseUrl, apiKey: fields.apiKey,
  };
  const data = encodeURIComponent(Buffer.from(JSON.stringify(provider), 'utf8').toString('base64'));
  return { provider, url: `cherrystudio://providers/api-keys?v=1&data=${data}` };
}
