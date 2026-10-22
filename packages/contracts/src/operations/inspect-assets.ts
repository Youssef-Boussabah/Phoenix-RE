import { z } from 'zod';
import { RelativePath } from '../paths.js';
import { InventoryEntry } from '../target.js';
export const InspectAssetsParams = z.strictObject({
  cursor: z.string().optional(),
  limit: z.int().min(1).max(5000).default(500),
  pathPrefix: RelativePath.optional(),
});
export const InspectAssetsResult = z.strictObject({
  source: z.enum(['filesystem', 'zip-central-directory', 'asar-header', 'single-file']),
  entries: z.array(InventoryEntry),
  total: z.int().nonnegative(),
});

export type InspectAssetsParams = z.infer<typeof InspectAssetsParams>;

export type InspectAssetsResult = z.infer<typeof InspectAssetsResult>;
