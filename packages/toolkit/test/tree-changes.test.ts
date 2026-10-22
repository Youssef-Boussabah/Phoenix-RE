import { expect, it, vi } from 'vitest';
import path from 'node:path';
import { writeFile, realpath, stat, utimes } from 'node:fs/promises';
import { hashDirectory } from '../src/hash/tree.js';
import { tempDir } from './support.js';
const timing = vi.hoisted(() => ({
  root: '',
  leaf: '',
  armed: false,
  changed: false,
  mutate: undefined as (() => Promise<void>) | undefined,
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    lstat: async (...args: Parameters<typeof actual.lstat>) => {
      if (args[0] === timing.root && timing.armed && !timing.changed) {
        timing.changed = true;
        await timing.mutate?.();
      }
      const metadata = await actual.lstat(...args);
      if (args[0] === timing.leaf) timing.armed = true;
      return metadata;
    },
  };
});
it('rejects an actual directory change during traversal instead of returning a complete digest', async () => {
  const root = await realpath(await tempDir()),
    leaf = path.join(root, 'leaf');
  await writeFile(leaf, 'x');
  const before = await stat(root);
  Object.assign(timing, {
    root,
    leaf,
    armed: false,
    changed: false,
    mutate: async () => {
      await writeFile(path.join(root, 'added-during-traversal'), 'new');
      // Force an observable metadata delta even on filesystems with coarse timestamps.
      await utimes(root, before.atime, new Date(before.mtimeMs + 5000));
    },
  });
  await expect(hashDirectory(root)).rejects.toMatchObject({ code: 'TARGET_CHANGED' });
  expect(timing.changed).toBe(true);
  expect((await stat(path.join(root, 'added-during-traversal'))).isFile()).toBe(true);
});
