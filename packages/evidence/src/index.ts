import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { openDatabase } from './db/database.js';
import { migrate } from './db/migrate.js';
import { ArtifactStore } from './cas/artifact-store.js';
import { Projects } from './repos/projects.js';
import { Artifacts } from './repos/artifacts.js';
import { Targets } from './repos/targets.js';
import { Events } from './repos/events.js';
import { Steps } from './repos/steps.js';
import { Jobs } from './repos/jobs.js';
import { Observations, EvidenceRefs } from './repos/observations.js';
import { Findings } from './repos/findings.js';
import { Relations } from './repos/relations.js';
import { Invocations } from './repos/invocations.js';
import { evidenceReader } from './repos/evidence.js';
import { storageError } from './db/database.js';
export async function createEvidenceStore(options: { dataDir: string; readOnly?: boolean }) {
  const directory = resolve(options.dataDir);
  try {
    if (!options.readOnly) await mkdir(directory, { recursive: true });
  } catch (error) {
    throw storageError(error);
  }
  const db = openDatabase(join(directory, 'phoenix.db'), options);
  try {
    migrate(db, join(directory, 'backups'), undefined, options.readOnly);
    const projects = new Projects(db),
      artifactRecords = new Artifacts(db),
      targets = new Targets(db, artifactRecords),
      events = new Events(db),
      steps = new Steps(db),
      observations = new Observations(db),
      evidenceRefs = new EvidenceRefs(db),
      relations = new Relations(db),
      invocations = new Invocations(db);
    const artifacts = new ArtifactStore(join(directory, 'artifacts'), artifactRecords, options.readOnly);
    const findings = new Findings(db, evidenceRefs, artifacts, targets, observations),
      jobs = new Jobs(db, events, steps);
    const repos = {
      projects,
      artifacts: artifactRecords,
      targets,
      events,
      steps,
      observations,
      evidenceRefs,
      findings,
      relations,
      invocations,
      jobs,
    };
    let closed = false;
    return {
      db,
      artifacts,
      repos,
      evidence: evidenceReader(db, targets, observations, findings, artifactRecords),
      async close(): Promise<void> {
        if (!closed) {
          await artifacts.close();
          db.close();
          closed = true;
        }
      },
    };
  } catch (error) {
    db.close();
    throw storageError(error);
  }
}
export type EvidenceStore = Awaited<ReturnType<typeof createEvidenceStore>>;
export * from './db/database.js';
export * from './db/migrate.js';
export * from './cas/artifact-store.js';
export type { EventDraft } from './repos/events.js';
export type { Invocation } from './repos/invocations.js';
export type { Relation, EntityType } from './repos/relations.js';
