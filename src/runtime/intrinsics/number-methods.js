import {
  mkString,
  isSmi,
  isNumber,
  isObject,
  getPayload,
  toNumber,
} from "../../core/value/index.js";

function unwrapNumber(thisValue) {
  if (isNumber(thisValue)) return toNumber(thisValue);
  if (isObject(thisValue)) {
    const obj = getPayload(thisValue);
    if (obj._primitiveValue !== undefined && isNumber(obj._primitiveValue))
      return toNumber(obj._primitiveValue);
  }
  return toNumber(thisValue);
}

function unwrapNumberTagged(thisValue) {
  if (isNumber(thisValue)) return thisValue;
  if (isObject(thisValue)) {
    const obj = getPayload(thisValue);
    if (obj._primitiveValue !== undefined && isNumber(obj._primitiveValue))
      return obj._primitiveValue;
  }
  return thisValue;
}

export const NUMBER_METHODS = {
  toString: {
    name: "Number.prototype.toString",
    call(args, thisValue) {
      const num = unwrapNumber(thisValue);
      const radix =
        args.length > 0 && isNumber(args[0]) ? toNumber(args[0]) : 10;
      return mkString(num.toString(radix));
    },
  },

  toFixed: {
    name: "Number.prototype.toFixed",
    call(args, thisValue) {
      const num = unwrapNumber(thisValue);
      const digits =
        args.length > 0 && isSmi(args[0]) ? getPayload(args[0]) : 0;
      return mkString(num.toFixed(digits));
    },
  },

  valueOf: {
    name: "Number.prototype.valueOf",
    call(args, thisValue) {
      return unwrapNumberTagged(thisValue);
    },
  },

  toPrecision: {
    name: "Number.prototype.toPrecision",
    call(args, thisValue) {
      const num = unwrapNumber(thisValue);
      const precision =
        args.length > 0 && isSmi(args[0]) ? getPayload(args[0]) : undefined;
      return mkString(num.toPrecision(precision));
    },
  },

  toExponential: {
    name: "Number.prototype.toExponential",
    call(args, thisValue) {
      const num = unwrapNumber(thisValue);
      const fractionDigits =
        args.length > 0 && isSmi(args[0]) ? getPayload(args[0]) : undefined;
      return mkString(num.toExponential(fractionDigits));
    },
  },
};
