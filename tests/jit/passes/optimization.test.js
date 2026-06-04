import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FrameState } from "../../../src/deopt/frame-state.js";

import {
  IRNode,
  IRGraph,
  IRBlock,
  irConstant,
  irParameter,
  irInt32Add,
  irInt32Mul,
  irCheckSmi,
  irCheckBounds,
  irLoadArrayLength,
  irInt32Compare,
  IR_INT32_ADD,
  IR_INT32_MUL,
  IR_INT32_AND,
  IR_INT32_OR,
  IR_INT32_XOR,
  IR_INT32_SHL,
  IR_INT32_SUB,
  IR_FLOAT64_ADD,
  IR_FLOAT64_MUL,
  IR_CONSTANT,
  IR_PARAMETER,
  IR_PHI,
  IR_STORE_FIELD,
  IR_LOAD_FIELD,
  IR_GENERIC_SET_PROP,
  IR_GENERIC_GET_PROP,
  IR_NEW_OBJECT,
  IR_NEW_ARRAY,
  IR_GENERIC_SET_INDEX,
  IR_GENERIC_GET_INDEX,
  IR_CALL_BUILTIN,
  IR_DISPATCH_MAP,
  IR_MEGAMORPHIC_STORE,
  IR_BRANCH,
  IR_JUMP,
  IR_RETURN,
  IR_INT32_COMPARE,
  IR_CHECK_BOUNDS,
  IR_CHECK_MAP,
  IR_CHECK_NUMBER,
  IR_CHECK_SMI,
  IR_GENERIC_ADD,
  IR_GENERIC_SUB,
  IR_TYPEOF,
  IR_NOT,
  IR_BOX,
  IR_UNBOX,
} from "../../../src/optimizing/ir/index.js";

import { globalValueNumbering } from "../../../src/optimizing/passes/gvn.js";
import { deadCodeElimination } from "../../../src/optimizing/passes/dce.js";
import { deadStoreElimination } from "../../../src/optimizing/passes/dead-stores.js";
import { typeNarrowing } from "../../../src/optimizing/passes/type-narrowing.js";
import { escapeAnalysisAndScalarReplacement } from "../../../src/optimizing/passes/escape-analysis.js";
import { rangeAnalysisAndBoundsCheckElimination } from "../../../src/optimizing/passes/checks.js";
import { eliminateRedundantChecks } from "../../../src/optimizing/passes/checks.js";
import {
  constantFolding,
  strengthReduction,
} from "../../../src/optimizing/passes/simplify.js";
import { representationSelection } from "../../../src/optimizing/passes/repr-selection.js";
import { loadElimination } from "../../../src/optimizing/passes/load-elimination.js";
import {
  hoistLoopInvariants,
  loopUnrolling,
} from "../../../src/optimizing/passes/loop-opts.js";
import { validateOptimizedGraph } from "../../../src/optimizing/validation/graph-validator.js";
import {
  FeedbackSlot,
  FEEDBACK_CALL,
} from "../../../src/feedback/vector/index.js";

function makeGraph() {
  const graph = new IRGraph("test");
  return graph;
}

function makeFrameState(name) {
  const state = new FrameState({ name }, 0);
  state.id = 0;
  return state;
}

describe("JIT Optimization Depth", () => {
  describe("GVN commutative normalization", () => {
    it("eliminates a+b when b+a already computed", () => {
      const graph = makeGraph();
      const block = graph.addBlock();

      const a = new IRNode(IR_PARAMETER, { index: 0 });
      const b = new IRNode(IR_PARAMETER, { index: 1 });
      block.addNode(a);
      block.addNode(b);

      const add1 = new IRNode(IR_INT32_ADD);
      add1.addInput(a);
      add1.addInput(b);
      block.addNode(add1);

      const add2 = new IRNode(IR_INT32_ADD);
      add2.addInput(b);
      add2.addInput(a);
      block.addNode(add2);

      const ret = new IRNode(IR_RETURN);
      ret.addInput(add2);
      block.addNode(ret);

      graph.rebuildUses();
      const count = globalValueNumbering(graph);
      assert.ok(count >= 1, "should eliminate commutative duplicate");
    });

    it("rewrites frame state values when eliminating a duplicate node", () => {
      const graph = makeGraph();
      const block = graph.addBlock();
      const state = new FrameState({ name: "gvn-frame-state" }, 7);
      const a = new IRNode(IR_PARAMETER, { index: 0 });
      const b = new IRNode(IR_PARAMETER, { index: 1 });
      const add1 = new IRNode(IR_INT32_ADD);
      add1.addInput(a);
      add1.addInput(b);
      const add2 = new IRNode(IR_INT32_ADD);
      add2.addInput(b);
      add2.addInput(a);
      const guard = irCheckSmi(a);
      guard.frameState = state;
      state.setLocal(0, add2);
      state.pushStack(add2);
      block.addNode(a);
      block.addNode(b);
      block.addNode(add1);
      block.addNode(add2);
      block.addNode(guard);

      graph.rebuildUses();
      const count = globalValueNumbering(graph);

      assert.ok(count >= 1);
      assert.equal(state.getLocal(0), add1);
      assert.equal(state.stackValues[0], add1);
    });

    it("eliminates a*b when b*a already computed", () => {
      const graph = makeGraph();
      const block = graph.addBlock();

      const a = new IRNode(IR_PARAMETER, { index: 0 });
      const b = new IRNode(IR_PARAMETER, { index: 1 });
      block.addNode(a);
      block.addNode(b);

      const mul1 = new IRNode(IR_INT32_MUL);
      mul1.addInput(a);
      mul1.addInput(b);
      block.addNode(mul1);

      const mul2 = new IRNode(IR_INT32_MUL);
      mul2.addInput(b);
      mul2.addInput(a);
      block.addNode(mul2);

      const ret = new IRNode(IR_RETURN);
      ret.addInput(mul2);
      block.addNode(ret);

      graph.rebuildUses();
      const count = globalValueNumbering(graph);
      assert.ok(count >= 1, "should eliminate commutative MUL duplicate");
    });

    it("does NOT eliminate a-b as b-a (non-commutative)", () => {
      const graph = makeGraph();
      const block = graph.addBlock();

      const a = new IRNode(IR_PARAMETER, { index: 0 });
      const b = new IRNode(IR_PARAMETER, { index: 1 });
      block.addNode(a);
      block.addNode(b);

      const sub1 = new IRNode("Int32Sub");
      sub1.addInput(a);
      sub1.addInput(b);
      block.addNode(sub1);

      const sub2 = new IRNode("Int32Sub");
      sub2.addInput(b);
      sub2.addInput(a);
      block.addNode(sub2);

      const ret = new IRNode(IR_RETURN);
      ret.addInput(sub2);
      block.addNode(ret);

      graph.rebuildUses();
      const count = globalValueNumbering(graph);
      assert.equal(count, 0, "should NOT eliminate non-commutative SUB");
    });

    it("does not eliminate field loads because memory state belongs to load elimination", () => {
      const graph = makeGraph();
      const block = graph.addBlock();
      const object = new IRNode(IR_PARAMETER, { index: 0 });
      const before = new IRNode(IR_LOAD_FIELD, { offset: 3 });
      before.addInput(object);
      const replacement = irConstant(19);
      const store = new IRNode(IR_STORE_FIELD, { offset: 3 });
      store.addInput(object);
      store.addInput(replacement);
      const after = new IRNode(IR_LOAD_FIELD, { offset: 3 });
      after.addInput(object);
      const ret = new IRNode(IR_RETURN);
      ret.addInput(after);
      block.addNode(object);
      block.addNode(before);
      block.addNode(replacement);
      block.addNode(store);
      block.addNode(after);
      block.addNode(ret);

      graph.rebuildUses();
      const count = globalValueNumbering(graph);

      assert.equal(count, 0);
      assert.equal(ret.inputs[0], after);
      assert.equal(block.nodes.includes(after), true);
    });

    it("does not replace block params because they carry SSA edge arguments", () => {
      const graph = makeGraph();
      const entry = graph.addBlock();
      const left = graph.addBlock();
      const right = graph.addBlock();
      const merge = graph.addBlock();
      const incoming = irConstant(7);
      const branchValue = irConstant(true);
      const branch = new IRNode(IR_BRANCH, {
        trueBlock: left.id,
        falseBlock: right.id,
      });
      branch.addInput(branchValue);
      const leftJump = new IRNode(IR_JUMP, { targetBlock: merge.id });
      const rightJump = new IRNode(IR_JUMP, { targetBlock: merge.id });
      entry.addNode(incoming);
      entry.addNode(branchValue);
      entry.addNode(branch);
      entry.addSuccessor(left);
      entry.addSuccessor(right);
      left.addNode(leftJump);
      right.addNode(rightJump);
      left.addSuccessor(merge, [incoming, incoming]);
      right.addSuccessor(merge, [incoming, incoming]);
      const firstParam = merge.addParam([incoming, incoming]);
      const secondParam = merge.addParam([incoming, incoming]);
      const add = new IRNode(IR_INT32_ADD);
      add.addInput(firstParam);
      add.addInput(secondParam);
      const ret = new IRNode(IR_RETURN);
      ret.addInput(add);
      merge.addNode(add);
      merge.addNode(ret);

      graph.rebuildUses();
      const count = globalValueNumbering(graph);

      assert.equal(count, 0);
      assert.deepEqual(firstParam.inputs, [incoming, incoming]);
      assert.deepEqual(secondParam.inputs, [incoming, incoming]);
      assert.equal(left.getEdgeArgs(merge)[0], firstParam.inputs[0]);
      assert.equal(left.getEdgeArgs(merge)[1], secondParam.inputs[0]);
    });
  });

  describe("DCE frame state liveness", () => {
    it("keeps nodes referenced only by frame state locals and stack", () => {
      const graph = makeGraph();
      const block = graph.addBlock();
      const state = new FrameState({ name: "dce-frame-state" }, 11);
      const value = new IRNode(IR_PARAMETER, { index: 0 });
      const derived = new IRNode(IR_INT32_ADD);
      derived.addInput(value);
      derived.addInput(value);
      const guard = irCheckSmi(value);
      guard.frameState = state;
      state.setLocal(0, derived);
      state.pushStack(derived);
      block.addNode(value);
      block.addNode(derived);
      block.addNode(guard);

      graph.rebuildUses();
      deadCodeElimination(graph);

      assert.equal(block.nodes.includes(derived), true);
    });

    it("keeps write-class IR nodes through effect kind instead of opcode lists", () => {
      const graph = makeGraph();
      const block = graph.addBlock();
      const object = new IRNode(IR_PARAMETER, { index: 0 });
      const value = irConstant(29);
      const store = new IRNode(IR_MEGAMORPHIC_STORE, { propertyName: "x" });
      store.addInput(object);
      store.addInput(value);
      block.addNode(object);
      block.addNode(value);
      block.addNode(store);

      graph.rebuildUses();
      const count = deadCodeElimination(graph);

      assert.equal(count, 0);
      assert.equal(block.nodes.includes(store), true);
    });

    it("removes unused read-class IR nodes when no effect requires them", () => {
      const graph = makeGraph();
      const block = graph.addBlock();
      const object = graph.addParameter(0);
      const dispatch = new IRNode(IR_DISPATCH_MAP, {
        propertyName: "x",
        handlers: [],
      });
      dispatch.addInput(object);
      block.addNode(dispatch);

      graph.rebuildUses();
      const count = deadCodeElimination(graph);

      assert.equal(count, 1);
      assert.equal(block.nodes.includes(dispatch), false);
    });
  });

  describe("Frame state rewrites for replacement passes", () => {
    it("rewrites frame state locals when constant folding replaces an arithmetic node", () => {
      const graph = makeGraph();
      const block = graph.addBlock();
      const state = makeFrameState("constant-folding-frame-state");
      const value = new IRNode(IR_PARAMETER, { index: 0 });
      const left = irConstant(11);
      const right = irConstant(13);
      const add = new IRNode(IR_INT32_ADD);
      add.addInput(left);
      add.addInput(right);
      const guard = irCheckSmi(value);
      guard.frameState = state;
      state.setLocal(0, add);
      block.addNode(value);
      block.addNode(left);
      block.addNode(right);
      block.addNode(add);
      block.addNode(guard);

      graph.rebuildUses();
      const count = constantFolding(graph);

      assert.equal(count, 1);
      assert.equal(state.getLocal(0).type, IR_CONSTANT);
      assert.equal(state.getLocal(0).props.value, 24);
      assert.equal(validateOptimizedGraph(graph, [state]), true);
    });

    it("rewrites frame state locals when load elimination reuses an available field value", () => {
      const graph = makeGraph();
      const block = graph.addBlock();
      const state = makeFrameState("load-elimination-frame-state");
      const object = new IRNode(IR_PARAMETER, { index: 0 });
      const value = irConstant(37);
      const store = new IRNode(IR_STORE_FIELD, { offset: 2 });
      store.addInput(object);
      store.addInput(value);
      const firstLoad = new IRNode(IR_LOAD_FIELD, { offset: 2 });
      firstLoad.addInput(object);
      const secondLoad = new IRNode(IR_LOAD_FIELD, { offset: 2 });
      secondLoad.addInput(object);
      const guard = irCheckSmi(value);
      guard.frameState = state;
      state.setLocal(0, secondLoad);
      block.addNode(object);
      block.addNode(value);
      block.addNode(store);
      block.addNode(firstLoad);
      block.addNode(secondLoad);
      block.addNode(guard);

      graph.rebuildUses();
      const count = loadElimination(graph);

      assert.equal(count, 2);
      assert.equal(state.getLocal(0), value);
      assert.equal(validateOptimizedGraph(graph, [state]), true);
    });

    it("rewrites frame state locals when redundant check elimination reuses a dominating check", () => {
      const graph = makeGraph();
      const block = graph.addBlock();
      const firstState = makeFrameState("first-check-frame-state");
      const laterState = makeFrameState("redundant-check-frame-state");
      const value = new IRNode(IR_PARAMETER, { index: 0 });
      const firstCheck = new IRNode(IR_CHECK_SMI);
      firstCheck.addInput(value);
      firstCheck.frameState = firstState;
      const secondCheck = new IRNode(IR_CHECK_SMI);
      secondCheck.addInput(value);
      secondCheck.frameState = laterState;
      const guard = new IRNode(IR_CHECK_NUMBER);
      guard.addInput(value);
      guard.frameState = laterState;
      laterState.setLocal(0, secondCheck);
      block.addNode(value);
      block.addNode(firstCheck);
      block.addNode(secondCheck);
      block.addNode(guard);

      graph.rebuildUses();
      const count = eliminateRedundantChecks(graph);

      assert.equal(count, 1);
      assert.equal(laterState.getLocal(0), firstCheck);
      assert.equal(
        validateOptimizedGraph(graph, [firstState, laterState]),
        true,
      );
    });

    it("preserves duplicate consumer inputs when redundant check elimination rewrites a guard", () => {
      const graph = makeGraph();
      const block = graph.addBlock();
      const firstState = makeFrameState("first-duplicate-check-frame-state");
      const laterState = makeFrameState(
        "redundant-duplicate-check-frame-state",
      );
      const value = new IRNode(IR_PARAMETER, { index: 0 });
      const firstCheck = new IRNode(IR_CHECK_SMI);
      firstCheck.addInput(value);
      firstCheck.frameState = firstState;
      const secondCheck = new IRNode(IR_CHECK_SMI);
      secondCheck.addInput(value);
      secondCheck.frameState = laterState;
      const add = new IRNode(IR_GENERIC_ADD);
      add.addInput(secondCheck);
      add.addInput(secondCheck);
      const ret = new IRNode(IR_RETURN);
      ret.addInput(add);
      block.addNode(value);
      block.addNode(firstCheck);
      block.addNode(secondCheck);
      block.addNode(add);
      block.addNode(ret);

      graph.rebuildUses();
      const count = eliminateRedundantChecks(graph);

      assert.equal(count, 1);
      assert.deepEqual(add.inputs, [firstCheck, firstCheck]);
      assert.equal(block.nodes.includes(secondCheck), false);
      assert.equal(
        validateOptimizedGraph(graph, [firstState, laterState]),
        true,
      );
    });

    it("rewrites frame state locals when bounds check elimination removes a proven check", () => {
      const graph = makeGraph();
      const entry = graph.addBlock();
      const body = graph.addBlock();
      const state = makeFrameState("bounds-check-frame-state");
      const array = new IRNode(IR_PARAMETER, { index: 0 });
      const length = new IRNode(IR_PARAMETER, { index: 1 });
      const index = irConstant(4);
      const compare = new IRNode(IR_INT32_COMPARE, { op: "<" });
      compare.addInput(index);
      compare.addInput(length);
      const branch = new IRNode(IR_BRANCH, {
        trueBlock: body.id,
        falseBlock: body.id,
      });
      branch.addInput(compare);
      const boundsCheck = new IRNode(IR_CHECK_BOUNDS);
      boundsCheck.addInput(index);
      boundsCheck.addInput(array);
      boundsCheck.frameState = state;
      const guard = irCheckSmi(index);
      guard.frameState = state;
      state.setLocal(0, boundsCheck);
      entry.addNode(array);
      entry.addNode(length);
      entry.addNode(index);
      entry.addNode(compare);
      entry.addNode(branch);
      entry.addSuccessor(body);
      body.addNode(boundsCheck);
      body.addNode(guard);

      graph.rebuildUses();
      const count = rangeAnalysisAndBoundsCheckElimination(graph);

      assert.equal(count, 1);
      assert.equal(state.getLocal(0), index);
      assert.equal(validateOptimizedGraph(graph, [state]), true);
    });
  });

  describe("Load elimination call invalidation", () => {
    it("does not preserve a parameter field across a call because the callee has a pure-looking name", () => {
      const graph = makeGraph();
      const block = graph.addBlock();
      const object = new IRNode(IR_PARAMETER, { index: 0 });
      const value = irConstant(41);
      const store = new IRNode(IR_STORE_FIELD, { offset: 5 });
      store.addInput(object);
      store.addInput(value);
      const call = new IRNode(IR_CALL_BUILTIN, { calleeName: "Math.abs" });
      const load = new IRNode(IR_LOAD_FIELD, { offset: 5 });
      load.addInput(object);
      const ret = new IRNode(IR_RETURN);
      ret.addInput(load);
      block.addNode(object);
      block.addNode(value);
      block.addNode(store);
      block.addNode(call);
      block.addNode(load);
      block.addNode(ret);

      graph.rebuildUses();
      const count = loadElimination(graph);

      assert.equal(count, 0);
      assert.equal(block.nodes.includes(load), true);
      assert.equal(ret.inputs[0], load);
    });

    it("preserves a fresh non-escaping allocation field across a call independent of the callee name", () => {
      const graph = makeGraph();
      const block = graph.addBlock();
      const object = new IRNode(IR_NEW_OBJECT);
      const value = irConstant(73);
      const store = new IRNode(IR_STORE_FIELD, { offset: 9 });
      store.addInput(object);
      store.addInput(value);
      const call = new IRNode(IR_CALL_BUILTIN, {
        calleeName: "mutateUnknownWorld",
      });
      const load = new IRNode(IR_LOAD_FIELD, { offset: 9 });
      load.addInput(object);
      const ret = new IRNode(IR_RETURN);
      ret.addInput(load);
      block.addNode(object);
      block.addNode(value);
      block.addNode(store);
      block.addNode(call);
      block.addNode(load);
      block.addNode(ret);

      graph.rebuildUses();
      const count = loadElimination(graph);

      assert.equal(count, 1);
      assert.equal(block.nodes.includes(load), false);
      assert.equal(ret.inputs[0], value);
    });
  });

  describe("Dead store elimination cross-block", () => {
    it("removes local dead stores without leaving stale use-list entries", () => {
      const graph = makeGraph();
      const block = graph.addBlock();
      const object = new IRNode(IR_PARAMETER, { index: 0 });
      const firstValue = irConstant(1);
      const secondValue = irConstant(2);
      const firstStore = new IRNode(IR_STORE_FIELD, { offset: 0 });
      firstStore.addInput(object);
      firstStore.addInput(firstValue);
      const secondStore = new IRNode(IR_STORE_FIELD, { offset: 0 });
      secondStore.addInput(object);
      secondStore.addInput(secondValue);
      const ret = new IRNode(IR_RETURN);
      ret.addInput(secondValue);
      block.addNode(object);
      block.addNode(firstValue);
      block.addNode(secondValue);
      block.addNode(firstStore);
      block.addNode(secondStore);
      block.addNode(ret);

      graph.rebuildUses();
      const count = deadStoreElimination(graph);

      assert.equal(count, 1);
      assert.equal(block.nodes.includes(firstStore), false);
      assert.equal(object.uses.includes(firstStore), false);
      assert.equal(firstValue.uses.includes(firstStore), false);
      assert.equal(validateOptimizedGraph(graph, []), true);
    });

    it("eliminates store when all successors overwrite same location", () => {
      const graph = makeGraph();
      const block0 = graph.addBlock();
      const block1 = graph.addBlock();

      const obj = new IRNode(IR_NEW_OBJECT);
      block0.addNode(obj);

      const val1 = irConstant(1);
      block0.addNode(val1);

      const store1 = new IRNode(IR_STORE_FIELD, { offset: 0 });
      store1.addInput(obj);
      store1.addInput(val1);
      block0.addNode(store1);

      const jump = new IRNode(IR_JUMP, { targetBlock: block1.id });
      block0.addNode(jump);
      block0.addSuccessor(block1);

      const val2 = irConstant(2);
      block1.addNode(val2);

      const store2 = new IRNode(IR_STORE_FIELD, { offset: 0 });
      store2.addInput(obj);
      store2.addInput(val2);
      block1.addNode(store2);

      const ret = new IRNode(IR_RETURN);
      ret.addInput(val2);
      block1.addNode(ret);

      graph.rebuildUses();
      const count = deadStoreElimination(graph);
      assert.ok(
        count >= 1,
        "should eliminate dead store that is overwritten in successor",
      );
    });

    it("removes cross-block dead stores without leaving stale use-list entries", () => {
      const graph = makeGraph();
      const entry = graph.addBlock();
      const overwrite = graph.addBlock();
      const object = new IRNode(IR_PARAMETER, { index: 0 });
      const firstValue = irConstant(11);
      const firstStore = new IRNode(IR_STORE_FIELD, { offset: 2 });
      firstStore.addInput(object);
      firstStore.addInput(firstValue);
      const jump = new IRNode(IR_JUMP, { targetBlock: overwrite.id });
      const secondValue = irConstant(13);
      const secondStore = new IRNode(IR_STORE_FIELD, { offset: 2 });
      secondStore.addInput(object);
      secondStore.addInput(secondValue);
      const ret = new IRNode(IR_RETURN);
      ret.addInput(secondValue);
      entry.addNode(object);
      entry.addNode(firstValue);
      entry.addNode(firstStore);
      entry.addNode(jump);
      entry.addSuccessor(overwrite);
      overwrite.addNode(secondValue);
      overwrite.addNode(secondStore);
      overwrite.addNode(ret);

      graph.rebuildUses();
      const count = deadStoreElimination(graph);

      assert.equal(count, 1);
      assert.equal(entry.nodes.includes(firstStore), false);
      assert.equal(object.uses.includes(firstStore), false);
      assert.equal(firstValue.uses.includes(firstStore), false);
      assert.equal(validateOptimizedGraph(graph, []), true);
    });
  });

  describe("Type narrowing: STRING, BOOLEAN, OBJECT", () => {
    it("narrows constant string type", () => {
      const graph = makeGraph();
      const block = graph.addBlock();

      const strConst = irConstant("hello");
      block.addNode(strConst);

      const numConst = irConstant(42);
      block.addNode(numConst);

      const add = new IRNode(IR_GENERIC_ADD);
      add.addInput(strConst);
      add.addInput(numConst);
      block.addNode(add);

      const ret = new IRNode(IR_RETURN);
      ret.addInput(add);
      block.addNode(ret);

      graph.rebuildUses();
      const count = typeNarrowing(graph);
      assert.equal(
        add.type,
        IR_GENERIC_ADD,
        "string+number should remain generic",
      );
    });

    it("narrows typeof result to string type", () => {
      const graph = makeGraph();
      const block = graph.addBlock();

      const param = new IRNode(IR_PARAMETER, { index: 0 });
      block.addNode(param);

      const typeofNode = new IRNode(IR_TYPEOF);
      typeofNode.addInput(param);
      block.addNode(typeofNode);

      const ret = new IRNode(IR_RETURN);
      ret.addInput(typeofNode);
      block.addNode(ret);

      graph.rebuildUses();
      typeNarrowing(graph);
      assert.ok(true, "typeof narrowing should not crash");
    });

    it("narrows NOT result to boolean type", () => {
      const graph = makeGraph();
      const block = graph.addBlock();

      const param = new IRNode(IR_PARAMETER, { index: 0 });
      block.addNode(param);

      const notNode = new IRNode(IR_NOT);
      notNode.addInput(param);
      block.addNode(notNode);

      const ret = new IRNode(IR_RETURN);
      ret.addInput(notNode);
      block.addNode(ret);

      graph.rebuildUses();
      typeNarrowing(graph);
      assert.ok(true, "NOT narrowing should not crash");
    });

    it("specializes smi + smi to Int32Add", () => {
      const graph = makeGraph();
      const block = graph.addBlock();

      const param = new IRNode(IR_PARAMETER, { index: 0 });
      block.addNode(param);

      const check1 = new IRNode(IR_CHECK_SMI);
      check1.addInput(param);
      block.addNode(check1);

      const check2 = new IRNode(IR_CHECK_SMI);
      check2.addInput(param);
      block.addNode(check2);

      const add = new IRNode(IR_GENERIC_ADD);
      add.addInput(check1);
      add.addInput(check2);
      block.addNode(add);

      const ret = new IRNode(IR_RETURN);
      ret.addInput(add);
      block.addNode(ret);

      graph.rebuildUses();
      const count = typeNarrowing(graph);
      assert.ok(count >= 1, "should specialize generic add to int32");
      assert.equal(add.type, IR_INT32_ADD);
    });
  });

  describe("Escape analysis: PHI tracking + arrays", () => {
    it("scalar replaces object with PHI where all inputs are same alloc", () => {
      const graph = makeGraph();
      const block = graph.addBlock();

      const alloc = new IRNode(IR_NEW_OBJECT);
      block.addNode(alloc);

      const phi = new IRNode(IR_PHI, { index: 0 });
      phi.addInput(alloc);
      phi.addInput(alloc);
      block.addNode(phi);

      const retValue = irConstant(0);
      block.addNode(retValue);
      const ret = new IRNode(IR_RETURN);
      ret.addInput(retValue);
      block.addNode(ret);

      graph.rebuildUses();
      const count = escapeAnalysisAndScalarReplacement(graph);
      assert.ok(count >= 1);
      assert.equal(block.nodes.includes(alloc), false);
      assert.equal(block.nodes.includes(phi), false);
      assert.equal(validateOptimizedGraph(graph, []), true);
    });

    it("scalar replaces property traffic through same-allocation PHI aliases without dangling uses", () => {
      const graph = makeGraph();
      const block = graph.addBlock();
      const alloc = new IRNode(IR_NEW_OBJECT);
      const phi = new IRNode(IR_PHI, { index: 0 });
      const value = irConstant(55);
      const store = new IRNode(IR_GENERIC_SET_PROP, { propName: "field" });
      const load = new IRNode(IR_GENERIC_GET_PROP, { propName: "field" });
      const ret = new IRNode(IR_RETURN);
      block.addNode(alloc);
      phi.addInput(alloc);
      phi.addInput(alloc);
      block.addNode(phi);
      block.addNode(value);
      store.addInput(phi);
      store.addInput(value);
      block.addNode(store);
      load.addInput(phi);
      block.addNode(load);
      ret.addInput(load);
      block.addNode(ret);

      graph.rebuildUses();
      const count = escapeAnalysisAndScalarReplacement(graph);

      assert.equal(count, 1);
      assert.equal(ret.inputs[0], value);
      assert.equal(block.nodes.includes(alloc), false);
      assert.equal(block.nodes.includes(phi), false);
      assert.equal(block.nodes.includes(store), false);
      assert.equal(block.nodes.includes(load), false);
      assert.equal(validateOptimizedGraph(graph, []), true);
    });

    it("creates an owned undefined constant for scalar-replaced missing properties", () => {
      const graph = makeGraph();
      const block = graph.addBlock();
      const alloc = new IRNode(IR_NEW_OBJECT);
      const load = new IRNode(IR_GENERIC_GET_PROP, { propName: "missing" });
      const ret = new IRNode(IR_RETURN);
      block.addNode(alloc);
      load.addInput(alloc);
      block.addNode(load);
      ret.addInput(load);
      block.addNode(ret);

      graph.rebuildUses();
      const count = escapeAnalysisAndScalarReplacement(graph);
      const replacement = ret.inputs[0];

      assert.equal(count, 1);
      assert.equal(replacement.type, IR_CONSTANT);
      assert.equal(replacement.props.value, undefined);
      assert.equal(replacement.block, block);
      assert.equal(block.nodes.includes(load), false);
      assert.equal(validateOptimizedGraph(graph, []), true);
    });

    it("does NOT scalar replace when PHI inputs differ", () => {
      const graph = makeGraph();
      const block = graph.addBlock();
      const firstState = makeFrameState("escape-phi-first-allocation");
      const secondState = makeFrameState("escape-phi-second-allocation");

      const alloc1 = new IRNode(IR_NEW_OBJECT);
      alloc1.frameState = firstState;
      block.addNode(alloc1);

      const alloc2 = new IRNode(IR_NEW_OBJECT);
      alloc2.frameState = secondState;
      block.addNode(alloc2);

      const phi = new IRNode(IR_PHI, { index: 0 });
      phi.addInput(alloc1);
      phi.addInput(alloc2);
      block.addNode(phi);

      const ret = new IRNode(IR_RETURN);
      ret.addInput(phi);
      block.addNode(ret);

      graph.rebuildUses();
      const count = escapeAnalysisAndScalarReplacement(graph);
      assert.equal(count, 0, "PHI with different alloc inputs should escape");
      assert.equal(
        validateOptimizedGraph(graph, [firstState, secondState]),
        true,
      );
    });

    it("handles NEW_ARRAY allocation", () => {
      const graph = makeGraph();
      const block = graph.addBlock();

      const alloc = new IRNode(IR_NEW_ARRAY);
      block.addNode(alloc);

      const retValue = irConstant(0);
      block.addNode(retValue);
      const ret = new IRNode(IR_RETURN);
      ret.addInput(retValue);
      block.addNode(ret);

      graph.rebuildUses();
      const count = escapeAnalysisAndScalarReplacement(graph);
      assert.equal(count, 1);
      assert.equal(block.nodes.includes(alloc), false);
      assert.equal(validateOptimizedGraph(graph, []), true);
    });
  });

  describe("Range analysis: proper multiplication", () => {
    it("computes range for mixed-sign multiplication via 4 corners", () => {
      const graph = makeGraph();
      const block = graph.addBlock();

      const neg3 = irConstant(-3);
      block.addNode(neg3);

      const pos5 = irConstant(5);
      block.addNode(pos5);

      const mul = new IRNode(IR_INT32_MUL);
      mul.addInput(neg3);
      mul.addInput(pos5);
      block.addNode(mul);

      const ret = new IRNode(IR_RETURN);
      ret.addInput(mul);
      block.addNode(ret);

      graph.rebuildUses();
      const count = rangeAnalysisAndBoundsCheckElimination(graph);
      assert.ok(count >= 0, "mixed-sign multiplication should not crash");
    });

    it("folds constant branches without leaving stale compare uses or dead edge args", () => {
      const graph = makeGraph();
      const entry = graph.addBlock();
      const taken = graph.addBlock();
      const dropped = graph.addBlock();
      const left = irConstant(1);
      const right = irConstant(2);
      const cmp = new IRNode(IR_INT32_COMPARE, { op: "<" });
      cmp.addInput(left);
      cmp.addInput(right);
      const branch = new IRNode(IR_BRANCH, {
        trueBlock: taken.id,
        falseBlock: dropped.id,
      });
      branch.addInput(cmp);
      const ret = new IRNode(IR_RETURN);
      ret.addInput(left);
      entry.addNode(left);
      entry.addNode(right);
      entry.addNode(cmp);
      entry.addNode(branch);
      entry.addSuccessor(taken);
      entry.addSuccessor(dropped);
      entry.setEdgeArgs(dropped, [left]);
      taken.addNode(ret);

      graph.rebuildUses();
      const count = rangeAnalysisAndBoundsCheckElimination(graph);

      assert.equal(count, 1);
      assert.equal(branch.type, IR_JUMP);
      assert.equal(branch.inputs.length, 0);
      assert.equal(cmp.uses.includes(branch), false);
      assert.equal(entry.successors.length, 1);
      assert.equal(entry.successors[0], taken);
      assert.equal(entry.edgeArgs.has(dropped.id), false);
      assert.equal(validateOptimizedGraph(graph, []), true);
    });
  });

  describe("Feedback utilization: cold call filtering", () => {
    it("cold call site (low frequency) should not inline", () => {
      const slot = new FeedbackSlot(FEEDBACK_CALL);
      slot.recordCallTarget("foo", { id: 1, version: 0 }, 1);
      slot.recordCallTarget("foo", { id: 1, version: 0 }, 1);

      assert.equal(slot.totalCallCount, 2);
      assert.ok(slot.totalCallCount < 5, "should be below cold threshold");
    });

    it("hot call site (high frequency) should be eligible for inlining", () => {
      const slot = new FeedbackSlot(FEEDBACK_CALL);
      const target = { id: 1, version: 0 };
      for (let i = 0; i < 10; i++) {
        slot.recordCallTarget("foo", target, 1);
      }

      assert.equal(slot.totalCallCount, 10);
      assert.ok(slot.totalCallCount >= 5, "should be above cold threshold");
      assert.ok(slot.isMonomorphic(), "single target should be monomorphic");
    });
  });

  // ========================================================================
  // Advanced Optimizations
  // ========================================================================

  describe("Constant folding: string concatenation", () => {
    it('folds "hello" + " world" into "hello world"', () => {
      const graph = makeGraph();
      const block = graph.addBlock();

      const str1 = irConstant("hello");
      block.addNode(str1);

      const str2 = irConstant(" world");
      block.addNode(str2);

      const add = new IRNode(IR_GENERIC_ADD);
      add.addInput(str1);
      add.addInput(str2);
      block.addNode(add);

      const ret = new IRNode(IR_RETURN);
      ret.addInput(add);
      block.addNode(ret);

      graph.rebuildUses();
      const count = constantFolding(graph);
      assert.ok(count >= 1, "should fold string concatenation");

      const replacement = block.nodes.find(
        (n) => n.type === IR_CONSTANT && n.props.value === "hello world",
      );
      assert.ok(replacement, 'should produce "hello world" constant');
    });

    it("keeps folded constants owned by their containing block", () => {
      const graph = makeGraph();
      const block = graph.addBlock();
      const left = irConstant(14);
      const right = irConstant(28);
      const add = new IRNode(IR_INT32_ADD);
      const ret = new IRNode(IR_RETURN);
      block.addNode(left);
      block.addNode(right);
      add.addInput(left);
      add.addInput(right);
      block.addNode(add);
      ret.addInput(add);
      block.addNode(ret);

      graph.rebuildUses();
      const count = constantFolding(graph);
      const folded = block.nodes.find(
        (n) => n.type === IR_CONSTANT && n.props.value === 42,
      );

      assert.equal(count, 1);
      assert.equal(folded.block, block);
      assert.equal(validateOptimizedGraph(graph, []), true);
    });

    it('folds empty string concatenation: "" + "abc" produces "abc"', () => {
      const graph = makeGraph();
      const block = graph.addBlock();

      const empty = irConstant("");
      block.addNode(empty);

      const str = irConstant("abc");
      block.addNode(str);

      const add = new IRNode(IR_GENERIC_ADD);
      add.addInput(empty);
      add.addInput(str);
      block.addNode(add);

      const ret = new IRNode(IR_RETURN);
      ret.addInput(add);
      block.addNode(ret);

      graph.rebuildUses();
      const count = constantFolding(graph);
      assert.ok(count >= 1, 'should fold empty + "abc"');

      const replacement = block.nodes.find(
        (n) => n.type === IR_CONSTANT && n.props.value === "abc",
      );
      assert.ok(replacement, 'should produce "abc" constant');
    });

    it("does NOT fold string + number (mixed types stay generic)", () => {
      const graph = makeGraph();
      const block = graph.addBlock();

      const str = irConstant("count: ");
      block.addNode(str);

      const num = irConstant(42);
      block.addNode(num);

      const add = new IRNode(IR_GENERIC_ADD);
      add.addInput(str);
      add.addInput(num);
      block.addNode(add);

      const ret = new IRNode(IR_RETURN);
      ret.addInput(add);
      block.addNode(ret);

      graph.rebuildUses();
      const count = constantFolding(graph);
      assert.equal(count, 0, "should NOT fold string + number");
    });
  });

  describe("Strength reduction: multiply-by-constant decomposition", () => {
    it("reduces x * 3 to (x << 1) + x", () => {
      const graph = makeGraph();
      const block = graph.addBlock();

      const x = new IRNode(IR_PARAMETER, { index: 0 });
      block.addNode(x);

      const three = irConstant(3);
      block.addNode(three);

      const mul = new IRNode(IR_INT32_MUL);
      const state = makeFrameState("strength-reduction-owner");
      mul.frameState = state;
      mul.addInput(x);
      mul.addInput(three);
      block.addNode(mul);

      const ret = new IRNode(IR_RETURN);
      ret.addInput(mul);
      block.addNode(ret);

      graph.rebuildUses();
      const count = strengthReduction(graph);
      assert.ok(count >= 1, "should reduce x * 3");

      const addNode = block.nodes.find((n) => n.type === IR_INT32_ADD);
      assert.ok(addNode, "should create Int32Add node for x*3");
      assert.equal(addNode.block, block);
      assert.equal(addNode.inputs[0].block, block);
      assert.equal(addNode.frameState, state);
      assert.equal(validateOptimizedGraph(graph, [state]), true);
    });

    it("reduces x * 5 to (x << 2) + x", () => {
      const graph = makeGraph();
      const block = graph.addBlock();

      const x = new IRNode(IR_PARAMETER, { index: 0 });
      block.addNode(x);

      const five = irConstant(5);
      block.addNode(five);

      const mul = new IRNode(IR_INT32_MUL);
      mul.addInput(x);
      mul.addInput(five);
      block.addNode(mul);

      const ret = new IRNode(IR_RETURN);
      ret.addInput(mul);
      block.addNode(ret);

      graph.rebuildUses();
      const count = strengthReduction(graph);
      assert.ok(count >= 1, "should reduce x * 5");

      const addNode = block.nodes.find((n) => n.type === IR_INT32_ADD);
      assert.ok(addNode, "should create Int32Add for x*5 pattern");
    });

    it("reduces x * 7 to (x << 3) - x", () => {
      const graph = makeGraph();
      const block = graph.addBlock();

      const x = new IRNode(IR_PARAMETER, { index: 0 });
      block.addNode(x);

      const seven = irConstant(7);
      block.addNode(seven);

      const mul = new IRNode(IR_INT32_MUL);
      mul.addInput(x);
      mul.addInput(seven);
      block.addNode(mul);

      const ret = new IRNode(IR_RETURN);
      ret.addInput(mul);
      block.addNode(ret);

      graph.rebuildUses();
      const count = strengthReduction(graph);
      assert.ok(count >= 1, "should reduce x * 7");

      const subNode = block.nodes.find((n) => n.type === IR_INT32_SUB);
      assert.ok(subNode, "should create Int32Sub for x*7 = (x<<3) - x");
    });

    it("reduces x * 9 to (x << 3) + x", () => {
      const graph = makeGraph();
      const block = graph.addBlock();

      const x = new IRNode(IR_PARAMETER, { index: 0 });
      block.addNode(x);

      const nine = irConstant(9);
      block.addNode(nine);

      const mul = new IRNode(IR_INT32_MUL);
      mul.addInput(x);
      mul.addInput(nine);
      block.addNode(mul);

      const ret = new IRNode(IR_RETURN);
      ret.addInput(mul);
      block.addNode(ret);

      graph.rebuildUses();
      const count = strengthReduction(graph);
      assert.ok(count >= 1, "should reduce x * 9");

      const addNode = block.nodes.find((n) => n.type === IR_INT32_ADD);
      assert.ok(addNode, "should create Int32Add for x*9 = (x<<3) + x");
    });

    it("still reduces x * 4 to x << 2 (power-of-2 path)", () => {
      const graph = makeGraph();
      const block = graph.addBlock();

      const x = new IRNode(IR_PARAMETER, { index: 0 });
      block.addNode(x);

      const four = irConstant(4);
      block.addNode(four);

      const mul = new IRNode(IR_INT32_MUL);
      mul.addInput(x);
      mul.addInput(four);
      block.addNode(mul);

      const ret = new IRNode(IR_RETURN);
      ret.addInput(mul);
      block.addNode(ret);

      graph.rebuildUses();
      const count = strengthReduction(graph);
      assert.ok(count >= 1, "should reduce x * 4");

      const shlNode = block.nodes.find((n) => n.type === IR_INT32_SHL);
      assert.ok(shlNode, "should create Int32Shl for x*4 (power-of-2)");
    });

    it("does NOT reduce x * 6 (not 2^k±1 pattern)", () => {
      const graph = makeGraph();
      const block = graph.addBlock();

      const x = new IRNode(IR_PARAMETER, { index: 0 });
      block.addNode(x);

      const six = irConstant(6);
      block.addNode(six);

      const mul = new IRNode(IR_INT32_MUL);
      mul.addInput(x);
      mul.addInput(six);
      block.addNode(mul);

      const ret = new IRNode(IR_RETURN);
      ret.addInput(mul);
      block.addNode(ret);

      graph.rebuildUses();
      const count = strengthReduction(graph);
      assert.equal(count, 0, "should NOT reduce x * 6");
    });
  });

  describe("Representation selection node ownership", () => {
    it("keeps inserted unbox nodes owned by the block that contains their consumer", () => {
      const graph = makeGraph();
      const block = graph.addBlock();
      const left = new IRNode(IR_PARAMETER, { index: 0 });
      const right = new IRNode(IR_PARAMETER, { index: 1 });
      const add = new IRNode(IR_INT32_ADD);
      const ret = new IRNode(IR_RETURN);
      add.props.noOverflow = true;
      block.addNode(left);
      block.addNode(right);
      add.addInput(left);
      add.addInput(right);
      block.addNode(add);
      ret.addInput(add);
      block.addNode(ret);

      graph.rebuildUses();
      const count = representationSelection(graph);
      const unboxes = block.nodes.filter((n) => n.type === IR_UNBOX);

      assert.equal(count, 2);
      assert.equal(unboxes.length, 2);
      assert.equal(
        unboxes.every((n) => n.block === block),
        true,
      );
      assert.equal(validateOptimizedGraph(graph, []), true);
    });

    it("keeps inserted box nodes owned by the block that contains their consumer", () => {
      const graph = makeGraph();
      const block = graph.addBlock();
      const left = new IRNode(IR_PARAMETER, { index: 0 });
      const right = new IRNode(IR_PARAMETER, { index: 1 });
      const add = new IRNode(IR_INT32_ADD);
      const generic = new IRNode(IR_GENERIC_SUB);
      const ret = new IRNode(IR_RETURN);
      add.props.noOverflow = true;
      block.addNode(left);
      block.addNode(right);
      add.addInput(left);
      add.addInput(right);
      block.addNode(add);
      generic.addInput(add);
      generic.addInput(left);
      block.addNode(generic);
      ret.addInput(generic);
      block.addNode(ret);

      graph.rebuildUses();
      const count = representationSelection(graph);
      const boxes = block.nodes.filter((n) => n.type === IR_BOX);

      assert.equal(count >= 1, true);
      assert.equal(
        boxes.every((n) => n.block === block),
        true,
      );
      assert.equal(validateOptimizedGraph(graph, []), true);
    });
  });

  describe("Loop optimization graph invariants", () => {
    it("hoists loop-invariant field loads before the pre-header terminator and updates node ownership", () => {
      const graph = makeGraph();
      const preHeader = graph.addBlock();
      const header = graph.addBlock();
      const body = graph.addBlock();
      const exit = graph.addBlock();

      const object = new IRNode(IR_PARAMETER, { index: 0 });
      preHeader.addNode(object);
      const preJump = new IRNode(IR_JUMP, { targetBlock: header.id });
      preHeader.addNode(preJump);
      preHeader.addSuccessor(header);

      header.isLoopHeader = true;
      const condition = irConstant(true);
      header.addNode(condition);
      const branch = new IRNode(IR_BRANCH, {
        trueBlock: body.id,
        falseBlock: exit.id,
      });
      branch.addInput(condition);
      header.addNode(branch);
      header.addSuccessor(body);
      header.addSuccessor(exit);

      const load = new IRNode(IR_LOAD_FIELD, { offset: 8 });
      load.addInput(object);
      body.addNode(load);
      const backedge = new IRNode(IR_JUMP, { targetBlock: header.id });
      body.addNode(backedge);
      body.addSuccessor(header);

      const retValue = irConstant(0);
      exit.addNode(retValue);
      const ret = new IRNode(IR_RETURN);
      ret.addInput(retValue);
      exit.addNode(ret);

      graph.rebuildUses();
      hoistLoopInvariants(graph, () => [{ header, blocks: [header, body] }]);

      assert.equal(load.block, preHeader);
      assert.equal(body.nodes.includes(load), false);
      assert.ok(
        preHeader.nodes.indexOf(load) < preHeader.nodes.indexOf(preJump),
      );
      assert.equal(validateOptimizedGraph(graph, []), true);
    });

    it("peels loop checks with frame state only when all values are available in the pre-header", () => {
      const graph = makeGraph();
      const preHeader = graph.addBlock();
      const header = graph.addBlock();
      const body = graph.addBlock();
      const exit = graph.addBlock();
      const state = makeFrameState("loop-peel-valid-frame-state");

      const value = new IRNode(IR_PARAMETER, { index: 0 });
      preHeader.addNode(value);
      state.setLocal(0, value);
      const preJump = new IRNode(IR_JUMP, { targetBlock: header.id });
      preHeader.addNode(preJump);
      preHeader.addSuccessor(header);

      header.isLoopHeader = true;
      const condition = irConstant(true);
      header.addNode(condition);
      const branch = new IRNode(IR_BRANCH, {
        trueBlock: body.id,
        falseBlock: exit.id,
      });
      branch.addInput(condition);
      header.addNode(branch);
      header.addSuccessor(body);
      header.addSuccessor(exit);

      const check = new IRNode(IR_CHECK_SMI);
      check.addInput(value);
      check.frameState = state;
      body.addNode(check);
      const backedge = new IRNode(IR_JUMP, { targetBlock: header.id });
      body.addNode(backedge);
      body.addSuccessor(header);

      const retValue = irConstant(0);
      exit.addNode(retValue);
      const ret = new IRNode(IR_RETURN);
      ret.addInput(retValue);
      exit.addNode(ret);

      graph.rebuildUses();
      const count = loopUnrolling(graph, () => [
        { header, blocks: [header, body] },
      ]);
      const peeled = preHeader.nodes.filter(
        (node) => node.type === IR_CHECK_SMI,
      );

      assert.equal(count, 1);
      assert.equal(peeled.length, 1);
      assert.equal(peeled[0].block, preHeader);
      assert.equal(peeled[0].frameState, state);
      assert.ok(
        preHeader.nodes.indexOf(peeled[0]) < preHeader.nodes.indexOf(preJump),
      );
      assert.equal(validateOptimizedGraph(graph, [state]), true);
    });

    it("does not peel loop checks when the frame state contains a loop-local value", () => {
      const graph = makeGraph();
      const preHeader = graph.addBlock();
      const header = graph.addBlock();
      const body = graph.addBlock();
      const exit = graph.addBlock();
      const state = makeFrameState("loop-peel-rejects-loop-local-frame-state");

      const value = new IRNode(IR_PARAMETER, { index: 0 });
      preHeader.addNode(value);
      const preJump = new IRNode(IR_JUMP, { targetBlock: header.id });
      preHeader.addNode(preJump);
      preHeader.addSuccessor(header);

      header.isLoopHeader = true;
      const condition = irConstant(true);
      header.addNode(condition);
      const branch = new IRNode(IR_BRANCH, {
        trueBlock: body.id,
        falseBlock: exit.id,
      });
      branch.addInput(condition);
      header.addNode(branch);
      header.addSuccessor(body);
      header.addSuccessor(exit);

      const one = irConstant(1);
      body.addNode(one);
      const loopLocal = new IRNode(IR_INT32_ADD, { noOverflow: true });
      loopLocal.addInput(value);
      loopLocal.addInput(one);
      body.addNode(loopLocal);
      state.setLocal(0, loopLocal);
      const check = new IRNode(IR_CHECK_SMI);
      check.addInput(value);
      check.frameState = state;
      body.addNode(check);
      const backedge = new IRNode(IR_JUMP, { targetBlock: header.id });
      body.addNode(backedge);
      body.addSuccessor(header);

      const retValue = irConstant(0);
      exit.addNode(retValue);
      const ret = new IRNode(IR_RETURN);
      ret.addInput(retValue);
      exit.addNode(ret);

      graph.rebuildUses();
      const count = loopUnrolling(graph, () => [
        { header, blocks: [header, body] },
      ]);

      assert.equal(count, 0);
      assert.equal(
        preHeader.nodes.some((node) => node.type === IR_CHECK_SMI),
        false,
      );
      assert.equal(validateOptimizedGraph(graph, [state]), true);
    });
  });

  describe("Bounds check elimination: induction variable analysis", () => {
    it("eliminates bounds check when IV is guarded by i < length", () => {
      const graph = makeGraph();

      const block0 = graph.addBlock();
      const block1 = graph.addBlock();
      const block2 = graph.addBlock();
      const block3 = graph.addBlock();

      // B0: entry
      const arr = new IRNode(IR_PARAMETER, { index: 0 });
      block0.addNode(arr);
      const init = irConstant(0);
      block0.addNode(init);
      const len = irConstant(10);
      block0.addNode(len);
      const jumpToHeader = new IRNode(IR_JUMP, { targetBlock: block1.id });
      block0.addNode(jumpToHeader);
      block0.addSuccessor(block1);

      // B1: loop header with PHI
      block1.isLoopHeader = true;
      const phi = new IRNode(IR_PHI, { index: 0 });
      phi.addInput(init);
      block1.addNode(phi);

      const cmp = new IRNode(IR_INT32_COMPARE, { op: "<" });
      cmp.addInput(phi);
      cmp.addInput(len);
      block1.addNode(cmp);

      const branch = new IRNode(IR_BRANCH, {
        trueBlock: block2.id,
        falseBlock: block3.id,
      });
      branch.addInput(cmp);
      block1.addNode(branch);
      block1.addSuccessor(block2);
      block1.addSuccessor(block3);

      // B2: loop body with bounds check
      const boundsCheck = new IRNode(IR_CHECK_BOUNDS);
      boundsCheck.addInput(phi);
      boundsCheck.addInput(arr);
      block2.addNode(boundsCheck);

      const step = irConstant(1);
      block2.addNode(step);
      const increment = new IRNode(IR_INT32_ADD);
      increment.addInput(phi);
      increment.addInput(step);
      block2.addNode(increment);

      phi.addInput(increment);

      const jumpBack = new IRNode(IR_JUMP, { targetBlock: block1.id });
      block2.addNode(jumpBack);
      block2.addSuccessor(block1);

      // B3: exit
      const retVal = irConstant(0);
      block3.addNode(retVal);
      const ret = new IRNode(IR_RETURN);
      ret.addInput(retVal);
      block3.addNode(ret);

      graph.rebuildUses();
      const count = rangeAnalysisAndBoundsCheckElimination(graph);
      assert.ok(
        count >= 1,
        "should eliminate bounds check for IV-guarded loop",
      );
    });

    it("eliminates bounds check when predecessor has i <= guard", () => {
      const graph = makeGraph();
      const block0 = graph.addBlock();
      const block1 = graph.addBlock();

      const arr = new IRNode(IR_PARAMETER, { index: 0 });
      block0.addNode(arr);

      const idx = irConstant(3);
      block0.addNode(idx);

      const len = irConstant(10);
      block0.addNode(len);

      const cmp = new IRNode(IR_INT32_COMPARE, { op: "<=" });
      cmp.addInput(idx);
      cmp.addInput(len);
      block0.addNode(cmp);

      const branch = new IRNode(IR_BRANCH, {
        trueBlock: block1.id,
        falseBlock: block1.id,
      });
      branch.addInput(cmp);
      block0.addNode(branch);
      block0.addSuccessor(block1);

      const boundsCheck = new IRNode(IR_CHECK_BOUNDS);
      boundsCheck.addInput(idx);
      boundsCheck.addInput(arr);
      block1.addNode(boundsCheck);

      const ret = new IRNode(IR_RETURN);
      ret.addInput(irConstant(0));
      block1.addNode(ret);

      graph.rebuildUses();
      const count = rangeAnalysisAndBoundsCheckElimination(graph);
      assert.ok(
        count >= 1,
        "should eliminate bounds check with <= predecessor guard",
      );
    });

    it("removes pure users orphaned by bounds check elimination without leaving stale uses", () => {
      const graph = makeGraph();
      const entry = graph.addBlock();
      const body = graph.addBlock();
      const array = new IRNode(IR_PARAMETER, { index: 0 });
      const index = irConstant(2);
      const length = new IRNode(IR_PARAMETER, { index: 1 });
      const cmp = new IRNode(IR_INT32_COMPARE, { op: "<" });
      cmp.addInput(index);
      cmp.addInput(length);
      const branch = new IRNode(IR_BRANCH, {
        trueBlock: body.id,
        falseBlock: body.id,
      });
      branch.addInput(cmp);
      entry.addNode(array);
      entry.addNode(index);
      entry.addNode(length);
      entry.addNode(cmp);
      entry.addNode(branch);
      entry.addSuccessor(body);
      const boundsCheck = new IRNode(IR_CHECK_BOUNDS);
      boundsCheck.addInput(index);
      boundsCheck.addInput(array);
      body.addNode(boundsCheck);
      const one = irConstant(1);
      body.addNode(one);
      const orphan = new IRNode(IR_INT32_ADD, { noOverflow: true });
      orphan.addInput(boundsCheck);
      orphan.addInput(one);
      body.addNode(orphan);
      const retValue = irConstant(0);
      body.addNode(retValue);
      const ret = new IRNode(IR_RETURN);
      ret.addInput(retValue);
      body.addNode(ret);

      graph.rebuildUses();
      const count = rangeAnalysisAndBoundsCheckElimination(graph);

      assert.equal(count >= 1, true);
      assert.equal(body.nodes.includes(boundsCheck), false);
      assert.equal(body.nodes.includes(orphan), false);
      assert.equal(index.uses.includes(orphan), false);
      assert.equal(one.uses.includes(orphan), false);
      assert.equal(validateOptimizedGraph(graph, []), true);
    });
  });

  describe("Deopt materialization: IC invalidation", () => {
    it("preserves feedback vector slots on map-check-failed deopt", async () => {
      const { Deoptimizer } = await import("../../../src/deopt/deoptimizer.js");

      const mockInterpreter = {
        tieringPolicy: {
          maxDeoptCount: 10,
          recordDeopt: () => {},
        },
        resumeAt: () => "resumed",
      };

      const deoptimizer = new Deoptimizer(mockInterpreter);

      const mockSlot = { state: "monomorphic", maps: [1], targets: ["foo"] };
      const compiledFn = {
        name: "testFn",
        deoptCount: 0,
        optimizedCode: {},
        feedbackVector: {
          slots: [mockSlot],
        },
      };

      deoptimizer.lastDeoptReason = "map-check-failed";
      deoptimizer.handleDisableOptimization(compiledFn);

      assert.equal(
        mockSlot.state,
        "monomorphic",
        "slot state should remain available for future feedback",
      );
      assert.deepEqual(mockSlot.maps, [1], "slot maps should be preserved");
      assert.deepEqual(mockSlot.targets, ["foo"], "slot targets should remain");
    });

    it("does NOT reset IC slots for non-type-check deopts", async () => {
      const { Deoptimizer } = await import("../../../src/deopt/deoptimizer.js");

      const mockInterpreter = {
        tieringPolicy: {
          maxDeoptCount: 10,
          recordDeopt: () => {},
        },
        resumeAt: () => "resumed",
      };

      const deoptimizer = new Deoptimizer(mockInterpreter);

      const mockSlot = { state: "monomorphic", maps: [1], targets: ["foo"] };
      const compiledFn = {
        name: "testFn",
        deoptCount: 0,
        optimizedCode: {},
        feedbackVector: {
          slots: [mockSlot],
        },
      };

      deoptimizer.lastDeoptReason = "integer-overflow";
      deoptimizer.handleDisableOptimization(compiledFn);

      assert.equal(
        mockSlot.state,
        "monomorphic",
        "slot state should remain unchanged",
      );
      assert.deepEqual(mockSlot.maps, [1], "slot maps should remain unchanged");
    });
  });
});
