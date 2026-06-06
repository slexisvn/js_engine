import { describe, it, expect, beforeEach } from "vitest";
import { escapeAnalysisAndScalarReplacement } from "../../src/optimizing/passes/escape-analysis.js";
import {
  CFGFunction,
  irConstant,
  irNewObject,
  irNewArray,
  irGenericSetProp,
  irGenericGetProp,
  irStoreField,
  irLoadField,
  irGenericCall,
  irInt32Add,
  irReturn,
  IR_NEW_OBJECT,
  IR_GENERIC_SET_PROP,
  IR_GENERIC_GET_PROP,
  IR_STORE_FIELD,
  IR_LOAD_FIELD,
  IR_CONSTANT,
  resetIRNodeIds,
} from "../../src/optimizing/ir/index.js";

beforeEach(() => resetIRNodeIds());

describe("escapeAnalysisAndScalarReplacement", () => {
  it("scalar replaces non-escaping object with property access", () => {
    const graph = new CFGFunction("test");
    const block = graph.addBlock();
    const alloc = irNewObject();
    block.addNode(alloc);
    const val = irConstant(42);
    block.addNode(val);
    const set = irGenericSetProp(alloc, "x", val);
    block.addNode(set);
    const get = irGenericGetProp(alloc, "x");
    block.addNode(get);
    const ret = irReturn(get);
    block.addNode(ret);
    const count = escapeAnalysisAndScalarReplacement(graph);
    expect(count).toBe(1);
    expect(block.nodes.some(n => n.type === IR_NEW_OBJECT)).toBe(false);
    expect(ret.inputs[0].type).toBe(IR_CONSTANT);
    expect(ret.inputs[0].props.value).toBe(42);
  });

  it("scalar replaces non-escaping object with field access", () => {
    const graph = new CFGFunction("test");
    const block = graph.addBlock();
    const alloc = irNewObject();
    block.addNode(alloc);
    const val = irConstant(99);
    block.addNode(val);
    const store = irStoreField(alloc, 0, val);
    block.addNode(store);
    const load = irLoadField(alloc, 0);
    block.addNode(load);
    const ret = irReturn(load);
    block.addNode(ret);
    const count = escapeAnalysisAndScalarReplacement(graph);
    expect(count).toBe(1);
    expect(ret.inputs[0].props.value).toBe(99);
  });

  it("does NOT replace when object escapes through call", () => {
    const graph = new CFGFunction("test");
    const block = graph.addBlock();
    const alloc = irNewObject();
    block.addNode(alloc);
    const callee = irConstant("fn");
    block.addNode(callee);
    const call = irGenericCall(callee, [alloc]);
    block.addNode(call);
    const ret = irReturn(irConstant(0));
    block.addNode(ret);
    const count = escapeAnalysisAndScalarReplacement(graph);
    expect(count).toBe(0);
    expect(block.nodes.some(n => n.type === IR_NEW_OBJECT)).toBe(true);
  });

  it("does NOT replace when object is returned (escapes)", () => {
    const graph = new CFGFunction("test");
    const block = graph.addBlock();
    const alloc = irNewObject();
    block.addNode(alloc);
    const ret = irReturn(alloc);
    block.addNode(ret);
    const count = escapeAnalysisAndScalarReplacement(graph);
    expect(count).toBe(0);
  });

  it("inserts undefined for uninitialized property read", () => {
    const graph = new CFGFunction("test");
    const block = graph.addBlock();
    const alloc = irNewObject();
    block.addNode(alloc);
    const get = irGenericGetProp(alloc, "y");
    block.addNode(get);
    const ret = irReturn(get);
    block.addNode(ret);
    const count = escapeAnalysisAndScalarReplacement(graph);
    expect(count).toBe(1);
    expect(ret.inputs[0].type).toBe(IR_CONSTANT);
    expect(ret.inputs[0].props.value).toBeUndefined();
  });

  it("handles multiple properties on same object", () => {
    const graph = new CFGFunction("test");
    const block = graph.addBlock();
    const alloc = irNewObject();
    block.addNode(alloc);
    const v1 = irConstant(10);
    const v2 = irConstant(20);
    block.addNode(v1);
    block.addNode(v2);
    const set1 = irGenericSetProp(alloc, "a", v1);
    block.addNode(set1);
    const set2 = irGenericSetProp(alloc, "b", v2);
    block.addNode(set2);
    const get1 = irGenericGetProp(alloc, "a");
    block.addNode(get1);
    const get2 = irGenericGetProp(alloc, "b");
    block.addNode(get2);
    const sum = irInt32Add(get1, get2);
    block.addNode(sum);
    const ret = irReturn(sum);
    block.addNode(ret);
    const count = escapeAnalysisAndScalarReplacement(graph);
    expect(count).toBe(1);
  });
});
