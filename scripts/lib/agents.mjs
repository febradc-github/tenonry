import fs from "node:fs";
import path from "node:path";
import { renderTemplate, bullets, numbered, assertMarker } from "./render.mjs";

const NO_VERIFY = "- No verification commands are configured for your files.";
const CORE_FILES = [
  { name: "tenonry-planner", file: "planner.md", always: true },
  { name: "tenonry-art-director", file: "art-director.md", always: true },
  { name: "tenonry-test-author", file: "test-author.md", always: true },
  { name: "tenonry-design-reviewer", file: "design-reviewer.md", always: false },
];

export const guardCommand = (agentName) => `node "$CLAUDE_PROJECT_DIR/.tenonry/bin/hook-ownership-guard.mjs" ${agentName}`;

export function hasUiSpecialist(activeIds, catalog) {
  const layers = new Map(catalog.map((spec) => [spec.id, spec.layer]));
  return activeIds.some((id) => ["frontend", "3d"].includes(layers.get(id)));
}

const readLibrary = (libraryDir, ...parts) => fs.readFileSync(path.join(libraryDir, ...parts), "utf8");
const collapseBlankLines = (text) => text.replace(/\n{3,}/g, "\n\n");

function verifyLines(spec, packages, verify) {
  const roots = new Set(packages.filter((pkg) => pkg.specialists.includes(spec.id)).map((pkg) => pkg.root));
  const lines = [];
  for (const entry of verify.filter((v) => roots.has(v.root))) {
    for (const name of ["test", "testFiles", "typecheck", "lint"]) {
      if (entry[name]) lines.push(`${name}: ${entry[name]}`);
    }
  }
  const unique = [...new Set(lines)];
  return unique.length ? bullets(unique) : NO_VERIFY;
}

function renderedGlobs(spec, packages) {
  const globs = [];
  for (const pkg of packages.filter((p) => p.specialists.includes(spec.id))) {
    for (const glob of spec.owns) globs.push(pkg.root === "." ? glob : `${pkg.root}/${glob}`);
  }
  return [...new Set(globs)];
}

// Returns Map<agent name, file text> for every agent the project needs.
export function renderAgents({ libraryDir, catalog, packages, verify }) {
  const activeIds = [...new Set(packages.flatMap((pkg) => pkg.specialists))].sort();
  const bySpec = new Map(catalog.map((spec) => [spec.id, spec]));
  const uiRulesText = readLibrary(libraryDir, "templates", "ui-rules.md").trimEnd();
  const specialistTemplate = readLibrary(libraryDir, "templates", "specialist.md");
  const reviewerTemplate = readLibrary(libraryDir, "templates", "code-reviewer.md");
  const out = new Map();

  const showDesignReviewer = hasUiSpecialist(activeIds, catalog);
  for (const core of CORE_FILES) {
    if (!core.always && !showDesignReviewer) continue;
    const text = renderTemplate(readLibrary(libraryDir, "core", core.file), { guard: guardCommand(core.name) });
    out.set(core.name, assertMarker(text, core.name));
  }

  for (const id of activeIds) {
    const spec = bySpec.get(id);
    const common = {
      id,
      title: spec.title,
      layer: spec.layer,
      modelFloor: spec.modelFloor,
      idioms: bullets(spec.idioms),
      slop: numbered(spec.slop, "S"),
    };
    const builderName = `tenonry-${id}`;
    const builder = renderTemplate(specialistTemplate, {
      ...common,
      guard: guardCommand(builderName),
      owns: bullets(renderedGlobs(spec, packages)),
      verify: verifyLines(spec, packages, verify),
      uiRules: ["frontend", "3d"].includes(spec.layer) ? `\n${uiRulesText}` : "",
    });
    out.set(builderName, assertMarker(collapseBlankLines(builder), builderName));

    const reviewerName = `tenonry-review-${id}`;
    const reviewer = renderTemplate(reviewerTemplate, { ...common, guard: guardCommand(reviewerName) });
    out.set(reviewerName, assertMarker(collapseBlankLines(reviewer), reviewerName));
  }
  return out;
}

export function agentNames({ catalog, packages }) {
  const activeIds = [...new Set(packages.flatMap((pkg) => pkg.specialists))].sort();
  const core = CORE_FILES.filter((c) => c.always || hasUiSpecialist(activeIds, catalog)).map((c) => c.name);
  return [...core, ...activeIds.flatMap((id) => [`tenonry-${id}`, `tenonry-review-${id}`])];
}
