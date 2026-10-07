// Minimal argv parser: `--name value` pairs become flags, everything else is positional.
export function parseArgs(argv, booleanFlags = []) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (booleanFlags.includes(name)) {
      flags[name] = true;
    } else {
      flags[name] = argv[i + 1] ?? "";
      i += 1;
    }
  }
  return { positional, flags };
}
