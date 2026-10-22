import { z } from 'zod';
export const IsoTimestamp = z.iso.datetime({ offset: false, precision: 3 });
export type IsoTimestamp = z.infer<typeof IsoTimestamp>;
export const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);
export type Sha256Hex = z.infer<typeof Sha256Hex>;
