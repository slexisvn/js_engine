import {
  mkUndefined,
  mkBool,
  mkSmi,
  mkArray,
  mkIterator,
  getPayload,
  isFunction,
} from "../../core/value/index.js";
import { createJSArray } from "../../objects/heap/factory.js";
import { IteratorRecord, createIteratorResult } from "../iteration/iterator.js";
import { INSTANCE_TYPE_SET } from "../../objects/maps/hidden-class.js";

function getSetData(thisValue) {
  const obj = getPayload(thisValue);
  if (!obj || !obj._setData || obj.hiddenClass.instanceType !== INSTANCE_TYPE_SET)
    throw new Error("TypeError: Method Set.prototype called on incompatible receiver");
  return obj._setData;
}

export const SET_METHODS = {
  add: {
    name: "Set.prototype.add",
    call(args, thisValue) {
      const set = getSetData(thisValue);
      const value = args[0] !== undefined ? args[0] : mkUndefined();
      set.add(value);
      return thisValue;
    },
  },

  has: {
    name: "Set.prototype.has",
    call(args, thisValue) {
      const set = getSetData(thisValue);
      const value = args[0] !== undefined ? args[0] : mkUndefined();
      return mkBool(set.has(value));
    },
  },

  delete: {
    name: "Set.prototype.delete",
    call(args, thisValue) {
      const set = getSetData(thisValue);
      const value = args[0] !== undefined ? args[0] : mkUndefined();
      return mkBool(set.delete(value));
    },
  },

  clear: {
    name: "Set.prototype.clear",
    call(args, thisValue) {
      getSetData(thisValue).clear();
      return mkUndefined();
    },
  },

  forEach: {
    name: "Set.prototype.forEach",
    call(args, thisValue, interpreter) {
      const set = getSetData(thisValue);
      const callback = args[0];
      if (!isFunction(callback)) throw new Error("TypeError: callback is not a function");
      for (const value of set.iterateValues()) {
        interpreter.callFunctionValue(callback, [value, value, thisValue], mkUndefined());
      }
      return mkUndefined();
    },
  },

  entries: {
    name: "Set.prototype.entries",
    call(args, thisValue) {
      const set = getSetData(thisValue);
      const iter = set.iterateEntries();
      return mkIterator(
        new IteratorRecord(() => {
          const next = iter.next();
          if (next.done) return createIteratorResult(mkUndefined(), true);
          return createIteratorResult(mkArray(createJSArray([next.value[0], next.value[1]])), false);
        }),
      );
    },
  },

  keys: {
    name: "Set.prototype.keys",
    call(args, thisValue) {
      const set = getSetData(thisValue);
      const iter = set.iterateValues();
      return mkIterator(
        new IteratorRecord(() => {
          const next = iter.next();
          if (next.done) return createIteratorResult(mkUndefined(), true);
          return createIteratorResult(next.value, false);
        }),
      );
    },
  },

  values: {
    name: "Set.prototype.values",
    call(args, thisValue) {
      const set = getSetData(thisValue);
      const iter = set.iterateValues();
      return mkIterator(
        new IteratorRecord(() => {
          const next = iter.next();
          if (next.done) return createIteratorResult(mkUndefined(), true);
          return createIteratorResult(next.value, false);
        }),
      );
    },
  },
};
