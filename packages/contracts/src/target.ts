import { z } from 'zod';
import { BoundedJsonObject } from './json.js';
import { RelativePath, ExcludePattern } from './paths.js';
export const HttpUrl = z.url({ protocol: /^https?$/ }).meta({
  'x-phoenix-runtime-constraints':
    'Only HTTP and HTTPS are permitted; generic URI syntax does not imply protocol permission',
});
import { TargetId, ProjectId, ArtifactId } from './ids.js';
import { IsoTimestamp, Sha256Hex } from './time.js';
import { HostOs, CpuArch, HostInfo } from './host.js';
// SOT §7.1, unchanged
export const TargetKind = z.enum([
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

export const FileFormat = z.enum([
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
export const ClassificationBasis = z.enum(['signature', 'structure', 'extension', 'heuristic', 'url-scheme']);
export const ClassificationSignal = z.strictObject({
  basis: ClassificationBasis,
  description: z.string(), // e.g. "magic 7f454c46 at offset 0"
  path: RelativePath.optional(), // relative path for directory signals
});
export const TargetClassification = z.strictObject({
  kind: TargetKind,
  format: FileFormat,
  signals: z.array(ClassificationSignal), // every decision is explained; never a numeric confidence (SOT §6.3)
  classifierVersion: z.string(), // bump on any rule change; part of cache keys
});

export const TargetOs = z.enum(['windows', 'macos', 'linux', 'android', 'freebsd', 'any', 'unknown']);
export const TargetPlatform = z.strictObject({
  os: TargetOs,
  osBasis: z.enum(['header', 'assumed', 'not-applicable']), // ELF OSABI=0 ⇒ linux 'assumed'
  arches: z.array(CpuArch), // >1 for fat Mach-O
  bitness: z.union([z.literal(32), z.literal(64)]).optional(),
  endianness: z.enum(['little', 'big']).optional(),
  binaryType: z.enum(['executable', 'shared-library', 'object', 'core', 'bundle', 'unknown']).optional(),
});

// Execution compatibility is information only; it is NOT permission to run anything.
export const HostCompatibility = z.strictObject({
  staticAnalysis: z.literal('supported'), // static inspection is host-independent
  nativeExecution: z.enum(['compatible', 'emulation-required', 'incompatible', 'not-applicable', 'unknown']),
  reason: z.string(),
});

export const FormatDetails = z.discriminatedUnion('format', [
  z.strictObject({
    format: z.literal('elf'),
    class: z.enum(['elf32', 'elf64']),
    data: z.enum(['lsb', 'msb']),
    osabi: z.int().nonnegative(),
    type: z.int().nonnegative(),
    machine: z.int().nonnegative(),
    entry: z.string() /* hex */,
    interpreter: z.string().optional(),
  }),
  z.strictObject({
    format: z.literal('pe'),
    machine: z.int().nonnegative(),
    magic: z.enum(['pe32', 'pe32+']),
    characteristics: z.int().nonnegative(),
    isDll: z.boolean(),
    subsystem: z.int().nonnegative(),
    sectionCount: z.int().nonnegative(),
    timeDateStamp: z.int().nonnegative(),
    hasClrHeader: z.boolean(),
  }),
  z.strictObject({
    format: z.literal('macho'),
    cpuType: z.int().min(0).max(0xffffffff),
    cpuSubtype: z.int().min(0).max(0xffffffff),
    fileType: z.int().nonnegative(),
    loadCommandCount: z.int().nonnegative(),
    flags: z.int().nonnegative(),
    bits: z.union([z.literal(32), z.literal(64)]),
  }),
  z.strictObject({
    format: z.literal('macho-fat'),
    arches: z.array(
      z.strictObject({
        cpuType: z.int().min(0).max(0xffffffff),
        cpuSubtype: z.int().min(0).max(0xffffffff),
        offset: z.int().nonnegative(),
        size: z.int().nonnegative(),
      }),
    ),
  }),
  z.strictObject({ format: z.literal('wasm'), version: z.int().nonnegative() }),
  z.strictObject({ format: z.literal('dex'), version: z.string() }),
  z.strictObject({
    format: z.enum(['zip', 'jar', 'apk']),
    entryCount: z.int().nonnegative(),
    sampledEntries: z.array(z.string()),
    truncated: z.boolean(),
    zip64: z.boolean(),
  }),
  z.strictObject({
    format: z.literal('asar'),
    headerSize: z.int().nonnegative(),
    fileCount: z.int().nonnegative(),
    truncated: z.boolean(),
  }),
  z.strictObject({
    format: z.literal('java-class'),
    majorVersion: z.int().nonnegative(),
    minorVersion: z.int().nonnegative(),
  }),
  z.strictObject({
    format: z.literal('text'),
    encoding: z.enum(['ascii', 'utf-8', 'utf-8-bom']),
    shebang: z.string().optional(),
  }),
]);

export const InventorySummary = z.strictObject({
  fileCount: z.int().nonnegative(),
  directoryCount: z.int().nonnegative(),
  symlinkCount: z.int().nonnegative(),
  otherCount: z.int().nonnegative(),
  totalBytes: z.int().nonnegative(),
  truncated: z.boolean(), // limits hit ⇒ no tree digest is produced
  excluded: z.array(ExcludePattern), // e.g. ['.git'] — always reported, never silent
  formats: z.record(z.string(), z.int().nonnegative()), // histogram FileFormat → count
});

export const TargetWarning = z.strictObject({
  code: z.string(),
  message: z.string(),
  path: RelativePath.optional(),
});

export const TargetSource = z.strictObject({
  type: z.enum(['file', 'directory', 'url']),
  displayName: z.string(), // basename or URL origin+path; safe to show remotely
});

// Result of stateless inspection (`phoenix inspect`): nothing persisted, no ids.
const TargetDescriptionBase = z.strictObject({
  schemaVersion: z.literal(1),
  source: TargetSource,
  localPath: z.string().optional(), // absolute path; local transports only — stripped by any remote serializer
  url: HttpUrl.optional(),
  classification: TargetClassification,
  kind: TargetKind, // = classification.kind (kept top-level for SOT compatibility)
  platform: TargetPlatform.optional(),
  formatDetails: FormatDetails.optional(),
  digest: z
    .strictObject({ algorithm: z.enum(['sha256', 'phoenix-tree-sha256-v1']), value: Sha256Hex })
    .optional(),
  sha256: Sha256Hex.optional(), // SOT field: = digest.value when algorithm === 'sha256'
  sizeBytes: z.int().nonnegative().optional(),
  inventory: InventorySummary.optional(),
  compatibility: HostCompatibility,
  warnings: z.array(TargetWarning),
  inspectedAt: IsoTimestamp,
  inspectedOn: HostInfo,
});

const consistentDescription = (t: z.infer<typeof TargetDescriptionBase>) =>
  t.kind === t.classification.kind &&
  (t.sha256 === undefined || (t.digest?.algorithm === 'sha256' && t.sha256 === t.digest.value)) &&
  (t.digest?.algorithm !== 'sha256' || t.sha256 === t.digest.value) &&
  !(t.inventory?.truncated && t.digest !== undefined) &&
  (t.source.type === 'url') === (t.url !== undefined) &&
  (t.digest === undefined ||
    (t.source.type === 'file' && t.digest.algorithm === 'sha256') ||
    (t.source.type === 'directory' && t.digest.algorithm === 'phoenix-tree-sha256-v1'));
export const TargetDescription = TargetDescriptionBase.refine(
  consistentDescription,
  'kind, digest and sha256 must agree; truncated inventories have no digest',
);

// Persisted, immutable. SOT §7.1 fields are all present with SOT meaning (+ clarifications).
export const TargetManifest = TargetDescription.safeExtend({
  id: TargetId,
  projectId: ProjectId,
  uri: z.union([
    z.string().regex(/^(?:phoenix:artifact\/art_[0-9a-f]{32}|phoenix:target\/tgt_[0-9a-f]{32}\/source)$/),
    HttpUrl,
  ]),
  hostOs: HostOs, // SOT field: OS of the host that performed intake (= inspectedOn.os)
  intakeMode: z.enum(['snapshot', 'reference']),
  artifactId: ArtifactId.optional(), // snapshot of a file target
  inventoryArtifactId: ArtifactId.optional(), // directory inventory document (JSON) in CAS
  supersedes: TargetId.optional(), // previous manifest for the same source with a different digest
  createdAt: IsoTimestamp,
  metadata: BoundedJsonObject,
})
  .refine((t) => t.hostOs === t.inspectedOn.os, 'hostOs must match inspectedOn.os')
  .refine(
    (t) =>
      t.uri.startsWith('phoenix:target/')
        ? t.uri === `phoenix:target/${t.id}/source`
        : t.uri.startsWith('phoenix:artifact/')
          ? t.artifactId !== undefined && t.uri === `phoenix:artifact/${t.artifactId}`
          : t.source.type === 'url' && t.uri === t.url,
    'manifest URI must identify its associated target, artifact or URL',
  );

export const InventoryEntry = z.strictObject({
  path: RelativePath, // POSIX separators, relative, NFC-normalized for display/sort
  type: z.enum(['file', 'directory', 'symlink', 'other']),
  sizeBytes: z.int().nonnegative().optional(),
  sha256: Sha256Hex.optional(),
  format: FileFormat.optional(),
});

export const IntakeSource = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('path'), path: z.string().min(1) }),
  z.strictObject({ type: z.literal('url'), url: HttpUrl }),
]);
export const IntakeOptions = z.strictObject({
  exclude: z.array(ExcludePattern).default(['.git']),
  maxEntries: z.int().positive().default(50_000),
  maxTotalBytes: z
    .int()
    .nonnegative()
    .default(4 * 1024 ** 3),
  maxSnapshotBytes: z
    .int()
    .nonnegative()
    .default(2 * 1024 ** 3),
});
export const InventoryDocument = z.strictObject({
  schemaVersion: z.literal(1),
  entries: z.array(InventoryEntry),
});

export type TargetKind = z.infer<typeof TargetKind>;

export type FileFormat = z.infer<typeof FileFormat>;

export type ClassificationBasis = z.infer<typeof ClassificationBasis>;

export type ClassificationSignal = z.infer<typeof ClassificationSignal>;

export type TargetClassification = z.infer<typeof TargetClassification>;

export type TargetOs = z.infer<typeof TargetOs>;

export type TargetPlatform = z.infer<typeof TargetPlatform>;

export type HostCompatibility = z.infer<typeof HostCompatibility>;

export type FormatDetails = z.infer<typeof FormatDetails>;

export type InventorySummary = z.infer<typeof InventorySummary>;

export type TargetWarning = z.infer<typeof TargetWarning>;

export type TargetSource = z.infer<typeof TargetSource>;

export type InventoryEntry = z.infer<typeof InventoryEntry>;

export type IntakeSource = z.infer<typeof IntakeSource>;

export type IntakeOptions = z.infer<typeof IntakeOptions>;

export type InventoryDocument = z.infer<typeof InventoryDocument>;

export type TargetDescription = z.infer<typeof TargetDescription>;
export type TargetManifest = z.infer<typeof TargetManifest>;

export type HttpUrl = z.infer<typeof HttpUrl>;
