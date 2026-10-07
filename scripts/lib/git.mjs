import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function git(root, args, { input } = {}) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024 });
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export function isGitRepo(root) {
  const result = git(root, ["rev-parse", "--is-inside-work-tree"]);
  return result.status === 0 && result.stdout.trim() === "true";
}

export function head(root) {
  const result = git(root, ["rev-parse", "--verify", "-q", "HEAD"]);
  return result.status === 0 ? result.stdout.trim() : null;
}

// Paths from `git status --porcelain=v1 -z -uall`; for renames and copies, the new path.
export function changedPaths(root) {
  const result = git(root, ["status", "--porcelain=v1", "-z", "-uall"]);
  if (result.status !== 0) return [];
  const fields = result.stdout.split("\0");
  const paths = [];
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i];
    if (entry.length < 4) continue;
    paths.push(entry.slice(3));
    if (entry[0] === "R" || entry[0] === "C") i += 1;
  }
  return paths;
}

export function hashFile(root, relPath) {
  try {
    const full = path.join(root, relPath);
    if (!fs.statSync(full).isFile()) return null;
    return crypto.createHash("sha1").update(fs.readFileSync(full)).digest("hex");
  } catch {
    return null;
  }
}

export function snapshot(root) {
  const files = {};
  for (const relPath of changedPaths(root)) files[relPath] = hashFile(root, relPath);
  return { head: head(root), files };
}

// Paths whose content differs from the baseline. A path absent from the snapshot was clean then.
export function diffSince(root, baseline) {
  const before = baseline?.files ?? {};
  return changedPaths(root).filter((relPath) => !Object.hasOwn(before, relPath) || before[relPath] !== hashFile(root, relPath));
}

export function isTracked(root, relPath) {
  return git(root, ["ls-files", "--error-unmatch", "--", relPath]).status === 0;
}

// Never uses --no-verify, so the user's git hooks still run.
export function commit(root, paths, message) {
  if (paths.length === 0) return { error: "no_paths" };
  const added = git(root, ["add", "-A", "--", ...paths]);
  if (added.status !== 0) return { error: added.stderr.trim() || "git add failed" };
  const committed = git(root, ["commit", "-m", message, "--", ...paths]);
  if (committed.status !== 0) return { error: (committed.stderr || committed.stdout).trim() || "git commit failed" };
  return { sha: head(root) };
}

export function restore(root, relPath, baseline) {
  if (Object.hasOwn(baseline?.files ?? {}, relPath)) return { restored: false, reason: "dirty_at_baseline" };
  if (isTracked(root, relPath)) {
    const result = git(root, ["restore", "--source=HEAD", "--staged", "--worktree", "--", relPath]);
    return result.status === 0 ? { restored: true } : { restored: false, reason: result.stderr.trim() };
  }
  try {
    fs.rmSync(path.join(root, relPath), { force: true });
    return { restored: true };
  } catch (error) {
    return { restored: false, reason: error.message };
  }
}
