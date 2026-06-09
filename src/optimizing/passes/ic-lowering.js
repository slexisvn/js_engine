import * as ir from "../ir/index.js";
import { tracer } from "../../core/tracing/index.js";
import { replaceGraphFrameStateValue } from "./frame-state-values.js";

const DISPATCH_THRESHOLD = 2;
const MEGAMORPHIC_THRESHOLD = 6;

export function inlineCacheLowering(graph, feedback, icManager) {
  let loweredCount = 0;

  for (const block of graph.blocks) {
    const newNodes = [];

    for (const node of block.nodes) {
      if (
        node.type === ir.IR_POLYMORPHIC_LOAD &&
        node.props &&
        node.props.handlers
      ) {
        const handlers = node.props.handlers;

        if (handlers.length > MEGAMORPHIC_THRESHOLD) {
          const megaNode = makeLoweredNode(node, ir.IR_MEGAMORPHIC_LOAD, {
            propertyName: node.props.propertyName,
            feedbackSlot: node.props.feedbackSlot,
          });
          replaceNodeInUses(node, megaNode);
          replaceGraphFrameStateValue(graph, node, megaNode);
          newNodes.push(megaNode);
          loweredCount++;
          tracer.log("JIT", `IC lowering: v${node.id} → megamorphic load`);
          continue;
        }

        if (handlers.length >= DISPATCH_THRESHOLD) {
          const sorted = sortByFrequency(handlers);
          const dispatchNode = makeLoweredNode(node, ir.IR_DISPATCH_MAP, {
            propertyName: node.props.propertyName,
            handlers: sorted,
            feedbackSlot: node.props.feedbackSlot,
            dominant: findDominant(sorted),
          });
          replaceNodeInUses(node, dispatchNode);
          replaceGraphFrameStateValue(graph, node, dispatchNode);
          newNodes.push(dispatchNode);
          loweredCount++;
          tracer.log(
            "JIT",
            `IC lowering: v${node.id} → dispatch (${sorted.length} handlers)`,
          );
          continue;
        }
      }

      if (
        node.type === ir.IR_POLYMORPHIC_STORE &&
        node.props &&
        node.props.handlers
      ) {
        const handlers = node.props.handlers;

        if (handlers.length > MEGAMORPHIC_THRESHOLD) {
          const megaNode = makeLoweredNode(node, ir.IR_MEGAMORPHIC_STORE, {
            propertyName: node.props.propertyName,
            feedbackSlot: node.props.feedbackSlot,
          });
          replaceNodeInUses(node, megaNode);
          replaceGraphFrameStateValue(graph, node, megaNode);
          newNodes.push(megaNode);
          loweredCount++;
          tracer.log("JIT", `IC lowering: v${node.id} → megamorphic store`);
          continue;
        }

        if (handlers.length >= DISPATCH_THRESHOLD) {
          const sorted = sortByFrequency(handlers);
          const dispatchNode = makeLoweredNode(node, ir.IR_DISPATCH_MAP, {
            propertyName: node.props.propertyName,
            handlers: sorted,
            feedbackSlot: node.props.feedbackSlot,
            isStore: true,
            dominant: findDominant(sorted),
          });
          replaceNodeInUses(node, dispatchNode);
          replaceGraphFrameStateValue(graph, node, dispatchNode);
          newNodes.push(dispatchNode);
          loweredCount++;
          continue;
        }
      }

      newNodes.push(node);
    }

    block.nodes = newNodes;
  }

  return loweredCount;
}

function makeLoweredNode(oldNode, type, props) {
  const metadata = props.isStore
    ? { ...props, effectKind: ir.EFFECT_WRITE }
    : props;
  const node = new ir.IRNode(type, metadata);
  node.id = oldNode.id;
  node.inputs = [...oldNode.inputs];
  node.uses = [...oldNode.uses];
  node.rep = oldNode.rep || node.rep;
  node.frameState = oldNode.frameState || null;
  node.block = oldNode.block || null;
  return node;
}

function sortByFrequency(handlers) {
  return [...handlers].sort((a, b) => (b.hitCount || 0) - (a.hitCount || 0));
}

function findDominant(sortedHandlers) {
  if (sortedHandlers.length < 2) return null;
  const totalHits = sortedHandlers.reduce(
    (sum, h) => sum + (h.hitCount || 0),
    0,
  );
  if (totalHits === 0) return null;
  const top = sortedHandlers[0];
  if ((top.hitCount || 0) / totalHits >= 0.8) {
    return top;
  }
  return null;
}

function replaceNodeInUses(oldNode, newNode) {
  for (const user of oldNode.uses) {
    for (let i = 0; i < user.inputs.length; i++) {
      if (user.inputs[i] === oldNode) {
        user.inputs[i] = newNode;
      }
    }
  }
}
