// Checks the model's findings against the real diff. The model copies exact strings unreliably
// (invented semicolons, wrong hashes, wrong line numbers), so nothing it quotes is trusted until
// it has been found in the diff.

export type Severity = "bug" | "risk" | "nit";

export interface Finding {
  file: string;
  line: number;
  severity: Severity;
  message: string;
  evidence: string;
}

export interface VerifiedFinding extends Finding {
  // RIGHT = a line in the head version, LEFT = a removed line in the base version (GitHub's terms).
  side: "RIGHT" | "LEFT";
  // The model's line number, when the harness moved the finding to where the evidence actually is.
  reportedLine?: number;
}

export interface RejectedFinding extends Finding {
  reason: string;
}

export interface DiffLine {
  kind: "+" | "-" | " ";
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

// Turns a unified diff into lines with their base (old) and head (new) line numbers.
export function parseDiff(diff: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const raw of diff.split("\n")) {
    if (raw.startsWith("diff --git")) {
      inHunk = false;
      continue;
    }
    const hunk = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      continue;
    }
    // Skips the ---/+++ file headers before the first hunk and "\ No newline at end of file".
    if (!inHunk) continue;

    // A blank context line is " ", but editors and copy-paste often strip it to "".
    const kind = raw === "" ? " " : raw[0];
    const text = raw.slice(1);
    if (kind === "+") lines.push({ kind, text, oldLine: null, newLine: newLine++ });
    else if (kind === "-") lines.push({ kind, text, oldLine: oldLine++, newLine: null });
    else if (kind === " ") lines.push({ kind, text, oldLine: oldLine++, newLine: newLine++ });
  }
  return lines;
}

const normalize = (s: string) => s.replace(/\s+/g, " ").trim();

// A quoted line matches a diff line if it's the whole line, or a long enough part of it.
// Whitespace is ignored, but every other character (including a `;`) must be exact.
function matches(diffLine: DiffLine, quoted: string): boolean {
  const text = normalize(diffLine.text);
  return text === quoted || (quoted.length >= 8 && text.includes(quoted));
}

// The model sometimes keeps the diff's +/- prefix when quoting; try the line with and without it.
function quotedVariants(line: string): string[] {
  const n = normalize(line);
  return /^[+-]/.test(n) ? [n, normalize(n.slice(1))] : [n];
}

export function verifyFinding(
  finding: Finding,
  diff: DiffLine[],
): { ok: true; finding: VerifiedFinding } | { ok: false; finding: RejectedFinding } {
  const quoted = finding.evidence.split("\n").filter((l) => normalize(l));
  if (quoted.length === 0) return { ok: false, finding: { ...finding, reason: "no evidence quoted" } };

  // Every quoted line must exist in the diff, or the evidence is (at least partly) invented.
  for (const line of quoted) {
    if (!diff.some((d) => quotedVariants(line).some((q) => matches(d, q)))) {
      return { ok: false, finding: { ...finding, reason: `evidence not in diff: "${normalize(line)}"` } };
    }
  }

  // Anchor the finding on the first quoted line, choosing the occurrence nearest the reported line.
  const lineOf = (d: DiffLine) => (d.kind === "-" ? d.oldLine! : d.newLine!);
  const anchor = diff
    .filter((d) => quotedVariants(quoted[0]!).some((q) => matches(d, q)))
    .sort((a, b) => Math.abs(lineOf(a) - finding.line) - Math.abs(lineOf(b) - finding.line))[0]!;

  const line = lineOf(anchor);
  return {
    ok: true,
    finding: {
      ...finding,
      line,
      side: anchor.kind === "-" ? "LEFT" : "RIGHT",
      ...(line !== finding.line && { reportedLine: finding.line }),
    },
  };
}
