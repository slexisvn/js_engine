import { MiniJIT } from "../api/engine.js";
import { tracer } from "../core/tracing/index.js";
import { isObject, getPayload } from "../core/value/index.js";
import { runtimeOwnKeys } from "../objects/exotic/proxy-ops.js";
import { toDisplayString } from "../core/value/index.js";

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
      if (match) {
        set.add(match[0]);
      }
    }
  }
}
function getCompletions(word, engine, localVars, currentLine = "") {
  const globals =
    engine.interpreter.globalCells && engine.interpreter.globalCells.cells
      ? Array.from(engine.interpreter.globalCells.cells.keys())
      : [];

  const baseCompletions = Array.from(
    new Set([
      ...Array.from(localVars),
      ...globals,
      "console",
      "Math",
      "Object",
      "Array",
      "JSON",
      "Promise",
      ...KEYWORDS,
    ]),
  );

  const parts = word.split(".");
  if (parts.length === 1) {
    return baseCompletions.filter((c) => c.startsWith(word));
  }

  const prefix = parts.pop();
  const objExpr = parts.join(".");
  let keys = [];
  try {
    const ptr = engine.run(objExpr);
    if (isObject(ptr)) {
      keys = runtimeOwnKeys(ptr, engine.interpreter);
    } else {
      const payload = getPayload(ptr);
      if (payload && payload.properties) {
        keys = Object.keys(payload.properties);
      }
    }
  } catch (e) {}

  if (keys.length === 0) {
    try {
      const regex = new RegExp(
        "\\b" + objExpr.replace(/\./g, "\\.") + "\\s*=\\s*\\{([^}]+)\\}",
      );
      const match = currentLine.match(regex);
      if (match) {
        const keyRegex = /([a-zA-Z0-9_$]+)\s*:/g;
        let kMatch;
        while ((kMatch = keyRegex.exec(match[1])) !== null) {
          keys.push(kMatch[1]);
        }
      }
    } catch (err) {}
  }

  const hits = keys.filter((k) => k.startsWith(prefix));
  return hits.map((k) => objExpr + "." + k);
}

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

function highlight(code, replVars = null) {
  const tokenRegex =
    /(\/\/.*)|("(\\.|[^"])*")|('(\\.|[^'])*')|(`(\\.|[^`])*`)|(\b\d+(\.\d+)?\b)|(\b[a-zA-Z_$][a-zA-Z0-9_$]*\b)|([+\-*/%=<>!&|^~]+)|([{}[\]().,;:])|(\s+)/g;
  let result = "";
  let match;
  let lastIndex = 0;

  const localVars = new Set();
  let expectVarDecl = false;

  while ((match = tokenRegex.exec(code)) !== null) {
    const matchIndex = match.index;
    if (matchIndex > lastIndex) {
      result += code.slice(lastIndex, matchIndex);
    }
    lastIndex = tokenRegex.lastIndex;
    const [
      token,
      comment,
      dblQuoteStr,
      ,
      sngQuoteStr,
      ,
      tmplStr,
      ,
      num,
      ,
      ident,
      op,
      punc,
      space,
    ] = match;

    if (space) {
      result += token;
      continue;
    }

    if (comment) {
      result += `\x1b[38;5;71m${token}\x1b[0m`; // VS Code Dark Green
      expectVarDecl = false;
    } else if (dblQuoteStr || sngQuoteStr || tmplStr) {
      result += `\x1b[38;5;173m${token}\x1b[0m`; // VS Code Orange
      expectVarDecl = false;
    } else if (num) {
      result += `\x1b[38;5;151m${token}\x1b[0m`; // VS Code Light Green
      expectVarDecl = false;
    } else if (ident) {
      if (expectVarDecl) {
        localVars.add(token);
        expectVarDecl = false;
      }

      if (KEYWORDS.has(token)) {
        if (
          token === "let" ||
          token === "const" ||
          token === "var" ||
          token === "function" ||
          token === "class"
        ) {
          expectVarDecl = true;
          result += `\x1b[38;5;39m${token}\x1b[0m`; // Blue declarations
        } else if (
          token === "true" ||
          token === "false" ||
          token === "null" ||
          token === "undefined" ||
          token === "new" ||
          token === "this" ||
          token === "typeof" ||
          token === "instanceof" ||
          token === "in" ||
          token === "of" ||
          token === "void" ||
          token === "delete" ||
          token === "async" ||
          token === "await" ||
          token === "yield" ||
          token === "super" ||
          token === "extends"
        ) {
          result += `\x1b[38;5;39m${token}\x1b[0m`; // Blue operators/values
        } else {
          result += `\x1b[38;5;176m${token}\x1b[0m`; // Pink/Purple control flow
        }
      } else if (
        token === "console" ||
        token === "Math" ||
        token === "Object" ||
        token === "Array" ||
        token === "JSON" ||
        token === "Promise"
      ) {
        result += `\x1b[38;5;79m${token}\x1b[0m`; // Turquoise builtins
      } else if (localVars.has(token) || (replVars && replVars.has(token))) {
        result += `\x1b[38;5;117m${token}\x1b[0m`; // Light Blue variables
      } else {
        result += `\x1b[38;5;117m${token}\x1b[0m`; // Color all identifiers as variables in VS Code Dark+
      }
    } else if (op) {
      result += token; // Operators default color
      expectVarDecl = false;
    } else if (punc) {
      result += token; // Default color
      expectVarDecl = false;
    } else {
      result += token;
      expectVarDecl = false;
    }
  }
  const remaining = code.slice(lastIndex);
  return result + remaining;
}

function insertGhost(highlighted, cursor, ghost) {
  const ansiRegex = /\x1B\[[0-9;]*[a-zA-Z]/g;
  let visibleCount = 0;
  let lastIndex = 0;
  let match;
  while ((match = ansiRegex.exec(highlighted)) !== null) {
    const textSegment = highlighted.slice(lastIndex, match.index);
    if (visibleCount + textSegment.length >= cursor) {
      const insertPos = lastIndex + (cursor - visibleCount);
      return (
        highlighted.slice(0, insertPos) +
        "\x1b[90m" +
        ghost +
        "\x1b[0m" +
        highlighted.slice(insertPos)
      );
    }
    visibleCount += textSegment.length;
    lastIndex = ansiRegex.lastIndex;
  }
  const textSegment = highlighted.slice(lastIndex);
  if (visibleCount + textSegment.length >= cursor) {
    const insertPos = lastIndex + (cursor - visibleCount);
    return (
      highlighted.slice(0, insertPos) +
      "\x1b[90m" +
      ghost +
      "\x1b[0m" +
      highlighted.slice(insertPos)
    );
  }
  return highlighted + "\x1b[90m" + ghost + "\x1b[0m";
}
export async function startREPL(engine) {
  const { createInterface } = await import("node:readline");
  let braceDepth = 0;

  const replVars = new Set();

  const completer = (line) => {
    const lastWordMatch = line.match(/[a-zA-Z0-9_$.]+$/);
    const word = lastWordMatch ? lastWordMatch[0] : "";
    if (line.startsWith(".")) {
      const commands = [".exit", ".help", ".trace", ".stats", ".reset", ".dis"];
      const hits = commands.filter((c) => c.startsWith(line));
      return [hits.length ? hits : commands, line];
    }

    const localVars = new Set(replVars);
    extractLocalVars(line, localVars);

    if (!word) {
      return [[], line];
    }

    const hits = getCompletions(
      word,
      engine,
      localVars,
      typeof line !== "undefined"
        ? line
        : typeof this !== "undefined"
          ? this.line
          : rl.line,
    );
    return [hits, word];
  };

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "minijit> ",
    completer,
  });

  const origInsertString = rl._insertString;
  if (origInsertString) {
    rl._insertString = function (c) {
      const isClose =
        c === ")" ||
        c === "]" ||
        c === "}" ||
        c === '"' ||
        c === "'" ||
        c === "`";
      if (isClose && this.line[this.cursor] === c) {
        this.cursor++;
        this._refreshLine();
        return;
      }
      if (
        c === "(" ||
        c === "[" ||
        c === "{" ||
        c === '"' ||
        c === "'" ||
        c === "`"
      ) {
        const matching =
          c === "(" ? ")" : c === "[" ? "]" : c === "{" ? "}" : c;
        this.line =
          this.line.slice(0, this.cursor) +
          c +
          matching +
          this.line.slice(this.cursor, this.line.length);
        this.cursor += c.length; // cursor moves past the opening char
        this._refreshLine();
      } else {
        this.line =
          this.line.slice(0, this.cursor) +
          c +
          this.line.slice(this.cursor, this.line.length);
        this.cursor += c.length;
        this._refreshLine();
      }
    };
  }

  const origTtyWrite = rl._ttyWrite;
  if (origTtyWrite) {
    rl._ttyWrite = function (d, key) {
      if (key && key.name === "return") {
        const trimmed = this.line.trimEnd();
        const hasBackslash = trimmed.endsWith("\\");
        if (key.shift || key.meta || key.ctrl || hasBackslash) {
          const lineToAdd = hasBackslash
            ? this.line.slice(0, this.line.lastIndexOf("\\"))
            : this.line;
          multilineBuffer += lineToAdd + "\n";
          process.stdout.write("\n... ");
          this.line = "";
          this.cursor = 0;
          return;
        }
      }

      if (key && key.name === "right") {
        const restOfLine = this.line.slice(this.cursor);
        if (/^[\s)\]}]*$/.test(restOfLine)) {
          const textBeforeCursor = this.line.slice(0, this.cursor);
          const lastWordMatch = textBeforeCursor.match(/[a-zA-Z0-9_$.]+$/);
          const isDecl =
            /(?:^|[\s;{}()])(?:let|const|var|function|class)\s+[a-zA-Z0-9_$]*$/.test(
              textBeforeCursor,
            );
          if (lastWordMatch && !isDecl) {
            const word = lastWordMatch[0];
            const localVars = new Set(replVars);
            extractLocalVars(this.line, localVars);
            const hits = getCompletions(
              word,
              engine,
              localVars,
              typeof line !== "undefined"
                ? line
                : typeof this !== "undefined"
                  ? this.line
                  : rl.line,
            );
            if (hits.length > 0) {
              const ghost = hits[0].slice(word.length);
              if (ghost.length > 0) {
                // Insert ghost into line and advance cursor
                this.line =
                  this.line.slice(0, this.cursor) +
                  ghost +
                  this.line.slice(this.cursor);
                this.cursor += ghost.length;
                this._refreshLine();
                return;
              }
            }
          }
        }
      }
      origTtyWrite.call(this, d, key);
    };
  }

  rl._writeToOutput = function _writeToOutput(stringToWrite) {
    let output = stringToWrite;
    const promptStr = braceDepth > 0 ? "... " : "minijit> ";
    const promptIndex = stringToWrite.indexOf(promptStr);

    if (promptIndex !== -1) {
      const before = stringToWrite.slice(0, promptIndex + promptStr.length);
      const codeWithAnsi = stringToWrite.slice(promptIndex + promptStr.length);

      const ansiRegex = /\x1B\[[0-9;]*[a-zA-Z]/g;
      let highlightedCode = "";
      let lastIndex = 0;
      let match;

      while ((match = ansiRegex.exec(codeWithAnsi)) !== null) {
        highlightedCode += highlight(
          codeWithAnsi.slice(lastIndex, match.index),
          replVars,
        );
        highlightedCode += match[0];
        lastIndex = ansiRegex.lastIndex;
      }
      highlightedCode += highlight(codeWithAnsi.slice(lastIndex), replVars);

      output = before + highlightedCode;

      if (rl.line.trim().length > 0) {
        const restOfLine = rl.line.slice(rl.cursor);
        if (/^[\s)\]}]*$/.test(restOfLine)) {
          const textBeforeCursor = rl.line.slice(0, rl.cursor);
          const lastWordMatch = textBeforeCursor.match(/[a-zA-Z0-9_$.]+$/);
          const isDecl =
            /(?:^|[\s;{}()])(?:let|const|var|function|class)\s+[a-zA-Z0-9_$]*$/.test(
              textBeforeCursor,
            );
          if (lastWordMatch && !isDecl) {
            const word = lastWordMatch[0];
            const localVars = new Set(replVars);
            extractLocalVars(rl.line, localVars);
            const hits = getCompletions(
              word,
              engine,
              localVars,
              typeof line !== "undefined"
                ? line
                : typeof this !== "undefined"
                  ? this.line
                  : rl.line,
            );
            if (hits.length > 0) {
              const ghost = hits[0].slice(word.length);
              if (ghost.length > 0) {
                highlightedCode = insertGhost(
                  highlightedCode,
                  rl.cursor,
                  ghost,
                );
                output = before + highlightedCode;
              }
            }
          }
        }
      }
    }
    rl.output.write(output);
  };

  console.log("╔═══════════════════════════════════════════╗");
  console.log("║  MiniJIT REPL — A JavaScript JIT Engine   ║");
  console.log("╠═══════════════════════════════════════════╣");
  console.log("║  .help     Show commands                  ║");
  console.log("║  .exit     Quit                           ║");
  console.log("║  .trace    Toggle tracing                 ║");
  console.log("║  .stats    Show engine statistics         ║");
  console.log("╚═══════════════════════════════════════════╝");
  console.log("");
  rl.prompt();

  let multilineBuffer = "";

  rl.on("line", (line) => {
    const trimmed = line.trim();

    if (trimmed === ".exit" || trimmed === ".quit") {
      rl.close();
      return;
    }

    if (trimmed === ".help") {
      console.log("  .exit          Exit REPL");
      console.log("  .trace on      Enable tracing");
      console.log("  .trace off     Disable tracing");
      console.log("  .trace cats    Set categories (comma separated)");
      console.log("  .reset         Reset engine state");
      console.log("  .stats         Show engine statistics");
      console.log("  .dis <code>    Disassemble code");
      rl.prompt();
      return;
    }

    if (trimmed === ".trace") {
      if (tracer.enabled) {
        tracer.disable();
      } else {
        tracer.enable();
      }
      console.log("Tracing " + (tracer.enabled ? "enabled" : "disabled"));
      rl.prompt();
      return;
    }
    if (trimmed === ".trace on") {
      tracer.enable();
      console.log("Tracing enabled");
      rl.prompt();
      return;
    }
    if (trimmed === ".trace off") {
      tracer.disable();
      console.log("Tracing disabled");
      rl.prompt();
      return;
    }
    if (trimmed.startsWith(".trace cats ")) {
      const cats = trimmed
        .slice(12)
        .split(",")
        .map((c) => c.trim());
      tracer.enable();
      tracer.setCategories(cats);
      console.log(`Trace categories: ${cats.join(", ")}`);
      rl.prompt();
      return;
    }
    if (trimmed === ".reset") {
      engine.reset();
      console.log("Engine reset");
      rl.prompt();
      return;
    }
    if (trimmed === ".stats") {
      const stats = engine.getStats();
      console.log(JSON.stringify(stats, null, 2));
      tracer.dumpStats();
      rl.prompt();
      return;
    }

    if (trimmed.startsWith(".dis ")) {
      const code = trimmed.slice(5);
      try {
        const result = engine.runWithDisassembly(code);
        console.log(`=> ${toDisplayString(result)}`);
      } catch (e) {
        console.log(`Error: ${e.message}`);
      }
      rl.prompt();
      return;
    }

    if (!trimmed) {
      rl.prompt();
      return;
    }

    for (const ch of line) {
      if (ch === "{" || ch === "(" || ch === "[") braceDepth++;
      if (ch === "}" || ch === ")" || ch === "]") braceDepth--;
    }
    multilineBuffer += line + "\n";

    if (braceDepth > 0) {
      process.stdout.write("... ");
      return;
    }

    const source = multilineBuffer;
    multilineBuffer = "";
    braceDepth = 0;

    extractLocalVars(source, replVars);

    try {
      const result = engine.run(source);
      console.log(toDisplayString(result));
    } catch (e) {
      console.log(`Error: ${e.message}`);
    }
    rl.prompt();
  });

  rl.on("close", () => {
    console.log("\nBye!");
    process.exit(0);
  });
}
