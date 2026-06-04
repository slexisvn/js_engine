import { tracer } from "../../core/tracing/index.js";
import {
  IC_UNINITIALIZED,
  IC_MONOMORPHIC,
  IC_POLYMORPHIC,
  IC_MEGAMORPHIC,
} from "../vector/index.js";
import { isMapDeprecated } from "../../objects/maps/hidden-class.js";
import {
  dependencyRegistry,
  DEP_CALL_TARGET,
  DEP_MAP,
} from "../../deopt/dependencies.js";
import { getPayload } from "../../core/value/index.js";

export { IC_UNINITIALIZED, IC_MONOMORPHIC, IC_POLYMORPHIC, IC_MEGAMORPHIC };

const MAX_POLY_ENTRIES = 8;
const MAX_ELEMENT_POLY_ENTRIES = 4;
const MONOMORPHIC_JIT_THRESHOLD = 100;
const DOMINANT_HANDLER_RATIO = 0.8;
const SETTLED_CALL_THRESHOLD = 100;

export class LoadFieldHandler {
  constructor(hiddenClassId, mapVersion, offset, propertyName) {
    this.type = "LoadField";
    this.hiddenClassId = hiddenClassId;
    this.mapVersion = mapVersion;
    this.offset = offset;
    this.propertyName = propertyName;
  }

  matches(obj) {
    return (
      obj.hiddenClass.id === this.hiddenClassId &&
      obj.hiddenClass.version === this.mapVersion &&
      !obj.hiddenClass.isDeprecated
    );
  }

  execute(obj) {
    return obj.getPropertyByOffset(this.offset);
  }

  toString() {
    return `LoadField(hc=${this.hiddenClassId}, offset=${this.offset}, prop="${this.propertyName}")`;
  }
}

export class ProtoLoadFieldHandler {
  constructor(
    receiverMapId,
    receiverMapVersion,
    protoMapId,
    protoMapVersion,
    validityVersion,
    offset,
    protoObject,
    propertyName,
    depth,
  ) {
    this.type = "ProtoLoadField";
    this.receiverMapId = receiverMapId;
    this.receiverMapVersion = receiverMapVersion;
    this.protoMapId = protoMapId;
    this.protoMapVersion = protoMapVersion;
    this.validityVersion = validityVersion;
    this.offset = offset;
    this.protoObject = protoObject;
    this.propertyName = propertyName;
    this.depth = depth;
  }

  matches(obj) {
    if (obj.hiddenClass.id !== this.receiverMapId) return false;
    if (obj.hiddenClass.version !== this.receiverMapVersion) return false;
    if (!this.protoObject) return false;
    if (this.protoObject.hiddenClass.id !== this.protoMapId) return false;
    if (this.protoObject.hiddenClass.version !== this.protoMapVersion)
      return false;
    if (this.protoObject.getPrototypeValidityVersion() !== this.validityVersion)
      return false;
    if (this.protoObject.hiddenClass.isDeprecated) return false;
    return true;
  }

  execute(_obj) {
    return this.protoObject.getPropertyByOffset(this.offset);
  }

  toString() {
    return `ProtoLoadField(receiver_hc=${this.receiverMapId}, proto_hc=${this.protoMapId}, offset=${this.offset}, prop="${this.propertyName}")`;
  }
}

export class StoreFieldHandler {
  constructor(hiddenClassId, mapVersion, offset, propertyName) {
    this.type = "StoreField";
    this.hiddenClassId = hiddenClassId;
    this.mapVersion = mapVersion;
    this.offset = offset;
    this.propertyName = propertyName;
  }

  matches(obj) {
    return (
      obj.hiddenClass.id === this.hiddenClassId &&
      obj.hiddenClass.version === this.mapVersion &&
      !obj.hiddenClass.isDeprecated
    );
  }

  execute(obj, value) {
    obj.setPropertyByOffset(this.offset, value);
  }

  toString() {
    return `StoreField(hc=${this.hiddenClassId}, offset=${this.offset}, prop="${this.propertyName}")`;
  }
}

export class TransitionStoreHandler {
  constructor(
    oldHiddenClassId,
    oldMapVersion,
    newHiddenClassId,
    offset,
    propertyName,
  ) {
    this.type = "TransitionStore";
    this.oldHiddenClassId = oldHiddenClassId;
    this.oldMapVersion = oldMapVersion;
    this.newHiddenClassId = newHiddenClassId;
    this.offset = offset;
    this.propertyName = propertyName;
  }

  matches(obj) {
    return (
      obj.hiddenClass.id === this.oldHiddenClassId &&
      obj.hiddenClass.version === this.oldMapVersion &&
      !obj.hiddenClass.isDeprecated
    );
  }

  execute(obj, value) {
    obj.setProperty(this.propertyName, value);
  }

  toString() {
    return `TransitionStore(old_hc=${this.oldHiddenClassId}, new_hc=${this.newHiddenClassId}, offset=${this.offset}, prop="${this.propertyName}")`;
  }
}

export class MissingPropertyHandler {
  constructor(hiddenClassId, mapVersion, propertyName) {
    this.type = "MissingProperty";
    this.hiddenClassId = hiddenClassId;
    this.mapVersion = mapVersion;
    this.propertyName = propertyName;
    this.offset = -1;
  }

  matches(obj) {
    return (
      obj.hiddenClass.id === this.hiddenClassId &&
      obj.hiddenClass.version === this.mapVersion &&
      !obj.hiddenClass.isDeprecated
    );
  }

  execute(_obj) {
    return undefined;
  }
}

export class MegamorphicCache {
  constructor() {
    this.loadCache = new Map();
    this.storeCache = new Map();
    this.elementLoadCache = new Map();
    this.elementStoreCache = new Map();
  }

  getLoad(hcId, propertyName) {
    return this.loadCache.get(`${hcId}:${propertyName}`);
  }

  deleteLoad(hcId, propertyName) {
    this.loadCache.delete(`${hcId}:${propertyName}`);
  }

  setLoad(hcId, propertyName, handler) {
    this.loadCache.set(`${hcId}:${propertyName}`, handler);
  }

  getStore(hcId, propertyName) {
    return this.storeCache.get(`${hcId}:${propertyName}`);
  }

  setStore(hcId, propertyName, handler) {
    this.storeCache.set(`${hcId}:${propertyName}`, handler);
  }

  getElementLoad(elementsKind) {
    return this.elementLoadCache.get(elementsKind);
  }

  setElementLoad(elementsKind, handler) {
    this.elementLoadCache.set(elementsKind, handler);
  }

  getElementStore(elementsKind) {
    return this.elementStoreCache.get(elementsKind);
  }

  setElementStore(elementsKind, handler) {
    this.elementStoreCache.set(elementsKind, handler);
  }
}

export const globalMegamorphicCache = new MegamorphicCache();

class ICEntry {
  constructor(hiddenClassId, handler) {
    this.hiddenClassId = hiddenClassId;
    this.mapVersion =
      handler.mapVersion ??
      handler.receiverMapVersion ??
      handler.oldMapVersion ??
      null;
    this.handler = handler;
    this.hitCount = 0;
  }

  get offset() {
    return this.handler.offset;
  }
}

class ElementICEntry {
  constructor(elementsKind, handler) {
    this.elementsKind = elementsKind;
    this.handler = handler;
    this.hitCount = 0;
  }
}

class CallICEntry {
  constructor(
    targetId,
    targetVersion,
    argCount,
    receiverMapId,
    receiverMapVersion,
    handler,
  ) {
    this.targetId = targetId;
    this.targetVersion = targetVersion;
    this.argCount = argCount;
    this.receiverMapId = receiverMapId;
    this.receiverMapVersion = receiverMapVersion;
    this.handler = handler;
    this.hitCount = 0;
  }
}

export class CallHandler {
  constructor(
    targetId,
    targetVersion,
    argCount,
    targetRef,
    receiverMapId = null,
    receiverMapVersion = null,
  ) {
    this.type = receiverMapId === null ? "Call" : "MethodCall";
    this.targetId = targetId;
    this.targetVersion = targetVersion;
    this.argCount = argCount;
    this.targetRef = targetRef;
    this.receiverMapId = receiverMapId;
    this.receiverMapVersion = receiverMapVersion;
  }

  matches(callee, argCount, receiver = null) {
    const compiled = callee && callee.compiled ? callee.compiled : null;
    const targetId = compiled
      ? compiled.id
      : `builtin:${callee ? callee.name : "<unknown>"}`;
    const targetVersion = compiled ? compiled.version : 0;
    if (targetId !== this.targetId || targetVersion !== this.targetVersion)
      return false;
    if (argCount !== this.argCount) return false;
    if (this.receiverMapId !== null) {
      const receiverObj = getPayload(receiver);
      if (!receiverObj || !receiverObj.hiddenClass) return false;
      if (receiverObj.hiddenClass.id !== this.receiverMapId) return false;
      if (receiverObj.hiddenClass.version !== this.receiverMapVersion)
        return false;
    }
    return true;
  }
}

export class LoadElementHandler {
  constructor(elementsKind) {
    this.type = "LoadElement";
    this.elementsKind = elementsKind;
  }

  execute(arrayObj, index) {
    return arrayObj.getIndex(index);
  }
}

export class StoreElementHandler {
  constructor(elementsKind) {
    this.type = "StoreElement";
    this.elementsKind = elementsKind;
  }

  execute(arrayObj, index, value) {
    arrayObj.setIndex(index, value);
  }
}

export class PropertyLoadIC {
  constructor(siteId) {
    this.siteId = siteId;
    this.state = IC_UNINITIALIZED;
    this.entries = [];
    this.hitCount = 0;
    this.missCount = 0;
    this.transitionCount = 0;
    this.monomorphicSinceCount = 0;
    this.jitCandidate = false;
  }

  lookup(obj, propertyName) {
    if (obj.hiddenClass.isDeprecated && obj.migrateInstance) {
      obj.migrateInstance();
      this.invalidate();
    }

    const hcId = obj.hiddenClass.id;

    if (this.state === IC_MONOMORPHIC) {
      const entry = this.entries[0];
      if (entry.hiddenClassId === hcId) {
        if (!entry.handler.matches(obj)) {
          const result = this._miss(obj, propertyName, hcId);
          result.hit = false;
          return result;
        }
        this.hitCount++;
        entry.hitCount++;
        this.monomorphicSinceCount++;
        if (
          this.monomorphicSinceCount >= MONOMORPHIC_JIT_THRESHOLD &&
          !this.jitCandidate
        ) {
          this.jitCandidate = true;
        }
        tracer.icHit(this.siteId, "monomorphic", hcId);
        if (entry.handler.type === "MissingProperty")
          return { hit: false, value: undefined };
        return { hit: true, value: entry.handler.execute(obj) };
      }
    }

    if (this.state === IC_POLYMORPHIC) {
      for (let i = 0; i < this.entries.length; i++) {
        const entry = this.entries[i];
        if (entry.hiddenClassId === hcId && !entry.handler.matches(obj)) {
          continue;
        }
        if (entry.hiddenClassId === hcId) {
          this.hitCount++;
          entry.hitCount++;
          tracer.icHit(this.siteId, "polymorphic", hcId);
          if (entry.handler.type === "MissingProperty")
            return { hit: false, value: undefined };
          return { hit: true, value: entry.handler.execute(obj) };
        }
      }
    }

    if (this.state === IC_MEGAMORPHIC) {
      const handler = globalMegamorphicCache.getLoad(hcId, propertyName);
      if (handler) {
        if (!handler.matches(obj)) {
          globalMegamorphicCache.deleteLoad(hcId, propertyName);
        } else {
          this.hitCount++;
          tracer.icHit(this.siteId, "megamorphic", hcId);
          if (handler.type === "MissingProperty")
            return { hit: false, value: undefined };
          return { hit: true, value: handler.execute(obj) };
        }
      }

      this.missCount++;
      tracer.icMiss(this.siteId, "megamorphic");
      const info = obj.hiddenClass.lookupProperty(propertyName);
      if (info) {
        const newHandler = new LoadFieldHandler(
          hcId,
          obj.hiddenClass.version,
          info.offset,
          propertyName,
        );
        globalMegamorphicCache.setLoad(hcId, propertyName, newHandler);
        return { hit: false, value: newHandler.execute(obj) };
      }
      if (obj.prototype) {
        const protoResult = obj.lookupPrototypeChain(propertyName);
        if (protoResult.found && protoResult.owner) {
          const protoObj = protoResult.owner;
          const protoDesc = protoObj.hiddenClass.lookupProperty(propertyName);
          if (protoDesc) {
            const protoHandler = new ProtoLoadFieldHandler(
              hcId,
              obj.hiddenClass.version,
              protoObj.hiddenClass.id,
              protoObj.hiddenClass.version,
              protoObj.getPrototypeValidityVersion(),
              protoDesc.offset,
              protoObj,
              propertyName,
              protoResult.depth,
            );
            globalMegamorphicCache.setLoad(hcId, propertyName, protoHandler);
            return { hit: false, value: protoResult.value };
          }
        }
      }
      const missing = new MissingPropertyHandler(
        hcId,
        obj.hiddenClass.version,
        propertyName,
      );
      globalMegamorphicCache.setLoad(hcId, propertyName, missing);
      return { hit: false, value: undefined };
    }

    return this._miss(obj, propertyName, hcId);
  }

  _miss(obj, propertyName, hcId) {
    this.missCount++;
    const info = obj.hiddenClass.lookupProperty(propertyName);

    let handler;
    let value;

    if (info) {
      handler = new LoadFieldHandler(
        hcId,
        obj.hiddenClass.version,
        info.offset,
        propertyName,
      );
      value = handler.execute(obj);
    } else if (obj.prototype) {
      const protoResult = obj.lookupPrototypeChain(propertyName);
      if (protoResult.found && protoResult.owner) {
        const protoObj = protoResult.owner;
        const protoDesc = protoObj.hiddenClass.lookupProperty(propertyName);
        if (protoDesc) {
          handler = new ProtoLoadFieldHandler(
            hcId,
            obj.hiddenClass.version,
            protoObj.hiddenClass.id,
            protoObj.hiddenClass.version,
            protoObj.getPrototypeValidityVersion(),
            protoDesc.offset,
            protoObj,
            propertyName,
            protoResult.depth,
          );
          value = protoResult.value;
        }
      }
    }

    if (!handler) {
      handler = new MissingPropertyHandler(
        hcId,
        obj.hiddenClass.version,
        propertyName,
      );
      value = undefined;
    }

    const missing = handler.type === "MissingProperty";

    const entry = new ICEntry(hcId, handler);
    const prevState = this.state;

    if (this.state === IC_UNINITIALIZED) {
      this.state = IC_MONOMORPHIC;
      this.entries = [entry];
      this.monomorphicSinceCount = 0;
    } else if (this.state === IC_MONOMORPHIC) {
      this.state = IC_POLYMORPHIC;
      this.entries.push(entry);
      this.monomorphicSinceCount = 0;
      this.jitCandidate = false;
    } else if (
      this.state === IC_POLYMORPHIC &&
      this.entries.length < MAX_POLY_ENTRIES
    ) {
      this.entries.push(entry);
    } else {
      this.state = IC_MEGAMORPHIC;
      this.entries = null;
      this.jitCandidate = false;
    }

    this.transitionCount++;
    tracer.icEvent(
      this.siteId,
      prevState,
      this.state,
      hcId,
      handler.offset || 0,
    );

    return { hit: !missing, value };
  }

  invalidate() {
    this.state = IC_UNINITIALIZED;
    this.entries = [];
    this.monomorphicSinceCount = 0;
    this.jitCandidate = false;
    this.transitionCount++;
  }

  getSortedHandlers() {
    if (!this.entries || this.entries.length === 0) return [];
    return [...this.entries].sort((a, b) => b.hitCount - a.hitCount);
  }

  getDominantHandler() {
    if (!this.entries || this.entries.length < 2) return null;
    const totalHits = this.entries.reduce((sum, e) => sum + e.hitCount, 0);
    if (totalHits === 0) return null;
    const sorted = this.getSortedHandlers();
    const top = sorted[0];
    if (top.hitCount / totalHits >= DOMINANT_HANDLER_RATIO) {
      return top;
    }
    return null;
  }

  isSettled() {
    return (
      (this.hitCount >= SETTLED_CALL_THRESHOLD && this.transitionCount === 0) ||
      this.hitCount - this.missCount >= SETTLED_CALL_THRESHOLD
    );
  }

  getPolymorphicProfile() {
    if (!this.entries) return [];
    const totalHits = this.entries.reduce((sum, e) => sum + e.hitCount, 0);
    return this.entries.map((e) => ({
      hiddenClassId: e.hiddenClassId,
      handler: e.handler,
      hitCount: e.hitCount,
      ratio: totalHits > 0 ? e.hitCount / totalHits : 0,
    }));
  }

  getStats() {
    return {
      siteId: this.siteId,
      type: "load",
      state: this.state,
      hitCount: this.hitCount,
      missCount: this.missCount,
      transitionCount: this.transitionCount,
      entryCount: this.entries ? this.entries.length : 0,
      jitCandidate: this.jitCandidate,
    };
  }

  toString() {
    const entries = this.entries
      ? this.entries
          .map(
            (e) =>
              `{hc=${e.hiddenClassId}, hits=${e.hitCount}, handler=${e.handler}}`,
          )
          .join(", ")
      : "null";
    return `LoadIC[${this.siteId}](state=${this.state}, hits=${this.hitCount}, misses=${this.missCount}, entries=[${entries}])`;
  }
}

export class PropertyStoreIC {
  constructor(siteId) {
    this.siteId = siteId;
    this.state = IC_UNINITIALIZED;
    this.entries = [];
    this.hitCount = 0;
    this.missCount = 0;
    this.transitionCount = 0;
    this.monomorphicSinceCount = 0;
    this.jitCandidate = false;
  }

  store(obj, propertyName, value) {
    if (obj.hiddenClass.isDeprecated && obj.migrateInstance) {
      obj.migrateInstance();
      this.invalidate();
    }

    const hcId = obj.hiddenClass.id;

    if (this.state === IC_MONOMORPHIC) {
      const entry = this.entries[0];
      if (entry.hiddenClassId === hcId && entry.handler.matches(obj)) {
        this.hitCount++;
        entry.hitCount++;
        this.monomorphicSinceCount++;
        if (
          this.monomorphicSinceCount >= MONOMORPHIC_JIT_THRESHOLD &&
          !this.jitCandidate
        ) {
          this.jitCandidate = true;
        }
        tracer.icHit(this.siteId, "monomorphic-store", hcId);
        entry.handler.execute(obj, value);
        return true;
      }
    }

    if (this.state === IC_POLYMORPHIC) {
      for (let i = 0; i < this.entries.length; i++) {
        const entry = this.entries[i];
        if (entry.hiddenClassId === hcId && entry.handler.matches(obj)) {
          this.hitCount++;
          entry.hitCount++;
          tracer.icHit(this.siteId, "polymorphic-store", hcId);
          entry.handler.execute(obj, value);
          return true;
        }
      }
    }

    if (this.state === IC_MEGAMORPHIC) {
      const handler = globalMegamorphicCache.getStore(hcId, propertyName);
      if (handler && handler.matches(obj)) {
        this.hitCount++;
        tracer.icHit(this.siteId, "megamorphic-store", hcId);
        handler.execute(obj, value);
        return true;
      }

      this.missCount++;
      tracer.icMiss(this.siteId, "megamorphic-store");
      const info = obj.hiddenClass.lookupProperty(propertyName);
      let newHandler;

      if (info) {
        newHandler = new StoreFieldHandler(
          hcId,
          obj.hiddenClass.version,
          info.offset,
          propertyName,
        );
        newHandler.execute(obj, value);
      } else {
        const oldHC = obj.hiddenClass;
        const oldHcId = oldHC.id;
        obj.setProperty(propertyName, value);
        const newHcId = obj.hiddenClass.id;
        const newInfo = obj.hiddenClass.lookupProperty(propertyName);
        if (newInfo) {
          newHandler = new TransitionStoreHandler(
            oldHcId,
            oldHC.version,
            newHcId,
            newInfo.offset,
            propertyName,
          );
        }
      }

      if (newHandler) {
        globalMegamorphicCache.setStore(hcId, propertyName, newHandler);
      }
      return true;
    }

    return this._miss(obj, propertyName, value, hcId);
  }

  _miss(obj, propertyName, value, hcId) {
    this.missCount++;
    const info = obj.hiddenClass.lookupProperty(propertyName);

    let handler;
    if (info) {
      handler = new StoreFieldHandler(
        hcId,
        obj.hiddenClass.version,
        info.offset,
        propertyName,
      );
    } else {
      const oldHC = obj.hiddenClass;
      const oldHcId = oldHC.id;
      obj.setProperty(propertyName, value);
      const newHcId = obj.hiddenClass.id;
      const newInfo = obj.hiddenClass.lookupProperty(propertyName);
      if (newInfo) {
        handler = new TransitionStoreHandler(
          oldHcId,
          oldHC.version,
          newHcId,
          newInfo.offset,
          propertyName,
        );
        const entry = new ICEntry(oldHcId, handler);
        this._addEntry(entry, oldHcId);
      }
      return true;
    }

    const entry = new ICEntry(hcId, handler);
    this._addEntry(entry, hcId);

    handler.execute(obj, value);
    return true;
  }

  _addEntry(entry, hcId) {
    const prevState = this.state;

    if (this.state === IC_UNINITIALIZED) {
      this.state = IC_MONOMORPHIC;
      this.entries = [entry];
      this.monomorphicSinceCount = 0;
    } else if (this.state === IC_MONOMORPHIC) {
      this.state = IC_POLYMORPHIC;
      this.entries.push(entry);
      this.monomorphicSinceCount = 0;
      this.jitCandidate = false;
    } else if (
      this.state === IC_POLYMORPHIC &&
      this.entries.length < MAX_POLY_ENTRIES
    ) {
      this.entries.push(entry);
    } else {
      this.state = IC_MEGAMORPHIC;
      this.entries = null;
      this.jitCandidate = false;
    }

    this.transitionCount++;
    tracer.icEvent(
      this.siteId,
      prevState,
      this.state,
      hcId,
      entry.handler.offset || 0,
    );
  }

  invalidate() {
    this.state = IC_UNINITIALIZED;
    this.entries = [];
    this.monomorphicSinceCount = 0;
    this.jitCandidate = false;
    this.transitionCount++;
  }

  getSortedHandlers() {
    if (!this.entries || this.entries.length === 0) return [];
    return [...this.entries].sort((a, b) => b.hitCount - a.hitCount);
  }

  getDominantHandler() {
    if (!this.entries || this.entries.length < 2) return null;
    const totalHits = this.entries.reduce((sum, e) => sum + e.hitCount, 0);
    if (totalHits === 0) return null;
    const sorted = this.getSortedHandlers();
    const top = sorted[0];
    if (top.hitCount / totalHits >= DOMINANT_HANDLER_RATIO) {
      return top;
    }
    return null;
  }

  isSettled() {
    return (
      (this.hitCount >= SETTLED_CALL_THRESHOLD && this.transitionCount === 0) ||
      this.hitCount - this.missCount >= SETTLED_CALL_THRESHOLD
    );
  }

  getPolymorphicProfile() {
    if (!this.entries) return [];
    const totalHits = this.entries.reduce((sum, e) => sum + e.hitCount, 0);
    return this.entries.map((e) => ({
      hiddenClassId: e.hiddenClassId,
      handler: e.handler,
      hitCount: e.hitCount,
      ratio: totalHits > 0 ? e.hitCount / totalHits : 0,
    }));
  }

  getStats() {
    return {
      siteId: this.siteId,
      type: "store",
      state: this.state,
      hitCount: this.hitCount,
      missCount: this.missCount,
      transitionCount: this.transitionCount,
      entryCount: this.entries ? this.entries.length : 0,
      jitCandidate: this.jitCandidate,
    };
  }

  toString() {
    const entries = this.entries
      ? this.entries
          .map(
            (e) =>
              `{hc=${e.hiddenClassId}, hits=${e.hitCount}, handler=${e.handler}}`,
          )
          .join(", ")
      : "null";
    return `StoreIC[${this.siteId}](state=${this.state}, hits=${this.hitCount}, misses=${this.missCount}, entries=[${entries}])`;
  }
}

export class ElementLoadIC {
  constructor(siteId) {
    this.siteId = siteId;
    this.state = IC_UNINITIALIZED;
    this.entries = [];
    this.hitCount = 0;
    this.missCount = 0;
    this.transitionCount = 0;
  }

  lookup(arrayObj, index) {
    const elementsKind = arrayObj.getElementsKind();

    if (this.state === IC_MONOMORPHIC) {
      const entry = this.entries[0];
      if (entry.elementsKind === elementsKind) {
        this.hitCount++;
        entry.hitCount++;
        tracer.icHit(this.siteId, "monomorphic-element-load", elementsKind);
        return { hit: true, value: entry.handler.execute(arrayObj, index) };
      }
    }

    if (this.state === IC_POLYMORPHIC) {
      for (const entry of this.entries) {
        if (entry.elementsKind === elementsKind) {
          this.hitCount++;
          entry.hitCount++;
          tracer.icHit(this.siteId, "polymorphic-element-load", elementsKind);
          return { hit: true, value: entry.handler.execute(arrayObj, index) };
        }
      }
    }

    if (this.state === IC_MEGAMORPHIC) {
      const handler = globalMegamorphicCache.getElementLoad(elementsKind);
      this.missCount++;
      if (handler) {
        tracer.icHit(this.siteId, "megamorphic-element-load", elementsKind);
        return { hit: false, value: handler.execute(arrayObj, index) };
      }
      const newHandler = new LoadElementHandler(elementsKind);
      globalMegamorphicCache.setElementLoad(elementsKind, newHandler);
      tracer.icMiss(this.siteId, "megamorphic-element-load");
      return { hit: false, value: newHandler.execute(arrayObj, index) };
    }

    return this._miss(arrayObj, index, elementsKind);
  }

  _miss(arrayObj, index, elementsKind) {
    this.missCount++;
    const handler = new LoadElementHandler(elementsKind);
    const entry = new ElementICEntry(elementsKind, handler);
    this._addEntry(entry, elementsKind);
    return { hit: true, value: handler.execute(arrayObj, index) };
  }

  _addEntry(entry, elementsKind) {
    const prevState = this.state;
    if (this.state === IC_UNINITIALIZED) {
      this.state = IC_MONOMORPHIC;
      this.entries = [entry];
    } else if (this.state === IC_MONOMORPHIC) {
      this.state = IC_POLYMORPHIC;
      this.entries.push(entry);
    } else if (
      this.state === IC_POLYMORPHIC &&
      this.entries.length < MAX_ELEMENT_POLY_ENTRIES
    ) {
      this.entries.push(entry);
    } else {
      this.state = IC_MEGAMORPHIC;
      this.entries = null;
    }
    this.transitionCount++;
    tracer.icEvent(this.siteId, prevState, this.state, elementsKind, 0);
  }

  invalidate() {
    this.state = IC_UNINITIALIZED;
    this.entries = [];
    this.transitionCount++;
  }

  getStats() {
    return {
      siteId: this.siteId,
      type: "element-load",
      state: this.state,
      hitCount: this.hitCount,
      missCount: this.missCount,
      transitionCount: this.transitionCount,
      entryCount: this.entries ? this.entries.length : 0,
      kinds: this.entries ? this.entries.map((e) => e.elementsKind) : [],
    };
  }
}

export class ElementStoreIC {
  constructor(siteId) {
    this.siteId = siteId;
    this.state = IC_UNINITIALIZED;
    this.entries = [];
    this.hitCount = 0;
    this.missCount = 0;
    this.transitionCount = 0;
  }

  store(arrayObj, index, value) {
    const elementsKind = arrayObj.getElementsKind();

    if (this.state === IC_MONOMORPHIC) {
      const entry = this.entries[0];
      if (entry.elementsKind === elementsKind) {
        this.hitCount++;
        entry.hitCount++;
        entry.handler.execute(arrayObj, index, value);
        this._refreshTransition(elementsKind, arrayObj.getElementsKind());
        tracer.icHit(this.siteId, "monomorphic-element-store", elementsKind);
        return true;
      }
    }

    if (this.state === IC_POLYMORPHIC) {
      for (const entry of this.entries) {
        if (entry.elementsKind === elementsKind) {
          this.hitCount++;
          entry.hitCount++;
          entry.handler.execute(arrayObj, index, value);
          this._refreshTransition(elementsKind, arrayObj.getElementsKind());
          tracer.icHit(this.siteId, "polymorphic-element-store", elementsKind);
          return true;
        }
      }
    }

    if (this.state === IC_MEGAMORPHIC) {
      let handler = globalMegamorphicCache.getElementStore(elementsKind);
      if (!handler) {
        handler = new StoreElementHandler(elementsKind);
        globalMegamorphicCache.setElementStore(elementsKind, handler);
      }
      this.missCount++;
      handler.execute(arrayObj, index, value);
      globalMegamorphicCache.setElementStore(
        arrayObj.getElementsKind(),
        new StoreElementHandler(arrayObj.getElementsKind()),
      );
      tracer.icMiss(this.siteId, "megamorphic-element-store");
      return true;
    }

    return this._miss(arrayObj, index, value, elementsKind);
  }

  _miss(arrayObj, index, value, elementsKind) {
    this.missCount++;
    const handler = new StoreElementHandler(elementsKind);
    const entry = new ElementICEntry(elementsKind, handler);
    this._addEntry(entry, elementsKind);
    handler.execute(arrayObj, index, value);
    this._refreshTransition(elementsKind, arrayObj.getElementsKind());
    return true;
  }

  _refreshTransition(oldKind, newKind) {
    if (oldKind === newKind) return;
    if (this.entries) {
      for (const entry of this.entries) {
        if (entry.elementsKind === newKind) return;
      }
      this._addEntry(
        new ElementICEntry(newKind, new StoreElementHandler(newKind)),
        newKind,
      );
    }
  }

  _addEntry(entry, elementsKind) {
    const prevState = this.state;
    if (this.state === IC_UNINITIALIZED) {
      this.state = IC_MONOMORPHIC;
      this.entries = [entry];
    } else if (this.state === IC_MONOMORPHIC) {
      this.state = IC_POLYMORPHIC;
      this.entries.push(entry);
    } else if (
      this.state === IC_POLYMORPHIC &&
      this.entries.length < MAX_ELEMENT_POLY_ENTRIES
    ) {
      this.entries.push(entry);
    } else {
      this.state = IC_MEGAMORPHIC;
      this.entries = null;
    }
    this.transitionCount++;
    tracer.icEvent(this.siteId, prevState, this.state, elementsKind, 0);
  }

  invalidate() {
    this.state = IC_UNINITIALIZED;
    this.entries = [];
    this.transitionCount++;
  }

  getStats() {
    return {
      siteId: this.siteId,
      type: "element-store",
      state: this.state,
      hitCount: this.hitCount,
      missCount: this.missCount,
      transitionCount: this.transitionCount,
      entryCount: this.entries ? this.entries.length : 0,
      kinds: this.entries ? this.entries.map((e) => e.elementsKind) : [],
    };
  }
}

export class CallIC {
  constructor(siteId) {
    this.siteId = siteId;
    this.state = IC_UNINITIALIZED;
    this.entries = [];
    this.hitCount = 0;
    this.missCount = 0;
    this.transitionCount = 0;
  }

  lookup(callee, argCount, receiver = null) {
    const compiled = callee && callee.compiled ? callee.compiled : null;
    const targetId = compiled
      ? compiled.id
      : `builtin:${callee ? callee.name : "<unknown>"}`;
    const targetVersion = compiled ? compiled.version : 0;
    const receiverObj = getPayload(receiver);
    const receiverMapId =
      receiverObj && receiverObj.hiddenClass
        ? receiverObj.hiddenClass.id
        : null;
    const receiverMapVersion =
      receiverObj && receiverObj.hiddenClass
        ? receiverObj.hiddenClass.version
        : null;

    if (this.state === IC_MONOMORPHIC) {
      const entry = this.entries[0];
      if (entry.handler.matches(callee, argCount, receiver)) {
        this.hitCount++;
        entry.hitCount++;
        tracer.icHit(
          this.siteId,
          entry.receiverMapId === null
            ? "monomorphic-call"
            : "monomorphic-method-call",
          targetId,
        );
        return { hit: true, handler: entry.handler };
      }
      dependencyRegistry.invalidate(
        DEP_CALL_TARGET,
        entry.targetId,
        entry.targetVersion,
        "call-target-miss",
      );
      if (entry.receiverMapId !== null) {
        dependencyRegistry.invalidate(
          DEP_MAP,
          entry.receiverMapId,
          entry.receiverMapVersion,
          "method-receiver-miss",
        );
      }
    }

    if (this.state === IC_POLYMORPHIC) {
      for (const entry of this.entries) {
        if (entry.handler.matches(callee, argCount, receiver)) {
          this.hitCount++;
          entry.hitCount++;
          tracer.icHit(this.siteId, "polymorphic-call", targetId);
          return { hit: true, handler: entry.handler };
        }
      }
    }

    return this._miss(
      callee,
      argCount,
      receiver,
      targetId,
      targetVersion,
      receiverMapId,
      receiverMapVersion,
    );
  }

  _miss(
    callee,
    argCount,
    receiver,
    targetId,
    targetVersion,
    receiverMapId,
    receiverMapVersion,
  ) {
    this.missCount++;
    const handler = new CallHandler(
      targetId,
      targetVersion,
      argCount,
      callee ? callee.compiled : null,
      receiverMapId,
      receiverMapVersion,
    );
    const entry = new CallICEntry(
      targetId,
      targetVersion,
      argCount,
      receiverMapId,
      receiverMapVersion,
      handler,
    );
    this._addEntry(entry, targetId);
    return { hit: false, handler };
  }

  _addEntry(entry, targetId) {
    const prevState = this.state;
    if (this.state === IC_UNINITIALIZED) {
      this.state = IC_MONOMORPHIC;
      this.entries = [entry];
    } else if (this.state === IC_MONOMORPHIC) {
      this.state = IC_POLYMORPHIC;
      this.entries.push(entry);
    } else if (
      this.state === IC_POLYMORPHIC &&
      this.entries.length < MAX_POLY_ENTRIES
    ) {
      this.entries.push(entry);
    } else {
      this.state = IC_MEGAMORPHIC;
      this.entries = null;
    }
    this.transitionCount++;
    tracer.icEvent(
      this.siteId,
      prevState,
      this.state,
      targetId,
      entry.argCount,
    );
  }

  invalidate() {
    this.state = IC_UNINITIALIZED;
    this.entries = [];
    this.transitionCount++;
  }

  getStats() {
    return {
      siteId: this.siteId,
      type: "call",
      state: this.state,
      hitCount: this.hitCount,
      missCount: this.missCount,
      transitionCount: this.transitionCount,
      entryCount: this.entries ? this.entries.length : 0,
    };
  }
}

export class InlineCache {
  constructor(siteId) {
    this.siteId = siteId;
    this.loadIC = new PropertyLoadIC(siteId + ":load");
    this.storeIC = new PropertyStoreIC(siteId + ":store");
    this.elementLoadIC = new ElementLoadIC(siteId + ":element-load");
    this.elementStoreIC = new ElementStoreIC(siteId + ":element-store");
    this.callIC = new CallIC(siteId + ":call");
  }

  get state() {
    if (this.loadIC.state !== IC_UNINITIALIZED) return this.loadIC.state;
    if (this.elementLoadIC.state !== IC_UNINITIALIZED)
      return this.elementLoadIC.state;
    if (this.elementStoreIC.state !== IC_UNINITIALIZED)
      return this.elementStoreIC.state;
    if (this.callIC.state !== IC_UNINITIALIZED) return this.callIC.state;
    return this.storeIC.state;
  }

  get entries() {
    if (this.loadIC.state !== IC_UNINITIALIZED) return this.loadIC.entries;
    if (this.elementLoadIC.state !== IC_UNINITIALIZED)
      return this.elementLoadIC.entries;
    if (this.elementStoreIC.state !== IC_UNINITIALIZED)
      return this.elementStoreIC.entries;
    if (this.callIC.state !== IC_UNINITIALIZED) return this.callIC.entries;
    return this.storeIC.entries;
  }

  lookup(obj, propertyName) {
    return this.loadIC.lookup(obj, propertyName);
  }

  lookupForWrite(obj, propertyName, value) {
    return this.storeIC.store(obj, propertyName, value);
  }

  lookupElement(arrayObj, index) {
    return this.elementLoadIC.lookup(arrayObj, index);
  }

  lookupElementForWrite(arrayObj, index, value) {
    return this.elementStoreIC.store(arrayObj, index, value);
  }

  lookupCall(callee, argCount, receiver = null) {
    return this.callIC.lookup(callee, argCount, receiver);
  }

  invalidate() {
    this.loadIC.invalidate();
    this.storeIC.invalidate();
    this.elementLoadIC.invalidate();
    this.elementStoreIC.invalidate();
    this.callIC.invalidate();
  }

  getStats() {
    return {
      siteId: this.siteId,
      load: this.loadIC.getStats(),
      store: this.storeIC.getStats(),
      elementLoad: this.elementLoadIC.getStats(),
      elementStore: this.elementStoreIC.getStats(),
      call: this.callIC.getStats(),
    };
  }

  toString() {
    return `IC[${this.siteId}] {\n  ${this.loadIC}\n  ${this.storeIC}\n}`;
  }
}

export class InlineCacheManager {
  constructor() {
    this.caches = new Map();
    this.hiddenClassToICs = new Map();
  }

  getOrCreate(siteId) {
    if (!this.caches.has(siteId)) {
      this.caches.set(siteId, new InlineCache(siteId));
    }
    return this.caches.get(siteId);
  }

  get(siteId) {
    return this.caches.get(siteId);
  }

  registerHiddenClassUsage(hiddenClassId, siteId) {
    if (!this.hiddenClassToICs.has(hiddenClassId)) {
      this.hiddenClassToICs.set(hiddenClassId, new Set());
    }
    this.hiddenClassToICs.get(hiddenClassId).add(siteId);
  }

  invalidateForHiddenClass(hiddenClassId) {
    const siteIds = this.hiddenClassToICs.get(hiddenClassId);
    if (!siteIds) return 0;

    let invalidated = 0;
    for (const siteId of siteIds) {
      const ic = this.caches.get(siteId);
      if (ic) {
        ic.invalidate();
        invalidated++;
      }
    }
    this.hiddenClassToICs.delete(hiddenClassId);
    return invalidated;
  }

  invalidateDeprecatedMaps() {
    let invalidated = 0;
    for (const [hcId, siteIds] of this.hiddenClassToICs) {
      if (isMapDeprecated(hcId)) {
        for (const siteId of siteIds) {
          const ic = this.caches.get(siteId);
          if (ic) {
            ic.invalidate();
            invalidated++;
          }
        }
        this.hiddenClassToICs.delete(hcId);
      }
    }
    if (invalidated > 0) {
      tracer.log(
        "ic",
        `Invalidated ${invalidated} IC sites for deprecated maps`,
      );
    }
    return invalidated;
  }

  flush() {
    this.caches.clear();
    this.hiddenClassToICs.clear();
  }

  collectStats() {
    const stats = {
      totalCaches: this.caches.size,
      monomorphicLoads: 0,
      polymorphicLoads: 0,
      megamorphicLoads: 0,
      monomorphicStores: 0,
      polymorphicStores: 0,
      megamorphicStores: 0,
      totalHits: 0,
      totalMisses: 0,
      jitCandidates: 0,
      perSite: [],
    };

    for (const [siteId, ic] of this.caches) {
      const loadStats = ic.loadIC.getStats();
      const storeStats = ic.storeIC.getStats();

      if (loadStats.state === IC_MONOMORPHIC) stats.monomorphicLoads++;
      else if (loadStats.state === IC_POLYMORPHIC) stats.polymorphicLoads++;
      else if (loadStats.state === IC_MEGAMORPHIC) stats.megamorphicLoads++;

      if (storeStats.state === IC_MONOMORPHIC) stats.monomorphicStores++;
      else if (storeStats.state === IC_POLYMORPHIC) stats.polymorphicStores++;
      else if (storeStats.state === IC_MEGAMORPHIC) stats.megamorphicStores++;

      stats.totalHits += loadStats.hitCount + storeStats.hitCount;
      stats.totalMisses += loadStats.missCount + storeStats.missCount;

      if (loadStats.jitCandidate || storeStats.jitCandidate)
        stats.jitCandidates++;

      stats.perSite.push({ siteId, load: loadStats, store: storeStats });
    }

    return stats;
  }

  reportPolymorphism() {
    const report = [];
    for (const [siteId, ic] of this.caches) {
      const loadState = ic.loadIC.state;
      const storeState = ic.storeIC.state;
      if (
        loadState === IC_POLYMORPHIC ||
        loadState === IC_MEGAMORPHIC ||
        storeState === IC_POLYMORPHIC ||
        storeState === IC_MEGAMORPHIC
      ) {
        report.push({
          siteId,
          loadState,
          storeState,
          loadEntries: ic.loadIC.entries ? ic.loadIC.entries.length : 0,
          storeEntries: ic.storeIC.entries ? ic.storeIC.entries.length : 0,
        });
      }
    }
    return report;
  }

  getJitCandidates() {
    const candidates = [];
    for (const [siteId, ic] of this.caches) {
      if (ic.loadIC.jitCandidate || ic.storeIC.jitCandidate) {
        candidates.push({
          siteId,
          loadJit: ic.loadIC.jitCandidate,
          storeJit: ic.storeIC.jitCandidate,
        });
      }
    }
    return candidates;
  }

  toString() {
    const lines = [];
    lines.push(`InlineCacheManager: ${this.caches.size} caches`);
    for (const [siteId, ic] of this.caches) {
      lines.push(`  ${ic}`);
    }
    return lines.join("\n");
  }
}
