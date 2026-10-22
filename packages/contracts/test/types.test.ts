import { expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import { TargetId, JobId, CreateJobInput, ExecutionPolicy } from '../src/index.js';
import type {
  AnalysisProvider,
  PhoenixEngine,
  AnalysisRequest,
  ToolResponseEnvelope,
  JobBudget,
} from '../src/index.js';

it('keeps entity IDs nominal and distinguishes caller inputs from parsed defaults', () => {
  expectTypeOf<TargetId>().not.toEqualTypeOf<JobId>();
  expectTypeOf<TargetId>().toExtend<string>();
  expectTypeOf<z.input<typeof ExecutionPolicy>>().toEqualTypeOf<{
    allowExecution?: boolean | undefined;
    allowNetwork?: boolean | undefined;
    allowCloudInference?: boolean | undefined;
  }>();
  expectTypeOf<ExecutionPolicy>().toEqualTypeOf<{
    allowExecution: boolean;
    allowNetwork: boolean;
    allowCloudInference: boolean;
  }>();
  expectTypeOf<z.input<typeof CreateJobInput>>().toExtend<{
    mode: 'investigate' | 'reconstruct' | 'verify';
  }>();
  expectTypeOf<AnalysisProvider['execute']>().parameter(0).toEqualTypeOf<AnalysisRequest>();
  expectTypeOf<PhoenixEngine['tools']['invoke']>().returns.resolves.toEqualTypeOf<ToolResponseEnvelope>();
  expectTypeOf<JobBudget>().toEqualTypeOf<{ maxToolCalls: number; maxWallClockMs: number }>();
});
