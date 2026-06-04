import {
  mkFunction,
  mkArray,
  mkUndefined,
  mkString,
  isFunction,
  getPayload,
} from "../../../core/value/index.js";

import { createJSArray } from "../../../objects/heap/factory.js";
import { CallbackMicrotask } from "../../../runtime/microtasks/microtask.js";
import {
  mkPromiseCapability,
  promiseResolve,
  promiseReject,
  PROMISE_FULFILLED,
  PROMISE_REJECTED,
} from "../../../runtime/async/promise.js";
import {
  getIterator,
  iteratorDone,
  iteratorValue,
} from "../../../runtime/iteration/iterator.js";
import { VMTypeError } from "../../../core/errors/index.js";
import { RegisterMiniJITException } from "./helpers.js";

export function installPromiseBuiltin(interpreter) {
  const promiseCtor = {
    name: "Promise",
    properties: {},
    construct: (args) => {
      const executor = args[0];
      const { capability, value } = mkPromiseCapability(
        interpreter.microtaskQueue,
      );
      if (isFunction(executor)) {
        const resolveFn = mkFunction({
          name: "Promise.resolveCapability",
          call: (resolveArgs) => {
            capability.resolve(resolveArgs[0] || mkUndefined());
            return mkUndefined();
          },
        });
        const rejectFn = mkFunction({
          name: "Promise.rejectCapability",
          call: (rejectArgs) => {
            capability.reject(rejectArgs[0] || mkUndefined());
            return mkUndefined();
          },
        });
        try {
          interpreter.callFunctionValue(
            executor,
            [resolveFn, rejectFn],
            mkUndefined(),
          );
        } catch (e) {
          capability.reject(exceptionToValue(e));
        }
      }
      return value;
    },
  };

  promiseCtor.properties.resolve = mkFunction({
    name: "Promise.resolve",
    call: (args) =>
      promiseResolve(
        interpreter.microtaskQueue,
        args[0] || mkUndefined(),
        interpreter,
      ),
  });
  promiseCtor.properties.reject = mkFunction({
    name: "Promise.reject",
    call: (args) =>
      promiseReject(interpreter.microtaskQueue, args[0] || mkUndefined()),
  });
  promiseCtor.properties.all = mkFunction({
    name: "Promise.all",
    call: (args) => promiseAll(interpreter, args[0]),
  });
  promiseCtor.properties.race = mkFunction({
    name: "Promise.race",
    call: (args) => promiseRace(interpreter, args[0]),
  });

  interpreter.globalCells.write("Promise", mkFunction(promiseCtor));
  interpreter.globalCells.write(
    "queueMicrotask",
    mkFunction({
      name: "queueMicrotask",
      call: (args) => {
        const callback = args[0];
        if (!isFunction(callback)) {
          throw new VMTypeError("queueMicrotask requires a function argument");
        }
        interpreter.microtaskQueue.enqueue(new CallbackMicrotask(callback));
        return mkUndefined();
      },
    }),
  );
}

export function exceptionToValue(e) {
  if (e instanceof RegisterMiniJITException) return e.value;
  if (e && typeof e.value === "number") return e.value;
  return mkString(e && e.message ? e.message : String(e));
}

export function promiseAll(interpreter, iterable) {
  const { capability, value } = mkPromiseCapability(interpreter.microtaskQueue);
  let iter;
  try {
    iter = getIterator(iterable, interpreter);
    const items = [];
    while (true) {
      const next = getPayload(iter).nextValue(interpreter);
      if (iteratorDone(next)) break;
      items.push(iteratorValue(next));
    }
    const results = new Array(items.length);
    if (items.length === 0) {
      capability.resolve(mkArray(createJSArray([])));
      return value;
    }
    let remaining = items.length;
    items.forEach((item, index) => {
      getPayload(
        promiseResolve(interpreter.microtaskQueue, item, interpreter),
      ).addReaction((state, result) => {
        if (state === PROMISE_REJECTED) {
          capability.reject(result);
          return;
        }
        results[index] = result;
        remaining--;
        if (remaining === 0)
          capability.resolve(mkArray(createJSArray(results)));
      });
    });
  } catch (e) {
    capability.reject(exceptionToValue(e));
  }
  return value;
}

export function promiseRace(interpreter, iterable) {
  const { capability, value } = mkPromiseCapability(interpreter.microtaskQueue);
  try {
    const iter = getIterator(iterable, interpreter);
    while (true) {
      const next = getPayload(iter).nextValue(interpreter);
      if (iteratorDone(next)) break;
      getPayload(
        promiseResolve(
          interpreter.microtaskQueue,
          iteratorValue(next),
          interpreter,
        ),
      ).addReaction((state, result) => {
        if (state === PROMISE_FULFILLED) capability.resolve(result);
        else capability.reject(result);
      });
    }
  } catch (e) {
    capability.reject(exceptionToValue(e));
  }
  return value;
}
