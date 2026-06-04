import {
  ROOT_HIDDEN_CLASS,
  PropertyDescriptor,
  isMapDeprecated,
} from "../maps/hidden-class.js";
import { tracer } from "../../core/tracing/index.js";
import {
  dependencyRegistry,
  DEP_ELEMENTS_KIND,
  DEP_MAP,
  DEP_PROTO_VALIDITY,
} from "../../deopt/dependencies.js";
import {
  getPayload,
  getTag,
  isNull,
  isUndefined,
  strictEqual,
  toDisplayString,
  toNumber,
} from "../../core/value/index.js";
import { storeBarrierForTaggedValue } from "../../gc/write-barrier.js";
import {
  HOLEY_TAGGED,
  PACKED_SMI,
  inferElementsKind,
  isHoleyElementsKind,
  makeHoleyElementsKind,
  mergeElementsKind,
} from "../elements/elements-kind.js";

const MAX_IN_OBJECT_PROPERTIES = 10;

export class JSArray {
  constructor(elements) {
    this.elements = elements ? [...elements] : [];
    this.elementsKind = inferElementsKind(this.elements);
    this.hiddenClass = ROOT_HIDDEN_CLASS;
    this.hiddenClass.incrementObjectCount();
    this.slots = [];
    this.overflowProperties = new Map();
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

  hasSymbolProperty(taggedSym) {
    if (!this.symbolProperties) return false;
    return this.symbolProperties.has(getPayload(taggedSym));
  }

  visitReferences(callback) {
    for (let i = 0; i < this.elements.length; i++) {
      const el = this.elements[i];
      const payload = getPayload(el);
      if (payload && typeof payload === "object" && payload.gcHeader) {
        callback(payload);
      }
    }
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      const payload = getPayload(slot);
      if (payload && typeof payload === "object" && payload.gcHeader) {
        callback(payload);
      }
    }
    for (const val of this.overflowProperties.values()) {
      const payload = getPayload(val);
      if (payload && typeof payload === "object" && payload.gcHeader) {
        callback(payload);
      }
    }
  }

  getIndex(index) {
    if (index >= 0 && index < this.elements.length) {
      return this.elements[index];
    }
    return undefined;
  }

  setIndex(index, value) {
    const oldLength = this.elements.length;
    const makesHole = index > oldLength;
    const oldKind = this.elementsKind;
    this.elementsKind = mergeElementsKind(this.elementsKind, value, makesHole);
    if (oldKind !== this.elementsKind) {
      dependencyRegistry.invalidate(
        DEP_ELEMENTS_KIND,
        oldKind,
        null,
        `elements-kind:${oldKind}->${this.elementsKind}`,
      );
    }
    if (index >= this.elements.length) {
      for (let i = this.elements.length; i < index; i++) {
        this.elements.push(undefined);
      }
      this.elements[index] = value;
    } else {
      this.elements[index] = value;
    }
    storeBarrierForTaggedValue(this, value);
  }

  getLength() {
    return this.elements.length;
  }

  setLength(len) {
    if (len < this.elements.length) {
      this.elements.length = len;
    } else {
      if (len > this.elements.length) {
        const oldKind = this.elementsKind;
        this.elementsKind = makeHoleyElementsKind(this.elementsKind);
        if (oldKind !== this.elementsKind) {
          dependencyRegistry.invalidate(
            DEP_ELEMENTS_KIND,
            oldKind,
            null,
            `elements-kind:${oldKind}->${this.elementsKind}`,
          );
        }
      }
      while (this.elements.length < len) {
        this.elements.push(undefined);
      }
    }
  }

  push(...values) {
    const oldKind = this.elementsKind;
    let newKind = this.elementsKind;
    for (let i = 0; i < values.length; i++) {
      newKind = mergeElementsKind(newKind, values[i]);
      this.elements.push(values[i]);
      storeBarrierForTaggedValue(this, values[i]);
    }
    if (newKind !== oldKind) {
      this.elementsKind = newKind;
      dependencyRegistry.invalidate(
        DEP_ELEMENTS_KIND,
        oldKind,
        null,
        `elements-kind:${oldKind}->${newKind}`,
      );
    }
    return this.elements.length;
  }

  pop() {
    if (this.elements.length === 0) return undefined;
    return this.elements.pop();
  }

  shift() {
    if (this.elements.length === 0) return undefined;
    return this.elements.shift();
  }

  unshift(...values) {
    for (let i = values.length - 1; i >= 0; i--) {
      const oldKind = this.elementsKind;
      this.elementsKind = mergeElementsKind(this.elementsKind, values[i]);
      if (oldKind !== this.elementsKind) {
        dependencyRegistry.invalidate(
          DEP_ELEMENTS_KIND,
          oldKind,
          null,
          `elements-kind:${oldKind}->${this.elementsKind}`,
        );
      }
      this.elements.unshift(values[i]);
    }
    return this.elements.length;
  }

  splice(start, deleteCount, ...items) {
    const len = this.elements.length;
    let actualStart =
      start < 0 ? Math.max(len + start, 0) : Math.min(start, len);
    let actualDeleteCount;
    if (deleteCount === undefined) {
      actualDeleteCount = len - actualStart;
    } else {
      actualDeleteCount = Math.min(Math.max(deleteCount, 0), len - actualStart);
    }

    const removed = [];
    for (let i = 0; i < actualDeleteCount; i++) {
      removed.push(this.elements[actualStart + i]);
    }

    const tail = this.elements.slice(actualStart + actualDeleteCount);
    this.elements.length = actualStart;
    for (let i = 0; i < items.length; i++) {
      const oldKind = this.elementsKind;
      this.elementsKind = mergeElementsKind(this.elementsKind, items[i]);
      if (oldKind !== this.elementsKind) {
        dependencyRegistry.invalidate(
          DEP_ELEMENTS_KIND,
          oldKind,
          null,
          `elements-kind:${oldKind}->${this.elementsKind}`,
        );
      }
      this.elements.push(items[i]);
    }
    for (let i = 0; i < tail.length; i++) {
      this.elements.push(tail[i]);
    }

    return removed;
  }

  indexOf(target, fromIndex) {
    const start =
      fromIndex !== undefined
        ? fromIndex < 0
          ? Math.max(this.elements.length + fromIndex, 0)
          : fromIndex
        : 0;
    for (let i = start; i < this.elements.length; i++) {
      const el = this.elements[i];
      if (strictEqual(el, target)) return i;
    }
    return -1;
  }

  includes(target, fromIndex) {
    return this.indexOf(target, fromIndex) !== -1;
  }

  find(predicate) {
    for (let i = 0; i < this.elements.length; i++) {
      if (predicate(this.elements[i], i, this)) return this.elements[i];
    }
    return undefined;
  }

  findIndex(predicate) {
    for (let i = 0; i < this.elements.length; i++) {
      if (predicate(this.elements[i], i, this)) return i;
    }
    return -1;
  }

  forEach(callback) {
    for (let i = 0; i < this.elements.length; i++) {
      callback(this.elements[i], i, this);
    }
  }

  map(callback) {
    const result = [];
    for (let i = 0; i < this.elements.length; i++) {
      result.push(callback(this.elements[i], i, this));
    }
    return new JSArray(result);
  }

  filter(predicate) {
    const result = [];
    for (let i = 0; i < this.elements.length; i++) {
      if (predicate(this.elements[i], i, this)) {
        result.push(this.elements[i]);
      }
    }
    return new JSArray(result);
  }

  reduce(callback, initialValue) {
    let accumulator;
    let startIndex;
    if (initialValue !== undefined) {
      accumulator = initialValue;
      startIndex = 0;
    } else {
      if (this.elements.length === 0) {
        throw new TypeError("Reduce of empty array with no initial value");
      }
      accumulator = this.elements[0];
      startIndex = 1;
    }
    for (let i = startIndex; i < this.elements.length; i++) {
      accumulator = callback(accumulator, this.elements[i], i, this);
    }
    return accumulator;
  }

  concat(...arrays) {
    const result = [...this.elements];
    for (let i = 0; i < arrays.length; i++) {
      const other = arrays[i];
      if (other instanceof JSArray) {
        for (let j = 0; j < other.elements.length; j++) {
          result.push(other.elements[j]);
        }
      } else if (Array.isArray(other)) {
        for (let j = 0; j < other.length; j++) {
          result.push(other[j]);
        }
      } else {
        result.push(other);
      }
    }
    return new JSArray(result);
  }

  slice(start, end) {
    const len = this.elements.length;
    let s =
      start === undefined
        ? 0
        : start < 0
          ? Math.max(len + start, 0)
          : Math.min(start, len);
    let e =
      end === undefined
        ? len
        : end < 0
          ? Math.max(len + end, 0)
          : Math.min(end, len);
    const result = [];
    for (let i = s; i < e; i++) {
      result.push(this.elements[i]);
    }
    return new JSArray(result);
  }

  join(separator) {
    const sep = separator !== undefined ? String(separator) : ",";
    const parts = [];
    for (let i = 0; i < this.elements.length; i++) {
      const el = this.elements[i];
      if (el === undefined || el === null) {
        parts.push("");
      } else {
        const tag = getTag(el);
        if (tag === "undefined" || tag === "null") {
          parts.push("");
        } else {
          parts.push(toDisplayString(el));
        }
      }
    }
    return parts.join(sep);
  }

  reverse() {
    this.elements.reverse();
    return this;
  }

  sort(compareFn) {
    if (compareFn) {
      this.elements.sort(compareFn);
    } else {
      this.elements.sort((a, b) => {
        const aStr = toDisplayString(a);
        const bStr = toDisplayString(b);
        if (aStr < bStr) return -1;
        if (aStr > bStr) return 1;
        return 0;
      });
    }
    return this;
  }

  getElementsKind() {
    return this.elementsKind;
  }

  getProperty(name) {
    if (name === "length") return this.elements.length;
    const desc = this.hiddenClass.lookupProperty(name);
    if (desc) {
      if (desc.offset < MAX_IN_OBJECT_PROPERTIES) {
        return this.slots[desc.offset];
      }
      return this.overflowProperties.get(name);
    }
    return undefined;
  }

  setProperty(name, value) {
    if (name === "length") {
      const len = toNumber(value);
      this.setLength(len);
      return;
    }
    const desc = this.hiddenClass.lookupProperty(name);
    if (desc) {
      if (desc.offset < MAX_IN_OBJECT_PROPERTIES) {
        this.slots[desc.offset] = value;
      } else {
        this.overflowProperties.set(name, value);
      }
      dependencyRegistry.invalidate(
        DEP_MAP,
        this.hiddenClass.id,
        this.hiddenClass.version,
        `array-store:${name}`,
      );
    } else {
      this.hiddenClass.decrementObjectCount();
      const newHC = this.hiddenClass.transition(name);
      if (newHC) {
        this.hiddenClass = newHC;
        this.hiddenClass.incrementObjectCount();
        const newDesc = newHC.lookupProperty(name);
        if (newDesc.offset < MAX_IN_OBJECT_PROPERTIES) {
          while (this.slots.length <= newDesc.offset) {
            this.slots.push(undefined);
          }
          this.slots[newDesc.offset] = value;
        } else {
          this.overflowProperties.set(name, value);
        }
      }
    }
  }

  getMapId() {
    return this.hiddenClass.id;
  }

  toString() {
    const items = this.elements.map((el) => {
      if (el === undefined || isUndefined(el)) return "undefined";
      if (isNull(el)) return "null";
      return `${getTag(el)}:${toDisplayString(el)}`;
    });
    return `[${items.join(", ")}]`;
  }
}
