import { z } from 'zod';
export const HostOs = z.enum(['windows', 'macos', 'linux']); // supported host OSes (D-005)
export const CpuArch = z.enum(['x86', 'x64', 'arm', 'arm64', 'riscv64', 'wasm32', 'other', 'unknown']);
export const HostInfo = z.strictObject({
  os: HostOs,
  arch: CpuArch,
  osRelease: z.string(),
  nodeVersion: z.string(),
  isWsl: z.boolean(), // Linux under WSL (affects later runner eligibility)
  translated: z.boolean().optional(), // macOS Rosetta / Windows-on-ARM emulation, when detectable
  phoenixVersion: z.string(),
});

export type HostOs = z.infer<typeof HostOs>;

export type CpuArch = z.infer<typeof CpuArch>;

export type HostInfo = z.infer<typeof HostInfo>;
