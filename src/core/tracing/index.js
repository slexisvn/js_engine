const STYLE = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
};

const CATEGORY_STYLES = {
  hidden_class: { prefix: "HC", color: STYLE.magenta },
  ic: { prefix: "IC", color: STYLE.cyan },
  feedback: { prefix: "FB", color: STYLE.blue },
  jit: { prefix: "JIT", color: STYLE.green },
  deopt: { prefix: "DEOPT", color: STYLE.red },
  interp: { prefix: "INTERP", color: STYLE.dim },
  wasm: { prefix: "WASM", color: STYLE.yellow },
  gc: { prefix: "GC", color: STYLE.white },
  perf: { prefix: "PERF", color: STYLE.bold },
  microtask: { prefix: "MTASK", color: STYLE.yellow },
  promise: { prefix: "PROM", color: STYLE.cyan },
};

export class TracerEvent {
  constructor(category, message, timestamp, data) {
    this.category = category;
    this.message = message;
    this.timestamp = timestamp;
    this.data = data;
  }
}

export class Tracer {
  constructor() {
    this.enabled = false;
    this.categories = new Set(["all"]);
    this.history = [];
    this.maxHistory = 10000;
    this.counters = new Map();
    this.timers = new Map();
    this.indentLevel = 0;
    this.useColors =
      typeof process !== "undefined" && process.stdout && process.stdout.isTTY;
  }

  enable() {
    this.enabled = true;
  }

  disable() {
    this.enabled = false;
  }

  setCategories(cats) {
    this.categories = new Set(cats);
  }

  shouldLog(category) {
    if (!this.enabled) return false;
    return this.categories.has("all") || this.categories.has(category);
  }

  formatMessage(category, message) {
    const style = CATEGORY_STYLES[category] || {
      prefix: category.toUpperCase(),
      color: STYLE.white,
    };
    const indent = "  ".repeat(this.indentLevel);
    if (this.useColors) {
      return `${style.color}[${style.prefix}]${STYLE.reset} ${indent}${message}`;
    }
    return `[${style.prefix}] ${indent}${message}`;
  }

  log(category, message, data) {
    if (!this.shouldLog(category)) return;

    const event = new TracerEvent(category, message, performance.now(), data);
    if (this.history.length < this.maxHistory) {
      this.history.push(event);
    }

    console.log(this.formatMessage(category, message));
  }

  incrementCounter(name) {
    this.counters.set(name, (this.counters.get(name) || 0) + 1);
  }

  getCounter(name) {
    return this.counters.get(name) || 0;
  }

  startTimer(name) {
    this.timers.set(name, performance.now());
  }

  endTimer(name) {
    const start = this.timers.get(name);
    if (start === undefined) return 0;
    const elapsed = performance.now() - start;
    this.timers.delete(name);
    return elapsed;
  }

  indent() {
    this.indentLevel++;
  }

  dedent() {
    if (this.indentLevel > 0) this.indentLevel--;
  }

  hcTransition(fromId, toId, propertyName) {
    this.incrementCounter("hc_transitions");
    this.log(
      "hidden_class",
      `Transition: HC${fromId} --"${propertyName}"--> HC${toId}`,
    );
  }

  hcDeleteTransition(fromId, toId, propertyName) {
    this.incrementCounter("hc_delete_transitions");
    this.log(
      "hidden_class",
      `Delete: HC${fromId} --del("${propertyName}")--> HC${toId}`,
    );
  }

  hcIntegrityChange(hcId, level) {
    this.log("hidden_class", `Integrity: HC${hcId} -> ${level}`);
  }

  hcInstability(hcId, transitionCount) {
    this.log(
      "hidden_class",
      `Unstable: HC${hcId} (${transitionCount} transitions)`,
    );
  }

  icEvent(siteId, fromState, toState, mapId, offset) {
    this.incrementCounter("ic_transitions");
    this.log(
      "ic",
      `Site #${siteId}: ${fromState} → ${toState} (map=HC${mapId}, offset=${offset})`,
    );
  }

  icHit(siteId, state, mapId) {
    this.incrementCounter("ic_hits");
    this.log("ic", `Site #${siteId}: HIT ${state} (map=HC${mapId})`);
  }

  icMiss(siteId, state) {
    this.incrementCounter("ic_misses");
    this.log("ic", `Site #${siteId}: MISS ${state}`);
  }

  icInvalidate(siteId, reason) {
    this.incrementCounter("ic_invalidations");
    this.log("ic", `Site #${siteId}: INVALIDATED — ${reason}`);
  }

  feedbackRecord(slotId, kind, details) {
    this.incrementCounter("feedback_records");
    this.log("feedback", `Slot #${slotId}: ${kind} — ${details}`);
  }

  feedbackTransition(slotId, fromState, toState) {
    this.log("feedback", `Slot #${slotId}: ${fromState} → ${toState}`);
  }

  jitCompile(funcName, details) {
    this.incrementCounter("jit_compilations");
    this.log("jit", `Compiling "${funcName}": ${details}`);
  }

  jitOSR(funcName, loopOffset) {
    this.incrementCounter("jit_osr");
    this.log("jit", `OSR "${funcName}" at loop offset ${loopOffset}`);
  }

  jitDeopt(funcName, reason, bytecodeOffset) {
    this.incrementCounter("jit_deopts");
    const bcStr = bytecodeOffset >= 0 ? ` at bytecode:${bytecodeOffset}` : "";
    this.log("deopt", `DEOPT "${funcName}": ${reason}${bcStr}`);
  }

  jitResume(funcName, bytecodeOffset) {
    this.log(
      "deopt",
      `Resuming "${funcName}" in interpreter at bytecode:${bytecodeOffset}`,
    );
  }

  jitWasmEmit(funcName, bytes) {
    this.log("wasm", `"${funcName}": emitted ${bytes} bytes of Wasm`);
  }

  jitWasmFail(funcName, reason) {
    this.incrementCounter("wasm_failures");
    this.log("wasm", `"${funcName}": Wasm compilation failed — ${reason}`);
  }

  interpret(funcName, opName, details) {
    if (!this.shouldLog("interp")) return;
    this.log("interp", `${funcName}: ${opName} ${details || ""}`);
  }

  microtaskEvent(action, details) {
    this.incrementCounter("microtask_" + action);
    this.log("microtask", `${action}: ${details}`);
  }

  perfMark(label, elapsedMs) {
    this.log("perf", `${label}: ${elapsedMs.toFixed(2)}ms`);
  }

  getStats() {
    const stats = {};
    for (const [key, value] of this.counters) {
      stats[key] = value;
    }
    stats.total_events = this.history.length;
    return stats;
  }

  dumpStats() {
    const stats = this.getStats();
    const lines = ["=== Tracer Statistics ==="];
    const keys = Object.keys(stats).sort();
    for (const key of keys) {
      lines.push(`  ${key}: ${stats[key]}`);
    }
    lines.push("========================");
    console.log(lines.join("\n"));
    return lines.join("\n");
  }

  getEventsForCategory(category) {
    return this.history.filter((e) => e.category === category);
  }

  clearHistory() {
    this.history.length = 0;
    this.counters.clear();
  }

  reset() {
    this.history.length = 0;
    this.counters.clear();
    this.timers.clear();
    this.indentLevel = 0;
  }
}

export const tracer = new Tracer();
