import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseEnv, readProjectEnv, openRouterKey } from "../scripts/lib/env.mjs";

function tempProject(envText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tenonry-env-"));
  if (envText !== undefined) fs.writeFileSync(path.join(dir, ".env"), envText);
  return dir;
}

test("parses plain, quoted, exported, commented, and blank lines", () => {
  const env = parseEnv(
    [
      "# a comment",
      "",
      "PLAIN=value",
      'DOUBLE="with spaces"',
      "SINGLE='single quoted'",
      "export EXPORTED=yes",
      "  SPACED = padded  ",
      "WITH_COMMENT=abc # trailing",
      'QUOTED_HASH="a # b"',
      "EMPTY=",
      "NOT A LINE",
    ].join("\n"),
  );
  assert.deepEqual(env, {
    PLAIN: "value",
    DOUBLE: "with spaces",
    SINGLE: "single quoted",
    EXPORTED: "yes",
    SPACED: "padded",
    WITH_COMMENT: "abc",
    QUOTED_HASH: "a # b",
    EMPTY: "",
  });
});

test("strips only one matching pair of quotes and keeps mismatched quotes", () => {
  assert.equal(parseEnv(`A="'x'"`).A, "'x'");
  assert.equal(parseEnv(`A="x'`).A, `"x'`);
});

test("handles CRLF line endings", () => {
  assert.deepEqual(parseEnv("A=1\r\nB=2\r\n"), { A: "1", B: "2" });
});

test("missing .env returns an empty object", () => {
  assert.deepEqual(readProjectEnv(tempProject()), {});
  assert.equal(openRouterKey(tempProject()), null);
});

test("reads only the project .env, never process.env", () => {
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "sk-or-from-process-env";
  try {
    assert.equal(openRouterKey(tempProject("OTHER=1\n")), null);
    assert.equal(openRouterKey(tempProject("OPENROUTER_API_KEY=sk-or-file\n")), "sk-or-file");
  } finally {
    if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previous;
  }
});

test("an empty key counts as missing", () => {
  assert.equal(openRouterKey(tempProject("OPENROUTER_API_KEY=\n")), null);
});

test("an unreadable .env never throws and never leaks values", () => {
  const dir = tempProject();
  fs.mkdirSync(path.join(dir, ".env"));
  assert.deepEqual(readProjectEnv(dir), {});
});
