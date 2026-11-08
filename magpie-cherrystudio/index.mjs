import { startServer } from './lib/server.mjs';
import { DEFAULT_PORT } from './lib/connection.mjs';
import { cherryProviderHooks } from './lib/cherry-provider.mjs';

let started;

export default {
  id: 'magpie-cherrystudio',
  async server(_input, options) {
    if (!started) {
      const port = options?.port === undefined ? DEFAULT_PORT : Number(options.port);
      started = startServer({ port }).catch((error) => {
        const message = error.code === 'EADDRINUSE'
          ? `连接器端口 ${port} 已在使用。另一 Magpie 宿主可能已启动连接页；若页面无法打开，请更换插件 port。`
          : '连接页启动失败，请检查插件 port（1–65535）。Cherry Studio 反向服务商仍可使用。';
        console.warn(`[magpie-cherrystudio] ${message}`);
        return null;
      });
    }
    await started;
    return cherryProviderHooks();
  },
};
