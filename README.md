# qwen-backed-cli-assistant

A PR reviewer and coding Q&A assistant that runs entirely on a local Qwen model through [Ollama](https://ollama.com). It's built step by step to learn how an agent **harness** works: the loop, tools, guardrails, context management, output parsing and evals around the model.

- **`ask`**: answers questions about the workspace and its git history using read-only tools.
- **`review`**: reviews the changes between two refs and returns structured findings (`bug` / `risk` / `nit`). Every finding has to quote evidence that the harness checks against the real diff.
- **`eval`**: runs the reviewer against branches with planted bugs and scores recall and false positives.

## Requirements

- [Bun](https://bun.com)
- [Ollama](https://ollama.com) running locally, with the default model pulled:

  ```bash
  ollama pull qwen3:8b
  ```

- Optional, to reduce memory use at a 32k context (restart Ollama after setting these):

  ```bash
  launchctl setenv OLLAMA_KV_CACHE_TYPE q8_0
  launchctl setenv OLLAMA_FLASH_ATTENTION 1
  ```

## Setup

```bash
bun install
```

## Usage

### Ask a question

```bash
bun run ask [--trace] [--model <name>] "<question>"
```

```bash
bun run ask "what does src/agent.ts do?"
bun run ask --trace "what changed between 2ec48af and 684d832, and why?"
```

The output is JSON: `{ answer, files }`. `--trace` prints each step's tokens, duration and tool calls to stderr.

### Review changes

```bash
bun run review [--trace] [--json] <base> [head]
```

`head` defaults to `HEAD`. The diff is taken against the merge base (`base...head`), which is what a PR shows.

```bash
bun run review main my-feature-branch
```

The report lists each finding with its severity, `file:line`, a message and the quoted evidence. Line numbers the harness corrected are marked `(model said line N)`. Findings whose evidence doesn't appear in the diff are dropped and listed with a reason. `--json` prints the raw result instead.

### Run evals

```bash
bun run eval [--runs N] [--case <name>] [--model <name>]
```

Each case runs 3 times by default. Cases are defined in [evals/cases.ts](evals/cases.ts) and depend on a local `review-test` branch with planted bugs. Results are saved to `evals/results/` (gitignored).

### Tests

```bash
bun test
```

## How it works

```
src/agent.ts           runAgent(config): the reusable tool-calling loop → { output, stopReason, trace }
src/tools/tools.ts     tool registry and dispatcher (per-run allowlist)
src/tools/core/        ListFiles, ReadFile, GitDiff, GitDiffFile, GitLog (read-only, sandboxed)
src/review/review.ts   gather (thinking off) → review (thinking on) → verify findings
src/review/verify.ts   parses the diff, drops findings without real evidence, fixes line numbers
src/index.ts           `ask` CLI
src/review/cli.ts      `review` CLI
src/trace.ts           trace printer
evals/                 cases, scoring and runner
```

- **The loop** runs up to 15 steps. Once the model stops calling tools (or runs out of steps), a final call with Ollama's `format` forces JSON that matches a schema. Every run ends with a `stopReason`: `done`, `max_steps` or `bad_json`.
- **Guardrails live in the tools, not the prompt.** Paths must stay inside the workspace, and refs are validated so they can't be read as git options. Arguments go through `Bun.$`, so the shell never interprets them. Lockfiles are skipped.
- **Tool errors are returned to the model as data**, so it can recover. Results are capped at 8000 chars, with a truncation marker.
- **Thinking is split:** gathering runs with thinking off (fast), and the final judgement runs with thinking on.
- **Evidence check:** the model often gets line numbers and short strings wrong, so each finding must quote code from the diff. The harness looks that code up to confirm the finding and correct its line.

## Docs

- [docs/PROGRESS.md](docs/PROGRESS.md): progress, lessons learned, known issues and roadmap.
- [docs/harness.html](docs/harness.html): a visual walkthrough of the harness.
