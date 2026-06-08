import * as bytecode from "../ops/bytecode.js";

function analyzeConstructor(compiledFn) {
  const fields = [];
  const instrs = compiledFn.instructions;
  let pc = 0;
  while (pc < instrs.length) {
    const a = instrs[pc];
    if (
      a &&
      a.opcode === bytecode.ROP_LDA_UNDEFINED &&
      instrs[pc + 1] &&
      instrs[pc + 1].opcode === bytecode.ROP_RETURN &&
      pc + 2 === instrs.length
    ) {
      return fields.length > 0 ? fields : null;
    }
    const b = instrs[pc + 1];
    const c = instrs[pc + 2];
    const d = instrs[pc + 3];
    if (
      !a ||
      !b ||
      !c ||
      !d ||
      a.opcode !== bytecode.ROP_LDA_THIS ||
      b.opcode !== bytecode.ROP_STAR
    )
      return null;
    let source;
    if (c.opcode === bytecode.ROP_LDA_REG)
      source = { kind: "local", index: c.operands[0] };
    else if (c.opcode === bytecode.ROP_LDA_CONST)
      source = { kind: "const", index: c.operands[0] };
    else if (c.opcode === bytecode.ROP_LDA_UNDEFINED)
      source = { kind: "undefined" };
    else if (c.opcode === bytecode.ROP_LDA_NULL) source = { kind: "null" };
    else if (c.opcode === bytecode.ROP_LDA_TRUE) source = { kind: "true" };
    else if (c.opcode === bytecode.ROP_LDA_FALSE) source = { kind: "false" };
    else return null;
    if (d.opcode !== bytecode.ROP_STA_PROP) return null;
    const propNameIdx = d.operands[1];
    const name = compiledFn.constants[propNameIdx];
    if (typeof name !== "string" || fields.some((f) => f.name === name))
      return null;
    fields.push({ name, source });
    pc += 4;
  }
  return fields.length > 0 ? fields : null;
}

export function analyzeSimpleConstructor(compiledFn) {
  if (compiledFn.simpleConstructorInfo !== undefined)
    return compiledFn.simpleConstructorInfo;
  const instrs = compiledFn.instructions;
  if (!instrs || instrs.length === 0) {
    compiledFn.simpleConstructorInfo = null;
    return null;
  }
  compiledFn.simpleConstructorInfo = analyzeConstructor(compiledFn);
  return compiledFn.simpleConstructorInfo;
}

export class Scope {
  constructor(parent = null) {
    this.parent = parent;
    this.locals = new Map();
    this.bindings = new Map();
    this.constSlots = new Set();
    this.isFunctionBoundary = false;
    this.upvalues = [];
    this.upvalueMap = new Map();
  }

  isInScriptScope() {
    let scope = this;
    while (scope) {
      if (scope.isScript) return true;
      if (scope.isFunctionBoundary) return false;
      scope = scope.parent;
    }
    return false;
  }

  resolve(name) {
    if (this.locals.has(name)) {
      const binding = this.bindings.get(name) || {};
      return {
        type: "local",
        slot: this.locals.get(name),
        kind: binding.kind || "let",
        scope: this,
      };
    }
    if (this.parent) {
      const result = this.parent.resolve(name);
      if (result && this.isFunctionBoundary) {
        if (result.type === "local" || result.type === "upvalue") {
          return this.captureUpvalue(name, result);
        }
      }
      return result;
    }
    return null;
  }

  captureUpvalue(name, outerResult) {
    if (this.upvalueMap.has(name)) {
      return { type: "upvalue", slot: this.upvalueMap.get(name) };
    }
    const idx = this.upvalues.length;
    this.upvalues.push({
      name,
      outerType: outerResult.type,
      outerSlot: outerResult.slot,
      kind: outerResult.kind || "let",
    });
    this.upvalueMap.set(name, idx);
    return { type: "upvalue", slot: idx };
  }

  define(name, slot) {
    this.locals.set(name, slot);
    this.bindings.set(name, { kind: "let" });
  }

  defineVar(name, slot) {
    this.locals.set(name, slot);
    this.bindings.set(name, { kind: "var" });
  }

  defineFunction(name, slot) {
    this.locals.set(name, slot);
    this.bindings.set(name, { kind: "function" });
  }

  defineConst(name, slot) {
    this.locals.set(name, slot);
    this.bindings.set(name, { kind: "const" });
    this.constSlots.add(slot);
  }

  isConst(name) {
    const resolved = this.resolve(name);
    if (!resolved) return false;
    if (resolved.kind === "const") return true;
    if (resolved.type !== "local") return false;

    let scope = this;
    while (scope) {
      if (scope.locals.has(name)) {
        return scope.constSlots.has(scope.locals.get(name));
      }
      if (scope.isFunctionBoundary) break;
      scope = scope.parent;
    }
    return false;
  }
}
