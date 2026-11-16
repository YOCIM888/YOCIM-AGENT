import { describe, expect, it } from 'vitest'
import {
  buildRemoteCommandLine,
  buildSshArgs,
  buildWslArgs,
  decodeWslOutput,
  isWslUncPath,
  joinRemotePath,
  normalizeRemoteRoot,
  parseWslDistroList,
  parseWslUncPath,
  shellQuote,
  toWslUncPath
} from '../../src/main/remote/command'
import { formatHostFingerprint, readHostKeyType } from '../../src/main/remote/sshClient'
import { createWslExec } from '../../src/main/remote/wslExec'
import { RemotePathGuard } from '../../src/main/workspace/pathGuard'

function utf16(text: string): Buffer {
  const body = Buffer.from(text, 'utf16le')
  return Buffer.concat([Buffer.from([0xff, 0xfe]), body])
}

describe('decodeWslOutput', () => {
  it('decodes UTF-16LE output with BOM', () => {
    expect(decodeWslOutput(utf16('Ubuntu-22.04\r\nDebian\r\n'))).toBe('Ubuntu-22.04\r\nDebian\r\n')
  })

  it('decodes UTF-16LE without BOM when NUL bytes dominate odd positions', () => {
    const raw = Buffer.from('Ubuntu\r\n', 'utf16le')
    expect(decodeWslOutput(raw)).toContain('Ubuntu')
  })

  it('keeps UTF-8 text as-is', () => {
    expect(decodeWslOutput(Buffer.from('WSL 版本: 2.0.9\n'))).toBe('WSL 版本: 2.0.9\n')
  })
})

describe('parseWslDistroList', () => {
  it('trims lines, drops blanks and BOM', () => {
    expect(parseWslDistroList('\uFEFFUbuntu-22.04\r\n\r\ndocker-desktop\r\n')).toEqual([
      'Ubuntu-22.04',
      'docker-desktop'
    ])
  })

  it('returns an empty list for empty output', () => {
    expect(parseWslDistroList('\r\n')).toEqual([])
  })
})

describe('normalizeRemoteRoot', () => {
  it('normalizes slashes and trailing separators', () => {
    expect(normalizeRemoteRoot('/home/me/app/')).toBe('/home/me/app')
    expect(normalizeRemoteRoot('//home//me///app')).toBe('/home/me/app')
    expect(normalizeRemoteRoot('/')).toBe('/')
  })

  it('rejects relative paths and home shortcuts', () => {
    expect(() => normalizeRemoteRoot('home/me')).toThrowError(/绝对路径/)
    expect(() => normalizeRemoteRoot('~/app')).toThrowError(/绝对路径/)
    expect(() => normalizeRemoteRoot('   ')).toThrowError(/不能为空/)
  })
})

describe('WSL path mapping', () => {
  it('maps linux paths to UNC and back', () => {
    const unc = toWslUncPath('Ubuntu-22.04', '/home/me/app')
    expect(unc.toLowerCase()).toBe('\\\\wsl.localhost\\ubuntu-22.04\\home\\me\\app')
    expect(parseWslUncPath(unc)).toEqual({ distro: 'Ubuntu-22.04', linuxPath: '/home/me/app' })
  })

  it('handles the distro root and the legacy \\\\wsl$ prefix', () => {
    expect(parseWslUncPath('\\\\wsl.localhost\\Ubuntu')).toEqual({
      distro: 'Ubuntu',
      linuxPath: '/'
    })
    expect(parseWslUncPath('\\\\wsl$\\Debian\\srv\\app')).toEqual({
      distro: 'Debian',
      linuxPath: '/srv/app'
    })
    expect(parseWslUncPath('C:\\work\\app')).toBeNull()
    expect(isWslUncPath('\\\\wsl.localhost\\Ubuntu\\home')).toBe(true)
    expect(isWslUncPath('\\\\server\\share')).toBe(false)
  })

  it('maps only the same distro back to a linux path', () => {
    const exec = createWslExec({ distro: 'Ubuntu', rootPath: '/home/me/app' })
    expect(exec.toRemotePath('\\\\wsl.localhost\\Ubuntu\\home\\me\\app\\src')).toBe(
      '/home/me/app/src'
    )
    expect(exec.toRemotePath('\\\\wsl.localhost\\Debian\\home\\me\\app')).toBeNull()
    expect(exec.toRemotePath('C:\\work\\app')).toBeNull()
    expect(exec.toRemotePath(null)).toBeNull()
  })
})

describe('shell quoting and command lines', () => {
  it('quotes only when needed and escapes single quotes', () => {
    expect(shellQuote('main.js')).toBe('main.js')
    expect(shellQuote('/home/me/app')).toBe('/home/me/app')
    expect(shellQuote('my file.txt')).toBe("'my file.txt'")
    expect(shellQuote("it's")).toBe("'it'\\''s'")
    expect(shellQuote('')).toBe("''")
  })

  it('renders a full command line for remote exec', () => {
    expect(buildRemoteCommandLine('git', ['status', '--short'])).toBe('git status --short')
    expect(buildRemoteCommandLine('rg', ['--glob', '*.ts'])).toBe("rg --glob '*.ts'")
  })
})

describe('buildWslArgs', () => {
  it('uses --cd/--exec so arguments never pass through a shell', () => {
    expect(
      buildWslArgs({
        distro: 'Ubuntu',
        cwd: '/home/me/app/',
        command: 'npm',
        args: ['run', 'build']
      })
    ).toEqual(['-d', 'Ubuntu', '--cd', '/home/me/app', '--exec', 'npm', 'run', 'build'])
  })

  it('omits --cd when no cwd is given', () => {
    expect(buildWslArgs({ distro: 'Debian', command: 'true', args: [] })).toEqual([
      '-d',
      'Debian',
      '--exec',
      'true'
    ])
  })
})

describe('buildSshArgs', () => {
  it('builds BatchMode args with optional port and cwd', () => {
    expect(
      buildSshArgs({
        host: 'example.com',
        port: 2222,
        username: 'me',
        command: 'git status',
        cwd: '/srv/app'
      })
    ).toEqual([
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=yes',
      '-p',
      '2222',
      'me@example.com',
      'cd /srv/app && git status'
    ])
  })

  it('skips the port flag for 22 and quotes only when needed', () => {
    expect(buildSshArgs({ host: 'h', port: 22, username: 'u', command: 'uptime' })).toEqual([
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=yes',
      'u@h',
      'uptime'
    ])
  })
})

describe('joinRemotePath', () => {
  it('joins relative paths under the remote root', () => {
    expect(joinRemotePath('/srv/app', 'src/main.ts')).toBe('/srv/app/src/main.ts')
    expect(joinRemotePath('/srv/app', './src/main.ts')).toBe('/srv/app/src/main.ts')
    expect(joinRemotePath('/srv/app', '')).toBe('/srv/app')
    expect(joinRemotePath('/', 'etc/hosts')).toBe('/etc/hosts')
  })

  it('rejects parent traversal', () => {
    expect(() => joinRemotePath('/srv/app', '../etc/passwd')).toThrowError(/上级目录/)
    expect(() => joinRemotePath('/srv/app', 'src/../../x')).toThrowError(/上级目录/)
  })
})

describe('SSH 指纹', () => {
  const keyType = Buffer.from('ssh-ed25519', 'ascii')
  const keyBody = Buffer.alloc(4)
  keyBody.writeUInt32BE(keyType.length, 0)
  const publicKey = Buffer.concat([keyBody, keyType, Buffer.from([1, 2, 3, 4, 5])])

  it('formats OpenSSH-style SHA256 fingerprints without padding', () => {
    const fingerprint = formatHostFingerprint(publicKey)
    expect(fingerprint.startsWith('SHA256:')).toBe(true)
    expect(fingerprint).not.toContain('=')
  })

  it('reads the key algorithm from the wire format', () => {
    expect(readHostKeyType(publicKey)).toBe('ssh-ed25519')
    expect(readHostKeyType(Buffer.from([0, 0]))).toBe('unknown')
    expect(readHostKeyType(Buffer.from([0, 0, 0, 99]))).toBe('unknown')
  })
})

describe('RemotePathGuard', () => {
  it('normalizes relative paths without touching the filesystem', async () => {
    const guard = new RemotePathGuard('target-1')
    expect(guard.root.startsWith('.yocim-remote/')).toBe(true)
    await expect(guard.resolve('src/main.ts')).resolves.toEqual({
      absolutePath: `${guard.root}/src/main.ts`,
      relativePath: 'src/main.ts'
    })
    await expect(guard.resolve('')).resolves.toMatchObject({ relativePath: '.' })
  })

  it('rejects traversal and absolute paths', async () => {
    const guard = new RemotePathGuard('target-1')
    await expect(guard.resolve('../etc')).rejects.toThrowError(/上级目录/)
    await expect(guard.resolve('/etc/passwd')).rejects.toThrowError(/绝对路径/)
  })
})
