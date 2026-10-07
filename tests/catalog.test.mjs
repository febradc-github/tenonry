import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkCatalog } from "../scripts/lib/catalog.mjs";
import { repoRoot } from "./helpers/docs.mjs";
import { runNode, script } from "./helpers/run.mjs";

const shipped = () => JSON.parse(fs.readFileSync(path.join(repoRoot, "library", "catalog.json"), "utf8"));

test("the shipped catalog passes", () => {
  const result = checkCatalog(shipped());
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.deepEqual(result.counts, { frontend: 24, "3d": 1, backend: 23, data: 22 });
});

test("the shipped catalog equals docs/05 byte for byte", () => {
  const a = fs.readFileSync(path.join(repoRoot, "docs", "05-SPECIALIST-CATALOG.json"));
  const b = fs.readFileSync(path.join(repoRoot, "library", "catalog.json"));
  assert.ok(a.equals(b));
});

test("a duplicate id fails", () => {
  const catalog = shipped();
  catalog.specialists.push({ ...catalog.specialists[0] });
  const result = checkCatalog(catalog);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("duplicate id css")));
});

test("a bad layer count fails", () => {
  const catalog = shipped();
  catalog.specialists.pop();
  const result = checkCatalog(catalog);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("expected")));
});

test("an invalid glob fails", () => {
  const catalog = shipped();
  catalog.specialists[0].owns = ["{broken"];
  const result = checkCatalog(catalog);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("invalid glob")));
});

test("an unknown supersedes id fails", () => {
  const catalog = shipped();
  catalog.specialists[0].supersedes = ["no-such-specialist"];
  const result = checkCatalog(catalog);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("supersedes unknown id no-such-specialist")));
});

test("a bad modelFloor, idiom count, and slop count fail", () => {
  const catalog = shipped();
  catalog.specialists[0].modelFloor = "gpt";
  catalog.specialists[1].idioms = ["only one"];
  catalog.specialists[2].slop = [];
  const text = checkCatalog(catalog).errors.join("\n");
  assert.match(text, /modelFloor/);
  assert.match(text, /3 to 5 idioms/);
  assert.match(text, /2 to 4 slop/);
});

test("a malformed catalog fails without throwing", () => {
  assert.equal(checkCatalog({}).ok, false);
  assert.equal(checkCatalog(null).ok, false);
});

test("catalog-check CLI prints one JSON object and reports failures", () => {
  const ok = runNode(script("tenonry.mjs"), ["catalog-check"]);
  assert.equal(ok.status, 0);
  assert.equal(ok.json.ok, true);

  const catalog = shipped();
  catalog.specialists.push({ ...catalog.specialists[0] });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tenonry-cat-"));
  const file = path.join(dir, "catalog.json");
  fs.writeFileSync(file, JSON.stringify(catalog));
  const bad = runNode(script("tenonry.mjs"), ["catalog-check", "--file", file]);
  assert.equal(bad.status, 0);
  assert.equal(bad.json.ok, false);
});

test("unknown commands exit 1 with a JSON error", () => {
  const result = runNode(script("tenonry.mjs"), ["nope"]);
  assert.equal(result.status, 1);
  assert.equal(result.json.ok, false);
});
