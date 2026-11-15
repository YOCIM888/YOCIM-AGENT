import { inflateRawSync } from 'node:zlib'
import { AppError } from '../../shared/errors'
import { EXTENSION_LIMITS } from '../../shared/ipcChannels'

export interface ZipEntry {
  name: string
  data: Buffer
}

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50

function findEndOfCentralDirectory(buffer: Buffer): number {
  const min = Math.max(0, buffer.length - 66_000)
  for (let offset = buffer.length - 22; offset >= min; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset
  }
  return -1
}

/**
 * 最小 zip 读取器（.vsix 是标准 zip）。
 * 只支持 stored(0) / deflate(8) 且不支持 zip64 —— VSIX 包均满足。
 * 不依赖第三方库，避免为一次解压引入 yauzl。
 */
export function readZipEntries(buffer: Buffer): ZipEntry[] {
  const eocd = findEndOfCentralDirectory(buffer)
  if (eocd < 0) throw new AppError('E_INVALID_INPUT', 'VSIX 不是合法的 zip 文件')

  const entryCount = buffer.readUInt16LE(eocd + 10)
  const centralOffset = buffer.readUInt32LE(eocd + 16)
  if (entryCount > EXTENSION_LIMITS.maxVsixEntries) {
    throw new AppError('E_TOO_LARGE', `VSIX 条目过多（${entryCount}），超过上限`)
  }

  const entries: ZipEntry[] = []
  let totalBytes = 0
  let offset = centralOffset

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new AppError('E_INVALID_INPUT', 'VSIX 中央目录损坏')
    }
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const uncompressedSize = buffer.readUInt32LE(offset + 24)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)

    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localOffset === 0xffffffff
    ) {
      throw new AppError('E_UNSUPPORTED', '不支持 zip64 格式的 VSIX，请重新打包')
    }

    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength)
    offset += 46 + nameLength + extraLength + commentLength

    if (name.endsWith('/')) continue
    if (!name || name.includes('..') || name.startsWith('/') || /^[a-zA-Z]:/.test(name)) {
      throw new AppError('E_INVALID_INPUT', `VSIX 中包含非法路径：${name}`)
    }

    if (buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      throw new AppError('E_INVALID_INPUT', `VSIX 条目损坏：${name}`)
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const dataEnd = dataStart + compressedSize
    if (dataEnd > buffer.length) {
      throw new AppError('E_INVALID_INPUT', `VSIX 条目数据越界：${name}`)
    }

    const raw = buffer.subarray(dataStart, dataEnd)
    let data: Buffer
    if (method === 0) {
      data = Buffer.from(raw)
    } else if (method === 8) {
      data = inflateRawSync(raw)
    } else {
      throw new AppError('E_UNSUPPORTED', `VSIX 使用了不支持的压缩方式（${method}）`)
    }

    totalBytes += data.length
    if (totalBytes > EXTENSION_LIMITS.maxVsixBytes) {
      throw new AppError('E_TOO_LARGE', 'VSIX 解压后体积超过上限')
    }
    entries.push({ name, data })
  }

  return entries
}
