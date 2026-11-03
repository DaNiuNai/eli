import type {
  ModelsStore,
  ModelsStoreEntry,
  ModelsStoreOperationOptions
} from '@earendil-works/pi-ai'
import { JsonStore } from '../config/store'

/** 延续 models-store.json 的 provider -> entry 格式。 */
export class FileModelsStore implements ModelsStore {
  private readonly store: JsonStore<Record<string, ModelsStoreEntry>>
  constructor(path: string) {
    this.store = new JsonStore(path, (value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('模型缓存格式无效')
      for (const item of Object.values(value)) {
        if (!item || !Array.isArray(item.models)) throw new Error('模型缓存条目格式无效')
      }
      return value as Record<string, ModelsStoreEntry>
    })
  }
  async read(
    id: string,
    options?: ModelsStoreOperationOptions
  ): Promise<ModelsStoreEntry | undefined> {
    options?.signal?.throwIfAborted()
    return (await this.store.read())[id]
  }
  async write(
    id: string,
    entry: ModelsStoreEntry,
    options?: ModelsStoreOperationOptions
  ): Promise<void> {
    await this.store.update((data) => {
      data[id] = entry
    }, options?.signal)
  }
  async delete(id: string, options?: ModelsStoreOperationOptions): Promise<void> {
    await this.store.update((data) => {
      delete data[id]
    }, options?.signal)
  }
}
