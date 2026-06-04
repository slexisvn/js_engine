import {
  mkFunction,
  mkPromise,
  mkUndefined,
  isObject,
  isPromise,
  isFunction,
  getPayload,
} from "../../core/value/index.js";
import { tracer } from "../../core/tracing/index.js";
import {
  PromiseReactionMicrotask,
  PromiseResolveThenableMicrotask,
} from "../microtasks/microtask.js";

export const PROMISE_PENDING = "pending";
export const PROMISE_FULFILLED = "fulfilled";
export const PROMISE_REJECTED = "rejected";

export class JSPromise {
  constructor(queue) {
    this.queue = queue;
    this.state = PROMISE_PENDING;
    this.result = mkUndefined();
    this.reactions = [];
    this.asyncFunctionName = null;
    this.resumePc = -1;
  }

  fulfill(value) {
    this.settle(PROMISE_FULFILLED, value);
  }

  reject(reason) {
    if (this.state !== PROMISE_PENDING) return;
    const hadReactions = this.reactions.length > 0;
    this.settle(PROMISE_REJECTED, reason);
    if (!hadReactions) {
      this.queue.trackRejection(this, reason);
    }
  }

  settle(state, value) {
    if (this.state !== PROMISE_PENDING) return;
    this.state = state;
    this.result = value;
    const reactions = this.reactions.splice(0);
    for (const reaction of reactions) {
      this.queue.enqueue(
        new PromiseReactionMicrotask(reaction, this, state, value),
      );
    }
  }

  addReaction(reaction) {
    if (this.state === PROMISE_PENDING) {
      this.reactions.push(reaction);
      return;
    }
    const state = this.state;
    const result = this.result;
    this.queue.enqueue(
      new PromiseReactionMicrotask(reaction, this, state, result),
    );

    if (state === PROMISE_REJECTED) {
      this.queue.trackHandle(this);
    }
  }
}

export class PromiseCapability {
  constructor(queue) {
    this.promise = new JSPromise(queue);
    this.resolve = (value) => resolvePromise(queue, this.promise, value);
    this.reject = (reason) => this.promise.reject(reason);
  }
}

export function mkPromiseCapability(queue) {
  const capability = new PromiseCapability(queue);
  return { capability, value: mkPromise(capability.promise) };
}

export function promiseResolve(queue, value, interpreter = null) {
  if (isPromise(value)) return value;
  const { capability, value: promiseValue } = mkPromiseCapability(queue);
  resolvePromise(queue, capability.promise, value, interpreter);
  return promiseValue;
}

export function promiseReject(queue, reason) {
  const { capability, value: promiseValue } = mkPromiseCapability(queue);
  capability.reject(reason);
  return promiseValue;
}

export function resolvePromise(queue, promise, value, interpreter = null) {
  if (isPromise(value)) {
    const then = mkFunction({
      name: "Promise.then",
      call: (args) => {
        const onFulfilled = args[0];
        const onRejected = args[1];
        getPayload(value).addReaction((state, result) => {
          if (state === PROMISE_FULFILLED) {
            if (isFunction(onFulfilled)) getPayload(onFulfilled).call([result]);
            else promise.fulfill(result);
          } else {
            if (isFunction(onRejected)) getPayload(onRejected).call([result]);
            else promise.reject(result);
          }
        });
        return mkUndefined();
      },
    });
    queue.enqueue(
      new PromiseResolveThenableMicrotask(promise, value, then, interpreter),
    );
    return;
  }
  if (isObject(value)) {
    const then = getPayload(value).getProperty("then");
    if (isFunction(then)) {
      queue.enqueue(
        new PromiseResolveThenableMicrotask(promise, value, then, interpreter),
      );
      return;
    }
  }
  promise.fulfill(value);
}

export function promiseThen(interpreter, receiver, onFulfilled, onRejected) {
  const source = isPromise(receiver)
    ? getPayload(receiver)
    : getPayload(
        promiseResolve(interpreter.microtaskQueue, receiver, interpreter),
      );
  const { capability, value: nextPromise } = mkPromiseCapability(
    interpreter.microtaskQueue,
  );
  source.addReaction((state, result) => {
    try {
      const handler = state === PROMISE_FULFILLED ? onFulfilled : onRejected;
      if (isFunction(handler)) {
        const handled = interpreter.callFunctionValue(
          handler,
          [result],
          mkUndefined(),
        );
        capability.resolve(handled);
      } else if (state === PROMISE_FULFILLED) {
        capability.resolve(result);
      } else {
        capability.reject(result);
      }
    } catch (e) {
      capability.reject(interpreter.exceptionToValue(e));
    }
  });
  tracer.log("promise", "Promise reaction registered");
  return nextPromise;
}
