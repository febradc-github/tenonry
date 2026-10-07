#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "./lib/args.mjs";
import { findProjectRoot, rel } from "./lib/paths.mjs";
import { loadConfig, DEFAULT_OUTPUT_FILTER } from "./lib/config.mjs";
import { isMain } from "./lib/main.mjs";

const KEPT_LINES = 2000;
const TAIL_ON_FAILURE = 15;
const TAIL_ON_SUCCESS = 5;
const MAX_LOG_READ_BYTES = 50 * 1024 * 1024;
const TRAILING_CONTEXT = 2;
// The word-boundary alternatives from docs/03 section 7, plus the punctuated ones that a trailing
// \b could never match ("panic:", "failures:").
const FAILURE_LINE = /\b(?:FAIL|FAILED|Failed|ERROR|Error|error|Traceback|AssertionError|Exception|Failures)\b|--- FAIL|panic:|[Ff]ailures?:|[✗✕×]/;
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(".", "-").replace("Z", "Z");
}

function safeLabel(label) {
  return String(label || "command").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60);
}

function readLogText(file) {
  const size = fs.statSync(file).size;
  if (size <= MAX_LOG_READ_BYTES) return fs.readFileSync(file, "utf8");
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(MAX_LOG_READ_BYTES);
    fs.readSync(fd, buffer, 0, MAX_LOG_READ_BYTES, size - MAX_LOG_READ_BYTES);
    return buffer.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function splitLines(text) {
  const lines = text.replace(ANSI, "").split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

// Pure filter: failure lines (with trailing context) plus the last lines on failure; the last lines on success.
export function filterLines(allLines, exitCode, maxLines) {
  const lines = allLines.slice(-KEPT_LINES);
  if (exitCode === 0) return lines.slice(-TAIL_ON_SUCCESS);
  const tailStart = Math.max(0, lines.length - TAIL_ON_FAILURE);
  const budget = Math.max(0, maxLines - TAIL_ON_FAILURE - 1);
  const picked = new Set();
  const seenText = new Set();
  const matched = [];
  for (let i = 0; i < tailStart && matched.length < budget; i++) {
    if (!FAILURE_LINE.test(lines[i])) continue;
    for (let j = i; j <= Math.min(i + TRAILING_CONTEXT, tailStart - 1); j++) {
      if (picked.has(j) || seenText.has(lines[j])) continue;
      if (matched.length >= budget) break;
      picked.add(j);
      seenText.add(lines[j]);
      matched.push(lines[j]);
    }
  }
  return [...matched, ...lines.slice(tailStart)];
}

function lastNonEmpty(lines) {
  const line = [...lines].reverse().find((l) => l.trim() !== "") ?? "";
  return line.trim().slice(0, 200);
}

export function runFiltered({ command, cwd, label, root, maxLines }) {
  const projectRoot = root ?? findProjectRoot(cwd);
  const limit = maxLines ?? (projectRoot ? loadConfig(projectRoot).outputFilter.maxLines : DEFAULT_OUTPUT_FILTER.maxLines);
  const logDir = projectRoot ? path.join(projectRoot, ".tenonry", "logs", "exec") : os.tmpdir();
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, `${timestamp()}-${process.pid}-${safeLabel(label)}.log`);

  const fd = fs.openSync(logPath, "w");
  let result;
  try {
    result = spawnSync("/bin/sh", ["-c", command], { cwd, stdio: ["ignore", fd, fd], env: process.env });
  } finally {
    fs.closeSync(fd);
  }
  if (result.error) fs.appendFileSync(logPath, `tenonry: could not run command: ${result.error.message}\n`);
  const exitCode = typeof result.status === "number" ? result.status : 1;

  const fullText = readLogText(logPath);
  const allLines = splitLines(fullText);
  const logRel = projectRoot ? rel(projectRoot, logPath) : logPath;
  const header = `[tenonry] ${label} exit=${exitCode} log=${logRel}`;
  const body = filterLines(allLines, exitCode, limit);
  return {
    exitCode,
    header,
    body,
    text: [header, ...body].join("\n"),
    summary: lastNonEmpty(allLines),
    log: logRel,
    logPath,
    fullOutput: fullText,
  };
}

function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const command = Buffer.from(flags.b64 ?? "", "base64").toString("utf8");
  if (!command) {
    process.stderr.write("tenonry exec-filter: missing --b64 command\n");
    return 2;
  }
  const result = runFiltered({ command, cwd: flags.cwd || process.cwd(), label: flags.label });
  process.stdout.write(result.text + "\n");
  return result.exitCode;
}

if (isMain(import.meta.url)) {
  process.exitCode = main();
}
