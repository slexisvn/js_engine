import {
  mkUndefined,
  mkNumber,
  mkString,
  mkBool,
  mkDouble,
  mkSmi,
  mkNull,
  mkArray,
  mkObject,
  mkRegex,
  mkSymbol,
  toDisplayString,
  isNumber,
  isSmi,
  isDouble,
  isString,
  isBool,
  isObject,
  isArray,
  isNull,
  isUndefined,
  isSymbol,
  isIterator,
  toNumber,
  toBool,
  getPayload,
  typeOf,
  isFunction,
  JSSymbol,
  symbolFor,
  symbolKeyFor,
} from "../../core/value/index.js";

import { createJSObject, createJSArray, createJSMap, createJSSet, createJSWeakMap } from "../../objects/heap/factory.js";
import { AccessorPair } from "../../objects/heap/js-object.js";
import { tracer } from "../../core/tracing/index.js";
import { VMTypeError } from "../../core/errors/index.js";
import {
  createProxyValue,
  keysArray,
  proxyTargetIsValid,
  runtimeDefineProperty,
  runtimeGetOwnPropertyDescriptor,
  runtimeGetProperty,
  runtimeOwnKeys,
  runtimeSetProperty,
} from "../../objects/exotic/proxy-ops.js";

function extractArgNumber(args, index, defaultVal) {
  if (index >= args.length) return defaultVal;
  const val = args[index];
  return toNumber(val);
}

function extractArgString(args, index, defaultVal) {
  if (index >= args.length) return defaultVal;
  const val = args[index];
  return toDisplayString(val);
}

export const builtins = {
  print: {
    name: "print",
    call(args) {
      const output = args.map((a) => toDisplayString(a)).join(" ");
      console.log(output);
      return mkUndefined();
    },
  },

  console: {
    log: {
      name: "console.log",
      call(args) {
        const output = args.map((a) => toDisplayString(a)).join(" ");
        console.log(output);
        return mkUndefined();
      },
    },
  },

  typeof: {
    name: "typeof",
    call(args) {
      const v = args[0];
      if (!v) return mkString("undefined");
      return mkString(typeOf(v));
    },
  },

  parseInt: {
    name: "parseInt",
    call(args) {
      const str = extractArgString(args, 0, "NaN");
      const radix = args.length > 1 ? extractArgNumber(args, 1, 10) : 10;
      const result = parseInt(str, radix);
      return mkNumber(result);
    },
  },

  parseFloat: {
    name: "parseFloat",
    call(args) {
      const str = extractArgString(args, 0, "NaN");
      const result = parseFloat(str);
      return mkNumber(result);
    },
  },

  isNaN: {
    name: "isNaN",
    call(args) {
      const v = args[0] || mkUndefined();
      return mkBool(Number.isNaN(toNumber(v)));
    },
  },

  isFinite: {
    name: "isFinite",
    call(args) {
      const v = args[0] || mkUndefined();
      return mkBool(Number.isFinite(toNumber(v)));
    },
  },

  Number: {
    name: "Number",
    call(args) {
      if (args.length === 0) return mkSmi(0);
      return mkNumber(toNumber(args[0]));
    },
  },

  Boolean: {
    name: "Boolean",
    call(args) {
      if (args.length === 0) return mkBool(false);
      return mkBool(toBool(args[0]));
    },
  },

  RegExp: {
    name: "RegExp",
    call(args) {
      const pattern = args.length > 0 ? toDisplayString(args[0]) : "";
      const flags = args.length > 1 ? toDisplayString(args[1]) : "";
      return mkRegex(new RegExp(pattern, flags));
    },
    construct(args) {
      const pattern = args.length > 0 ? toDisplayString(args[0]) : "";
      const flags = args.length > 1 ? toDisplayString(args[1]) : "";
      return mkRegex(new RegExp(pattern, flags));
    },
  },

  Symbol: {
    name: "Symbol",
    call(args) {
      const desc =
        args.length > 0 && !isUndefined(args[0])
          ? toDisplayString(args[0])
          : undefined;
      return mkSymbol(new JSSymbol(desc));
    },
    for: {
      name: "Symbol.for",
      call(args) {
        const key = args.length > 0 ? toDisplayString(args[0]) : "undefined";
        return symbolFor(key);
      },
    },
    keyFor: {
      name: "Symbol.keyFor",
      call(args) {
        if (args.length === 0 || !isSymbol(args[0])) return mkUndefined();
        const key = symbolKeyFor(args[0]);
        return key !== undefined ? mkString(key) : mkUndefined();
      },
    },
  },

  Proxy: {
    name: "Proxy",
    construct(args) {
      const target = args[0];
      const handler = args[1];
      if (!proxyTargetIsValid(target) || !proxyTargetIsValid(handler)) {
        throw new VMTypeError("Proxy target and handler must be objects");
      }
      return createProxyValue(target, handler);
    },
  },

  Map: {
    name: "Map",
    construct(args, interpreter) {
      const obj = createJSMap();
      if (this.prototypeObj) obj.setPrototype(this.prototypeObj);
      if (args.length > 0 && !isNull(args[0]) && !isUndefined(args[0])) {
        const iterable = args[0];
        if (isArray(iterable)) {
          const arr = getPayload(iterable);
          for (let i = 0; i < arr.getLength(); i++) {
            const entry = arr.getIndex(i);
            if (isArray(entry)) {
              const pair = getPayload(entry);
              obj._mapData.set(
                pair.getIndex(0) || mkUndefined(),
                pair.getIndex(1) || mkUndefined(),
              );
            }
          }
        }
      }
      return mkObject(obj);
    },
  },

  Set: {
    name: "Set",
    construct(args, interpreter) {
      const obj = createJSSet();
      if (this.prototypeObj) obj.setPrototype(this.prototypeObj);
      if (args.length > 0 && !isNull(args[0]) && !isUndefined(args[0])) {
        const iterable = args[0];
        if (isArray(iterable)) {
          const arr = getPayload(iterable);
          for (let i = 0; i < arr.getLength(); i++) {
            obj._setData.add(arr.getIndex(i) || mkUndefined());
          }
        }
      }
      return mkObject(obj);
    },
  },

  WeakMap: {
    name: "WeakMap",
    construct(args, interpreter) {
      const obj = createJSWeakMap();
      if (this.prototypeObj) obj.setPrototype(this.prototypeObj);
      if (args.length > 0 && !isNull(args[0]) && !isUndefined(args[0])) {
        const iterable = args[0];
        if (isArray(iterable)) {
          const arr = getPayload(iterable);
          for (let i = 0; i < arr.getLength(); i++) {
            const entry = arr.getIndex(i);
            if (isArray(entry)) {
              const pair = getPayload(entry);
              const key = pair.getIndex(0) || mkUndefined();
              if (!isObject(key)) throw new VMTypeError("Invalid value used as weak map key");
              obj._weakMapData.set(key, pair.getIndex(1) || mkUndefined());
            }
          }
        }
      }
      return mkObject(obj);
    },
  },

  Math: {
    abs: {
      name: "Math.abs",
      call: (args) => mkNumber(Math.abs(extractArgNumber(args, 0, NaN))),
    },
    floor: {
      name: "Math.floor",
      call: (args) => mkNumber(Math.floor(extractArgNumber(args, 0, NaN))),
    },
    ceil: {
      name: "Math.ceil",
      call: (args) => mkNumber(Math.ceil(extractArgNumber(args, 0, NaN))),
    },
    round: {
      name: "Math.round",
      call: (args) => mkNumber(Math.round(extractArgNumber(args, 0, NaN))),
    },
    trunc: {
      name: "Math.trunc",
      call: (args) => mkNumber(Math.trunc(extractArgNumber(args, 0, NaN))),
    },
    sign: {
      name: "Math.sign",
      call: (args) => mkNumber(Math.sign(extractArgNumber(args, 0, NaN))),
    },
    sqrt: {
      name: "Math.sqrt",
      call: (args) => mkNumber(Math.sqrt(extractArgNumber(args, 0, NaN))),
    },
    log: {
      name: "Math.log",
      call: (args) => mkNumber(Math.log(extractArgNumber(args, 0, NaN))),
    },
    pow: {
      name: "Math.pow",
      call: (args) =>
        mkNumber(
          Math.pow(
            extractArgNumber(args, 0, NaN),
            extractArgNumber(args, 1, NaN),
          ),
        ),
    },
    min: {
      name: "Math.min",
      call: (args) => {
        if (args.length === 0) return mkDouble(Infinity);
        let min = extractArgNumber(args, 0, NaN);
        for (let i = 1; i < args.length; i++) {
          const val = extractArgNumber(args, i, NaN);
          if (val < min || Number.isNaN(val)) min = val;
        }
        return mkNumber(min);
      },
    },
    max: {
      name: "Math.max",
      call: (args) => {
        if (args.length === 0) return mkDouble(-Infinity);
        let max = extractArgNumber(args, 0, NaN);
        for (let i = 1; i < args.length; i++) {
          const val = extractArgNumber(args, i, NaN);
          if (val > max || Number.isNaN(val)) max = val;
        }
        return mkNumber(max);
      },
    },
    random: { name: "Math.random", call: () => mkDouble(Math.random()) },
    PI: Math.PI,
    E: Math.E,
  },

  Array: {
    push: {
      name: "Array.push",
      call(args) {
        if (args.length < 2) return mkSmi(0);
        const arr = args[0];
        if (!isArray(arr)) return mkUndefined();
        const jsArray = getPayload(arr);
        for (let i = 1; i < args.length; i++) {
          jsArray.push(args[i]);
        }
        return mkSmi(jsArray.getLength());
      },
    },
    pop: {
      name: "Array.pop",
      call(args) {
        if (args.length < 1) return mkUndefined();
        const arr = args[0];
        if (!isArray(arr)) return mkUndefined();
        const jsArray = getPayload(arr);
        const val = jsArray.pop();
        return val !== undefined ? val : mkUndefined();
      },
    },
    from: {
      name: "Array.from",
      call(args) {
        if (args.length === 0) return mkArray(createJSArray([]));
        const src = args[0];
        if (isArray(src)) {
          const elements = getPayload(src).elements.slice();
          return mkArray(createJSArray(elements));
        }
        if (isString(src)) {
          const str = getPayload(src);
          const chars = [];
          for (const ch of str) chars.push(mkString(ch));
          return mkArray(createJSArray(chars));
        }
        return mkArray(createJSArray([]));
      },
    },
    isArray: {
      name: "Array.isArray",
      call(args) {
        return mkBool(args.length > 0 && isArray(args[0]));
      },
    },
  },

  Object: {
    keys: {
      name: "Object.keys",
      call(args, _this, interpreter) {
        if (args.length === 0) return mkArray(createJSArray([]));
        const obj = args[0];
        if (!isObject(obj)) return mkArray(createJSArray([]));
        return keysArray(runtimeOwnKeys(obj, interpreter));
      },
    },
    values: {
      name: "Object.values",
      call(args, _this, interpreter) {
        if (args.length === 0) return mkArray(createJSArray([]));
        const obj = args[0];
        if (!isObject(obj)) return mkArray(createJSArray([]));
        const keys = runtimeOwnKeys(obj, interpreter);
        const values = keys.map((k) => runtimeGetProperty(obj, k, interpreter));
        return mkArray(createJSArray(values));
      },
    },
    entries: {
      name: "Object.entries",
      call(args, _this, interpreter) {
        if (args.length === 0) return mkArray(createJSArray([]));
        const obj = args[0];
        if (!isObject(obj)) return mkArray(createJSArray([]));
        const entries = runtimeOwnKeys(obj, interpreter).map((k) =>
          mkArray(
            createJSArray([
              mkString(k),
              runtimeGetProperty(obj, k, interpreter),
            ]),
          ),
        );
        return mkArray(createJSArray(entries));
      },
    },
    assign: {
      name: "Object.assign",
      call(args, _this, interpreter) {
        if (args.length === 0) return mkObject(createJSObject());
        const target = args[0];
        if (!isObject(target)) return target;
        for (let i = 1; i < args.length; i++) {
          const src = args[i];
          if (!isObject(src) || isNull(src) || isUndefined(src)) continue;
          for (const k of runtimeOwnKeys(src, interpreter)) {
            runtimeSetProperty(
              target,
              k,
              runtimeGetProperty(src, k, interpreter),
              interpreter,
            );
          }
        }
        return target;
      },
    },
    freeze: {
      name: "Object.freeze",
      call(args) {
        if (args.length === 0 || !isObject(args[0]))
          return args[0] || mkUndefined();
        const obj = getPayload(args[0]);
        if (obj._frozen) return args[0];
        obj._frozen = true;
        return args[0];
      },
    },
    isFrozen: {
      name: "Object.isFrozen",
      call(args) {
        if (args.length === 0 || !isObject(args[0])) return mkBool(true);
        return mkBool(!!getPayload(args[0])._frozen);
      },
    },
    create: {
      name: "Object.create",
      call(args) {
        const obj = createJSObject();
        if (args.length > 0 && isObject(args[0])) {
          obj._proto = args[0];
        }
        return mkObject(obj);
      },
    },
    hasOwn: {
      name: "Object.hasOwn",
      call(args, _this, interpreter) {
        if (args.length < 2 || !isObject(args[0])) return mkBool(false);
        const key = toDisplayString(args[1]);
        return mkBool(
          !isUndefined(
            runtimeGetOwnPropertyDescriptor(args[0], key, interpreter),
          ),
        );
      },
    },
    defineProperty: {
      name: "Object.defineProperty",
      call(args, _this, interpreter) {
        if (args.length < 3 || !isObject(args[0]) || !isObject(args[2]))
          return args[0] || mkUndefined();
        const key = toDisplayString(args[1]);
        runtimeDefineProperty(args[0], key, args[2], interpreter);
        return args[0];
      },
    },
    getOwnPropertyDescriptor: {
      name: "Object.getOwnPropertyDescriptor",
      call(args, _this, interpreter) {
        if (args.length < 2 || !isObject(args[0])) return mkUndefined();
        const key = toDisplayString(args[1]);
        return runtimeGetOwnPropertyDescriptor(args[0], key, interpreter);
      },
    },
  },

  JSON: {
    parse: {
      name: "JSON.parse",
      call(args, _this, interpreter) {
        const str = extractArgString(args, 0, "");
        let parsed;
        try {
          parsed = jsValueFromNative(JSON.parse(str));
        } catch (e) {
          throw new Error(`SyntaxError: ${e.message}`);
        }
        // Reviver support
        if (args.length > 1 && interpreter) {
          const reviver = args[1];
          if (typeof reviver === "number") {
            // tagged function
            parsed = walkReviver(parsed, "", reviver, interpreter);
          }
        }
        return parsed;
      },
    },
    stringify: {
      name: "JSON.stringify",
      call(args, _this, interpreter) {
        if (args.length === 0) return mkUndefined();
        const val = args[0];
        const replacer = args.length > 1 ? args[1] : undefined;
        const indent = args.length > 2 ? extractArgNumber(args, 2, 0) : 0;

        let nativeReplacer = null;
        if (
          replacer !== undefined &&
          !isNull(replacer) &&
          !isUndefined(replacer)
        ) {
          if (isArray(replacer)) {
            // Array replacer: only include specified keys
            const allowedKeys = new Set();
            const arr = getPayload(replacer);
            for (let i = 0; i < arr.getLength(); i++) {
              allowedKeys.add(toDisplayString(arr.elements[i]));
            }
            nativeReplacer = (key, value) => {
              if (key === "") return value; // root
              return allowedKeys.has(key) ? value : undefined;
            };
          } else if (interpreter) {
            // Function replacer
            nativeReplacer = (key, value) => {
              const result = interpreter.callFunctionValue(
                replacer,
                [mkString(key), jsValueFromNative(value)],
                mkUndefined(),
              );
              return taggedToNative(result);
            };
          }
        }

        return mkString(
          JSON.stringify(
            taggedToNative(val),
            nativeReplacer,
            indent || undefined,
          ),
        );
      },
    },
  },

  String: {
    name: "String",
    call(args) {
      if (args.length === 0) return mkString("");
      return mkString(toDisplayString(args[0]));
    },
  },

  clock: {
    name: "clock",
    call() {
      return mkDouble(performance.now());
    },
  },

  gc: {
    name: "gc",
    call() {
      tracer.log(
        "gc",
        "Triggering garbage collection / hidden class stats dump",
      );
      return mkUndefined();
    },
  },
};

function taggedToNative(val) {
  if (isNull(val) || isUndefined(val)) return null;
  if (isSmi(val) || isDouble(val) || isNumber(val)) return toNumber(val);
  if (isString(val)) return getPayload(val);
  if (isBool(val)) return getPayload(val);
  if (isArray(val)) {
    const arr = getPayload(val);
    return arr.elements.map((e) => taggedToNative(e));
  }
  if (isObject(val)) {
    const obj = getPayload(val);
    const result = {};
    for (const [k, v] of obj.entries()) {
      result[k] = taggedToNative(v);
    }
    return result;
  }
  return null;
}

function walkReviver(val, key, reviver, interpreter) {
  if (isObject(val)) {
    const obj = getPayload(val);
    for (const [k, v] of obj.entries()) {
      const newVal = walkReviver(v, k, reviver, interpreter);
      if (isUndefined(newVal)) {
        obj.deleteProperty(k);
      } else {
        obj.setProperty(k, newVal);
      }
    }
  } else if (isArray(val)) {
    const arr = getPayload(val);
    for (let i = 0; i < arr.getLength(); i++) {
      const newVal = walkReviver(
        arr.elements[i],
        String(i),
        reviver,
        interpreter,
      );
      if (isUndefined(newVal)) {
        arr.elements[i] = mkUndefined();
      } else {
        arr.elements[i] = newVal;
      }
    }
  }
  return interpreter.callFunctionValue(
    reviver,
    [mkString(key), val],
    mkUndefined(),
  );
}

function jsValueFromNative(val) {
  if (val === null) return mkNull();
  if (val === undefined) return mkUndefined();
  if (typeof val === "number") return mkNumber(val);
  if (typeof val === "string") return mkString(val);
  if (typeof val === "boolean") return mkBool(val);
  if (Array.isArray(val)) {
    return mkArray(createJSArray(val.map((e) => jsValueFromNative(e))));
  }
  if (typeof val === "object") {
    const obj = createJSObject();
    for (const [k, v] of Object.entries(val)) {
      obj.setProperty(k, jsValueFromNative(v));
    }
    return mkObject(obj);
  }
  return mkUndefined();
}
