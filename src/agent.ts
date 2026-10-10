import ollama, { type Message } from "ollama";
import { executeTool, getToolDefinitions } from "./tools/tools.ts";

const DEFAULT_MODEL = "qwen3:8b";
const DEFAULT_MAX_STEPS = 5;
// Ollama defaults to a small context window and silently drops older tokens past it.
const DEFAULT_NUM_CTX = 32768;
// A single huge tool result can eat the whole context window, so cap it here for every tool.
const MAX_TOOL_RESULT_CHARS = 8000;

export interface AgentConfig {
  system: string;
  user: string;
  tools: string[];
  schema: object;
  model?: string;
  maxSteps?: number;
  numCtx?: number;
  // Defaults to true when the model supports thinking. Thinking-only models (e.g. Qwen3-4B-Thinking-2507)
  // reason regardless, and with think: false that reasoning leaks into message.content.
  think?: boolean;
}

export interface ToolCallTrace {
  name: string;
  args: unknown;
  resultChars: number;
  truncated: boolean;
  ms: number;
  error?: string;
}

export interface TraceStep {
  step: number;
  promptTokens: number;
  outputTokens: number;
  ms: number;
  thinking?: string;
  toolCalls: ToolCallTrace[];
}

export type StopReason = "done" | "max_steps" | "bad_json";

export interface AgentResult<T> {
  model: string;
  think: boolean;
  output: T | null;
  stopReason: StopReason;
  trace: TraceStep[];
  // Raw final text when the model's answer couldn't be parsed as JSON.
  raw?: string;
}

// Serializes a tool result and cuts it down, telling the model that it did.
function toToolContent(result: unknown): { content: string; truncated: boolean } {
  const text = JSON.stringify(result);
  if (text.length <= MAX_TOOL_RESULT_CHARS) return { content: text, truncated: false };
  return {
    content: `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n…[truncated: showing ${MAX_TOOL_RESULT_CHARS} of ${text.length} chars]`,
    truncated: true,
  };
}

async function supportsThinking(model: string): Promise<boolean> {
  const { capabilities } = await ollama.show({ model });
  return capabilities.includes("thinking");
}

export async function runAgent<T = unknown>(config: AgentConfig): Promise<AgentResult<T>> {
  const model = config.model ?? DEFAULT_MODEL;
  const maxSteps = config.maxSteps ?? DEFAULT_MAX_STEPS;
  const options = { num_ctx: config.numCtx ?? DEFAULT_NUM_CTX };
  const think = config.think ?? (await supportsThinking(model));
  const tools = getToolDefinitions(config.tools);
  const trace: TraceStep[] = [];

  const messages: Message[] = [
    { role: "system", content: config.system },
    { role: "user", content: config.user },
  ];

  for (let step = 0; step < maxSteps; step++) {
    const started = performance.now();
    const response = await ollama.chat({ model, messages, tools, options, think, stream: false });

    // Keep reasoning in the trace but out of the history: the template would otherwise send it back
    // to the model on every later step of this turn, filling the context window.
    const { thinking, ...message } = response.message;
    messages.push(message);
    const toolCalls = message.tool_calls ?? [];
    const stepTrace: TraceStep = {
      step,
      promptTokens: response.prompt_eval_count,
      outputTokens: response.eval_count,
      ms: 0,
      thinking,
      toolCalls: [],
    };
    trace.push(stepTrace);

    // No tool calls means the model is done; ask it to restate the answer as structured JSON.
    if (toolCalls.length === 0) {
      const final = await ollama.chat({
        model,
        messages: [...messages, { role: "user", content: "Return your answer as JSON matching the schema." }],
        format: config.schema,
        options,
        think,
        stream: false,
      });
      stepTrace.ms = performance.now() - started;

      try {
        return { model, think, output: JSON.parse(final.message.content) as T, stopReason: "done", trace };
      } catch {
        return { model, think, output: null, stopReason: "bad_json", trace, raw: final.message.content };
      }
    }

    for (const call of toolCalls) {
      const { name, arguments: args } = call.function;
      const callStarted = performance.now();

      let result: unknown;
      let error: string | undefined;
      try {
        // Only tools allowed for this run may execute, even if the model names another one.
        if (!config.tools.includes(name)) throw new Error(`Tool ${name} is not available.`);
        result = await executeTool(name, args);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        result = { error };
      }

      const { content, truncated } = toToolContent(result);
      messages.push({ role: "tool", tool_name: name, content });
      stepTrace.toolCalls.push({
        name,
        args,
        resultChars: content.length,
        truncated,
        ms: performance.now() - callStarted,
        error,
      });
    }
    stepTrace.ms = performance.now() - started;
  }

  return { model, think, output: null, stopReason: "max_steps", trace };
}
