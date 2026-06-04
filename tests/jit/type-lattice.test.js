import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  IRGraph,
  IRNode,
  IR_BLOCK_PARAM,
  IR_CHECK_NUMBER,
  IR_CHECK_SMI,
  IR_CONSTANT,
  IR_GENERIC_ADD,
  IR_GENERIC_MUL,
  IR_FLOAT64_ADD,
  IR_INT32_ADD,
  IR_INT32_COMPARE,
  IR_FLOAT64_MUL,
  IR_PARAMETER,
  IR_RETURN,
  IR_BRANCH,
  IR_TYPEOF,
} from "../../src/optimizing/ir/index.js";
import { typeNarrowing } from "../../src/optimizing/passes/type-narrowing.js";
import {
  TypeKind,
  arrayType,
  doubleType,
  isSubtype,
  joinTypes,
  narrowType,
  nullishType,
  numberType,
  objectType,
  smiType,
  taggedType,
  typeFromTypeof,
  typeEquals,
} from "../../src/optimizing/types/lattice.js";

describe("type lattice", () => {
  it("joins smi and double into number", () => {
    assert.equal(joinTypes(smiType(), doubleType()).kind, TypeKind.Number);
  });

  it("keeps specific map object below generic object", () => {
    const specific = objectType(7);
    const generic = objectType();
    assert.equal(isSubtype(specific, generic), true);
    assert.equal(isSubtype(generic, specific), false);
  });

  it("narrows generic object to array when array fact is proven", () => {
    const narrowed = narrowType(objectType(), arrayType("PACKED_SMI"));
    assert.equal(typeEquals(narrowed, arrayType("PACKED_SMI")), true);
  });

  it("keeps smi when narrowed by number fact", () => {
    assert.equal(
      typeEquals(narrowType(smiType(), numberType()), smiType()),
      true,
    );
  });

  it("keeps typeof object conservative because null also matches it", () => {
    assert.equal(typeEquals(typeFromTypeof("object"), taggedType()), true);
  });

  it("maps typeof undefined to the nullish lattice family", () => {
    assert.equal(typeEquals(typeFromTypeof("undefined"), nullishType()), true);
  });
});

describe("type narrowing pass", () => {
  it("specializes generic add after smi guards regardless of parameter names", () => {
    const graph = new IRGraph("renamed-arithmetic");
    const block = graph.addBlock();
    const alpha = new IRNode(IR_PARAMETER, { index: 0 });
    const beta = new IRNode(IR_PARAMETER, { index: 1 });
    const checkedAlpha = new IRNode(IR_CHECK_SMI);
    checkedAlpha.addInput(alpha);
    const checkedBeta = new IRNode(IR_CHECK_SMI);
    checkedBeta.addInput(beta);
    const add = new IRNode(IR_GENERIC_ADD);
    add.addInput(checkedAlpha);
    add.addInput(checkedBeta);
    block.addNode(alpha);
    block.addNode(beta);
    block.addNode(checkedAlpha);
    block.addNode(checkedBeta);
    block.addNode(add);

    assert.equal(typeNarrowing(graph), 1);
    assert.equal(add.type, IR_INT32_ADD);
  });

  it("specializes generic multiply after number guards with non-benchmark literals", () => {
    const graph = new IRGraph("variant-arithmetic");
    const block = graph.addBlock();
    const left = new IRNode(IR_PARAMETER, { index: 0 });
    const right = new IRNode(IR_PARAMETER, { index: 1 });
    const checkedLeft = new IRNode(IR_CHECK_NUMBER);
    checkedLeft.addInput(left);
    const checkedRight = new IRNode(IR_CHECK_NUMBER);
    checkedRight.addInput(right);
    const mul = new IRNode(IR_GENERIC_MUL);
    mul.addInput(checkedLeft);
    mul.addInput(checkedRight);
    block.addNode(left);
    block.addNode(right);
    block.addNode(checkedLeft);
    block.addNode(checkedRight);
    block.addNode(mul);

    assert.equal(typeNarrowing(graph), 1);
    assert.equal(mul.type, IR_FLOAT64_MUL);
  });

  it("merges block param input types before specializing users", () => {
    const graph = new IRGraph("phi-merge");
    const block = graph.addBlock();
    const first = new IRNode(IR_PARAMETER, { index: 0 });
    const second = new IRNode(IR_PARAMETER, { index: 1 });
    const checkedFirst = new IRNode(IR_CHECK_SMI);
    checkedFirst.addInput(first);
    const checkedSecond = new IRNode(IR_CHECK_NUMBER);
    checkedSecond.addInput(second);
    const phi = new IRNode(IR_BLOCK_PARAM, { index: 0 });
    phi.addInput(checkedFirst);
    phi.addInput(checkedSecond);
    const mul = new IRNode(IR_GENERIC_MUL);
    mul.addInput(phi);
    mul.addInput(checkedFirst);
    block.params.push(phi);
    block.addNode(phi);
    block.addNode(first);
    block.addNode(second);
    block.addNode(checkedFirst);
    block.addNode(checkedSecond);
    block.addNode(mul);

    assert.equal(typeNarrowing(graph), 1);
    assert.equal(mul.type, IR_FLOAT64_MUL);
  });

  it("applies typeof facts only to the proven branch edge", () => {
    const graph = new IRGraph("branch-edge-facts");
    const entry = graph.addBlock();
    const trueBlock = graph.addBlock();
    const falseBlock = graph.addBlock();
    const value = new IRNode(IR_PARAMETER, { index: 0 });
    const one = new IRNode(IR_CONSTANT, { value: 1 });
    const two = new IRNode(IR_CONSTANT, { value: 2 });
    const typeOfValue = new IRNode(IR_TYPEOF);
    typeOfValue.addInput(value);
    const numberName = new IRNode(IR_CONSTANT, { value: "number" });
    const condition = new IRNode(IR_INT32_COMPARE, { op: "==" });
    condition.addInput(typeOfValue);
    condition.addInput(numberName);
    const branch = new IRNode(IR_BRANCH, {
      trueBlock: trueBlock.id,
      falseBlock: falseBlock.id,
    });
    branch.addInput(condition);
    const trueAdd = new IRNode(IR_GENERIC_ADD);
    trueAdd.addInput(value);
    trueAdd.addInput(one);
    const falseAdd = new IRNode(IR_GENERIC_ADD);
    falseAdd.addInput(value);
    falseAdd.addInput(two);
    entry.addNode(value);
    entry.addNode(typeOfValue);
    entry.addNode(numberName);
    entry.addNode(condition);
    entry.addNode(branch);
    entry.addSuccessor(trueBlock);
    entry.addSuccessor(falseBlock);
    trueBlock.addNode(one);
    trueBlock.addNode(trueAdd);
    trueBlock.addNode(new IRNode(IR_RETURN));
    trueBlock.nodes[trueBlock.nodes.length - 1].addInput(trueAdd);
    falseBlock.addNode(two);
    falseBlock.addNode(falseAdd);
    falseBlock.addNode(new IRNode(IR_RETURN));
    falseBlock.nodes[falseBlock.nodes.length - 1].addInput(falseAdd);

    assert.equal(typeNarrowing(graph), 1);
    assert.equal(trueAdd.type, IR_FLOAT64_ADD);
    assert.equal(falseAdd.type, IR_GENERIC_ADD);
  });
});
