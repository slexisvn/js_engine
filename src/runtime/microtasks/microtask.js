import {
  mkFunction,
  mkUndefined,
  isFunction,
  getPayload,
} from "../../core/value/index.js";
import { tracer } from "../../core/tracing/index.js";

export const MicrotaskPolicy = Object.freeze({
  AUTO: "auto",
  EXPLICIT: "explicit",
  SCOPED: "scoped",
});

export class Microtask {
  constructor(type) {
    this.type = type;
  }

  run(interpreter) {
    throw new Error("Microtask.run() is abstract");
  }
}

export class PromiseReactionMicrotask extends Microtask {
  constructor(reaction, promise, state, value) {
    super("promise-reaction");
    this.reaction = reaction;
    this.promise = promise;
    this.state = state;
    this.value = value;
  }

  run(_interpreter) {
    this.reaction(this.state, this.value);
  }
}

export class PromiseResolveThenableMicrotask extends Microtask {
  constructor(promiseToResolve, thenable, thenMethod, interpreter) {
    super("promise-resolve-thenable");
    this.promiseToResolve = promiseToResolve;
    this.thenable = thenable;
    this.thenMethod = thenMethod;
    this._interpreter = interpreter;
  }

  run(interpreter) {
    const interp = interpreter || this._interpreter;
    let alreadyResolved = false;
    const resolveFn = mkFunction({
      name: "Thenable.resolve",
      call: (args) => {
        if (alreadyResolved) return mkUndefined();
        alreadyResolved = true;
        this.promiseToResolve.fulfill(args[0] || mkUndefined());
        return mkUndefined();
      },
    });
    const rejectFn = mkFunction({
      name: "Thenable.reject",
      call: (args) => {
        if (alreadyResolved) return mkUndefined();
        alreadyResolved = true;
        this.promiseToResolve.reject(args[0] || mkUndefined());
        return mkUndefined();
      },
    });
    try {
      if (interp) {
        interp.callFunctionValue(
          this.thenMethod,
          [resolveFn, rejectFn],
          this.thenable,
        );
      } else if (
        getPayload(this.thenMethod) &&
        getPayload(this.thenMethod).call
      ) {
        getPayload(this.thenMethod).call([resolveFn, rejectFn], this.thenable);
      } else {
        this.promiseToResolve.reject(mkUndefined());
      }
    } catch (e) {
      this.promiseToResolve.reject(mkUndefined());
    }
  }
}

export class CallbackMicrotask extends Microtask {
  constructor(callback) {
    super("callback");
    this.callback = callback;
  }

  run(interpreter) {
    if (interpreter) {
      interpreter.callFunctionValue(this.callback, [], mkUndefined());
    } else if (getPayload(this.callback) && getPayload(this.callback).call) {
      getPayload(this.callback).call([], mkUndefined());
    }
  }
}

export class MicrotaskQueue {
  constructor(options = {}) {
    this.queue = [];

    this.policy = options.policy || MicrotaskPolicy.AUTO;

    this.nestingDepth = 0;

    this.suppressionDepth = 0;

    this.running = false;

    this.pendingRejections = new Map();

    this.rejectionHandler = null;

    this.stats = {
      enqueued: 0,
      executed: 0,
      checkpoints: 0,
    };
  }

  enqueue(microtask) {
    if (!(microtask instanceof Microtask)) {
      throw new Error("MicrotaskQueue.enqueue: expected Microtask");
    }
    this.queue.push(microtask);
    this.stats.enqueued++;
    tracer.log(
      "microtask",
      `Enqueue: ${microtask.type}${microtask.label ? ` (${microtask.label})` : ""}`,
    );
  }

  runOne(interpreter) {
    if (this.queue.length === 0) return false;
    const microtask = this.queue.shift();
    tracer.log(
      "microtask",
      `Run: ${microtask.type}${microtask.label ? ` (${microtask.label})` : ""}`,
    );
    microtask.run(interpreter);
    this.stats.executed++;
    return true;
  }

  drain(interpreter, limit = 10000) {
    if (this.running) return;
    if (this.suppressionDepth > 0) return;

    this.running = true;
    this.nestingDepth++;
    try {
      let count = 0;
      while (this.queue.length > 0) {
        if (count++ >= limit) {
          throw new Error("Microtask queue limit exceeded");
        }
        this.runOne(interpreter);
      }
    } finally {
      this.nestingDepth--;
      this.running = false;
      this._checkPendingRejections();
    }
  }

  performCheckpoint(interpreter) {
    if (this.policy === MicrotaskPolicy.EXPLICIT) return;
    if (this.policy === MicrotaskPolicy.SCOPED) return;
    if (this.suppressionDepth > 0) return;
    this.stats.checkpoints++;
    tracer.log(
      "microtask",
      `Checkpoint (queue=${this.queue.length}, nesting=${this.nestingDepth})`,
    );
    this.drain(interpreter);
  }

  incrementSuppressionDepth() {
    this.suppressionDepth++;
  }

  decrementSuppressionDepth() {
    if (this.suppressionDepth > 0) this.suppressionDepth--;
  }

  setPolicy(policy) {
    this.policy = policy;
  }

  trackRejection(promise, value) {
    this.pendingRejections.set(promise, value);
    tracer.log(
      "microtask",
      `UnhandledRejection tracked (pending=${this.pendingRejections.size})`,
    );
    if (this.rejectionHandler) {
      this.rejectionHandler(promise, "reject");
    }
  }

  trackHandle(promise) {
    if (this.pendingRejections.has(promise)) {
      this.pendingRejections.delete(promise);
      tracer.log(
        "microtask",
        `RejectionHandled (pending=${this.pendingRejections.size})`,
      );
      if (this.rejectionHandler) {
        this.rejectionHandler(promise, "handle");
      }
    }
  }

  _checkPendingRejections() {
    if (this.pendingRejections.size === 0) return;
    for (const [promise, value] of this.pendingRejections) {
      tracer.log(
        "microtask",
        `WARNING: Unhandled promise rejection (value=${value})`,
      );
    }
  }

  setRejectionHandler(handler) {
    this.rejectionHandler = handler;
  }

  getStats() {
    return {
      ...this.stats,
      pending: this.queue.length,
      pendingRejections: this.pendingRejections.size,
      policy: this.policy,
    };
  }
}

export class MicrotasksScope {
  constructor(queue, interpreter) {
    this.queue = queue;
    this.interpreter = interpreter;
    this.queue.nestingDepth++;
  }

  exit() {
    this.queue.nestingDepth--;
    if (this.queue.nestingDepth === 0) {
      if (this.queue.policy === MicrotaskPolicy.SCOPED) {
        this.queue.drain(this.interpreter);
      } else {
        this.queue.performCheckpoint(this.interpreter);
      }
    }
  }
}
