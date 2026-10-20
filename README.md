# ixov

基于 Electron、React 和 TypeScript 的 pi 桌面客户端，使用
`@earendil-works/pi-coding-agent` 提供的 `RpcClient` 启动 RPC 子进程。

## 对话功能

- 复用本机 pi 的模型、登录与配置，在界面中选择可用模型。
- 支持多轮对话、流式回复、Markdown、代码复制、思考过程和工具调用结果。
- 支持停止生成、新建对话，以及选择工作目录。
- RPC 中断后可重新连接，恢复当前已经持久化的 pi 会话。
- Enter 发送，Shift + Enter 换行；中文输入法确认候选词不会发送消息。

运行前需要系统可执行的 Node.js（至少 22.19，建议使用现有的 Node.js 24），
并先在 pi 命令行中完成登录或模型配置。可以在仓库内运行 `pnpm exec pi`。
不需要另外安装全局 pi，也不需要在桌面应用中再次填写密钥。

开发模式默认以仓库目录作为工作目录；打包后默认使用系统文档目录，
可通过窗口上方的目录按钮选择项目。切换目录会开始新的对话。
会话由 pi 按其原生规则保存在本机；首版尚未提供历史会话列表，
重新启动应用会开启新会话。

首版支持文字输入，不包含图片附件、登录设置页或扩展交互对话框。
需要 `select`、`confirm`、`input` 或 `editor` 的扩展应在 pi 命令行中使用；
桌面端会提示此限制。

## 实现结构

- `src/main/pi-service.ts`：官方 RPC 客户端的生命周期、事件处理与 IPC 校验。
- `src/shared/pi.ts`：复用 pi 的消息、模型与事件类型，定义桌面端 IPC 接口。
- `src/shared/pi-messages.ts`：按 RPC 的增量事件重建流式消息。
- `src/preload/`：通过 `contextBridge` 暴露有限的对话方法，不暴露通用 IPC。
- `src/renderer/src/`：使用现有 shadcn 组件实现对话界面。

渲染进程启用沙箱和上下文隔离；模型配置中的请求头不会传到界面。
打包时解包 pi 的运行文件，供系统 Node.js 启动 RPC CLI。

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ pnpm install
```

pnpm 11 及以上版本不再从 `.npmrc` 读取这些镜像和依赖提升配置。
Electron 及 electron-builder 的下载镜像配置在 `package.json` 的 `config` 中，
pnpm 的依赖提升和依赖构建许可配置在 `pnpm-workspace.yaml` 中。

### Development

```bash
$ pnpm dev
```

### Build

```bash
# For windows
$ pnpm build:win

# For macOS
$ pnpm build:mac

# For Linux
$ pnpm build:linux
```

### 验证

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm dev
```

在桌面窗口中检查模型列表、发送与停止、Markdown 显示、新建对话和重连。
