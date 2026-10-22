import type { ZodType } from 'zod';
import type { OperationId } from '../provider.js';
import { InspectTargetParams, InspectTargetResult } from './inspect-target.js';
import { InspectAssetsParams, InspectAssetsResult } from './inspect-assets.js';
export * from './inspect-target.js';
export * from './inspect-assets.js';
// Schema availability does not advertise a provider implementation.
export const operationSchemas: Partial<Record<OperationId, { params: ZodType; result: ZodType }>> = {
  inspect_target: { params: InspectTargetParams, result: InspectTargetResult },
  inspect_assets: { params: InspectAssetsParams, result: InspectAssetsResult },
};
