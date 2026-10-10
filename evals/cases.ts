// Each case is a base/head pair with known, planted bugs. A finding counts as catching a bug when it's
// in the same file and either within LINE_TOLERANCE lines of it or mentions one of its keywords.

export interface ExpectedBug {
  id: string;
  file: string;
  line: number;
  keywords: string[];
}

export interface EvalCase {
  name: string;
  description: string;
  base: string;
  head: string;
  expected: ExpectedBug[];
}

// Branch review-test (local): 271074e adds a clean src/test/cart.ts, f80019b "refactor: tidy up cart helpers"
// plants three bugs and adds one harmless comment.
const CART_BUGS: ExpectedBug[] = [
  { id: "off-by-one", file: "src/test/cart.ts", line: 9, keywords: ["<=", "off-by-one", "out-of-bounds", "out of bounds"] },
  { id: "discount-bound", file: "src/test/cart.ts", line: 16, keywords: ["> 100", "100", "upper bound"] },
  { id: "missing-await", file: "src/test/cart.ts", line: 21, keywords: ["await", "promise"] },
];

export const cases: EvalCase[] = [
  {
    name: "cart-changes",
    description: "Bugs introduced as edits to an existing file (removed lines visible).",
    base: "review-test~1",
    head: "review-test",
    expected: CART_BUGS,
  },
  {
    name: "cart-new-file",
    description: "The same buggy file added as new (no removed lines to compare with).",
    base: "review-test~2",
    head: "review-test",
    expected: CART_BUGS,
  },
];
