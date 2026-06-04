import {
  mkUndefined,
  mkBool,
  mkSmi,
  mkArray,
  mkIterator,
  mkObject,
  getPayload,
  isFunction,
} from "../../core/value/index.js";
import { createJSArray, createJSObject } from "../../objects/heap/factory.js";
import { IteratorRecord, createIteratorResult } from "../iteration/iterator.js";
import { INSTANCE_TYPE_MAP } from "../../objects/maps/hidden-class.js";

function getMapData(thisValue) {
  const obj = getPayload(thisValue);
  if (!obj || !obj._mapData || obj.hiddenClass.instanceType !== INSTANCE_TYPE_MAP)
    throw new Error("TypeError: Method Map.prototype called on incompatible receiver");
  return obj._mapData;
}

export const MAP_METHODS = {
  get: {
    name: "Map.prototype.get",
    call(args, thisValue) {
      const map = getMapData(thisValue);
      const key = args[0] !== undefined ? args[0] : mkUndefined();
      const val = map.get(key);
      return val !== undefined ? val : mkUndefined();
    },
  },

  set: {
    name: "Map.prototype.set",
    call(args, thisValue) {
      const map = getMapData(thisValue);
      const key = args[0] !== undefined ? args[0] : mkUndefined();
      const value = args.length > 1 ? args[1] : mkUndefined();
      map.set(key, value);
      return thisValue;
    },
  },

  has: {
    name: "Map.prototype.has",
    call(args, thisValue) {
      const map = getMapData(thisValue);
      const key = args[0] !== undefined ? args[0] : mkUndefined();
      return mkBool(map.has(key));
    },
  },

  delete: {
    name: "Map.prototype.delete",
    call(args, thisValue) {
      const map = getMapData(thisValue);
      const key = args[0] !== undefined ? args[0] : mkUndefined();
      return mkBool(map.delete(key));
    },
  },

  clear: {
    name: "Map.prototype.clear",
    call(args, thisValue) {
      getMapData(thisValue).clear();
      return mkUndefined();
    },
  },

  forEach: {
    name: "Map.prototype.forEach",
    call(args, thisValue, interpreter) {
      const map = getMapData(thisValue);
      const callback = args[0];
      if (!isFunction(callback)) throw new Error("TypeError: callback is not a function");
      for (const [key, value] of map.iterateEntries()) {
        interpreter.callFunctionValue(callback, [value, key, thisValue], mkUndefined());
      }
      return mkUndefined();
    },
  },

  entries: {
    name: "Map.prototype.entries",
    call(args, thisValue) {
      const map = getMapData(thisValue);
      const iter = map.iterateEntries();
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
    name: "Map.prototype.keys",
    call(args, thisValue) {
      const map = getMapData(thisValue);
      const iter = map.iterateKeys();
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
    name: "Map.prototype.values",
    call(args, thisValue) {
      const map = getMapData(thisValue);
      const iter = map.iterateValues();
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
