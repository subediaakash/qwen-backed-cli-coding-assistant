import { runAgent, type StopReason, type TraceStep } from "../agent.ts";
import { gitDiffFile } from "../tools/core/git.ts";
import { parseDiff, verifyFinding, type Finding, type RejectedFinding, type VerifiedFinding } from "./verify.ts";

export const REVIEW_NUM_CTX = 32768;

// Gathering runs without thinking, so keep it mechanical, and stop it from drafting a review
// that the final (thinking) call would only replace.
const GATHER_PROMPT =
  "You are gathering context for a pull request review. " +
  "First call GitDiff with the base and head you are given, then GitLog. " +
  "Then call GitDiffFile for every changed source file. Skip files listed as ignored and documentation such as .md files. " +
  "Call ReadFile with ref set to the head only when you need code around a change. " +
  "Do not write the review yet. When you have read every changed source file, reply with only the word DONE.";

// Ollama's `format` constrains the output to the schema but never shows it to the model,
// so the meaning of each field has to be spelled out here.
const REVIEW_PROMPT = `Now review the changes you have read, like a senior engineer reviewing a pull request.
Focus on correctness bugs, security problems and risky behavior. Do not report style.
Pay attention to removed lines (-): deleting a check or an await is often the bug.
Only report problems you can point to in the diffs above. If there are none, return an empty findings array.

Return JSON with:
- summary: one or two sentences on what the PR does and its overall quality.
- findings: an array where each item has
  - file: the path exactly as GitDiff listed it.
  - line: the line number in the head version (for a removed line, its line number in the base version).
  - severity: "bug" (wrong behavior or crash), "risk" (security issue or likely problem), or "nit" (minor).
  - message: what is wrong and why, in one or two sentences.
  - evidence: the offending line(s) copied exactly, character for character, from the diff, without the leading + or -.`;

const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: { type: "string" },
          line: { type: "integer" },
          severity: { type: "string", enum: ["bug", "risk", "nit"] },
          message: { type: "string" },
          evidence: { type: "string" },
        },
        required: ["file", "line", "severity", "message", "evidence"],
      },
    },
  },
  required: ["summary", "findings"],
};

export interface ReviewResult {
  base: string;
  head: string;
  summary: string;
  findings: VerifiedFinding[];
  rejected: RejectedFinding[];
  stopReason: StopReason;
  trace: TraceStep[];
  ms: number;
  error?: string;
}

export async function reviewChanges(args: { base: string; head: string; model?: string }): Promise<ReviewResult> {
  const started = performance.now();
  const { base, head } = args;

  const agent = await runAgent<{ summary: string; findings: Finding[] }>({
    system: GATHER_PROMPT,
    user: `Review the changes between base "${base}" and head "${head}".`,
    tools: ["GitDiff", "GitLog", "GitDiffFile", "ReadFile"],
    schema: REVIEW_SCHEMA,
    numCtx: REVIEW_NUM_CTX,
    model: args.model,
    think: false,
    thinkFinal: true,
    finalPrompt: REVIEW_PROMPT,
  });

  const result: ReviewResult = {
    base,
    head,
    summary: "",
    findings: [],
    rejected: [],
    stopReason: agent.stopReason,
    trace: agent.trace,
    ms: 0,
  };

  if (!agent.output) {
    result.error = `The model's review wasn't valid JSON: ${agent.raw ?? "(empty)"}`;
    result.ms = performance.now() - started;
    return result;
  }

  result.summary = agent.output.summary;

  // Each file's diff is fetched once by the harness, independently of what the model read.
  const diffs = new Map<string, ReturnType<typeof parseDiff> | null>();
  for (const finding of agent.output.findings) {
    if (!diffs.has(finding.file)) {
      const diff = await gitDiffFile({ base, head, path: finding.file });
      diffs.set(finding.file, "error" in diff ? null : parseDiff(diff.diff));
    }
    const diff = diffs.get(finding.file);
    if (!diff) {
      result.rejected.push({ ...finding, reason: "file is not changed in this PR" });
      continue;
    }
    const verified = verifyFinding(finding, diff);
    if (verified.ok) result.findings.push(verified.finding);
    else result.rejected.push(verified.finding);
  }

  result.ms = performance.now() - started;
  return result;
}
