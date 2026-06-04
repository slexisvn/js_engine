import {
  mkSmi,
  mkBool,
  mkString,
  mkUndefined,
  mkArray,
  isFunction,
  isSmi,
  isUndefined,
  isArray,
  toBool,
  toDisplayString,
  toNumber,
  getPayload,
  strictEqual,
} from "../../core/value/index.js";
import { createJSArray } from "../../objects/heap/factory.js";

export const ARRAY_METHODS = {
  push: {
    name: "Array.prototype.push",
    call(args, thisValue, interpreter) {
      const arr = getPayload(thisValue);
      for (let i = 0; i < args.length; i++) {
        arr.push(args[i]);
      }
      return mkSmi(arr.getLength());
    },
  },

  pop: {
    name: "Array.prototype.pop",
    call(args, thisValue) {
      const arr = getPayload(thisValue);
      const val = arr.pop();
      return val !== undefined ? val : mkUndefined();
    },
  },

  shift: {
    name: "Array.prototype.shift",
    call(args, thisValue) {
      const arr = getPayload(thisValue);
      const val = arr.shift();
      return val !== undefined ? val : mkUndefined();
    },
  },

  unshift: {
    name: "Array.prototype.unshift",
    call(args, thisValue) {
      const arr = getPayload(thisValue);
      for (let i = args.length - 1; i >= 0; i--) {
        arr.unshift(args[i]);
      }
      return mkSmi(arr.getLength());
    },
  },

  splice: {
    name: "Array.prototype.splice",
    call(args, thisValue) {
      const arr = getPayload(thisValue);
      const start = isSmi(args[0]) ? getPayload(args[0]) : 0;
      const deleteCount =
        args.length > 1 && isSmi(args[1]) ? getPayload(args[1]) : undefined;
      const items = args.slice(2);
      const removed = arr.splice(start, deleteCount, ...items);
      return mkArray(createJSArray(removed));
    },
  },

  indexOf: {
    name: "Array.prototype.indexOf",
    call(args, thisValue) {
      const arr = getPayload(thisValue);
      const target = args[0] || mkUndefined();
      const fromIndex =
        args.length > 1 && isSmi(args[1]) ? getPayload(args[1]) : undefined;
      return mkSmi(arr.indexOf(target, fromIndex));
    },
  },

  lastIndexOf: {
    name: "Array.prototype.lastIndexOf",
    call(args, thisValue) {
      const arr = getPayload(thisValue);
      const target = args[0] || mkUndefined();
      for (let i = arr.getLength() - 1; i >= 0; i--) {
        const el = arr.getIndex(i);
        if (strictEqual(el, target)) return mkSmi(i);
      }
      return mkSmi(-1);
    },
  },

  includes: {
    name: "Array.prototype.includes",
    call(args, thisValue) {
      const arr = getPayload(thisValue);
      const target = args[0] || mkUndefined();
      const fromIndex =
        args.length > 1 && isSmi(args[1]) ? getPayload(args[1]) : undefined;
      return mkBool(arr.includes(target, fromIndex));
    },
  },

  find: {
    name: "Array.prototype.find",
    call(args, thisValue, interpreter) {
      const arr = getPayload(thisValue);
      const callback = args[0];
      if (!isFunction(callback))
        throw new Error("TypeError: callback is not a function");
      for (let i = 0; i < arr.getLength(); i++) {
        const elem = arr.getIndex(i) || mkUndefined();
        const result = interpreter.callFunctionValue(
          callback,
          [elem, mkSmi(i)],
          mkUndefined(),
        );
        if (toBool(result)) return elem;
      }
      return mkUndefined();
    },
  },

  findIndex: {
    name: "Array.prototype.findIndex",
    call(args, thisValue, interpreter) {
      const arr = getPayload(thisValue);
      const callback = args[0];
      if (!isFunction(callback))
        throw new Error("TypeError: callback is not a function");
      for (let i = 0; i < arr.getLength(); i++) {
        const elem = arr.getIndex(i) || mkUndefined();
        const result = interpreter.callFunctionValue(
          callback,
          [elem, mkSmi(i)],
          mkUndefined(),
        );
        if (toBool(result)) return mkSmi(i);
      }
      return mkSmi(-1);
    },
  },

  forEach: {
    name: "Array.prototype.forEach",
    call(args, thisValue, interpreter) {
      const arr = getPayload(thisValue);
      const callback = args[0];
      if (!isFunction(callback))
        throw new Error("TypeError: callback is not a function");
      for (let i = 0; i < arr.getLength(); i++) {
        const elem = arr.getIndex(i) || mkUndefined();
        interpreter.callFunctionValue(
          callback,
          [elem, mkSmi(i)],
          mkUndefined(),
        );
      }
      return mkUndefined();
    },
  },

  map: {
    name: "Array.prototype.map",
    call(args, thisValue, interpreter) {
      const arr = getPayload(thisValue);
      const callback = args[0];
      if (!isFunction(callback))
        throw new Error("TypeError: callback is not a function");
      const result = [];
      for (let i = 0; i < arr.getLength(); i++) {
        const elem = arr.getIndex(i) || mkUndefined();
        result.push(
          interpreter.callFunctionValue(
            callback,
            [elem, mkSmi(i)],
            mkUndefined(),
          ),
        );
      }
      return mkArray(createJSArray(result));
    },
  },

  filter: {
    name: "Array.prototype.filter",
    call(args, thisValue, interpreter) {
      const arr = getPayload(thisValue);
      const callback = args[0];
      if (!isFunction(callback))
        throw new Error("TypeError: callback is not a function");
      const result = [];
      for (let i = 0; i < arr.getLength(); i++) {
        const elem = arr.getIndex(i) || mkUndefined();
        const keep = interpreter.callFunctionValue(
          callback,
          [elem, mkSmi(i)],
          mkUndefined(),
        );
        if (toBool(keep)) result.push(elem);
      }
      return mkArray(createJSArray(result));
    },
  },

  reduce: {
    name: "Array.prototype.reduce",
    call(args, thisValue, interpreter) {
      const arr = getPayload(thisValue);
      const callback = args[0];
      if (!isFunction(callback))
        throw new Error("TypeError: callback is not a function");
      let accumulator;
      let startIndex;
      if (args.length > 1) {
        accumulator = args[1];
        startIndex = 0;
      } else {
        if (arr.getLength() === 0)
          throw new Error(
            "TypeError: Reduce of empty array with no initial value",
          );
        accumulator = arr.getIndex(0) || mkUndefined();
        startIndex = 1;
      }
      for (let i = startIndex; i < arr.getLength(); i++) {
        const elem = arr.getIndex(i) || mkUndefined();
        accumulator = interpreter.callFunctionValue(
          callback,
          [accumulator, elem, mkSmi(i)],
          mkUndefined(),
        );
      }
      return accumulator;
    },
  },

  concat: {
    name: "Array.prototype.concat",
    call(args, thisValue) {
      const arr = getPayload(thisValue);
      const elements = [...arr.elements];
      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (isArray(arg)) {
          const otherArr = getPayload(arg);
          for (let j = 0; j < otherArr.getLength(); j++) {
            elements.push(otherArr.getIndex(j));
          }
        } else {
          elements.push(arg);
        }
      }
      return mkArray(createJSArray(elements));
    },
  },

  slice: {
    name: "Array.prototype.slice",
    call(args, thisValue) {
      const arr = getPayload(thisValue);
      const start =
        args.length > 0 && isSmi(args[0]) ? getPayload(args[0]) : undefined;
      const end =
        args.length > 1 && isSmi(args[1]) ? getPayload(args[1]) : undefined;
      const sliced = arr.slice(start, end);
      return mkArray(sliced);
    },
  },

  join: {
    name: "Array.prototype.join",
    call(args, thisValue) {
      const arr = getPayload(thisValue);
      const sep =
        args.length > 0 && !isUndefined(args[0])
          ? toDisplayString(args[0])
          : undefined;
      return mkString(arr.join(sep));
    },
  },

  reverse: {
    name: "Array.prototype.reverse",
    call(args, thisValue) {
      getPayload(thisValue).reverse();
      return thisValue;
    },
  },

  sort: {
    name: "Array.prototype.sort",
    call(args, thisValue, interpreter) {
      const arr = getPayload(thisValue);
      if (args.length > 0 && isFunction(args[0])) {
        const compareFn = args[0];
        arr.sort((a, b) => {
          const result = interpreter.callFunctionValue(
            compareFn,
            [a, b],
            mkUndefined(),
          );
          return toNumber(result);
        });
      } else {
        arr.sort();
      }
      return thisValue;
    },
  },

  flat: {
    name: "Array.prototype.flat",
    call(args, thisValue) {
      const arr = getPayload(thisValue);
      const depth = args.length > 0 ? toNumber(args[0]) : 1;
      function flattenInto(source, d) {
        const result = [];
        for (let i = 0; i < source.getLength(); i++) {
          const el = source.elements[i];
          if (d > 0 && isArray(el)) {
            result.push(...flattenInto(getPayload(el), d - 1));
          } else {
            result.push(el !== undefined ? el : mkUndefined());
          }
        }
        return result;
      }
      return mkArray(createJSArray(flattenInto(arr, depth)));
    },
  },

  flatMap: {
    name: "Array.prototype.flatMap",
    call(args, thisValue, interpreter) {
      const arr = getPayload(thisValue);
      if (args.length === 0 || !isFunction(args[0])) return thisValue;
      const fn = args[0];
      const result = [];
      for (let i = 0; i < arr.getLength(); i++) {
        const el =
          arr.elements[i] !== undefined ? arr.elements[i] : mkUndefined();
        const mapped = interpreter.callFunctionValue(
          fn,
          [el, mkSmi(i), thisValue],
          mkUndefined(),
        );
        if (isArray(mapped)) {
          const inner = getPayload(mapped);
          for (let j = 0; j < inner.getLength(); j++) {
            result.push(
              inner.elements[j] !== undefined
                ? inner.elements[j]
                : mkUndefined(),
            );
          }
        } else {
          result.push(mapped);
        }
      }
      return mkArray(createJSArray(result));
    },
  },

  at: {
    name: "Array.prototype.at",
    call(args, thisValue) {
      const arr = getPayload(thisValue);
      if (args.length === 0) return mkUndefined();
      let idx = toNumber(args[0]) | 0;
      if (idx < 0) idx = arr.getLength() + idx;
      if (idx < 0 || idx >= arr.getLength()) return mkUndefined();
      return arr.elements[idx] !== undefined
        ? arr.elements[idx]
        : mkUndefined();
    },
  },

  fill: {
    name: "Array.prototype.fill",
    call(args, thisValue) {
      const arr = getPayload(thisValue);
      if (args.length === 0) return thisValue;
      const value = args[0];
      const len = arr.getLength();
      let start = args.length > 1 ? toNumber(args[1]) | 0 : 0;
      let end = args.length > 2 ? toNumber(args[2]) | 0 : len;
      if (start < 0) start = Math.max(0, len + start);
      if (end < 0) end = Math.max(0, len + end);
      for (let i = start; i < end && i < len; i++) {
        arr.elements[i] = value;
      }
      return thisValue;
    },
  },

  every: {
    name: "Array.prototype.every",
    call(args, thisValue, interpreter) {
      const arr = getPayload(thisValue);
      if (args.length === 0 || !isFunction(args[0])) return mkBool(true);
      const fn = args[0];
      for (let i = 0; i < arr.getLength(); i++) {
        const el =
          arr.elements[i] !== undefined ? arr.elements[i] : mkUndefined();
        const result = interpreter.callFunctionValue(
          fn,
          [el, mkSmi(i), thisValue],
          mkUndefined(),
        );
        if (!toBool(result)) return mkBool(false);
      }
      return mkBool(true);
    },
  },

  some: {
    name: "Array.prototype.some",
    call(args, thisValue, interpreter) {
      const arr = getPayload(thisValue);
      if (args.length === 0 || !isFunction(args[0])) return mkBool(false);
      const fn = args[0];
      for (let i = 0; i < arr.getLength(); i++) {
        const el =
          arr.elements[i] !== undefined ? arr.elements[i] : mkUndefined();
        const result = interpreter.callFunctionValue(
          fn,
          [el, mkSmi(i), thisValue],
          mkUndefined(),
        );
        if (toBool(result)) return mkBool(true);
      }
      return mkBool(false);
    },
  },
};
