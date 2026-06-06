import terminalKit from "terminal-kit";
import cliHighlight from "cli-highlight";
import { tracer } from "../core/tracing/index.js";
import { isObject, getPayload, toDisplayString } from "../core/value/index.js";
import { runtimeOwnKeys } from "../objects/exotic/proxy-ops.js";

const term = terminalKit.terminal;
const highlightCode = cliHighlight.highlight || cliHighlight.default?.highlight;
const HISTORY_LIMIT = 200;
const COMMANDS = [
  ".exit",
  ".quit",
  ".help",
  ".trace",
  ".stats",
  ".reset",
  ".dis",
];
const TOKEN_REGEX =
  /(\/\/.*)|("(\\.|[^"])*")|('(\\.|[^'])*')|(`(\\.|[^`])*`)|(\b\d+(\.\d+)?\b)|(\b[a-zA-Z_$][a-zA-Z0-9_$]*\b)|([+\-*/%=<>!&|^~]+)|([{}[\]().,;:])|(\s+)/g;
const PAIRS = new Map([
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
  ['"', '"'],
  ["'", "'"],
  ["`", "`"],
]);
const CLOSERS = new Set(PAIRS.values());
const GLOBAL_COMPLETIONS = [
  "Array",
  "ArrayBuffer",
  "BigInt",
  "Boolean",
  "Date",
  "Error",
  "EvalError",
  "Function",
  "Infinity",
  "Intl",
  "JSON",
  "Map",
  "Math",
  "NaN",
  "Number",
  "Object",
  "Promise",
  "Proxy",
  "RangeError",
  "ReferenceError",
  "Reflect",
  "RegExp",
  "Set",
  "String",
  "Symbol",
  "SyntaxError",
  "TypeError",
  "URIError",
  "WeakMap",
  "WeakSet",
  "clearInterval",
  "clearTimeout",
  "console",
  "decodeURI",
  "decodeURIComponent",
  "encodeURI",
  "encodeURIComponent",
  "globalThis",
  "isFinite",
  "isNaN",
  "parseFloat",
  "parseInt",
  "queueMicrotask",
  "setInterval",
  "setTimeout",
];
const BUILTIN_KEYS = new Map(
  Object.entries({
    Array: Object.getOwnPropertyNames(Array),
    ArrayBuffer: Object.getOwnPropertyNames(ArrayBuffer),
    BigInt: Object.getOwnPropertyNames(BigInt),
    Boolean: Object.getOwnPropertyNames(Boolean),
    Date: Object.getOwnPropertyNames(Date),
    Error: Object.getOwnPropertyNames(Error),
    Function: Object.getOwnPropertyNames(Function),
    Intl: Object.getOwnPropertyNames(Intl),
    JSON: Object.getOwnPropertyNames(JSON),
    Map: Object.getOwnPropertyNames(Map),
    Number: Object.getOwnPropertyNames(Number),
    Object: Object.getOwnPropertyNames(Object),
    Promise: Object.getOwnPropertyNames(Promise),
    Reflect: Object.getOwnPropertyNames(Reflect),
    RegExp: Object.getOwnPropertyNames(RegExp),
    Set: Object.getOwnPropertyNames(Set),
    String: Object.getOwnPropertyNames(String),
    Symbol: Object.getOwnPropertyNames(Symbol),
    WeakMap: Object.getOwnPropertyNames(WeakMap),
    WeakSet: Object.getOwnPropertyNames(WeakSet),
    console: Object.getOwnPropertyNames(console),
    globalThis: Object.getOwnPropertyNames(globalThis),
    Math: Object.getOwnPropertyNames(Math),
  }),
);
const PROTOTYPE_KEYS = new Map(
  Object.entries({
    Array: Object.getOwnPropertyNames(Array.prototype),
    ArrayBuffer: Object.getOwnPropertyNames(ArrayBuffer.prototype),
    Boolean: Object.getOwnPropertyNames(Boolean.prototype),
    Date: Object.getOwnPropertyNames(Date.prototype),
    Error: Object.getOwnPropertyNames(Error.prototype),
    Function: Object.getOwnPropertyNames(Function.prototype),
    Map: Object.getOwnPropertyNames(Map.prototype),
    Number: Object.getOwnPropertyNames(Number.prototype),
    Object: Object.getOwnPropertyNames(Object.prototype),
    Promise: Object.getOwnPropertyNames(Promise.prototype),
    RegExp: Object.getOwnPropertyNames(RegExp.prototype),
    Set: Object.getOwnPropertyNames(Set.prototype),
    String: Object.getOwnPropertyNames(String.prototype),
    Symbol: Object.getOwnPropertyNames(Symbol.prototype),
    WeakMap: Object.getOwnPropertyNames(WeakMap.prototype),
    WeakSet: Object.getOwnPropertyNames(WeakSet.prototype),
  }),
);

const KEYWORDS = new Set([
  "let",
  "const",
  "var",
  "function",
  "if",
  "else",
  "while",
  "for",
  "do",
  "return",
  "true",
  "false",
  "null",
  "undefined",
  "new",
  "this",
  "typeof",
  "instanceof",
  "switch",
  "case",
  "default",
  "break",
  "continue",
  "try",
  "catch",
  "finally",
  "throw",
  "class",
  "extends",
  "super",
  "in",
  "of",
  "async",
  "await",
  "yield",
  "delete",
  "void",
]);

function extractLocalVars(code, set) {
  let m;
  const funcClassRegex = /\b(?:function|class)\s+([a-zA-Z_$][0-9a-zA-Z_$]*)/g;
  while ((m = funcClassRegex.exec(code)) !== null) {
    if (m[1]) set.add(m[1]);
  }

  const varDeclRegex = /\b(?:let|const|var)\s+([^;\n]+)/g;
  while ((m = varDeclRegex.exec(code)) !== null) {
    const decls = m[1].split(",");
    for (const decl of decls) {
      const match = decl.trim().match(/^[a-zA-Z_$][0-9a-zA-Z_$]*/);
      if (match) set.add(match[0]);
    }
  }
}

function extractReplMetadata(code, context) {
  extractLocalVars(code, context.vars);

  const objectDeclRegex =
    /\b(?:let|const|var)?\s*([a-zA-Z_$][0-9a-zA-Z_$]*)\s*=\s*\{([^}]*)\}/g;
  let objectMatch;
  while ((objectMatch = objectDeclRegex.exec(code)) !== null) {
    const keys = [];
    const keyRegex =
      /(?:^|,)\s*(?:([a-zA-Z_$][0-9a-zA-Z_$]*)|["']([^"']+)["'])\s*:/g;
    let keyMatch;
    while ((keyMatch = keyRegex.exec(objectMatch[2])) !== null) {
      keys.push(keyMatch[1] || keyMatch[2]);
    }
    if (keys.length) {
      context.objectKeys.set(objectMatch[1], keys);
      context.types.set(objectMatch[1], "Object");
    }
  }

  const assignRegex =
    /\b(?:let|const|var)?\s*([a-zA-Z_$][0-9a-zA-Z_$]*)\s*=\s*([^;\n]+)/g;
  let assignMatch;
  while ((assignMatch = assignRegex.exec(code)) !== null) {
    const type = inferInitializerType(assignMatch[2].trim());
    if (type) context.types.set(assignMatch[1], type);
  }
}

function getCompletions(word, engine, context, currentLine = "") {
  const globals =
    engine.interpreter.globalCells && engine.interpreter.globalCells.cells
      ? Array.from(engine.interpreter.globalCells.cells.keys())
      : [];

  const baseCompletions = Array.from(
    new Set([
      ...Array.from(context.vars),
      ...globals,
      ...GLOBAL_COMPLETIONS,
      ...KEYWORDS,
    ]),
  );

  const parts = word.split(".");
  if (parts.length === 1) {
    return baseCompletions.filter((c) => c.startsWith(word));
  }

  const prefix = parts.pop();
  const objExpr = parts.join(".");
  let keys = getStaticKeys(objExpr, currentLine, context);

  try {
    if (keys.length === 0) {
      const ptr = engine.run(objExpr);
      if (isObject(ptr)) {
        keys = runtimeOwnKeys(ptr, engine.interpreter);
      } else {
        const payload = getPayload(ptr);
        if (payload && payload.properties) keys = Object.keys(payload.properties);
      }
    }
  } catch {}

  return rankCompletions(keys, prefix).map((k) => objExpr + "." + k);
}

function getStaticKeys(objExpr, currentLine, context) {
  if (context.objectKeys.has(objExpr)) return context.objectKeys.get(objExpr);
  if (context.types.has(objExpr)) {
    const type = context.types.get(objExpr);
    if (type === "Object" && context.objectKeys.has(objExpr)) {
      return context.objectKeys.get(objExpr);
    }
    if (PROTOTYPE_KEYS.has(type)) return PROTOTYPE_KEYS.get(type);
  }

  if (BUILTIN_KEYS.has(objExpr)) return BUILTIN_KEYS.get(objExpr);

  const inferredType = inferExpressionType(objExpr, currentLine);
  if (inferredType && PROTOTYPE_KEYS.has(inferredType)) {
    return PROTOTYPE_KEYS.get(inferredType);
  }

  if (/^(?:\[\]|Array\.prototype)$/.test(objExpr)) {
    return PROTOTYPE_KEYS.get("Array");
  }

  if (/^(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|`(?:\\.|[^`])*`|String\.prototype)$/.test(objExpr)) {
    return PROTOTYPE_KEYS.get("String");
  }

  if (/^(?:\d+(?:\.\d+)?|Number\.prototype)$/.test(objExpr)) {
    return PROTOTYPE_KEYS.get("Number");
  }

  if (/^(?:true|false|Boolean\.prototype)$/.test(objExpr)) {
    return PROTOTYPE_KEYS.get("Boolean");
  }

  if (/^(?:\/.*\/[a-z]*|RegExp\.prototype)$/.test(objExpr)) {
    return PROTOTYPE_KEYS.get("RegExp");
  }

  if (/^(?:Object\.prototype|\(\s*\{\s*\}\s*\))$/.test(objExpr)) {
    return PROTOTYPE_KEYS.get("Object");
  }

  const literalKeys = extractObjectLiteralKeys(objExpr, currentLine);
  return literalKeys.length ? literalKeys : [];
}

function inferExpressionType(objExpr, currentLine) {
  if (!/^[a-zA-Z_$][0-9a-zA-Z_$]*$/.test(objExpr)) return null;

  const escaped = objExpr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const assignRegex = new RegExp(
    `(?:^|[;\\n])\\s*(?:let|const|var)?\\s*${escaped}\\s*=\\s*([^;\\n]+)`,
    "g",
  );
  let match;
  let initializer = "";
  while ((match = assignRegex.exec(currentLine)) !== null) {
    initializer = match[1].trim();
  }

  if (!initializer) return null;
  return inferInitializerType(initializer);
}

function inferInitializerType(initializer) {
  if (/^\[/.test(initializer)) return "Array";
  if (/^\{/.test(initializer)) return "Object";
  if (/^(?:"|'|`)/.test(initializer)) return "String";
  if (/^\d/.test(initializer)) return "Number";
  if (/^(?:true|false)\b/.test(initializer)) return "Boolean";
  if (/^\//.test(initializer)) return "RegExp";

  const constructorMatch = initializer.match(/^new\s+([a-zA-Z_$][0-9a-zA-Z_$]*)\b/);
  if (constructorMatch && PROTOTYPE_KEYS.has(constructorMatch[1])) {
    return constructorMatch[1];
  }

  return null;
}

function extractObjectLiteralKeys(objExpr, currentLine) {
  try {
    const regex = new RegExp(
      "\\b" + objExpr.replace(/\./g, "\\.") + "\\s*=\\s*\\{([^}]+)\\}",
    );
    const match = currentLine.match(regex);
    if (!match) return [];

    const keys = [];
    const keyRegex = /(?:^|,)\s*(?:([a-zA-Z_$][0-9a-zA-Z_$]*)|["']([^"']+)["'])\s*:/g;
    let kMatch;
    while ((kMatch = keyRegex.exec(match[1])) !== null) {
      keys.push(kMatch[1] || kMatch[2]);
    }
    return keys;
  } catch {
    return [];
  }
}

function rankCompletions(items, prefix) {
  return Array.from(new Set(items))
    .filter((item) => item && item !== "constructor")
    .filter((item) => item.startsWith(prefix))
    .sort((a, b) => {
      if (a === prefix) return -1;
      if (b === prefix) return 1;
      if (a.startsWith("_") !== b.startsWith("_")) return a.startsWith("_") ? 1 : -1;
      return a.localeCompare(b);
    });
}

function colorizeCode(code) {
  if (!highlightCode) return code;
  try {
    return highlightCode(code, {
      language: "javascript",
      ignoreIllegals: true,
    });
  } catch {
    return code;
  }
}

function colorizeToken(token) {
  if (/^\s+$/.test(token)) return token;
  return colorizeCode(token);
}

function completionWord(input) {
  const match = input.match(/[a-zA-Z0-9_$.]+$/);
  return match ? match[0] : "";
}

function completeLine(input, engine, context, currentSource) {
  if (input.startsWith(".")) {
    const hits = COMMANDS.filter((command) => command.startsWith(input));
    return hits[0] || COMMANDS[0];
  }

  const word = completionWord(input);
  if (!word) return [];

  const localContext = cloneReplContext(context);
  extractReplMetadata(currentSource + input, localContext);
  const hits = getCompletions(word, engine, localContext, currentSource + input);
  const prefix = input.slice(0, input.length - word.length);
  return hits[0] ? prefix + hits[0] : input;
}

function createReplContext() {
  return {
    vars: new Set(),
    types: new Map(),
    objectKeys: new Map(),
  };
}

function cloneReplContext(context) {
  return {
    vars: new Set(context.vars),
    types: new Map(context.types),
    objectKeys: new Map(context.objectKeys),
  };
}

function updateBraceDepth(depth, line) {
  let next = depth;
  for (const ch of line) {
    if (ch === "{" || ch === "(" || ch === "[") next++;
    if (ch === "}" || ch === ")" || ch === "]") next--;
  }
  return Math.max(0, next);
}

function pushHistory(history, line) {
  if (!line.trim()) return;
  if (history[history.length - 1] === line) return;
  history.push(line);
  if (history.length > HISTORY_LIMIT) history.shift();
}

function printBanner() {
  term("╔═══════════════════════════════════════════╗\n");
  term("║  MiniJIT REPL — A JavaScript JIT Engine   ║\n");
  term("╠═══════════════════════════════════════════╣\n");
  term("║  .help     Show commands                  ║\n");
  term("║  .exit     Quit                           ║\n");
  term("║  .trace    Toggle tracing                 ║\n");
  term("║  .stats    Show engine statistics         ║\n");
  term("╚═══════════════════════════════════════════╝\n\n");
}

function printHelp() {
  term("  .exit          Exit REPL\n");
  term("  .trace on      Enable tracing\n");
  term("  .trace off     Disable tracing\n");
  term("  .trace cats    Set categories (comma separated)\n");
  term("  .reset         Reset engine state\n");
  term("  .stats         Show engine statistics\n");
  term("  .dis <code>    Disassemble code\n");
}

function handleCommand(trimmed, engine) {
  if (trimmed === ".exit" || trimmed === ".quit") return "exit";

  if (trimmed === ".help") {
    printHelp();
    return "handled";
  }

  if (trimmed === ".trace") {
    if (tracer.enabled) tracer.disable();
    else tracer.enable();
    term(`Tracing ${tracer.enabled ? "enabled" : "disabled"}\n`);
    return "handled";
  }

  if (trimmed === ".trace on") {
    tracer.enable();
    term("Tracing enabled\n");
    return "handled";
  }

  if (trimmed === ".trace off") {
    tracer.disable();
    term("Tracing disabled\n");
    return "handled";
  }

  if (trimmed.startsWith(".trace cats ")) {
    const cats = trimmed
      .slice(12)
      .split(",")
      .map((c) => c.trim());
    tracer.enable();
    tracer.setCategories(cats);
    term(`Trace categories: ${cats.join(", ")}\n`);
    return "handled";
  }

  if (trimmed === ".reset") {
    engine.reset();
    term("Engine reset\n");
    return "handled";
  }

  if (trimmed === ".stats") {
    const stats = engine.getStats();
    term(`${JSON.stringify(stats, null, 2)}\n`);
    tracer.dumpStats();
    return "handled";
  }

  if (trimmed.startsWith(".dis ")) {
    try {
      const result = engine.runWithDisassembly(trimmed.slice(5));
      term(`=> ${toDisplayString(result)}\n`);
    } catch (e) {
      term(`Error: ${e.message}\n`);
    }
    return "handled";
  }

  return "code";
}

async function readLine(prompt, history, engine, context, currentSource) {
  term(prompt);
  const controller = term.inputField({
    history,
    autoComplete: (input) => completeLine(input, engine, context, currentSource),
    autoCompleteHint: true,
    autoCompleteMenu: true,
    cancelable: true,
    keyBindings: {
      CTRL_C: "cancel",
      ESCAPE: "cancel",
      ENTER: "submit",
      KP_ENTER: "submit",
      BACKSPACE: "backDelete",
      DELETE: "delete",
      LEFT: "backward",
      RIGHT: "forward",
      UP: "historyPrevious",
      DOWN: "historyNext",
      HOME: "startOfInput",
      END: "endOfInput",
      TAB: "autoComplete",
      CTRL_R: "autoCompleteUsingHistory",
      CTRL_LEFT: "previousWord",
      CTRL_RIGHT: "nextWord",
      ALT_D: "deleteNextWord",
      CTRL_W: "deletePreviousWord",
      CTRL_U: "deleteAllBefore",
      CTRL_K: "deleteAllAfter",
    },
    tokenRegExp: TOKEN_REGEX,
    tokenHook: (token) => colorizeToken(token),
  });
  installAutoPairs(controller);
  const line = await controller.promise;
  term("\n");
  return line === undefined ? null : line;
}

function installAutoPairs(controller) {
  let replaying = false;
  const replayCharacter = (key) => term.emit("key", key, undefined, { isCharacter: true });
  const replayKey = (key) => term.emit("key", key, undefined, { isCharacter: false });
  const onKey = (key, trash, data) => {
    if (replaying || !data?.isCharacter || key.length !== 1) return;

    const input = controller.getInput();
    const cursor = controller.getCursorPosition();
    const next = input[cursor];

    if (CLOSERS.has(key) && next === key) {
      replaying = true;
      replayKey("BACKSPACE");
      replayKey("RIGHT");
      replaying = false;
      return;
    }

    if (PAIRS.has(key)) {
      const close = PAIRS.get(key);
      if (key === close && next && !/[\s)\]}.,;:]/.test(next)) return;
      replaying = true;
      replayCharacter(close);
      replayKey("LEFT");
      replaying = false;
      return;
    }

  };

  term.on("key", onKey);
  controller.promise.finally(() => term.removeListener("key", onKey));
}

export async function startREPL(engine) {
  let braceDepth = 0;
  let multilineBuffer = "";
  const context = createReplContext();
  const history = [];

  printBanner();

  while (true) {
    const prompt = braceDepth > 0 || multilineBuffer ? "... " : "minijit> ";
    const line = await readLine(prompt, history, engine, context, multilineBuffer);
    if (line === null) {
      term("^C\n");
      process.exit(130);
    }

    const trimmed = line.trim();

    if (!multilineBuffer) {
      const commandResult = handleCommand(trimmed, engine);
      if (commandResult === "exit") break;
      if (commandResult === "handled") {
        pushHistory(history, line);
        continue;
      }
    }

    if (!trimmed && !multilineBuffer) continue;

    pushHistory(history, line);
    const continued = trimmed.endsWith("\\");
    const lineToAdd = continued ? line.slice(0, line.lastIndexOf("\\")) : line;
    multilineBuffer += lineToAdd + "\n";
    braceDepth = updateBraceDepth(braceDepth, lineToAdd);

    if (braceDepth > 0 || continued) continue;

    const source = multilineBuffer;
    multilineBuffer = "";
    braceDepth = 0;
    extractReplMetadata(source, context);

    try {
      const result = engine.run(source);
      term(`${toDisplayString(result)}\n`);
    } catch (e) {
      term(`Error: ${e.message}\n`);
    }
  }

  term("\nBye!\n");
  process.exit(0);
}
