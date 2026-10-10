import { expect, test } from "bun:test";
import { parseDiff, verifyFinding, type Finding } from "./verify.ts";

// The planted-bug diff from review-test~1 → review-test (trimmed to the relevant hunk).
const DIFF = `diff --git a/src/test/cart.ts b/src/test/cart.ts
index c09ce91..555de3f 100644
--- a/src/test/cart.ts
+++ b/src/test/cart.ts
@@ -3,20 +3,21 @@ export interface Item {
   qty: number;
 }

+// Sum of price × quantity for every item in the cart.
 export function cartTotal(items: Item[]): number {
   let total = 0;
-  for (let i = 0; i < items.length; i++) {
+  for (let i = 0; i <= items.length; i++) {
     total += items[i]!.price * items[i]!.qty;
   }
   return total;
 }

 export function applyDiscount(total: number, percent: number): number {
-  if (percent < 0 || percent > 100) throw new Error("Discount must be between 0 and 100");
+  if (percent < 0) throw new Error("Discount cannot be negative");
   return total - (total * percent) / 100;
 }
`;

const diff = parseDiff(DIFF);

function finding(overrides: Partial<Finding>): Finding {
  return { file: "src/test/cart.ts", line: 9, severity: "bug", message: "m", evidence: "", ...overrides };
}

test("parseDiff numbers added, removed and context lines", () => {
  expect(diff.find((d) => d.text.includes("i <= items.length"))).toMatchObject({ kind: "+", newLine: 9, oldLine: null });
  expect(diff.find((d) => d.text.includes("i < items.length"))).toMatchObject({ kind: "-", oldLine: 8, newLine: null });
  expect(diff.find((d) => d.text.includes("let total = 0"))).toMatchObject({ kind: " ", oldLine: 7, newLine: 8 });
});

test("accepts exact evidence and keeps a correct line", () => {
  const result = verifyFinding(finding({ evidence: "for (let i = 0; i <= items.length; i++) {" }), diff);
  expect(result).toEqual({ ok: true, finding: expect.objectContaining({ line: 9, side: "RIGHT" }) });
  expect(result.finding).not.toHaveProperty("reportedLine");
});

test("moves a wrong line number to where the evidence is", () => {
  const result = verifyFinding(finding({ line: 12, evidence: "for (let i = 0; i <= items.length; i++) {" }), diff);
  expect(result.finding).toMatchObject({ line: 9, reportedLine: 12 });
});

test("rejects evidence with an invented character", () => {
  const result = verifyFinding(finding({ evidence: "for (let i = 0; i <= items.length; i++) {;" }), diff);
  expect(result.ok).toBe(false);
});

test("rejects multi-line evidence when any line is invented", () => {
  const evidence = "for (let i = 0; i <= items.length; i++) {\n  total += items[i].price;";
  expect(verifyFinding(finding({ evidence }), diff).ok).toBe(false);
});

test("anchors a removed line on the base side", () => {
  const evidence = '-  if (percent < 0 || percent > 100) throw new Error("Discount must be between 0 and 100");';
  const result = verifyFinding(finding({ line: 16, evidence }), diff);
  expect(result.finding).toMatchObject({ side: "LEFT", line: 15 });
});

test("accepts a long enough partial line, ignoring whitespace", () => {
  expect(verifyFinding(finding({ evidence: "  i  <=  items.length" }), diff).ok).toBe(true);
});

test("rejects empty evidence", () => {
  expect(verifyFinding(finding({ evidence: "  \n " }), diff).ok).toBe(false);
});
