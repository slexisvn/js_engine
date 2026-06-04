import {
  mkSmi,
  mkBool,
  mkString,
  mkUndefined,
  mkArray,
  mkNull,
  isSmi,
  isString,
  isObject,
  isUndefined,
  isFunction,
  isRegex,
  getPayload,
  toNumber,
  toDisplayString,
} from "../../core/value/index.js";
import { createJSArray } from "../../objects/heap/factory.js";

function unwrapString(thisValue) {
  if (isString(thisValue)) return getPayload(thisValue);
  if (isObject(thisValue)) {
    const obj = getPayload(thisValue);
    if (obj._primitiveValue !== undefined && isString(obj._primitiveValue))
      return getPayload(obj._primitiveValue);
  }
  return toDisplayString(thisValue);
}

export const STRING_METHODS = {
  charAt: {
    name: "String.prototype.charAt",
    call(args, thisValue) {
      const str = unwrapString(thisValue);
      const idx = args.length > 0 && isSmi(args[0]) ? getPayload(args[0]) : 0;
      return mkString(str.charAt(idx));
    },
  },

  charCodeAt: {
    name: "String.prototype.charCodeAt",
    call(args, thisValue) {
      const str = unwrapString(thisValue);
      const idx = args.length > 0 && isSmi(args[0]) ? getPayload(args[0]) : 0;
      const code = str.charCodeAt(idx);
      return Number.isNaN(code) ? mkSmi(0) : mkSmi(code);
    },
  },

  substring: {
    name: "String.prototype.substring",
    call(args, thisValue) {
      const str = unwrapString(thisValue);
      const start = args.length > 0 && isSmi(args[0]) ? getPayload(args[0]) : 0;
      const end =
        args.length > 1 && isSmi(args[1]) ? getPayload(args[1]) : undefined;
      return mkString(str.substring(start, end));
    },
  },

  slice: {
    name: "String.prototype.slice",
    call(args, thisValue) {
      const str = unwrapString(thisValue);
      const start = args.length > 0 && isSmi(args[0]) ? getPayload(args[0]) : 0;
      const end =
        args.length > 1 && isSmi(args[1]) ? getPayload(args[1]) : undefined;
      return mkString(str.slice(start, end));
    },
  },

  indexOf: {
    name: "String.prototype.indexOf",
    call(args, thisValue) {
      const str = unwrapString(thisValue);
      const search =
        args.length > 0 && isString(args[0]) ? getPayload(args[0]) : "";
      const fromIndex =
        args.length > 1 && isSmi(args[1]) ? getPayload(args[1]) : undefined;
      return mkSmi(str.indexOf(search, fromIndex));
    },
  },

  lastIndexOf: {
    name: "String.prototype.lastIndexOf",
    call(args, thisValue) {
      const str = unwrapString(thisValue);
      const search =
        args.length > 0 && isString(args[0]) ? getPayload(args[0]) : "";
      const fromIndex =
        args.length > 1 && isSmi(args[1]) ? getPayload(args[1]) : undefined;
      return mkSmi(str.lastIndexOf(search, fromIndex));
    },
  },

  includes: {
    name: "String.prototype.includes",
    call(args, thisValue) {
      const str = unwrapString(thisValue);
      const search =
        args.length > 0 && isString(args[0]) ? getPayload(args[0]) : "";
      return mkBool(str.includes(search));
    },
  },

  startsWith: {
    name: "String.prototype.startsWith",
    call(args, thisValue) {
      const str = unwrapString(thisValue);
      const search =
        args.length > 0 && isString(args[0]) ? getPayload(args[0]) : "";
      return mkBool(str.startsWith(search));
    },
  },

  endsWith: {
    name: "String.prototype.endsWith",
    call(args, thisValue) {
      const str = unwrapString(thisValue);
      const search =
        args.length > 0 && isString(args[0]) ? getPayload(args[0]) : "";
      return mkBool(str.endsWith(search));
    },
  },

  split: {
    name: "String.prototype.split",
    call(args, thisValue) {
      const str = unwrapString(thisValue);
      let sep;
      if (args.length > 0 && isRegex(args[0])) {
        sep = getPayload(args[0]).nativeRegex;
      } else {
        sep =
          args.length > 0 && isString(args[0])
            ? getPayload(args[0])
            : undefined;
      }
      const parts = str.split(sep);
      return mkArray(createJSArray(parts.map((p) => mkString(p))));
    },
  },

  replace: {
    name: "String.prototype.replace",
    call(args, thisValue, interpreter) {
      const str = unwrapString(thisValue);
      let search;
      if (args.length > 0 && isRegex(args[0])) {
        search = getPayload(args[0]).nativeRegex;
      } else {
        search =
          args.length > 0 && isString(args[0]) ? getPayload(args[0]) : "";
      }
      if (args.length > 1 && isFunction(args[1])) {
        const result = str.replace(search, (match, ...rest) => {
          const callResult = interpreter.callFunctionValue(
            args[1],
            [mkString(match)],
            mkUndefined(),
          );
          return toDisplayString(callResult);
        });
        return mkString(result);
      }
      const replacement =
        args.length > 1 && isString(args[1]) ? getPayload(args[1]) : "";
      return mkString(str.replace(search, replacement));
    },
  },

  match: {
    name: "String.prototype.match",
    call(args, thisValue) {
      const str = unwrapString(thisValue);
      if (args.length === 0) return mkNull();
      let regex;
      if (isRegex(args[0])) {
        regex = getPayload(args[0]).nativeRegex;
      } else {
        regex = new RegExp(
          isString(args[0]) ? getPayload(args[0]) : toDisplayString(args[0]),
        );
      }
      const result = str.match(regex);
      if (result === null) return mkNull();
      return mkArray(
        createJSArray(
          result.map((m) => (m !== undefined ? mkString(m) : mkUndefined())),
        ),
      );
    },
  },

  search: {
    name: "String.prototype.search",
    call(args, thisValue) {
      const str = unwrapString(thisValue);
      if (args.length === 0) return mkSmi(-1);
      let regex;
      if (isRegex(args[0])) {
        regex = getPayload(args[0]).nativeRegex;
      } else {
        regex = new RegExp(
          isString(args[0]) ? getPayload(args[0]) : toDisplayString(args[0]),
        );
      }
      return mkSmi(str.search(regex));
    },
  },

  trim: {
    name: "String.prototype.trim",
    call(args, thisValue) {
      return mkString(unwrapString(thisValue).trim());
    },
  },

  trimStart: {
    name: "String.prototype.trimStart",
    call(args, thisValue) {
      return mkString(unwrapString(thisValue).trimStart());
    },
  },

  trimEnd: {
    name: "String.prototype.trimEnd",
    call(args, thisValue) {
      return mkString(unwrapString(thisValue).trimEnd());
    },
  },

  toLowerCase: {
    name: "String.prototype.toLowerCase",
    call(args, thisValue) {
      return mkString(unwrapString(thisValue).toLowerCase());
    },
  },

  toUpperCase: {
    name: "String.prototype.toUpperCase",
    call(args, thisValue) {
      return mkString(unwrapString(thisValue).toUpperCase());
    },
  },

  repeat: {
    name: "String.prototype.repeat",
    call(args, thisValue) {
      const str = unwrapString(thisValue);
      const count = args.length > 0 && isSmi(args[0]) ? getPayload(args[0]) : 0;
      return mkString(str.repeat(count));
    },
  },

  padStart: {
    name: "String.prototype.padStart",
    call(args, thisValue) {
      const str = unwrapString(thisValue);
      const targetLen =
        args.length > 0 && isSmi(args[0]) ? getPayload(args[0]) : 0;
      const padStr =
        args.length > 1 && isString(args[1]) ? getPayload(args[1]) : undefined;
      return mkString(str.padStart(targetLen, padStr));
    },
  },

  padEnd: {
    name: "String.prototype.padEnd",
    call(args, thisValue) {
      const str = unwrapString(thisValue);
      const targetLen =
        args.length > 0 && isSmi(args[0]) ? getPayload(args[0]) : 0;
      const padStr =
        args.length > 1 && isString(args[1]) ? getPayload(args[1]) : undefined;
      return mkString(str.padEnd(targetLen, padStr));
    },
  },

  concat: {
    name: "String.prototype.concat",
    call(args, thisValue) {
      let result = unwrapString(thisValue);
      for (let i = 0; i < args.length; i++) {
        result += isString(args[i])
          ? getPayload(args[i])
          : toDisplayString(args[i]);
      }
      return mkString(result);
    },
  },

  replaceAll: {
    name: "String.prototype.replaceAll",
    call(args, thisValue, interpreter) {
      const str = unwrapString(thisValue);
      if (args.length === 0) return thisValue;
      const search = args[0];
      const replacement = args.length > 1 ? args[1] : mkUndefined();
      if (isRegex(search)) {
        const regex = getPayload(search).nativeRegex;
        // Must be global
        const globalRegex = regex.global
          ? regex
          : new RegExp(regex.source, regex.flags + "g");
        if (isFunction(replacement) && interpreter) {
          return mkString(
            str.replace(globalRegex, (...m) => {
              const callArgs = m
                .slice(0, -2)
                .map((v) => (v === undefined ? mkUndefined() : mkString(v)));
              return toDisplayString(
                interpreter.callFunctionValue(
                  replacement,
                  callArgs,
                  mkUndefined(),
                ),
              );
            }),
          );
        }
        const repStr = isUndefined(replacement)
          ? "undefined"
          : toDisplayString(replacement);
        return mkString(str.replace(globalRegex, repStr));
      }
      const searchStr = toDisplayString(search);
      const repStr = isUndefined(replacement)
        ? "undefined"
        : toDisplayString(replacement);
      return mkString(str.split(searchStr).join(repStr));
    },
  },

  at: {
    name: "String.prototype.at",
    call(args, thisValue) {
      const str = unwrapString(thisValue);
      if (args.length === 0) return mkUndefined();
      let idx = toNumber(args[0]) | 0;
      if (idx < 0) idx = str.length + idx;
      if (idx < 0 || idx >= str.length) return mkUndefined();
      return mkString(str[idx]);
    },
  },
};
