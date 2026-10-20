# Repository Guidelines

## 项目结构与模块职责

eli 使用 Electron、React、TypeScript 和 electron-vite，界面使用 Tailwind CSS 和 shadcn/ui。项目自带的示例页面已移除。

- `src/main/`：主进程，管理窗口、生命周期与 IPC。
- `src/preload/`：通过 `contextBridge` 暴露接口；变更接口时同步更新 `index.d.ts`。
- `src/renderer/src/`：React 界面；组件放在 `components/`，样式和图片放在 `assets/`。
- `resources/`：运行时资源；`build/`：打包图标与平台配置，并非编译输出。
- `out/`、`dist/`：生成的构建与打包产物，不提交。

## 安装、开发与构建

在仓库根目录使用 PowerShell，优先使用 pnpm：

| 命令                | 用途                               |
| ------------------- | ---------------------------------- |
| `pnpm install`      | 安装依赖并执行 Electron 安装钩子   |
| `pnpm dev`          | 启动开发模式与热更新               |
| `pnpm start`        | 预览已有构建                       |
| `pnpm lint`         | 执行 ESLint 检查                   |
| `pnpm typecheck`    | 检查主进程、预加载与渲染端类型     |
| `pnpm format`       | 格式化整个仓库，提交前检查改动范围 |
| `pnpm build`        | 类型检查并编译应用                 |
| `pnpm build:unpack` | 构建未封装为安装程序的应用目录     |
| `pnpm build:win`    | 构建 Windows 安装包                |

其他平台使用 `pnpm build:mac` 或 `pnpm build:linux`；这两个脚本未包含类型检查，需单独执行 `pnpm typecheck`。

## 代码风格与命名

遵循 `.editorconfig`：UTF-8、LF、两个空格缩进、文件末尾换行。Prettier 配置为单引号、无分号、无尾随逗号、行宽 100。

组件与组件文件使用 PascalCase；函数和变量使用 camelCase。渲染端可使用 `@renderer/` 别名。遵循现有 ESLint、React Hooks 与 React Refresh 规则。

shadcn/ui 的组件、样式和工具文件通过官方 CLI 管理，Agent 不得直接编辑这些生成文件。项目格式化命令正常包含这些文件。业务定制放在调用处或独立文件中。

## 验证与测试

目前没有测试目录、测试框架、`test` 脚本或覆盖率门槛。代码变更提交前执行 `pnpm lint`、`pnpm typecheck` 和 `pnpm build`，再用 `pnpm dev` 验证相关界面及主进程交互；涉及 IPC 时确认消息收发。

新增自动化测试前先确认框架，同时补充运行脚本与说明；建议采用 `*.test.ts` 或 `*.test.tsx` 命名。文档修改检查内容和格式即可。

## 提交与 Pull Request

建议采用 `类型: 简短说明`，例如 `feat: 添加设置页面`；每次提交聚焦一个目的。

PR 应说明变更原因、行为变化、验证命令及结果；有对应 issue 时关联，界面变更附截图，安装或打包变更注明验证平台。

## 配置与代理约束

Electron 下载配置位于 `package.json` 的 `config`，打包下载镜像另见 `electron-builder.yml`；依赖提升和构建许可位于 `pnpm-workspace.yaml`，不要迁回 `.npmrc`。调整依赖时同步更新 `pnpm-lock.yaml`。

始终使用简体中文交流；遇到需求不明确时先提问。禁止读取环境变量以及 `.env`、`.env.local` 等环境配置文件，`.env.example` 除外。若需 Python 辅助脚本，使用 `uv` 管理环境。
