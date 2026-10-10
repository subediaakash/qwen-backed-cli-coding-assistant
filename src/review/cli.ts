import { printTrace } from "../trace.ts";
import { REVIEW_NUM_CTX, reviewChanges } from "./review.ts";

const ICONS = { bug: "🐛 bug ", risk: "⚠️  risk", nit: "💬 nit " } as const;

async function main() {
  const args = Bun.argv.slice(2);
  const showTrace = args.includes("--trace");
  const asJson = args.includes("--json");
  const [base, head = "HEAD"] = args.filter((a) => !a.startsWith("--"));

  if (!base) {
    console.error("Usage: bun src/review/cli.ts [--trace] [--json] <base> [head]");
    process.exitCode = 1;
    return;
  }

  const result = await reviewChanges({ base, head });

  if (showTrace) printTrace(result.trace, REVIEW_NUM_CTX);
  if (asJson) {
    const { trace, ...rest } = result;
    console.log(JSON.stringify(rest, null, 2));
    return;
  }
  if (result.error) {
    console.error(result.error);
    process.exitCode = 1;
    return;
  }

  console.log(`Review of ${base}...${head} (${Math.round(result.ms / 1000)}s)\n`);
  console.log(`${result.summary}\n`);
  if (result.stopReason === "max_steps") console.log("⚠️  Ran out of steps; some files may not have been read.\n");

  if (result.findings.length === 0) console.log("No findings.");
  for (const f of result.findings) {
    const moved = f.reportedLine ? ` (model said line ${f.reportedLine})` : "";
    const side = f.side === "LEFT" ? " (removed line)" : "";
    console.log(`${ICONS[f.severity]}  ${f.file}:${f.line}${side}${moved}`);
    console.log(`    ${f.message}`);
    console.log(`    > ${f.evidence.split("\n").join("\n    > ")}\n`);
  }

  if (result.rejected.length > 0) {
    console.log(`Dropped ${result.rejected.length} finding(s) whose evidence wasn't in the diff:`);
    for (const f of result.rejected) console.log(`  - ${f.file}:${f.line} ${f.message} [${f.reason}]`);
  }
}

main().catch((error: unknown) => {
  console.error("Review failed:", error);
  process.exitCode = 1;
});
