import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadCatalog } from "../scripts/lib/catalog.mjs";
import { renderAgents } from "../scripts/lib/agents.mjs";
import { repoRoot } from "./helpers/docs.mjs";

const catalog = loadCatalog();
const libraryDir = path.join(repoRoot, "library");
const GENERATOR_SENTENCE =
  "You may run the project's own code generators and migration tools (for example `php artisan make:migration`, `prisma migrate dev --create-only`, `drizzle-kit generate`, `alembic revision --autogenerate`, `python manage.py makemigrations`) when everything they write is in files you own.";

export function render(packages, verify = []) {
  return renderAgents({ libraryDir, catalog, packages, verify });
}

test("F1: rendered data specialists may run generators for files they own", () => {
  const agents = render([{ root: ".", specialists: ["eloquent", "prisma"] }]);
  for (const name of ["tenonry-eloquent", "tenonry-prisma"]) {
    const text = agents.get(name);
    assert.ok(text.includes(GENERATOR_SENTENCE), name);
    assert.ok(text.includes("Do not change files with ad hoc shell commands such as sed, echo, or cp."), name);
    assert.ok(text.includes("If a generator names a file differently from the contract, such as a different migration timestamp, keep the generated name."), name);
    assert.ok(!text.includes("Never edit files through shell commands"), `${name} no longer forbids every shell-written file`);
  }
});

test("F1: the test author is told how to list generator-named files", () => {
  const text = fs.readFileSync(path.join(libraryDir, "core", "test-author.md"), "utf8");
  assert.ok(
    text.includes(
      "- Use exact relative paths. No globs in `files`.\n- For files whose names a generator decides, such as timestamped migrations, list the name the project's naming convention would produce. A builder may produce a different timestamp; that is expected and needs no contract change.\n",
    ),
  );
});
