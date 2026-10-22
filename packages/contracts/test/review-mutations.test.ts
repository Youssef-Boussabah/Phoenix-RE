import { describe, expect, it } from 'vitest';
import * as c from '../src/index.js';
import { job, fixtures, id, event, timestamp } from './fixtures.js';

// The eleven surviving Opus mutations, independent of generated snapshots.
describe('Opus surviving semantic mutations', () => {
  it('1 ProviderDescriptor.id must have the dotted provider ID format', () => {
    for (const value of ['phoenix.fileinfo', 'ghidra.headless', 'a.b-c'])
      expect(
        c.ProviderDescriptor.safeParse({ ...(fixtures['ProviderDescriptor'] as object), id: value }).success,
      ).toBe(true);
    for (const value of ['', 'fileinfo', 'Phoenix.fileinfo', 'a..b', 'a/b', '.a'])
      expect(
        c.ProviderDescriptor.safeParse({ ...(fixtures['ProviderDescriptor'] as object), id: value }).success,
      ).toBe(false);
  });
  it('2 IntakeSource accepts HTTP(S), never arbitrary URI protocols', () => {
    for (const url of ['http://example.com', 'https://example.com/a?b=c'])
      expect(c.IntakeSource.safeParse({ type: 'url', url }).success).toBe(true);
    for (const url of [
      'file:///home/alice/a',
      'javascript:alert(1)',
      'ftp://example.com/a',
      'ssh://example.com/a',
      'data:text/plain,hi',
      'mailto:user@example.com',
    ])
      expect(c.IntakeSource.safeParse({ type: 'url', url }).success).toBe(false);
  });
  it('3 objectives must contain 1 through 4000 characters in jobs and create inputs', () => {
    for (const objective of ['x', 'x'.repeat(4000)]) {
      expect(c.Job.safeParse({ ...job, objective }).success).toBe(true);
      expect(
        c.CreateJobInput.safeParse({ ...(fixtures['CreateJobInput'] as object), objective }).success,
      ).toBe(true);
    }
    for (const objective of ['', 'x'.repeat(4001)]) {
      expect(c.Job.safeParse({ ...job, objective }).success).toBe(false);
      expect(
        c.CreateJobInput.safeParse({ ...(fixtures['CreateJobInput'] as object), objective }).success,
      ).toBe(false);
    }
  });
  it('4 PageInput.limit is a safe integer from 1 through 5000', () => {
    for (const limit of [1, 100, 5000]) expect(c.PageInput.safeParse({ limit }).success).toBe(true);
    for (const limit of [0, -1, 5001, 1.5, Infinity, NaN])
      expect(c.PageInput.safeParse({ limit }).success).toBe(false);
    expect(c.PageInput.parse({}).limit).toBe(100);
  });
  it('5 ToolInvokeInput.target is exactly a target ID or a nonempty local path', () => {
    for (const target of [{ path: 'x' }, { targetId: id('tgt') }])
      expect(c.ToolInvokeInput.safeParse({ operation: 'inspect_target', target }).success).toBe(true);
    for (const target of [
      {},
      { arbitrary: true },
      { path: '' },
      { targetId: id('job') },
      { path: 'x', targetId: id('tgt') },
      { path: 'x', extra: true },
    ])
      expect(c.ToolInvokeInput.safeParse({ operation: 'inspect_target', target }).success).toBe(false);
  });
  it('6 Locator rejects unknown fields for every locator variant', () => {
    for (const locator of [
      { type: 'byte-range', offset: 0, length: 1 },
      { type: 'path', path: 'a' },
      { type: 'address', address: '0x1' },
      { type: 'event', sequence: 0 },
      { type: 'region', x: 0, y: 0, width: 1, height: 1 },
    ]) {
      expect(c.Locator.safeParse(locator).success).toBe(true);
      expect(c.Locator.safeParse({ ...locator, extra: true }).success).toBe(false);
    }
  });
  it('7 StepStatus must include cancelled', () => {
    expect(c.StepStatus.parse('cancelled')).toBe('cancelled');
    expect(c.StepStatus.safeParse('canceled').success).toBe(false);
    expect(
      c.JobStep.safeParse({ ...(fixtures['JobStep'] as object), status: 'cancelled', finishedAt: timestamp })
        .success,
    ).toBe(true);
  });
  it('8 TargetKind must include android', () => {
    expect(c.TargetKind.parse('android')).toBe('android');
    expect(c.TargetKind.safeParse('apk').success).toBe(false);
  });
  it('9 ErrorCode must include STORAGE_ERROR', () => {
    expect(c.ErrorCode.parse('STORAGE_ERROR')).toBe('STORAGE_ERROR');
    expect(c.ErrorCode.safeParse('SQLITE_ERROR').success).toBe(false);
    expect(new c.PhoenixError('STORAGE_ERROR', 'unreadable').toShape().code).toBe('STORAGE_ERROR');
  });
  it('10 HostInfo.isWsl is required and boolean', () => {
    for (const isWsl of [true, false])
      expect(c.HostInfo.safeParse({ ...(fixtures['HostInfo'] as object), isWsl }).success).toBe(true);
    const { isWsl: omitted, ...missing } = c.HostInfo.parse(fixtures['HostInfo']);
    expect(omitted).toBe(false);
    expect(c.HostInfo.safeParse(missing).success).toBe(false);
    expect(c.HostInfo.safeParse({ ...missing, isWsl: 'false' }).success).toBe(false);
  });
  it('11 step_failed.attempt is a positive safe integer', () => {
    const input = (attempt: number) => ({
      ...event,
      type: 'step_failed',
      payload: {
        stepKey: 'fingerprint',
        attempt,
        error: { code: 'INTERNAL', message: 'error', retryable: false },
        willRetry: false,
      },
    });
    for (const attempt of [1, 2, 3]) expect(c.JobEvent.safeParse(input(attempt)).success).toBe(true);
    for (const attempt of [-1, 0, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(c.JobEvent.safeParse(input(attempt)).success).toBe(false);
  });
});

it('pins committed enumerations to literal product requirements', () => {
  expect(c.TargetKind.options).toEqual([
    'web',
    'electron',
    'source',
    'elf',
    'pe',
    'macho',
    'android',
    'dotnet',
    'wasm',
    'unknown',
  ]);
  expect(c.JobMode.options).toEqual(['investigate', 'reconstruct', 'verify']);
  expect(c.JobState.options).toEqual([
    'created',
    'fingerprinting',
    'ready',
    'planning',
    'investigating',
    'reconstructing',
    'verifying',
    'completed',
    'partial',
    'failed',
    'cancelled',
  ]);
  expect(c.FindingStatus.options).toEqual(['hypothesis', 'observed', 'corroborated', 'contradicted']);
  expect(c.RelationType.options).toEqual([
    'calls',
    'imports',
    'derived_from',
    'supports',
    'contradicts',
    'produced_by',
    'tests',
    'implements',
    'observed_in',
    'supersedes',
  ]);
  expect(c.ErrorCode.options).toEqual([
    'INVALID_REQUEST',
    'NOT_FOUND',
    'TARGET_UNREADABLE',
    'TARGET_CHANGED',
    'NOT_SUPPORTED',
    'PROVIDER_UNAVAILABLE',
    'HOST_INCOMPATIBLE',
    'POLICY_DENIED',
    'TIMEOUT',
    'CANCELLED',
    'OUTPUT_LIMIT_EXCEEDED',
    'PROVIDER_FAILED',
    'PROVIDER_OUTPUT_INVALID',
    'INVALID_STATE_TRANSITION',
    'CONFLICT',
    'BUDGET_EXHAUSTED',
    'STEP_RETRIES_EXHAUSTED',
    'STORAGE_ERROR',
    'MIGRATION_FAILED',
    'MIGRATION_CHECKSUM_MISMATCH',
    'DB_SCHEMA_TOO_NEW',
    'UNAUTHORIZED',
    'INTERNAL',
  ]);
  expect(c.StepStatus.options).toEqual(['pending', 'running', 'succeeded', 'failed', 'cancelled']);
  expect(c.HostOs.options).toEqual(['windows', 'macos', 'linux']);
  expect(c.CpuArch.options).toEqual(['x86', 'x64', 'arm', 'arm64', 'riscv64', 'wasm32', 'other', 'unknown']);
  expect(c.FileFormat.options).toEqual([
    'elf',
    'pe',
    'macho',
    'macho-fat',
    'wasm',
    'dex',
    'apk',
    'asar',
    'zip',
    'jar',
    'java-class',
    'html',
    'text',
    'empty',
    'directory',
    'url',
    'unknown',
  ]);
  expect(c.OperationId.options).toEqual([
    'inspect_target',
    'list_modules',
    'list_functions',
    'decompile_function',
    'get_references',
    'get_call_graph',
    'inspect_assets',
    'trace_runtime',
    'run_experiment',
    'capture_interface',
  ]);
  expect(c.BudgetName.options).toEqual(['maxWallClockMs', 'maxToolCalls']);
  expect(c.TerminalJobState.options).toEqual(['completed', 'partial', 'failed', 'cancelled']);
});
