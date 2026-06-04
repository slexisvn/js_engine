import {
  PACKED_SMI,
  PACKED_DOUBLE,
} from "../../objects/elements/elements-kind.js";
import { isSubtype, numberType, smiType } from "../types/lattice.js";
import {
  ROP_EQ,
  ROP_NEQ,
  ROP_LOOSE_EQ,
  ROP_LOOSE_NEQ,
  ROP_LT,
  ROP_GT,
  ROP_LTE,
  ROP_GTE,
} from "../../bytecode/register/ops/bytecode.js";

export const COMPARE_OP_MAP = {
  [ROP_EQ]: "==",
  [ROP_NEQ]: "!=",
  [ROP_LOOSE_EQ]: "loose==",
  [ROP_LOOSE_NEQ]: "loose!=",
  [ROP_LT]: "<",
  [ROP_GT]: ">",
  [ROP_LTE]: "<=",
  [ROP_GTE]: ">=",
};

export function numericPackedElementRep(elementsKind) {
  if (elementsKind === PACKED_SMI) return "int32";
  if (elementsKind === PACKED_DOUBLE) return "float64";
  return null;
}

export function numericFeedbackKind(feedback, index, op) {
  if (index < 0 || !feedback) return "generic";
  const hint =
    op === "unary" ? feedback.unaryOp(index) : feedback.binaryOp(index);
  const type = hint.inputType;
  if (isSubtype(type, smiType())) return "smi";
  if (isSubtype(type, numberType())) return "number";
  return "generic";
}
