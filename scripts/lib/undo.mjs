import { loadRun, saveRun, listRunIds } from "./state.mjs";
import * as git from "./git.mjs";

// Files Tenonry itself generates are not user changes that should block an undo (D-054).
function isGeneratedByTenonry(file) {
  return file.startsWith(".tenonry/") || /^\.claude\/agents\/tenonry-[^/]+\.md$/.test(file) || file === ".gitignore";
}

function pickRun(root, runId) {
  if (runId) return loadRun(root, runId);
  const withCommits = listRunIds(root).reverse().map((id) => loadRun(root, id)).filter((run) => run && Object.values(run.tasks).some((t) => t.commit));
  return withCommits[0] ?? null;
}

// Docs/03 section 6.12: revert commits newest first; never reset, rebase, or force.
export function undo(root, runId) {
  if (!git.isGitRepo(root)) return { ok: false, reason: "not_a_git_repo" };
  const run = pickRun(root, runId);
  if (!run) return { ok: true, reverted: [], runId: null };

  const dirty = git.changedPaths(root).filter((file) => !isGeneratedByTenonry(file));
  if (dirty.length > 0) return { ok: false, reason: "uncommitted_changes", files: dirty };

  if (run.phase !== "done" && run.phase !== "stopped") {
    run.phase = "stopped";
    saveRun(root, run);
  }
  const history = git.historyShas(root);
  const shas = Object.values(run.tasks)
    .map((task) => task.commit)
    .filter((sha) => sha && history.includes(sha))
    .sort((a, b) => history.indexOf(a) - history.indexOf(b));

  const reverted = [];
  for (const sha of shas) {
    const result = git.git(root, ["revert", "--no-edit", sha]);
    if (result.status !== 0) {
      git.git(root, ["revert", "--abort"]);
      return { ok: false, reason: "conflict", reverted, stoppedAt: sha, runId: run.id };
    }
    reverted.push(sha);
  }
  run.undone = true;
  saveRun(root, run);
  return { ok: true, reverted, runId: run.id };
}
