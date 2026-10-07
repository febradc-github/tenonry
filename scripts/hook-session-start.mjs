#!/usr/bin/env node
import { pluginRoot } from "./lib/paths.mjs";

try {
  const root = pluginRoot();
  if (root) {
    const output = {
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: `TENONRY_PLUGIN_ROOT=${root}` },
    };
    process.stdout.write(JSON.stringify(output) + "\n");
  }
} catch {
  // fail open
}
