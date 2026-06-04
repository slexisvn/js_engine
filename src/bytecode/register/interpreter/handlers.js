import {
  mkSmi,
  mkString,
  mkObject,
  mkFunction,
  mkUndefined,
  mkBool,
  mkGenerator,
  mkRegex,
  mkArray,
  mkNumber,
  isSmi,
  isNumber,
  isString,
  isObject,
  isFunction,
  isArray,
  isRegex,
  isPromise,
  isGenerator,
  isSymbol,
  isBool,
  isDouble,
  toNumber,
  toDisplayString,
  getPayload,
} from "../../../core/value/index.js";

import { AccessorPair } from "../../../objects/heap/js-object.js";
import {
  INSTANCE_TYPE_MAP,
  INSTANCE_TYPE_SET,
  INSTANCE_TYPE_STRING_WRAPPER,
  INSTANCE_TYPE_NUMBER_WRAPPER,
  INSTANCE_TYPE_BOOLEAN_WRAPPER,
} from "../../../objects/maps/hidden-class.js";
import {
  createJSObject,
  createJSArray,
} from "../../../objects/heap/factory.js";
import {
  mkPromiseCapability,
  promiseThen,
  PROMISE_FULFILLED,
  PROMISE_REJECTED,
} from "../../../runtime/async/promise.js";
import { createIteratorResult } from "../../../runtime/iteration/iterator.js";
import {
  GeneratorSuspend,
  GEN_NEWBORN,
  GEN_EXECUTING,
  GEN_SUSPENDED,
  GEN_COMPLETED,
} from "../../../runtime/iteration/generator.js";
import { getRegexProperty } from "../../../runtime/intrinsics/regex-methods.js";
import { VMTypeError } from "../../../core/errors/index.js";
import {
  isJSProxyValue,
  runtimeDeleteProperty,
  runtimeGetProperty,
  runtimeSetProperty,
  runtimeOwnKeys,
  runtimeHasProperty,
} from "../../../objects/exotic/proxy-ops.js";
import { RegisterMiniJITException } from "./helpers.js";
import { RegisterFrame } from "./frame.js";

export function handleLdaProp(interp, frame, operands, compiledFn, funcName) {
  const objReg = operands[0];
  const propNameIdx = operands[1];
  const fbSlotIdx = operands[2];
  const obj = frame.getReg(objReg);
  const propName = compiledFn.constants[propNameIdx];

  if (isJSProxyValue(obj)) {
    return runtimeGetProperty(obj, propName, interp);
  }

  if (isObject(obj)) {
    const jsObj = getPayload(obj);

    const accDesc = jsObj.hiddenClass.lookupProperty(propName);
    if (accDesc && accDesc.kind === "accessor") {
      const pair = jsObj.slots[accDesc.offset];
      if (pair instanceof AccessorPair && pair.get) {
        return interp.callFunctionValue(pair.get, [], obj);
      } else {
        return mkUndefined();
      }
    }
    if (!accDesc && jsObj.prototype) {
      const protoAcc = jsObj.lookupPrototypeChain(propName);
      if (
        protoAcc.found &&
        protoAcc.descriptor &&
        protoAcc.descriptor.kind === "accessor"
      ) {
        const pair = protoAcc.value;
        if (pair instanceof AccessorPair && pair.get) {
          return interp.callFunctionValue(pair.get, [], obj);
        } else {
          return mkUndefined();
        }
      }
    }

    if (propName === "size") {
      const itype = jsObj.hiddenClass.instanceType;
      if (itype === INSTANCE_TYPE_MAP) return mkSmi(jsObj._mapData.size);
      if (itype === INSTANCE_TYPE_SET) return mkSmi(jsObj._setData.size);
    }

    const wrapperType = jsObj.hiddenClass.instanceType;
    if (wrapperType === INSTANCE_TYPE_STRING_WRAPPER && jsObj._primitiveValue !== undefined) {
      if (propName === "length") return mkSmi(getPayload(jsObj._primitiveValue).length);
      const idx = Number(propName);
      if (Number.isInteger(idx)) {
        const ch = getPayload(jsObj._primitiveValue)[idx];
        return ch !== undefined ? mkString(ch) : mkUndefined();
      }
    }

    const icKey = compiledFn.getICKey(funcName, fbSlotIdx);
    const ic = interp.icManager.getOrCreate(icKey);
    const result = ic.lookup(jsObj, propName);

    const slot = compiledFn.feedbackVector
      ? compiledFn.feedbackVector.getSlot(fbSlotIdx)
      : null;
    if (slot) {
      const info = jsObj.hiddenClass.lookupProperty(propName);
      if (info) {
        slot.recordPropertyAccess(
          jsObj.hiddenClass.id,
          info.offset,
          jsObj.hiddenClass.version,
          0,
        );
      } else if (jsObj.prototype) {
        const protoResult_ = jsObj.lookupPrototypeChain(propName);
        if (protoResult_.found && protoResult_.descriptor) {
          slot.recordPropertyAccess(
            jsObj.hiddenClass.id,
            protoResult_.descriptor.offset,
            jsObj.hiddenClass.version,
            protoResult_.depth,
          );
        }
      }
    }

    if (result.hit) {
      return result.value;
    } else {
      let val = jsObj.getProperty(propName);
      if (val === undefined && jsObj.prototype) {
        const protoResult = jsObj.lookupPrototypeChain(propName);
        if (protoResult.found) val = protoResult.value;
      }
      return val !== undefined ? val : mkUndefined();
    }
  } else if (isArray(obj)) {
    if (propName === "length") {
      const slot_arr = compiledFn.feedbackVector
        ? compiledFn.feedbackVector.getSlot(fbSlotIdx)
        : null;
      if (slot_arr)
        slot_arr.recordArrayLengthAccess(
          true,
          getPayload(obj).getElementsKind(),
        );
      return mkSmi(getPayload(obj).getLength());
    } else {
      const idx = Number(propName);
      if (Number.isInteger(idx)) {
        const val = getPayload(obj).getIndex(idx);
        return val !== undefined ? val : mkUndefined();
      } else {
        const jsArr = getPayload(obj);
        const ownVal = jsArr.getProperty(propName);
        if (ownVal !== undefined) {
          return ownVal;
        } else {
          return interp._lookupBuiltinPrototype(
            interp.builtinPrototypes.arrayPrototype,
            propName,
          );
        }
      }
    }
  } else if (isString(obj)) {
    if (propName === "length") {
      return mkSmi(getPayload(obj).length);
    } else {
      const idx = Number(propName);
      if (Number.isInteger(idx)) {
        const ch = getPayload(obj)[idx];
        return ch !== undefined ? mkString(ch) : mkUndefined();
      } else {
        return interp._lookupBuiltinPrototype(
          interp.builtinPrototypes.stringPrototype,
          propName,
        );
      }
    }
  } else if (isRegex(obj)) {
    const rv = getPayload(obj);
    const regexProp = getRegexProperty(propName, rv);
    if (regexProp !== null) {
      return regexProp;
    } else {
      return interp._lookupBuiltinPrototype(
        interp.builtinPrototypes.regexPrototype,
        propName,
      );
    }
  } else if (isGenerator(obj)) {
    return handleGeneratorProp(interp, obj, propName);
  } else if (isPromise(obj)) {
    return handlePromiseProp(interp, obj, propName);
  } else if (isFunction(obj)) {
    const fn = getPayload(obj);
    if (fn.properties && fn.properties[propName]) {
      return fn.properties[propName];
    } else if (propName === "prototype") {
      if (!fn.prototypeObj) {
        fn.prototypeObj = createJSObject();
        fn.prototypeObj.constructorRef = fn;
      }
      return mkObject(fn.prototypeObj);
    } else {
      return mkUndefined();
    }
  } else if (isSmi(obj) || isDouble(obj)) {
    return interp._lookupBuiltinPrototype(
      interp.builtinPrototypes.numberPrototype,
      propName,
    );
  } else if (isBool(obj)) {
    return interp._lookupBuiltinPrototype(
      interp.builtinPrototypes.booleanPrototype,
      propName,
    );
  } else {
    return mkUndefined();
  }
}

function handleGeneratorProp(interp, obj, propName) {
  const gen = getPayload(obj);
  if (propName === "next") {
    return mkFunction({
      name: "next",
      call: (args) => {
        if (gen.state === GEN_COMPLETED)
          return createIteratorResult(mkUndefined(), true);
        if (gen.state === GEN_NEWBORN || gen.state === GEN_SUSPENDED) {
          const wasNewborn = gen.state === GEN_NEWBORN;
          gen.state = GEN_EXECUTING;
          try {
            const genFrame = gen.frame;
            if (args.length > 0 && !wasNewborn) genFrame.acc = args[0];
            const result = interp.runFrame(genFrame);
            gen.state = GEN_COMPLETED;
            return createIteratorResult(result, true);
          } catch (e) {
            if (e instanceof GeneratorSuspend) {
              gen.state = GEN_SUSPENDED;
              return createIteratorResult(e.value, false);
            }
            gen.state = GEN_COMPLETED;
            throw e;
          }
        }
        return createIteratorResult(mkUndefined(), true);
      },
      compiled: null,
    });
  } else if (propName === "return") {
    return mkFunction({
      name: "return",
      call: (args) => {
        gen.state = GEN_COMPLETED;
        return createIteratorResult(
          args.length > 0 ? args[0] : mkUndefined(),
          true,
        );
      },
      compiled: null,
    });
  } else if (propName === "throw") {
    return mkFunction({
      name: "Generator.throw",
      call: (args) => {
        const error = args[0] || mkUndefined();
        if (gen.state === GEN_COMPLETED || gen.state === GEN_NEWBORN) {
          gen.state = GEN_COMPLETED;
          throw new RegisterMiniJITException(error);
        }
        if (
          gen.frame.exceptionHandlers &&
          gen.frame.exceptionHandlers.length > 0
        ) {
          const handler = gen.frame.exceptionHandlers.pop();
          gen.frame.acc = error;
          gen.frame.pc = handler.catchPC;
          gen.state = GEN_EXECUTING;
          try {
            const result = interp.runFrame(gen.frame);
            gen.state = GEN_COMPLETED;
            return createIteratorResult(result, true);
          } catch (e) {
            if (e instanceof GeneratorSuspend) {
              gen.state = GEN_SUSPENDED;
              return createIteratorResult(e.value, false);
            }
            gen.state = GEN_COMPLETED;
            throw e;
          }
        }
        gen.state = GEN_COMPLETED;
        throw new RegisterMiniJITException(error);
      },
      compiled: null,
    });
  } else {
    return mkUndefined();
  }
}

function handlePromiseProp(interp, obj, propName) {
  const p = getPayload(obj);
  if (propName === "then") {
    return mkFunction({
      name: "Promise.prototype.then",
      call: (args, receiver, interpreter) => {
        return promiseThen(
          interpreter,
          receiver || obj,
          args[0] || mkUndefined(),
          args[1] || mkUndefined(),
        );
      },
      compiled: null,
    });
  } else if (propName === "catch") {
    return mkFunction({
      name: "Promise.prototype.catch",
      call: (args, receiver, interpreter) => {
        return promiseThen(
          interpreter,
          receiver || obj,
          mkUndefined(),
          args[0] || mkUndefined(),
        );
      },
      compiled: null,
    });
  } else if (propName === "finally") {
    return mkFunction({
      name: "Promise.prototype.finally",
      call: (args, receiver, interpreter) => {
        const { capability, value } = mkPromiseCapability(
          interpreter.microtaskQueue,
        );
        const callback = args[0];
        p.addReaction((state, result) => {
          try {
            if (isFunction(callback))
              interpreter.callFunctionValue(callback, [], mkUndefined());
            if (state === PROMISE_FULFILLED) capability.resolve(result);
            else capability.reject(result);
          } catch (e) {
            capability.reject(interpreter.exceptionToValue(e));
          }
        });
        return value;
      },
      compiled: null,
    });
  } else if (propName === "state") {
    return mkString(p.state);
  } else {
    return mkUndefined();
  }
}

export function handleStaProp(interp, frame, operands, compiledFn, funcName) {
  const objReg = operands[0];
  const propNameIdx = operands[1];
  const fbSlotIdx = operands[2];
  const obj = frame.getReg(objReg);
  const propName = compiledFn.constants[propNameIdx];
  const value = frame.acc;

  if (isJSProxyValue(obj)) {
    runtimeSetProperty(obj, propName, value, interp);
    return;
  }

  if (isObject(obj)) {
    const jsObj = getPayload(obj);

    const setAccDesc = jsObj.hiddenClass.lookupProperty(propName);
    if (setAccDesc && setAccDesc.kind === "accessor") {
      const pair = jsObj.slots[setAccDesc.offset];
      if (pair instanceof AccessorPair && pair.set) {
        interp.callFunctionValue(pair.set, [value], obj);
      }
      return;
    }
    if (!setAccDesc && jsObj.prototype) {
      const protoAcc = jsObj.lookupPrototypeChain(propName);
      if (
        protoAcc.found &&
        protoAcc.descriptor &&
        protoAcc.descriptor.kind === "accessor"
      ) {
        const pair = protoAcc.value;
        if (pair instanceof AccessorPair && pair.set) {
          interp.callFunctionValue(pair.set, [value], obj);
        }
        return;
      }
    }

    const icKey = compiledFn.getICKey(funcName, fbSlotIdx);
    const ic = interp.icManager.getOrCreate(icKey);
    ic.lookupForWrite(jsObj, propName, value);

    const slot = compiledFn.feedbackVector
      ? compiledFn.feedbackVector.getSlot(fbSlotIdx)
      : null;
    if (slot) {
      const info = jsObj.hiddenClass.lookupProperty(propName);
      if (info) {
        slot.recordPropertyAccess(
          jsObj.hiddenClass.id,
          info.offset,
          jsObj.hiddenClass.version,
          0,
        );
      } else if (jsObj.prototype) {
        const protoResult_ = jsObj.lookupPrototypeChain(propName);
        if (protoResult_.found && protoResult_.descriptor) {
          slot.recordPropertyAccess(
            jsObj.hiddenClass.id,
            protoResult_.descriptor.offset,
            jsObj.hiddenClass.version,
            protoResult_.depth,
          );
        }
      }
    }
  } else if (isArray(obj)) {
    const jsArr = getPayload(obj);
    if (propName === "length") {
      jsArr.setLength(toNumber(value));
    } else {
      const idx = Number(propName);
      if (Number.isInteger(idx) && idx >= 0) {
        jsArr.setIndex(idx, value);
      } else {
        jsArr.setProperty(propName, value);
      }
    }
  } else if (isFunction(obj)) {
    const fn = getPayload(obj);
    if (!fn.properties) fn.properties = {};
    fn.properties[propName] = value;
  } else if (isRegex(obj) && propName === "lastIndex") {
    getPayload(obj).lastIndex = toNumber(value);
  }
}

export function handleLdaIndex(interp, frame, operands, compiledFn, funcName) {
  const objReg = operands[0];
  const idxReg = operands[1];
  const fbSlotIdx_idx = operands.length > 2 ? operands[2] : -1;
  const obj = frame.getReg(objReg);
  const index = frame.getReg(idxReg);

  if (isSymbol(index)) {
    return runtimeGetProperty(obj, index, interp);
  }

  if (isJSProxyValue(obj)) {
    const key = isString(index) ? getPayload(index) : toDisplayString(index);
    return runtimeGetProperty(obj, key, interp);
  }

  if (fbSlotIdx_idx >= 0 && compiledFn.feedbackVector) {
    const slot = compiledFn.feedbackVector.getSlot(fbSlotIdx_idx);
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
    const icKey = compiledFn.getICKey(
      funcName,
      fbSlotIdx_idx >= 0 ? fbSlotIdx_idx : 0,
    );
    const ic = interp.icManager.getOrCreate(icKey);
    const result = Number.isInteger(idx)
      ? ic.lookupElement(getPayload(obj), idx)
      : { value: runtimeGetProperty(obj, key, interp) };
    return result.value !== undefined ? result.value : mkUndefined();
  } else if (isString(obj) && isNumber(index)) {
    const idx = toNumber(index);
    const ch = getPayload(obj)[idx];
    return ch !== undefined ? mkString(ch) : mkUndefined();
  } else if (isObject(obj)) {
    const key = isString(index) ? getPayload(index) : toDisplayString(index);
    return runtimeGetProperty(obj, key, interp);
  } else {
    return mkUndefined();
  }
}

export function handleStaIndex(interp, frame, operands, compiledFn, funcName) {
  const objReg = operands[0];
  const idxReg = operands[1];
  const fbSlotIdx_si = operands.length > 2 ? operands[2] : -1;
  const obj = frame.getReg(objReg);
  const index = frame.getReg(idxReg);
  const value = frame.acc;

  if (isSymbol(index)) {
    runtimeSetProperty(obj, index, value, interp);
    return;
  }

  if (isJSProxyValue(obj)) {
    const key = isString(index) ? getPayload(index) : toDisplayString(index);
    runtimeSetProperty(obj, key, value, interp);
    return;
  }

  if (fbSlotIdx_si >= 0 && compiledFn.feedbackVector) {
    const slot = compiledFn.feedbackVector.getSlot(fbSlotIdx_si);
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
      const icKey = compiledFn.getICKey(
        funcName,
        fbSlotIdx_si >= 0 ? fbSlotIdx_si : 0,
      );
      const ic = interp.icManager.getOrCreate(icKey);
      ic.lookupElementForWrite(getPayload(obj), idx, value);
    } else {
      const key = isString(index) ? getPayload(index) : toDisplayString(index);
      runtimeSetProperty(obj, key, value, interp);
    }
  } else if (isObject(obj)) {
    const key = isString(index) ? getPayload(index) : toDisplayString(index);
    runtimeSetProperty(obj, key, value, interp);
  }
}

export function handleNew(interp, frame, operands, compiledFn) {
  const funcReg = operands[0];
  const firstArgReg = operands[1];
  const argCount = operands[2];

  const callee = frame.getReg(funcReg);
  const args = [];
  for (let i = 0; i < argCount; i++) {
    args.push(frame.getReg(firstArgReg + i));
  }

  if (isFunction(callee)) {
    const fn = getPayload(callee);
    if (fn.construct) {
      return fn.construct(args);
    } else if (fn.compiled) {
      if (fn.compiled) interp.initFeedbackVector(fn.compiled);
      const stub = !fn.closure
        ? interp.getConstructorStub(fn.compiled, fn)
        : null;
      if (stub) {
        return stub(args);
      } else {
        const newObj = createJSObject();
        if (!fn.prototypeObj) {
          fn.prototypeObj = createJSObject();
          fn.prototypeObj.constructorRef = fn;
        }
        newObj.setPrototype(fn.prototypeObj);
        const thisVal = mkObject(newObj);
        let returnVal;
        if (fn.closure) {
          interp.initFeedbackVector(fn.compiled);
          const ctorFrame = new RegisterFrame(
            fn.compiled,
            args,
            thisVal,
            fn.closure,
          );
          returnVal = interp.runFrame(ctorFrame);
        } else {
          returnVal = interp.execute(fn.compiled, args, thisVal);
        }
        return isObject(returnVal) ? returnVal : thisVal;
      }
    } else {
      throw new VMTypeError(`${toDisplayString(callee)} is not a constructor`);
    }
  } else {
    throw new VMTypeError(`${toDisplayString(callee)} is not a constructor`);
  }
}

export function handleDefineAccessor(interp, frame, operands, compiledFn) {
  const daObjReg = operands[0];
  const daPropIdx = operands[1];
  const daGetterReg = operands[2];
  const daSetterReg = operands[3];
  const daObj = frame.getReg(daObjReg);
  if (isObject(daObj)) {
    const jsObj = getPayload(daObj);
    const propName = compiledFn.constants[daPropIdx];
    const getter = daGetterReg >= 0 ? frame.getReg(daGetterReg) : null;
    const setter = daSetterReg >= 0 ? frame.getReg(daSetterReg) : null;
    const existingDesc = jsObj.hiddenClass.lookupProperty(propName);
    if (existingDesc && existingDesc.kind === "accessor") {
      const existingPair =
        existingDesc.offset < jsObj.slots.length
          ? jsObj.slots[existingDesc.offset]
          : jsObj.overflowProperties.get(propName);
      if (existingPair instanceof AccessorPair) {
        if (getter) existingPair.get = getter;
        if (setter) existingPair.set = setter;
      }
    } else {
      const pair = new AccessorPair(getter, setter);
      jsObj.defineProperty(propName, {
        kind: "accessor",
        writable: false,
        enumerable: true,
        configurable: true,
        value: pair,
      });
    }
  }
}

export function handleInstanceof(interp, frame, left, right) {
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

export function handleIn(interp, frame, left, right) {
  let result = false;
  if (isSymbol(left)) {
    result = runtimeHasProperty(right, left, interp);
  } else if (isObject(right)) {
    const key = isString(left) ? getPayload(left) : toDisplayString(left);
    result = runtimeHasProperty(right, key, interp);
  } else if (isArray(right)) {
    const idx = toNumber(left);
    result =
      Number.isInteger(idx) && idx >= 0 && idx < getPayload(right).getLength();
  }
  return mkBool(result);
}

export function handleDeleteProp(interp, frame, operands, compiledFn) {
  const objReg = operands[0];
  const propNameIdx = operands[1];
  const keyReg = operands.length > 2 ? operands[2] : -1;
  const obj = frame.getReg(objReg);
  var propName;
  if (keyReg >= 0) {
    propName = toDisplayString(frame.getReg(keyReg));
  } else {
    propName = compiledFn.constants[propNameIdx];
  }
  if (isObject(obj)) {
    runtimeDeleteProperty(obj, propName, interp);
  }
  return mkBool(true);
}
