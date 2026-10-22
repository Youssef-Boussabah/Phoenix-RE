import { z } from 'zod';
import { ArtifactId } from './ids.js';
import { Sha256Hex } from './time.js';
export const ArtifactRef = z.strictObject({
  id: ArtifactId,
  sha256: Sha256Hex,
  sizeBytes: z.int().nonnegative(),
  mediaType: z.string(),
});

export type ArtifactRef = z.infer<typeof ArtifactRef>;
