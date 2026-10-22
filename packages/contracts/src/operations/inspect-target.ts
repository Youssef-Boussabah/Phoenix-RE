import { z } from 'zod';
import { FormatDetails } from '../target.js';
export const InspectTargetParams = z.strictObject({ maxSections: z.int().min(1).max(1024).default(256) });
export const InspectTargetResult = z.strictObject({
  formatDetails: FormatDetails.optional(),
  sections: z.array(
    z.strictObject({
      name: z.string(),
      offset: z.int().nonnegative(),
      size: z.int().nonnegative(),
      virtualAddress: z.string().optional(),
      flags: z.array(z.string()),
    }),
  ),
  sectionsTruncated: z.boolean(),
});

export type InspectTargetParams = z.infer<typeof InspectTargetParams>;

export type InspectTargetResult = z.infer<typeof InspectTargetResult>;
