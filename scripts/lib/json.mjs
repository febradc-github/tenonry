import fs from "node:fs";
import path from "node:path";

export function readJson(file, fallback) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (fallback === undefined) throw error;
    return fallback;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    if (fallback === undefined) throw error;
    return fallback;
  }
}

export function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

export function appendJsonl(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(value) + "\n");
}

export function printResult(value) {
  process.stdout.write(JSON.stringify(value) + "\n");
}

export async function readStdinJson() {
  const chunks = [];
  try {
    for await (const chunk of process.stdin) chunks.push(chunk);
  } catch {
    return null;
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
