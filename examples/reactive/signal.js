var CLEAN = 0;
var CHECK = 1;
var STALE = 2;

var Listener = null;
var Owner = null;
var Updates = null;
var Effects = null;
var ExecCount = 0;
var rootCount = 0;

function SignalNode(value, options) {
  this.value = value;
  this.observers = null;
  this.observerSlots = null;
  this.comparator = options && options.equals !== undefined ? options.equals : null;
}

function Computation(fn, init, pure) {
  this.fn = fn;
  this.state = STALE;
  this.updatedAt = 0;
  this.value = init;
  this.sources = null;
  this.sourceSlots = null;
  this.observers = null;
  this.observerSlots = null;
  this.pure = pure;
  this.owner = Owner;
  this.owned = null;
  this.cleanups = null;
  this.context = null;
  if (Owner) {
    if (!Owner.owned) Owner.owned = [];
    Owner.owned.push(this);
  }
}

function readSignal(node) {
  if (Listener) {
    var sSlot = node.observers ? node.observers.length : 0;
    if (!Listener.sources) {
      Listener.sources = [node];
      Listener.sourceSlots = [sSlot];
    } else {
      Listener.sources.push(node);
      Listener.sourceSlots.push(sSlot);
    }
    if (!node.observers) {
      node.observers = [Listener];
      node.observerSlots = [Listener.sources.length - 1];
    } else {
      node.observers.push(Listener);
      node.observerSlots.push(Listener.sources.length - 1);
    }
  }
  return node.value;
}

function writeSignal(node, value) {
  if (typeof value === "function") value = value(node.value);
  if (node.comparator) {
    if (node.comparator(node.value, value)) return value;
  } else if (node.value === value) {
    return value;
  }
  node.value = value;
  if (node.observers && node.observers.length) {
    runUpdates(function() {
      var i = 0;
      while (i < node.observers.length) {
        var o = node.observers[i];
        if (o.state === CLEAN) {
          o.state = STALE;
          if (o.pure) {
            Updates.push(o);
            markDownstream(o);
          } else {
            Effects.push(o);
          }
        } else {
          o.state = STALE;
        }
        i = i + 1;
      }
    });
  }
  return value;
}

function updateComputation(node) {
  if (!node.fn) return;
  cleanNode(node);
  var time = ExecCount;
  var prevListener = Listener;
  var prevOwner = Owner;
  Listener = node;
  Owner = node;
  try {
    node.value = node.fn(node.value);
  } finally {
    Listener = prevListener;
    Owner = prevOwner;
  }
  if (node.updatedAt <= time) {
    node.updatedAt = time;
    node.state = CLEAN;
  }
}

function runTop(node) {
  if (node.state === CLEAN) return;
  if (node.pure && node.state === CHECK) {
    lookUpstream(node);
    return;
  }
  if (!node.pure) {
    if (node.state === CHECK) lookUpstream(node);
    if (node.state !== CLEAN) updateComputation(node);
    return;
  }
  var ancestors = [];
  var current = node;
  while (current && current.fn) {
    if (current.state !== CLEAN) ancestors.push(current);
    current = current.owner;
  }
  var i = ancestors.length - 1;
  while (i >= 0) {
    var n = ancestors[i];
    if (n.state === STALE) {
      updateComputation(n);
    } else if (n.state === CHECK) {
      lookUpstream(n);
    }
    i = i - 1;
  }
}

function lookUpstream(node) {
  if (!node.sources) { node.state = CLEAN; return; }
  var i = 0;
  while (i < node.sources.length) {
    var source = node.sources[i];
    if (source.state === CHECK) lookUpstream(source);
    if (source.state === STALE) updateComputation(source);
    i = i + 1;
  }
  if (node.state === CHECK) node.state = CLEAN;
}

function markDownstream(node) {
  if (!node.observers) return;
  var i = 0;
  while (i < node.observers.length) {
    var o = node.observers[i];
    if (o.state === CLEAN) {
      if (o.pure) {
        o.state = CHECK;
        Updates.push(o);
        markDownstream(o);
      } else {
        o.state = STALE;
        Effects.push(o);
      }
    }
    i = i + 1;
  }
}

function cleanNode(node) {
  if (node.sources) {
    var i = 0;
    while (i < node.sources.length) {
      var source = node.sources[i];
      if (source.observers) {
        var idx = source.observers.indexOf(node);
        if (idx >= 0) {
          source.observers.splice(idx, 1);
          if (source.observerSlots) source.observerSlots.splice(idx, 1);
        }
      }
      i = i + 1;
    }
    node.sources = null;
    node.sourceSlots = null;
  }
  if (node.owned) {
    i = 0;
    while (i < node.owned.length) {
      cleanNode(node.owned[i]);
      node.owned[i].fn = null;
      i = i + 1;
    }
    node.owned = null;
  }
  if (node.cleanups) {
    i = 0;
    while (i < node.cleanups.length) {
      node.cleanups[i]();
      i = i + 1;
    }
    node.cleanups = null;
  }
}

function runUpdates(fn) {
  if (Updates) return fn();
  var wait = false;
  if (!Effects) Effects = [];
  Updates = [];
  ExecCount = ExecCount + 1;
  try {
    fn();
    completeUpdates(wait);
  } finally {
    Updates = null;
  }
}

function completeUpdates(wait) {
  if (Updates) {
    runQueue(Updates);
    Updates = null;
  }
  if (Effects && Effects.length) {
    var e = Effects;
    Effects = null;
    runUpdates(function() {
      var i = 0;
      while (i < e.length) {
        runTop(e[i]);
        i = i + 1;
      }
    });
  }
}

function runQueue(queue) {
  var i = 0;
  while (i < queue.length) {
    var node = queue[i];
    if (node.state === STALE) {
      updateComputation(node);
    } else if (node.state === CHECK) {
      lookUpstream(node);
    }
    i = i + 1;
  }
}

function createRoot(fn) {
  var prevOwner = Owner;
  var prevListener = Listener;
  var root = new Computation(null, undefined, false);
  root.state = CLEAN;
  Owner = root;
  Listener = null;
  var dispose = function() { cleanNode(root); };
  try {
    return fn(dispose);
  } finally {
    Owner = prevOwner;
    Listener = prevListener;
  }
}

function createSignal(value, options) {
  var s = new SignalNode(value, options);
  var getter = function() { return readSignal(s); };
  var setter = function(v) { return writeSignal(s, v); };
  return [getter, setter];
}

function createEffect(fn, value) {
  var c = new Computation(fn, value, false);
  updateComputation(c);
  return function() { cleanNode(c); c.fn = null; };
}

function createRenderEffect(fn, value) {
  var c = new Computation(fn, value, false);
  updateComputation(c);
}

function createMemo(fn, value, options) {
  var c = new Computation(null, value, true);
  c.fn = function(prev) {
    var val = fn(prev);
    return val;
  };
  updateComputation(c);
  if (options && options.equals !== undefined) c.comparator = options.equals;
  var getter = function() {
    if (c.state !== CLEAN) {
      if (c.state === STALE) updateComputation(c);
      else lookUpstream(c);
    }
    if (Listener) {
      var sSlot = c.observers ? c.observers.length : 0;
      if (!Listener.sources) {
        Listener.sources = [c];
        Listener.sourceSlots = [sSlot];
      } else {
        Listener.sources.push(c);
        Listener.sourceSlots.push(sSlot);
      }
      if (!c.observers) {
        c.observers = [Listener];
        c.observerSlots = [Listener.sources.length - 1];
      } else {
        c.observers.push(Listener);
        c.observerSlots.push(Listener.sources.length - 1);
      }
    }
    return c.value;
  };
  return getter;
}

function on(deps, fn, options) {
  var isArray = Array.isArray(deps);
  var defer = options && options.defer;
  var prevValues = isArray ? deps.map(function() { return undefined; }) : undefined;
  var first = true;
  return function(prev) {
    var values;
    if (isArray) {
      values = [];
      var i = 0;
      while (i < deps.length) { values.push(deps[i]()); i = i + 1; }
    } else {
      values = deps();
    }
    if (defer && first) { first = false; return prev; }
    var result = untrack(function() {
      return fn(values, prevValues, prev);
    });
    prevValues = values;
    return result;
  };
}

function onCleanup(fn) {
  if (Owner) {
    if (!Owner.cleanups) Owner.cleanups = [];
    Owner.cleanups.push(fn);
  }
}

function onMount(fn) {
  createEffect(function() {
    untrack(fn);
  });
}

function untrack(fn) {
  var prev = Listener;
  Listener = null;
  try {
    return fn();
  } finally {
    Listener = prev;
  }
}

function batch(fn) {
  return runUpdates(fn);
}

function runWithOwner(owner, fn) {
  var prev = Owner;
  Owner = owner;
  try {
    return fn();
  } finally {
    Owner = prev;
  }
}

function getOwner() {
  return Owner;
}

console.log("=== MiniJIT Reactive (Solid-style Signal) ===");
console.log("");

createRoot(function(dispose) {

  console.log("--- createSignal + createEffect ---");
  var [count, setCount] = createSignal(0);
  createEffect(function() { console.log("count is " + count()); });
  setCount(1);
  setCount(2);
  setCount(function(n) { return n + 1; });

  console.log("");
  console.log("--- custom equality ---");
  var [obj, setObj] = createSignal({ x: 1 }, {
    equals: function(a, b) { return a && b && a.x === b.x; }
  });
  var eqRuns = 0;
  createEffect(function() { eqRuns = eqRuns + 1; var v = obj(); });
  setObj({ x: 1 });
  console.log("same x=1: runs=" + eqRuns + " (should be 1)");
  setObj({ x: 2 });
  console.log("diff x=2: runs=" + eqRuns + " (should be 2)");

  console.log("");
  console.log("--- createMemo (lazy + cached) ---");
  var [a, setA] = createSignal(3);
  var [b, setB] = createSignal(4);
  var sumRuns = 0;
  var sum = createMemo(function() { sumRuns = sumRuns + 1; return a() + b(); });
  console.log("sum=" + sum() + " runs=" + sumRuns);
  console.log("cached=" + sum() + " runs=" + sumRuns);
  setA(10);
  console.log("a=10: sum=" + sum() + " runs=" + sumRuns);
  setB(20);
  console.log("b=20: sum=" + sum() + " runs=" + sumRuns);

  console.log("");
  console.log("--- diamond dependency ---");
  var [s, setS] = createSignal(1);
  var a2 = createMemo(function() { return s() * 2; });
  var b2 = createMemo(function() { return s() * 3; });
  var diamondRuns = 0;
  createEffect(function() {
    diamondRuns = diamondRuns + 1;
    console.log("diamond: a=" + a2() + " b=" + b2() + " runs=" + diamondRuns);
  });
  setS(2);
  console.log("diamond runs=" + diamondRuns + " (2=correct, no glitch)");

  console.log("");
  console.log("--- memo inside effect ---");
  var doubled = createMemo(function() { return count() * 2; });
  createEffect(function() { console.log("doubled=" + doubled()); });
  setCount(5);
  setCount(6);

  console.log("");
  console.log("--- on() explicit deps ---");
  var [x, setX] = createSignal(0);
  var [y, setY] = createSignal(0);
  createEffect(on(
    [x, y],
    function(values) { console.log("on: x=" + values[0] + " y=" + values[1]); },
    { defer: true }
  ));
  setX(1);
  setY(2);

  console.log("");
  console.log("--- onCleanup ---");
  var [show, setShow] = createSignal(true);
  createEffect(function() {
    if (show()) {
      console.log("mounted");
      onCleanup(function() { console.log("cleanup called"); });
    }
  });
  setShow(false);

  console.log("");
  console.log("--- batch ---");
  var [bx, setBx] = createSignal(0);
  var [by, setBy] = createSignal(0);
  var batchLogs = 0;
  createEffect(function() {
    batchLogs = batchLogs + 1;
    console.log("batch pos=(" + bx() + "," + by() + ")");
  });
  batch(function() { setBx(10); setBy(20); });
  console.log("logs=" + batchLogs + " (batch coalesced)");

  console.log("");
  console.log("--- untrack ---");
  var [hidden, setHidden] = createSignal("secret");
  var untrackRuns = 0;
  createEffect(function() {
    untrackRuns = untrackRuns + 1;
    console.log("untracked=" + untrack(function() { return hidden(); }));
  });
  setHidden("changed");
  console.log("runs=" + untrackRuns + " (still 1)");

  console.log("");
  console.log("--- runWithOwner ---");
  var savedOwner = getOwner();
  var laterDispose;
  runWithOwner(savedOwner, function() {
    var [v, setV] = createSignal(0);
    laterDispose = createEffect(function() { console.log("owned effect v=" + v()); });
    setV(1);
  });

  console.log("");
  console.log("--- nested ownership + dispose ---");
  var [nv, setNv] = createSignal(0);
  var outerStop = createEffect(function() {
    var val = nv();
    console.log("outer=" + val);
    if (val < 2) {
      createEffect(function() {
        console.log("  inner sees outer=" + nv());
      });
    }
  });
  setNv(1);
  setNv(5);

  console.log("");
  console.log("--- stop effect ---");
  var [cv, setCv] = createSignal(0);
  var cLogs = 0;
  var stopC = createEffect(function() { cLogs = cv(); });
  setCv(1);
  setCv(2);
  console.log("before stop: " + cLogs);
  stopC();
  setCv(999);
  console.log("after stop: " + cLogs + " (still 2)");

  dispose();
});

console.log("");
console.log("=== All demos complete ===");
