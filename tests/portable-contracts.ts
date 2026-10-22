// Compiled separately with types: [], DOM + ES2023 and skipLibCheck: false.
import type { ByteStream, TargetAccess, ArtifactWriter, PhoenixEngine } from '@phoenix/contracts';

declare const target: TargetAccess;
declare const writer: ArtifactWriter;
export const bytes: Promise<AsyncIterable<Uint8Array>> = target.openStream();
export const save = (stream: ByteStream) => writer.putStream(stream, 'application/octet-stream', 1024);
export type EngineContract = PhoenixEngine;
