import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { makeProject } from "./helpers/project.mjs";
import { runNode, runNodeAsync } from "./helpers/run.mjs";
import { previewCredentials } from "../scripts/lib/preview.mjs";

const FAST = { TENONRY_PREVIEW_POLL_MS: "100" };
const cliPath = (root) => path.join(root, ".tenonry", "bin", "tenonry.mjs");
const cli = (root, command, env = {}) => runNode(cliPath(root), [command], { cwd: root, env: { ...FAST, ...env } });
const pidFile = (root) => path.join(root, ".tenonry", "logs", "preview.pid");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function answers(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    return false;
  }
}

function projectWithPreview(preview) {
  const root = makeProject({ config: { preview } });
  fs.writeFileSync(
    path.join(root, "serve.mjs"),
    'import http from "node:http";\nhttp.createServer((req, res) => res.end("preview ok")).listen(Number(process.argv[2]), "127.0.0.1", () => console.log("listening"));\n',
  );
  return root;
}

test("preview-start reuses a server that already answers", async () => {
  const server = http.createServer((req, res) => res.end("ok"));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const root = projectWithPreview({ command: "exit 1", url, cwd: "." });
    const result = await runNodeAsync(cliPath(root), ["preview-start"], { cwd: root, env: FAST });
    assert.deepEqual(result.json, { ok: true, reused: true, url });
    assert.ok(!fs.existsSync(pidFile(root)), "nothing was started, so nothing is recorded");
    assert.deepEqual((await runNodeAsync(cliPath(root), ["preview-stop"], { cwd: root })).json, { ok: true, stopped: false });
    assert.equal(await answers(url), true, "a reused server is never stopped");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("preview-start treats a redirect as an answer", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(302, { location: "/login" });
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const root = projectWithPreview({ command: null, url, cwd: "." });
    assert.equal((await runNodeAsync(cliPath(root), ["preview-start"], { cwd: root })).json.reused, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("preview-start starts the command, records its process group, and preview-stop stops it", async () => {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const root = projectWithPreview({ command: `node serve.mjs ${port}`, url, cwd: "." });
  const started = cli(root, "preview-start").json;
  try {
    assert.equal(started.ok, true);
    assert.equal(started.reused, false);
    assert.equal(started.url, url);
    assert.ok(Number.isInteger(started.pid) && started.pid > 1);
    assert.equal(fs.readFileSync(pidFile(root), "utf8").split("\n")[0], String(started.pid));
    assert.equal(await answers(url), true);
    assert.match(fs.readFileSync(path.join(root, ".tenonry", "logs", "preview.log"), "utf8"), /listening/);
    assert.deepEqual(cli(root, "preview-start").json, { ok: true, reused: true, url }, "a second start reuses it");
  } finally {
    assert.deepEqual(cli(root, "preview-stop").json, { ok: true, stopped: true });
  }
  assert.ok(!fs.existsSync(pidFile(root)));
  assert.equal(alive(started.pid), false);
  assert.equal(await answers(url), false);
  assert.deepEqual(cli(root, "preview-stop").json, { ok: true, stopped: false });
});

test("preview-start runs the command in the configured directory", async () => {
  const port = await freePort();
  const root = projectWithPreview({ command: `node ../serve.mjs ${port}`, url: `http://127.0.0.1:${port}`, cwd: "web" });
  fs.mkdirSync(path.join(root, "web"));
  try {
    assert.equal(cli(root, "preview-start").json.ok, true);
  } finally {
    cli(root, "preview-stop");
  }
});

test("preview-start reports preview_failed and kills the process group when nothing listens", async () => {
  const port = await freePort();
  const root = projectWithPreview({ command: "echo $$ > leader.pid; exec sleep 30", url: `http://127.0.0.1:${port}`, cwd: "." });
  const started = Date.now();
  const result = cli(root, "preview-start", { TENONRY_PREVIEW_TIMEOUT_MS: "700" }).json;
  assert.deepEqual(result, { ok: false, reason: "preview_failed", log: ".tenonry/logs/preview.log" });
  assert.ok(Date.now() - started < 10000);
  const leader = Number(fs.readFileSync(path.join(root, "leader.pid"), "utf8"));
  await sleep(200);
  assert.equal(alive(leader), false, "the command was stopped");
  assert.ok(!fs.existsSync(pidFile(root)));
});

test("preview-start fails fast when the command itself fails", async () => {
  const port = await freePort();
  const root = projectWithPreview({ command: "echo boom >&2; exit 3", url: `http://127.0.0.1:${port}`, cwd: "." });
  const started = Date.now();
  const result = cli(root, "preview-start", { TENONRY_PREVIEW_TIMEOUT_MS: "20000" }).json;
  assert.equal(result.reason, "preview_failed");
  assert.ok(Date.now() - started < 8000, "does not wait for the full timeout");
  assert.match(fs.readFileSync(path.join(root, ".tenonry", "logs", "preview.log"), "utf8"), /boom/);
});

test("preview-start returns no_preview without a command", async () => {
  const port = await freePort();
  for (const preview of [null, { command: null, url: null, cwd: "." }, { command: null, url: `http://127.0.0.1:${port}`, cwd: "." }]) {
    const root = projectWithPreview(preview);
    assert.deepEqual(cli(root, "preview-start").json, { ok: false, reason: "no_preview" });
  }
});

test("preview-stop never touches a process it did not start", async () => {
  const root = projectWithPreview(null);
  const bystander = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
  bystander.unref();
  try {
    fs.mkdirSync(path.dirname(pidFile(root)), { recursive: true });
    fs.writeFileSync(pidFile(root), `${bystander.pid}\nMon Jan  1 00:00:00 2001\n`);
    assert.deepEqual(cli(root, "preview-stop").json, { ok: true, stopped: false });
    assert.equal(alive(bystander.pid), true, "a recycled or foreign pid is left alone");
    assert.ok(!fs.existsSync(pidFile(root)), "the stale pid file is removed");

    fs.writeFileSync(pidFile(root), "not a pid\n");
    assert.deepEqual(cli(root, "preview-stop").json, { ok: true, stopped: false });
    fs.writeFileSync(pidFile(root), "1\n\n");
    assert.deepEqual(cli(root, "preview-stop").json, { ok: true, stopped: false });
  } finally {
    process.kill(-bystander.pid, "SIGKILL");
  }
});

function withEnv(preview, envText) {
  const root = makeProject({ config: { preview } });
  if (envText !== undefined) fs.writeFileSync(path.join(root, ".env"), envText);
  return root;
}

const PREVIEW = { command: "npm run dev", url: "http://localhost:5173", cwd: "." };

test("preview-credentials defaults the login URL to /login on the preview URL", () => {
  const root = withEnv(PREVIEW, "TENONRY_PREVIEW_USER=test@example.com\nTENONRY_PREVIEW_PASSWORD=local-secret-1\n");
  assert.deepEqual(cli(root, "preview-credentials").json, {
    ok: true, available: true, loginUrl: "http://localhost:5173/login", user: "test@example.com", password: "local-secret-1",
  });
});

test("preview-credentials joins a path and keeps a full URL", () => {
  const base = "TENONRY_PREVIEW_USER=u\nTENONRY_PREVIEW_PASSWORD=p\n";
  assert.equal(previewCredentials(withEnv(PREVIEW, `${base}TENONRY_PREVIEW_LOGIN_URL=/auth/sign-in\n`)).loginUrl, "http://localhost:5173/auth/sign-in");
  assert.equal(previewCredentials(withEnv(PREVIEW, `${base}TENONRY_PREVIEW_LOGIN_URL=auth/sign-in\n`)).loginUrl, "http://localhost:5173/auth/sign-in");
  assert.equal(previewCredentials(withEnv({ ...PREVIEW, url: "http://localhost:5173/" }, `${base}TENONRY_PREVIEW_LOGIN_URL=/x\n`)).loginUrl, "http://localhost:5173/x");
  assert.equal(previewCredentials(withEnv(PREVIEW, `${base}TENONRY_PREVIEW_LOGIN_URL=https://sso.example.test/login?next=/\n`)).loginUrl, "https://sso.example.test/login?next=/");
  assert.equal(previewCredentials(withEnv(null, `${base}TENONRY_PREVIEW_LOGIN_URL=/x\n`)).loginUrl, "/x");
});

test("preview-credentials is unavailable when either value is missing", () => {
  const cases = [undefined, "", "TENONRY_PREVIEW_USER=u\n", "TENONRY_PREVIEW_PASSWORD=p\n", "TENONRY_PREVIEW_USER=u\nTENONRY_PREVIEW_PASSWORD=\n", "TENONRY_PREVIEW_LOGIN_URL=/login\n"];
  for (const envText of cases) {
    assert.deepEqual(cli(withEnv(PREVIEW, envText), "preview-credentials").json, { ok: true, available: false }, String(envText));
  }
});

test("preview-credentials reads the project .env only, never the process environment", () => {
  const root = withEnv(PREVIEW, "");
  const result = cli(root, "preview-credentials", { TENONRY_PREVIEW_USER: "env-user", TENONRY_PREVIEW_PASSWORD: "env-pass" });
  assert.deepEqual(result.json, { ok: true, available: false });
});
