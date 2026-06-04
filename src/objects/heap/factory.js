import { JSObject } from "./js-object.js";
import { JSArray } from "./js-array.js";
import { JSProxy } from "../exotic/js-proxy.js";
import { OrderedHashMap, OrderedHashSet, EphemeronHashTable } from "./js-collections.js";
import {
  getInitialMap,
  INSTANCE_TYPE_MAP,
  INSTANCE_TYPE_SET,
  INSTANCE_TYPE_WEAKMAP,
  INSTANCE_TYPE_STRING_WRAPPER,
  INSTANCE_TYPE_NUMBER_WRAPPER,
  INSTANCE_TYPE_BOOLEAN_WRAPPER,
} from "../maps/hidden-class.js";
import { bindWriteBarrierGC } from "../../gc/write-barrier.js";

let _gc = null;

export function bindGC(gc) {
  _gc = gc;
  bindWriteBarrierGC(gc);
}

export function createJSObject(hiddenClass, pretenure = false) {
  const obj = new JSObject(hiddenClass);
  if (_gc) {
    _gc.allocate(obj, pretenure);
  }
  return obj;
}

export function createJSArray(elements) {
  const arr = new JSArray(elements);
  if (_gc) {
    _gc.allocate(arr);
  }
  return arr;
}

export function createJSMap() {
  const obj = new JSObject(getInitialMap(INSTANCE_TYPE_MAP));
  obj._mapData = new OrderedHashMap();
  if (_gc) _gc.allocate(obj);
  return obj;
}

export function createJSSet() {
  const obj = new JSObject(getInitialMap(INSTANCE_TYPE_SET));
  obj._setData = new OrderedHashSet();
  if (_gc) _gc.allocate(obj);
  return obj;
}

export function createJSWeakMap() {
  const obj = new JSObject(getInitialMap(INSTANCE_TYPE_WEAKMAP));
  obj._weakMapData = new EphemeronHashTable();
  if (_gc) _gc.allocate(obj);
  return obj;
}

export function createJSPrimitiveWrapper(instanceType, primitiveValue) {
  const obj = new JSObject(getInitialMap(instanceType));
  obj._primitiveValue = primitiveValue;
  if (_gc) _gc.allocate(obj);
  return obj;
}

export function createJSProxy(target, handler) {
  const proxy = new JSProxy(target, handler);
  if (_gc) {
    _gc.allocate(proxy);
  }
  return proxy;
}
