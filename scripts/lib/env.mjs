import fs from "node:fs";
import path from "node:path";

function stripQuotes(value) {
  const quote = value[0];
  if (value.length >= 2 && (quote === '"' || quote === "'") && value.at(-1) === quote) return value.slice(1, -1);
  return value;
}

function parseValue(raw) {
  const value = raw.trim();
  if (value[0] === '"' || value[0] === "'") return stripQuotes(value);
  return value.replace(/\s+#.*$/, "").trim();
}

export function parseEnv(text) {
  const env = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^export\s+/, "");
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    env[line.slice(0, eq).trim()] = parseValue(line.slice(eq + 1));
  }
  return env;
}

// Decision D-006: the key is read from the project's .env only, never from process.env.
// Values must never be logged or put in error messages, so read failures return an empty result.
export function readProjectEnv(root) {
  try {
    return parseEnv(fs.readFileSync(path.join(root, ".env"), "utf8"));
  } catch {
    return {};
  }
}

export function openRouterKey(root) {
  const key = readProjectEnv(root).OPENROUTER_API_KEY;
  return key ? key : null;
}
