import type { RequestId, JobId } from './ids.js';
import type { HostInfo } from './host.js';
import type { TargetManifest, TargetDescription, InventoryEntry } from './target.js';
import type { ExecutionPolicy } from './job.js';
import type { ArtifactRef } from './artifact.js';
import type { EvidenceDraft } from './evidence.js';
import type {
  AnalysisRequest,
  ProviderDescriptor,
  ProviderAvailability,
  CapabilityReport,
  PageInfo,
  ToolWarning,
} from './provider.js';

/** Portable byte streams accept Node Readable async iterators without a Node type dependency. */
export type ByteStream = AsyncIterable<Uint8Array>;

export interface ToolLocator {
  findExecutable(name: string): Promise<string | undefined>;
}
export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}
export interface ProcessRequest {
  file: string;
  args: readonly string[];
  cwd: string;
  timeoutMs: number;
  maxOutputBytes: number;
  signal: AbortSignal;
  env?: Readonly<Record<string, string>>;
}
export interface ProcessResult {
  exitCode: number | null;
  stdout: Uint8Array;
  stderr: Uint8Array;
  durationMs: number;
}
export interface ProcessRunner {
  runProcess(input: ProcessRequest): Promise<ProcessResult>;
}
export interface DetectContext {
  host: HostInfo;
  signal: AbortSignal;
  tools: ToolLocator;
}
export interface ProbeContext {
  host: HostInfo;
  availability: ProviderAvailability;
  policy: ExecutionPolicy;
}
export interface TargetAccess {
  readonly description: TargetManifest | TargetDescription;
  readRange(offset: number, length: number, relPath?: string): Promise<Uint8Array>;
  openStream(relPath?: string): Promise<ByteStream>;
  listInventory(
    cursor?: string,
    limit?: number,
  ): Promise<{ entries: InventoryEntry[]; nextCursor?: string; total: number }>;
  resolveLocalPath(relPath?: string): Promise<string>;
}
export interface ArtifactWriter {
  putBytes(bytes: Uint8Array, mediaType: string): Promise<ArtifactRef>;
  putStream(stream: ByteStream, mediaType: string, maxBytes: number): Promise<ArtifactRef>;
}
export interface ExecutionContext {
  requestId: RequestId;
  jobId?: JobId;
  host: HostInfo;
  policy: ExecutionPolicy;
  signal: AbortSignal;
  deadline: number;
  limits: { maxInlineBytes: number };
  target: TargetAccess;
  artifacts: ArtifactWriter;
  scratchDir: string;
  logger: Logger;
  tools: ToolLocator;
  process: ProcessRunner;
}
export interface AnalysisResult {
  status: 'ok' | 'partial';
  data: unknown;
  evidence: EvidenceDraft[];
  artifacts?: ArtifactRef[];
  page?: PageInfo;
  warnings?: ToolWarning[];
}
export interface AnalysisProvider {
  readonly id: string;
  readonly version: string;
  describe(): ProviderDescriptor;
  detect(ctx: DetectContext): Promise<ProviderAvailability>;
  probe(target: TargetManifest | TargetDescription, ctx: ProbeContext): Promise<CapabilityReport>;
  execute(request: AnalysisRequest, context: ExecutionContext): Promise<AnalysisResult>;
  close?(): Promise<void>;
}
