import { createJSObject } from "../objects/heap/factory.js";
import { mkObject, mkUndefined } from "../core/value/index.js";
import { tracer } from "../core/tracing/index.js";

export class ObjectMaterializer {
  materialize(sunkAllocations, runtimeValues) {
    if (!sunkAllocations || sunkAllocations.size === 0) return new Map();

    const materialized = new Map();

    for (const [allocId, virtualState] of sunkAllocations) {
      const obj = createJSObject();

      if (virtualState.props) {
        for (const [propName, valueNode] of virtualState.props) {
          const val = this._resolveValue(
            valueNode,
            runtimeValues,
            materialized,
          );
          obj.setProperty(propName, val);
        }
      }

      if (virtualState.fields) {
        for (const [offset, valueNode] of virtualState.fields) {
          const val = this._resolveValue(
            valueNode,
            runtimeValues,
            materialized,
          );
          while (obj.slots.length <= offset) {
            obj.slots.push(undefined);
          }
          obj.slots[offset] = val;
        }
      }

      materialized.set(allocId, mkObject(obj));
      tracer.log("deopt", `Materialized sunk allocation v${allocId}`);
    }

    return materialized;
  }

  _resolveValue(valueNode, runtimeValues, materialized) {
    if (valueNode === null || valueNode === undefined) {
      return mkUndefined();
    }

    if (typeof valueNode === "number") {
      return valueNode;
    }

    if (typeof valueNode === "object" && valueNode.id !== undefined) {
      if (materialized.has(valueNode.id)) {
        return materialized.get(valueNode.id);
      }

      if (runtimeValues && runtimeValues.has(valueNode.id)) {
        return runtimeValues.get(valueNode.id);
      }

      if (valueNode.type === "Constant" && valueNode.props) {
        return valueNode.props.value !== undefined
          ? valueNode.props.value
          : mkUndefined();
      }
    }

    return mkUndefined();
  }
}
