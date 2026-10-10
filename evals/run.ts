import { reviewChanges } from "../src/review/review.ts";
import { cases } from "./cases.ts";
import { score } from "./score.ts";

// Usage: bun evals/run.ts [--runs N] [--case name] [--model name]
const args = Bun.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const runs = Number(flag("--runs") ?? 3);
const model = flag("--model");
const selected = cases.filter((c) => !flag("--case") || c.name === flag("--case"));

const pct = (n: number, d: number) => (d === 0 ? "-" : `${Math.round((100 * n) / d)}%`);
const report: unknown[] = [];

for (const evalCase of selected) {
  console.log(`\n== ${evalCase.name}: ${evalCase.description}`);
  let caught = 0;
  let falsePositives = 0;
  let rejected = 0;
  let lineFixes = 0;
  let totalMs = 0;
  const missedCounts = new Map<string, number>();

  for (let run = 1; run <= runs; run++) {
    const result = await reviewChanges({ base: evalCase.base, head: evalCase.head, model });
    const s = score(result.findings, evalCase.expected);

    caught += s.caught.length;
    falsePositives += s.falsePositives.length;
    rejected += result.rejected.length;
    lineFixes += result.findings.filter((f) => f.reportedLine !== undefined).length;
    totalMs += result.ms;
    for (const id of s.missed) missedCounts.set(id, (missedCounts.get(id) ?? 0) + 1);

    console.log(
      `  run ${run}: caught ${s.caught.length}/${evalCase.expected.length}` +
        (s.missed.length ? ` (missed ${s.missed.join(", ")})` : "") +
        `, false positives ${s.falsePositives.length}, dropped ${result.rejected.length}` +
        `, ${Math.round(result.ms / 1000)}s${result.error ? `, ERROR: ${result.error.slice(0, 80)}` : ""}`,
    );
    for (const f of s.falsePositives) console.log(`      FP ${f.severity} ${f.file}:${f.line} ${f.message}`);
    for (const f of result.rejected) console.log(`      dropped ${f.file}:${f.line} [${f.reason}]`);

    report.push({ case: evalCase.name, run, ...s, rejected: result.rejected, findings: result.findings, ms: result.ms, error: result.error });
  }

  const possible = runs * evalCase.expected.length;
  console.log(
    `  → recall ${pct(caught, possible)} (${caught}/${possible}), ` +
      `false positives ${(falsePositives / runs).toFixed(1)}/run, ` +
      `dropped ${(rejected / runs).toFixed(1)}/run, ` +
      `lines fixed by harness ${lineFixes}, avg ${Math.round(totalMs / runs / 1000)}s`,
  );
  if (missedCounts.size) {
    console.log(`  → missed: ${[...missedCounts].map(([id, n]) => `${id} ${n}/${runs}`).join(", ")}`);
  }
}

const out = `evals/results/${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
await Bun.write(out, JSON.stringify({ model: model ?? "default", runs, report }, null, 2));
console.log(`\nSaved ${out}`);
