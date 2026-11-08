(() => {
  const $ = (id) => document.getElementById(id);
  const token = document.querySelector('meta[name="connector-token"]').content;
  const base = new URL('.', location.href);
  let models = [];
  let prepared = null;
  let checked = false;
  let generation = 0;

  async function api(path, body) {
    const response = await fetch(new URL(`api/${path}`, base), {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'x-cherry-connector-token': token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }
  const input = () => ({ gateway: $('gateway').value.trim(), name: $('name').value.trim(), apiKey: $('api-key').value });
  const say = (id, text, error = false) => { $(id).textContent = text; $(id).classList.toggle('error', error); };
  function invalidate() {
    generation++;
    checked = false;
    prepared = null;
    $('prepare').disabled = true;
    $('prepared').hidden = true;
    $('catalog').hidden = true;
    say('status', '配置已更改，请重新检测。');
    say('import-status', '');
  }
  for (const id of ['gateway', 'name', 'api-key']) $(id).addEventListener('input', invalidate);
  function renderModels() {
    const query = $('search').value.toLowerCase().trim();
    const list = models.filter((m) => `${m.id} ${m.name}`.toLowerCase().includes(query));
    $('model-list').replaceChildren();
    for (const model of list.slice(0, 150)) {
      const row = document.createElement('div');
      row.className = 'model';
      const name = document.createElement('b');
      name.textContent = model.name;
      const id = document.createElement('code');
      id.textContent = model.id;
      row.append(name, id);
      $('model-list').append(row);
    }
    $('model-count').textContent = `${models.length} 个可用模型${query ? ` · 匹配 ${list.length} 个` : ''}`;
    if (list.length > 150) {
      const more = document.createElement('p');
      more.className = 'hint';
      more.textContent = '显示前 150 项，请搜索定位模型。';
      $('model-list').append(more);
    }
  }
  $('search').addEventListener('input', renderModels);
  $('inspect').addEventListener('click', async () => {
    const requestGeneration = ++generation;
    $('inspect').disabled = true;
    $('prepare').disabled = true;
    checked = false;
    prepared = null;
    $('prepared').hidden = true;
    $('catalog').hidden = true;
    say('status', '正在检测网关与模型…');
    say('import-status', '');
    try {
      const result = await api('inspect', input());
      if (requestGeneration !== generation) return;
      models = result.models;
      checked = true;
      $('prepare').disabled = false;
      renderModels();
      $('catalog').hidden = false;
      say('status', `已连接 Magpie ${result.version || ''}${models.length ? '' : '。暂时没有模型，请先在 Magpie 启用服务商和模型。'}`);
    } catch (error) { if (requestGeneration === generation) say('status', error.message, true); }
    finally { $('inspect').disabled = false; }
  });
  $('prepare').addEventListener('click', async () => {
    if (!checked) return;
    const requestGeneration = generation;
    $('prepare').disabled = true;
    try {
      const result = await api('prepare', input());
      if (requestGeneration !== generation) return;
      prepared = result;
      $('base-url').textContent = prepared.provider.baseUrl;
      $('prepared').hidden = false;
      say('import-status', '配置已生成。点击打开 Cherry Studio 后，在应用中确认导入。');
    } catch (error) { if (requestGeneration === generation) say('import-status', error.message, true); }
    finally { $('prepare').disabled = !checked; }
  });
  $('open-cherry').addEventListener('click', async () => {
    if (!prepared) return;
    $('open-cherry').disabled = true;
    try { say('import-status', (await api('open', { id: prepared.id })).message); }
    catch (error) { say('import-status', error.message, true); }
    finally { $('open-cherry').disabled = false; }
  });
  async function copy(value) {
    try { await navigator.clipboard.writeText(value); }
    catch {
      const text = document.createElement('textarea');
      text.value = value;
      text.className = 'copy-buffer';
      document.body.append(text);
      text.focus(); text.select();
      const ok = document.execCommand('copy');
      text.remove();
      if (!ok) { window.prompt('请手动复制：', value); return; }
    }
    say('import-status', '已复制。');
  }
  $('copy-link').addEventListener('click', () => prepared && copy(prepared.url).catch((e) => say('import-status', e.message, true)));
  $('copy-config').addEventListener('click', () => prepared && copy(JSON.stringify(prepared.provider, null, 2)).catch((e) => say('import-status', e.message, true)));
  api('defaults').then((defaults) => {
    $('gateway').value = defaults.gateway;
    $('api-key').value = defaults.apiKey;
    $('name').value = defaults.name;
    say('status', '启动 Magpie 后，点击检测即可。');
  }).catch((error) => say('status', error.message, true));
  if (new URLSearchParams(location.search).get('theme') === 'dark') document.documentElement.dataset.theme = 'dark';
})();
