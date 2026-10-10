import { runAgent, type TraceStep } from "./agent.ts";

const NUM_CTX = 32768;

const SYSTEM_PROMPT =
  "You are a local coding assistant. Use the ListFiles tool (with dir \".\" for the workspace root) when you need to inspect the workspace, and ReadFile to read a file. Never invent filenames. Answer using tool results when available.";

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
    tools: ["ListFiles", "ReadFile"],
    schema: ANSWER_SCHEMA,
    numCtx: NUM_CTX,
    model,
    // Picking a tool and reading a file needs no reasoning; thinking made each step ~10x slower.
    think: false,
  });

  if (showTrace) {
    console.error(`[model] ${result.model}, think=${result.think}`);
    printTrace(result.trace);
  }

  if (result.stopReason !== "done") {
    console.error(`Agent stopped: ${result.stopReason}`);
    if (result.raw) console.error(result.raw);
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify(result.output, null, 2));
}

main().catch((error: unknown) => {
  console.error("Agent failed:", error);
  process.exitCode = 1;
});
