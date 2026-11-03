import type { Context, Plugin } from '@deepseek-ai/cordis'
import Loader, { Group, type EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolve as resolveModule } from 'import-meta-resolve'

interface TreeConfig {
  anchor: string
  entry: EntryOptions
}
declare module '@deepseek-ai/cordis' {
  interface Context {
    dshHomePath: (...paths: string[]) => string
  }
}

/** The upstream Loader owns nested scopes, JS expression interpolation, service isolation and disposal. */
export function dshTree(root: string): Plugin<TreeConfig> {
  return {
    name: 'eli-dsh-bundle-tree',
    async apply(ctx: Context, { anchor, entry }) {
      const scope = ctx.isolate('loader').isolate('dshHomePath')
      scope.provide('dshHomePath', (...parts: string[]) => join(root, ...parts))
      class PackageLoader extends Loader {
        override import(name: string): unknown {
          if (name.startsWith('cordis:')) return super.import(name)
          return import(resolveModule(name, pathToFileURL(anchor).href))
        }
      }
      await scope.plugin(PackageLoader, { baseUrl: pathToFileURL(dirname(anchor)).href + '/' })
      const loader = scope.get('loader')!
      loader.builtins.group = class BundleGroup extends Group {
        static inject = ['loader']
      }
      loader.builtins.include = Include
      await loader.create(structuredClone(entry))
      await loader.await()
      if (!loader.store[entry.id]) throw new Error('组合包条目未挂载：' + entry.id)
      for (const child of loader.entries()) {
        // Cordis FiberState.ACTIVE is an erased const enum in Node's direct TS runtime.
        if (!child.disabled && child.fiber?.state !== 2)
          throw new Error(
            '组合包插件未能启动：' + child.options.id + '（' + child.options.name + '）'
          )
        if (!child.disabled && child.options.group && Array.isArray(child.options.config)) {
          for (const row of child.options.config)
            if (!loader.store[row.id]) throw new Error('组合包子插件未挂载：' + row.id)
        }
      }
    }
  }
}
