import { z } from 'zod';
import { HostInfo } from './host.js';
import { ProviderStatus } from './provider.js';

export const DoctorInput = z.strictObject({ dataDir: z.string().min(1).optional() });
export const DoctorCheck = z.strictObject({
  id: z.string().min(1),
  title: z.string(),
  category: z.enum(['required', 'optional']),
  status: z.enum(['pass', 'warn', 'fail', 'skip']),
  detail: z.string(),
  remediation: z.string().optional(),
  neededBy: z.array(z.string()),
});
export const DoctorReport = z
  .strictObject({
    schemaVersion: z.literal(1),
    phoenixVersion: z.string(),
    host: HostInfo,
    dataDir: z.strictObject({
      path: z.string(),
      exists: z.boolean(),
      writable: z.boolean(),
      schemaVersion: z.int().nonnegative().optional(),
      pendingMigrations: z.array(z.int().positive()).optional(),
    }),
    checks: z.array(DoctorCheck),
    providers: z.array(ProviderStatus),
    ok: z.boolean(),
  })
  .refine(
    (r) => r.ok === r.checks.every((c) => c.category !== 'required' || c.status === 'pass'),
    'ok must reflect required checks',
  );
export type DoctorInput = z.infer<typeof DoctorInput>;
export type DoctorCheck = z.infer<typeof DoctorCheck>;
export type DoctorReport = z.infer<typeof DoctorReport>;
