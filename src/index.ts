import ollama, { type Message } from "ollama";
import { executeTool, getToolDefinitions } from "./tools/tools.ts";

const MODEL = "qwen3:4b";
const MAX_STEPS = 5;

const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string" },
    files: { type: "array", items: { type: "string" } },
  },
  required: ["answer", "files"],
};

async function main() {
  const messages: Message[] = [
    {
      role: "system",
      content:
        "You are a local coding assistant. Use the ListFiles tool (with dir \".\" for the workspace root) when you need to inspect the workspace. Never invent filenames. Answer using tool results when available.",
    },
    {
      role: "user",
      content: "Can you tell me what do we have at src/test/check.ts",
    },
  ];

  const tools = getToolDefinitions();

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await ollama.chat({
      model: MODEL,
      messages,
      tools,
      think: false,
      stream: false,
    });

    messages.push(response.message);
    const toolCalls = response.message.tool_calls ?? [];

    // No tool calls means the model is done; ask it to restate the answer as structured JSON.
    if (toolCalls.length === 0) {
      const final = await ollama.chat({
        model: MODEL,
        messages: [
          ...messages,
          { role: "user", content: "Return your answer as JSON matching the schema." },
        ],
        format: ANSWER_SCHEMA,
        think: false,
        stream: false,
      });

      const result = JSON.parse(final.message.content);
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    for (const call of toolCalls) {
      const { name, arguments: args } = call.function;
      console.log(`[tool] ${name}(${JSON.stringify(args)})`);

      let result: unknown;
      try {
        result = await executeTool(name, args);
      } catch (error) {
        result = { error: error instanceof Error ? error.message : String(error) };
      }

      messages.push({
        role: "tool",
        tool_name: name,
        content: JSON.stringify(result),
      });
    }
  }

  console.error(`Stopped after ${MAX_STEPS} steps without a final answer.`);
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("Agent failed:", error);
  process.exitCode = 1;
});
