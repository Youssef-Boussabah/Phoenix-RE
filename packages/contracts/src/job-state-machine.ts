import { JobMode, JobState } from './job.js';
import { PhoenixError } from './errors.js';

export const TRANSITIONS: Readonly<Record<JobState, readonly JobState[]>> = Object.freeze({
  created: Object.freeze(['fingerprinting', 'failed', 'cancelled'] as const),
  fingerprinting: Object.freeze(['ready', 'failed', 'cancelled'] as const),
  ready: Object.freeze(['planning', 'cancelled'] as const),
  planning: Object.freeze([
    'investigating',
    'reconstructing',
    'verifying',
    'partial',
    'failed',
    'cancelled',
  ] as const),
  investigating: Object.freeze([
    'planning',
    'reconstructing',
    'completed',
    'partial',
    'failed',
    'cancelled',
  ] as const),
  reconstructing: Object.freeze(['verifying', 'planning', 'partial', 'failed', 'cancelled'] as const),
  verifying: Object.freeze([
    'completed',
    'reconstructing',
    'investigating',
    'partial',
    'failed',
    'cancelled',
  ] as const),
  completed: Object.freeze([]),
  partial: Object.freeze([]),
  failed: Object.freeze([]),
  cancelled: Object.freeze([]),
});
export const TERMINAL_STATES: readonly JobState[] = Object.freeze([
  'completed',
  'partial',
  'failed',
  'cancelled',
]);
export const ACTIVE_STATES: readonly JobState[] = Object.freeze([
  'created',
  'fingerprinting',
  'ready',
  'planning',
  'investigating',
  'reconstructing',
  'verifying',
]);
export const MODE_GUARDS: readonly { to: JobState; from?: JobState; modes: readonly JobMode[] }[] =
  Object.freeze([
    Object.freeze({ to: 'reconstructing' as const, modes: Object.freeze(['reconstruct'] as const) }),
    Object.freeze({ to: 'verifying' as const, modes: Object.freeze(['reconstruct', 'verify'] as const) }),
    Object.freeze({
      from: 'investigating' as const,
      to: 'completed' as const,
      modes: Object.freeze(['investigate'] as const),
    }),
    Object.freeze({
      from: 'verifying' as const,
      to: 'completed' as const,
      modes: Object.freeze(['reconstruct', 'verify'] as const),
    }),
  ]);
export const isTerminal = (state: JobState): boolean => TERMINAL_STATES.includes(state);
export function canTransition(mode: unknown, from: unknown, to: unknown): boolean {
  const parsedMode = JobMode.safeParse(mode);
  const parsedFrom = JobState.safeParse(from);
  const parsedTo = JobState.safeParse(to);
  if (!parsedMode.success || !parsedFrom.success || !parsedTo.success) return false;
  return (
    TRANSITIONS[parsedFrom.data].includes(parsedTo.data) &&
    MODE_GUARDS.every(
      (g) =>
        g.to !== parsedTo.data ||
        (g.from !== undefined && g.from !== parsedFrom.data) ||
        g.modes.includes(parsedMode.data),
    )
  );
}
export function assertTransition(mode: unknown, from: unknown, to: unknown): void {
  if (!canTransition(mode, from, to))
    throw new PhoenixError('INVALID_STATE_TRANSITION', 'Invalid job mode or state transition');
}
