import { getPayload, getHeapId } from "../core/value/index.js";

export function enumerateRoots(interpreter, globalCells, microtaskQueue) {
  const roots = [];

  if (interpreter && interpreter.activeFrames) {
    for (const frame of interpreter.activeFrames) {
      if (frame.locals) {
        for (const local of frame.locals) {
          const obj = extractHeapObject(local);
          if (obj) roots.push(obj);
        }
      }
      if (frame.stack) {
        for (const val of frame.stack) {
          const obj = extractHeapObject(val);
          if (obj) roots.push(obj);
        }
      }
    }
  }

  if (globalCells) {
    const cellsMap = globalCells.cells || globalCells;
    if (
      cellsMap instanceof Map ||
      (cellsMap && typeof cellsMap[Symbol.iterator] === "function")
    ) {
      for (const [, cell] of cellsMap) {
        const val = cell && cell.value !== undefined ? cell.value : cell;
        const obj = extractHeapObject(val);
        if (obj) roots.push(obj);
      }
    }
  }

  if (microtaskQueue && microtaskQueue.queue) {
    for (const task of microtaskQueue.queue) {
      if (task && task.promise && task.promise.gcHeader) {
        roots.push(task.promise);
      }
    }
  }

  return roots;
}

export function collectLiveHeapIds(interpreter, globalCells) {
  const liveIds = new Set();

  const trackValue = (v) => {
    const id = getHeapId(v);
    if (id > 0) liveIds.add(id);
  };

  if (interpreter && interpreter.activeFrames) {
    for (const frame of interpreter.activeFrames) {
      if (frame.locals) {
        for (const local of frame.locals) trackValue(local);
      }
      if (frame.stack) {
        for (const val of frame.stack) trackValue(val);
      }
      if (frame.compiledFn && frame.compiledFn.constants) {
        for (const c of frame.compiledFn.constants) {
          if (typeof c === "number") trackValue(c);
        }
      }
    }
  }

  if (globalCells) {
    const cellsMap = globalCells.cells || globalCells;
    if (
      cellsMap instanceof Map ||
      (cellsMap && typeof cellsMap[Symbol.iterator] === "function")
    ) {
      for (const [, cell] of cellsMap) {
        const val = cell && cell.value !== undefined ? cell.value : cell;
        trackValue(val);
      }
    }
  }

  return liveIds;
}

function extractHeapObject(tagged) {
  if (tagged && typeof tagged === "object" && tagged.gcHeader) return tagged;
  const payload = getPayload(tagged);
  if (payload && typeof payload === "object" && payload.gcHeader)
    return payload;
  return null;
}

export { extractHeapObject };
