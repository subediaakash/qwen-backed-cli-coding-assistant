import { runAgent, type TraceStep } from "./agent.ts";

const NUM_CTX = 32768;

const SYSTEM_PROMPT =
  "You are a local coding assistant. Use the ListFiles tool (with dir \".\" for the workspace root) when you need to inspect the workspace, and ReadFile to read a file. " +
  "For questions about changes between branches or commits, use GitDiff for an overview, GitDiffFile for a single file's diff, and GitLog for commit messages. " +
  "Never invent filenames. Answer using tool results when available.";

// Sent once the model has finished gathering, on the one call that runs with thinking on.
const REVIEW_PROMPT =
  "Now review the changes you have read like a senior engineer reviewing a pull request. " +
  "Focus on correctness bugs, security problems and risky behavior, not style. " +
  "Only report problems you can point to in the diffs above, quoting the code exactly. " +
  "If you found no real problems, say so. Return the review as JSON matching the schema.";

const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string" },
    files: { type: "array", items: { type: "string" } },
  },
  required: ["answer", "files"],
};

function printTrace(trace: TraceStep[]) {
  for (const step of trace) {
    console.error(
      `[step ${step.step}] prompt=${step.promptTokens}/${NUM_CTX} tokens, output=${step.outputTokens}, thinking=${step.thinking?.length ?? 0} chars, ${Math.round(step.ms)}ms`,
    );
    for (const call of step.toolCalls) {
      const flags = [call.truncated && "truncated", call.error && `error: ${call.error}`].filter(Boolean).join(", ");
      console.error(
        `  ${call.name}(${JSON.stringify(call.args)}) → ${call.resultChars} chars, ${Math.round(call.ms)}ms${flags ? ` (${flags})` : ""}`,
      );
    }
  }
}

async function main() {
  const args = Bun.argv.slice(2);
  const showTrace = args.includes("--trace");
  const review = args.includes("--review");
  const modelIndex = args.indexOf("--model");
  const model = modelIndex >= 0 ? args[modelIndex + 1] : undefined;
  const question = args
    .filter((a, i) => a !== "--trace" && a !== "--review" && (modelIndex < 0 || (i !== modelIndex && i !== modelIndex + 1)))
    .join(" ")
    .trim();

  if (!question || (modelIndex >= 0 && !model)) {
    console.error('Usage: bun src/index.ts [--trace] [--review] [--model <name>] "<question>"');
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
    // A review is a judgement, so think only on the final call that writes it.
    thinkFinal: review,
    finalPrompt: review ? REVIEW_PROMPT : undefined,
  });

  if (showTrace) {
    console.error(`[model] ${result.model}, think=${result.think}, thinkFinal=${result.thinkFinal}`);
    printTrace(result.trace);
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
