import { arch, machine, release } from 'node:os';
import { readFile } from 'node:fs/promises';
import { HostInfo, PhoenixError } from '@phoenix/contracts';
import type { CpuArch, ProcessRunner } from '@phoenix/contracts';

export interface HostDetectionOptions {
  platform?: string;
  arch?: string;
  machine?: string;
  osRelease?: string;
  nodeVersion?: string;
  env?: Readonly<NodeJS.ProcessEnv>;
  readProcVersion?: () => Promise<string>;
  /** Optional explicitly authorized helper; host detection never spawns by default. */
  processRunner?: ProcessRunner;
}
export function mapCpuArch(value: string): CpuArch {
  const mapping: Readonly<Record<string, CpuArch>> = {
    ia32: 'x86',
    x86: 'x86',
    i386: 'x86',
    i686: 'x86',
    x64: 'x64',
    x86_64: 'x64',
    amd64: 'x64',
    arm: 'arm',
    arm64: 'arm64',
    aarch64: 'arm64',
    riscv64: 'riscv64',
    wasm32: 'wasm32',
  };
  return mapping[value.toLowerCase()] ?? (value === '' ? 'unknown' : 'other');
}
export async function detectHost(
  phoenixVersion: string,
  options: HostDetectionOptions = {},
): Promise<HostInfo> {
  const platform = options.platform ?? process.platform;
  const os =
    platform === 'win32'
      ? 'windows'
      : platform === 'darwin'
        ? 'macos'
        : platform === 'linux'
          ? 'linux'
          : undefined;
  if (os === undefined) throw new PhoenixError('HOST_INCOMPATIBLE', 'Unsupported host operating system');
  const cpu = mapCpuArch(options.arch ?? arch());
  const kernelCpu = mapCpuArch(options.machine ?? machine());
  const env = options.env ?? process.env;
  let isWsl = false;
  let translated: boolean | undefined;
  if (os === 'linux') {
    isWsl = Boolean(env['WSL_DISTRO_NAME']) || Boolean(env['WSL_INTEROP']);
    try {
      isWsl ||= /microsoft/i.test(
        await (options.readProcVersion ?? (() => readFile('/proc/version', 'utf8')))(),
      );
    } catch {
      /* Optional kernel metadata. */
    }
  }
  if (os === 'windows') {
    const native = env['PROCESSOR_ARCHITEW6432'] ?? env['PROCESSOR_ARCHITECTURE'];
    if (native !== undefined) translated = mapCpuArch(native) !== cpu;
  } else if (os === 'macos') {
    if (kernelCpu === 'arm64' && cpu !== 'arm64') translated = true;
    if (options.processRunner !== undefined) {
      try {
        const result = await options.processRunner.runProcess({
          file: '/usr/sbin/sysctl',
          args: ['-n', 'sysctl.proc_translated'],
          cwd: '/',
          timeoutMs: 1000,
          maxOutputBytes: 128,
          signal: AbortSignal.timeout(1500),
        });
        if (result.exitCode === 0) translated = Buffer.from(result.stdout).toString().trim() === '1';
      } catch {
        /* Missing or disallowed translation probe: unknown. */
      }
    }
  }
  return HostInfo.parse({
    os,
    arch: cpu,
    osRelease: options.osRelease ?? release(),
    nodeVersion: options.nodeVersion ?? process.version,
    isWsl,
    phoenixVersion,
    ...(translated === undefined ? {} : { translated }),
  });
}
