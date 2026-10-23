import { ArtifactRef, IsoTimestamp, PhoenixError } from '@phoenix/contracts';
import { type Database } from '../db/database.js';
import { Repository, input, now } from './shared.js';
export class Artifacts extends Repository<ArtifactRef> {
  constructor(db: Database) {
    super(db, 'artifacts', ArtifactRef, 'id sha256 sizeBytes:size_bytes mediaType:media_type', 'id', false);
  }
  override insert(value: unknown): ArtifactRef {
    return this.register(value);
  }
  register(value: unknown): ArtifactRef {
    const a = input(ArtifactRef, value);
    this.db.run(
      'INSERT INTO artifacts VALUES (?, ?, ?, ?, ?) ON CONFLICT(sha256) DO NOTHING',
      a.id,
      a.sha256,
      a.sizeBytes,
      a.mediaType,
      now(),
    );
    const existing = this.byHash(a.sha256);
    if (existing?.sizeBytes !== a.sizeBytes)
      throw new PhoenixError('STORAGE_ERROR', 'Artifact metadata disagrees with stored bytes');
    return existing;
  }
  byHash(hash: string): ArtifactRef | undefined {
    const row = this.db.get('SELECT * FROM artifacts WHERE sha256=?', hash);
    if (!row) return undefined;
    if (!IsoTimestamp.safeParse(row['created_at']).success)
      throw new PhoenixError('STORAGE_ERROR', 'Invalid artifact timestamp');
    const value = Object.fromEntries(this.mapping.map((f) => [f.key, row[f.column]]));
    return inputArtifact(value);
  }
  override get(id: string): ArtifactRef {
    const row = this.db.get('SELECT sha256 FROM artifacts WHERE id=?', id);
    if (!row || typeof row['sha256'] !== 'string')
      throw new PhoenixError('NOT_FOUND', 'Artifact does not exist');
    const value = this.byHash(row['sha256']);
    if (!value) throw new PhoenixError('STORAGE_ERROR', 'Artifact record disappeared');
    return value;
  }
  override list(page: unknown = {}): ArtifactRef[] {
    // Reuse bounded ordering, but nested schemas omit the document version.
    return super.list(page).map((a) => this.get(a.id));
  }
}
function inputArtifact(value: unknown): ArtifactRef {
  try {
    return ArtifactRef.parse(value);
  } catch {
    throw new PhoenixError('STORAGE_ERROR', 'Corrupted artifact metadata');
  }
}
