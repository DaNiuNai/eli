# ixov

An Electron application with React and TypeScript

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
