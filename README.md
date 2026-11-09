注意：目前magpie官方已经支持cherry studio了，故本项目没用了。

# Magpie ↔ Cherry Studio 连接器

一个无需构建、没有第三方运行时依赖的 Magpie 插件，提供两个连接方向：

- **Cherry Studio 使用 Magpie 模型**：Magpie 内的中文连接页自动检测本机网关和模型列表，生成官方服务商导入链接，打开 Cherry Studio 后确认导入。
- **Magpie 使用 Cherry Studio 模型**：注册 `cherrystudio` 服务商，通过 Cherry Studio 官方 API 网关调用它已启用的模型，不读取上游服务商密钥。

实现与验证基线：Windows 上的 **Magpie 0.1.3295**、**Cherry Studio 2.1.10**。反向模式需要 Cherry Studio 的 API 网关功能；旧版本需自行确认是否提供兼容接口。macOS/Linux 的打开应用代码已提供，尚未在对应系统实测。

## 安装

将整个插件文件夹放到准备长期保留的位置。在 **Magpie → 设置 → 插件 → 添加插件** 中选择此文件夹，或粘贴其绝对路径。安装后左侧出现 **连接 Cherry Studio**。

Windows 也可以在此文件夹中运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

或直接使用 Magpie CLI：

```powershell
& "$env:LOCALAPPDATA\Programs\magpie\magpie.com" plugin add "C:\path\to\magpie-cherrystudio"
```

本地文件夹插件从原位置加载，请保留文件夹。页面由 Magpie 的 Bun 插件宿主启动，不需要自己安装 Node.js 或 npm。Magpie 尚未准备好 Bun 时，会按自身机制准备运行环境。

## 方向一：Cherry Studio 使用 Magpie

1. 启动 Magpie，确认已添加服务商并启用了至少一个模型。
2. 在 Magpie 左侧打开 **连接 Cherry Studio**，点击 **检测网关与模型**。
3. 点击 **生成连接配置**，再点击 **打开 Cherry Studio 并导入**。
4. 在 Cherry Studio 的服务商导入窗口中确认。默认新增 ID 为 `magpie`、名称为 `Magpie` 的 OpenAI 服务商；如果已存在同 ID，Cherry Studio 会展示更新确认，请检查弹窗内容。
5. 到 **Cherry Studio → 设置 → 模型服务 → Magpie** 启用服务商，并用 **管理模型 / 同步模型 / 获取** 拉取列表，添加所需模型。
6. 返回聊天窗口选择模型。Magpie 需保持运行。

默认连接信息：

| 项目 | 值 |
| --- | --- |
| Cherry 服务商类型 | OpenAI / Chat Completions |
| API 地址 | `http://127.0.0.1:3425/v1`（自动读取 Magpie 实际端口） |
| 本机默认 API Key | `magpie-cherrystudio` |
| 模型 ID | 完整保留 Magpie 返回的 ID，如 `provider/model` |

默认 API Key 是本机调用标识，按 Magpie 官方规则将用量归到 `cherrystudio`。若网关启用了访问限制，请使用自己创建的 **Magpie 网关密钥**，不要填写上游厂商密钥。

**模型需要在 Cherry Studio 再获取一次**：官方导入协议只接受服务商信息，不接受模型列表。之后在 Magpie 增删模型，也需要在 Cherry Studio 重新同步列表。

## 方向二：Magpie 使用 Cherry Studio

1. 在 **Cherry Studio → 设置 → API 网关** 点击 **启动**。默认地址是 `http://127.0.0.1:23333/v1`。
2. 复制该页面的 **网关 API Key**，它与上游服务商密钥不同。
3. 在 **Magpie → 插件** 找到本插件的 **Cherry Studio API Gateway** 服务商并登录。填网关地址和网关密钥；端口改过时填写实际地址。
4. Magpie 会通过 `GET /v1/models` 发现该账户的模型，调用地址是 `/v1/chat/completions`。模型在 Magpie 中形如 `cherrystudio/anthropic:claude-…`。
5. 保持 Cherry Studio 运行。

也可执行：

```powershell
magpie plugin login cherrystudio
```

反向服务商只通过 Cherry 的公开网关工作。Cherry 关闭或请求失败时，插件报错，Magpie 可按自己的规则保留上次模型列表并处理故障转移。

反向自动发现**默认保证基本文本聊天**。Cherry 的公开模型列表不提供模型能力、上下文上限或思考档位，因此插件不自动宣称视觉、工具调用、推理档位或 token 上限。需要这些功能时，按实际模型能力在 Magpie 的模型设置/插件 provider 配置中补充；插件保留同 ID 的 `provider.models` 配置覆盖。不应把所有模型一律设置为支持视觉或推理。

**避免循环**：反向调用应选择 Cherry Studio 中直连上游的服务商，不要选择本插件刚导入的 Magpie 服务商。两个方向可以分别使用，但不能把同一请求在两个网关之间相互转发。

## 端口和排错

连接器自己的界面监听 **127.0.0.1:3489**，它与两个模型网关端口不同。端口冲突时，在 Magpie 的插件选项中设置：

```json
{ "port": 3488 }
```

然后关闭再启用插件。网关端口直接在连接页或反向登录时填写。

如果导入窗口不出现，先正常启动一次 Cherry Studio，让系统注册 `cherrystudio://` 协议。也可复制导入链接，用系统的 URL 打开方式打开，或者按连接页显示的信息手动新增 OpenAI 服务商。

如果连接页检测失败，确认 Magpie 正在运行、网关地址正确、所用密钥有权限。模型列表为空时，先在对应应用启用服务商及模型。

此版本专用于**同一台电脑**的两个应用，只接受 localhost、127.x.x.x、IPv6 回环地址。远程网页虽然可通过新版 Magpie 的页面服务代理显示向导，生成的回环地址仍代表 Cherry Studio 所在电脑；远程接入不在此版本范围内。

## 数据与实现

- 正向只读 Magpie 的 `settings.json` 中端口，读取 `/api/hello` 和 `/v1/models`；检测不会发送聊天请求。
- 正向的自定义网关密钥只在页面/服务进程内使用，不写进插件选项或自定义文件。生成的导入链接暂存在内存中，10 分钟后失效。
- Cherry Studio 经用户确认后将服务商与网关密钥写入它自己的配置。反向登录由 Magpie 按其账户机制保存 Cherry 网关密钥。
- 使用官方导入窗口，不读写 Cherry 的 IndexedDB、SQLite、聊天记录或其他服务商配置。
- 连接页使用每次进程启动生成的会话令牌、Host 和 Origin 检查。服务只监听回环地址，不记录完整导入链接、密钥和聊天内容。
- Base64 只是编码，导入链接和复制的 JSON 都包含网关密钥，请按密钥对待。
- 卸载插件会移除连接页和反向服务商；已确认导入的 Magpie 服务商由 Cherry Studio 管理，需要时在 Cherry 中自行移除。

官方协议依据：

- [Magpie 插件、页面服务与 provider hooks](https://usemagpie.ai/docs/plugins)
- [Magpie 本机网关、模型列表与调用标识](https://usemagpie.ai/docs/integrate)
- [Cherry Studio 2.1.10 服务商导入 schema](https://github.com/CherryHQ/cherry-studio/blob/v2.1.10/src/renderer/pages/settings/ProviderSettings/hooks/useProviderDeepLinkImport.ts)
- [Cherry Studio 2.1.10 URL 协议处理](https://github.com/CherryHQ/cherry-studio/blob/v2.1.10/src/main/services/protocol/handlers/providersImport.ts)
- [Cherry Studio 2.1.10 API 网关](https://github.com/CherryHQ/cherry-studio/blob/v2.1.10/docs/references/api-gateway/README.md)

## 开发与验证

开发需要 Node.js 20+，没有 npm 安装步骤：

```powershell
node --test test/connection.test.mjs test/cherry-provider.test.mjs test/startup.test.mjs
node serve.mjs --port=3489
```

独立运行时在浏览器打开终端显示的地址。退出用 Ctrl+C。

8 项自动验证覆盖导入链接的 Unicode/Base64 编解码、URL 校验、模型发现、访问校验、按按钮才打开应用，以及 Cherry 网关账户模型发现、模型覆盖保留、循环入口过滤、带鉴权的请求转发和端口冲突时 provider 仍可注册。应用打开用 mock 替代，测试不更改真实服务商，不调用付费模型。

另使用独立 HOME/XDG 目录在 Magpie 0.1.3295 加载插件，并通过独立 Edge 无头浏览器检查实际 Magpie 插件框架：连接页加载、网关检测、生成配置均成功，未出现浏览器脚本错误。未在真实 Cherry Studio 中确认导入或发送实际模型聊天，因此实际账户的端到端聊天仍需配置后验证。
