import { relRunPath } from "./ctx.mjs";

const indent = (text) => text.split("\n").map((line) => `  ${line}`).join("\n");

function taskHeader(runId, task, mode) {
  const lines = [
    "TENONRY_TASK",
    `run: ${runId}`,
    `task: ${task.id}`,
    `mode: ${mode}`,
    `contract: ${relRunPath(runId, "contract.json")}`,
    `plan: ${relRunPath(runId, "plan.md")}`,
  ];
  if (task.ui) {
    lines.push("design_direction: .tenonry/design-direction.md", `design_brief: ${relRunPath(runId, "design-brief.md")}`);
  }
  lines.push(`report_to: ${relRunPath(runId, "reports", `${task.id}.json`)}`);
  return lines;
}

export function buildMessage(runId, task) {
  return taskHeader(runId, task, "build").join("\n");
}

export function fixMessage(runId, task, feedback) {
  return [...taskHeader(runId, task, "fix"), "feedback:", indent(feedback)].join("\n");
}

export function reviewMessage({ runId, task, kind, round, files, preview }) {
  const lines = ["TENONRY_REVIEW", `run: ${runId}`, `task: ${task.id}`, `kind: ${kind}`, `round: ${round}`, `contract: ${relRunPath(runId, "contract.json")}`];
  lines.push("files:", ...files.map((file) => `  - ${file}`));
  if (kind === "design") {
    lines.push(
      "design_direction: .tenonry/design-direction.md",
      `design_brief: ${relRunPath(runId, "design-brief.md")}`,
      `preview_command: ${preview?.command ?? "none"}`,
      `preview_url: ${preview?.url ?? "none"}`,
      `preview_cwd: ${preview?.cwd ?? "none"}`,
    );
  }
  lines.push(`write_to: ${relRunPath(runId, "reviews", `${task.id}.${kind}.json`)}`);
  return lines.join("\n");
}
