import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { allocationSinking } from "../../src/optimizing/passes/allocation-sinking.js";
import { ObjectMaterializer } from "../../src/deopt/materializer.js";
import { FrameState } from "../../src/deopt/frame-state.js";
import {
  IRGraph,
  IRNode,
  IR_NEW_OBJECT,
  IR_DEOPTIMIZE,
  IR_RETURN,
  IR_GENERIC_SET_PROP,
  irConstant,
  irJump,
} from "../../src/optimizing/ir/index.js";
import { validateOptimizedGraph } from "../../src/optimizing/validation/graph-validator.js";
import {
  mkSmi,
  mkObject,
  mkUndefined,
  getTag,
  getPayload,
} from "../../src/core/value/index.js";
import { resetHiddenClasses } from "../../src/objects/maps/hidden-class.js";

function makeNode(type, id, inputs = [], props = {}) {
  const node = { type, id, inputs, uses: [], props };
  for (const inp of inputs) {
    if (inp && inp.uses) inp.uses.push(node);
  }
  return node;
}

function makeGraph(blocks) {
  return {
    blocks: blocks.map((nodes, i) => ({ id: i, nodes })),
    name: "test",
  };
}

function frameState(name) {
  const state = new FrameState({ name }, 0);
  state.id = 0;
  return state;
}

describe("allocationSinking", () => {
  it("returns zero when no allocations exist", () => {
    const graph = makeGraph([[]]);
    const result = allocationSinking(graph);
    assert.equal(result.sunkCount, 0);
  });

  it("does not sink allocation that escapes via return", () => {
    const alloc = makeNode(IR_NEW_OBJECT, 1);
    const ret = makeNode(IR_RETURN, 2, [alloc]);
    const graph = makeGraph([[alloc, ret]]);
    const result = allocationSinking(graph);
    assert.equal(result.sunkCount, 0);
    assert.ok(graph.blocks[0].nodes.includes(alloc));
  });

  it("sinks allocation that escapes only via deopt", () => {
    const alloc = makeNode(IR_NEW_OBJECT, 1);
    const deopt = makeNode(IR_DEOPTIMIZE, 2, [alloc], { reason: "test" });
    const graph = makeGraph([[alloc, deopt]]);
    const result = allocationSinking(graph);
    assert.equal(result.sunkCount, 1);
    assert.ok(!graph.blocks[0].nodes.some((n) => n.type === IR_NEW_OBJECT));
  });

  it("records virtual state on deopt nodes", () => {
    const alloc = makeNode(IR_NEW_OBJECT, 1);
    const valNode = makeNode("Constant", 3, [], { value: mkSmi(42) });
    const setProp = makeNode(IR_GENERIC_SET_PROP, 4, [alloc, valNode], {
      propName: "x",
    });
    const deopt = makeNode(IR_DEOPTIMIZE, 2, [alloc], { reason: "test" });
    const graph = makeGraph([[valNode, alloc, setProp, deopt]]);
    const result = allocationSinking(graph);
    assert.equal(result.sunkCount, 1);
    assert.ok(deopt.props.sunkAllocations);
    assert.ok(deopt.props.sunkAllocations.has(1));
    const state = deopt.props.sunkAllocations.get(1);
    assert.ok(state.props.has("x"));
  });

  it("does not sink when allocation fully escapes", () => {
    const alloc = makeNode(IR_NEW_OBJECT, 1);
    const call = makeNode("GenericCall", 2, [alloc]);
    const graph = makeGraph([[alloc, call]]);
    const result = allocationSinking(graph);
    assert.equal(result.sunkCount, 0);
  });

  it("removes sunk allocation inputs and stale uses from deopt-only graphs", () => {
    const graph = new IRGraph("allocation-sinking-use-lists");
    const block = graph.addBlock();
    const state = frameState("allocation-sinking-use-lists");
    const alloc = new IRNode(IR_NEW_OBJECT);
    const value = irConstant(42);
    const store = new IRNode(IR_GENERIC_SET_PROP, { propName: "x" });
    store.addInput(alloc);
    store.addInput(value);
    const deopt = new IRNode(IR_DEOPTIMIZE, { reason: "test" });
    deopt.addInput(alloc);
    deopt.frameState = state;
    block.addNode(alloc);
    block.addNode(value);
    block.addNode(store);
    block.addNode(deopt);

    graph.rebuildUses();
    const result = allocationSinking(graph);

    assert.equal(result.sunkCount, 1);
    assert.equal(deopt.inputs.length, 0);
    assert.equal(alloc.uses.length, 0);
    assert.equal(value.uses.length, 0);
    assert.equal(validateOptimizedGraph(graph, [state]), true);
  });

  it("removes safe uses from dominated blocks when sinking to deopt metadata", () => {
    const graph = new IRGraph("allocation-sinking-cross-block");
    const entry = graph.addBlock();
    const exit = graph.addBlock();
    const state = frameState("allocation-sinking-cross-block");
    const alloc = new IRNode(IR_NEW_OBJECT);
    const value = irConstant(17);
    const store = new IRNode(IR_GENERIC_SET_PROP, { propName: "field" });
    store.addInput(alloc);
    store.addInput(value);
    const jump = irJump(exit);
    const deopt = new IRNode(IR_DEOPTIMIZE, { reason: "test" });
    deopt.addInput(alloc);
    deopt.frameState = state;
    entry.addNode(alloc);
    entry.addNode(value);
    entry.addNode(jump);
    entry.addSuccessor(exit);
    exit.addNode(store);
    exit.addNode(deopt);

    graph.rebuildUses();
    const result = allocationSinking(graph);

    assert.equal(result.sunkCount, 1);
    assert.equal(exit.nodes.includes(store), false);
    assert.equal(
      deopt.props.sunkAllocations.get(alloc.id).props.get("field"),
      value,
    );
    assert.equal(validateOptimizedGraph(graph, [state]), true);
  });
});

describe("ObjectMaterializer", () => {
  it("materializes empty object", () => {
    resetHiddenClasses();
    const materializer = new ObjectMaterializer();
    const sunkAllocs = new Map();
    sunkAllocs.set(1, { fields: new Map(), props: new Map() });

    const result = materializer.materialize(sunkAllocs, new Map());
    assert.ok(result.has(1));
    assert.equal(getTag(result.get(1)), "object");
  });

  it("materializes object with properties", () => {
    resetHiddenClasses();
    const materializer = new ObjectMaterializer();
    const sunkAllocs = new Map();
    sunkAllocs.set(1, {
      fields: new Map(),
      props: new Map([["x", mkSmi(42)]]),
    });

    const result = materializer.materialize(sunkAllocs, new Map());
    const obj = result.get(1);
    assert.equal(getTag(obj), "object");
    assert.equal(getPayload(getPayload(obj).getProperty("x")), 42);
  });

  it("materializes object with fields by offset", () => {
    resetHiddenClasses();
    const materializer = new ObjectMaterializer();
    const sunkAllocs = new Map();
    sunkAllocs.set(1, {
      fields: new Map([
        [0, mkSmi(10)],
        [1, mkSmi(20)],
      ]),
      props: new Map(),
    });

    const result = materializer.materialize(sunkAllocs, new Map());
    const obj = result.get(1);
    assert.equal(getPayload(getPayload(obj).slots[0]), 10);
    assert.equal(getPayload(getPayload(obj).slots[1]), 20);
  });

  it("resolves values from runtimeValues map", () => {
    resetHiddenClasses();
    const materializer = new ObjectMaterializer();
    const irNode = { id: 5, type: "Constant", props: {} };
    const sunkAllocs = new Map();
    sunkAllocs.set(1, {
      fields: new Map(),
      props: new Map([["val", irNode]]),
    });

    const runtimeValues = new Map();
    runtimeValues.set(5, mkSmi(99));

    const result = materializer.materialize(sunkAllocs, runtimeValues);
    const obj = result.get(1);
    assert.equal(getPayload(getPayload(obj).getProperty("val")), 99);
  });

  it("returns empty map when no sunk allocations", () => {
    const materializer = new ObjectMaterializer();
    const result = materializer.materialize(null, new Map());
    assert.equal(result.size, 0);
  });
});
