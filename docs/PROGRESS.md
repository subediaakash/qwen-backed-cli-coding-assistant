# Qwen PR Reviewer — Progress & Roadmap

Goal: a PR reviewer that runs entirely on a local Qwen model (via Ollama), built step by step to learn how an agent **harness** works.

The harness is everything around the model: the loop, the tools, the guardrails, context management, output parsing, and evals. The model only ever sees messages and returns text/tool calls.

---

## Current architecture

```
src/index.ts              Q&A CLI (`bun run ask`): parses argv, calls runAgent, prints result (+ trace with --trace)
src/trace.ts              shared trace printer
src/review/review.ts      reviewChanges({ base, head }): gather (think off) → review (think on) → verify findings
src/review/verify.ts      parseDiff + verifyFinding: evidence must be in the diff; corrects line numbers
src/review/cli.ts         `bun run review [--trace] [--json] <base> [head]`
evals/                    cases.ts (planted bugs), score.ts, run.ts (`bun run eval [--runs N] [--case name]`)
src/agent.ts              runAgent(config) → { output, stopReason, trace }: the reusable loop
src/tools/tools.ts        tool registry: schemas for Ollama (optionally a subset) + executeTool dispatcher
src/tools/core/*.ts       tool implementations (sandboxed to the workspace)
src/tools/core/git.ts     read-only git tools (GitDiff, GitDiffFile, GitLog) + git.test.ts
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

- [x] **Step 2 — Git tools**
  - `GitDiff({ base, head? })`: changed files with status (A/M/D) and lines added/deleted, compared with the merge base (`base...head`, which is what a PR shows). Uses `--no-renames`.
  - `GitDiffFile({ base, head?, path })`: unified diff for one file.
  - `GitLog({ base, head? })`: commits on head but not base (`base..head`), up to 50, with hash, author, subject and body.
  - Safety:
    - Every argument goes through `Bun.$`, so the shell never interprets it.
    - Refs must match `[A-Za-z0-9._/~^-]`, can't start with `-` (git would read it as an option even after shell escaping), can't contain `..`, and must resolve with `rev-parse --verify`.
    - Paths must stay inside the workspace and come after `--`.
  - 13 `bun test` cases against real commits, including option injection, shell injection, path traversal and a flag-like path.
  - End to end: "what changed between 2ec48af and 684d832, and why?" → GitDiff, then GitLog. All 8 files and line counts were correct, but one commit hash came out wrong (`30ae27d` instead of `31ae27d`).

### Lessons so far
- Tool errors should be **returned to the model as data** (`{ error }`) so it can recover, not crash the loop.
- Guardrails live in the tool, not the prompt; never trust the model to respect paths.
- The trace pays for itself immediately: its first run showed `think: false` being ignored (see Known issues).
- Shell escaping isn't enough: `--output=/tmp/x` is a single, perfectly escaped argument that git still reads as an option. Validate what the argument *means*, not just how it's quoted.
- The model copies short exact strings (hashes, punctuation) unreliably, even when the counts it reports are right. The final review output should quote evidence the harness can check against the real diff.
- Small models need explicit hints in tool descriptions ("use ListFiles first to find the exact path").

---

## Known issues / cleanup 🧹

- [x] `package.json` has junk deps `"-"` and `"D"` (likely from a mistyped `bun add -D`), plus `tsx` (not needed with Bun). Remove them.
- [ ] `ListFiles` doesn't use `realpath`, so a symlink inside the repo could point outside it. Align with `ReadFile`.
- [x] The user prompt is hardcoded in `index.ts`; take it from CLI args instead.
- [x] **`think: false` is ignored by qwen3:4b.** Cause: our `qwen3:4b` is Qwen3-4B-Thinking-2507, which always thinks. Its template always opens the reply with `<think>`, so with `think: false` the reasoning leaked into `content` and was sent back to the model as history. Fix: `think` defaults to true for models whose `ollama.show().capabilities` include `"thinking"`, and `runAgent` removes `message.thinking` before adding the message to history (it's kept in the trace). The prompt now grows 324 → 373 → 433 tokens instead of 324 → 2211.
- [ ] Final answer quality: `answer` contains the tool result as a JSON string instead of prose, `files` comes back `[]` after reading a file, and qwen3:8b added a `;` that isn't in `src/test/check.ts` in 3 of 3 runs. Likely cause: the final prompt is only "Return your answer as JSON matching the schema", and the schema has no `description` fields.
- [ ] The final answer is written twice: once as prose, then again as JSON. For a 340-token answer that's about 34s. Consider skipping the restatement when the answer is already valid JSON, or asking for JSON directly on the last step.
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

### Step 2 — Git tools (the core of a PR reviewer) ✅ (see Done)
- [x] `GitDiff({ base, head })`: unified diff between refs, or `--name-status` for a summary first.
- [x] `GitDiffFile({ base, head, path })`: diff for one file, so we stay under the context budget.
- [x] `GitLog({ base, head })`: commit messages, which describe the PR's intent.
- [x] Use `Bun.$` with interpolated args (auto-escaped). Validate refs; read-only commands only.

### Step 3 — Search tool
- [ ] `Grep({ pattern, path? })`: find callers and usages of changed functions. Cap the number of matches.

### Step 4 — Review workflow (next)

**Baseline (2026-10-10):** asking the Q&A agent to "review the changes between 2ec48af and 684d832" called GitDiff → GitLog → GitDiffFile(`bun.lock`, 8k chars of noise) → agent.ts → index.ts, then stopped at `max_steps` with no review. The prompt had grown to 7.2k tokens after 3 files.

**Why one open-ended agent run fails:** the model spends its steps collecting instead of judging, a single context fills up with every file, and it picks noise files. The predictable parts (diff summary, commit log, file filtering) don't need the LLM.

**Chosen first: keep one agent run, but make it fit (2026-10-10).**
- `maxSteps` default 5 → 15. When steps run out, the final answer is still produced from what was gathered (`stopReason: "max_steps"` with output).
- Lockfiles (`bun.lock`, `package-lock.json`, `yarn.lock`, …) are listed under `ignored` by GitDiff and refused by GitDiffFile.
- **Split thinking:** `think` controls the tool-calling steps and `thinkFinal` controls the final structured answer. `bun src/index.ts --review "<question>"` gathers with thinking off, then writes the review with thinking on, using a review-specific `finalPrompt`. The final call is now recorded in the trace as `step final`.
- First run (2ec48af → 684d832): GitDiff → GitLog → 6× GitDiffFile with thinking off (~37s), then the final review with thinking on (5.1k chars of reasoning, 109s). About 3 minutes in total. Verdict: "no critical bugs". There's no way to judge that yet without a planted bug.
- Wasted time:
  - Step 8 (the model saying it's done gathering) wrote a 685-token prose review *without* thinking (36s), which the final call then replaced.
  - `docs/PROGRESS.md` was diffed (7.9k chars), even though docs aren't code.

**Alternative if a single run stops scaling (larger PRs): the harness runs the pipeline, and the LLM only judges.**
```
harness: GitDiff + GitLog (direct calls) → filter files (lockfiles, binaries, docs)
  per file → runAgent(file diff + commit messages, tools: [ReadFile], think: true, schema: findings, maxSteps: 4)
           → harness drops findings whose evidence isn't in the diff
harness: merge → markdown report
```

- [x] 4a — Separate thinking setting for the final call (`thinkFinal`), recorded in the trace as `step final`.
- [x] Stop the wasted step: the gather prompt says to reply only "DONE". That step went from 12–77s to 0.8s (2 tokens).
- [ ] Skip docs/markdown in reviews (or rank them last).
- [x] 4b — Findings schema `{ line, severity: "bug"|"risk"|"nit", message, evidence }` . Ollama's `format` only *constrains* output and never shows the schema to the model, so the field meanings are spelled out in the review prompt.
- [x] 4c — Review system prompt: correctness over style, quote evidence exactly, return no findings rather than guess.
- [x] 4d — `bun run review <base> [head]` (`src/review/`). It's still one agent run, not per-file; revisit for large PRs.
- [x] 4e — Evidence check: drop findings whose `evidence` doesn't appear in the file's diff.
- [x] 4f — Terminal report: findings with severity, file:line, message and quoted evidence; lines moved by the harness are marked "(model said line N)"; dropped findings are listed with a reason.
- [x] Test: branch `review-test` (two commits on 684d832). `c3ba151` adds a clean `src/test/cart.ts`; `47d9419` "refactor: tidy up cart helpers" plants 3 bugs: `i <= items.length` (line 9), the removed `percent > 100` check (line 16), and the removed `await` hidden by `as unknown as Item[]` (line 21). It also adds one harmless comment.

  | Base | Run | Bugs found | False alarms | Lines | Time |
  |---|---|---|---|---|---|
  | `review-test~2` (whole file shown as new) | 1 | 2/3 (missed discount) | 0 | 1 right, 1 wrong | 58s |
  | `review-test~2` | 2 | 2/3 (missed discount) | 0 | none given | 70s |
  | `review-test~1` (bugs shown as changes) | 1 | **3/3** | 0 | none given | 174s |
  | `review-test~1` | 2 | **3/3** | 0 | none given | 98s |

  Lessons:
  - **Removed lines are evidence.** The discount bug is only visible as a *deletion*, so it was caught every time it appeared in the diff as one and missed every time it didn't.
  - The model invents its own findings format inside `answer` (`review`, `reviews`, `category`, …). It needs a real schema (4b).
  - The step before the final call still writes a full review without thinking (12–77s wasted).


**First structured run (review-test~1 → review-test): 3/3 bugs found, 55s. The model got all three line numbers wrong (8, 18, 10), and the harness moved them to the quoted code (9, 21, 16).**

### Step 5 — Evals (script ✅, more cases needed)
- [x] `evals/run.ts`: runs each case N times, scores caught/missed/false positives/dropped/line fixes, and saves JSON to `evals/results/` (gitignored). A finding catches a bug if it's in the same file and within ±2 lines or mentions a keyword; one finding catches at most one bug.
- [x] Cases: `cart-changes` (review-test~1 → review-test) and `cart-new-file` (review-test~2 → review-test). Both depend on the local `review-test` branch.
- [ ] Fixture branches with planted bugs (off-by-one, missing await, null deref, path traversal).
- [ ] Script that runs the reviewer on them and scores recall/precision. This is how we know whether prompt and tool changes actually help.

### Step 6 — Run it on real GitHub PRs (service)

Plan, in order:
1. **`--pr <number>` mode (CLI, dry run).** Fetch with `git fetch origin pull/N/head`, review base...head, print the comments that *would* be posted.
2. ✅ **Tools read at the PR's head, not the working tree.** `ReadFile` takes an optional `ref` and then reads with `git show <ref>:<path>` (same ref/path checks as the git tools, 100 KB limit via `git cat-file -s`). There are 5 more tests (19 total). End to end, the model passed `ref: "review-test"` without prompting and quoted the file exactly.
3. **Post the review** with `gh api …/pulls/N/reviews`: one review with inline comments, on lines that exist in the diff. Comment only; never approve or request changes. Test against a private sandbox repo first.
4. **Polling service:** a local loop that runs `gh pr list --search "review-requested:@me"` every few minutes. It records reviewed head SHAs in `bun:sqlite` so each push is reviewed once, handles one review at a time (one GPU), and runs as a `launchd` agent. No public URL needed.
5. Optional later: a webhook (`Bun.serve` + tunnel + signature check), or a self-hosted Actions runner (private repos only).

What has to be true before it's "good enough" to post on real PRs:
- Structured findings + evidence check + mapping lines to the diff (4b, 4e).
- An eval suite (Step 5) with recall **and** false-positive rate. False positives are what make people mute a bot.
- Per-file reviews or a size limit for large PRs; skip docs, generated and vendored files.
- Robustness: retry on `bad_json`, timeouts, errors when Ollama is down, traces saved to disk.
- Security: the PR content is untrusted input (prompt injection). Keep tools read-only, comment only, and use a token with minimal scope.

### Step 7 — Output & integration (older notes)
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
| 2026-10-10 | Step 2: GitDiff / GitDiffFile / GitLog with ref and path validation and 13 tests; enabled in the CLI. |
| 2026-10-10 | `thinkFinal` + `finalPrompt`, `--review` flag, maxSteps 15 with an answer even when steps run out, lockfiles ignored by the git tools (14 tests). |
| 2026-10-10 | Planted-bug branch `review-test`: 2/3 bugs found when the file is new, 3/3 when the bugs appear as changes. Service plan added (Step 6). |
| 2026-10-10 | `ReadFile` with an optional `ref` (`gitReadFile` in git.ts); 19 tests. |
| 2026-10-10 | Structured review pipeline (`src/review/`), evidence check with line correction, DONE trick, eval runner; 31 tests. |
