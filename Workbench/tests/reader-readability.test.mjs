import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("reader editing and review surfaces keep a readable desktop type floor", () => {
  const styles = readFileSync(join(ROOT, "src/styles.css"), "utf8");
  const explanation = readFileSync(join(ROOT, "src/components/reader/reader-explanation.css"), "utf8");
  const formal = readFileSync(join(ROOT, "src/styles/v7-formal.css"), "utf8");

  assert.match(styles, /\.reader-workspace__body \{[\s\S]*font-size: 13px/);
  assert.match(styles, /\.reader-backfill__editor textarea,[\s\S]*font-size: 13px/);
  assert.match(styles, /\.reader-backfill__format-hint/);
  assert.match(styles, /\.reader-wiki-review__manual-plan/);
  assert.match(explanation, /font: 12\.5px\/1\.7 var\(--font-sans\)/);
  assert.match(formal, /\.formal-graph-inspector\.design-lab-inspector dd/);
});
