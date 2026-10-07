import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { repoRoot } from "./docs.mjs";
import { runNode } from "./run.mjs";

export function tempDir(prefix = "tenonry-test-") {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

export function copyDir(from, to) {
  fs.cpSync(from, to, { recursive: true });
}

// Copies the plugin scripts into <root>/.tenonry/bin the way init does (used before init exists in tests).
export function installBin(root) {
  const bin = path.join(root, ".tenonry", "bin");
  fs.mkdirSync(bin, { recursive: true });
  for (const name of ["tenonry.mjs", "exec-filter.mjs", "hook-ownership-guard.mjs"]) {
    const source = path.join(repoRoot, "scripts", name);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(bin, name));
  }
  copyDir(path.join(repoRoot, "scripts", "lib"), path.join(bin, "lib"));
  fs.mkdirSync(path.join(bin, "library"), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, "library", "catalog.json"), path.join(bin, "library", "catalog.json"));
}

export function makeProject({ config = {}, bin = true } = {}) {
  const root = tempDir();
  fs.mkdirSync(path.join(root, ".tenonry"), { recursive: true });
  fs.writeFileSync(path.join(root, ".tenonry", "config.json"), JSON.stringify({ version: 1, ...config }, null, 2));
  if (bin) installBin(root);
  return root;
}

export function git(root, ...args) {
  const result = spawnSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

export function gitInit(root) {
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "test");
  git(root, "config", "user.email", "test@example.com");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init", "--allow-empty");
}

export const fixturePath = (name) => path.join(repoRoot, "tests", "fixtures", name);

// A temporary copy of a fixture. With `git: true` it is also a committed git repository.
export function fixtureCopy(name, { git: withGit = true } = {}) {
  const root = tempDir(`tenonry-${name}-`);
  copyDir(fixturePath(name), root);
  if (withGit) gitInit(root);
  return root;
}

export function runInit(root, ...flags) {
  return runNode(path.join(repoRoot, "scripts", "init.mjs"), ["--project", root, ...flags]);
}
