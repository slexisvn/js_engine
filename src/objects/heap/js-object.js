import {
  HiddenClass,
  ROOT_HIDDEN_CLASS,
  PropertyDescriptor,
  isMapDeprecated,
} from "../maps/hidden-class.js";
import { tracer } from "../../core/tracing/index.js";
import {
  dependencyRegistry,
  DEP_MAP,
  DEP_PROTO_VALIDITY,
} from "../../deopt/dependencies.js";
import {
  getPayload,
  isNull,
  isUndefined,
  strictEqual,
  toDisplayString,
} from "../../core/value/index.js";
import { storeBarrierForTaggedValue } from "../../gc/write-barrier.js";

const MAX_IN_OBJECT_PROPERTIES = 10;
let totalMigrations = 0;

export class AccessorPair {
  constructor(getter, setter) {
    this.get = getter;
    this.set = setter;
  }
}

export class JSObject {
  constructor(hiddenClass) {
    this.hiddenClass = hiddenClass || ROOT_HIDDEN_CLASS;
    this.hiddenClass.incrementObjectCount();
    const propCount = this.hiddenClass.propertyCount;
    this.slots = propCount > 0 ? new Array(propCount) : [];
    this.overflowProperties = null;
    this.prototype = null;
    this.constructorRef = null;
    this.symbolProperties = null;
    this.gcHeader = null;
  }

  getSymbolProperty(taggedSym) {
    if (!this.symbolProperties) return undefined;
    return this.symbolProperties.get(getPayload(taggedSym));
  }

  setSymbolProperty(taggedSym, value) {
    if (!this.symbolProperties) this.symbolProperties = new Map();
    this.symbolProperties.set(getPayload(taggedSym), value);
  }

  deleteSymbolProperty(taggedSym) {
    if (!this.symbolProperties) return true;
    return this.symbolProperties.delete(getPayload(taggedSym));
  }

  hasSymbolProperty(taggedSym) {
    if (!this.symbolProperties) return false;
    return this.symbolProperties.has(getPayload(taggedSym));
  }

  visitReferences(callback) {
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      const payload = getPayload(slot);
      if (payload && typeof payload === "object" && payload.gcHeader) {
        callback(payload);
      }
    }
    if (this.overflowProperties) {
      for (const val of this.overflowProperties.values()) {
        const payload = getPayload(val);
        if (payload && typeof payload === "object" && payload.gcHeader) {
          callback(payload);
        }
      }
    }
    if (this.prototype && this.prototype.gcHeader) {
      callback(this.prototype);
    }
  }

  setPrototype(proto) {
    this.prototype = proto;
    this.hiddenClass.invalidate("setPrototype");
  }

  getPrototype() {
    return this.prototype;
  }

  lookupPrototypeChain(name) {
    let current = this;
    let depth = 0;
    while (current) {
      if (current.hiddenClass.isDeprecated) current.migrateInstance();
      const desc = current.hiddenClass.lookupProperty(name);
      if (desc) {
        if (desc.offset < current.slots.length) {
          return {
            found: true,
            value: current.slots[desc.offset],
            owner: current,
            descriptor: desc,
            depth,
          };
        }
        const overflow = current.overflowProperties ? current.overflowProperties.get(name) : undefined;
        if (overflow !== undefined) {
          return {
            found: true,
            value: overflow,
            owner: current,
            descriptor: desc,
            depth,
          };
        }
      }
      current = current.prototype;
      depth++;
    }
    return {
      found: false,
      value: undefined,
      owner: null,
      descriptor: null,
      depth: -1,
    };
  }

  getPrototypeValidityVersion() {
    return this.hiddenClass.prototypeValidityCell.version;
  }

  invalidatePrototypeDependents(reason) {
    const oldProtoVersion = this.hiddenClass.prototypeValidityCell.version;
    this.hiddenClass.prototypeValidityCell.version++;
    dependencyRegistry.invalidate(
      DEP_PROTO_VALIDITY,
      this.hiddenClass.id,
      oldProtoVersion,
      reason,
    );
    return reason;
  }

  needsMigration() {
    return (
      this.hiddenClass.isDeprecated && this.hiddenClass.migrationTarget !== null
    );
  }

  migrateInstance() {
    if (!this.needsMigration()) return false;

    const oldHC = this.hiddenClass;
    const targetHC = oldHC.migrationTarget;
    const oldSlots = [...this.slots];
    const oldOverflow = this.overflowProperties ? new Map(this.overflowProperties) : new Map();

    this.slots = [];
    this.overflowProperties = null;

    for (const [name, newDesc] of targetHC.properties) {
      const oldDesc = oldHC.lookupProperty(name);
      let value = undefined;

      if (oldDesc) {
        if (
          oldDesc.offset < MAX_IN_OBJECT_PROPERTIES &&
          oldDesc.offset < oldSlots.length
        ) {
          value = oldSlots[oldDesc.offset];
        } else {
          value = oldOverflow.get(name);
        }
      }

      if (newDesc.offset < MAX_IN_OBJECT_PROPERTIES) {
        while (this.slots.length <= newDesc.offset) {
          this.slots.push(undefined);
        }
        this.slots[newDesc.offset] = value;
      } else {
        if (!this.overflowProperties) this.overflowProperties = new Map();
        this.overflowProperties.set(name, value);
      }
    }

    oldHC.decrementObjectCount();
    this.hiddenClass = targetHC;
    targetHC.incrementObjectCount();

    totalMigrations++;
    tracer.log(
      "hidden-class",
      `Object migrated HC${oldHC.id} → HC${targetHC.id}`,
    );
    return true;
  }

  ensureMigrated() {
    if (this.hiddenClass.isDeprecated) {
      this.migrateInstance();
    }
  }

  hasOwnProperty(name) {
    return this.hiddenClass.hasProperty(name);
  }

  getProperty(name) {
    this.ensureMigrated();
    const desc = this.hiddenClass.lookupProperty(name);
    if (desc) {
      if (desc.offset < MAX_IN_OBJECT_PROPERTIES) {
        return this.slots[desc.offset];
      }
      const val = this.overflowProperties ? this.overflowProperties.get(name) : undefined;
      return val !== undefined ? val : undefined;
    }
    return undefined;
  }

  setProperty(name, value) {
    this.ensureMigrated();
    const desc = this.hiddenClass.lookupProperty(name);
    if (desc) {
      if (!desc.writable) {
        return false;
      }
      if (desc.offset < MAX_IN_OBJECT_PROPERTIES) {
        this.slots[desc.offset] = value;
      } else {
        if (!this.overflowProperties) this.overflowProperties = new Map();
        this.overflowProperties.set(name, value);
      }
      storeBarrierForTaggedValue(this, value);
      dependencyRegistry.invalidate(
        DEP_MAP,
        this.hiddenClass.id,
        this.hiddenClass.version,
        `store:${name}`,
      );
      this.invalidatePrototypeDependents(`store:${name}`);
      return true;
    }

    const oldHC = this.hiddenClass;
    const hadTransition = oldHC.transitions.has(name);
    this.hiddenClass.decrementObjectCount();
    const newHC = this.hiddenClass.transition(name);
    if (!newHC) {
      oldHC.incrementObjectCount();
      return false;
    }
    if (!hadTransition && oldHC.objectCount > 1) {
      oldHC.invalidate(`add:${name}`);
    }
    this.hiddenClass = newHC;
    this.hiddenClass.incrementObjectCount();

    const newDesc = newHC.lookupProperty(name);
    if (newDesc.offset < MAX_IN_OBJECT_PROPERTIES) {
      while (this.slots.length <= newDesc.offset) {
        this.slots.push(undefined);
      }
      this.slots[newDesc.offset] = value;
    } else {
      if (!this.overflowProperties) this.overflowProperties = new Map();
      this.overflowProperties.set(name, value);
    }
    storeBarrierForTaggedValue(this, value);
    return true;
  }

  deleteProperty(name) {
    const desc = this.hiddenClass.lookupProperty(name);
    if (!desc) {
      return true;
    }
    if (!desc.configurable) {
      return false;
    }

    const oldHC = this.hiddenClass;
    this.hiddenClass.decrementObjectCount();
    const newHC = this.hiddenClass.deleteProperty(name);
    if (!newHC) {
      this.hiddenClass.incrementObjectCount();
      return false;
    }
    oldHC.invalidate(`delete:${name}`);

    const oldSlots = [...this.slots];
    const oldProperties = this.overflowProperties ? new Map(this.overflowProperties) : new Map();

    this.slots = [];
    this.overflowProperties = null;

    for (const [key, newDesc] of newHC.properties) {
      let oldValue = undefined;
      const prevParent = newHC.parent;
      if (prevParent) {
        const prevDesc = prevParent.lookupProperty(key);
        if (prevDesc) {
          if (prevDesc.offset < oldSlots.length) {
            oldValue = oldSlots[prevDesc.offset];
          } else {
            oldValue = oldProperties.get(key);
          }
        }
      }

      if (newDesc.offset < MAX_IN_OBJECT_PROPERTIES) {
        while (this.slots.length <= newDesc.offset) {
          this.slots.push(undefined);
        }
        this.slots[newDesc.offset] = oldValue;
      } else {
        if (!this.overflowProperties) this.overflowProperties = new Map();
        this.overflowProperties.set(key, oldValue);
      }
    }

    this.hiddenClass = newHC;
    this.hiddenClass.incrementObjectCount();
    return true;
  }

  defineProperty(name, descriptor) {
    const kind = descriptor.kind || "data";
    const writable =
      descriptor.writable !== undefined ? descriptor.writable : true;
    const enumerable =
      descriptor.enumerable !== undefined ? descriptor.enumerable : true;
    const configurable =
      descriptor.configurable !== undefined ? descriptor.configurable : true;
    const value = descriptor.value;

    const existing = this.hiddenClass.lookupProperty(name);
    const oldHC = this.hiddenClass;

    if (existing) {
      if (!existing.configurable) {
        if (kind !== existing.kind) return false;
        if (writable && !existing.writable) return false;
        if (enumerable !== existing.enumerable) return false;
        if (configurable) return false;
      }
    }

    this.hiddenClass.decrementObjectCount();
    const newHC = this.hiddenClass.transitionWithAttributes(
      name,
      kind,
      writable,
      enumerable,
      configurable,
    );
    if (!newHC) {
      this.hiddenClass.incrementObjectCount();
      return false;
    }
    oldHC.invalidate(`define:${name}`);

    this.hiddenClass = newHC;
    this.hiddenClass.incrementObjectCount();

    const newDesc = newHC.lookupProperty(name);
    if (value !== undefined) {
      if (newDesc.offset < MAX_IN_OBJECT_PROPERTIES) {
        while (this.slots.length <= newDesc.offset) {
          this.slots.push(undefined);
        }
        this.slots[newDesc.offset] = value;
      } else {
        if (!this.overflowProperties) this.overflowProperties = new Map();
        this.overflowProperties.set(name, value);
      }
    }

    return true;
  }

  getOwnPropertyDescriptor(name) {
    const desc = this.hiddenClass.lookupProperty(name);
    if (!desc) return undefined;

    let value;
    if (desc.offset < MAX_IN_OBJECT_PROPERTIES) {
      value = this.slots[desc.offset];
    } else {
      value = this.overflowProperties ? this.overflowProperties.get(name) : undefined;
    }

    return {
      value: value,
      writable: desc.writable,
      enumerable: desc.enumerable,
      configurable: desc.configurable,
      kind: desc.kind,
    };
  }

  getOwnPropertyNames() {
    return this.hiddenClass.getPropertyNames();
  }

  getPropertyByOffset(offset) {
    if (offset < MAX_IN_OBJECT_PROPERTIES) {
      return this.slots[offset];
    }
    if (this.overflowProperties) {
      for (const [name, desc] of this.hiddenClass.properties) {
        if (desc.offset === offset) {
          return this.overflowProperties.get(name);
        }
      }
    }
    return undefined;
  }

  setPropertyByOffset(offset, value) {
    if (offset < MAX_IN_OBJECT_PROPERTIES) {
      this.slots[offset] = value;
      dependencyRegistry.invalidate(
        DEP_MAP,
        this.hiddenClass.id,
        this.hiddenClass.version,
        `store-offset:${offset}`,
      );
      return true;
    }
    for (const [name, desc] of this.hiddenClass.properties) {
      if (desc.offset === offset) {
        if (!this.overflowProperties) this.overflowProperties = new Map();
        this.overflowProperties.set(name, value);
        dependencyRegistry.invalidate(
          DEP_MAP,
          this.hiddenClass.id,
          this.hiddenClass.version,
          `store:${name}`,
        );
        return true;
      }
    }
    return false;
  }

  getMapId() {
    return this.hiddenClass.id;
  }

  keys() {
    return this.hiddenClass.getEnumerablePropertyNames();
  }

  values() {
    const result = [];
    for (const name of this.keys()) {
      result.push(this.getProperty(name));
    }
    return result;
  }

  entries() {
    const result = [];
    for (const name of this.keys()) {
      result.push([name, this.getProperty(name)]);
    }
    return result;
  }

  preventExtensions() {
    const oldHC = this.hiddenClass;
    this.hiddenClass.decrementObjectCount();
    this.hiddenClass = this.hiddenClass.transitionToPreventExtensions();
    oldHC.invalidate("preventExtensions");
    this.hiddenClass.incrementObjectCount();
  }

  seal() {
    const oldHC = this.hiddenClass;
    this.hiddenClass.decrementObjectCount();
    this.hiddenClass = this.hiddenClass.transitionToSealed();
    oldHC.invalidate("seal");
    this.hiddenClass.incrementObjectCount();
  }

  freeze() {
    const oldHC = this.hiddenClass;
    this.hiddenClass.decrementObjectCount();
    this.hiddenClass = this.hiddenClass.transitionToFrozen();
    oldHC.invalidate("freeze");
    this.hiddenClass.incrementObjectCount();
  }

  toString() {
    const entries = [];
    for (const [name, desc] of this.hiddenClass.properties) {
      let val;
      if (desc.offset < MAX_IN_OBJECT_PROPERTIES) {
        val = this.slots[desc.offset];
      } else {
        val = this.overflowProperties ? this.overflowProperties.get(name) : undefined;
      }
      entries.push(`${name}: ${toDisplayString(val)}`);
    }
    return `{ ${entries.join(", ")} }`;
  }
}

export function getMigrationStats() {
  return { totalMigrations };
}

export function resetMigrationStats() {
  totalMigrations = 0;
}
