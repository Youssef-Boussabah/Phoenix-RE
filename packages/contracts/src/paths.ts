import { z } from 'zod';

export const RelativePath = z
  .string()
  .min(1)
  .refine(
    (path) =>
      !path.includes('\\') &&
      !path.includes('\0') &&
      !/^(?:\/|[a-z]:)/i.test(path) &&
      !path.split('/').some((part) => part === '' || part === '.' || part === '..') &&
      path === path.normalize('NFC') &&
      !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(path),
    'Expected a nonempty NFC POSIX relative path without traversal, NUL or backslashes',
  )
  .meta({
    'x-phoenix-runtime-constraints':
      'NFC, well-formed Unicode, POSIX relative path; no absolute paths, empty/dot segments, NUL or backslashes',
  });
export const ExcludePattern = RelativePath.refine(
  (path) => !/[*?\[\]{}!]/.test(path),
  'Exclusions are literal names or relative paths, not glob expressions',
).meta({
  'x-phoenix-runtime-constraints':
    'Normalized RelativePath rules plus literal names/relpaths only; no glob expressions',
});
export type RelativePath = z.infer<typeof RelativePath>;
export type ExcludePattern = z.infer<typeof ExcludePattern>;
