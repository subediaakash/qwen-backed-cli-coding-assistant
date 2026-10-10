import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

const WORKSPACE = process.cwd();
const MAX_FILE_BYTES = 100 * 1024; // 100 KB

export async function readWorkspaceFile(args: { path: string }) {
  if (typeof args.path !== "string" || !args.path.trim()) {
    return { error: "A valid file path is required" };
  }

  try {
    const requestedPath = path.resolve(WORKSPACE, args.path);
    const actualPath = await realpath(requestedPath);

    // Check the resolved path, including symbolic links.
    const relativePath = path.relative(WORKSPACE, actualPath);

    if (
      relativePath === ".." ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      return { error: "Path is outside the workspace" };
    }

    const fileInfo = await stat(actualPath);

    if (!fileInfo.isFile()) {
      return { error: "Path does not refer to a regular file" };
    }

    if (fileInfo.size > MAX_FILE_BYTES) {
      return {
        error: "File exceeds the 100 KB limit. Read smaller files first.",
      };
    }

    const content = await readFile(actualPath, "utf8");

    return {
      path: relativePath,
      content,
      lines: content.split("\n").length,
    };
  } catch {
    return { error: "Unable to read this file" };
  }
}
