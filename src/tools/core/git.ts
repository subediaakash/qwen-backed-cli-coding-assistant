import { $ } from "bun";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";

const WORKSPACE = process.cwd();
const MAX_COMMITS = 50;
// Branch names, tags, hashes and HEAD~1 / main^ style suffixes. No spaces, no shell or git syntax beyond that.
const REF_PATTERN = /^[A-Za-z0-9._\/~^-]+$/;
// Generated dependency lockfiles: huge diffs with nothing to review, which would crowd out real code.
const IGNORED_FILES = new Set([
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "Cargo.lock",
  "go.sum",
  "poetry.lock",
  "uv.lock",
  "composer.lock",
  "Gemfile.lock",
]);

function isIgnored(path: string): boolean {
  return IGNORED_FILES.has(basename(path));
}

export interface ChangedFile {
  path: string;
  status: string;
  added: number | null; // null for binary files
  deleted: number | null;
}

export interface Commit {
  hash: string;
  author: string;
  subject: string;
  body: string;
}

type GitError = { error: string };

// Runs a read-only git command in the workspace. Bun.$ escapes every interpolated value,
// so a ref or path is always passed as a single argument and never interpreted by a shell.
async function git(args: string[]): Promise<{ ok: true; stdout: string } | { ok: false; error: string }> {
  const result = await $`git ${args}`.cwd(WORKSPACE).quiet().nothrow();
  if (result.exitCode !== 0) {
    return { ok: false, error: result.stderr.toString().trim() || `git exited with code ${result.exitCode}` };
  }
  return { ok: true, stdout: result.stdout.toString() };
}

// Shell escaping isn't enough on its own: a ref like "--output=/tmp/x" is a single argument
// that git would still read as an option. So refs must look like refs and must resolve to a commit.
async function validateRef(ref: unknown): Promise<string | null> {
  if (typeof ref !== "string" || !ref.trim()) return "A ref is required, e.g. \"main\" or \"HEAD\".";
  if (ref.startsWith("-") || !REF_PATTERN.test(ref) || ref.includes("..")) {
    return `Invalid ref "${ref}". Use a branch, tag, or commit hash.`;
  }
  const check = await git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  return check.ok ? null : `Unknown ref "${ref}". It doesn't name a commit in this repository.`;
}

function validatePath(path: unknown): string | null {
  if (typeof path !== "string" || !path.trim()) return "A file path is required.";
  const rel = relative(WORKSPACE, resolve(WORKSPACE, path));
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return `Path "${path}" is outside the workspace.`;
  }
  return null;
}

async function validateRange(base: unknown, head: unknown): Promise<GitError | null> {
  const error = (await validateRef(base)) ?? (await validateRef(head));
  return error ? { error } : null;
}

// base...head (three dots) diffs head against the merge base, i.e. only what the PR branch changed.
export async function gitDiffSummary(
  args: { base: string; head?: string },
): Promise<{ files: ChangedFile[]; ignored: string[] } | GitError> {
  const head = args.head ?? "HEAD";
  const invalid = await validateRange(args.base, head);
  if (invalid) return invalid;

  const range = `${args.base}...${head}`;
  const [numstat, nameStatus] = await Promise.all([
    // --no-renames reports a rename as delete + add, which keeps one path per line.
    git(["diff", "--no-renames", "--numstat", range]),
    git(["diff", "--no-renames", "--name-status", range]),
  ]);
  if (!numstat.ok) return { error: numstat.error };
  if (!nameStatus.ok) return { error: nameStatus.error };

  const statuses = new Map<string, string>();
  for (const line of nameStatus.stdout.split("\n").filter(Boolean)) {
    const [status = "", path = ""] = line.split("\t");
    statuses.set(path, status);
  }

  const all = numstat.stdout
    .split("\n")
    .filter(Boolean)
    .map((line): ChangedFile => {
      const [added, deleted, path = ""] = line.split("\t");
      return {
        path,
        status: statuses.get(path) ?? "M",
        added: added === "-" ? null : Number(added),
        deleted: deleted === "-" ? null : Number(deleted),
      };
    });

  return {
    files: all.filter((f) => !isIgnored(f.path)),
    ignored: all.filter((f) => isIgnored(f.path)).map((f) => f.path),
  };
}

export async function gitDiffFile(args: { base: string; head?: string; path: string }): Promise<{ path: string; diff: string } | GitError> {
  const head = args.head ?? "HEAD";
  const invalid = await validateRange(args.base, head);
  if (invalid) return invalid;
  const pathError = validatePath(args.path);
  if (pathError) return { error: pathError };
  if (isIgnored(args.path)) return { error: `"${args.path}" is a generated lockfile and is not reviewed.` };

  // "--" ends option parsing, so the path can never be read as a flag.
  const result = await git(["diff", "--unified=3", `${args.base}...${head}`, "--", args.path]);
  if (!result.ok) return { error: result.error };
  if (!result.stdout.trim()) return { error: `No changes to "${args.path}" between ${args.base} and ${head}.` };
  return { path: args.path, diff: result.stdout };
}

export async function gitLog(args: { base: string; head?: string }): Promise<{ commits: Commit[]; truncated: boolean } | GitError> {
  const head = args.head ?? "HEAD";
  const invalid = await validateRange(args.base, head);
  if (invalid) return invalid;

  // \x1f separates fields and \x1e separates commits, since subjects and bodies can contain anything else.
  const result = await git([
    "log",
    `--max-count=${MAX_COMMITS + 1}`,
    "--format=%h%x1f%an%x1f%s%x1f%b%x1e",
    `${args.base}..${head}`,
  ]);
  if (!result.ok) return { error: result.error };

  const commits = result.stdout
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record): Commit => {
      const [hash = "", author = "", subject = "", body = ""] = record.split("\x1f");
      return { hash, author, subject, body: body.trim() };
    });

  return { commits: commits.slice(0, MAX_COMMITS), truncated: commits.length > MAX_COMMITS };
}
