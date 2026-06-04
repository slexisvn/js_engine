import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  MicrotaskQueue,
  MicrotaskPolicy,
  MicrotasksScope,
  Microtask,
  PromiseReactionMicrotask,
  PromiseResolveThenableMicrotask,
  CallbackMicrotask,
} from "../../src/runtime/microtasks/microtask.js";
import { MiniJIT } from "../../src/index.js";
import {
  mkFunction,
  mkUndefined,
  mkObject,
  getPayload,
} from "../../src/core/value/index.js";

function callbackTask(call, name = "task") {
  return new CallbackMicrotask(
    mkFunction({
      name,
      call: () => {
        call();
        return mkUndefined();
      },
    }),
  );
}

describe("Typed Microtasks", () => {
  let queue;

  beforeEach(() => {
    queue = new MicrotaskQueue();
  });

  it("PromiseReactionMicrotask executes reaction with correct state and value", () => {
    let captured = null;
    const reaction = (state, value) => {
      captured = { state, value };
    };
    const task = new PromiseReactionMicrotask(reaction, null, "fulfilled", 42);

    assert.equal(task.type, "promise-reaction");
    queue.enqueue(task);
    queue.drain();

    assert.deepEqual(captured, { state: "fulfilled", value: 42 });
  });

  it("PromiseReactionMicrotask handles rejected state", () => {
    let captured = null;
    const reaction = (state, value) => {
      captured = { state, value };
    };
    const task = new PromiseReactionMicrotask(
      reaction,
      null,
      "rejected",
      "error",
    );

    queue.enqueue(task);
    queue.drain();

    assert.deepEqual(captured, { state: "rejected", value: "error" });
  });

  it("CallbackMicrotask executes via interpreter.callFunctionValue", () => {
    const jit = new MiniJIT();
    let called = false;

    const callback = mkFunction({
      name: "testCb",
      call: () => {
        called = true;
        return mkUndefined();
      },
    });

    const task = new CallbackMicrotask(callback);
    assert.equal(task.type, "callback");

    queue.enqueue(task);
    queue.drain(null);

    assert.equal(called, true);
  });

  it("enqueue rejects invalid arguments", () => {
    assert.throws(() => queue.enqueue(42), /expected Microtask/);
    assert.throws(() => queue.enqueue(() => {}), /expected Microtask/);
  });

  it("stats track enqueued and executed counts", () => {
    queue.enqueue(callbackTask(() => {}, "a"));
    queue.enqueue(callbackTask(() => {}, "b"));
    queue.enqueue(callbackTask(() => {}, "c"));
    assert.equal(queue.stats.enqueued, 3);
    assert.equal(queue.stats.executed, 0);

    queue.drain();
    assert.equal(queue.stats.executed, 3);
  });
});

describe("MicrotaskPolicy", () => {
  it("AUTO policy drains at performCheckpoint", () => {
    const queue = new MicrotaskQueue({ policy: MicrotaskPolicy.AUTO });
    let executed = false;
    queue.enqueue(
      callbackTask(() => {
        executed = true;
      }),
    );
    queue.performCheckpoint();
    assert.equal(executed, true);
  });

  it("EXPLICIT policy does NOT drain at performCheckpoint", () => {
    const queue = new MicrotaskQueue({ policy: MicrotaskPolicy.EXPLICIT });
    let executed = false;
    queue.enqueue(
      callbackTask(() => {
        executed = true;
      }),
    );
    queue.performCheckpoint();
    assert.equal(executed, false);
    assert.equal(queue.queue.length, 1);

    queue.drain();
    assert.equal(executed, true);
  });

  it("policy can be changed at runtime", () => {
    const queue = new MicrotaskQueue({ policy: MicrotaskPolicy.AUTO });
    let count = 0;
    queue.enqueue(
      callbackTask(() => {
        count++;
      }),
    );
    queue.setPolicy(MicrotaskPolicy.EXPLICIT);
    queue.performCheckpoint();
    assert.equal(count, 0);

    queue.setPolicy(MicrotaskPolicy.AUTO);
    queue.performCheckpoint();
    assert.equal(count, 1);
  });

  it("defaults to AUTO policy", () => {
    const queue = new MicrotaskQueue();
    assert.equal(queue.policy, MicrotaskPolicy.AUTO);
  });
});

describe("MicrotasksScope", () => {
  it("tracks nesting depth", () => {
    const queue = new MicrotaskQueue();
    assert.equal(queue.nestingDepth, 0);

    const scope1 = new MicrotasksScope(queue, null);
    assert.equal(queue.nestingDepth, 1);

    const scope2 = new MicrotasksScope(queue, null);
    assert.equal(queue.nestingDepth, 2);

    scope2.exit();
    assert.equal(queue.nestingDepth, 1);

    scope1.exit();
    assert.equal(queue.nestingDepth, 0);
  });

  it("auto-checkpoints when outermost scope exits", () => {
    const queue = new MicrotaskQueue({ policy: MicrotaskPolicy.AUTO });
    let executed = false;
    queue.enqueue(
      callbackTask(() => {
        executed = true;
      }),
    );

    const scope = new MicrotasksScope(queue, null);

    assert.equal(executed, false);

    scope.exit();
    assert.equal(executed, true);
  });

  it("nested scopes defer checkpoint until outermost exits", () => {
    const queue = new MicrotaskQueue({ policy: MicrotaskPolicy.AUTO });
    let count = 0;

    const outer = new MicrotasksScope(queue, null);
    queue.enqueue(
      callbackTask(() => {
        count++;
      }, "outer"),
    );

    const inner = new MicrotasksScope(queue, null);
    queue.enqueue(
      callbackTask(() => {
        count++;
      }, "inner"),
    );

    inner.exit();
    assert.equal(count, 0);

    outer.exit();
    assert.equal(count, 2);
  });
});

describe("Suppression depth", () => {
  it("prevents drain during checkpoint when suppressed", () => {
    const queue = new MicrotaskQueue();
    let executed = false;
    queue.enqueue(
      callbackTask(() => {
        executed = true;
      }),
    );

    queue.incrementSuppressionDepth();
    queue.performCheckpoint();
    assert.equal(executed, false);

    queue.decrementSuppressionDepth();
    queue.performCheckpoint();
    assert.equal(executed, true);
  });

  it("suppression also prevents drain()", () => {
    const queue = new MicrotaskQueue();
    let executed = false;
    queue.enqueue(
      callbackTask(() => {
        executed = true;
      }),
    );

    queue.incrementSuppressionDepth();
    queue.drain();
    assert.equal(executed, false);

    queue.decrementSuppressionDepth();
    queue.drain();
    assert.equal(executed, true);
  });

  it("does not go below zero", () => {
    const queue = new MicrotaskQueue();
    queue.decrementSuppressionDepth();
    queue.decrementSuppressionDepth();
    assert.equal(queue.suppressionDepth, 0);
  });
});

describe("Unhandled Rejection Tracking", () => {
  it("tracks rejected promise with no handler", () => {
    const queue = new MicrotaskQueue();
    const fakePromise = { id: "p1" };
    queue.trackRejection(fakePromise, "error reason");

    assert.equal(queue.pendingRejections.size, 1);
    assert.equal(queue.pendingRejections.get(fakePromise), "error reason");
  });

  it("clears rejection when handler is added", () => {
    const queue = new MicrotaskQueue();
    const fakePromise = { id: "p1" };

    queue.trackRejection(fakePromise, "error");
    assert.equal(queue.pendingRejections.size, 1);

    queue.trackHandle(fakePromise);
    assert.equal(queue.pendingRejections.size, 0);
  });

  it("fires rejectionHandler with correct operation", () => {
    const queue = new MicrotaskQueue();
    const events = [];
    queue.setRejectionHandler((promise, op) => events.push({ promise, op }));

    const fakePromise = { id: "p1" };
    queue.trackRejection(fakePromise, "err");
    queue.trackHandle(fakePromise);

    assert.equal(events.length, 2);
    assert.equal(events[0].op, "reject");
    assert.equal(events[0].promise, fakePromise);
    assert.equal(events[1].op, "handle");
    assert.equal(events[1].promise, fakePromise);
  });

  it("trackHandle is a no-op for non-tracked promises", () => {
    const queue = new MicrotaskQueue();
    const events = [];
    queue.setRejectionHandler((_, op) => events.push(op));

    queue.trackHandle({ id: "unknown" });
    assert.equal(events.length, 0);
  });
});

describe("Checkpoint stats", () => {
  it("counts checkpoints correctly", () => {
    const queue = new MicrotaskQueue({ policy: MicrotaskPolicy.AUTO });
    queue.performCheckpoint();
    queue.performCheckpoint();
    queue.performCheckpoint();
    assert.equal(queue.stats.checkpoints, 3);
  });

  it("getStats returns comprehensive stats", () => {
    const queue = new MicrotaskQueue();
    queue.enqueue(callbackTask(() => {}, "stats-a"));
    queue.enqueue(callbackTask(() => {}, "stats-b"));
    queue.drain();
    queue.performCheckpoint();

    const stats = queue.getStats();
    assert.equal(stats.enqueued, 2);
    assert.equal(stats.executed, 2);
    assert.equal(stats.checkpoints, 1);
    assert.equal(stats.pending, 0);
    assert.equal(stats.policy, MicrotaskPolicy.AUTO);
  });
});

describe("Queue safety limit", () => {
  it("throws when drain exceeds limit", () => {
    const queue = new MicrotaskQueue();

    const enqueueMore = () => {
      queue.enqueue(callbackTask(enqueueMore, "more"));
    };
    queue.enqueue(callbackTask(enqueueMore, "more"));

    assert.throws(() => queue.drain(null, 100), /limit exceeded/);
  });
});

describe("Engine microtask integration", () => {
  it("queueMicrotask builtin works in MiniJIT programs", () => {
    const jit = new MiniJIT();

    const result = jit.runValue(`
      let x = 0;
      function setTwo() { x = 2; }
      x = 1;
      queueMicrotask(setTwo);
      x;
    `);

    assert.equal(result.value, 1);

    assert.ok(jit.microtaskQueue.stats.executed > 0);
  });

  it("queueMicrotask callback is executed during drain", () => {
    const jit = new MiniJIT();

    jit.run(`
      function noop() {}
      queueMicrotask(noop);
      queueMicrotask(noop);
    `);

    assert.ok(jit.microtaskQueue.stats.executed >= 2);
  });

  it("engine.setMicrotaskPolicy works", () => {
    const jit = new MiniJIT();
    jit.setMicrotaskPolicy(MicrotaskPolicy.EXPLICIT);
    assert.equal(jit.microtaskQueue.policy, MicrotaskPolicy.EXPLICIT);

    let executed = false;
    jit.microtaskQueue.enqueue(
      callbackTask(() => {
        executed = true;
      }),
    );
    jit.performMicrotaskCheckpoint();
    assert.equal(executed, false);

    jit.drainMicrotasks();
    assert.equal(executed, true);
  });

  it("engine.getStats includes microtask stats", () => {
    const jit = new MiniJIT();
    jit.run("1 + 1;");
    const stats = jit.getStats();
    assert.ok("microtasks" in stats);
    assert.ok("enqueued" in stats.microtasks);
    assert.ok("executed" in stats.microtasks);
    assert.ok("checkpoints" in stats.microtasks);
  });

  it("promise rejection tracking works end-to-end", () => {
    const jit = new MiniJIT();
    const events = [];
    jit.microtaskQueue.setRejectionHandler((promise, op) => events.push(op));

    jit.run('Promise.reject("oops");');

    assert.ok(events.includes("reject"));
  });

  it("promise rejection cleared when catch is added", () => {
    const jit = new MiniJIT();
    const events = [];
    jit.microtaskQueue.setRejectionHandler((promise, op) => events.push(op));

    function noop() {}
    jit.run(`
      function noop(e) {}
      Promise.reject("oops").catch(noop);
    `);

    assert.ok(events.includes("reject"));
    assert.ok(events.includes("handle"));
  });
});

describe("Re-entrance prevention", () => {
  it("microtasks enqueued during drain are processed in same drain cycle", () => {
    const queue = new MicrotaskQueue();

    queue.enqueue(
      callbackTask(() => {
        queue.enqueue(callbackTask(() => {}, "inner"));
      }, "outer"),
    );
    queue.enqueue(callbackTask(() => {}, "sibling"));

    queue.drain();

    assert.equal(queue.stats.executed, 3);
  });
});

describe("alreadyResolved guard (PromiseResolveThenableMicrotask)", () => {
  it("resolve called twice — second call is no-op", () => {
    const queue = new MicrotaskQueue();
    let settleCount = 0;
    let settledValue = null;
    const fakePromise = {
      fulfill(v) {
        settleCount++;
        settledValue = v;
      },
      reject(v) {
        settleCount++;
        settledValue = v;
      },
    };
    const thenMethod = mkFunction({
      name: "thenable.then",
      call: (args) => {
        getPayload(args[0]).call([mkUndefined()]);
        getPayload(args[0]).call([mkUndefined()]);
        return mkUndefined();
      },
    });
    const task = new PromiseResolveThenableMicrotask(
      fakePromise,
      mkUndefined(),
      thenMethod,
      null,
    );
    queue.enqueue(task);
    queue.drain();
    assert.equal(settleCount, 1);
  });

  it("resolve then reject — reject is no-op", () => {
    const queue = new MicrotaskQueue();
    let fulfilled = false;
    let rejected = false;
    const fakePromise = {
      fulfill(v) {
        fulfilled = true;
      },
      reject(v) {
        rejected = true;
      },
    };
    const thenMethod = mkFunction({
      name: "thenable.then",
      call: (args) => {
        getPayload(args[0]).call([mkUndefined()]);
        getPayload(args[1]).call([mkUndefined()]);
        return mkUndefined();
      },
    });
    const task = new PromiseResolveThenableMicrotask(
      fakePromise,
      mkUndefined(),
      thenMethod,
      null,
    );
    queue.enqueue(task);
    queue.drain();
    assert.equal(fulfilled, true);
    assert.equal(rejected, false);
  });

  it("reject then resolve — resolve is no-op", () => {
    const queue = new MicrotaskQueue();
    let fulfilled = false;
    let rejected = false;
    const fakePromise = {
      fulfill(v) {
        fulfilled = true;
      },
      reject(v) {
        rejected = true;
      },
    };
    const thenMethod = mkFunction({
      name: "thenable.then",
      call: (args) => {
        getPayload(args[1]).call([mkUndefined()]);
        getPayload(args[0]).call([mkUndefined()]);
        return mkUndefined();
      },
    });
    const task = new PromiseResolveThenableMicrotask(
      fakePromise,
      mkUndefined(),
      thenMethod,
      null,
    );
    queue.enqueue(task);
    queue.drain();
    assert.equal(rejected, true);
    assert.equal(fulfilled, false);
  });
});

describe("MicrotaskPolicy.SCOPED", () => {
  it("performCheckpoint is no-op under SCOPED policy", () => {
    const queue = new MicrotaskQueue({ policy: MicrotaskPolicy.SCOPED });
    let executed = false;
    queue.enqueue(
      callbackTask(() => {
        executed = true;
      }),
    );
    queue.performCheckpoint();
    assert.equal(executed, false);
    assert.equal(queue.queue.length, 1);
  });

  it("drains when outermost MicrotasksScope exits", () => {
    const queue = new MicrotaskQueue({ policy: MicrotaskPolicy.SCOPED });
    let executed = false;
    queue.enqueue(
      callbackTask(() => {
        executed = true;
      }),
    );

    const scope = new MicrotasksScope(queue, null);
    assert.equal(executed, false);
    scope.exit();
    assert.equal(executed, true);
  });

  it("nested scopes defer drain until outermost exits", () => {
    const queue = new MicrotaskQueue({ policy: MicrotaskPolicy.SCOPED });
    let count = 0;

    const outer = new MicrotasksScope(queue, null);
    queue.enqueue(
      callbackTask(() => {
        count++;
      }, "outer"),
    );

    const inner = new MicrotasksScope(queue, null);
    queue.enqueue(
      callbackTask(() => {
        count++;
      }, "inner"),
    );

    inner.exit();
    assert.equal(count, 0);

    outer.exit();
    assert.equal(count, 2);
  });

  it("explicit drain still works under SCOPED", () => {
    const queue = new MicrotaskQueue({ policy: MicrotaskPolicy.SCOPED });
    let executed = false;
    queue.enqueue(
      callbackTask(() => {
        executed = true;
      }),
    );
    queue.drain();
    assert.equal(executed, true);
  });
});

describe("Engine MicrotasksScope integration", () => {
  it("SCOPED policy drains microtasks after engine.run()", () => {
    const jit = new MiniJIT({ microtaskPolicy: MicrotaskPolicy.SCOPED });
    jit.run(`
      function noop() {}
      queueMicrotask(noop);
      queueMicrotask(noop);
    `);
    assert.ok(jit.microtaskQueue.stats.executed >= 2);
  });

  it("EXPLICIT policy does NOT drain microtasks after engine.run()", () => {
    const jit = new MiniJIT({ microtaskPolicy: MicrotaskPolicy.EXPLICIT });
    let before = jit.microtaskQueue.stats.executed;
    jit.run(`
      function noop() {}
      queueMicrotask(noop);
    `);
    assert.equal(jit.microtaskQueue.stats.executed, before);
    assert.equal(jit.microtaskQueue.queue.length, 1);

    jit.drainMicrotasks();
    assert.equal(jit.microtaskQueue.queue.length, 0);
  });
});
