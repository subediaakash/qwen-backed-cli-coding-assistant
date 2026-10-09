import { readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const WORKSPACE_ROOT = process.cwd();
const MAX_FILES = 200;
const IGNORED_DIRS = new Set(["node_modules", ".git", "build", "dist", ".dart_tool"]);

export interface ListFilesResult {
  files: string[];
  total: number;
  truncated: boolean;
}

// Resolves dir against the workspace root and rejects anything that escapes it.
function resolveInWorkspace(dir: string): string {
  const absolute = resolve(WORKSPACE_ROOT, dir);
  const rel = relative(WORKSPACE_ROOT, absolute);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Access denied: "${dir}" is outside the workspace. Only paths inside the project folder can be listed.`);
  }
  return absolute;
}

// Walks the tree manually so ignored directories are never descended into.
async function walk(dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) await walk(path, out);
    } else if (entry.isFile()) {
      out.push(relative(WORKSPACE_ROOT, path));
    }
  }
}

export async function listFiles(dir: string): Promise<ListFilesResult> {
  const files: string[] = [];
  await walk(resolveInWorkspace(dir), files);
  files.sort();
  return {
    files: files.slice(0, MAX_FILES),
    total: files.length,
    truncated: files.length > MAX_FILES,
  };
}
