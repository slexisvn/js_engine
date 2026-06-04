import { tracer } from "../core/tracing/index.js";

export const DEP_MAP = "map";
export const DEP_ELEMENTS_KIND = "elements-kind";
export const DEP_CALL_TARGET = "call-target";
export const DEP_PROTO_VALIDITY = "proto-validity";

export function dependencyKey(kind, id, version = null) {
  return version === null || version === undefined
    ? `${kind}:${id}`
    : `${kind}:${id}:${version}`;
}

export class DependencyRegistry {
  constructor() {
    this.byKey = new Map();
    this.byFunction = new Map();
    this.lazyMarker = null;
  }

  bindLazyMarker(marker) {
    this.lazyMarker = marker;
  }

  register(compiledFn, dependencies) {
    this.unregister(compiledFn);
    const deps = normalizeDependencies(dependencies);
    compiledFn.optimizedDependencies = deps;
    this.byFunction.set(compiledFn, deps);
    for (const dep of deps) {
      const key = dependencyKey(dep.kind, dep.id, dep.version);
      if (!this.byKey.has(key)) this.byKey.set(key, new Set());
      this.byKey.get(key).add(compiledFn);
      tracer.log(
        "deopt",
        `Dependency registered: ${compiledFn.name || "<anonymous>"} -> ${key}`,
      );
    }
  }

  unregister(compiledFn) {
    const deps =
      this.byFunction.get(compiledFn) || compiledFn.optimizedDependencies || [];
    for (const dep of deps) {
      const key = dependencyKey(dep.kind, dep.id, dep.version);
      const fns = this.byKey.get(key);
      if (!fns) continue;
      fns.delete(compiledFn);
      if (fns.size === 0) this.byKey.delete(key);
    }
    this.byFunction.delete(compiledFn);
    compiledFn.optimizedDependencies = [];
  }

  invalidate(kind, id, version = null, reason = "dependency-invalidated") {
    const keys = [];
    if (version !== null && version !== undefined)
      keys.push(dependencyKey(kind, id, version));
    keys.push(dependencyKey(kind, id));
    const affected = new Set();
    for (const key of keys) {
      const fns = this.byKey.get(key);
      if (!fns) continue;
      for (const fn of fns) affected.add(fn);
    }
    for (const fn of affected) {
      if (!fn.optimizedCode) continue;
      if (this.lazyMarker) {
        this.lazyMarker.markForDeopt(fn, reason, { kind, id, version });
      } else {
        fn.pendingDependencyDeopt = {
          reason,
          kind,
          id,
          version,
          markedAt: Date.now(),
        };
      }
      tracer.log(
        "deopt",
        `Dependency invalidated: ${fn.name || "<anonymous>"} (${reason})`,
      );
    }
    return affected.size;
  }

  clear() {
    this.byKey.clear();
    this.byFunction.clear();
  }

  getSummary(compiledFn) {
    return normalizeDependencies(
      this.byFunction.get(compiledFn) || compiledFn.optimizedDependencies || [],
    );
  }
}

function normalizeDependencies(dependencies) {
  if (!dependencies) return [];
  const result = [];
  const seen = new Set();
  const source = Array.isArray(dependencies) ? dependencies : [...dependencies];
  for (const dep of source) {
    if (!dep || !dep.kind) continue;
    const key = dependencyKey(dep.kind, dep.id, dep.version);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ kind: dep.kind, id: dep.id, version: dep.version ?? null });
  }
  return result;
}

export const dependencyRegistry = new DependencyRegistry();
