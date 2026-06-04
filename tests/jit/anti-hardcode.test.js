import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));

const scannedRoots = [
  "src/optimizing",
  "src/runtime/tiering",
  "src/feedback",
  "src/deopt",
];

const bannedConditionPatterns = [
  {
    name: "function name dependent control flow",
    pattern:
      /\b(?:compiledFn|fn|callee|targetFn|inlineTarget|callerFn|graph|script)\.name\b/,
  },
  {
    name: "source text dependent control flow",
    pattern: /\b(?:lazySource|sourceText|sourceCode)\b/,
  },
  {
    name: "benchmark dependent control flow",
    pattern: /\b(?:benchmark|benchId|benchmarkId|testTitle)\b/i,
  },
  {
    name: "file path dependent control flow",
    pattern: /\b(?:filePath|fileName|pathName|testPath)\b/,
  },
];

function collectJavaScriptFiles(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJavaScriptFiles(fullPath));
    } else if (entry.isFile() && extname(entry.name) === ".js") {
      files.push(fullPath);
    }
  }
  return files;
}

function findControlConditions(source) {
  const conditions = [];
  const keyword = /\b(if|else\s+if|while|switch)\s*\(/g;
  let match;
  while ((match = keyword.exec(source)) !== null) {
    let index = keyword.lastIndex;
    let depth = 1;
    let quote = null;
    let escaped = false;
    while (index < source.length && depth > 0) {
      const ch = source[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
      } else if (ch === "(") {
        depth++;
      } else if (ch === ")") {
        depth--;
      }
      index++;
    }
    if (depth === 0) {
      const start = keyword.lastIndex;
      const end = index - 1;
      const condition = source.slice(start, end);
      const line = source.slice(0, start).split("\n").length;
      conditions.push({ condition, line });
    }
    keyword.lastIndex = index;
  }
  return conditions;
}

function findViolations() {
  const violations = [];
  for (const scanRoot of scannedRoots) {
    const absoluteRoot = join(root, scanRoot);
    for (const file of collectJavaScriptFiles(absoluteRoot)) {
      const source = readFileSync(file, "utf8");
      for (const { condition, line } of findControlConditions(source)) {
        for (const rule of bannedConditionPatterns) {
          if (rule.pattern.test(condition)) {
            violations.push(
              `${relative(root, file)}:${line}: ${rule.name}: ${condition.replace(/\s+/g, " ").trim()}`,
            );
          }
        }
      }
    }
  }
  return violations;
}

describe("anti-hardcode optimizer policy", () => {
  it("keeps core optimization control flow independent from names, source text, benchmark ids and file paths", () => {
    assert.deepEqual(findViolations(), []);
  });
});
