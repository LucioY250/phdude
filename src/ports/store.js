/**
 * @typedef {object} Store
 * @property {(id: string) => Promise<object|null>} readEntity
 * @property {(obj: object) => Promise<string>} writeEntity
 * @property {(type: string) => Promise<object[]>} listEntities
 * @property {() => Promise<object>} readProject
 * @property {(cfg: object) => Promise<void>} writeProject
 * @property {(relPath: string) => Promise<object|null>} readYaml
 * @property {(relPath: string) => Promise<Buffer|null>} readBytes
 * @property {(relPath: string, obj: object) => Promise<void>} writeYamlAtomic
 * @property {(relPath: string, text: string) => Promise<void>} writeTextAtomic
 * @property {(relPath: string, bytes: Buffer|Uint8Array) => Promise<void>} writeBytesAtomic
 * @property {(relPath: string) => Promise<void>} ensureDir
 * @property {(evt: object) => Promise<void>} appendEvent
 * @property {(limit?: number) => Promise<object[]>} readEvents
 * @property {(artId: string) => string} cacheDir
 * @property {() => Promise<string[]>} listCacheEntries
 * @property {(artId: string) => Promise<string|null>} readCacheText
 * @property {(relPath: string) => Promise<boolean>} exists
 */
export default {};
