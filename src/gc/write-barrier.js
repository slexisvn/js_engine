import { getPayload } from "../core/value/index.js";

let _gc = null;

export function bindWriteBarrierGC(gc) {
  _gc = gc;
}

export function storeBarrier(holder, newRef) {
  if (!_gc || !holder || !holder.gcHeader) return;
  if (!newRef || !newRef.gcHeader) return;

  if (
    holder.gcHeader.generation === "old" &&
    newRef.gcHeader.generation === "young"
  ) {
    _gc.rememberedSet.record(holder);
  }

  if (_gc.isIncrementalMarkingActive()) {
    _gc.incrementalWriteBarrier(holder, newRef);
  }
}

export function storeBarrierForTaggedValue(holder, taggedValue) {
  if (!_gc || !holder || !holder.gcHeader) return;
  const innerObj = getPayload(taggedValue);
  if (!innerObj || typeof innerObj !== "object" || !innerObj.gcHeader) return;
  storeBarrier(holder, innerObj);
}
