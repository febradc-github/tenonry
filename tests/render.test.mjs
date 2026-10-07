import { test } from "node:test";
import assert from "node:assert/strict";
import { MARKER, renderTemplate, bullets, yamlList, numbered, assertMarker } from "../scripts/lib/render.mjs";

test("renders every placeholder", () => {
  assert.equal(renderTemplate("a {{x}} b {{ y }}", { x: "1", y: "2" }), "a 1 b 2");
});

test("throws on a missing variable", () => {
  assert.throws(() => renderTemplate("{{x}} {{missing}}", { x: "1" }), /missing template variable: missing/);
});

test("allows empty string values", () => {
  assert.equal(renderTemplate("[{{x}}]", { x: "" }), "[]");
});

test("does not re-expand placeholders inside substituted values", () => {
  assert.equal(renderTemplate("{{x}}", { x: "{{y}}" }), "{{y}}");
});

test("renders lists", () => {
  assert.equal(bullets(["a", "b"]), "- a\n- b");
  assert.equal(yamlList(["a", "b"]), "  - a\n  - b");
  assert.equal(numbered(["a", "b"], "S"), "S1. a\nS2. b");
  assert.equal(bullets([]), "");
});

test("assertMarker accepts exactly one trailing marker", () => {
  assert.equal(assertMarker(`text\n${MARKER}\n`, "x"), `text\n${MARKER}\n`);
  assert.throws(() => assertMarker("text\n", "x"));
  assert.throws(() => assertMarker(`${MARKER}\ntext\n${MARKER}\n`, "x"));
});
