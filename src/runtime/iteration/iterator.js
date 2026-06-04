import {
  mkBool,
  mkIterator,
  mkObject,
  mkSmi,
  mkString,
  mkUndefined,
  isArray,
  isString,
  isObject,
  isIterator,
  isFunction,
  isGenerator,
  isUndefined,
  getPayload,
  toBool,
  wellKnownSymbols,
} from "../../core/value/index.js";
import { createJSObject } from "../../objects/heap/factory.js";

export class IteratorRecord {
  constructor(next) {
    this.next = next;
  }

  nextValue(interpreter) {
    return this.next(interpreter);
  }
}

export function createIteratorResult(value, done) {
  const obj = createJSObject();
  obj.setProperty("value", value);
  obj.setProperty("done", mkBool(done));
  return mkObject(obj);
}

export function getIterator(value, interpreter) {
  if (isIterator(value)) return value;

  if (isGenerator(value)) {
    const gen = getPayload(value);
    return mkIterator(
      new IteratorRecord((interp) => {
        return interp.generatorNext(gen, mkUndefined());
      }),
    );
  }

  if (isArray(value)) {
    let index = 0;
    const arr = getPayload(value);
    return mkIterator(
      new IteratorRecord(() => {
        if (index >= arr.getLength())
          return createIteratorResult(mkUndefined(), true);
        const item = arr.getIndex(index++);
        return createIteratorResult(
          item !== undefined ? item : mkUndefined(),
          false,
        );
      }),
    );
  }

  if (isString(value)) {
    let index = 0;
    const str = getPayload(value);
    return mkIterator(
      new IteratorRecord(() => {
        if (index >= str.length)
          return createIteratorResult(mkUndefined(), true);
        return createIteratorResult(mkString(str[index++]), false);
      }),
    );
  }

  if (isObject(value)) {
    const obj = getPayload(value);
    let method;
    if (wellKnownSymbols.iterator) {
      method = obj.getSymbolProperty(wellKnownSymbols.iterator);
      if ((!method || isUndefined(method)) && obj.prototype) {
        let proto = obj.prototype;
        while (proto && (!method || isUndefined(method))) {
          method = proto.getSymbolProperty(wellKnownSymbols.iterator);
          proto = proto.prototype;
        }
      }
    }
    if (!method || isUndefined(method)) {
      method = obj.getProperty("@@iterator");
    }
    if (isFunction(method)) {
      const iter = interpreter.callFunctionValue(method, [], value);
      if (isIterator(iter)) return iter;
      if (isObject(iter)) {
        const nextMethod = getPayload(iter).getProperty("next");
        if (isFunction(nextMethod)) {
          return mkIterator(
            new IteratorRecord((i) =>
              i.callFunctionValue(nextMethod, [], iter),
            ),
          );
        }
      }
    }
  }

  throw new Error("TypeError: value is not iterable");
}

export function iteratorDone(result) {
  if (!isObject(result)) return true;
  const done = getPayload(result).getProperty("done");
  return done ? toBool(done) : false;
}

export function iteratorValue(result) {
  if (!isObject(result)) return mkUndefined();
  const value = getPayload(result).getProperty("value");
  return value !== undefined ? value : mkUndefined();
}
