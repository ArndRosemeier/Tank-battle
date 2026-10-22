/** Resolve Vite asset requests on both POSIX and Windows; never escape assets/. */
import * as path from 'node:path';

type PathApi = Pick<typeof path, 'resolve' | 'relative' | 'isAbsolute' | 'sep'>;

export function resolveAssetFile(root: string, requestedPath: string, paths: PathApi = path): string | null {
  if (!requestedPath || requestedPath.includes('\0')) return null;
  const absoluteRoot = paths.resolve(root);
  const candidate = paths.resolve(absoluteRoot, requestedPath);
  const relative = paths.relative(absoluteRoot, candidate);
  if (!relative || relative === '..' || relative.startsWith(`..${paths.sep}`) || paths.isAbsolute(relative)) {
    return null;
  }
  return candidate;
}
