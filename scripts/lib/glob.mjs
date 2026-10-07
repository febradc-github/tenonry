const REGEX_META = /[.+^$()|[\]\\{}]/;
const cache = new Map();

function escapeChar(char) {
  return REGEX_META.test(char) ? `\\${char}` : char;
}

function translate(glob) {
  let out = "";
  let i = 0;
  while (i < glob.length) {
    const char = glob[i];
    if (char === "{") {
      const close = glob.indexOf("}", i);
      if (close === -1) throw new Error(`unclosed brace in glob: ${glob}`);
      const alternatives = glob.slice(i + 1, close).split(",").map(translate);
      out += `(?:${alternatives.join("|")})`;
      i = close + 1;
    } else if (char === "}") {
      throw new Error(`unbalanced brace in glob: ${glob}`);
    } else if (char === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        out += "(?:.*/)?";
        i += 3;
      } else {
        out += ".*";
        i += 2;
      }
    } else if (char === "/" && glob.slice(i) === "/**") {
      out += "(?:/.*)?";
      i += 3;
    } else if (char === "*") {
      out += "[^/]*";
      i += 1;
    } else if (char === "?") {
      out += "[^/]";
      i += 1;
    } else {
      out += escapeChar(char);
      i += 1;
    }
  }
  return out;
}

export function compileGlob(glob) {
  if (typeof glob !== "string" || glob === "") throw new Error("glob must be a non-empty string");
  let compiled = cache.get(glob);
  if (!compiled) {
    compiled = new RegExp(`^${translate(glob)}$`);
    cache.set(glob, compiled);
  }
  return compiled;
}

export function matchGlob(glob, relPath) {
  return compileGlob(glob).test(relPath);
}
