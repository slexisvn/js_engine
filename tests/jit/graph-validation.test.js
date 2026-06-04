import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FrameState } from "../../src/deopt/frame-state.js";
import {
  IRGraph,
  IRNode,
  IR_CALL_BUILTIN,
  IR_DISPATCH_MAP,
  IR_MEGAMORPHIC_LOAD,
  IR_MEGAMORPHIC_STORE,
  irBranch,
  irCheckSmi,
  irConstant,
  irDeoptimize,
  irFloat64Compare,
  irGenericCall,
  irGenericGetProp,
  irInt32Add,
  irInt32Compare,
  irJump,
  irNewArray,
  irNewObject,
  irParameter,
  irPolymorphicLoad,
  irPolymorphicStore,
  irReturn,
} from "../../src/optimizing/ir/index.js";
import {
  GraphValidationError,
  validateOptimizedGraph,
} from "../../src/optimizing/validation/graph-validator.js";
import { WasmCodegen } from "../../src/optimizing/wasm/codegen.js";

function frameState(functionName = "unit", bytecodeOffset = 0) {
  const state = new FrameState({ name: functionName }, bytecodeOffset);
  state.id = 0;
  return state;
}

describe("optimized graph validation", () => {
  it("rejects speculative guards without a frame state", () => {
    const graph = new IRGraph("missing-guard-frame-state");
    const block = graph.addBlock();
    const value = irParameter(0);
    const check = irCheckSmi(value);
    block.addNode(check);

    assert.throws(
      () => validateOptimizedGraph(graph, []),
      GraphValidationError,
    );
  });

  it("accepts guards, calls and allocations when every deopt-capable node has an owned frame state", () => {
    const graph = new IRGraph("complete-frame-states");
    const block = graph.addBlock();
    const state = frameState();
    const value = irParameter(0);
    const callee = irParameter(1);
    const check = irCheckSmi(value);
    const call = irGenericCall(callee, [check]);
    const object = irNewObject();
    const array = irNewArray([value]);
    check.frameState = state;
    call.frameState = state;
    object.frameState = state;
    array.frameState = state;
    block.addNode(check);
    block.addNode(call);
    block.addNode(object);
    block.addNode(array);

    assert.equal(validateOptimizedGraph(graph, [state]), true);
  });

  it("rejects frame states from another compilation result", () => {
    const graph = new IRGraph("foreign-frame-state");
    const block = graph.addBlock();
    const localState = frameState("local");
    const foreignState = frameState("foreign");
    const check = irCheckSmi(irParameter(0));
    check.frameState = foreignState;
    block.addNode(check);

    assert.throws(
      () => validateOptimizedGraph(graph, [localState]),
      GraphValidationError,
    );
  });

  it("rejects frame state locals whose definitions do not dominate the guard", () => {
    const graph = new IRGraph("frame-state-local-without-dominance");
    const entry = graph.addBlock();
    const leftBlock = graph.addBlock();
    const rightBlock = graph.addBlock();
    const condition = irParameter(0);
    const state = frameState();
    const branchValue = irInt32Add(condition, condition);
    branchValue.props.noOverflow = true;
    state.setLocal(0, branchValue);
    const guard = irCheckSmi(condition);
    guard.frameState = state;

    entry.addNode(irBranch(condition, leftBlock, rightBlock));
    entry.addSuccessor(leftBlock);
    entry.addSuccessor(rightBlock);
    leftBlock.addNode(branchValue);
    leftBlock.addNode(irReturn(branchValue));
    rightBlock.addNode(guard);

    assert.throws(
      () => validateOptimizedGraph(graph, [state]),
      GraphValidationError,
    );
  });

  it("accepts frame state stack values available at the guard", () => {
    const graph = new IRGraph("frame-state-stack-available");
    const block = graph.addBlock();
    const state = frameState();
    const value = irParameter(0);
    const stable = irInt32Add(value, value);
    stable.props.noOverflow = true;
    state.pushStack(stable);
    const guard = irCheckSmi(stable);
    guard.frameState = state;
    block.addNode(stable);
    block.addNode(guard);

    assert.equal(validateOptimizedGraph(graph, [state]), true);
  });

  it("rejects merged block parameters without incoming edge values", () => {
    const graph = new IRGraph("missing-edge-value");
    const entry = graph.addBlock();
    const merge = graph.addBlock();
    merge.addParam();
    entry.addSuccessor(merge);

    assert.throws(
      () => validateOptimizedGraph(graph, []),
      GraphValidationError,
    );
  });

  it("rejects predecessor edges that do not pass every merge parameter", () => {
    const graph = new IRGraph("short-edge-args");
    const entry = graph.addBlock();
    const merge = graph.addBlock();
    const value = irParameter(0);
    merge.addParam([value]);
    merge.addParam([value]);
    entry.addSuccessor(merge, [value]);

    assert.throws(
      () => validateOptimizedGraph(graph, []),
      GraphValidationError,
    );
  });

  it("rejects merge parameters whose inputs do not match predecessor edge args", () => {
    const graph = new IRGraph("mismatched-edge-inputs");
    const entry = graph.addBlock();
    const merge = graph.addBlock();
    const left = irParameter(0);
    const right = irParameter(1);
    const first = merge.addParam([left]);
    const second = merge.addParam([right]);
    entry.addSuccessor(merge, [right, left]);
    entry.addNode(irReturn(first));
    merge.addNode(irReturn(second));

    assert.throws(
      () => validateOptimizedGraph(graph, []),
      GraphValidationError,
    );
  });

  it("rejects branches whose targets are not registered as successors", () => {
    const graph = new IRGraph("branch-missing-successor");
    const entry = graph.addBlock();
    const trueBlock = graph.addBlock();
    const falseBlock = graph.addBlock();
    const condition = irParameter(0);
    entry.addNode(irBranch(condition, trueBlock, falseBlock));
    entry.addSuccessor(trueBlock);

    assert.throws(
      () => validateOptimizedGraph(graph, []),
      GraphValidationError,
    );
  });

  it("rejects successor edges without matching predecessor links", () => {
    const graph = new IRGraph("successor-without-predecessor");
    const entry = graph.addBlock();
    const exit = graph.addBlock();
    const value = irParameter(0);
    entry.successors.push(exit);
    entry.addNode(irJump(exit));
    exit.addNode(irReturn(value));

    assert.throws(
      () => validateOptimizedGraph(graph, []),
      GraphValidationError,
    );
  });

  it("rejects edge args for blocks that are no longer successors", () => {
    const graph = new IRGraph("edge-args-without-successor");
    const entry = graph.addBlock();
    const kept = graph.addBlock();
    const dropped = graph.addBlock();
    const value = irParameter(0);
    entry.addNode(irJump(kept));
    entry.addSuccessor(kept, [value]);
    entry.setEdgeArgs(dropped, [value]);
    kept.addNode(irReturn(value));

    assert.throws(
      () => validateOptimizedGraph(graph, []),
      GraphValidationError,
    );
  });

  it("rejects jumps whose target does not match the only successor", () => {
    const graph = new IRGraph("jump-wrong-successor");
    const entry = graph.addBlock();
    const target = graph.addBlock();
    const other = graph.addBlock();
    entry.addNode(irJump(target));
    entry.addSuccessor(other);

    assert.throws(
      () => validateOptimizedGraph(graph, []),
      GraphValidationError,
    );
  });

  it("rejects return and deopt terminators with outgoing successors", () => {
    const returnGraph = new IRGraph("return-with-successor");
    const returnBlock = returnGraph.addBlock();
    const returnTarget = returnGraph.addBlock();
    returnBlock.addNode(irReturn(irParameter(0)));
    returnBlock.addSuccessor(returnTarget);

    assert.throws(
      () => validateOptimizedGraph(returnGraph, []),
      GraphValidationError,
    );

    const deoptGraph = new IRGraph("deopt-with-successor");
    const deoptBlock = deoptGraph.addBlock();
    const deoptTarget = deoptGraph.addBlock();
    const deopt = irDeoptimize("test-deopt");
    deopt.frameState = frameState();
    deoptBlock.addNode(deopt);
    deoptBlock.addSuccessor(deoptTarget);

    assert.throws(
      () => validateOptimizedGraph(deoptGraph, [deopt.frameState]),
      GraphValidationError,
    );
  });

  it("rejects nodes after a block terminator", () => {
    const graph = new IRGraph("node-after-terminator");
    const block = graph.addBlock();
    const value = irParameter(0);
    block.addNode(irReturn(value));
    block.addNode(irInt32Compare("==", value, value));

    assert.throws(
      () => validateOptimizedGraph(graph, []),
      GraphValidationError,
    );
  });

  it("rejects scheduled nodes whose owner does not match the containing block", () => {
    const graph = new IRGraph("wrong-node-owner");
    const first = graph.addBlock();
    const second = graph.addBlock();
    const value = irParameter(0);
    const add = irInt32Add(value, value);
    add.props.noOverflow = true;
    first.addNode(add);
    add.block = second;

    assert.throws(
      () => validateOptimizedGraph(graph, []),
      GraphValidationError,
    );
  });

  it("accepts constants shared across blocks as immediate values", () => {
    const graph = new IRGraph("shared-immediate-constant");
    const first = graph.addBlock();
    const second = graph.addBlock();
    const value = irConstant(1);
    first.addNode(value);
    second.addNode(value);
    second.addNode(irReturn(value));

    assert.equal(validateOptimizedGraph(graph, []), true);
  });

  it("rejects values whose use list is missing a scheduled consumer", () => {
    const graph = new IRGraph("missing-use-list-entry");
    const block = graph.addBlock();
    const value = irParameter(0);
    const add = irInt32Add(value, value);
    add.props.noOverflow = true;
    block.addNode(value);
    block.addNode(add);
    value.uses = [];

    assert.throws(
      () => validateOptimizedGraph(graph, []),
      GraphValidationError,
    );
  });

  it("rejects values whose use list contains a stale consumer", () => {
    const graph = new IRGraph("stale-use-list-entry");
    const block = graph.addBlock();
    const value = irParameter(0);
    const add = irInt32Add(value, value);
    const stale = irInt32Add(value, value);
    add.props.noOverflow = true;
    stale.props.noOverflow = true;
    block.addNode(value);
    block.addNode(add);
    value.uses.push(stale);

    assert.throws(
      () => validateOptimizedGraph(graph, []),
      GraphValidationError,
    );
  });

  it("accepts duplicate inputs when the use list records the same consumer twice", () => {
    const graph = new IRGraph("duplicate-input-use-list");
    const block = graph.addBlock();
    const value = irParameter(0);
    const add = irInt32Add(value, value);
    add.props.noOverflow = true;
    block.addNode(value);
    block.addNode(add);
    block.addNode(irReturn(add));

    assert.equal(validateOptimizedGraph(graph, []), true);
  });

  it("accepts branch and jump terminators whose successor lists match their targets", () => {
    const graph = new IRGraph("valid-control-flow");
    const entry = graph.addBlock();
    const trueBlock = graph.addBlock();
    const falseBlock = graph.addBlock();
    const exit = graph.addBlock();
    const condition = irParameter(0);
    entry.addNode(irBranch(condition, trueBlock, falseBlock));
    entry.addSuccessor(trueBlock);
    entry.addSuccessor(falseBlock);
    trueBlock.addNode(irJump(exit));
    trueBlock.addSuccessor(exit);
    falseBlock.addNode(irJump(exit));
    falseBlock.addSuccessor(exit);
    exit.addNode(irReturn(condition));

    assert.equal(validateOptimizedGraph(graph, []), true);
  });

  it("rejects a value used in a block not dominated by its definition", () => {
    const graph = new IRGraph("sibling-use-without-dominance");
    const entry = graph.addBlock();
    const leftBlock = graph.addBlock();
    const rightBlock = graph.addBlock();
    const exit = graph.addBlock();
    const condition = irParameter(0);
    const value = irInt32Add(condition, condition);
    value.props.noOverflow = true;
    entry.addNode(irBranch(condition, leftBlock, rightBlock));
    entry.addSuccessor(leftBlock);
    entry.addSuccessor(rightBlock);
    leftBlock.addNode(value);
    leftBlock.addNode(irJump(exit));
    leftBlock.addSuccessor(exit);
    rightBlock.addNode(irReturn(value));

    assert.throws(
      () => validateOptimizedGraph(graph, []),
      GraphValidationError,
    );
  });

  it("rejects a same-block use before definition order", () => {
    const graph = new IRGraph("same-block-use-before-definition");
    const block = graph.addBlock();
    const param = irParameter(0);
    const value = irInt32Add(param, param);
    value.props.noOverflow = true;
    block.addNode(irInt32Compare("==", value, value));
    block.addNode(value);

    assert.throws(
      () => validateOptimizedGraph(graph, []),
      GraphValidationError,
    );
  });

  it("rejects edge args that are unavailable at the predecessor edge", () => {
    const graph = new IRGraph("unavailable-edge-arg");
    const entry = graph.addBlock();
    const leftBlock = graph.addBlock();
    const rightBlock = graph.addBlock();
    const merge = graph.addBlock();
    const condition = irParameter(0);
    const leftValue = irInt32Add(condition, condition);
    leftValue.props.noOverflow = true;
    entry.addNode(irBranch(condition, leftBlock, rightBlock));
    entry.addSuccessor(leftBlock);
    entry.addSuccessor(rightBlock);
    leftBlock.addNode(leftValue);
    leftBlock.addNode(irJump(merge));
    leftBlock.addSuccessor(merge, [leftValue]);
    rightBlock.addNode(irJump(merge));
    rightBlock.addSuccessor(merge, [leftValue]);
    const phi = merge.addParam([leftValue, leftValue]);
    merge.addNode(irReturn(phi));

    assert.throws(
      () => validateOptimizedGraph(graph, []),
      GraphValidationError,
    );
  });

  it("accepts a loop-carried block param whose backedge value is available on the predecessor", () => {
    const graph = new IRGraph("valid-loop-carried-value");
    const entry = graph.addBlock();
    const header = graph.addBlock();
    const body = graph.addBlock();
    const exit = graph.addBlock();
    const seed = irConstant(0);
    entry.addNode(seed);
    entry.addNode(irJump(header));
    entry.addSuccessor(header, [seed]);
    const loopValue = header.addParam([seed]);
    header.addNode(irBranch(irParameter(0), body, exit));
    header.addSuccessor(body);
    header.addSuccessor(exit);
    const next = irInt32Add(loopValue, seed);
    next.props.noOverflow = true;
    body.addNode(next);
    body.addNode(irJump(header));
    body.addSuccessor(header, [next]);
    loopValue.addInput(next);
    exit.addNode(irReturn(loopValue));

    assert.equal(validateOptimizedGraph(graph, []), true);
  });

  it("makes the wasm backend refuse invalid optimized graphs before code generation", () => {
    const graph = new IRGraph("backend-validation");
    const block = graph.addBlock();
    const value = irParameter(0);
    const check = irCheckSmi(value);
    block.addNode(check);
    block.addNode(irReturn(check));
    const codegen = new WasmCodegen();

    assert.equal(
      codegen.compile(
        { graph, frameStates: [] },
        { name: "backendValidation" },
      ),
      null,
    );
  });

  it("reports the unsupported node when wasm backend rejects a graph before code generation", () => {
    const graph = new IRGraph("unsupported-node");
    const block = graph.addBlock();
    const unsupported = new IRNode("IR_SIDE_EXIT_PORTAL");
    block.addNode(unsupported);
    block.addNode(irReturn(irParameter(0)));
    const codegen = new WasmCodegen();

    assert.equal(codegen.canCompile(graph), false);
    assert.match(codegen.lastCompileRejection, /IR_SIDE_EXIT_PORTAL/);
  });

  it("keeps runtime-stubbed generic calls inside the supported wasm boundary", () => {
    const graph = new IRGraph("runtime-stub-call");
    const block = graph.addBlock();
    const callee = irParameter(0);
    const arg = irParameter(1);
    const call = irGenericCall(callee, [arg]);
    call.frameState = frameState();
    block.addNode(callee);
    block.addNode(arg);
    block.addNode(call);
    block.addNode(irReturn(call));
    const codegen = new WasmCodegen();

    assert.equal(codegen.canCompile(graph), true);
    assert.equal(codegen.lastCompileRejection, null);
  });

  it("rejects polymorphic loads without a frame state because map miss deopts", () => {
    const graph = new IRGraph("polymorphic-load-frame-state");
    const block = graph.addBlock();
    const object = irParameter(0);
    const load = irPolymorphicLoad(object, [17, 23], [0, 1]);
    block.addNode(object);
    block.addNode(load);
    block.addNode(irReturn(load));

    assert.throws(
      () => validateOptimizedGraph(graph, []),
      GraphValidationError,
    );
  });

  it("rejects polymorphic stores without a frame state because map miss deopts", () => {
    const graph = new IRGraph("polymorphic-store-frame-state");
    const block = graph.addBlock();
    const object = irParameter(0);
    const value = irParameter(1);
    const store = irPolymorphicStore(object, [31, 43], [2, 4], value);
    block.addNode(object);
    block.addNode(value);
    block.addNode(store);
    block.addNode(irReturn(value));

    assert.throws(
      () => validateOptimizedGraph(graph, []),
      GraphValidationError,
    );
  });

  it("rejects lowered dispatch loads without a frame state because map miss deopts", () => {
    const graph = new IRGraph("dispatch-map-frame-state");
    const block = graph.addBlock();
    const object = irParameter(0);
    const load = new IRNode(IR_DISPATCH_MAP, {
      propertyName: "x",
      handlers: [
        { mapId: 11, offset: 0, hitCount: 7 },
        { mapId: 13, offset: 1, hitCount: 5 },
      ],
    });
    load.addInput(object);
    block.addNode(object);
    block.addNode(load);
    block.addNode(irReturn(load));

    assert.throws(
      () => validateOptimizedGraph(graph, []),
      GraphValidationError,
    );
  });

  it("rejects megamorphic loads without a frame state because runtime lookup can deopt", () => {
    const graph = new IRGraph("megamorphic-load-frame-state");
    const block = graph.addBlock();
    const object = irParameter(0);
    const load = new IRNode(IR_MEGAMORPHIC_LOAD, { propertyName: "x" });
    load.addInput(object);
    block.addNode(object);
    block.addNode(load);
    block.addNode(irReturn(load));

    assert.throws(
      () => validateOptimizedGraph(graph, []),
      GraphValidationError,
    );
  });

  it("rejects megamorphic stores without a frame state because runtime store can deopt", () => {
    const graph = new IRGraph("megamorphic-store-frame-state");
    const block = graph.addBlock();
    const object = irParameter(0);
    const value = irParameter(1);
    const store = new IRNode(IR_MEGAMORPHIC_STORE, { propertyName: "x" });
    store.addInput(object);
    store.addInput(value);
    block.addNode(object);
    block.addNode(value);
    block.addNode(store);
    block.addNode(irReturn(value));

    assert.throws(
      () => validateOptimizedGraph(graph, []),
      GraphValidationError,
    );
  });

  it("rejects overflow-capable int32 arithmetic without a frame state", () => {
    const graph = new IRGraph("int32-add-frame-state");
    const block = graph.addBlock();
    const left = irParameter(0);
    const right = irParameter(1);
    const add = irInt32Add(left, right);
    block.addNode(left);
    block.addNode(right);
    block.addNode(add);
    block.addNode(irReturn(add));

    assert.throws(
      () => validateOptimizedGraph(graph, []),
      GraphValidationError,
    );
  });

  it("accepts range-proven int32 arithmetic without a frame state", () => {
    const graph = new IRGraph("range-proven-int32-add");
    const block = graph.addBlock();
    const left = irParameter(0);
    const right = irParameter(1);
    const add = irInt32Add(left, right);
    add.props.noOverflow = true;
    block.addNode(left);
    block.addNode(right);
    block.addNode(add);
    block.addNode(irReturn(add));

    assert.equal(validateOptimizedGraph(graph, []), true);
  });

  it("rejects unsupported compare operators before wasm emission", () => {
    const graph = new IRGraph("unsupported-compare-operator");
    const block = graph.addBlock();
    const left = irParameter(0);
    const right = irParameter(1);
    const compare = irInt32Compare("===", left, right);
    block.addNode(left);
    block.addNode(right);
    block.addNode(compare);
    block.addNode(irReturn(compare));
    const codegen = new WasmCodegen();

    assert.equal(codegen.canCompile(graph), false);
    assert.match(
      codegen.lastCompileRejection,
      /unsupported compare operator ===/,
    );
  });

  it("rejects malformed polymorphic field tables before wasm emission", () => {
    const graph = new IRGraph("malformed-polymorphic-load");
    const block = graph.addBlock();
    const object = irParameter(0);
    const load = irPolymorphicLoad(object, [11, 19], [0]);
    block.addNode(object);
    block.addNode(load);
    block.addNode(irReturn(load));
    const codegen = new WasmCodegen();

    assert.equal(codegen.canCompile(graph), false);
    assert.match(codegen.lastCompileRejection, /invalid polymorphic map table/);
  });

  it("rejects malformed lowered dispatch handler tables before wasm emission", () => {
    const graph = new IRGraph("malformed-dispatch-load");
    const block = graph.addBlock();
    const object = irParameter(0);
    const load = new IRNode(IR_DISPATCH_MAP, {
      propertyName: "x",
      handlers: [{ mapId: 17, offset: -1, hitCount: 4 }],
    });
    load.addInput(object);
    load.frameState = frameState();
    block.addNode(object);
    block.addNode(load);
    block.addNode(irReturn(load));
    const codegen = new WasmCodegen();

    assert.equal(codegen.canCompile(graph), false);
    assert.match(
      codegen.lastCompileRejection,
      /invalid dispatch handler table/,
    );
  });

  it("accepts lowered dispatch stores with two inputs and valid handlers", () => {
    const graph = new IRGraph("valid-dispatch-store");
    const block = graph.addBlock();
    const object = irParameter(0);
    const value = irParameter(1);
    const store = new IRNode(IR_DISPATCH_MAP, {
      propertyName: "x",
      isStore: true,
      handlers: [
        { mapId: 29, offset: 0, hitCount: 8 },
        { mapId: 31, offset: 1, hitCount: 5 },
      ],
    });
    store.addInput(object);
    store.addInput(value);
    store.frameState = frameState();
    block.addNode(object);
    block.addNode(value);
    block.addNode(store);
    block.addNode(irReturn(value));
    const codegen = new WasmCodegen();

    assert.equal(codegen.canCompile(graph), true);
    assert.equal(codegen.lastCompileRejection, null);
  });

  it("marks lowered dispatch stores as runtime stub side effects", () => {
    const graph = new IRGraph("dispatch-store-side-effect");
    const block = graph.addBlock();
    const object = irParameter(0);
    const value = irParameter(1);
    const store = new IRNode(IR_DISPATCH_MAP, {
      propertyName: "x",
      isStore: true,
      handlers: [
        { mapId: 37, offset: 0, hitCount: 9 },
        { mapId: 41, offset: 1, hitCount: 6 },
      ],
    });
    store.addInput(object);
    store.addInput(value);
    store.frameState = frameState();
    block.addNode(object);
    block.addNode(value);
    block.addNode(store);
    block.addNode(irReturn(value));
    const codegen = new WasmCodegen();

    const analysis = codegen.analyzeGraph(graph);
    const stub = analysis.runtimeStubTable.getByNodeId(store.id);
    assert.equal(stub.sideEffect, true);
  });

  it("marks runtime stub side effects from IR effect kind instead of opcode lists", () => {
    const graph = new IRGraph("runtime-stub-effect-kind");
    const block = graph.addBlock();
    const object = irParameter(0);
    const read = irGenericGetProp(object, "fieldVariant");
    const call = new IRNode(IR_CALL_BUILTIN, {
      name: "effectVariant",
      argCount: 0,
    });
    call.frameState = frameState();
    block.addNode(object);
    block.addNode(read);
    block.addNode(call);
    block.addNode(irReturn(read));
    const codegen = new WasmCodegen();

    const analysis = codegen.analyzeGraph(graph);
    const readStub = analysis.runtimeStubTable.getByNodeId(read.id);
    const callStub = analysis.runtimeStubTable.getByNodeId(call.id);
    assert.equal(readStub.sideEffect, false);
    assert.equal(callStub.sideEffect, true);
  });

  it("rejects runtime-stub call nodes whose recorded arity does not match inputs", () => {
    const graph = new IRGraph("bad-call-arity");
    const block = graph.addBlock();
    const callee = irParameter(0);
    const arg = irParameter(1);
    const call = irGenericCall(callee, [arg]);
    call.props.argCount = 2;
    call.frameState = frameState();
    block.addNode(callee);
    block.addNode(arg);
    block.addNode(call);
    block.addNode(irReturn(call));
    const codegen = new WasmCodegen();

    assert.equal(codegen.canCompile(graph), false);
    assert.match(codegen.lastCompileRejection, /invalid call arity/);
  });

  it("accepts valid compare and polymorphic field shapes with different names and literals", () => {
    const graph = new IRGraph("shape-contract-variant");
    const block = graph.addBlock();
    const object = irParameter(0);
    const left = irPolymorphicLoad(object, [37, 41], [2, 5]);
    const right = irParameter(1);
    const compare = irFloat64Compare("<=", left, right);
    left.frameState = frameState();
    block.addNode(object);
    block.addNode(left);
    block.addNode(right);
    block.addNode(compare);
    block.addNode(irReturn(compare));
    const codegen = new WasmCodegen();

    assert.equal(codegen.canCompile(graph), true);
    assert.equal(codegen.lastCompileRejection, null);
  });
});
