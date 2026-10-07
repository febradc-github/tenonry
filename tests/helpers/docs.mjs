import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Returns the text between the first `<<<` and `>>>` lines that follow the heading line
// containing `headingNeedle`, as the file content (lines joined with LF, trailing newline).
export function extractBlock(docFile, headingNeedle) {
  const lines = fs.readFileSync(path.join(repoRoot, "docs", docFile), "utf8").split("\n");
  const headingIndex = lines.findIndex((line) => line.startsWith("#") && line.includes(headingNeedle));
  if (headingIndex === -1) throw new Error(`heading not found: ${headingNeedle}`);
  const start = lines.findIndex((line, i) => i > headingIndex && line === "<<<");
  const end = lines.findIndex((line, i) => i > start && line === ">>>");
  if (start === -1 || end === -1) throw new Error(`block not found under: ${headingNeedle}`);
  return lines.slice(start + 1, end).join("\n") + "\n";
}

export const TEXT_SOURCES = [
  { target: "skills/init/SKILL.md", doc: "06-AGENT-AND-SKILL-TEXTS.md", heading: "`skills/init/SKILL.md`" },
  { target: "skills/run/SKILL.md", doc: "06-AGENT-AND-SKILL-TEXTS.md", heading: "`skills/run/SKILL.md`" },
  { target: "skills/clarify-intake/SKILL.md", doc: "06-AGENT-AND-SKILL-TEXTS.md", heading: "`skills/clarify-intake/SKILL.md`" },
  { target: "library/core/planner.md", doc: "06-AGENT-AND-SKILL-TEXTS.md", heading: "`library/core/planner.md`" },
  { target: "library/core/art-director.md", doc: "06-AGENT-AND-SKILL-TEXTS.md", heading: "`library/core/art-director.md`" },
  { target: "library/core/test-author.md", doc: "06-AGENT-AND-SKILL-TEXTS.md", heading: "`library/core/test-author.md`" },
  { target: "library/core/design-reviewer.md", doc: "06-AGENT-AND-SKILL-TEXTS.md", heading: "`library/core/design-reviewer.md`" },
  { target: "library/templates/specialist.md", doc: "06-AGENT-AND-SKILL-TEXTS.md", heading: "`library/templates/specialist.md`" },
  { target: "library/templates/ui-rules.md", doc: "06-AGENT-AND-SKILL-TEXTS.md", heading: "UI rules block" },
  { target: "library/templates/code-reviewer.md", doc: "06-AGENT-AND-SKILL-TEXTS.md", heading: "`library/templates/code-reviewer.md`" },
  { target: "library/templates/ui-review-rules.md", doc: "06-AGENT-AND-SKILL-TEXTS.md", heading: "UI review rules block" },
  { target: "library/rubrics/design.md", doc: "07-QUALITY-RUBRICS.md", heading: "`library/rubrics/design.md`" },
  { target: "library/rubrics/code.md", doc: "07-QUALITY-RUBRICS.md", heading: "`library/rubrics/code.md`" },
];
