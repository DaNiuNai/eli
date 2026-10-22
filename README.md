# eli

基于 Electron、React 和 TypeScript 的 pi 桌面客户端，使用
`@earendil-works/pi-coding-agent` 提供的 `RpcClient` 启动 RPC 子进程。

## 对话功能

- 复用本机 pi 的模型、登录与配置，在界面中选择可用模型。
- 支持多轮对话、流式回复、Markdown、代码复制、思考过程和工具调用结果。
- 支持停止生成、新建对话，以及选择工作目录。
- 输入区可切换全局工具审批挡位，保存在应用配置中，默认“请求批注”：只读工具自动放行，
  其余调用等待用户审批；“批准编辑”仅自动放行 `read`、`write`、`edit`；红色“全部放行”直接执行所有工具。
  只读工具包括 `read`、`grep`、`find`、`ls` 以及明确声明 `readOnlyHint` 的扩展工具，Shell 命令仍需审批。
  审批卡片显示工具名和完整参数，可拒绝或允许本次；后台会话在侧栏显示待审批图标。
  提高权限会立即放行符合新挡位的待审批调用；停止、重连及关闭会清理待审批请求。
- 模型可调用 `ask_user_question` 在对话内展示提问卡片，随消息滚动：一次 1–4 题，每题 2–4 个选项，支持单选、
  多选和“其他”自定义答案。`header` 最多 12 字符；推荐项放在首位，标签以 `(推荐)` 结尾。
  单选选项可提供 Markdown `preview`，卡片会显示左右预览区；多选不支持预览。
  提交后将问题、选择和选中预览作为工具结果返回，模型继续处理；切换会话保留填写内容和当前题目。
  停止、断线或关闭应用会清理待回答请求，提问本身无需额外工具审批。
- 左侧按工作目录分组显示本机 pi 历史会话，支持搜索和恢复，Ctrl+B 收起或展开侧栏。
- 用量概览支持全部、最近 30 天和最近 7 天，展示活跃会话、消息、Token、热力图和模型分布。
- 输入区支持选择模型和该模型实际支持的思考强度；切换会话时分别保留当前运行期间的草稿。
- 思考强度通过滑块弹窗调整；右下角圆环显示 pi 返回的上下文占用估算，可点击查看明细。
  用量每 5 秒及会话刷新时同步；压缩后暂时未知的用量显示“等待更新”。
- RPC 中断后可重新连接，恢复当前已经持久化的 pi 会话。
- Enter 发送，Shift + Enter 换行；中文输入法确认候选词不会发送消息。
- 输入 `/` 弹出命令和当前 pi 会话的技能列表，继续输入可按名称或描述筛选。
  使用 ↑/↓ 选择，Tab、Enter 或点击条目将 `/skill:名称` 补全到输入框；补充任务后再按 Enter 发送。
  Esc 或点击输入框外关闭列表；没有技能和加载失败时分别显示提示，失败后可重试。
- 发送 `/settings` 打开现有设置面板并清空该命令；也可从 `/` 列表中补全。
  此命令由桌面端处理，无需可用模型，不会作为对话消息发送给 pi。
- 发送 `/compact` 手动压缩当前对话上下文，也可附带要求，例如 `/compact 保留代码修改和待办事项`。
  压缩需要可用模型和空闲会话，通过 pi 专用接口执行；期间显示状态、支持停止，完成后刷新上下文用量。
  没有可压缩的历史内容或刚完成压缩时显示普通提示，可继续对话；真正失败时才报错并恢复命令草稿。

运行前需要系统可执行的 Node.js（至少 22.19，建议使用现有的 Node.js 24），
并先在 pi 命令行中完成登录或模型配置。可以在仓库内运行 `pnpm exec pi`。
不需要另外安装全局 pi，也不需要在桌面应用中再次填写密钥。

开发模式默认以仓库目录作为工作目录；打包后默认使用系统文档目录，
可通过侧栏或输入区上方的目录按钮选择项目。切换目录会开始新的对话。
会话由 pi 按其原生规则保存在本机；点击历史会话会恢复消息和对应工作目录。
重新启动应用会开启新会话，历史记录仍可从侧栏继续。运行中的任务需先停止，才能切换会话。

统计来源是 pi 官方索引中的本地会话 JSONL，仅读取、不修改历史文件。
对话消息数包含用户与助手消息；Token 包含输入、输出、缓存读写，以及文件中记录的
压缩、分支摘要、工具和缓存预热用量。相同条目 ID、时间与类型的继承记录会去重，
优先归属最早的会话，避免克隆或分叉重复计数。活跃会话指所选时段内有独立消息或用量的会话。
日期和活跃时段按本机时区计算，最近 7/30 天包含今天；费用直接汇总 pi 记录中的美元费用，
未记录的用量或费用不会估算。热力图展示最近 26 周，且受所选时间范围过滤。
会话切换、回复完成后会刷新统计；外部 pi 客户端产生的变化可通过侧栏刷新按钮重新读取。

首版支持文字输入，不包含图片附件、登录设置页或扩展交互对话框。
需要 `select`、`confirm`、`input` 或 `editor` 的扩展应在 pi 命令行中使用；
桌面端会提示此限制。

## 应用设置

eli 的主题、界面语言、侧栏展开状态，以及工作目录和会话的排序统一保存在
`~/.pi/eli/config.json`，Windows 下为用户目录中的 `.pi\eli\config.json`。
主进程在启动时读取配置，文件不存在时自动创建默认配置；界面改动立即应用并写入该文件。
退出前会等待已提交的写入完成。旧版前端本地存储不再读取或迁移。

默认配置如下，关闭应用后可手动编辑，重新启动生效：

```json
{
  "theme": "system",
  "language": "zh-CN",
  "sidebarOpen": true,
  "sidebarOrder": {
    "workspaces": [],
    "sessions": {}
  }
}
```

`theme` 支持 `system`、`light`、`dark`，`language` 支持 `zh-CN`、`en`。
配置项省略时使用默认值；JSON 或配置值格式错误时提示文件位置并停止启动，保留原文件。
写入通过临时文件替换完成，保存失败会在界面提示。

## 实现结构

- `src/main/pi-service.ts`：官方 RPC 客户端的生命周期、事件处理与 IPC 校验。
- `src/main/pi-library.ts`：历史会话索引、流式用量解析、文件缓存与去重。
- `src/main/app-config.ts`：应用配置的启动读取、串行写入与文件替换。
- `src/shared/app-preferences.ts`：统一的设置类型、默认值、校验与 IPC 契约。
- `src/shared/pi-library.ts`：会话元数据、统计数据契约与时间范围聚合。
- `src/shared/pi.ts`：复用 pi 的消息、模型与事件类型，定义桌面端 IPC 接口。
- `src/shared/user-question.ts`：提问参数、答案校验与工具结果文本。
- `src/main/user-questions.ts`：待回答请求、会话答复和连接清理。
- `resources/tool-approval.ts`：工具审批钩子和 `ask_user_question` 工具注册。
- `src/shared/pi-messages.ts`：按 RPC 的增量事件重建流式消息。
- `src/preload/`：通过 `contextBridge` 暴露有限的对话方法，不暴露通用 IPC。
- `src/renderer/src/`：使用现有 shadcn 组件实现对话界面。
- `src/renderer/src/lib/slash-commands.ts`：桌面端 `/` 命令注册表，统一管理列表、匹配、参数与执行条件。

新增桌面端命令时，在 `slashCommandRegistry` 注册名称、描述、图标、参数模式和执行函数即可。
`parameters` 支持 `none`、`optional`、`required`，可用 `argumentHint` 描述参数；
`requirements` 可声明是否需要会话、连接、可用模型、空闲状态或可用工作目录，未声明表示不需要。
执行函数可通过上下文调用界面操作或 `api` IPC 方法，支持异步操作；执行期间禁止重复提交，
失败时显示错误并恢复命令草稿。普通消息与 `/skill:名称` 继续由 pi 处理。

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

在桌面窗口中检查模型列表、思考强度、发送与停止、Markdown 显示、新建对话和重连；
检查历史搜索、同目录与跨目录恢复、忙碌时禁止切换、7/30 天统计、模型分布、
深浅色主题，以及最小窗口下的侧栏与输入区布局。
让模型调用 `ask_user_question`，检查单选、多选、“其他”输入、推荐标签和 Markdown 预览；
确认提问卡片显示在对话消息中、随对话滚动，切换会话后答案和当前题目保留；
提交后模型能收到答案并继续，停止后待回答卡片被清理。
