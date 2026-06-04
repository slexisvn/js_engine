import { tracer } from "../../core/tracing/index.js";
import {
  dependencyRegistry,
  DEP_MAP,
  DEP_PROTO_VALIDITY,
} from "../../deopt/dependencies.js";

let nextHiddenClassId = 0;

const TRANSITION_ADD = "add";
const TRANSITION_DELETE = "delete";
const TRANSITION_RECONFIGURE = "reconfigure";
const TRANSITION_INTEGRITY = "integrity";

const INTEGRITY_NONE = "none";
const INTEGRITY_PREVENTEXTENSIONS = "preventExtensions";
const INTEGRITY_SEALED = "sealed";
const INTEGRITY_FROZEN = "frozen";

const MAX_TRANSITIONS_BEFORE_UNSTABLE = 32;
const MAX_DEPRECATIONS_BEFORE_FREEZE = 5;

const allHiddenClasses = new Map();
const deprecatedMaps = new Map();
const migrationTargetCache = new Map();

export class PropertyDescriptor {
  constructor(offset, kind, writable, enumerable, configurable) {
    this.offset = offset;
    this.kind = kind;
    this.writable = writable;
    this.enumerable = enumerable;
    this.configurable = configurable;
  }

  clone() {
    return new PropertyDescriptor(
      this.offset,
      this.kind,
      this.writable,
      this.enumerable,
      this.configurable,
    );
  }

  equals(other) {
    return (
      this.offset === other.offset &&
      this.kind === other.kind &&
      this.writable === other.writable &&
      this.enumerable === other.enumerable &&
      this.configurable === other.configurable
    );
  }
}

export class DescriptorArray {
  constructor(entries) {
    this.entries = entries ? new Map(entries) : new Map();
    this.version = 0;
  }

  clone() {
    const entries = [];
    for (const [key, desc] of this.entries) {
      entries.push([key, desc.clone()]);
    }
    const descriptors = new DescriptorArray(entries);
    descriptors.version = this.version;
    return descriptors;
  }

  get(name) {
    return this.entries.get(name) || null;
  }

  set(name, descriptor) {
    this.entries.set(name, descriptor);
    this.version++;
  }

  delete(name) {
    const deleted = this.entries.delete(name);
    if (deleted) this.version++;
    return deleted;
  }

  has(name) {
    return this.entries.has(name);
  }

  keys() {
    return [...this.entries.keys()];
  }

  [Symbol.iterator]() {
    return this.entries[Symbol.iterator]();
  }

  get size() {
    return this.entries.size;
  }
}

export class HiddenClass {
  constructor(parent, transitionType, transitionKey, offset) {
    this.id = nextHiddenClassId++;
    this.parent = parent;
    this.transitions = new Map();
    this.deleteTransitions = new Map();
    this.integrityTransitions = new Map();
    this.reconfigureTransitions = new Map();
    this.isStable = true;
    this.integrityLevel = INTEGRITY_NONE;
    this.objectCount = 0;
    this.totalTransitionCount = 0;
    this.transitionType = transitionType;
    this.transitionKey = transitionKey;

    this.instanceType = null;
    this.isDeprecated = false;
    this.migrationTarget = null;
    this.deprecationCount = 0;
    this.version = 0;
    this.prototypeValidityCell = { version: 0 };

    this.descriptors = new DescriptorArray();
    this.properties = this.descriptors.entries;
    if (parent) {
      this.descriptors = parent.descriptors.clone();
      this.properties = this.descriptors.entries;
      if (transitionType === TRANSITION_ADD && transitionKey !== null) {
        this.descriptors.set(
          transitionKey,
          new PropertyDescriptor(offset, "data", true, true, true),
        );
      } else if (
        transitionType === TRANSITION_DELETE &&
        transitionKey !== null
      ) {
        this.descriptors.delete(transitionKey);
      }
      this.integrityLevel = parent.integrityLevel;
      this.prototypeValidityCell = parent.prototypeValidityCell;
    }
    this.propertyCount = this.properties.size;
    allHiddenClasses.set(this.id, this);
  }

  incrementObjectCount() {
    this.objectCount++;
  }

  decrementObjectCount() {
    if (this.objectCount > 0) this.objectCount--;
  }

  markUnstable() {
    this.isStable = false;
    this.version++;
  }

  invalidate(reason) {
    const oldVersion = this.version;
    const oldProtoVersion = this.prototypeValidityCell.version;
    this.version++;
    this.prototypeValidityCell.version++;
    this.isStable = false;
    dependencyRegistry.invalidate(DEP_MAP, this.id, oldVersion, reason);
    dependencyRegistry.invalidate(
      DEP_PROTO_VALIDITY,
      this.id,
      oldProtoVersion,
      reason,
    );
    tracer.log("hidden-class", `HC${this.id} invalidated (${reason})`);
  }

  deprecate(reason) {
    if (this.isDeprecated) return this.migrationTarget;

    this.isDeprecated = true;
    this.isStable = false;

    const target = this._buildMigrationTarget();
    this.migrationTarget = target;

    deprecatedMaps.set(this.id, target);
    tracer.log(
      "hidden-class",
      `HC${this.id} deprecated (${reason}) → migrate to HC${target.id}`,
    );

    return target;
  }

  _buildMigrationTarget() {
    // Build a cache key from property descriptors
    const keyParts = [];
    for (const [name, desc] of this.properties) {
      keyParts.push(
        `${name}:${desc.kind}:${desc.writable}:${desc.enumerable}:${desc.configurable}`,
      );
    }
    keyParts.push(`integrity:${this.integrityLevel}`);
    const cacheKey = keyParts.join("|");

    // Check cache for existing migration target with same property set
    const cached = migrationTargetCache.get(cacheKey);
    if (cached) return cached;

    let target = new HiddenClass(null, null, null, 0);
    allHiddenClasses.set(target.id, target);

    for (const [name, desc] of this.properties) {
      const next = new HiddenClass(
        target,
        TRANSITION_ADD,
        name,
        target.propertyCount,
      );
      const newDesc = next.descriptors.get(name);
      newDesc.kind = desc.kind;
      newDesc.writable = desc.writable;
      newDesc.enumerable = desc.enumerable;
      newDesc.configurable = desc.configurable;
      target.transitions.set(name, next);
      target = next;
    }

    target.integrityLevel = this.integrityLevel;

    // Cache for future reuse
    migrationTargetCache.set(cacheKey, target);
    return target;
  }

  getMigrationTarget() {
    if (!this.isDeprecated) return null;
    return this.migrationTarget;
  }

  tryDeprecate() {
    if (this.isDeprecated) return true;
    if (this.isStable) return false;

    this.deprecationCount++;
    if (this.deprecationCount >= MAX_DEPRECATIONS_BEFORE_FREEZE) {
      this.deprecate("too-many-transitions");
      return true;
    }
    return false;
  }

  checkStability() {
    this.totalTransitionCount++;
    if (this.totalTransitionCount > MAX_TRANSITIONS_BEFORE_UNSTABLE) {
      this.isStable = false;
      if (
        this.totalTransitionCount > MAX_TRANSITIONS_BEFORE_UNSTABLE * 2 &&
        !this.isDeprecated
      ) {
        this.deprecate("excessive-transitions");
      }
    }
  }

  transition(propertyName) {
    if (this.integrityLevel !== INTEGRITY_NONE) {
      return null;
    }

    if (this.transitions.has(propertyName)) {
      return this.transitions.get(propertyName);
    }

    const newClass = new HiddenClass(
      this,
      TRANSITION_ADD,
      propertyName,
      this.propertyCount,
    );
    this.transitions.set(propertyName, newClass);
    this.markUnstable();
    this.checkStability();

    tracer.hcTransition(this.id, newClass.id, propertyName);

    return newClass;
  }

  transitionWithAttributes(
    propertyName,
    kind,
    writable,
    enumerable,
    configurable,
  ) {
    if (this.integrityLevel !== INTEGRITY_NONE) {
      return null;
    }

    const attrKey = `${propertyName}|${kind}|${writable}|${enumerable}|${configurable}`;

    if (this.reconfigureTransitions.has(attrKey)) {
      return this.reconfigureTransitions.get(attrKey);
    }

    const existing = this.properties.get(propertyName);
    let newClass;

    if (existing) {
      newClass = new HiddenClass(
        this,
        TRANSITION_RECONFIGURE,
        propertyName,
        existing.offset,
      );
      const desc = newClass.descriptors.get(propertyName);
      desc.kind = kind;
      desc.writable = writable;
      desc.enumerable = enumerable;
      desc.configurable = configurable;
    } else {
      newClass = new HiddenClass(
        this,
        TRANSITION_ADD,
        propertyName,
        this.propertyCount,
      );
      const desc = newClass.descriptors.get(propertyName);
      desc.kind = kind;
      desc.writable = writable;
      desc.enumerable = enumerable;
      desc.configurable = configurable;
    }

    this.reconfigureTransitions.set(attrKey, newClass);
    this.invalidate(`reconfigure:${propertyName}`);
    this.checkStability();

    tracer.hcTransition(this.id, newClass.id, `${propertyName}[${attrKey}]`);

    return newClass;
  }

  deleteProperty(propertyName) {
    if (!this.properties.has(propertyName)) {
      return this;
    }

    const desc = this.properties.get(propertyName);
    if (!desc.configurable) {
      return null;
    }

    if (this.deleteTransitions.has(propertyName)) {
      return this.deleteTransitions.get(propertyName);
    }

    const newClass = new HiddenClass(this, TRANSITION_DELETE, propertyName, 0);

    let nextOffset = 0;
    for (const [key, d] of newClass.properties) {
      d.offset = nextOffset++;
      newClass.properties.set(key, d);
    }
    newClass.propertyCount = newClass.properties.size;

    this.deleteTransitions.set(propertyName, newClass);
    this.invalidate(`delete:${propertyName}`);
    this.checkStability();

    tracer.hcTransition(this.id, newClass.id, `delete:${propertyName}`);

    return newClass;
  }

  transitionToPreventExtensions() {
    if (this.integrityLevel !== INTEGRITY_NONE) {
      return this;
    }

    if (this.integrityTransitions.has(INTEGRITY_PREVENTEXTENSIONS)) {
      return this.integrityTransitions.get(INTEGRITY_PREVENTEXTENSIONS);
    }

    const newClass = new HiddenClass(
      this,
      TRANSITION_INTEGRITY,
      INTEGRITY_PREVENTEXTENSIONS,
      0,
    );
    newClass.integrityLevel = INTEGRITY_PREVENTEXTENSIONS;
    this.integrityTransitions.set(INTEGRITY_PREVENTEXTENSIONS, newClass);
    this.invalidate(INTEGRITY_PREVENTEXTENSIONS);
    this.checkStability();

    return newClass;
  }

  transitionToSealed() {
    let base = this;
    if (base.integrityLevel === INTEGRITY_NONE) {
      base = base.transitionToPreventExtensions();
    }

    if (base.integrityTransitions.has(INTEGRITY_SEALED)) {
      return base.integrityTransitions.get(INTEGRITY_SEALED);
    }

    const newClass = new HiddenClass(
      base,
      TRANSITION_INTEGRITY,
      INTEGRITY_SEALED,
      0,
    );
    newClass.integrityLevel = INTEGRITY_SEALED;
    for (const [key, desc] of newClass.properties) {
      desc.configurable = false;
    }
    base.integrityTransitions.set(INTEGRITY_SEALED, newClass);
    base.invalidate(INTEGRITY_SEALED);
    base.checkStability();

    return newClass;
  }

  transitionToFrozen() {
    let base = this;
    if (base.integrityLevel === INTEGRITY_NONE) {
      base = base.transitionToPreventExtensions();
    }
    if (base.integrityLevel === INTEGRITY_PREVENTEXTENSIONS) {
      base = base.transitionToSealed();
    }

    if (base.integrityTransitions.has(INTEGRITY_FROZEN)) {
      return base.integrityTransitions.get(INTEGRITY_FROZEN);
    }

    const newClass = new HiddenClass(
      base,
      TRANSITION_INTEGRITY,
      INTEGRITY_FROZEN,
      0,
    );
    newClass.integrityLevel = INTEGRITY_FROZEN;
    for (const [key, desc] of newClass.properties) {
      desc.configurable = false;
      if (desc.kind === "data") {
        desc.writable = false;
      }
    }
    base.integrityTransitions.set(INTEGRITY_FROZEN, newClass);
    base.invalidate(INTEGRITY_FROZEN);
    base.checkStability();

    return newClass;
  }

  lookupProperty(name) {
    const desc = this.descriptors.get(name);
    if (desc) return desc;
    return null;
  }

  hasProperty(name) {
    return this.descriptors.has(name);
  }

  getPropertyNames() {
    return this.descriptors.keys();
  }

  getEnumerablePropertyNames() {
    const result = [];
    for (const [key, desc] of this.properties) {
      if (desc.enumerable) result.push(key);
    }
    return result;
  }

  getTransitionPath() {
    const path = [];
    let current = this;
    while (current.parent) {
      path.push(current.transitionKey);
      current = current.parent;
    }
    path.reverse();
    return path;
  }

  getTransitionMetadataPath() {
    const path = [];
    let current = this;
    while (current.parent) {
      path.push({
        type: current.transitionType,
        key: current.transitionKey,
        fromId: current.parent.id,
        toId: current.id,
      });
      current = current.parent;
    }
    path.reverse();
    return path;
  }

  getBackPointerChain() {
    const chain = [];
    let current = this;
    while (current) {
      chain.push(current);
      current = current.parent;
    }
    chain.reverse();
    return chain;
  }

  getRoot() {
    let current = this;
    while (current.parent) {
      current = current.parent;
    }
    return current;
  }

  collectTransitionTree(depth) {
    const maxDepth = depth !== undefined ? depth : 100;
    const lines = [];
    this._buildTreeLines(lines, "", true, 0, maxDepth);
    return lines.join("\n");
  }

  _buildTreeLines(lines, prefix, isLast, currentDepth, maxDepth) {
    const connector = currentDepth === 0 ? "" : isLast ? "└── " : "├── ";
    const label = this.transitionKey
      ? `${this.transitionType}:"${this.transitionKey}" → HC${this.id}[${this.propertyCount} props, ${this.objectCount} objs]`
      : `HC${this.id}[root, ${this.propertyCount} props, ${this.objectCount} objs]`;

    lines.push(`${prefix}${connector}${label}`);

    if (currentDepth >= maxDepth) return;

    const children = [];
    for (const [key, child] of this.transitions) {
      children.push(child);
    }
    for (const [key, child] of this.deleteTransitions) {
      children.push(child);
    }
    for (const [key, child] of this.integrityTransitions) {
      children.push(child);
    }
    for (const [key, child] of this.reconfigureTransitions) {
      children.push(child);
    }

    const childPrefix =
      currentDepth === 0 ? "" : prefix + (isLast ? "    " : "│   ");
    for (let i = 0; i < children.length; i++) {
      children[i]._buildTreeLines(
        lines,
        childPrefix,
        i === children.length - 1,
        currentDepth + 1,
        maxDepth,
      );
    }
  }

  toString() {
    const props = [];
    for (const [name, desc] of this.properties) {
      const attrs = [];
      if (!desc.writable) attrs.push("ro");
      if (!desc.enumerable) attrs.push("noEnum");
      if (!desc.configurable) attrs.push("noCfg");
      if (desc.kind === "accessor") attrs.push("acc");
      const attrStr = attrs.length > 0 ? `(${attrs.join(",")})` : "";
      props.push(`${name}@${desc.offset}${attrStr}`);
    }
    const stability = this.isDeprecated
      ? "DEPRECATED"
      : this.isStable
        ? "stable"
        : "UNSTABLE";
    const integrity =
      this.integrityLevel !== INTEGRITY_NONE ? `,${this.integrityLevel}` : "";
    const migration = this.migrationTarget
      ? `,→HC${this.migrationTarget.id}`
      : "";
    return `HC${this.id}{${props.join(", ")}|${stability}${integrity}${migration}|objs:${this.objectCount}}`;
  }

  dump() {
    const lines = [];
    lines.push(`=== HiddenClass HC${this.id} ===`);
    lines.push(`  Stable: ${this.isStable}`);
    lines.push(`  Deprecated: ${this.isDeprecated}`);
    if (this.migrationTarget) {
      lines.push(`  Migration target: HC${this.migrationTarget.id}`);
    }
    lines.push(`  Integrity: ${this.integrityLevel}`);
    lines.push(`  Object count: ${this.objectCount}`);
    lines.push(`  Total transitions fired: ${this.totalTransitionCount}`);
    lines.push(`  Property count: ${this.propertyCount}`);
    lines.push(`  Properties:`);
    for (const [name, desc] of this.properties) {
      lines.push(
        `    ${name}: offset=${desc.offset}, kind=${desc.kind}, writable=${desc.writable}, enumerable=${desc.enumerable}, configurable=${desc.configurable}`,
      );
    }
    lines.push(
      `  Add transitions: [${[...this.transitions.keys()].join(", ")}]`,
    );
    lines.push(
      `  Delete transitions: [${[...this.deleteTransitions.keys()].join(", ")}]`,
    );
    lines.push(
      `  Integrity transitions: [${[...this.integrityTransitions.keys()].join(", ")}]`,
    );
    lines.push(
      `  Reconfigure transitions: [${[...this.reconfigureTransitions.keys()].join(", ")}]`,
    );
    if (this.parent) {
      lines.push(`  Parent: HC${this.parent.id}`);
      lines.push(
        `  Transition: ${this.transitionType} "${this.transitionKey}"`,
      );
    } else {
      lines.push(`  Parent: none (root)`);
    }
    lines.push(
      `  Back pointer chain: ${this.getBackPointerChain()
        .map((hc) => `HC${hc.id}`)
        .join(" -> ")}`,
    );
    lines.push(`  Transition tree:`);
    const root = this.getRoot();
    lines.push(root.collectTransitionTree(5));
    return lines.join("\n");
  }

  getStatistics() {
    return {
      id: this.id,
      propertyCount: this.propertyCount,
      version: this.version,
      descriptorVersion: this.descriptors.version,
      prototypeValidityVersion: this.prototypeValidityCell.version,
      objectCount: this.objectCount,
      isStable: this.isStable,
      isDeprecated: this.isDeprecated,
      migrationTargetId: this.migrationTarget ? this.migrationTarget.id : null,
      integrityLevel: this.integrityLevel,
      totalTransitionCount: this.totalTransitionCount,
      addTransitionCount: this.transitions.size,
      deleteTransitionCount: this.deleteTransitions.size,
      integrityTransitionCount: this.integrityTransitions.size,
      reconfigureTransitionCount: this.reconfigureTransitions.size,
    };
  }
}

export const ROOT_HIDDEN_CLASS = new HiddenClass(null, null, null, 0);

export const INSTANCE_TYPE_OBJECT = "JS_OBJECT";
export const INSTANCE_TYPE_MAP = "JS_MAP";
export const INSTANCE_TYPE_SET = "JS_SET";
export const INSTANCE_TYPE_WEAKMAP = "JS_WEAKMAP";
export const INSTANCE_TYPE_STRING_WRAPPER = "JS_STRING_WRAPPER";
export const INSTANCE_TYPE_NUMBER_WRAPPER = "JS_NUMBER_WRAPPER";
export const INSTANCE_TYPE_BOOLEAN_WRAPPER = "JS_BOOLEAN_WRAPPER";

const initialMapCache = new Map();

export function getInitialMap(instanceType) {
  if (initialMapCache.has(instanceType)) return initialMapCache.get(instanceType);
  const hc = new HiddenClass(ROOT_HIDDEN_CLASS, TRANSITION_ADD, `@@${instanceType}`, 0);
  hc.instanceType = instanceType;
  hc.descriptors.delete(`@@${instanceType}`);
  hc.propertyCount = 0;
  ROOT_HIDDEN_CLASS.transitions.set(`@@${instanceType}`, hc);
  initialMapCache.set(instanceType, hc);
  return hc;
}

export function resetHiddenClasses() {
  nextHiddenClassId = 1;
  ROOT_HIDDEN_CLASS.id = 0;
  ROOT_HIDDEN_CLASS.transitions.clear();
  ROOT_HIDDEN_CLASS.deleteTransitions.clear();
  ROOT_HIDDEN_CLASS.integrityTransitions.clear();
  ROOT_HIDDEN_CLASS.reconfigureTransitions.clear();
  ROOT_HIDDEN_CLASS.isStable = true;
  ROOT_HIDDEN_CLASS.isDeprecated = false;
  ROOT_HIDDEN_CLASS.migrationTarget = null;
  ROOT_HIDDEN_CLASS.deprecationCount = 0;
  ROOT_HIDDEN_CLASS.version = 0;
  ROOT_HIDDEN_CLASS.prototypeValidityCell = { version: 0 };
  ROOT_HIDDEN_CLASS.descriptors = new DescriptorArray();
  ROOT_HIDDEN_CLASS.properties = ROOT_HIDDEN_CLASS.descriptors.entries;
  ROOT_HIDDEN_CLASS.integrityLevel = INTEGRITY_NONE;
  ROOT_HIDDEN_CLASS.objectCount = 0;
  ROOT_HIDDEN_CLASS.totalTransitionCount = 0;
  allHiddenClasses.clear();
  allHiddenClasses.set(0, ROOT_HIDDEN_CLASS);
  deprecatedMaps.clear();
  migrationTargetCache.clear();
  initialMapCache.clear();
}

export function getHiddenClassById(id) {
  return allHiddenClasses.get(id) || null;
}

export function isMapDeprecated(hiddenClassId) {
  return deprecatedMaps.has(hiddenClassId);
}

export function getMigrationTarget(hiddenClassId) {
  return deprecatedMaps.get(hiddenClassId) || null;
}

export function getDeprecatedMapCount() {
  return deprecatedMaps.size;
}

export {
  TRANSITION_ADD,
  TRANSITION_DELETE,
  TRANSITION_RECONFIGURE,
  TRANSITION_INTEGRITY,
  INTEGRITY_NONE,
  INTEGRITY_PREVENTEXTENSIONS,
  INTEGRITY_SEALED,
  INTEGRITY_FROZEN,
  MAX_TRANSITIONS_BEFORE_UNSTABLE,
  MAX_DEPRECATIONS_BEFORE_FREEZE,
};
