import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isGitRepo, head, changedPaths, hashFile, snapshot, diffSince, commit, restore } from "../scripts/lib/git.mjs";
import { tempDir, gitInit, git } from "./helpers/project.mjs";

function repo() {
  const root = tempDir();
  fs.writeFileSync(path.join(root, "a.txt"), "a\n");
  fs.mkdirSync(path.join(root, "sub dir"));
  fs.writeFileSync(path.join(root, "sub dir", "b.txt"), "b\n");
  gitInit(root);
  return root;
}

test("isGitRepo and head", () => {
  const root = repo();
  assert.equal(isGitRepo(root), true);
  assert.match(head(root), /^[0-9a-f]{40}$/);
  const plain = tempDir();
  assert.equal(isGitRepo(plain), false);
  assert.equal(head(plain), null);
});

test("head is null for a repository without commits", () => {
  const root = tempDir();
  git(root, "init", "-q", "-b", "main");
  assert.equal(isGitRepo(root), true);
  assert.equal(head(root), null);
});

test("changedPaths lists modified, untracked, deleted, and renamed files, including spaces", () => {
  const root = repo();
  fs.writeFileSync(path.join(root, "a.txt"), "changed\n");
  fs.writeFileSync(path.join(root, "new file.txt"), "n\n");
  fs.mkdirSync(path.join(root, "fresh"));
  fs.writeFileSync(path.join(root, "fresh", "x.txt"), "x\n");
  fs.rmSync(path.join(root, "sub dir", "b.txt"));
  assert.deepEqual(changedPaths(root).sort(), ["a.txt", "fresh/x.txt", "new file.txt", "sub dir/b.txt"]);

  git(root, "mv", "a.txt", "renamed.txt");
  assert.ok(changedPaths(root).includes("renamed.txt"));
  assert.ok(!changedPaths(root).includes("a.txt"));
});

test("hashFile hashes content and returns null for missing files and directories", () => {
  const root = repo();
  assert.match(hashFile(root, "a.txt"), /^[0-9a-f]{40}$/);
  assert.equal(hashFile(root, "missing.txt"), null);
  assert.equal(hashFile(root, "sub dir"), null);
});

test("diffSince counts new, changed, and newly dirty paths but not unchanged dirty ones", () => {
  const root = repo();
  fs.writeFileSync(path.join(root, "a.txt"), "dirty at baseline\n");
  const base = snapshot(root);
  assert.deepEqual(Object.keys(base.files), ["a.txt"]);
  assert.deepEqual(diffSince(root, base), []);

  fs.writeFileSync(path.join(root, "a.txt"), "edited again\n");
  fs.writeFileSync(path.join(root, "new.txt"), "n\n");
  fs.writeFileSync(path.join(root, "sub dir", "b.txt"), "b2\n");
  assert.deepEqual(diffSince(root, base).sort(), ["a.txt", "new.txt", "sub dir/b.txt"]);
});

test("diffSince drops paths that were dirty at baseline and are clean now", () => {
  const root = repo();
  fs.writeFileSync(path.join(root, "a.txt"), "dirty\n");
  const base = snapshot(root);
  git(root, "checkout", "--", "a.txt");
  assert.deepEqual(diffSince(root, base), []);
});

test("diffSince treats a file deleted both then and now as unchanged", () => {
  const root = repo();
  fs.rmSync(path.join(root, "a.txt"));
  const base = snapshot(root);
  assert.equal(base.files["a.txt"], null);
  assert.deepEqual(diffSince(root, base), []);
});

test("commit commits exactly the given paths and leaves other staged files alone", () => {
  const root = repo();
  fs.writeFileSync(path.join(root, "a.txt"), "task change\n");
  fs.writeFileSync(path.join(root, "new.txt"), "new\n");
  fs.writeFileSync(path.join(root, "other.txt"), "other\n");
  git(root, "add", "other.txt");
  const result = commit(root, ["a.txt", "new.txt"], "tenonry(T1): thing");
  assert.match(result.sha, /^[0-9a-f]{40}$/);
  assert.deepEqual(git(root, "show", "--name-only", "--format=", "HEAD").split("\n").sort(), ["a.txt", "new.txt"]);
  assert.equal(git(root, "log", "-1", "--format=%s"), "tenonry(T1): thing");
  assert.equal(git(root, "diff", "--cached", "--name-only"), "other.txt");
});

test("commit records deletions and reports failures", () => {
  const root = repo();
  fs.rmSync(path.join(root, "a.txt"));
  assert.ok(commit(root, ["a.txt"], "remove").sha);
  assert.equal(commit(root, ["a.txt"], "nothing left").error !== undefined, true);
  assert.equal(commit(root, [], "x").error, "no_paths");
});

test("commit does not bypass a failing pre-commit hook", () => {
  const root = repo();
  const hook = path.join(root, ".git", "hooks", "pre-commit");
  fs.writeFileSync(hook, "#!/bin/sh\necho blocked by hook >&2\nexit 1\n", { mode: 0o755 });
  fs.writeFileSync(path.join(root, "a.txt"), "x\n");
  const result = commit(root, ["a.txt"], "msg");
  assert.ok(result.error);
  assert.match(result.error, /blocked by hook/);
});

test("restore reverts a tracked file, deletes a new file, and refuses dirty-at-baseline paths", () => {
  const root = repo();
  fs.writeFileSync(path.join(root, "a.txt"), "dirty at baseline\n");
  const base = snapshot(root);
  fs.writeFileSync(path.join(root, "sub dir", "b.txt"), "violation\n");
  fs.writeFileSync(path.join(root, "created.txt"), "violation\n");

  assert.deepEqual(restore(root, "sub dir/b.txt", base), { restored: true });
  assert.equal(fs.readFileSync(path.join(root, "sub dir", "b.txt"), "utf8"), "b\n");
  assert.deepEqual(restore(root, "created.txt", base), { restored: true });
  assert.ok(!fs.existsSync(path.join(root, "created.txt")));
  assert.deepEqual(restore(root, "a.txt", base), { restored: false, reason: "dirty_at_baseline" });
  assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf8"), "dirty at baseline\n");
});
