import { target, id, time, type fixture } from '../helpers.js';
export function seedQueryRows(f: Awaited<ReturnType<typeof fixture>>, count: number): void {
  const previous = Number(f.store.db.get('SELECT count(*) n FROM artifacts')?.['n']);
  f.store.db.transaction(() => {
    for (let i = previous; i < count; i++) {
      const artifact = id('art'),
        hash = i.toString(16).padStart(64, '0');
      // Metadata-only rows are intentional query fixtures, never factual evidence.
      f.store.db.run(
        'INSERT INTO artifacts VALUES (?,?,?,?,?)',
        artifact,
        hash,
        0,
        'application/octet-stream',
        time,
      );
      if (i % 2 === 0) {
        const t = target(f.project.id, {
          localPath: `/query-fixture/${String(i)}`,
          artifactId: artifact,
          sha256: hash,
          digest: { algorithm: 'sha256', value: hash },
        });
        f.store.db.run(
          'INSERT INTO targets VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          t.id,
          t.projectId,
          t.kind,
          t.classification.format,
          'file',
          t.localPath ?? '',
          'reference',
          'sha256',
          hash,
          artifact,
          null,
          null,
          JSON.stringify(t),
          time,
        );
      }
    }
  });
}
