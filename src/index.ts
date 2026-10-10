import { runAgent } from "./agent.ts";
import { printTrace } from "./trace.ts";

const NUM_CTX = 32768;

const SYSTEM_PROMPT =
  "You are a local coding assistant. Use the ListFiles tool (with dir \".\" for the workspace root) when you need to inspect the workspace, and ReadFile to read a file. " +
  "For questions about changes between branches or commits, use GitDiff for an overview, GitDiffFile for a single file's diff, and GitLog for commit messages. " +
  "To see the full file around a change, call ReadFile with ref set to the head branch or commit, so you read the changed version rather than the file on disk. " +
  "Never invent filenames. Answer using tool results when available.";

const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string" },
    files: { type: "array", items: { type: "string" } },
  },
  required: ["answer", "files"],
};

async function main() {
  const args = Bun.argv.slice(2);
  const showTrace = args.includes("--trace");
  const modelIndex = args.indexOf("--model");
  const model = modelIndex >= 0 ? args[modelIndex + 1] : undefined;
  const question = args
    .filter((a, i) => a !== "--trace" && (modelIndex < 0 || (i !== modelIndex && i !== modelIndex + 1)))
    .join(" ")
    .trim();

  if (!question || (modelIndex >= 0 && !model)) {
    console.error('Usage: bun src/index.ts [--trace] [--model <name>] "<question>"');
    process.exitCode = 1;
    return;
  }

  const result = await runAgent({
    system: SYSTEM_PROMPT,
    user: question,
    tools: ["ListFiles", "ReadFile", "GitDiff", "GitDiffFile", "GitLog"],
    schema: ANSWER_SCHEMA,
    numCtx: NUM_CTX,
    model,
    // Picking a tool and reading a file needs no reasoning; thinking made each step ~10x slower.
    think: false,
  });

  if (showTrace) {
    console.error(`[model] ${result.model}, think=${result.think}, thinkFinal=${result.thinkFinal}`);
    printTrace(result.trace, NUM_CTX);
  }

  if (result.stopReason === "bad_json") {
    console.error("Agent stopped: the final answer wasn't valid JSON.");
    if (result.raw) console.error(result.raw);
    process.exitCode = 1;
    return;
  }
  if (result.stopReason === "max_steps") {
    console.error("Warning: ran out of steps; the answer is based on what was gathered so far.");
  }

  console.log(JSON.stringify(result.output, null, 2));
}

main().catch((error: unknown) => {
  console.error("Agent failed:", error);
  process.exitCode = 1;
});
