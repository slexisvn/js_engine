import {
  PACKED_SMI,
  PACKED_DOUBLE,
  HOLEY_SMI,
  HOLEY_DOUBLE,
  PACKED_TAGGED,
  HOLEY_TAGGED,
} from "../../objects/elements/elements-kind.js";

export const ELEMENTS_KIND_IDS = new Map([
  [PACKED_SMI, 1],
  [PACKED_DOUBLE, 2],
  [PACKED_TAGGED, 3],
  [HOLEY_SMI, 4],
  [HOLEY_DOUBLE, 5],
  [HOLEY_TAGGED, 6],
]);

export function elementsKindId(kind) {
  return ELEMENTS_KIND_IDS.get(kind) || 0;
}
