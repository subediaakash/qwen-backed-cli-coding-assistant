import type { TraceStep } from "./agent.ts";

export function printTrace(trace: TraceStep[], numCtx: number) {
  for (const step of trace) {
    console.error(
      `[step ${step.step}] prompt=${step.promptTokens}/${numCtx} tokens, output=${step.outputTokens}, thinking=${step.thinking?.length ?? 0} chars, ${Math.round(step.ms)}ms`,
    );
    for (const call of step.toolCalls) {
      const flags = [call.truncated && "truncated", call.error && `error: ${call.error}`].filter(Boolean).join(", ");
      console.error(
        `  ${call.name}(${JSON.stringify(call.args)}) → ${call.resultChars} chars, ${Math.round(call.ms)}ms${flags ? ` (${flags})` : ""}`,
      );
    }
  }
}
