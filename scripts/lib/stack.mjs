import fs from "node:fs";
import path from "node:path";
import { readJson } from "./json.mjs";
import { detectAll } from "./detect.mjs";

const read = (file) => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
};
const exists = (dir, name) => fs.existsSync(path.join(dir, name));

const RUNNERS = {
  npm: { run: (s) => (s === "test" ? "npm test" : `npm run ${s}`), exec: "npx" },
  pnpm: { run: (s) => `pnpm ${s}`, exec: "pnpm exec" },
  yarn: { run: (s) => `yarn ${s}`, exec: "yarn" },
  bun: { run: (s) => `bun run ${s}`, exec: "bunx" },
};

function npmScripts(pkgDir) {
  const scripts = readJson(path.join(pkgDir, "package.json"), {}).scripts ?? {};
  // The `npm init` placeholder script always fails; it is not a real test command.
  if (/no test specified/.test(scripts.test ?? "")) delete scripts.test;
  return scripts;
}

function jsEntry(pkgDir, pkg) {
  if (!exists(pkgDir, "package.json")) return null;
  const manifest = readJson(path.join(pkgDir, "package.json"), {});
  const deps = { ...manifest.peerDependencies, ...manifest.devDependencies, ...manifest.dependencies };
  const scripts = npmScripts(pkgDir);
  const runner = RUNNERS[pkg.packageManager ?? "npm"];
  const framework = deps.vitest ? "vitest" : deps.jest ? "jest" : null;
  const frameworkRun = { vitest: "vitest run", jest: "jest" };
  return {
    ecosystem: "js",
    test: scripts.test ? runner.run("test") : framework ? `${runner.exec} ${frameworkRun[framework]}` : null,
    testFiles: framework ? `${runner.exec} ${frameworkRun[framework]} {files}` : null,
    typecheck: scripts.typecheck
      ? runner.run("typecheck")
      : exists(pkgDir, "tsconfig.json") && deps.typescript
        ? `${runner.exec} tsc --noEmit`
        : null,
    lint: scripts.lint ? runner.run("lint") : null,
  };
}

function phpEntry(pkgDir) {
  if (!exists(pkgDir, "composer.json")) return null;
  const composer = readJson(path.join(pkgDir, "composer.json"), {});
  const required = { ...composer.require, ...composer["require-dev"] };
  const has = (name) => Object.hasOwn(required, name);
  const entry = { ecosystem: "php", test: null, testFiles: null, typecheck: null, lint: null };
  if (exists(pkgDir, "artisan")) {
    entry.test = "php artisan test";
    entry.testFiles = "php artisan test {files}";
  } else if (has("pestphp/pest")) {
    entry.test = "./vendor/bin/pest";
    entry.testFiles = "./vendor/bin/pest {files}";
  } else if (has("phpunit/phpunit")) {
    entry.test = "./vendor/bin/phpunit";
    entry.testFiles = "./vendor/bin/phpunit {files}";
  }
  if (has("phpstan/phpstan") || has("larastan/larastan") || has("nunomaduro/larastan")) {
    entry.typecheck = "./vendor/bin/phpstan analyse --no-progress";
  }
  if (has("laravel/pint")) entry.lint = "./vendor/bin/pint --test";
  return entry;
}

function pythonEntry(pkgDir, pkg) {
  const pyproject = read(path.join(pkgDir, "pyproject.toml"));
  const requirements = pkg.files
    .filter((file) => !file.includes("/") && /^requirements.*\.txt$/.test(file))
    .map((file) => read(path.join(pkgDir, file)))
    .join("\n");
  const pytest =
    exists(pkgDir, "pytest.ini") || pkg.files.some((file) => file.endsWith("conftest.py")) || /pytest/.test(pyproject) || /pytest/.test(requirements);
  if (!pytest) return null;
  return {
    ecosystem: "python",
    test: "pytest -q",
    testFiles: "pytest -q {files}",
    typecheck: /\[tool\.mypy\]/.test(pyproject) || exists(pkgDir, "mypy.ini") ? "mypy ." : null,
    lint: /\[tool\.ruff/.test(pyproject) || exists(pkgDir, "ruff.toml") ? "ruff check ." : null,
  };
}

function rubyEntry(pkgDir) {
  const gemfile = read(path.join(pkgDir, "Gemfile"));
  if (!gemfile) return null;
  const lint = /rubocop/.test(gemfile) ? "bundle exec rubocop" : null;
  if (/rspec/.test(gemfile)) return { ecosystem: "ruby", test: "bundle exec rspec", testFiles: "bundle exec rspec {files}", typecheck: null, lint };
  if (/rails/.test(gemfile)) return { ecosystem: "ruby", test: "bin/rails test", testFiles: "bin/rails test {files}", typecheck: null, lint };
  return null;
}

function flutterOrDartEntry(pkgDir) {
  const pubspec = read(path.join(pkgDir, "pubspec.yaml"));
  if (!pubspec) return null;
  if (/(^|\s)flutter\s*:|sdk:\s*flutter/m.test(pubspec)) {
    return { ecosystem: "flutter", test: "flutter test", testFiles: "flutter test {files}", typecheck: "flutter analyze", lint: null };
  }
  return { ecosystem: "dart", test: "dart test", testFiles: "dart test {files}", typecheck: "dart analyze", lint: null };
}

function simpleEntry(ecosystem, test, typecheck = null, lint = null, testFiles = null) {
  return { ecosystem, test, testFiles, typecheck, lint };
}

function jvmAndDotnetEntries(pkgDir) {
  const entries = [];
  if (fs.readdirSync(pkgDir).some((name) => name.endsWith(".csproj"))) entries.push(simpleEntry("dotnet", "dotnet test", "dotnet build"));
  if (exists(pkgDir, "pom.xml")) entries.push(simpleEntry("maven", "mvn -q test"));
  if (exists(pkgDir, "build.gradle") || exists(pkgDir, "build.gradle.kts")) {
    entries.push(simpleEntry("gradle", exists(pkgDir, "gradlew") ? "./gradlew test" : "gradle test"));
  }
  return entries;
}

// One entry per matching ecosystem, in the order of docs/03 section 5.3. All-null entries are dropped.
export function verifyEntries(root, pkg) {
  const pkgDir = pkg.root === "." ? root : path.join(root, pkg.root);
  const candidates = [
    jsEntry(pkgDir, pkg),
    phpEntry(pkgDir),
    pythonEntry(pkgDir, pkg),
    exists(pkgDir, "go.mod") ? simpleEntry("go", "go test ./...", "go vet ./...", null, "go test {packages}") : null,
    exists(pkgDir, "Cargo.toml") ? simpleEntry("rust", "cargo test", "cargo check") : null,
    rubyEntry(pkgDir),
    exists(pkgDir, "mix.exs") ? simpleEntry("elixir", "mix test", null, "mix format --check-formatted", "mix test {files}") : null,
    ...jvmAndDotnetEntries(pkgDir),
    flutterOrDartEntry(pkgDir),
  ];
  return candidates
    .filter(Boolean)
    .filter((entry) => entry.test || entry.testFiles || entry.typecheck || entry.lint)
    .map((entry) => ({ root: pkg.root, ...entry }));
}

function portFrom(script, fallback) {
  const match = /--port[= ](\d+)|\s-p\s*(\d+)/.exec(script ?? "");
  return match ? match[1] ?? match[2] : fallback;
}

// First match wins, scanning packages in order (docs/03 section 5.4).
export function detectPreview(root, packages) {
  for (const pkg of packages) {
    const pkgDir = pkg.root === "." ? root : path.join(root, pkg.root);
    const runner = RUNNERS[pkg.packageManager ?? "npm"];
    const composer = readJson(path.join(pkgDir, "composer.json"), {});
    const manifest = readJson(path.join(pkgDir, "package.json"), {});
    const deps = { ...manifest.peerDependencies, ...manifest.devDependencies, ...manifest.dependencies };
    const scripts = manifest.scripts ?? {};
    const preview = (command, url) => ({ command, url, cwd: pkg.root });
    const devPreview = (fallbackPort) => preview(runner.run("dev"), `http://localhost:${portFrom(scripts.dev, fallbackPort)}`);

    if (composer.scripts?.dev && exists(pkgDir, "artisan")) return preview("composer run dev", "http://127.0.0.1:8000");
    if (exists(pkgDir, "artisan")) return preview("php artisan serve", "http://127.0.0.1:8000");
    if (scripts.dev && deps.next) return devPreview("3000");
    if (scripts.dev && deps.nuxt) return devPreview("3000");
    if (scripts.dev && deps.astro) return devPreview("4321");
    if (scripts.dev && ["vite", "@sveltejs/kit", "@remix-run/dev", "@react-router/dev"].some((name) => deps[name])) return devPreview("5173");
    if (deps["@angular/core"] && scripts.start) return preview(runner.run("start"), `http://localhost:${portFrom(scripts.start, "4200")}`);
    if (exists(pkgDir, "manage.py")) return preview("python manage.py runserver", "http://127.0.0.1:8000");
    if (/rails/.test(read(path.join(pkgDir, "Gemfile")))) return preview("bin/rails server", "http://localhost:3000");
  }
  return null;
}

// Init stores the verify commands and the preview it finds. A project on a starter has neither until a task
// writes its manifest, so until the next init they are read from the files as they are now (docs/03 section 5.6).
export function currentStack(root, config) {
  const verify = config.verify ?? [];
  if (!config.starter || (verify.length > 0 && config.preview)) return config;
  const packages = detectAll(root, []).packages;
  return {
    ...config,
    verify: verify.length > 0 ? verify : packages.flatMap((pkg) => verifyEntries(root, pkg)),
    preview: config.preview ?? detectPreview(root, packages),
  };
}

// {files}: the task's test paths relative to the package root, single-quoted for sh.
export function shellQuote(text) {
  return `'${String(text).replace(/'/g, `'\\''`)}'`;
}

export function expandTestFiles(template, testPaths, pkgRoot) {
  const relative = testPaths.map((p) => (pkgRoot === "." ? p : p.startsWith(`${pkgRoot}/`) ? p.slice(pkgRoot.length + 1) : p));
  const directories = [...new Set(relative.map((p) => path.posix.dirname(p)))].map((d) => (d === "." ? "." : `./${d}`));
  return template.replace("{files}", relative.map(shellQuote).join(" ")).replace("{packages}", directories.map(shellQuote).join(" "));
}
