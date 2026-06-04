import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { MiniJIT } from '../src/index.js';

const DEFAULT_SEED = 12648430;

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeVariants(seed, count) {
  const random = mulberry32(seed);
  const names = ['alpha', 'beta', 'delta', 'omega', 'sigma', 'theta', 'value', 'slot'];
  const variants = [];
  for (let i = 0; i < count; i++) {
    variants.push({
      a: 3 + Math.floor(random() * 17),
      b: 5 + Math.floor(random() * 19),
      n: 80 + Math.floor(random() * 60),
      x: names[Math.floor(random() * names.length)] + i,
      y: names[Math.floor(random() * names.length)] + (i + 13),
    });
  }
  return variants;
}

const kernels = [
  {
    name: 'arithmetic-loop',
    source: ({ a, b, n, x, y }) => `
      function run(${x}, ${y}) {
        let total = 0;
        let i = 0;
        while (i < ${n}) {
          total = total + ${x} * ${y} - i;
          i = i + 1;
        }
        return total;
      }
      run(${a}, ${b});
    `,
  },
  {
    name: 'property-load-store',
    source: ({ a, b, n, x }) => `
      function Point(left, right) {
        this.left = left;
        this.right = right;
      }
      function run() {
        let obj = new Point(${a}, ${b});
        let total = 0;
        let i = 0;
        while (i < ${n}) {
          obj.left = obj.left + 1;
          total = total + obj.left + obj.right;
          i = i + 1;
        }
        return total + obj.${x === 'left' ? 'right' : 'left'};
      }
      run();
    `,
  },
  {
    name: 'array-indexing',
    source: ({ a, b, n }) => `
      function run() {
        let items = [${a}, ${b}, ${a + b}, ${a * b}];
        let total = 0;
        let i = 0;
        while (i < ${n}) {
          total = total + items[i % 4];
          i = i + 1;
        }
        return total;
      }
      run();
    `,
  },
  {
    name: 'call-dispatch',
    source: ({ a, b, n }) => `
      function add(left, right) { return left + right; }
      function mul(left, right) { return left * right; }
      function run() {
        let total = 0;
        let i = 0;
        while (i < ${n}) {
          total = total + add(i, ${a}) + mul(${b}, i);
          i = i + 1;
        }
        return total;
      }
      run();
    `,
  },
  {
    name: 'allocation',
    source: ({ a, b, n }) => `
      function Pair(left, right) {
        this.left = left;
        this.right = right;
      }
      function run() {
        let total = 0;
        let i = 0;
        while (i < ${n}) {
          var pair = new Pair(i + ${a}, i + ${b});
          total = total + pair.left + pair.right;
          i = i + 1;
        }
        return total;
      }
      run();
    `,
  },
];

function runOne(engine, source, warmup, measure) {
  const originalLog = console.log;
  console.log = () => {};
  try {
    for (let i = 0; i < warmup; i++) engine.run(source);
    const start = performance.now();
    let last = null;
    for (let i = 0; i < measure; i++) last = engine.runValue(source).value;
    return { ms: performance.now() - start, last };
  } finally {
    console.log = originalLog;
  }
}

export function runBenchmark({ seed, variants, warmup, measure }) {
  const inputs = makeVariants(seed, variants);
  const results = [];
  for (const kernel of kernels) {
    const times = [];
    const outputs = [];
    for (const input of inputs) {
      const engine = new MiniJIT({ tieringPolicy: 'adaptive' });
      const result = runOne(engine, kernel.source(input), warmup, measure);
      times.push(result.ms);
      outputs.push(result.last);
    }
    const totalMs = times.reduce((sum, value) => sum + value, 0);
    results.push({
      name: kernel.name,
      variants: inputs.length,
      totalMs,
      meanMs: totalMs / inputs.length,
      minMs: Math.min(...times),
      maxMs: Math.max(...times),
      outputs,
    });
  }
  return {
    seed,
    warmup,
    measure,
    variants,
    results,
  };
}

function parseArgs(argv) {
  const options = { seed: DEFAULT_SEED, variants: 5, warmup: 12, measure: 30, json: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--seed') options.seed = Number(argv[++i]);
    else if (arg === '--variants') options.variants = Number(argv[++i]);
    else if (arg === '--warmup') options.warmup = Number(argv[++i]);
    else if (arg === '--measure') options.measure = Number(argv[++i]);
  }
  return options;
}

function printText(report) {
  console.log(`seed=${report.seed} variants=${report.variants} warmup=${report.warmup} measure=${report.measure}`);
  for (const result of report.results) {
    console.log(`${result.name}: total=${result.totalMs.toFixed(3)}ms mean=${result.meanMs.toFixed(3)}ms min=${result.minMs.toFixed(3)}ms max=${result.maxMs.toFixed(3)}ms`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseArgs(process.argv);
  const report = runBenchmark(options);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printText(report);
  }
}
