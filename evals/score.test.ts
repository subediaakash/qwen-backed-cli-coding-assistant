import { expect, test } from "bun:test";
import type { VerifiedFinding } from "../src/review/verify.ts";
import { cases } from "./cases.ts";
import { score } from "./score.ts";

const expected = cases[0]!.expected;

function finding(line: number, message = "something", file = "src/test/cart.ts"): VerifiedFinding {
  return { file, line, severity: "bug", message, evidence: "x", side: "RIGHT" };
}

test("counts findings near the expected line as caught", () => {
  const result = score([finding(9), finding(17), finding(21)], expected);
  expect(result).toEqual({ caught: ["off-by-one", "discount-bound", "missing-await"], missed: [], falsePositives: [] });
});

test("falls back to keywords when the line is off", () => {
  expect(score([finding(1, "Missing await on fetchItems")], expected).caught).toEqual(["missing-await"]);
});

test("one finding can't catch two bugs", () => {
  const result = score([finding(1, "missing await and an off-by-one")], expected);
  expect(result.caught).toHaveLength(1);
  expect(result.missed).toHaveLength(2);
});

test("findings in other files or far from any bug are false positives", () => {
  const result = score([finding(9), finding(3, "style"), finding(9, "x", "src/other.ts")], expected);
  expect(result.caught).toEqual(["off-by-one"]);
  expect(result.falsePositives).toHaveLength(2);
});
