# Qwen PR Reviewer — Progress & Roadmap

Goal: a PR reviewer that runs entirely on a local Qwen model (via Ollama), built step by step to learn how an agent **harness** works.

The harness is everything around the model: the loop, the tools, the guardrails, context management, output parsing, and evals. The model only ever sees messages and returns text/tool calls.

---

## Current architecture

```
src/index.ts              thin CLI: parses argv, calls runAgent, prints result (+ trace with --trace)
src/agent.ts              runAgent(config) → { output, stopReason, trace }: the reusable loop
src/tools/tools.ts        tool registry: schemas for Ollama (optionally a subset) + executeTool dispatcher
src/tools/core/*.ts       tool implementations (sandboxed to the workspace)
```

Model: `qwen3:8b` (hybrid thinking) through the `ollama` npm package, `num_ctx: 32768`, non-streaming. `think` is auto-detected from the model's capabilities. Ollama server settings: `OLLAMA_KV_CACHE_TYPE=q8_0`, `OLLAMA_FLASH_ATTENTION=1` (via `launchctl setenv`; not persistent across reboots).

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

- [x] **Step 1 — Reusable harness**
  - `runAgent({ system, user, tools, schema, maxSteps?, numCtx? })` in `src/agent.ts`; never prints or exits.
  - Per-run tool allowlist: the model only sees and can only execute the tools named in `config.tools`.
  - Trace per step: prompt/output tokens (from Ollama's `prompt_eval_count` / `eval_count`), duration, each tool call's args, result size, truncation, error.
  - Tool results capped centrally at 8000 chars with a `…[truncated: showing N of M chars]` marker.
  - Every ending is a `stopReason`: `done`, `max_steps`, `bad_json` (with `raw` text).
  - CLI: `bun src/index.ts [--trace] [--model <name>] "<question>"`.

### Lessons so far
- Tool errors should be **returned to the model as data** (`{ error }`) so it can recover, not crash the loop.
- Guardrails live in the tool, not the prompt; never trust the model to respect paths.
- The trace pays for itself immediately: its first run showed `think: false` being ignored (see Known issues).
- Small models need explicit hints in tool descriptions ("use ListFiles first to find the exact path").

---

## Known issues / cleanup 🧹

- [x] `package.json` has junk deps `"-"` and `"D"` (likely from a mistyped `bun add -D`), plus `tsx` (not needed with Bun). Remove them.
- [ ] `ListFiles` doesn't use `realpath`, so a symlink inside the repo could point outside it. Align with `ReadFile`.
- [x] The user prompt is hardcoded in `index.ts`; take it from CLI args instead.
- [x] **`think: false` is ignored by qwen3:4b.** Cause: our `qwen3:4b` is Qwen3-4B-Thinking-2507, which always thinks. Its template always opens the reply with `<think>`, so with `think: false` the reasoning leaked into `content` and was sent back to the model as history. Fix: `think` defaults to true for models whose `ollama.show().capabilities` include `"thinking"`, and `runAgent` removes `message.thinking` before adding the message to history (it's kept in the trace). The prompt now grows 324 → 373 → 433 tokens instead of 324 → 2211.
- [ ] Final answer quality: `answer` contains the tool result as a JSON string instead of prose, `files` comes back `[]` after reading a file, and qwen3:8b added a `;` that isn't in `src/test/check.ts` in 3 of 3 runs. Likely cause: the final prompt is only "Return your answer as JSON matching the schema", and the schema has no `description` fields.
- [ ] The trace doesn't record the final JSON-restating call, which is now most of the run time (step 1: 5–10s for 48 visible output tokens).
- [ ] `launchctl setenv` doesn't survive a reboot. Persist `OLLAMA_KV_CACHE_TYPE` / `OLLAMA_FLASH_ATTENTION` with a LaunchAgent. Revisit when we write real review prompts and schemas.
- [x] Ollama's default context window is small (often 2–4k tokens). Set `options: { num_ctx: ... }` explicitly, or diffs and files will be silently truncated.
- [ ] There's no test suite yet (`src/test/check.ts` is only a fixture). Add `bun test` tests for tool guardrails.

---

## Roadmap 🗺️

### Step 1 — Make the harness reusable ✅ (see Done)
- [x] Extract the loop into `src/agent.ts`: `runAgent({ system, user, tools, maxSteps })`, returning the final result plus a trace.
- [x] CLI entry: `bun src/index.ts "<question>"`.
- [x] Set `num_ctx`; log each step (tool name, args, result size, duration) to a trace for debugging.
- [x] Truncate oversized tool results in one central place, with a `truncated: true` marker.

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
| 2026-10-10 | Step 1: `runAgent` in `src/agent.ts`, CLI args, `--trace`, central truncation, tool allowlist. Found `think: false` being ignored. |
| 2026-10-10 | Fix A: `think` option (auto-detected from model capabilities), thinking removed from history, `--model` flag. |
| 2026-10-10 | Switched to `qwen3:8b` at 32k context and removed `qwen3:4b`. Set q8_0 KV cache + flash attention env vars (pending an Ollama restart). |
| 2026-10-10 | Ollama restarted with q8_0 KV cache: qwen3:8b at 32k uses 7.7 GB (was 9.9 GB with fp16), 100% GPU. |
| 2026-10-10 | `think: false` for the Q&A CLI: run time 43s → 7–13s. Prose answers and `files` are now correct; the invented `;` remains. |
