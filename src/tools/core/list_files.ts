import { readdir } from "node:fs/promises";
import { join } from "node:path";

const IGNORED_DIRS = new Set(["node_modules", ".git"]);

export async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => !path.split("/").some((part) => IGNORED_DIRS.has(part)));
}
