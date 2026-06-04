export function visitFrameStateValues(frameState, visitor, seen = new Set()) {
  if (!frameState || seen.has(frameState)) return;
  seen.add(frameState);

  for (const [slot, value] of frameState.localValues || []) {
    visitor(value, (next) => frameState.localValues.set(slot, next));
  }

  const stackValues = frameState.stackValues || [];
  for (let i = 0; i < stackValues.length; i++) {
    visitor(stackValues[i], (next) => {
      stackValues[i] = next;
    });
  }

  visitor(frameState.thisValue, (next) => {
    frameState.thisValue = next;
  });

  visitFrameStateValues(frameState.callerFrameState, visitor, seen);
}

export function visitGraphFrameStateValues(graph, visitor) {
  for (const block of graph.blocks) {
    for (const node of block.nodes) {
      if (node.frameState) visitFrameStateValues(node.frameState, visitor);
    }
  }
}

export function replaceGraphFrameStateValue(graph, oldNode, newNode) {
  if (graph._frameStateIndex) {
    const locations = graph._frameStateIndex.get(oldNode);
    if (!locations) return;
    for (const { replace } of locations) replace(newNode);
    graph._frameStateIndex.delete(oldNode);
    let newLocations = graph._frameStateIndex.get(newNode);
    if (!newLocations) {
      newLocations = [];
      graph._frameStateIndex.set(newNode, newLocations);
    }
    for (const loc of locations) {
      newLocations.push({ replace: loc.replace });
    }
    return;
  }
  visitGraphFrameStateValues(graph, (value, replace) => {
    if (value === oldNode) replace(newNode);
  });
}

export function buildFrameStateIndex(graph) {
  const index = new Map();
  const record = (value, replace) => {
    if (!value || value.id === undefined) return;
    let locs = index.get(value);
    if (!locs) {
      locs = [];
      index.set(value, locs);
    }
    locs.push({ replace });
  };
  for (const block of graph.blocks) {
    for (const node of block.nodes) {
      if (node.frameState) visitFrameStateValues(node.frameState, record);
    }
  }
  graph._frameStateIndex = index;
}

export function clearFrameStateIndex(graph) {
  graph._frameStateIndex = null;
}

export function markFrameStateValues(frameState, liveNodes, worklist) {
  visitFrameStateValues(frameState, (value) => {
    if (value && value.id !== undefined && !liveNodes.has(value.id)) {
      liveNodes.add(value.id);
      worklist.push(value);
    }
  });
}
