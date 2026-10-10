import { expect, test } from "bun:test";
import { gitDiffFile, gitDiffSummary, gitLog, gitReadFile } from "./git.ts";

// Two early commits from this repo's history: "simple tool calling agent" → "guardrails on the list tool".
const BASE = "d77c66c";
const HEAD = "2ec48af";

test("GitDiff summarizes changed files with line counts", async () => {
  const result = await gitDiffSummary({ base: BASE, head: HEAD });
  expect(result).toEqual({
    files: [
      { path: "src/index.ts", status: "M", added: 24, deleted: 5 },
      { path: "src/tools/core/list_files.ts", status: "M", added: 42, deleted: 8 },
      { path: "src/tools/tools.ts", status: "M", added: 2, deleted: 2 },
    ],
    ignored: [],
  });
});

test("GitDiff lists lockfiles as ignored, and GitDiffFile refuses them", async () => {
  // 2ec48af → 684d832 removed the junk dependencies, which changed bun.lock.
  const result = await gitDiffSummary({ base: HEAD, head: "684d832" });
  if ("error" in result) throw new Error(result.error);
  expect(result.ignored).toEqual(["bun.lock"]);
  expect(result.files.map((f) => f.path)).not.toContain("bun.lock");
  expect(await gitDiffFile({ base: HEAD, head: "684d832", path: "bun.lock" })).toHaveProperty("error");
});

test("GitDiffFile returns a unified diff for one file", async () => {
  const result = await gitDiffFile({ base: BASE, head: HEAD, path: "src/tools/core/list_files.ts" });
  if ("error" in result) throw new Error(result.error);
  expect(result.diff).toContain("diff --git a/src/tools/core/list_files.ts");
  expect(result.diff).toContain("+function resolveInWorkspace");
});

test("GitDiffFile reports files the PR didn't change", async () => {
  expect(await gitDiffFile({ base: BASE, head: HEAD, path: "package.json" })).toHaveProperty("error");
});

test("GitLog lists commits on head but not on base", async () => {
  const result = await gitLog({ base: BASE, head: HEAD });
  if ("error" in result) throw new Error(result.error);
  expect(result.commits).toHaveLength(1);
  expect(result.commits[0]!.hash).toBe("2ec48af");
  expect(result.commits[0]!.subject).toStartWith("feat: added guardrails");
});

test.each([
  ["option injection", "--output=/tmp/pwned"],
  ["shell command", "main; rm -rf /"],
  ["command substitution", "$(whoami)"],
  ["range syntax", `${BASE}..${HEAD}`],
  ["unknown branch", "does-not-exist"],
  ["empty", ""],
])("rejects bad ref: %s", async (_, ref) => {
  expect(await gitDiffSummary({ base: ref, head: HEAD })).toHaveProperty("error");
  expect(await gitLog({ base: BASE, head: ref })).toHaveProperty("error");
});

test.each([
  ["parent directory", "../../etc/passwd"],
  ["absolute path", "/etc/passwd"],
])("GitDiffFile rejects path outside the workspace: %s", async (_, path) => {
  expect(await gitDiffFile({ base: BASE, head: HEAD, path })).toHaveProperty("error");
});

test("a path that looks like a flag is treated as a path, not an option", async () => {
  // After "--" git reads "--stat" as a filename, which the PR didn't change.
  const result = await gitDiffFile({ base: BASE, head: HEAD, path: "--stat" });
  expect(result).toEqual({ error: `No changes to "--stat" between ${BASE} and ${HEAD}.` });
});

// src/test/cart.ts only exists on the review-test branch: clean at review-test~1, with planted bugs at review-test.
test("ReadFile at a ref reads that version, not the working tree", async () => {
  const buggy = await gitReadFile({ ref: "review-test", path: "src/test/cart.ts" });
  const clean = await gitReadFile({ ref: "review-test~1", path: "src/test/cart.ts" });
  if ("error" in buggy) throw new Error(buggy.error);
  if ("error" in clean) throw new Error(clean.error);
  expect(buggy.content).toContain("i <= items.length");
  expect(clean.content).toContain("i < items.length");
  expect(buggy.ref).toBe("review-test");
});

test("ReadFile at a ref normalizes paths like ./src/../src/x", async () => {
  const result = await gitReadFile({ ref: "review-test", path: "./src/../src/test/cart.ts" });
  expect(result).toHaveProperty("path", "src/test/cart.ts");
});

test("ReadFile at a ref reports files missing at that ref", async () => {
  expect(await gitReadFile({ ref: BASE, path: "src/test/cart.ts" })).toEqual({
    error: `"src/test/cart.ts" does not exist at ${BASE}.`,
  });
});

test.each([
  ["bad ref", "--output=/tmp/pwned", "src/test/cart.ts"],
  ["path outside workspace", "review-test", "../../etc/passwd"],
])("ReadFile at a ref rejects %s", async (_, ref, path) => {
  expect(await gitReadFile({ ref, path })).toHaveProperty("error");
});
