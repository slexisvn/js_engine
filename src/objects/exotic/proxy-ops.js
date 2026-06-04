import {
  mkArray,
  mkBool,
  mkFunction,
  mkObject,
  mkSmi,
  mkString,
  mkUndefined,
  isArray,
  isBool,
  isDouble,
  isFunction,
  isObject,
  isSmi,
  isString,
  isSymbol,
  toBool,
  toDisplayString,
  toNumber,
  getPayload,
} from "../../core/value/index.js";
import { AccessorPair } from "../heap/js-object.js";
import {
  createJSArray,
  createJSObject,
  createJSProxy,
} from "../heap/factory.js";
import { isJSProxyObject } from "./js-proxy.js";

export function isJSProxyValue(value) {
  return isObject(value) && isJSProxyObject(getPayload(value));
}

export function createProxyValue(target, handler) {
  return mkObject(createJSProxy(target, handler));
}

function keyToString(key) {
  return typeof key === "string" ? key : toDisplayString(key);
}

function slotValue(obj, desc, key) {
  if (desc.offset < obj.slots.length) return obj.slots[desc.offset];
  return obj.overflowProperties ? obj.overflowProperties.get(key) : undefined;
}

function getTrap(proxy, trapName, interpreter) {
  const trap = runtimeGetProperty(
    proxy.handler,
    trapName,
    interpreter,
    proxy.handler,
  );
  return isFunction(trap) ? trap : null;
}

function ordinaryGetObject(taggedReceiver, obj, key, interpreter) {
  const desc = obj.hiddenClass.lookupProperty(key);
  if (desc) {
    const value = slotValue(obj, desc, key);
    if (desc.kind === "accessor") {
      if (value instanceof AccessorPair && value.get && interpreter) {
        return interpreter.callFunctionValue(value.get, [], taggedReceiver);
      }
      return mkUndefined();
    }
    return value !== undefined ? value : mkUndefined();
  }
  if (obj.prototype) {
    const protoResult = obj.lookupPrototypeChain(key);
    if (protoResult.found && protoResult.descriptor) {
      if (protoResult.descriptor.kind === "accessor") {
        const pair = protoResult.value;
        if (pair instanceof AccessorPair && pair.get && interpreter) {
          return interpreter.callFunctionValue(pair.get, [], taggedReceiver);
        }
        return mkUndefined();
      }
      return protoResult.value !== undefined
        ? protoResult.value
        : mkUndefined();
    }
  }
  return mkUndefined();
}

function ordinarySetObject(taggedReceiver, obj, key, value, interpreter) {
  const desc = obj.hiddenClass.lookupProperty(key);
  if (desc && desc.kind === "accessor") {
    const pair = slotValue(obj, desc, key);
    if (pair instanceof AccessorPair && pair.set && interpreter) {
      interpreter.callFunctionValue(pair.set, [value], taggedReceiver);
      return true;
    }
    return false;
  }
  if (!desc && obj.prototype) {
    const protoResult = obj.lookupPrototypeChain(key);
    if (
      protoResult.found &&
      protoResult.descriptor &&
      protoResult.descriptor.kind === "accessor"
    ) {
      const pair = protoResult.value;
      if (pair instanceof AccessorPair && pair.set && interpreter) {
        interpreter.callFunctionValue(pair.set, [value], taggedReceiver);
        return true;
      }
      return false;
    }
  }
  return obj.setProperty(key, value);
}

function ordinaryGetDescriptorObject(obj, key) {
  const desc = obj.hiddenClass.lookupProperty(key);
  if (!desc) return mkUndefined();
  const result = createJSObject();
  const value = slotValue(obj, desc, key);
  if (desc.kind === "accessor") {
    if (value instanceof AccessorPair) {
      result.setProperty("get", value.get || mkUndefined());
      result.setProperty("set", value.set || mkUndefined());
    }
  } else {
    result.setProperty("value", value !== undefined ? value : mkUndefined());
    result.setProperty("writable", mkBool(desc.writable));
  }
  result.setProperty("enumerable", mkBool(desc.enumerable));
  result.setProperty("configurable", mkBool(desc.configurable));
  return mkObject(result);
}

function ordinaryDefinePropertyObject(obj, key, descObj) {
  const getterVal = runtimeGetProperty(descObj, "get");
  const setterVal = runtimeGetProperty(descObj, "set");
  if (
    (getterVal && isFunction(getterVal)) ||
    (setterVal && isFunction(setterVal))
  ) {
    const existingDesc = obj.hiddenClass.lookupProperty(key);
    if (existingDesc && existingDesc.kind === "accessor") {
      const existingPair = slotValue(obj, existingDesc, key);
      if (existingPair instanceof AccessorPair) {
        if (getterVal && isFunction(getterVal)) existingPair.get = getterVal;
        if (setterVal && isFunction(setterVal)) existingPair.set = setterVal;
      }
      return true;
    }
    const enumerable = runtimeGetProperty(descObj, "enumerable");
    const configurable = runtimeGetProperty(descObj, "configurable");
    return obj.defineProperty(key, {
      kind: "accessor",
      writable: false,
      enumerable: enumerable !== undefined ? toBool(enumerable) : false,
      configurable: configurable !== undefined ? toBool(configurable) : false,
      value: new AccessorPair(
        getterVal && isFunction(getterVal) ? getterVal : null,
        setterVal && isFunction(setterVal) ? setterVal : null,
      ),
    });
  }
  const val = runtimeGetProperty(descObj, "value");
  const writable = runtimeGetProperty(descObj, "writable");
  const enumerable = runtimeGetProperty(descObj, "enumerable");
  const configurable = runtimeGetProperty(descObj, "configurable");
  return obj.defineProperty(key, {
    kind: "data",
    writable: writable !== undefined ? toBool(writable) : false,
    enumerable: enumerable !== undefined ? toBool(enumerable) : false,
    configurable: configurable !== undefined ? toBool(configurable) : false,
    value: val !== undefined ? val : mkUndefined(),
  });
}

export function runtimeGetProperty(
  receiver,
  key,
  interpreter = null,
  originalReceiver = receiver,
) {
  if (isSymbol(key)) {
    if (isJSProxyValue(receiver)) {
      const proxy = getPayload(receiver);
      const trap = getTrap(proxy, "get", interpreter);
      if (trap && interpreter) {
        return interpreter.callFunctionValue(
          trap,
          [proxy.target, key, originalReceiver],
          proxy.handler,
        );
      }
      return runtimeGetProperty(
        proxy.target,
        key,
        interpreter,
        originalReceiver,
      );
    }
    if (isObject(receiver)) {
      const val = getPayload(receiver).getSymbolProperty(key);
      return val !== undefined ? val : mkUndefined();
    }
    if (isArray(receiver)) {
      const val = getPayload(receiver).getSymbolProperty(key);
      return val !== undefined ? val : mkUndefined();
    }
    return mkUndefined();
  }
  const propName = keyToString(key);
  if (isJSProxyValue(receiver)) {
    const proxy = getPayload(receiver);
    const trap = getTrap(proxy, "get", interpreter);
    if (trap && interpreter) {
      return interpreter.callFunctionValue(
        trap,
        [proxy.target, mkString(propName), originalReceiver],
        proxy.handler,
      );
    }
    return runtimeGetProperty(
      proxy.target,
      propName,
      interpreter,
      originalReceiver,
    );
  }
  if (isObject(receiver)) {
    return ordinaryGetObject(
      receiver,
      getPayload(receiver),
      propName,
      interpreter,
    );
  }
  if (isArray(receiver)) {
    const arr = getPayload(receiver);
    if (propName === "length") return mkSmi(arr.getLength());
    const idx = Number(propName);
    if (Number.isInteger(idx)) {
      const val = arr.getIndex(idx);
      return val !== undefined ? val : mkUndefined();
    }
    const val = arr.getProperty(propName);
    return val !== undefined ? val : mkUndefined();
  }
  if (isString(receiver)) {
    if (propName === "length") return mkSmi(getPayload(receiver).length);
    const idx = Number(propName);
    if (Number.isInteger(idx)) {
      const ch = getPayload(receiver)[idx];
      return ch !== undefined ? mkString(ch) : mkUndefined();
    }
  }
  if (isFunction(receiver)) {
    const fn = getPayload(receiver);
    if (fn.properties && fn.properties[propName])
      return fn.properties[propName];
    if (propName === "prototype") {
      if (!fn.prototypeObj) {
        fn.prototypeObj = createJSObject();
        fn.prototypeObj.constructorRef = fn;
      }
      return mkObject(fn.prototypeObj);
    }
  }
  return mkUndefined();
}

export function runtimeSetProperty(
  receiver,
  key,
  value,
  interpreter = null,
  originalReceiver = receiver,
) {
  if (isSymbol(key)) {
    if (isJSProxyValue(receiver)) {
      const proxy = getPayload(receiver);
      const trap = getTrap(proxy, "set", interpreter);
      if (trap && interpreter) {
        return toBool(
          interpreter.callFunctionValue(
            trap,
            [proxy.target, key, value, originalReceiver],
            proxy.handler,
          ),
        );
      }
      return runtimeSetProperty(
        proxy.target,
        key,
        value,
        interpreter,
        originalReceiver,
      );
    }
    if (isObject(receiver)) {
      getPayload(receiver).setSymbolProperty(key, value);
      return true;
    }
    if (isArray(receiver)) {
      getPayload(receiver).setSymbolProperty(key, value);
      return true;
    }
    return false;
  }
  const propName = keyToString(key);
  if (isJSProxyValue(receiver)) {
    const proxy = getPayload(receiver);
    const trap = getTrap(proxy, "set", interpreter);
    if (trap && interpreter) {
      return toBool(
        interpreter.callFunctionValue(
          trap,
          [proxy.target, mkString(propName), value, originalReceiver],
          proxy.handler,
        ),
      );
    }
    return runtimeSetProperty(
      proxy.target,
      propName,
      value,
      interpreter,
      originalReceiver,
    );
  }
  if (isObject(receiver))
    return ordinarySetObject(
      receiver,
      getPayload(receiver),
      propName,
      value,
      interpreter,
    );
  if (isArray(receiver)) {
    const arr = getPayload(receiver);
    if (propName === "length") {
      arr.setLength(toNumber(value));
      return true;
    }
    const idx = Number(propName);
    if (Number.isInteger(idx)) arr.setIndex(idx, value);
    else arr.setProperty(propName, value);
    return true;
  }
  return false;
}

export function runtimeHasProperty(receiver, key, interpreter = null) {
  if (isSymbol(key)) {
    if (isJSProxyValue(receiver)) {
      const proxy = getPayload(receiver);
      const trap = getTrap(proxy, "has", interpreter);
      if (trap && interpreter) {
        return toBool(
          interpreter.callFunctionValue(
            trap,
            [proxy.target, key],
            proxy.handler,
          ),
        );
      }
      return runtimeHasProperty(proxy.target, key, interpreter);
    }
    if (isObject(receiver)) return getPayload(receiver).hasSymbolProperty(key);
    if (isArray(receiver)) return getPayload(receiver).hasSymbolProperty(key);
    return false;
  }
  const propName = keyToString(key);
  if (isJSProxyValue(receiver)) {
    const proxy = getPayload(receiver);
    const trap = getTrap(proxy, "has", interpreter);
    if (trap && interpreter) {
      return toBool(
        interpreter.callFunctionValue(
          trap,
          [proxy.target, mkString(propName)],
          proxy.handler,
        ),
      );
    }
    return runtimeHasProperty(proxy.target, propName, interpreter);
  }
  if (isObject(receiver)) {
    const obj = getPayload(receiver);
    if (obj.hiddenClass.hasProperty(propName)) return true;
    return !!(obj.prototype && obj.lookupPrototypeChain(propName).found);
  }
  if (isArray(receiver)) {
    const idx = Number(propName);
    if (Number.isInteger(idx))
      return idx >= 0 && idx < getPayload(receiver).getLength();
    return getPayload(receiver).getProperty(propName) !== undefined;
  }
  return false;
}

export function runtimeDeleteProperty(receiver, key, interpreter = null) {
  if (isSymbol(key)) {
    if (isJSProxyValue(receiver)) {
      const proxy = getPayload(receiver);
      const trap = getTrap(proxy, "deleteProperty", interpreter);
      if (trap && interpreter) {
        return toBool(
          interpreter.callFunctionValue(
            trap,
            [proxy.target, key],
            proxy.handler,
          ),
        );
      }
      return runtimeDeleteProperty(proxy.target, key, interpreter);
    }
    if (isObject(receiver))
      return getPayload(receiver).deleteSymbolProperty(key);
    return true;
  }
  const propName = keyToString(key);
  if (isJSProxyValue(receiver)) {
    const proxy = getPayload(receiver);
    const trap = getTrap(proxy, "deleteProperty", interpreter);
    if (trap && interpreter) {
      return toBool(
        interpreter.callFunctionValue(
          trap,
          [proxy.target, mkString(propName)],
          proxy.handler,
        ),
      );
    }
    return runtimeDeleteProperty(proxy.target, propName, interpreter);
  }
  if (isObject(receiver)) return getPayload(receiver).deleteProperty(propName);
  return true;
}

export function runtimeOwnKeys(receiver, interpreter = null) {
  if (isJSProxyValue(receiver)) {
    const proxy = getPayload(receiver);
    const trap = getTrap(proxy, "ownKeys", interpreter);
    if (trap && interpreter) {
      const result = interpreter.callFunctionValue(
        trap,
        [proxy.target],
        proxy.handler,
      );
      if (isArray(result))
        return getPayload(result).elements.map((key) => keyToString(key));
      return [];
    }
    return runtimeOwnKeys(proxy.target, interpreter);
  }
  if (isObject(receiver)) return getPayload(receiver).keys();
  if (isArray(receiver))
    return getPayload(receiver).keys ? getPayload(receiver).keys() : [];
  return [];
}

export function runtimeGetOwnPropertyDescriptor(
  receiver,
  key,
  interpreter = null,
) {
  const propName = keyToString(key);
  if (isJSProxyValue(receiver)) {
    const proxy = getPayload(receiver);
    const trap = getTrap(proxy, "getOwnPropertyDescriptor", interpreter);
    if (trap && interpreter) {
      const result = interpreter.callFunctionValue(
        trap,
        [proxy.target, mkString(propName)],
        proxy.handler,
      );
      return result !== undefined ? result : mkUndefined();
    }
    return runtimeGetOwnPropertyDescriptor(proxy.target, propName, interpreter);
  }
  if (isObject(receiver))
    return ordinaryGetDescriptorObject(getPayload(receiver), propName);
  return mkUndefined();
}

export function runtimeDefineProperty(receiver, key, desc, interpreter = null) {
  const propName = keyToString(key);
  if (isJSProxyValue(receiver)) {
    const proxy = getPayload(receiver);
    const trap = getTrap(proxy, "defineProperty", interpreter);
    if (trap && interpreter) {
      return toBool(
        interpreter.callFunctionValue(
          trap,
          [proxy.target, mkString(propName), desc],
          proxy.handler,
        ),
      );
    }
    return runtimeDefineProperty(proxy.target, propName, desc, interpreter);
  }
  if (isObject(receiver) && isObject(desc))
    return ordinaryDefinePropertyObject(getPayload(receiver), propName, desc);
  return false;
}

export function keysArray(keys) {
  return mkArray(createJSArray(keys.map((key) => mkString(key))));
}

export function proxyTargetIsValid(value) {
  return isObject(value) || isArray(value) || isFunction(value);
}
