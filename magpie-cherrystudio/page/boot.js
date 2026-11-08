(async () => {
  const message = document.getElementById('message');
  const retry = document.getElementById('retry');
  retry.addEventListener('click', () => location.reload());
  try {
    if (!window.magpie) throw new Error('请从 Magpie 的插件页面打开连接向导。');
    const theme = await window.magpie.ready;
    const options = await window.magpie.options.get();
    const port = options.port === undefined ? 3489 : Number(options.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口设置不正确，请在插件选项中设置 port。');
    let target;
    if (window.magpie.service) target = new URL(window.magpie.service);
    else {
      const host = location.hostname;
      if (host && !['localhost', '127.0.0.1', '[::1]', 'wails.localhost'].includes(host)) {
        throw new Error('请在运行 Magpie 的电脑上打开连接器；旧版远程网页无法转发本地服务。');
      }
      target = new URL(`http://127.0.0.1:${port}/`);
    }
    if (theme?.dark) target.searchParams.set('theme', 'dark');
    setTimeout(() => {
      message.textContent = `连接服务尚未启动（端口 ${port}）。请关闭再启用此插件，或检查端口是否被占用。`;
      retry.hidden = false;
    }, 6000);
    location.replace(target.href);
  } catch (error) {
    message.textContent = error.message;
    retry.hidden = false;
  }
})();
