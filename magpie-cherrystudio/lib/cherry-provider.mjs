import { normalizeGateway } from './connection.mjs';

const PROVIDER = 'cherrystudio';
const DEFAULT_BASE = 'http://127.0.0.1:23333/v1';

function accountBase(auth) {
  const value = String(auth?.metadata?.gateway || '').trim() || DEFAULT_BASE;
  try { return normalizeGateway(value).baseUrl; }
  catch { throw new Error('Cherry Studio API 网关地址不正确，请填写本机地址，例如 http://127.0.0.1:23333/v1。'); }
}

export function cherryProviderHooks() {
  return {
    config: async (cfg) => {
      cfg.provider ??= {};
      cfg.provider[PROVIDER] ??= {
        name: 'Cherry Studio API Gateway', npm: '@ai-sdk/openai-compatible', api: DEFAULT_BASE, models: {},
      };
    },
    auth: {
      provider: PROVIDER,
      methods: [{
        type: 'api', label: 'Cherry Studio 网关 API Key', placeholder: '在 Cherry Studio 的 API 网关设置中复制',
        prompts: [{
          type: 'text', key: 'gateway', message: 'Cherry Studio API 网关地址', placeholder: DEFAULT_BASE,
          validate: (value) => {
            if (!value?.trim()) return undefined;
            try { normalizeGateway(value); return undefined; }
            catch { return '请填写本机 HTTP(S) 根地址或 /v1 地址。'; }
          },
        }],
      }],
      async loader(getAuth) {
        const auth = await getAuth();
        if (auth?.type !== 'api') return {};
        const baseURL = accountBase(auth);
        return {
          baseURL,
          async fetch(input, init) {
            const request = new Request(input, init);
            if (!request.url.startsWith(`${baseURL}/`)) throw new Error('Cherry Studio 请求地址不属于已配置的网关。');
            const headers = new Headers(request.headers);
            headers.set('authorization', `Bearer ${auth.key}`);
            return fetch(new Request(request, { headers, redirect: 'error' }));
          },
        };
      },
    },
    provider: {
      id: PROVIDER,
      async models(provider, { auth } = {}) {
        if (auth?.type !== 'api') return provider.models;
        const baseURL = accountBase(auth);
        const response = await fetch(`${baseURL}/models`, {
          headers: { authorization: `Bearer ${auth.key}` }, redirect: 'error', signal: AbortSignal.timeout(8000),
        });
        if (response.status === 401 || response.status === 403) {
          throw Object.assign(new Error('Cherry Studio 网关拒绝了 API Key，请重新填写网关密钥。'), { signIn: 'expired' });
        }
        if (!response.ok) throw new Error(`Cherry Studio 模型列表返回 HTTP ${response.status}。`);
        const { data } = await response.json();
        if (!Array.isArray(data)) throw new Error('Cherry Studio 返回的模型列表格式不正确。');
        const entries = data.filter((model) => model && typeof model.id === 'string'
          && model.id.length > 0 && model.id.length <= 512
          && !/[\x00-\x1f\x7f]/.test(model.id)
          && !model.id.toLowerCase().startsWith('magpie:')).map((model) => [model.id, {
          ...provider.models?.[model.id],
          id: model.id, name: provider.models?.[model.id]?.name || (typeof model.name === 'string' ? model.name : model.id),
          api: { id: model.id, url: baseURL, npm: '@ai-sdk/openai-compatible' },
        }]);
        return Object.fromEntries(entries);
      },
    },
  };
}
