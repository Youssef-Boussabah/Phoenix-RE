import { EvidenceItem, ListEvidenceInput, type Page } from '@phoenix/contracts';
import { type Database } from '../db/database.js';
import { input, read } from './shared.js';
import { type Targets } from './targets.js';
import { type Observations } from './observations.js';
import { type Findings } from './findings.js';
import { type Artifacts } from './artifacts.js';
// Separate indexed arms avoid nested OR-join scans; final DISTINCT removes overlap.
export const EVIDENCE_LIST_SQL = `SELECT DISTINCT id, type FROM (
  SELECT o.id, 'observation' type, o.target_id, o.job_id FROM observations o
  UNION ALL SELECT f.id, 'finding' type, f.target_id, f.job_id FROM findings f
  -- Unscoped artifacts remain visible globally, including orphan registrations.
  UNION ALL SELECT a.id, 'artifact' type, NULL target_id, NULL job_id FROM artifacts a
  UNION ALL SELECT t.artifact_id, 'artifact', t.id, NULL FROM targets t WHERE t.artifact_id IS NOT NULL
  UNION ALL SELECT t.inventory_artifact_id, 'artifact', t.id, NULL FROM targets t WHERE t.inventory_artifact_id IS NOT NULL
  UNION ALL SELECT t.artifact_id, 'artifact', t.id, j.id FROM targets t JOIN jobs j ON j.target_id=t.id WHERE t.artifact_id IS NOT NULL
  UNION ALL SELECT t.artifact_id, 'artifact', t.id, j.id FROM targets t JOIN jobs j ON j.candidate_target_id=t.id WHERE t.artifact_id IS NOT NULL
  UNION ALL SELECT t.inventory_artifact_id, 'artifact', t.id, j.id FROM targets t JOIN jobs j ON j.target_id=t.id WHERE t.inventory_artifact_id IS NOT NULL
  UNION ALL SELECT t.inventory_artifact_id, 'artifact', t.id, j.id FROM targets t JOIN jobs j ON j.candidate_target_id=t.id WHERE t.inventory_artifact_id IS NOT NULL
  UNION ALL SELECT o.data_artifact_id, 'artifact', o.target_id, o.job_id FROM observations o WHERE o.data_artifact_id IS NOT NULL
  UNION ALL SELECT e.artifact_id, 'artifact', o.target_id, o.job_id FROM evidence_refs e JOIN observations o ON o.id=e.observation_id
  UNION ALL SELECT e.artifact_id, 'artifact', f.target_id, f.job_id FROM finding_evidence fe JOIN findings f ON f.id=fe.finding_id AND f.current_revision=fe.revision JOIN evidence_refs e ON e.id=fe.evidence_ref_id
) e WHERE id>? AND (? IS NULL OR target_id=?) AND (? IS NULL OR job_id=?)
AND (? IS NULL OR target_id IN (SELECT id FROM targets WHERE project_id=?))
AND (?=0 OR type='artifact') ORDER BY id, type LIMIT ?`;
export function evidenceReader(
  db: Database,
  targets: Targets,
  observations: Observations,
  findings: Findings,
  artifacts: Artifacts,
) {
  return {
    list(value: unknown = {}): Page<EvidenceItem> {
      const p = input(ListEvidenceInput, value);
      const rows = db.all(
        EVIDENCE_LIST_SQL,
        p.cursor ?? '',
        p.targetId ?? null,
        p.targetId ?? null,
        p.jobId ?? null,
        p.jobId ?? null,
        p.projectId ?? null,
        p.projectId ?? null,
        p.artifactsOnly ? 1 : 0,
        p.limit + 1,
      );
      const more = rows.length > p.limit;
      const items = rows.slice(0, p.limit).map((r) => {
        const id = String(r['id']);
        if (r['type'] === 'observation') {
          const o = observations.get(id);
          return read(EvidenceItem, {
            schemaVersion: 1,
            type: 'observation',
            observation: o,
            stale: targets.stale(o.targetId, o.targetDigest),
          });
        }
        if (r['type'] === 'finding') {
          const f = findings.get(id);
          return read(EvidenceItem, {
            schemaVersion: 1,
            type: 'finding',
            finding: f,
            stale: targets.stale(f.targetId),
          });
        }
        return read(EvidenceItem, {
          schemaVersion: 1,
          type: 'artifact',
          artifact: artifacts.get(id),
          stale: false,
        });
      });
      return { schemaVersion: 1, items, ...(more ? { nextCursor: String(rows[p.limit - 1]?.['id']) } : {}) };
    },
  };
}
