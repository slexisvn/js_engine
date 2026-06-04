import {
  mkBool,
  mkString,
  mkSmi,
  mkNull,
  mkArray,
  mkUndefined,
  getPayload,
  isString,
  toDisplayString,
} from "../../core/value/index.js";
import { createJSArray } from "../../objects/heap/factory.js";

export const REGEX_METHODS = {
  test: {
    name: "RegExp.prototype.test",
    call(args, thisValue) {
      const rv = getPayload(thisValue);
      const str = args.length > 0 ? toDisplayString(args[0]) : "";
      rv.nativeRegex.lastIndex = rv.lastIndex;
      const result = rv.nativeRegex.test(str);
      rv.lastIndex = rv.nativeRegex.lastIndex;
      return mkBool(result);
    },
  },

  exec: {
    name: "RegExp.prototype.exec",
    call(args, thisValue) {
      const rv = getPayload(thisValue);
      const str = args.length > 0 ? toDisplayString(args[0]) : "";
      rv.nativeRegex.lastIndex = rv.lastIndex;
      const result = rv.nativeRegex.exec(str);
      rv.lastIndex = rv.nativeRegex.lastIndex;
      if (result === null) return mkNull();
      const elements = [];
      for (let i = 0; i < result.length; i++) {
        elements.push(
          result[i] !== undefined ? mkString(result[i]) : mkUndefined(),
        );
      }
      return mkArray(createJSArray(elements));
    },
  },

  toString: {
    name: "RegExp.prototype.toString",
    call(args, thisValue) {
      const rv = getPayload(thisValue);
      return mkString("/" + rv.nativeRegex.source + "/" + rv.nativeRegex.flags);
    },
  },
};

const REGEX_FLAG_PROPS = new Set([
  "global",
  "ignoreCase",
  "multiline",
  "dotAll",
  "sticky",
  "unicode",
]);

export function getRegexProperty(name, rv) {
  switch (name) {
    case "source":
      return mkString(rv.nativeRegex.source);
    case "flags":
      return mkString(rv.nativeRegex.flags);
    case "lastIndex":
      return mkSmi(rv.lastIndex);
  }
  if (REGEX_FLAG_PROPS.has(name)) {
    return mkBool(rv.nativeRegex[name]);
  }
  return null;
}
