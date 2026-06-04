var uid = 0;
var Dep_target = null;
var targetStack = [];

function pushTarget(target) {
  targetStack.push(target);
  Dep_target = target;
}

function popTarget() {
  targetStack.pop();
  Dep_target = targetStack.length > 0 ? targetStack[targetStack.length - 1] : null;
}

function Dep() {
  this.id = uid;
  uid = uid + 1;
  this.subs = [];
}

Dep.prototype.addSub = function(sub) {
  if (this.subs.indexOf(sub) === -1) this.subs.push(sub);
};

Dep.prototype.removeSub = function(sub) {
  var idx = this.subs.indexOf(sub);
  if (idx >= 0) this.subs.splice(idx, 1);
};

Dep.prototype.depend = function() {
  if (Dep_target) Dep_target.addDep(this);
};

Dep.prototype.notify = function() {
  var subs = this.subs.slice(0);
  var i = 0;
  while (i < subs.length) {
    subs[i].update();
    i = i + 1;
  }
  scheduleFlush();
};

function def(obj, key, val) {
  Object.defineProperty(obj, key, {
    value: val,
    enumerable: false,
    writable: true,
    configurable: true
  });
}

function Observer(value) {
  this.value = value;
  this.dep = new Dep();
  def(value, "__ob__", this);
  if (Array.isArray(value)) {
    this.observeArray(value);
  } else {
    this.walk(value);
  }
}

Observer.prototype.walk = function(obj) {
  var keys = Object.keys(obj);
  var i = 0;
  while (i < keys.length) {
    defineReactive(obj, keys[i]);
    i = i + 1;
  }
};

Observer.prototype.observeArray = function(items) {
  var i = 0;
  while (i < items.length) {
    observe(items[i]);
    i = i + 1;
  }
};

function observe(value) {
  if (value === null || typeof value !== "object") return;
  if (value.__ob__) return value.__ob__;
  return new Observer(value);
}

function defineReactive(obj, key, val) {
  var dep = new Dep();
  if (val === undefined) val = obj[key];
  var childOb = observe(val);

  Object.defineProperty(obj, key, {
    enumerable: true,
    configurable: true,
    get: function() {
      if (Dep_target) {
        dep.depend();
        if (childOb) childOb.dep.depend();
      }
      return val;
    },
    set: function(newVal) {
      if (newVal === val) return;
      val = newVal;
      childOb = observe(newVal);
      dep.notify();
    }
  });
}

var queue = [];
var hasIds = [];
var waiting = false;
var flushing = false;

var flushDepth = 0;

function queueWatcher(watcher) {
  if (hasIds.indexOf(watcher.id) !== -1) return;
  hasIds.push(watcher.id);
  queue.push(watcher);
}

function flushSchedulerQueue() {
  if (flushing) return;
  flushing = true;
  queue.sort(function(a, b) { return a.id - b.id; });
  var i = 0;
  while (i < queue.length) {
    var watcher = queue[i];
    hasIds.splice(hasIds.indexOf(watcher.id), 1);
    watcher.run();
    i = i + 1;
  }
  queue = [];
  hasIds = [];
  flushing = false;
}

function scheduleFlush() {
  if (flushDepth > 0) return;
  flushSchedulerQueue();
}

var watcherUid = 0;

function Watcher(getter, cb, options) {
  this.id = watcherUid;
  watcherUid = watcherUid + 1;
  this.getter = getter;
  this.cb = cb;
  this.active = true;
  this.lazy = options && !!options.lazy;
  this.sync = options && !!options.sync;
  this.dirty = this.lazy;
  this.deps = [];
  this.newDeps = [];
  this.depIds = [];
  this.newDepIds = [];
  this.value = this.lazy ? undefined : this.get();
}

Watcher.prototype.get = function() {
  pushTarget(this);
  var value = this.getter();
  popTarget();
  this.cleanupDeps();
  return value;
};

Watcher.prototype.addDep = function(dep) {
  var id = dep.id;
  if (this.newDepIds.indexOf(id) === -1) {
    this.newDepIds.push(id);
    this.newDeps.push(dep);
    if (this.depIds.indexOf(id) === -1) dep.addSub(this);
  }
};

Watcher.prototype.cleanupDeps = function() {
  var i = 0;
  while (i < this.deps.length) {
    var dep = this.deps[i];
    if (this.newDepIds.indexOf(dep.id) === -1) dep.removeSub(this);
    i = i + 1;
  }
  var tmp = this.depIds;
  this.depIds = this.newDepIds;
  this.newDepIds = tmp;
  this.newDepIds.splice(0, this.newDepIds.length);
  tmp = this.deps;
  this.deps = this.newDeps;
  this.newDeps = tmp;
  this.newDeps.splice(0, this.newDeps.length);
};

Watcher.prototype.update = function() {
  if (this.lazy) {
    this.dirty = true;
  } else if (this.sync) {
    this.run();
  } else {
    queueWatcher(this);
  }
};

Watcher.prototype.run = function() {
  if (!this.active) return;
  var value = this.get();
  if (value !== this.value || typeof value === "object") {
    var oldValue = this.value;
    this.value = value;
    if (this.cb) this.cb(value, oldValue);
  }
};

Watcher.prototype.evaluate = function() {
  this.value = this.get();
  this.dirty = false;
};

Watcher.prototype.depend = function() {
  var i = 0;
  while (i < this.deps.length) {
    this.deps[i].depend();
    i = i + 1;
  }
};

Watcher.prototype.teardown = function() {
  if (!this.active) return;
  this.active = false;
  var i = 0;
  while (i < this.deps.length) {
    this.deps[i].removeSub(this);
    i = i + 1;
  }
};

function reactive(obj) {
  observe(obj);
  return obj;
}

function Vue_set(target, key, val) {
  if (key in target) { target[key] = val; return val; }
  var ob = target.__ob__;
  flushDepth = flushDepth + 1;
  defineReactive(target, key, val);
  if (ob) ob.dep.notify();
  flushDepth = flushDepth - 1;
  scheduleFlush();
  return val;
}

function Vue_delete(target, key) {
  if (!(key in target)) return;
  target[key] = undefined;
  var ob = target.__ob__;
  flushDepth = flushDepth + 1;
  if (ob) ob.dep.notify();
  flushDepth = flushDepth - 1;
  scheduleFlush();
}

function effect(fn) {
  var w = new Watcher(fn, null);
  return function() { w.teardown(); };
}

function computed(getter) {
  var w = new Watcher(getter, null, { lazy: true });
  var obj = {};
  Object.defineProperty(obj, "value", {
    get: function() {
      if (w.dirty) w.evaluate();
      if (Dep_target) w.depend();
      return w.value;
    },
    enumerable: true,
    configurable: true
  });
  return obj;
}

function watch(source, cb) {
  var w = new Watcher(source, cb);
  return function() { w.teardown(); };
}

console.log("=== MiniJIT Reactive (Vue 2 Accessor-style) ===");
console.log("");

console.log("--- reactive + effect ---");
var state = reactive({ count: 0 });
var stopCount = effect(function() { console.log("count is " + state.count); });
state.count = 1;
state.count = 2;

console.log("");
console.log("--- lazy computed ---");
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
var stopD = effect(function() { console.log("doubled=" + doubled.value); });
base.x = 5;
base.x = 10;

console.log("");
console.log("--- watch callback ---");
var pet = reactive({ name: "Rex" });
var unwatchPet = watch(
  function() { return pet.name; },
  function(n, o) { console.log("name: " + o + " -> " + n); }
);
pet.name = "Max";
pet.name = "Buddy";

console.log("");
console.log("--- nested reactive + __ob__ ---");
var user = reactive({ name: "Alice", address: { city: "Hanoi" } });
console.log("has __ob__: " + (user.__ob__ !== undefined));
console.log("nested __ob__: " + (user.address.__ob__ !== undefined));
var stopUser = effect(function() { console.log(user.name + " in " + user.address.city); });
user.address.city = "HCMC";
user.name = "Bob";

console.log("");
console.log("--- Vue.set / Vue.delete ---");
var bag = reactive({ a: 1 });
var stopBag = effect(function() {
  var k = Object.keys(bag).filter(function(x) { return bag[x] !== undefined; });
  console.log("bag keys=" + k.join(","));
});
Vue_set(bag, "b", 2);
console.log("after set:");
Vue_delete(bag, "a");
console.log("after delete:");

console.log("");
console.log("--- dep cleanup (conditional branch) ---");
var cond = reactive({ show: true, a: 1, b: 2 });
var branchRuns = 0;
var stopBranch = effect(function() {
  branchRuns = branchRuns + 1;
  if (cond.show) {
    console.log("branch A: a=" + cond.a);
  } else {
    console.log("branch B: b=" + cond.b);
  }
});
cond.a = 10;
console.log("runs after a=10: " + branchRuns);
cond.show = false;
console.log("runs after show=false: " + branchRuns);
cond.a = 99;
console.log("runs after a=99 (stale dep cleaned): " + branchRuns);
cond.b = 77;
console.log("runs after b=77 (new dep active): " + branchRuns);

console.log("");
console.log("--- teardown ---");
var c = reactive({ v: 0 });
var cLogs = 0;
var stopC = effect(function() { cLogs = c.v; });
c.v = 1;
c.v = 2;
console.log("before teardown: " + cLogs);
stopC();
c.v = 999;
console.log("after teardown: " + cLogs + " (still 2)");

console.log("");
console.log("=== All demos complete ===");
