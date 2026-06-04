import { AdaptiveTieringPolicy } from "./adaptive.js";

export const DEFAULT_TIERING_POLICY = Object.freeze({
  baselineThreshold: 20,
  jitThreshold: 100,
  loopOsrThreshold: 50,
  maxDeoptCount: 3,
});

export function createTieringPolicy(overrides = {}) {
  if (
    overrides === "adaptive" ||
    (overrides && overrides.mode === "adaptive")
  ) {
    return new AdaptiveTieringPolicy(overrides);
  }
  return Object.freeze({
    ...DEFAULT_TIERING_POLICY,
    ...overrides,
  });
}
