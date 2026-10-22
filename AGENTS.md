# 协作指南

## 沟通与环境

- 使用简体中文，需求存在歧义时先向用户确认。
- 在 Windows 下使用 PowerShell，优先使用 pnpm，Python 环境由 uv 管理。
- 文件采用 UTF-8、LF 和两空格缩进，格式与命名沿用项目现有约定。
- 临时文件放在 .tmp；环境信息以用户提供的内容为准，环境配置参考 .env.example。

## 项目结构

eli 基于 Electron、React、TypeScript 和 electron-vite，界面使用 Tailwind CSS 与 shadcn/ui。

- src/main：窗口、生命周期与进程通信。
- src/runtime：独立 Agent Runtime，使用 pi SDK，应用数据统一存放在 ~/.eli。
- src/preload：主进程与界面的接口，接口变更同步更新类型声明。
- src/renderer/src：界面与交互，组件放在 components，样式和图片放在 assets。
- resources 与 build：运行资源和打包配置；out 与 dist：生成产物。

## 修改与验证

- shadcn/ui 资源通过官方 CLI 管理，业务定制放在调用处或独立文件中。
- 依赖变更同步更新锁文件，下载与构建设置沿用项目现有配置。
- 功能变更完成静态检查、类型检查和构建；Runtime 变更同时完成运行时与 Electron 集成测试。
- 测试使用 Node.js 内置测试工具，放在 tests，采用 .test.mjs 后缀，使用本机模拟服务、虚拟凭据和 .tmp 临时数据。
- 开发预览由用户手动启动，界面及主进程交互由用户验证。
- 文档修改检查内容与格式。

## 提交与交付

- 每次提交聚焦一个目的，提交说明采用“类型：简短说明”。
- PR 说明变更原因、行为变化及验证结果；界面变更附截图，打包变更注明平台，相关任务关联 issue。
