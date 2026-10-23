// Test-only reference query retained to check inclusion/filter equivalence.
export const LEGACY_EVIDENCE_SQL = `SELECT DISTINCT id, type FROM (
        SELECT o.id, 'observation' type, o.target_id, o.job_id FROM observations o
        UNION ALL SELECT f.id, 'finding' type, f.target_id, f.job_id FROM findings f
        UNION ALL SELECT a.id, 'artifact' type, t.id target_id, j.id job_id FROM artifacts a LEFT JOIN targets t ON t.artifact_id=a.id OR t.inventory_artifact_id=a.id LEFT JOIN jobs j ON j.target_id=t.id OR j.candidate_target_id=t.id
        UNION ALL SELECT o.data_artifact_id id, 'artifact' type, o.target_id, o.job_id FROM observations o WHERE o.data_artifact_id IS NOT NULL
        UNION ALL SELECT e.artifact_id id, 'artifact' type, o.target_id, o.job_id FROM evidence_refs e JOIN observations o ON o.id=e.observation_id
        UNION ALL SELECT e.artifact_id id, 'artifact' type, f.target_id, f.job_id FROM finding_evidence fe JOIN findings f ON f.id=fe.finding_id AND f.current_revision=fe.revision JOIN evidence_refs e ON e.id=fe.evidence_ref_id
      ) e WHERE id>? AND (? IS NULL OR target_id=?) AND (? IS NULL OR job_id=?)
      AND (? IS NULL OR target_id IN (SELECT id FROM targets WHERE project_id=?))
      AND (?=0 OR type='artifact') ORDER BY id LIMIT ?`;
