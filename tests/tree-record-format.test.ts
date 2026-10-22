import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

interface Vector {
  record: (string | number)[];
  utf8Hex: string;
}
it('locks the documented tree-record encoding for unusual filenames before WP2', async () => {
  const vectors = JSON.parse(
    await readFile(new URL('./tree-hash-vectors.json', import.meta.url), 'utf8'),
  ) as Vector[];
  for (const vector of vectors) {
    const encoded = JSON.stringify(vector.record) + '\n';
    expect(Buffer.from(encoded).toString('hex')).toBe(vector.utf8Hex);
    expect(encoded.split('\n')).toHaveLength(2);
    expect(JSON.parse(encoded)).toEqual(vector.record);
  }
  expect(new Set(vectors.map((v) => v.utf8Hex)).size).toBe(vectors.length);
  // Newlines in names cannot introduce a second record; quotes and backslashes cannot escape the array.
  const concatenated = vectors.map((v) => JSON.stringify(v.record) + '\n').join('');
  expect(
    concatenated
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line) as unknown),
  ).toEqual(vectors.map((v) => v.record));
});
