import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { loadConfig } from "./config.mjs";
import { currentStack } from "./stack.mjs";
import { readProjectEnv } from "./env.mjs";

const LOG_REL = ".tenonry/logs/preview.log";
const PID_REL = ".tenonry/logs/preview.pid";
const PROBE_TIMEOUT_MS = 2000;
const POLL_INTERVAL_MS = 2000;
const READY_TIMEOUT_MS = 90000;
const STOP_GRACE_MS = 5000;
const STOP_CHECK_MS = 100;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Test-only overrides so the suite does not wait for the real 90-second budget.
const envNumber = (name, fallback) => (Number(process.env[name]) > 0 ? Number(process.env[name]) : fallback);

// True when the URL answers a GET with a 2xx or 3xx status within two seconds.
export async function urlAnswers(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { redirect: "manual", signal: controller.signal });
    return response.status >= 200 && response.status < 400;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function groupAlive(pgid) {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

// The leader's start time ties a pid file to one process, so a recycled pid is never mistaken for our preview.
function startTime(pid) {
  const result = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function readPidFile(root) {
  try {
    const [pgid, startedAt] = fs.readFileSync(path.join(root, PID_REL), "utf8").split("\n");
    return Number(pgid) > 1 ? { pgid: Number(pgid), startedAt: startedAt ?? "" } : null;
  } catch {
    return null;
  }
}

function signalGroup(pgid, signal) {
  try {
    process.kill(-pgid, signal);
  } catch {
    // already gone
  }
}

// Stops only a preview that Tenonry started (docs/03 section 6).
export async function previewStop(root) {
  const recorded = readPidFile(root);
  fs.rmSync(path.join(root, PID_REL), { force: true });
  if (!recorded) return { stopped: false };
  const ours = groupAlive(recorded.pgid) && recorded.startedAt !== "" && startTime(recorded.pgid) === recorded.startedAt;
  if (!ours) return { stopped: false };

  signalGroup(recorded.pgid, "SIGTERM");
  const deadline = Date.now() + STOP_GRACE_MS;
  while (groupAlive(recorded.pgid) && Date.now() < deadline) await sleep(STOP_CHECK_MS);
  if (groupAlive(recorded.pgid)) signalGroup(recorded.pgid, "SIGKILL");
  return { stopped: true };
}

function launch(root, preview) {
  const logFile = path.join(root, LOG_REL);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const fd = fs.openSync(logFile, "a");
  try {
    const cwd = path.resolve(root, preview.cwd ?? ".");
    const child = spawn("/bin/sh", ["-c", preview.command], { cwd, detached: true, stdio: ["ignore", fd, fd] });
    child.unref();
    return child;
  } finally {
    fs.closeSync(fd);
  }
}

async function waitUntilReady(url, child) {
  let exitCode = null;
  child.on("exit", (code) => {
    exitCode = code ?? 1;
  });
  child.on("error", () => {
    exitCode = 1;
  });
  const deadline = Date.now() + envNumber("TENONRY_PREVIEW_TIMEOUT_MS", READY_TIMEOUT_MS);
  const interval = envNumber("TENONRY_PREVIEW_POLL_MS", POLL_INTERVAL_MS);
  while (Date.now() < deadline) {
    if (await urlAnswers(url)) return true;
    // A command that already failed will never listen; one that exited cleanly may have left a server behind.
    if (exitCode !== null && exitCode !== 0) return false;
    await sleep(Math.min(interval, Math.max(0, deadline - Date.now())));
  }
  return urlAnswers(url);
}

export async function previewStart(root) {
  const preview = currentStack(root, loadConfig(root)).preview ?? null;
  if (preview?.url && (await urlAnswers(preview.url))) return { ok: true, reused: true, url: preview.url };
  if (!preview?.command || !preview.url) return { ok: false, reason: "no_preview" };

  await previewStop(root);
  const child = launch(root, preview);
  if (child.pid) fs.writeFileSync(path.join(root, PID_REL), `${child.pid}\n${startTime(child.pid)}\n`);
  if (child.pid && (await waitUntilReady(preview.url, child))) return { ok: true, reused: false, url: preview.url, pid: child.pid };

  await previewStop(root);
  return { ok: false, reason: "preview_failed", log: LOG_REL };
}

function joinUrl(base, pathPart) {
  if (!base) return pathPart;
  return `${base.replace(/\/+$/, "")}/${pathPart.replace(/^\/+/, "")}`;
}

// Sign-in details for the design reviewer, from the project .env only. Never logged or written anywhere.
export function previewCredentials(root) {
  const env = readProjectEnv(root);
  const user = env.TENONRY_PREVIEW_USER;
  const password = env.TENONRY_PREVIEW_PASSWORD;
  if (!user || !password) return { available: false };
  const base = currentStack(root, loadConfig(root)).preview?.url ?? null;
  const configured = env.TENONRY_PREVIEW_LOGIN_URL;
  const isFullUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(configured ?? "");
  const loginUrl = isFullUrl ? configured : joinUrl(base, configured || "/login");
  return { available: true, loginUrl, user, password };
}

export const loginAvailable = (root) => previewCredentials(root).available;
