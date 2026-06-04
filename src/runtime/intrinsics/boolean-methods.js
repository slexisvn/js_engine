import { mkString, isBool, isObject, getPayload, toBool } from "../../core/value/index.js";

function unwrapBoolean(thisValue) {
  if (isBool(thisValue)) return getPayload(thisValue);
  if (isObject(thisValue)) {
    const obj = getPayload(thisValue);
    if (obj._primitiveValue !== undefined && isBool(obj._primitiveValue))
      return getPayload(obj._primitiveValue);
  }
  return toBool(thisValue);
}

function unwrapBooleanTagged(thisValue) {
  if (isBool(thisValue)) return thisValue;
  if (isObject(thisValue)) {
    const obj = getPayload(thisValue);
    if (obj._primitiveValue !== undefined && isBool(obj._primitiveValue))
      return obj._primitiveValue;
  }
  return thisValue;
}

export const BOOLEAN_METHODS = {
  toString: {
    name: "Boolean.prototype.toString",
    call(args, thisValue) {
      return mkString(unwrapBoolean(thisValue) ? "true" : "false");
    },
  },

  valueOf: {
    name: "Boolean.prototype.valueOf",
    call(args, thisValue) {
      return unwrapBooleanTagged(thisValue);
    },
  },
};
