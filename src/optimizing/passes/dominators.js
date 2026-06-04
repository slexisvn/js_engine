export function computeDominators(graph) {
  const blocks = graph.blocks;
  const n = blocks.length;
  if (n === 0) return new Map();

  const blockIndex = new Map();
  for (let i = 0; i < n; i++) blockIndex.set(blocks[i], i);

  const domBits = new Array(n);
  const allMask = new Uint8Array(n);
  allMask.fill(1);
  for (let i = 0; i < n; i++) {
    domBits[i] = new Uint8Array(n);
    if (blocks[i] === graph.entry) {
      domBits[i][i] = 1;
    } else {
      domBits[i].set(allMask);
    }
  }

  const scratch = new Uint8Array(n);
  let changed = true;
  while (changed) {
    changed = false;
    for (let bi = 0; bi < n; bi++) {
      if (blocks[bi] === graph.entry) continue;
      const preds = blocks[bi].predecessors;
      if (preds.length === 0) {
        const cur = domBits[bi];
        const onlySelf = cur[bi] === 1 && cur.reduce((s, v) => s + v, 0) === 1;
        if (!onlySelf) {
          cur.fill(0);
          cur[bi] = 1;
          changed = true;
        }
        continue;
      }
      scratch.set(allMask);
      for (const pred of preds) {
        const pi = blockIndex.get(pred);
        if (pi === undefined) continue;
        const predDom = domBits[pi];
        for (let j = 0; j < n; j++) {
          scratch[j] &= predDom[j];
        }
      }
      scratch[bi] = 1;

      const cur = domBits[bi];
      let diff = false;
      for (let j = 0; j < n; j++) {
        if (cur[j] !== scratch[j]) {
          diff = true;
          break;
        }
      }
      if (diff) {
        cur.set(scratch);
        changed = true;
      }
    }
  }

  const dom = new Map();
  for (let i = 0; i < n; i++) {
    const s = new Set();
    for (let j = 0; j < n; j++) {
      if (domBits[i][j]) s.add(blocks[j]);
    }
    dom.set(blocks[i], s);
  }
  return dom;
}

export function buildDominatorTree(graph, dominators) {
  const children = new Map(graph.blocks.map((block) => [block, []]));
  const idomMap = new Map();

  const domSize = new Map();
  for (const [block, domSet] of dominators) {
    domSize.set(block, domSet.size);
  }

  for (const block of graph.blocks) {
    if (block === graph.entry) continue;
    const domSet = dominators.get(block);
    if (!domSet) continue;

    let idom = null;
    let idomSize = 0;
    for (const cand of domSet) {
      if (cand === block) continue;
      const sz = domSize.get(cand) || 0;
      if (sz > idomSize) {
        idomSize = sz;
        idom = cand;
      }
    }

    idomMap.set(block, idom);
    if (idom && children.has(idom)) children.get(idom).push(block);
  }
  return { children, idomMap };
}

export function dominates(dominators, a, b) {
  const domSet = dominators.get(b);
  return domSet ? domSet.has(a) : false;
}
