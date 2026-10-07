import path from "node:path";
import { readJson } from "./json.mjs";
import { matchGlob } from "./glob.mjs";

export const CORE_AGENTS = ["tenonry-planner", "tenonry-art-director", "tenonry-test-author", "tenonry-design-reviewer"];
const LOCKFILES = "package-lock.json,yarn.lock,pnpm-lock.yaml,bun.lockb,bun.lock,composer.lock,Cargo.lock,poetry.lock,Gemfile.lock,go.sum,mix.lock,pubspec.lock,uv.lock";
const MANIFESTS = "package.json,composer.json,pyproject.toml,requirements.txt,requirements-dev.txt,go.mod,Cargo.toml,Gemfile,mix.exs,pom.xml,build.gradle,build.gradle.kts,pubspec.yaml,.gitignore";
const TEST_GLOBS = [
  "**/*.test.*", "**/*.spec.*", "**/*.test-d.ts", "**/__tests__/**", "tests/**", "test/**", "**/tests/**", "spec/**", "**/spec/**",
  "e2e/**", "**/e2e/**", "**/*_test.go", "**/test_*.py", "**/*_test.py", "**/conftest.py", "**/src/test/**", "**/*Test.php",
  "**/{vitest,jest,playwright}.config.*", "**/phpunit.xml", "**/phpunit.xml.dist", "**/pytest.ini", "**/.rspec",
];

const rule = (glob, owner, priority, source = "system") => ({ glob, owner, priority, source });

export function systemRules() {
  const none = (glob) => rule(glob, "none", 1100);
  return [
    rule(".env.example", "*", 1150),
    rule("**/.env.example", "*", 1150),
    none(".env"), none(".env.*"), none("**/.env"), none("**/.env.*"),
    none(".git/**"), none("**/node_modules/**"), none("vendor/**"), none("**/vendor/**"), none(".claude/**"),
    none(".tenonry/config.json"), none(".tenonry/ownership.json"), none(".tenonry/state.json"),
    none(".tenonry/bin/**"), none(".tenonry/rubrics/**"), none(".tenonry/logs/**"),
    none(".tenonry/runs/*/run.json"), none(".tenonry/runs/*/route.json"), none(".tenonry/runs/*/owner-rules.json"),
    none(".tenonry/runs/*/brief.md"), none(".tenonry/runs/*/report.md"),
    none(`**/{${LOCKFILES}}`),
    rule(".tenonry/runs/*/plan.md", "tenonry-planner", 1000),
    rule(".tenonry/design-direction.md", "tenonry-art-director", 1000),
    rule(".tenonry/runs/*/design-brief.md", "tenonry-art-director", 1000),
    rule(".tenonry/runs/*/contract.json", "tenonry-test-author", 1000),
    rule(".tenonry/runs/*/contract.md", "tenonry-test-author", 1000),
    rule(".tenonry/runs/*/reviews/**", ["tenonry-design-reviewer", "tenonry-review-*"], 1000),
    rule(".tenonry/runs/*/reports/**", "*", 1000),
    rule(`**/{${MANIFESTS}}`, "*", 1000),
    rule("**/*.csproj", "*", 1000),
  ];
}

export function testRules() {
  return TEST_GLOBS.map((glob) => rule(glob, "tenonry-test-author", 900, "tests"));
}

// Catalog rules for every active specialist of every package; globs are prefixed with the package root.
export function catalogRules(packages, catalog) {
  const byId = new Map(catalog.map((spec) => [spec.id, spec]));
  const rules = [];
  const seen = new Set();
  for (const pkg of packages) {
    for (const id of pkg.specialists) {
      const spec = byId.get(id);
      if (!spec) continue;
      for (const glob of spec.owns) {
        const full = pkg.root === "." ? glob : `${pkg.root}/${glob}`;
        const key = `${full}\0${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rules.push(rule(full, `tenonry-${id}`, spec.priority, `catalog:${id}`));
      }
    }
  }
  return rules;
}

export function buildOwnership(packages, catalog) {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    rules: [...systemRules(), ...testRules(), ...catalogRules(packages, catalog)],
  };
}

export function loadRules(root, runId) {
  const base = readJson(path.join(root, ".tenonry", "ownership.json"), null);
  const rules = base?.rules ?? [...systemRules(), ...testRules()];
  if (!runId) return rules;
  const runRules = readJson(path.join(root, ".tenonry", "runs", runId, "owner-rules.json"), { rules: [] }).rules ?? [];
  return [...rules, ...runRules];
}

// Highest priority wins; ties go to the longer glob string, then the earlier rule.
export function resolveOwner(rules, relPath) {
  let best = null;
  for (const candidate of rules) {
    if (!matchGlob(candidate.glob, relPath)) continue;
    if (!best || candidate.priority > best.priority || (candidate.priority === best.priority && candidate.glob.length > best.glob.length)) {
      best = candidate;
    }
  }
  return best ? { owner: best.owner, rule: best } : null;
}

function patternMatches(pattern, name) {
  if (!pattern.includes("*")) return pattern === name;
  const source = pattern.split("*").map((part) => part.replace(/[.+^${}()|[\]\\?]/g, "\\$&")).join(".*");
  return new RegExp(`^${source}$`).test(name);
}

export function ownerAllows(owner, agentName) {
  if (owner === "none" || owner === undefined || owner === null) return false;
  const owners = Array.isArray(owner) ? owner : [owner];
  return owners.some((entry) => entry !== "none" && (entry === "*" || patternMatches(entry, agentName)));
}

export function isBuilderAgent(name) {
  return name.startsWith("tenonry-") && !CORE_AGENTS.includes(name) && !name.startsWith("tenonry-review-");
}

export function addRunRule(root, runId, relPath, owner, source) {
  const file = path.join(root, ".tenonry", "runs", runId, "owner-rules.json");
  const existing = readJson(file, { version: 1, generatedAt: new Date().toISOString(), rules: [] });
  existing.rules.push({ glob: relPath, owner, priority: 950, source });
  return { file, value: existing };
}
