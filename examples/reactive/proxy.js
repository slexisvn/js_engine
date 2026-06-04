var REACTIVE_FLAG = "__v_isReactive";
var RAW_FLAG = "__v_raw";
var SKIP_FLAG = "__v_skip";
var IS_REF_FLAG = "__v_isRef";
var ITERATE_KEY = Symbol ? Symbol("iterate") : "__v_iterate";
var activeEffect = null;
var effectStack = [];
var uid = 0;
var targetMap = [];
var reactiveMap = [];
var shouldTrack = true;
var pendingQueue = [];
var isFlushing = false;

function getTargetEntry(target) {
  var i = 0;
  while (i < targetMap.length) {
    if (targetMap[i].target === target) return targetMap[i];
    i = i + 1;
  }
  var entry = { target: target, keys: [] };
  targetMap.push(entry);
  return entry;
}

function getDepSet(target, key) {
  var entry = getTargetEntry(target);
  var i = 0;
  while (i < entry.keys.length) {
    if (entry.keys[i].key === key) return entry.keys[i].deps;
    i = i + 1;
  }
  var deps = [];
  entry.keys.push({ key: key, deps: deps });
  return deps;
}

function ReactiveEffect(fn, scheduler) {
  this.id = uid;
  uid = uid + 1;
  this.fn = fn;
  this.scheduler = scheduler;
  this.active = true;
  this.deps = [];
  this.allowRecurse = false;
}

ReactiveEffect.prototype.run = function() {
  if (!this.active) return this.fn();
  if (effectStack.indexOf(this) !== -1) return;
  try {
    effectStack.push(this);
    activeEffect = this;
    shouldTrack = true;
    cleanupEffect(this);
    return this.fn();
  } finally {
    effectStack.pop();
    activeEffect = effectStack.length > 0 ? effectStack[effectStack.length - 1] : null;
  }
};

ReactiveEffect.prototype.stop = function() {
  if (!this.active) return;
  cleanupEffect(this);
  this.active = false;
};

function cleanupEffect(effect) {
  var i = 0;
  while (i < effect.deps.length) {
    var dep = effect.deps[i];
    var idx = dep.indexOf(effect);
    if (idx >= 0) dep.splice(idx, 1);
    i = i + 1;
  }
  effect.deps.splice(0, effect.deps.length);
}

function track(target, key) {
  if (!activeEffect || !shouldTrack) return;
  var dep = getDepSet(target, key);
  if (dep.indexOf(activeEffect) === -1) {
    dep.push(activeEffect);
    activeEffect.deps.push(dep);
  }
}

function trigger(target, key) {
  var dep = getDepSet(target, key);
  var effects = dep.slice(0);
  var i = 0;
  while (i < effects.length) {
    var effect = effects[i];
    if (effect !== activeEffect || effect.allowRecurse) {
      if (effect.scheduler) {
        effect.scheduler(effect);
      } else {
        effect.run();
      }
    }
    i = i + 1;
  }
}

function pauseTracking() { shouldTrack = false; }
function enableTracking() { shouldTrack = true; }

function getCachedProxy(target) {
  var i = 0;
  while (i < reactiveMap.length) {
    if (reactiveMap[i].target === target) return reactiveMap[i].proxy;
    i = i + 1;
  }
  return null;
}

function cacheProxy(target, proxy) {
  reactiveMap.push({ target: target, proxy: proxy });
}

var arrayInstrumentations = {};

function createArrayInstrumentations() {
  var methods = ["includes", "indexOf", "lastIndexOf"];
  var i = 0;
  while (i < methods.length) {
    var method = methods[i];
    arrayInstrumentations[method] = method;
    i = i + 1;
  }
}
createArrayInstrumentations();

function createReactiveObject(target) {
  if (typeof target !== "object" || target === null) return target;
  if (target[REACTIVE_FLAG]) return target;
  if (target[SKIP_FLAG]) return target;

  var existing = getCachedProxy(target);
  if (existing) return existing;

  var proxy = new Proxy(target, {
    get: function(t, key, receiver) {
      if (key === REACTIVE_FLAG) return true;
      if (key === RAW_FLAG) return t;

      var targetIsArray = Array.isArray(t);

      if (targetIsArray && arrayInstrumentations[key] !== undefined) {
        track(t, key);
        var val = t[key];
        return val;
      }

      track(t, key);
      var result = t[key];

      if (typeof result === "object" && result !== null) {
        return reactive(result);
      }
      return result;
    },
    set: function(t, key, value, receiver) {
      var oldValue = t[key];
      var hadKey = key in t;
      var targetIsArray = Array.isArray(t);

      t[key] = value;

      if (oldValue !== value) {
        trigger(t, key);
        if (!hadKey) {
          trigger(t, ITERATE_KEY);
          if (targetIsArray) trigger(t, "length");
        }
      }
      return true;
    },
    deleteProperty: function(t, key) {
      var hadKey = key in t;
      var targetIsArray = Array.isArray(t);
      delete t[key];
      if (hadKey) {
        trigger(t, key);
        trigger(t, ITERATE_KEY);
        if (targetIsArray) trigger(t, "length");
      }
      return true;
    },
    has: function(t, key) {
      track(t, key);
      return key in t;
    },
    ownKeys: function(t) {
      track(t, ITERATE_KEY);
      return Object.keys(t);
    }
  });

  cacheProxy(target, proxy);
  return proxy;
}

function reactive(target) {
  return createReactiveObject(target);
}

function toRaw(observed) {
  var raw = observed && observed[RAW_FLAG];
  return raw ? toRaw(raw) : observed;
}

function markRaw(obj) {
  Object.defineProperty(obj, SKIP_FLAG, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false
  });
  return obj;
}

function isReactive(value) {
  return !!(value && value[REACTIVE_FLAG]);
}

function ref(value) {
  if (value && value[IS_REF_FLAG]) return value;
  var r = { _value: value };
  Object.defineProperty(r, IS_REF_FLAG, {
    value: true,
    enumerable: false
  });
  Object.defineProperty(r, "value", {
    get: function() {
      track(r, "value");
      return r._value;
    },
    set: function(newVal) {
      if (newVal === r._value) return;
      r._value = newVal;
      trigger(r, "value");
    },
    enumerable: true,
    configurable: true
  });
  return r;
}

function isRef(r) {
  return !!(r && r[IS_REF_FLAG]);
}

function unref(r) {
  return isRef(r) ? r.value : r;
}

function toRef(object, key) {
  var r = {};
  Object.defineProperty(r, IS_REF_FLAG, { value: true, enumerable: false });
  Object.defineProperty(r, "value", {
    get: function() { return object[key]; },
    set: function(v) { object[key] = v; },
    enumerable: true,
    configurable: true
  });
  return r;
}

function toRefs(object) {
  var ret = {};
  var keys = Object.keys(object);
  var i = 0;
  while (i < keys.length) {
    ret[keys[i]] = toRef(object, keys[i]);
    i = i + 1;
  }
  return ret;
}

function effect(fn, options) {
  var e = new ReactiveEffect(fn);
  if (options && options.scheduler) e.scheduler = options.scheduler;
  e.run();
  var runner = function() { return e.run(); };
  runner.effect = e;
  return runner;
}

function stop(runner) {
  runner.effect.stop();
}

function ComputedRefImpl(getter) {
  this._value = undefined;
  this._dirty = true;
  var self = this;
  this.effect = new ReactiveEffect(getter, function() {
    if (!self._dirty) {
      self._dirty = true;
      trigger(self, "value");
    }
  });
}

ComputedRefImpl.prototype._get = function() {
  if (this._dirty) {
    this._value = this.effect.run();
    this._dirty = false;
  }
  track(this, "value");
  return this._value;
};

function computed(getter) {
  var c = new ComputedRefImpl(getter);
  var obj = {};
  Object.defineProperty(obj, IS_REF_FLAG, { value: true, enumerable: false });
  Object.defineProperty(obj, "value", {
    get: function() { return c._get(); },
    enumerable: true,
    configurable: true
  });
  obj._computed = c;
  return obj;
}

function queueJob(job) {
  if (pendingQueue.indexOf(job) === -1) pendingQueue.push(job);
  if (!isFlushing) flushJobs();
}

function flushJobs() {
  isFlushing = true;
  var q = pendingQueue;
  pendingQueue = [];
  q.sort(function(a, b) { return a.id - b.id; });
  var i = 0;
  while (i < q.length) {
    q[i]();
    i = i + 1;
  }
  isFlushing = false;
}

function watchEffect(fn) {
  var e = new ReactiveEffect(fn);
  e.run();
  return function() { e.stop(); };
}

function watch(source, cb, options) {
  var getter;
  if (typeof source === "function") {
    getter = source;
  } else if (isRef(source)) {
    getter = function() { return source.value; };
  } else {
    getter = function() { return source; };
  }

  var oldValue;
  var first = true;
  var job = function() {
    if (!e.active) return;
    var newValue = e.run();
    if (!first && newValue !== oldValue) {
      cb(newValue, oldValue);
    }
    oldValue = newValue;
    first = false;
  };
  job.id = uid;
  uid = uid + 1;

  var scheduler = options && options.flush === "sync"
    ? function() { job(); }
    : function() { queueJob(job); };

  var e = new ReactiveEffect(getter, scheduler);
  oldValue = e.run();
  first = false;

  return function() { e.stop(); };
}

console.log("=== MiniJIT Reactive (Vue 3 Proxy-style) ===");
console.log("");

console.log("--- reactive + watchEffect ---");
var state = reactive({ count: 0 });
var stopCount = watchEffect(function() { console.log("count is " + state.count); });
state.count = 1;
state.count = 2;

console.log("");
console.log("--- ref ---");
var count = ref(0);
var stopRef = watchEffect(function() { console.log("ref count = " + count.value); });
count.value = 10;
count.value = 20;

console.log("");
console.log("--- computed (ComputedRefImpl) ---");
var nums = reactive({ a: 3, b: 4 });
var sumRuns = 0;
var sum = computed(function() { sumRuns = sumRuns + 1; return nums.a + nums.b; });
console.log("before read: runs=" + sumRuns);
console.log("sum=" + sum.value + " runs=" + sumRuns);
console.log("cached=" + sum.value + " runs=" + sumRuns);
nums.a = 10;
console.log("a=10 sum=" + sum.value);
nums.b = 20;
console.log("b=20 sum=" + sum.value);

console.log("");
console.log("--- computed chain ---");
var base = reactive({ x: 2 });
var doubled = computed(function() { return base.x * 2; });
var stopD = watchEffect(function() { console.log("doubled=" + doubled.value); });
base.x = 5;
base.x = 10;

console.log("");
console.log("--- watch (source fn + callback) ---");
var pet = reactive({ name: "Rex" });
var unwatchPet = watch(
  function() { return pet.name; },
  function(n, o) { console.log("name: " + o + " -> " + n); }
);
pet.name = "Max";
pet.name = "Buddy";

console.log("");
console.log("--- watch ref ---");
var score = ref(0);
var unwatchScore = watch(
  score,
  function(n, o) { console.log("score: " + o + " -> " + n); }
);
score.value = 100;
score.value = 200;

console.log("");
console.log("--- nested reactive + proxy cache ---");
var user = reactive({ name: "Alice", address: { city: "Hanoi" } });
console.log("isReactive=" + isReactive(user));
console.log("same proxy=" + (reactive(user) === user));
var stopUser = watchEffect(function() { console.log(user.name + " in " + user.address.city); });
user.address.city = "HCMC";
user.name = "Bob";

console.log("");
console.log("--- toRaw / markRaw ---");
var raw = { x: 1 };
var r = reactive(raw);
console.log("toRaw works=" + (toRaw(r) === raw));
var frozen = markRaw({ y: 2 });
var r2 = reactive(frozen);
console.log("markRaw skips proxy=" + (r2 === frozen));

console.log("");
console.log("--- toRef / toRefs ---");
var obj = reactive({ a: 1, b: 2 });
var aRef = toRef(obj, "a");
console.log("toRef.value=" + aRef.value);
obj.a = 10;
console.log("after obj.a=10: toRef.value=" + aRef.value);
aRef.value = 99;
console.log("after ref=99: obj.a=" + obj.a);
var refs = toRefs(obj);
console.log("toRefs.b.value=" + refs.b.value);

console.log("");
console.log("--- new property + delete via proxy ---");
var flags = reactive({});
var stopFlags = watchEffect(function() { console.log("ready=" + ("ready" in flags)); });
flags.ready = true;
delete flags.ready;

console.log("");
console.log("--- effect cleanup (dep cleanup on re-run) ---");
var cond = reactive({ show: true, a: 1, b: 2 });
var branchRuns = 0;
var stopBranch = watchEffect(function() {
  branchRuns = branchRuns + 1;
  if (cond.show) {
    console.log("branch A: a=" + cond.a);
  } else {
    console.log("branch B: b=" + cond.b);
  }
});
cond.a = 10;
cond.show = false;
cond.a = 99;
console.log("a=99 should NOT trigger (cleaned dep). runs=" + branchRuns);
cond.b = 77;
console.log("b=77 should trigger. runs=" + branchRuns);

console.log("");
console.log("--- stop effect ---");
var c = reactive({ v: 0 });
var cLogs = 0;
var stopC = watchEffect(function() { cLogs = c.v; });
c.v = 1;
c.v = 2;
console.log("before stop: " + cLogs);
stopC();
c.v = 999;
console.log("after stop: " + cLogs + " (still 2)");

console.log("");
console.log("--- effect runner ---");
var val = reactive({ x: 0 });
var runner = effect(function() { return val.x; });
console.log("runner()=" + runner());
val.x = 42;
console.log("after x=42 runner()=" + runner());
stop(runner);
val.x = 100;
console.log("after stop runner()=" + runner() + " (still 42? no, fn still runs but no tracking)");

console.log("");
console.log("=== All demos complete ===");
