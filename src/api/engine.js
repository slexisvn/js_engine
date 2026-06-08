import { Lexer } from "../frontend/lexer/index.js";
import { Parser } from "../frontend/parser/index.js";
import { RegisterBytecodeCompiler } from "../bytecode/register/compiler/index.js";
import {
  RegisterInterpreter,
  RegisterFrame,
  updateCallMode,
} from "../bytecode/register/interpreter/index.js";
import { RegisterCompiledFunction } from "../bytecode/register/ops/bytecode.js";
import { SpeculativeOptimizer } from "../optimizing/optimizer.js";
import { WasmCodegen } from "../optimizing/wasm/codegen.js";
import { BaselineCompiler } from "../optimizing/baseline/compiler.js";
import { Deoptimizer } from "../deopt/deoptimizer.js";
import { dependencyRegistry } from "../deopt/dependencies.js";
import { DEP_CALL_TARGET } from "../deopt/dependencies.js";
import { tracer } from "../core/tracing/index.js";
import { getPayload, getTag, toDisplayString } from "../core/value/index.js";
import {
  resetHiddenClasses,
  getDeprecatedMapCount,
} from "../objects/maps/hidden-class.js";
import { getMigrationStats } from "../objects/heap/js-object.js";
import { resetIRNodeIds } from "../optimizing/ir/index.js";
import { createTieringPolicy } from "../runtime/tiering/policy.js";
import {
  MicrotaskQueue,
  MicrotaskPolicy,
  MicrotasksScope,
} from "../runtime/microtasks/microtask.js";
import { GenerationalGC } from "../gc/gc.js";
import { bindGC } from "../objects/heap/factory.js";

export class MiniJIT {
  constructor(options = {}) {
    this.tieringPolicy = createTieringPolicy(options.tieringPolicy);
    this.microtaskQueue = new MicrotaskQueue({
      policy: options.microtaskPolicy || MicrotaskPolicy.AUTO,
    });
    this.gc = new GenerationalGC(options.gc || {});
    bindGC(this.gc);
    this.interpreter = new RegisterInterpreter(this);
    this.gc.bindRoots(
      this.interpreter,
      this.interpreter.globalCells,
      this.microtaskQueue,
    );
    this.baselineCompiler = new BaselineCompiler();
    this.optimizer = new SpeculativeOptimizer();
    this.wasmCodegen = new WasmCodegen();
    this.deoptimizer = new Deoptimizer(this.interpreter);
    dependencyRegistry.bindLazyMarker(this.deoptimizer.lazyMarker);
    this.compilationCount = 0;
    this.executionCount = 0;
    this.totalCompileTimeMs = 0;
    this.totalExecTimeMs = 0;

    if (options.trace) {
      tracer.enable();
      if (options.traceCategories) {
        tracer.setCategories(options.traceCategories);
      }
    }
  }

  compile(source, options = {}) {
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens, {
      lazy: options.lazy || false,
      source: options.lazy ? source : null,
    });
    const ast = parser.parse();
    const compiler = new RegisterBytecodeCompiler();
    return compiler.compile(ast);
  }

  run(source) {
    this.executionCount++;
    const t0 = performance.now();

    const compiled = this.compile(source);
    const compileTime = performance.now() - t0;
    this.totalCompileTimeMs += compileTime;

    const t1 = performance.now();
    const scope = new MicrotasksScope(this.microtaskQueue, this.interpreter);
    const result = this.interpreter.execute(compiled);
    scope.exit();
    const execTime = performance.now() - t1;
    this.totalExecTimeMs += execTime;

    tracer.perfMark(`Compile`, compileTime);
    tracer.perfMark(`Execute`, execTime);

    return result;
  }

  runValue(source) {
    const raw = this.run(source);
    return { tag: getTag(raw), value: getPayload(raw) };
  }

  executeValue(compiledFn, args = [], thisValue = null) {
    const raw = this.interpreter.execute(compiledFn, args, thisValue);
    return { tag: getTag(raw), value: getPayload(raw) };
  }

  runMicrotasks() {
    return this.microtaskQueue.runOne(this.interpreter);
  }

  drainMicrotasks() {
    return this.microtaskQueue.drain(this.interpreter);
  }

  performMicrotaskCheckpoint() {
    return this.microtaskQueue.performCheckpoint(this.interpreter);
  }

  setMicrotaskPolicy(policy) {
    this.microtaskQueue.setPolicy(policy);
  }

  runWithDisassembly(source) {
    const compiled = this.compile(source);
    console.log(compiled.disassemble());

    for (const constant of compiled.constants) {
      if (constant && typeof constant === "object" && constant.instructions) {
        console.log(constant.disassemble());
      }
    }

    const result = this.interpreter.execute(compiled);
    this.drainMicrotasks();
    return result;
  }

  compileLazy(compiledFn) {
    if (!compiledFn.isLazy) return;
    const oldVersion = compiledFn.version || 0;

    tracer.log("compile", `Lazy-compiling function "${compiledFn.name}"`);

    const source = compiledFn.lazySource;
    const bodyStart = compiledFn.lazyBodyStart;
    const bodyEnd = compiledFn.lazyBodyEnd;

    const lexer = new Lexer(source);
    const allTokens = lexer.tokenize();

    const bodyTokens = allTokens.slice(bodyStart, bodyEnd);
    bodyTokens.push({ type: "EOF", value: "", line: 0, column: 0 });

    const parser = new Parser(bodyTokens);
    const body = parser.parseBlock();

    const compiler = new RegisterBytecodeCompiler();
    const ast = {
      type: "Program",
      body: [
        {
          type: "FunctionDeclaration",
          name: compiledFn.name,
          params: compiledFn.lazyParams,
          body,
        },
      ],
    };
    const compiled = compiler.compile(ast);

    const innerFn = compiled.constants.find(
      (c) => c && c.name === compiledFn.name,
    );
    if (innerFn) {
      compiledFn.instructions = innerFn.instructions;
      compiledFn.constants = innerFn.constants;
      compiledFn.localCount = innerFn.localCount;
      compiledFn.registerCount = innerFn.registerCount;
      compiledFn.feedbackSlotCount = innerFn.feedbackSlotCount;
      compiledFn.upvalues = innerFn.upvalues;
    }

    compiledFn.isLazy = false;
    compiledFn.version = oldVersion + 1;
    dependencyRegistry.invalidate(
      DEP_CALL_TARGET,
      compiledFn.id,
      oldVersion,
      "function-version-change",
    );
    compiledFn.lazySource = null;
    compiledFn.lazyBodyStart = null;
    compiledFn.lazyBodyEnd = null;
    compiledFn.lazyParams = null;
  }

  baselineCompile(compiledFn) {
    if (compiledFn.baselineCode) return;

    try {
      const baselineFn = this.baselineCompiler.compile(
        compiledFn,
        this.interpreter,
      );
      if (baselineFn) {
        compiledFn.baselineCode = baselineFn;
        updateCallMode(compiledFn);
      }
    } catch (e) {
      tracer.jitCompile(compiledFn.name, `Baseline failed: ${e.message}`);
    }
  }

  optimizeFunction(compiledFn) {
    if (compiledFn.isAsync || compiledFn.isGenerator) {
      compiledFn.lastCompileFailureReason = "interpreter-only-async-generator";
      tracer.jitCompile(
        compiledFn.name,
        "Optimization skipped: async/generator",
      );
      return;
    }
    this.compilationCount++;
    const t0 = performance.now();

    try {
      resetIRNodeIds();
      const optimizerResult = this.optimizer.compile(compiledFn);
      const wasmFn = this.wasmCodegen.compile(optimizerResult, compiledFn);

      if (wasmFn) {
        compiledFn.optimizedCode = wasmFn;
        updateCallMode(compiledFn);
        compiledFn.compileFailureCount = 0;
        compiledFn.lastCompileFailureReason = null;
        compiledFn.optimizationCooldownUntil = 0;
        if (
          this.tieringPolicy &&
          typeof this.tieringPolicy.recordCompileSuccess === "function"
        ) {
          this.tieringPolicy.recordCompileSuccess(compiledFn);
        }
        dependencyRegistry.register(
          compiledFn,
          optimizerResult.graph.dependencies,
        );
        const elapsed = performance.now() - t0;
        tracer.jitCompile(
          compiledFn.name,
          `Wasm installed in ${elapsed.toFixed(2)}ms`,
        );
      } else {
        compiledFn.compileFailureCount =
          (compiledFn.compileFailureCount || 0) + 1;
        compiledFn.lastCompileFailureReason =
          this.wasmCodegen.lastCompileRejection ||
          this.wasmCodegen.lastAnalysisFailure ||
          "not-compilable";
        compiledFn.optimizationCooldownUntil =
          Date.now() + Math.min(5000, 250 * compiledFn.compileFailureCount);
        if (
          this.tieringPolicy &&
          typeof this.tieringPolicy.recordCompileFailure === "function"
        ) {
          this.tieringPolicy.recordCompileFailure(
            compiledFn,
            compiledFn.lastCompileFailureReason,
          );
        }
        tracer.jitCompile(
          compiledFn.name,
          "Wasm compilation skipped — cooldown",
        );
      }
    } catch (e) {
      compiledFn.compileFailureCount =
        (compiledFn.compileFailureCount || 0) + 1;
      compiledFn.lastCompileFailureReason = e.message;
      compiledFn.optimizationCooldownUntil =
        Date.now() + Math.min(5000, 250 * compiledFn.compileFailureCount);
      if (
        this.tieringPolicy &&
        typeof this.tieringPolicy.recordCompileFailure === "function"
      ) {
        this.tieringPolicy.recordCompileFailure(
          compiledFn,
          compiledFn.lastCompileFailureReason,
        );
      }
      tracer.jitCompile(compiledFn.name, `Compilation failed: ${e.message}`);
    }
  }

  ageCode(allFunctions, options = {}) {
    const CODE_AGE_THRESHOLD = options.ageThreshold || 5;
    const CODE_IDLE_MS = options.idleMs || 30000;
    const now = Date.now();
    let flushedCount = 0;

    for (const fn of allFunctions) {
      if (!fn.optimizedCode && !fn.baselineCode) continue;

      const idleTime = now - (fn.lastExecutionTime || 0);
      if (idleTime < CODE_IDLE_MS) {
        fn.codeAge = 0;
        continue;
      }

      fn.codeAge = (fn.codeAge || 0) + 1;

      if (fn.codeAge >= CODE_AGE_THRESHOLD) {
        if (fn.optimizedCode) {
          tracer.jitCompile(
            fn.name,
            `Code aged out (age=${fn.codeAge}, idle=${(idleTime / 1000).toFixed(1)}s) — flushing optimized code`,
          );
          if (fn.optimizedCode._dispose) fn.optimizedCode._dispose();
          dependencyRegistry.unregister(fn);
          fn.optimizedCode = null;
          fn.disableOptimization = false;
          updateCallMode(fn);
          flushedCount++;
        }
        if (fn.codeAge >= CODE_AGE_THRESHOLD * 2 && fn.baselineCode) {
          tracer.jitCompile(
            fn.name,
            `Code aged out (age=${fn.codeAge}) — flushing baseline code`,
          );
          fn.baselineCode = null;
          updateCallMode(fn);
          flushedCount++;
        }
        if (fn.codeAge >= CODE_AGE_THRESHOLD) {
          fn.invocationCount = 0;
          fn.codeAge = 0;
        }
      }
    }

    return flushedCount;
  }

  collectFunctions() {
    const functions = [];
    const visited = new Set();

    const collect = (val) => {
      if (!val) return;
      if (visited.has(val)) return;
      visited.add(val);

      const payload = getPayload(val);
      const target = payload && typeof payload === "object" ? payload : val;

      if (target.compiled && target.compiled.instructions) {
        functions.push(target.compiled);
        for (const c of target.compiled.constants) {
          if (c && c.instructions) {
            functions.push(c);
          }
        }
      }
      if (payload && typeof payload === "object") collect(payload);
    };

    if (this.interpreter.globalCells) {
      for (const [, cell] of this.interpreter.globalCells.cells || []) {
        collect(cell.value);
      }
    }

    return functions;
  }

  runAgingCycle(options = {}) {
    const functions = this.collectFunctions();
    const flushed = this.ageCode(functions, options);

    if (this.interpreter.icManager) {
      this.interpreter.icManager.invalidateDeprecatedMaps();
    }

    return flushed;
  }

  collectGarbage(type = "minor") {
    this.gc.collectGarbage(type);
  }

  getStats() {
    return {
      compilations: this.compilationCount,
      executions: this.executionCount,
      totalCompileTimeMs: this.totalCompileTimeMs,
      totalExecTimeMs: this.totalExecTimeMs,
      tracerStats: tracer.getStats(),
      deoptStats: this.deoptimizer.getStats(),
      deprecatedMaps: getDeprecatedMapCount(),
      migrations: getMigrationStats(),
      microtasks: this.microtaskQueue.getStats(),
      gc: this.gc.getStats(),
    };
  }

  reset() {
    this.microtaskQueue = new MicrotaskQueue({
      policy: this.microtaskQueue.policy,
    });
    this.gc = new GenerationalGC();
    bindGC(this.gc);
    this.interpreter = new RegisterInterpreter(this);
    this.gc.bindRoots(
      this.interpreter,
      this.interpreter.globalCells,
      this.microtaskQueue,
    );
    this.deoptimizer = new Deoptimizer(this.interpreter);
    dependencyRegistry.bindLazyMarker(this.deoptimizer.lazyMarker);
    dependencyRegistry.clear();
    resetHiddenClasses();
    resetIRNodeIds();
    tracer.reset();
    this.compilationCount = 0;
    this.executionCount = 0;
    this.totalCompileTimeMs = 0;
    this.totalExecTimeMs = 0;
  }
}
