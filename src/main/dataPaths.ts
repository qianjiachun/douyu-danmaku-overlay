import { app } from 'electron'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 当同目录下 `data` 无法作为文件夹使用时（例如已有同名文件） */
const PORTABLE_DATA_DIR_FALLBACK_NAME = 'data.douyu-danmaku-overlay'

/**
 * electron-builder Windows 便携包会注入 `PORTABLE_EXECUTABLE_DIR`（exe 所在目录）。
 * 可写数据默认放在 `data/`；若该名称被占用则使用 `data.douyu-danmaku-overlay/`。
 */
export function isPortableExeDataMode(): boolean {
  const dir = process.env.PORTABLE_EXECUTABLE_DIR
  return app.isPackaged && typeof dir === 'string' && dir.trim().length > 0
}

let cachedPortableWritableDir: string | undefined

type TryDirResult = 'ok' | 'not-dir' | 'error'

function tryUseAsDataDirectory(dirPath: string): TryDirResult {
  try {
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true })
      return 'ok'
    }
    const st = statSync(dirPath)
    if (st.isDirectory()) {
      return 'ok'
    }
    return 'not-dir'
  } catch {
    return 'error'
  }
}

function resolvePortableDataDirectory(baseDir: string): string {
  const primary = join(baseDir, 'data')
  const r1 = tryUseAsDataDirectory(primary)
  if (r1 === 'ok') {
    return primary
  }

  const secondary = join(baseDir, PORTABLE_DATA_DIR_FALLBACK_NAME)
  const r2 = tryUseAsDataDirectory(secondary)
  if (r2 === 'ok') {
    if (r1 === 'not-dir') {
      console.warn(
        `[斗鱼弹幕飘屏] 程序目录下存在名为 "data" 的非文件夹，已改用 "${PORTABLE_DATA_DIR_FALLBACK_NAME}" 保存配置与缓存。`
      )
    }
    return secondary
  }

  const fallback = app.getPath('userData')
  console.warn(
    `[斗鱼弹幕飘屏] 无法在程序目录创建数据目录，已回退到用户数据目录：${fallback}`
  )
  return fallback
}

/** 配置、头像缓存等主进程可写文件的根目录 */
export function getWritableDataDirectory(): string {
  if (!isPortableExeDataMode()) {
    return app.getPath('userData')
  }
  if (cachedPortableWritableDir !== undefined) {
    return cachedPortableWritableDir
  }
  const base = process.env.PORTABLE_EXECUTABLE_DIR!.trim()
  cachedPortableWritableDir = resolvePortableDataDirectory(base)
  return cachedPortableWritableDir
}
