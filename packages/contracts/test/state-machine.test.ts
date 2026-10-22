import { expect, it } from 'vitest';
import {
  ACTIVE_STATES,
  TERMINAL_STATES,
  JobMode,
  JobState,
  PhoenixError,
  canTransition,
  assertTransition,
  isTerminal,
  JobBudget,
  exhaustedBudget,
} from '../src/index.js';

// Independent expected edges from the approved tables, without reading TRANSITIONS or MODE_GUARDS.
const common = `created:fingerprinting,failed,cancelled
fingerprinting:ready,failed,cancelled
ready:planning,cancelled
planning:investigating,partial,failed,cancelled
investigating:planning,partial,failed,cancelled
reconstructing:planning,partial,failed,cancelled
verifying:investigating,partial,failed,cancelled`;
const modeEdges = {
  investigate: 'investigating:completed',
  reconstruct: `planning:reconstructing,verifying
investigating:reconstructing
reconstructing:verifying
verifying:reconstructing,completed`,
  verify: `planning:verifying
reconstructing:verifying
verifying:completed`,
};
for (const mode of JobMode.options) {
  const expected = new Set(
    (common + '\n' + modeEdges[mode]).split('\n').flatMap((line) => {
      const [from, targets] = line.split(':');
      return (targets ?? '').split(',').map((to) => `${from ?? ''}:${to}`);
    }),
  );
  for (const from of JobState.options)
    for (const to of JobState.options) {
      it(`${mode}: ${from} → ${to}`, () => {
        const allowed = expected.has(`${from}:${to}`);
        expect(canTransition(mode, from, to)).toBe(allowed);
        if (allowed)
          expect(() => {
            assertTransition(mode, from, to);
          }).not.toThrow();
        else {
          expect(() => {
            assertTransition(mode, from, to);
          }).toThrow(PhoenixError);
          try {
            assertTransition(mode, from, to);
          } catch (error) {
            expect(error).toMatchObject({ code: 'INVALID_STATE_TRANSITION', retryable: false });
          }
        }
      });
    }
}
it('partitions active and terminal states, with cancellation only from active states', () => {
  expect([...ACTIVE_STATES, ...TERMINAL_STATES].sort()).toEqual([...JobState.options].sort());
  for (const state of JobState.options) expect(isTerminal(state)).toBe(TERMINAL_STATES.includes(state));
  for (const mode of JobMode.options)
    for (const state of ACTIVE_STATES) expect(canTransition(mode, state, 'cancelled')).toBe(true);
});
it('enforces budget edges: zero, below, equal, above and wall-clock equality', () => {
  const zero = JobBudget.parse({ maxToolCalls: 0 });
  expect(exhaustedBudget(zero, { elapsedMs: 0, toolCalls: 0 })).toBe('maxToolCalls');
  const budget = JobBudget.parse({ maxToolCalls: 1, maxWallClockMs: 100 });
  expect(exhaustedBudget(budget, { elapsedMs: 99, toolCalls: 0 })).toBeUndefined();
  expect(exhaustedBudget(budget, { elapsedMs: 99, toolCalls: 1 })).toBe('maxToolCalls');
  expect(exhaustedBudget(budget, { elapsedMs: 99, toolCalls: 2 })).toBe('maxToolCalls');
  expect(exhaustedBudget(budget, { elapsedMs: 100, toolCalls: 0 })).toBe('maxWallClockMs');
  expect(exhaustedBudget(budget, { elapsedMs: 101, toolCalls: 0 })).toBe('maxWallClockMs');
  for (const n of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect(JobBudget.safeParse({ maxToolCalls: n }).success).toBe(false);
    expect(() => exhaustedBudget(budget, { elapsedMs: n, toolCalls: 0 })).toThrow(RangeError);
    expect(() => exhaustedBudget(budget, { elapsedMs: 0, toolCalls: n })).toThrow(RangeError);
  }
  expect(JobBudget.safeParse({ maxWallClockMs: 0 }).success).toBe(false);
});
