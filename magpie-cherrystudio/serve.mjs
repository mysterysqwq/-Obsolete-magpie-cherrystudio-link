import { startServer } from './lib/server.mjs';

const value = process.argv.find((arg) => arg.startsWith('--port='));
const port = value ? Number(value.slice(7)) : 3489;
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('用法：node serve.mjs [--port=3489]');
  process.exitCode = 1;
} else {
  try {
    const info = await startServer({ port });
    console.log(`Cherry Studio 连接器：${info.url}`);
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, async () => { await info.close(); process.exit(0); });
    }
  } catch (error) {
    console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用，请使用 --port=其他端口。` : error.message);
    process.exitCode = 1;
  }
}
