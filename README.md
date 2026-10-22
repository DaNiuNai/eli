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

首次打开 eli，可使用支持的账号或 API 密钥登录。应用内置 pi SDK 和 Electron 运行时，无需安装 pi CLI、Node.js 或准备 `~/.pi`。之后可在「设置 → 通用」中登录或更改终端。

首次登录或跳过登录后，可选择命令执行终端。Windows 默认使用 PowerShell，macOS 默认使用 zsh，Linux 默认使用 bash；也支持自动检测已安装终端和填写自定义路径。

设置面板统一管理 eli 的界面、模型、上下文、网络、工具和资源配置。

打开 eli，选择工作目录和模型，即可开始对话。历史会话保存在本机，随时可以回来继续。

## 独立数据与资源

所有应用数据位于 `~/.eli`，Windows 对应用户目录下的 `.eli`：

| 路径                                 | 用途                                   |
| ------------------------------------ | -------------------------------------- |
| `config.json`                        | 界面、侧栏、审批挡位与终端偏好         |
| `settings.json`                      | 模型默认值、压缩、网络、工具和资源设置 |
| `auth.json`                          | SDK 管理的账号与 API 凭据              |
| `models.json`、`models-store.json`   | 自定义模型和模型目录缓存               |
| `sessions/<工作目录标识>/`           | SDK 原生会话树与用量记录               |
| `images/`                            | 粘贴图片的持久化副本                   |
| `desktop/`                           | Electron 界面缓存与本地存储            |
| `extensions/`、`skills/`、`prompts/` | 自动加载的用户级扩展、技能、提示词模板 |
| `mcp.json`、`mcp-auth.json`          | MCP 服务定义与独立认证                 |

工作目录中的 `.eli/settings.json` 覆盖用户级设置；`.eli/extensions/`、`.eli/skills/`、`.eli/prompts/` 也会自动加载。项目代码扩展会在对应 Runtime 中执行，因此应了解所打开项目中的扩展内容。扩展支持直接 `.ts`/`.js`/`.mjs`/`.cjs` 文件及带 `index.ts`、`index.js`、`index.mjs` 的一级子目录；额外路径在 `settings.json` 中配置，相对路径以该配置文件所在目录为基准。资源数组合并加载，技能与模板同名时先加载的用户级资源优先。

模型定义由用户级 `models.json` 管理。MCP 服务读取用户级与项目 `.eli/mcp.json`，项目中的同名完整服务定义覆盖用户级定义。包安装和 CLI 专属配置不属于 eli 的设置界面；本地扩展可直接使用 SDK API。

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

`pnpm test` 使用 Node.js 内置 `node:test`，构建后启动真实 Runtime 子进程和本机模拟模型服务，覆盖资源隔离、模型范围及扩展模型、流式消息与上下文用量、历史恢复与分叉、审批、提问、压缩取消和崩溃。主进程会话测试还覆盖初始化、审批配置更新和进程替换之间的竞态。数据和虚拟凭据仅写入 `.tmp`，不调用真实模型服务。受限沙箱需要允许本机回环连接。

`pnpm test:electron` 验证实际 Electron utility process 与 SDK 扩展加载，不打开界面；临时 profile 在 Electron 完全退出后清理。Windows 打包后可进一步执行：

```powershell
pnpm test:electron dist/win-unpacked/resources/app.asar/out/main/runtime.mjs
```

SDK 固定为 `1.3.0`。未从包根导出的文件存储、显式扩展加载和模板解析集中在 `src/runtime/sdk-adapter.ts`；升级 SDK 时需运行上述回归与打包检查。
