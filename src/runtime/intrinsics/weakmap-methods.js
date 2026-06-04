import {
  mkUndefined,
  mkBool,
  getPayload,
  isObject,
} from "../../core/value/index.js";
import { INSTANCE_TYPE_WEAKMAP } from "../../objects/maps/hidden-class.js";

function getWeakMapData(thisValue) {
  const obj = getPayload(thisValue);
  if (!obj || !obj._weakMapData || obj.hiddenClass.instanceType !== INSTANCE_TYPE_WEAKMAP)
    throw new Error("TypeError: Method WeakMap.prototype called on incompatible receiver");
  return obj._weakMapData;
}

export const WEAKMAP_METHODS = {
  get: {
    name: "WeakMap.prototype.get",
    call(args, thisValue) {
      const wm = getWeakMapData(thisValue);
      const key = args[0] !== undefined ? args[0] : mkUndefined();
      const val = wm.get(key);
      return val !== undefined ? val : mkUndefined();
    },
  },

  set: {
    name: "WeakMap.prototype.set",
    call(args, thisValue) {
      const wm = getWeakMapData(thisValue);
      const key = args[0] !== undefined ? args[0] : mkUndefined();
      if (!isObject(key)) throw new Error("TypeError: Invalid value used as weak map key");
      const value = args.length > 1 ? args[1] : mkUndefined();
      wm.set(key, value);
      return thisValue;
    },
  },

  has: {
    name: "WeakMap.prototype.has",
    call(args, thisValue) {
      const wm = getWeakMapData(thisValue);
      const key = args[0] !== undefined ? args[0] : mkUndefined();
      return mkBool(wm.has(key));
    },
  },

  delete: {
    name: "WeakMap.prototype.delete",
    call(args, thisValue) {
      const wm = getWeakMapData(thisValue);
      const key = args[0] !== undefined ? args[0] : mkUndefined();
      return mkBool(wm.delete(key));
    },
  },
};
