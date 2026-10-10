# Qwen PR Reviewer — Progress & Roadmap

Goal: a PR reviewer that runs entirely on a local Qwen model (via Ollama), built step by step to learn how an agent **harness** works.

The harness is everything around the model: the loop, the tools, the guardrails, context management, output parsing, and evals. The model only ever sees messages and returns text/tool calls.

---

## Current architecture

```
src/index.ts              agent loop: chat → tool calls → tool results → repeat (MAX_STEPS)
src/tools/tools.ts        tool registry: schemas for Ollama + executeTool dispatcher
src/tools/core/*.ts       tool implementations (sandboxed to the workspace)
```

Model: `qwen3:4b` through the `ollama` npm package, `think: false`, non-streaming.

---

## Done ✅

- [x] **Step 0 — Basic tool-calling loop** (`d77c66c`)
  - Loop up to `MAX_STEPS`, push assistant message, execute tool calls, push `role: "tool"` results.
  - When the model stops calling tools, a second call with `format: ANSWER_SCHEMA` forces structured JSON output.
- [x] **Tool: `ListFiles`** (`2ec48af`)
  - Recursive listing, ignores `node_modules`, `.git`, `dist`, `build`, …
  - Rejects paths outside the workspace; caps output at 200 files with `total` / `truncated`.
- [x] **Tool: `ReadFile`** (uncommitted)
  - Uses `realpath` so symlinks can't escape the workspace; 100 KB limit; returns errors as data instead of throwing.

### Lessons so far
- Tool errors should be **returned to the model as data** (`{ error }`) so it can recover, not crash the loop.
- Guardrails live in the tool, not the prompt; never trust the model to respect paths.
- Small models need explicit hints in tool descriptions ("use ListFiles first to find the exact path").

---

## Known issues / cleanup 🧹

- [x] `package.json` has junk deps `"-"` and `"D"` (likely from a mistyped `bun add -D`), plus `tsx` (not needed with Bun). Remove them.
- [ ] `ListFiles` doesn't use `realpath`, so a symlink inside the repo could point outside it. Align with `ReadFile`.
- [ ] The user prompt is hardcoded in `index.ts`; take it from CLI args instead.
- [x] Ollama's default context window is small (often 2–4k tokens). Set `options: { num_ctx: ... }` explicitly, or diffs and files will be silently truncated.
- [ ] There's no test suite yet (`src/test/check.ts` is only a fixture). Add `bun test` tests for tool guardrails.

---

## Roadmap 🗺️

### Step 1 — Make the harness reusable
- [ ] Extract the loop into `src/agent.ts`: `runAgent({ system, user, tools, maxSteps })`, returning the final result plus a trace.
- [ ] CLI entry: `bun src/index.ts "<question>"`.
- [ ] Set `num_ctx`; log each step (tool name, args, result size, duration) to a trace for debugging.
- [ ] Truncate oversized tool results in one central place, with a `truncated: true` marker.

### Step 2 — Git tools (the core of a PR reviewer)
- [ ] `GitDiff({ base, head })`: unified diff between refs, or `--name-status` for a summary first.
- [ ] `GitDiffFile({ base, head, path })`: diff for one file, so we stay under the context budget.
- [ ] `GitLog({ base, head })`: commit messages, which describe the PR's intent.
- [ ] Use `Bun.$` with interpolated args (auto-escaped). Validate refs; read-only commands only.

### Step 3 — Search tool
- [ ] `Grep({ pattern, path? })`: find callers and usages of changed functions. Cap the number of matches.

### Step 4 — Review workflow
- [ ] Findings schema: `{ file, line, severity: "bug"|"risk"|"nit", message, suggestion? }`.
- [ ] Plan → per-file review → aggregate: list changed files, review each file in its own (small) context, then merge and dedupe findings.
- [ ] System prompt focused on correctness bugs over style; require evidence (quote the line).

### Step 5 — Evals
- [ ] Fixture branches with planted bugs (off-by-one, missing await, null deref, path traversal).
- [ ] Script that runs the reviewer on them and scores recall/precision. This is how we know whether prompt and tool changes actually help.

### Step 6 — Output & integration
- [ ] Markdown report printed to the terminal.
- [ ] Optional: post as PR comments via `gh` (opt-in flag).
- [ ] Try larger Qwen models (e.g. `qwen3:8b`, `qwen2.5-coder`) and compare on the evals.

---

## Log

| Date | What changed |
|------|--------------|
| — | Basic tool loop + `ListFiles` (`d77c66c`, `2ec48af`) |
| 2026-10-10 | Added `ReadFile`; created this doc |
| 2026-10-10 | Removed junk deps; set `num_ctx: 16384` on both chat calls |
