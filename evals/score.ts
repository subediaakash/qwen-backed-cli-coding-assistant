import type { VerifiedFinding } from "../src/review/verify.ts";
import type { ExpectedBug } from "./cases.ts";

export const LINE_TOLERANCE = 2;

export interface Score {
  caught: string[]; // ids of expected bugs that were found
  missed: string[];
  falsePositives: VerifiedFinding[]; // findings that match no expected bug
}

function catches(finding: VerifiedFinding, bug: ExpectedBug): boolean {
  if (finding.file !== bug.file) return false;
  if (Math.abs(finding.line - bug.line) <= LINE_TOLERANCE) return true;
  const text = `${finding.message} ${finding.evidence}`.toLowerCase();
  return bug.keywords.some((k) => text.includes(k.toLowerCase()));
}

// Each expected bug can be caught by at most one finding, and each finding catches at most one bug,
// so one vague finding can't count for several bugs.
export function score(findings: VerifiedFinding[], expected: ExpectedBug[]): Score {
  const unused = [...findings];
  const caught: string[] = [];
  const missed: string[] = [];

  for (const bug of expected) {
    // Prefer a finding on the right line over one that only mentions a keyword.
    const byLine = unused.findIndex((f) => f.file === bug.file && Math.abs(f.line - bug.line) <= LINE_TOLERANCE);
    const index = byLine >= 0 ? byLine : unused.findIndex((f) => catches(f, bug));
    if (index >= 0) {
      caught.push(bug.id);
      unused.splice(index, 1);
    } else {
      missed.push(bug.id);
    }
  }

  return { caught, missed, falsePositives: unused };
}
