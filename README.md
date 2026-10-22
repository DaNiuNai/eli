<div align="center">
  <h1>eli</h1>
  <p><strong>专注对话，从容完成任务。</strong></p>
  <p>基于 pi SDK 的桌面 Agent，让对话与工作空间井然有序。</p>
  <p>Windows · macOS · Linux</p>
</div>

![eli 界面预览](docs/images/eli-preview.webp)

---

## 让工作更顺手

- **流畅对话** · 实时呈现回复，随时停止生成。
- **自由选择** · 切换可用模型，按需调整思考强度。
- **有序管理** · 按工作目录整理对话，搜索历史，接续之前的任务。
- **自主掌控** · 选择工具审批方式，查看操作详情后决定是否允许。
- **用量清晰** · 查看近期活跃情况、模型分布与用量趋势。
- **舒适体验** · 支持浅色、深色与跟随系统主题，提供中英文界面。

## 开始之前

首次打开 eli，可在「设置 → 模型供应商」中配置 API Key 或完成订阅 / OAuth 授权。应用内置 pi SDK 和 Electron 运行时，无需安装 pi CLI、Node.js 或准备 `~/.pi`。终端选择位于「设置 → 通用」。

首次登录或跳过登录后，可选择命令执行终端。Windows 默认使用 PowerShell，macOS 默认使用 zsh，Linux 默认使用 bash；也支持自动检测已安装终端和填写自定义路径。

设置面板统一管理 eli 的界面、模型、上下文、网络、工具和资源配置。

“模型供应商”页支持搜索内置供应商、添加兼容供应商、启停、编辑 API 地址、同步模型，以及手动添加、编辑和停用模型。自定义供应商支持 OpenAI Completions / Responses、Anthropic Messages、Google Generative AI 协议。同步接口未返回模型能力时使用可编辑的默认值；SDK 内置供应商优先使用 SDK 的模型目录与同步逻辑。

API Key 与订阅凭据各保存一份，互不覆盖；“使用的认证方式”决定请求使用哪一份。API Key 的“已保存”不表示在线验证成功，订阅的“已授权”表示 eli 保存了 OAuth 凭据，令牌续期由 SDK 执行。退出一种登录方式不会删除另一份，也不会静默回退。订阅模式始终使用官方认证地址，不会把订阅令牌发送到自定义 API 地址。

认证解析不读取环境变量或外部凭据文件。密钥按字面值保存和使用，不进行环境变量替换或命令求值；界面不回显已保存的密钥。只有依赖外部凭据发现且没有 SDK 登录接口的供应商会标为不支持此配置方式。

打开 eli，选择工作目录和模型，即可开始对话。历史会话保存在本机，随时可以回来继续。

## 独立数据与资源

所有应用数据位于 `~/.eli`，Windows 对应用户目录下的 `.eli`：

| 路径                                 | 用途                                            |
| ------------------------------------ | ----------------------------------------------- |
| `config.json`                        | 界面、侧栏、审批挡位与终端偏好                  |
| `settings.json`                      | 模型默认值、压缩、网络、工具和资源设置          |
| `auth.json`                          | 分槽保存 API Key 与 OAuth 凭据，使用 SDK 文件锁 |
| `providers.json`                     | 供应商启停、认证方式、API 地址与模型覆盖        |
| `models.json`、`models-store.json`   | 自定义模型和模型目录缓存                        |
| `sessions/<工作目录标识>/`           | SDK 原生会话树与用量记录                        |
| `images/`                            | 粘贴图片的持久化副本                            |
| `desktop/`                           | Electron 界面缓存与本地存储                     |
| `extensions/`、`skills/`、`prompts/` | 自动加载的用户级扩展、技能、提示词模板          |
| `mcp.json`、`mcp-auth.json`          | MCP 服务定义与独立认证                          |

工作目录中的 `.eli/settings.json` 覆盖用户级设置；`.eli/extensions/`、`.eli/skills/`、`.eli/prompts/` 也会自动加载。项目代码扩展会在对应 Runtime 中执行，因此应了解所打开项目中的扩展内容。扩展支持直接 `.ts`/`.js`/`.mjs`/`.cjs` 文件及带 `index.ts`、`index.js`、`index.mjs` 的一级子目录；额外路径在 `settings.json` 中配置，相对路径以该配置文件所在目录为基准。资源数组合并加载，技能与模板同名时先加载的用户级资源优先。

设置页的供应商配置保存在用户级 `providers.json`；用户级 `models.json` 与扩展仍可提供显式的模型定义和字面密钥，设置页可覆盖启停与模型配置。MCP 服务读取用户级与项目 `.eli/mcp.json`，项目中的同名完整服务定义覆盖用户级定义。包安装和 CLI 专属配置不属于 eli 的设置界面；本地扩展可直接使用 SDK API。

项目上下文依次读取用户级 `AGENTS.md`、工作目录各级父目录的 `AGENTS.md`、项目 `.eli/AGENTS.md`。项目 `.eli/SYSTEM.md` 优先于用户级 `SYSTEM.md`；两个位置的 `APPEND_SYSTEM.md` 顺序追加。不会自动发现 `.pi`、`.agents` 等其他工具的配置或资源。

本次是全新数据体系，不迁移或共用旧版 `~/.pi` 中的登录、设置和历史。设置更改用于后续请求；正在运行的任务继续使用启动时配置。

## Runtime 架构

React → Electron IPC → 主进程桥接 → eli 版本化消息协议 → 独立 Agent Runtime。

每个活跃用户会话拥有一个 Electron `utilityProcess`。Runtime 直接创建 SDK `AgentSession`，管理会话、工具权限、提问、资源与执行；主进程管理窗口、进程生命周期和当前视图。后台会话继续独立运行，空闲五分钟释放进程，下一次操作从原会话文件恢复。账号、设置、历史索引使用单独的管理进程。

SDK 提供消息流、工具执行与取消、会话树、压缩、重试和认证。eli 不使用 pi CLI/RPC，也没有 TCP 审批旁路。主／子 Agent、团队协作、计划模式和新的自动审批策略未在本次实现；`RuntimeCoordinator`、`ToolPolicy` 与协议中的 `agentId` 提供后续扩展位置。

## 开发与验证

使用 Node.js 24 和 pnpm，安装依赖后手动运行 `pnpm dev`。常规检查：

```powershell
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm test:electron
pnpm build:unpack
```

`pnpm test` 使用 Node.js 内置 `node:test`，构建后启动真实 Runtime 子进程和本机模拟模型服务，覆盖资源隔离、模型范围及扩展模型、流式消息与上下文用量、历史恢复与分叉、审批、提问、压缩取消和崩溃。供应商测试覆盖环境凭据隔离、双认证槽、OAuth 刷新、登录取消、供应商管理和模型同步。主进程会话测试还覆盖初始化、审批配置更新和进程替换之间的竞态。数据和虚拟凭据仅写入 `.tmp`，不调用真实模型服务。受限沙箱需要允许本机回环连接。

`pnpm test:electron` 验证实际 Electron utility process 与 SDK 扩展加载，不打开界面；临时 profile 在 Electron 完全退出后清理。Windows 打包后可进一步执行：

```powershell
pnpm test:electron dist/win-unpacked/resources/app.asar/out/main/runtime.mjs
```

SDK 固定为 `1.3.0`。未从包根导出的文件存储、显式扩展加载和模板解析集中在 `src/runtime/sdk-adapter.ts`；升级 SDK 时需运行上述回归与打包检查。
