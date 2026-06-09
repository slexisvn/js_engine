import * as bytecode from "../../bytecode/register/ops/bytecode.js";
import { isInsideWasmExecution } from "../wasm/codegen.js";

import {
  mkSmi,
  mkDouble,
  mkBool,
  mkString,
  mkObject,
  mkFunction,
  mkArray,
  mkUndefined,
  mkNull,
  mkNumber,
  mkRegex,
  isSmi,
  isDouble,
  isNumber,
  isString,
  isObject,
  isFunction,
  isArray,
  isUndefined,
  isNull,
  isBool,
  toNumber,
  toBool,
  toDisplayString,
  typeOf,
  getPayload,
  getTag,
  pinHeapSlot,
  abstractLooseEqual,
} from "../../core/value/index.js";

import { createJSObject, createJSArray } from "../../objects/heap/factory.js";
import { UpvalueCell } from "../../runtime/intrinsics/environment.js";
import {
  isJSProxyValue,
  runtimeDeleteProperty,
  runtimeGetProperty,
  runtimeHasProperty,
  runtimeSetProperty,
} from "../../objects/exotic/proxy-ops.js";

const MAX_CALL_DEPTH = 1000;
let globalCallDepth = 0;

export class BaselineRuntime {
  constructor(compiledFn, interpreter) {
    this.cf = compiledFn;
    this.interp = interpreter;
    this.consts = compiledFn.constants;
    this.u = mkUndefined();
    this.n = mkNull();
    this.t = mkBool(true);
    this.f = mkBool(false);
    this.loadCaches = [];
    this.storeCaches = [];
    this.constValueCache = [];
    this.globalCaches = [];
  }

  get fv() {
    return this.cf.feedbackVector;
  }

  wc(idx) {
    const c = this.consts[idx];
    if (typeof c === "number") {
      return Number.isInteger(c) ? mkSmi(c) : mkDouble(c);
    }
    if (typeof c === "string") return mkString(c);
    if (typeof c === "boolean") return mkBool(c);
    if (c === null) return this.n;
    if (c === undefined) return this.u;
    if (c instanceof bytecode.RegisterCompiledFunction) {
      return mkFunction({
        name: c.name,
        compiled: c,
        call: null,
        closure: null,
      });
    }
    return this.u;
  }

  c(idx) {
    let val = this.constValueCache[idx];
    if (val === undefined) {
      val = this.wc(idx);
      this.constValueCache[idx] = val;
      pinHeapSlot(val);
    }
    return val;
  }

  lg(nameIdx) {
    const name = this.consts[nameIdx];
    const cached = this.globalCaches[nameIdx];
    if (cached && cached.cell.writeCount === cached.writeCount)
      return cached.value;
    const cell = this.interp.globalCells.get(name);
    const val = cell ? cell.read() : undefined;
    if (val === undefined) {
      throw new Error(`ReferenceError: ${name} is not defined`);
    }
    if (cell)
      this.globalCaches[nameIdx] = {
        cell,
        writeCount: cell.writeCount,
        value: val,
      };
    return val;
  }

  sg(nameIdx, val) {
    const name = this.consts[nameIdx];
    this.globalCaches[nameIdx] = null;
    this.interp.globalCells.write(name, val);
  }

  gp(obj, nameIdx, fbSlot) {
    const propName = this.consts[nameIdx];
    if (isJSProxyValue(obj)) {
      return runtimeGetProperty(obj, propName, this.interp);
    }
    if (isObject(obj)) {
      const jsObj = getPayload(obj);
      const ownDesc = jsObj.hiddenClass.lookupProperty(propName);
      if (ownDesc && ownDesc.kind === "accessor") {
        return runtimeGetProperty(obj, propName, this.interp);
      }
      if (!ownDesc && jsObj.prototype) {
        const protoResult = jsObj.lookupPrototypeChain(propName);
        if (
          protoResult.found &&
          protoResult.descriptor &&
          protoResult.descriptor.kind === "accessor"
        ) {
          return runtimeGetProperty(obj, propName, this.interp);
        }
      }
      const cached = this.loadCaches[fbSlot];
      if (
        cached &&
        jsObj.hiddenClass.id === cached.hiddenClassId &&
        jsObj.hiddenClass.version === cached.version &&
        !jsObj.hiddenClass.isDeprecated
      ) {
        if (cached.offset < 10) {
          const val = jsObj.slots[cached.offset];
          return val !== undefined ? val : this.u;
        }
        const val = jsObj.overflowProperties.get(propName);
        return val !== undefined ? val : this.u;
      }
      const icKey = this.cf.name + ":" + fbSlot;
      const ic = this.interp.icManager.getOrCreate(icKey);
      const result = ic.lookup(jsObj, propName);

      if (this.fv) {
        const slot = this.fv.getSlot(fbSlot);
        if (slot) {
          const info = jsObj.hiddenClass.lookupProperty(propName);
          if (info) {
            slot.recordPropertyAccess(
              jsObj.hiddenClass.id,
              info.offset,
              jsObj.hiddenClass.version,
              0,
            );
            this.loadCaches[fbSlot] = {
              hiddenClassId: jsObj.hiddenClass.id,
              version: jsObj.hiddenClass.version,
              offset: info.offset,
            };
          } else if (jsObj.prototype) {
            const protoResult = jsObj.lookupPrototypeChain(propName);
            if (protoResult.found && protoResult.descriptor) {
              slot.recordPropertyAccess(
                jsObj.hiddenClass.id,
                protoResult.descriptor.offset,
                jsObj.hiddenClass.version,
                protoResult.depth,
              );
            }
          }
        }
      }

      if (result.hit) return result.value;
      let val = jsObj.getProperty(propName);
      if (val === undefined && jsObj.prototype) {
        const protoResult = jsObj.lookupPrototypeChain(propName);
        if (protoResult.found) val = protoResult.value;
      }
      return val !== undefined ? val : this.u;
    }
    if (isArray(obj)) {
      const arr = getPayload(obj);
      if (propName === "length") return mkSmi(arr.getLength());
      const idx = Number(propName);
      if (Number.isInteger(idx)) {
        const val = arr.getIndex(idx);
        return val !== undefined ? val : this.u;
      }
      const ownVal = arr.getProperty(propName);
      if (ownVal !== undefined) return ownVal;
      return this.interp._lookupBuiltinPrototype(
        this.interp.builtinPrototypes.arrayPrototype,
        propName,
      );
    }
    if (isString(obj)) {
      if (propName === "length") return mkSmi(getPayload(obj).length);
      const idx = Number(propName);
      if (Number.isInteger(idx)) {
        const ch = getPayload(obj)[idx];
        return ch !== undefined ? mkString(ch) : this.u;
      }
      return this.interp._lookupBuiltinPrototype(
        this.interp.builtinPrototypes.stringPrototype,
        propName,
      );
    }
    if (isFunction(obj)) {
      const fn = getPayload(obj);
      if (fn.properties && fn.properties[propName] !== undefined) {
        return fn.properties[propName];
      }
      if (propName === "prototype") {
        if (!fn.prototypeObj) {
          fn.prototypeObj = createJSObject();
          fn.prototypeObj.constructorRef = fn;
        }
        return mkObject(fn.prototypeObj);
      }
      return this.u;
    }
    return this.u;
  }

  sp(obj, nameIdx, val, fbSlot) {
    const propName = this.consts[nameIdx];
    if (isJSProxyValue(obj)) {
      runtimeSetProperty(obj, propName, val, this.interp);
      return;
    }
    if (isObject(obj)) {
      const jsObj = getPayload(obj);
      const ownDesc = jsObj.hiddenClass.lookupProperty(propName);
      if (
        (ownDesc && ownDesc.kind === "accessor") ||
        (!ownDesc && jsObj.prototype)
      ) {
        runtimeSetProperty(obj, propName, val, this.interp);
        return;
      }
      const cached = this.storeCaches[fbSlot];
      if (
        cached &&
        jsObj.hiddenClass.id === cached.hiddenClassId &&
        jsObj.hiddenClass.version === cached.version &&
        !jsObj.hiddenClass.isDeprecated
      ) {
        if (cached.offset < 10) jsObj.slots[cached.offset] = val;
        else jsObj.overflowProperties.set(propName, val);
        return;
      }
      const icKey = this.cf.name + ":" + fbSlot;
      const ic = this.interp.icManager.getOrCreate(icKey);
      ic.lookupForWrite(jsObj, propName, val);

      if (this.fv) {
        const slot = this.fv.getSlot(fbSlot);
        if (slot) {
          const info = jsObj.hiddenClass.lookupProperty(propName);
          if (info) {
            slot.recordPropertyAccess(
              jsObj.hiddenClass.id,
              info.offset,
              jsObj.hiddenClass.version,
              0,
            );
            this.storeCaches[fbSlot] = {
              hiddenClassId: jsObj.hiddenClass.id,
              version: jsObj.hiddenClass.version,
              offset: info.offset,
            };
          }
        }
      }
    }
  }

  gi(obj, index, fbSlot) {
    if (isJSProxyValue(obj)) {
      const key = isString(index) ? getPayload(index) : toDisplayString(index);
      return runtimeGetProperty(obj, key, this.interp);
    }
    if (this.fv) {
      const slot = this.fv.getSlot(fbSlot);
      if (slot)
        slot.recordArrayAccess(
          isArray(obj),
          isSmi(index),
          isArray(obj) ? getPayload(obj).getElementsKind() : null,
        );
    }
    if (isArray(obj)) {
      const idx = toNumber(index);
      const key = isString(index) ? getPayload(index) : toDisplayString(index);
      const icKey = this.cf.name + ":" + fbSlot;
      const ic = this.interp.icManager.getOrCreate(icKey);
      const result = Number.isInteger(idx)
        ? ic.lookupElement(getPayload(obj), idx)
        : { value: runtimeGetProperty(obj, key, this.interp) };
      const val = result.value;
      return val !== undefined ? val : this.u;
    }
    if (isString(obj) && isSmi(index)) {
      const ch = getPayload(obj)[getPayload(index)];
      return ch !== undefined ? mkString(ch) : this.u;
    }
    if (isObject(obj)) {
      const key = isString(index) ? getPayload(index) : toDisplayString(index);
      return runtimeGetProperty(obj, key, this.interp);
    }
    return this.u;
  }

  si(obj, index, val, fbSlot) {
    if (isJSProxyValue(obj)) {
      const key = isString(index) ? getPayload(index) : toDisplayString(index);
      runtimeSetProperty(obj, key, val, this.interp);
      return;
    }
    if (this.fv) {
      const slot = this.fv.getSlot(fbSlot);
      if (slot)
        slot.recordArrayAccess(
          isArray(obj),
          isSmi(index),
          isArray(obj) ? getPayload(obj).getElementsKind() : null,
        );
    }
    if (isArray(obj)) {
      const idx = toNumber(index);
      if (Number.isInteger(idx)) {
        const icKey = this.cf.name + ":" + fbSlot;
        const ic = this.interp.icManager.getOrCreate(icKey);
        ic.lookupElementForWrite(getPayload(obj), idx, val);
        if (this.fv) {
          const slot = this.fv.getSlot(fbSlot);
          if (slot)
            slot.recordArrayAccess(
              true,
              true,
              getPayload(obj).getElementsKind(),
            );
        }
      } else {
        const key = isString(index)
          ? getPayload(index)
          : toDisplayString(index);
        runtimeSetProperty(obj, key, val, this.interp);
      }
    } else if (isObject(obj)) {
      const key = isString(index) ? getPayload(index) : toDisplayString(index);
      runtimeSetProperty(obj, key, val, this.interp);
    }
  }

  add(l, r, fbSlot) {
    this.rfb(fbSlot, l, r);
    if (isSmi(l) && isSmi(r)) {
      const res = getPayload(l) + getPayload(r);
      return res === (res | 0) ? mkSmi(res) : mkDouble(res);
    }
    if (isNumber(l) && isNumber(r)) return mkDouble(toNumber(l) + toNumber(r));
    if (isString(l) || isString(r))
      return mkString(toDisplayString(l) + toDisplayString(r));
    return mkDouble(toNumber(l) + toNumber(r));
  }

  sub(l, r, fbSlot) {
    this.rfb(fbSlot, l, r);
    if (isSmi(l) && isSmi(r)) {
      const res = getPayload(l) - getPayload(r);
      return res === (res | 0) ? mkSmi(res) : mkDouble(res);
    }
    return mkDouble(toNumber(l) - toNumber(r));
  }

  mul(l, r, fbSlot) {
    this.rfb(fbSlot, l, r);
    if (isSmi(l) && isSmi(r)) {
      const res = getPayload(l) * getPayload(r);
      return res === (res | 0) ? mkSmi(res) : mkDouble(res);
    }
    return mkDouble(toNumber(l) * toNumber(r));
  }

  div(l, r, fbSlot) {
    this.rfb(fbSlot, l, r);
    const res = toNumber(l) / toNumber(r);
    return Number.isInteger(res) && res === (res | 0)
      ? mkSmi(res)
      : mkDouble(res);
  }

  mod(l, r, fbSlot) {
    this.rfb(fbSlot, l, r);
    if (isSmi(l) && isSmi(r) && getPayload(r) !== 0)
      return mkSmi(getPayload(l) % getPayload(r));
    return mkDouble(toNumber(l) % toNumber(r));
  }

  eq(l, r, fbSlot) {
    this.rfb(fbSlot, l, r);
    if (isSmi(l) && isSmi(r)) return mkBool(getPayload(l) === getPayload(r));
    if (isNumber(l) && isNumber(r)) return mkBool(toNumber(l) === toNumber(r));
    if (isString(l) && isString(r))
      return mkBool(getPayload(l) === getPayload(r));
    if (isBool(l) && isBool(r)) return mkBool(getPayload(l) === getPayload(r));
    if (isNull(l) && isNull(r)) return this.t;
    if (isUndefined(l) && isUndefined(r)) return this.t;
    if ((isNull(l) || isUndefined(l)) && (isNull(r) || isUndefined(r)))
      return this.t;
    return this.f;
  }

  neq(l, r, fbSlot) {
    this.rfb(fbSlot, l, r);
    if (isSmi(l) && isSmi(r)) return mkBool(getPayload(l) !== getPayload(r));
    if (isNumber(l) && isNumber(r)) return mkBool(toNumber(l) !== toNumber(r));
    if (isString(l) && isString(r))
      return mkBool(getPayload(l) !== getPayload(r));
    if (isBool(l) && isBool(r)) return mkBool(getPayload(l) !== getPayload(r));
    if ((isNull(l) || isUndefined(l)) && (isNull(r) || isUndefined(r)))
      return this.f;
    return this.t;
  }

  cmp(l, r, op, fbSlot) {
    this.rfb(fbSlot, l, r);
    let result;
    if (isNumber(l) && isNumber(r)) {
      const ln = toNumber(l),
        rn = toNumber(r);
      switch (op) {
        case 0:
          result = ln < rn;
          break;
        case 1:
          result = ln > rn;
          break;
        case 2:
          result = ln <= rn;
          break;
        case 3:
          result = ln >= rn;
          break;
      }
    } else if (isString(l) && isString(r)) {
      switch (op) {
        case 0:
          result = getPayload(l) < getPayload(r);
          break;
        case 1:
          result = getPayload(l) > getPayload(r);
          break;
        case 2:
          result = getPayload(l) <= getPayload(r);
          break;
        case 3:
          result = getPayload(l) >= getPayload(r);
          break;
      }
    } else {
      const ln = toNumber(l),
        rn = toNumber(r);
      switch (op) {
        case 0:
          result = ln < rn;
          break;
        case 1:
          result = ln > rn;
          break;
        case 2:
          result = ln <= rn;
          break;
        case 3:
          result = ln >= rn;
          break;
      }
    }
    return mkBool(result);
  }

  not(val, fbSlot) {
    if (fbSlot >= 0 && this.fv) {
      const slot = this.fv.getSlot(fbSlot);
      if (slot) slot.recordUnaryOp(getTag(val));
    }
    return mkBool(!toBool(val));
  }

  neg(val, fbSlot) {
    if (fbSlot >= 0 && this.fv) {
      const slot = this.fv.getSlot(fbSlot);
      if (slot) slot.recordUnaryOp(getTag(val));
    }
    return mkNumber(-toNumber(val));
  }

  typeofOp(val) {
    return mkString(typeOf(val));
  }

  bitand(left, right, fbSlot) {
    this._recordBinaryFb(left, right, fbSlot);
    return mkSmi((toNumber(left) | 0) & (toNumber(right) | 0));
  }
  bitor(left, right, fbSlot) {
    this._recordBinaryFb(left, right, fbSlot);
    return mkSmi(toNumber(left) | 0 | (toNumber(right) | 0));
  }
  bitxor(left, right, fbSlot) {
    this._recordBinaryFb(left, right, fbSlot);
    return mkSmi((toNumber(left) | 0) ^ (toNumber(right) | 0));
  }
  shl(left, right, fbSlot) {
    this._recordBinaryFb(left, right, fbSlot);
    return mkSmi((toNumber(left) | 0) << (toNumber(right) & 0x1f));
  }
  shr(left, right, fbSlot) {
    this._recordBinaryFb(left, right, fbSlot);
    return mkSmi((toNumber(left) | 0) >> (toNumber(right) & 0x1f));
  }
  ushr(left, right, fbSlot) {
    this._recordBinaryFb(left, right, fbSlot);
    const result = (toNumber(left) | 0) >>> (toNumber(right) & 0x1f);
    return result === (result | 0) ? mkSmi(result) : mkDouble(result);
  }
  pow(left, right, fbSlot) {
    this._recordBinaryFb(left, right, fbSlot);
    const result = toNumber(left) ** toNumber(right);
    return Number.isInteger(result) && result === (result | 0)
      ? mkSmi(result)
      : mkDouble(result);
  }
  bitnot(val, fbSlot) {
    if (fbSlot >= 0 && this.fv) {
      const slot = this.fv.getSlot(fbSlot);
      if (slot) slot.recordUnaryOp(getTag(val));
    }
    return mkSmi(~(toNumber(val) | 0));
  }
  instanceofOp(left, right, fbSlot) {
    this._recordBinaryFb(left, right, fbSlot);
    let result = false;
    if (isObject(left) && isFunction(right)) {
      const fn = getPayload(right);
      if (fn.prototypeObj) {
        let proto = getPayload(left).prototype;
        while (proto) {
          if (proto === fn.prototypeObj) {
            result = true;
            break;
          }
          proto = proto.prototype;
        }
      }
    }
    return mkBool(result);
  }
  inOp(left, right, fbSlot) {
    this._recordBinaryFb(left, right, fbSlot);
    let result = false;
    if (isObject(right)) {
      const key = isString(left) ? getPayload(left) : toDisplayString(left);
      result = runtimeHasProperty(right, key, this.interp);
    } else if (isArray(right)) {
      const idx = toNumber(left);
      result =
        Number.isInteger(idx) &&
        idx >= 0 &&
        idx < getPayload(right).getLength();
    }
    return mkBool(result);
  }
  deleteProp(obj, propNameIdx) {
    const propName = this.cf.constants[propNameIdx];
    if (isObject(obj)) {
      runtimeDeleteProperty(obj, propName, this.interp);
    }
    return mkBool(true);
  }
  _recordBinaryFb(left, right, fbSlot) {
    if (fbSlot >= 0 && this.fv) {
      const slot = this.fv.getSlot(fbSlot);
      if (slot) slot.recordBinaryOp(getTag(left), getTag(right));
    }
  }

  branch(fbSlot, taken) {
    if (fbSlot >= 0 && this.fv) {
      const slot = this.fv.getSlot(fbSlot);
      if (slot) slot.recordBranch(taken);
    }
  }

  invokeCall(callee, args, receiver, fbSlot, receiverInfo) {
    if (!isFunction(callee)) {
      throw new Error(
        `TypeError: ${toDisplayString(callee)} is not a function`,
      );
    }
    if (++globalCallDepth > MAX_CALL_DEPTH) {
      globalCallDepth--;
      throw new RangeError("Maximum call stack size exceeded");
    }

    const fn = getPayload(callee);
    const icKey = this.cf.name + ":" + fbSlot;
    const ic = this.interp.icManager.getOrCreate(icKey);
    ic.lookupCall(fn, args.length, receiverInfo ? receiverInfo.receiver : null);
    if (this.fv) {
      const slot = this.fv.getSlot(fbSlot);
      if (slot) {
        if (receiverInfo) {
          slot.recordCallTarget(
            fn.name || "<anonymous>",
            fn.compiled || null,
            args.length,
            receiverInfo.receiverMapId,
            receiverInfo.receiverMapVersion,
          );
        } else {
          slot.recordCallTarget(
            fn.name || "<anonymous>",
            fn.compiled || null,
            args.length,
          );
        }
      }
    }

    try {
      const result = this.interp.callFunctionValue(callee, args, receiver);

      if (this.fv) {
        const slot = this.fv.getSlot(fbSlot);
        if (slot && result) slot.recordReturnType(getTag(result));
      }

      return result;
    } finally {
      globalCallDepth--;
    }
  }

  invokeCall0(callee, fbSlot) {
    const optimized = this.fastOptimizedCall(callee, []);
    if (optimized !== null) return optimized;
    const fast = this.fastBaselineCall(callee, 0);
    if (fast) return fast(this.u, this.interp);
    return this.invokeCall(callee, [], this.u, fbSlot, null);
  }

  invokeCall1(callee, a0, fbSlot) {
    const optimized = this.fastOptimizedCall(callee, [a0]);
    if (optimized !== null) return optimized;
    const fast = this.fastBaselineCall(callee, 1);
    if (fast) return fast(a0, this.u, this.interp);
    return this.invokeCall(callee, [a0], this.u, fbSlot, null);
  }

  invokeCall2(callee, a0, a1, fbSlot) {
    const optimized = this.fastOptimizedCall(callee, [a0, a1]);
    if (optimized !== null) return optimized;
    const fast = this.fastBaselineCall(callee, 2);
    if (fast) return fast(a0, a1, this.u, this.interp);
    return this.invokeCall(callee, [a0, a1], this.u, fbSlot, null);
  }

  fastOptimizedCall(callee, args) {
    if (!isFunction(callee)) return null;
    const fn = getPayload(callee);
    if (
      !fn.compiled ||
      fn.closure ||
      fn.compiled.disableOptimization ||
      !fn.compiled.optimizedCode
    )
      return null;
    if (this.hasConstructorCalls(fn.compiled)) return null;
    if (isInsideWasmExecution()) return null;
    return fn.compiled.optimizedCode(args, this.u, this.interp);
  }

  hasConstructorCalls(compiledFn) {
    if (compiledFn.hasConstructorCalls !== undefined)
      return compiledFn.hasConstructorCalls;
    compiledFn.hasConstructorCalls = compiledFn.instructions.some(
      (instr) => instr.opcode === bytecode.ROP_NEW,
    );
    return compiledFn.hasConstructorCalls;
  }

  hasMethodCalls(compiledFn) {
    if (compiledFn.hasMethodCalls !== undefined)
      return compiledFn.hasMethodCalls;
    compiledFn.hasMethodCalls = compiledFn.instructions.some(
      (instr) => instr.opcode === bytecode.ROP_CALL_METHOD,
    );
    return compiledFn.hasMethodCalls;
  }

  fastBaselineCall(callee, argc) {
    if (!isFunction(callee)) return null;
    const fn = getPayload(callee);
    if (
      !fn.compiled ||
      fn.closure ||
      fn.compiled.disableOptimization ||
      !fn.compiled.baselineCode
    )
      return null;
    if (this.hasMethodCalls(fn.compiled)) return null;
    if (
      fn.compiled.optimizedCode &&
      !this.hasConstructorCalls(fn.compiled) &&
      !isInsideWasmExecution()
    )
      return null;
    fn.compiled.invocationCount = (fn.compiled.invocationCount || 0) + 1;
    if (
      fn.compiled.invocationCount === this.interp.tieringPolicy.jitThreshold &&
      !fn.compiled.optimizedCode &&
      !fn.compiled.disableOptimization &&
      this.interp.jitEngine &&
      typeof this.interp.jitEngine.optimizeFunction === "function"
    ) {
      this.interp.jitEngine.optimizeFunction(fn.compiled);
      if (fn.compiled.optimizedCode) {
        return null;
      }
    }
    return fn.compiled.baselineCode[`_call${argc}`] || null;
  }

  callMethod(callee, receiver, args, fbSlot) {
    if (!isFunction(callee)) {
      throw new Error(
        `TypeError: ${toDisplayString(callee)} is not a function`,
      );
    }

    const receiverMapId = isObject(receiver)
      ? getPayload(receiver).hiddenClass.id
      : null;
    const receiverMapVersion = isObject(receiver)
      ? getPayload(receiver).hiddenClass.version
      : null;
    return this.invokeCall(callee, args, receiver, fbSlot, {
      receiver,
      receiverMapId,
      receiverMapVersion,
    });
  }

  rcn(callee, args, fbSlot) {
    if (this.fv && fbSlot >= 0 && isFunction(callee)) {
      const slot = this.fv.getSlot(fbSlot);
      const fn = getPayload(callee);
      if (slot)
        slot.recordCallTarget(
          fn.name || "<anonymous>",
          fn.compiled || null,
          args.length,
        );
    }
    return this.interp.constructFunctionValue(callee, args);
  }

  newObj() {
    return mkObject(createJSObject());
  }

  newArr(elements) {
    return mkArray(createJSArray(elements));
  }

  rfb(fbSlot, l, r) {
    if (this.fv) {
      const slot = this.fv.getSlot(fbSlot);
      if (slot) slot.recordBinaryOp(getTag(l), getTag(r));
    }
  }

  toBool(v) {
    return toBool(v);
  }

  looseEq(a, b, fbSlot) {
    this.rfb(fbSlot, a, b);
    return abstractLooseEqual(a, b) ? this.t : this.f;
  }

  looseNeq(a, b, fbSlot) {
    this.rfb(fbSlot, a, b);
    return abstractLooseEqual(a, b) ? this.f : this.t;
  }

  isNullish(v) {
    return isNull(v) || isUndefined(v);
  }

  newRegex(constIdx) {
    const { pattern, flags } = this.consts[constIdx];
    return mkRegex(new RegExp(pattern, flags));
  }

  getLength(obj) {
    if (isArray(obj)) return mkSmi(getPayload(obj).getLength());
    if (isString(obj)) return mkSmi(getPayload(obj).length);
    return mkUndefined();
  }

  getKeys(obj) {
    if (isObject(obj)) {
      const keys = getPayload(obj).hiddenClass.getEnumerablePropertyNames();
      const elements = keys.map((k) => mkString(k));
      return mkArray(createJSArray(elements));
    }
    return mkArray(createJSArray([]));
  }

  restArgs(registers, startReg, argCount) {
    const rest = [];
    for (let i = startReg; i < argCount; i++) {
      rest.push(registers[i] || this.u);
    }
    return mkArray(createJSArray(rest));
  }

  spreadArray(arr) {
    if (isArray(arr)) {
      const payload = getPayload(arr);
      return payload.elements ? payload.elements.slice() : [];
    }
    return [];
  }

  copyProps(target, source) {
    if (isObject(target) && isObject(source)) {
      const tPayload = getPayload(target);
      const sPayload = getPayload(source);
      const keys = sPayload.hiddenClass.getEnumerablePropertyNames();
      for (const key of keys) {
        const val = sPayload.getProperty(key);
        if (val !== undefined) tPayload.setProperty(key, val);
      }
    }
    return target;
  }

  setComputedProp(obj, key, val) {
    if (isObject(obj)) {
      const propName = toDisplayString(key);
      getPayload(obj).setProperty(propName, val);
    }
    return val;
  }

  callSpread(callee, spreadArr) {
    const args = this.spreadArray(spreadArr);
    return this.interp.callFunctionValue(callee, args, this.u);
  }

  arrayPush(arr, val) {
    if (isArray(arr)) {
      getPayload(arr).push(val);
    }
    return val;
  }

  closure(fnConst, registers, closureEnv, openUpvalues) {
    const compiled = fnConst;
    const upvalueCount = compiled.upvalues.length;
    const cells = [];
    for (let i = 0; i < upvalueCount; i++) {
      const uv = compiled.upvalues[i];
      if (uv.isLocal) {
        if (openUpvalues.has(uv.index)) {
          cells.push(openUpvalues.get(uv.index));
        } else {
          const cell = new UpvalueCell({ registers }, uv.index);
          openUpvalues.set(uv.index, cell);
          cells.push(cell);
        }
      } else {
        cells.push(closureEnv ? closureEnv[uv.index] : null);
      }
    }
    return mkFunction({
      name: compiled.name,
      compiled,
      call: null,
      closure: cells,
    });
  }
}
