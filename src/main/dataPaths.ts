import { app } from 'electron'
import { join } from 'node:path'

/**
 * electron-builder Windows 便携包会注入 `PORTABLE_EXECUTABLE_DIR`（exe 所在目录）。
 * 此时把可写数据放在该目录下的 `data/`，用户删除整个程序文件夹即可带走或清理，不在 Roaming 留配置。
 */
export function isPortableExeDataMode(): boolean {
  const dir = process.env.PORTABLE_EXECUTABLE_DIR
  return app.isPackaged && typeof dir === 'string' && dir.trim().length > 0
}

/** 配置、头像缓存等主进程可写文件的根目录 */
export function getWritableDataDirectory(): string {
  if (isPortableExeDataMode()) {
    return join(process.env.PORTABLE_EXECUTABLE_DIR!.trim(), 'data')
  }
  return app.getPath('userData')
}
