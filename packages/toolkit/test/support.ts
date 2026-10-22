import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach } from 'vitest';
import type { TestContext } from 'vitest';

const roots: string[] = [];
export async function tempDir(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'phoenix-wp2-'));
  roots.push(root);
  return root;
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true, maxRetries: 10 });
});
export async function makeSymlink(
  target: string,
  destination: string,
  context: TestContext,
  directory = false,
): Promise<void> {
  try {
    await symlink(
      target,
      destination,
      directory && process.platform === 'win32' ? 'junction' : directory ? 'dir' : 'file',
    );
  } catch (error) {
    if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM')
      context.skip('Windows symlink creation privilege unavailable');
    throw error;
  }
}
