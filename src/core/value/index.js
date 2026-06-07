export const TAG_SMI = "smi";
export const TAG_DOUBLE = "double";
export const TAG_BOOL = "bool";
export const TAG_STRING = "string";
export const TAG_OBJECT = "object";
export const TAG_FUNCTION = "function";
export const TAG_ARRAY = "array";
export const TAG_PROMISE = "promise";
export const TAG_ITERATOR = "iterator";
export const TAG_GENERATOR = "generator";
export const TAG_REGEX = "regex";
export const TAG_SYMBOL = "symbol";
export const TAG_UNDEFINED = "undefined";
export const TAG_NULL = "null";

const SMI_MAX = 0x3fffffff;
const SMI_MIN = -0x40000000;
const TAG_BITS = 4;
const TAG_MASK = 0xf;

const CODE_SMI = 0;
const CODE_FALSE = 1;
const CODE_TRUE = 2;
const CODE_UNDEFINED = 3;
const CODE_NULL = 4;
const CODE_DOUBLE = 5;
const CODE_STRING = 6;
const CODE_OBJECT = 7;
const CODE_FUNCTION = 8;
const CODE_ARRAY = 9;
const CODE_PROMISE = 10;
const CODE_ITERATOR = 11;
const CODE_GENERATOR = 12;
const CODE_REGEX = 13;
const CODE_SYMBOL = 14;

const CODE_TO_TAG = [
  TAG_SMI,
  TAG_BOOL,
  TAG_BOOL,
  TAG_UNDEFINED,
  TAG_NULL,
  TAG_DOUBLE,
  TAG_STRING,
  TAG_OBJECT,
  TAG_FUNCTION,
  TAG_ARRAY,
  TAG_PROMISE,
  TAG_ITERATOR,
  TAG_GENERATOR,
  TAG_REGEX,
  TAG_SYMBOL,
];

const TAG_TO_CODE = new Map([
  [TAG_DOUBLE, CODE_DOUBLE],
  [TAG_STRING, CODE_STRING],
  [TAG_OBJECT, CODE_OBJECT],
  [TAG_FUNCTION, CODE_FUNCTION],
  [TAG_ARRAY, CODE_ARRAY],
  [TAG_PROMISE, CODE_PROMISE],
  [TAG_ITERATOR, CODE_ITERATOR],
  [TAG_GENERATOR, CODE_GENERATOR],
  [TAG_REGEX, CODE_REGEX],
  [TAG_SYMBOL, CODE_SYMBOL],
]);

const heapPayloads = [null];
const heapFreeList = [];
const pinnedHeapIds = new Set();

function codeOf(v) {
  if (typeof v !== "number") return CODE_UNDEFINED;
  return ((v % (1 << TAG_BITS)) + (1 << TAG_BITS)) & TAG_MASK;
}

function heapId(v) {
  return Math.trunc((v - codeOf(v)) / (1 << TAG_BITS));
}

function heapValue(tag, payload) {
  const code = TAG_TO_CODE.get(tag);
  let id;
  if (heapFreeList.length > 0) {
    id = heapFreeList.pop();
    heapPayloads[id] = payload;
  } else {
    id = heapPayloads.length;
    heapPayloads.push(payload);
  }
  return id * (1 << TAG_BITS) + code;
}

export function mkSmi(n) {
  const v = n | 0;
  return v * (1 << TAG_BITS) + CODE_SMI;
}

export function mkDouble(n) {
  return heapValue(TAG_DOUBLE, +n);
}

export function mkBool(b) {
  return b ? CODE_TRUE : CODE_FALSE;
}

export function mkString(s) {
  return heapValue(TAG_STRING, "" + s);
}

export function mkObject(obj) {
  return heapValue(TAG_OBJECT, obj);
}

export function mkFunction(fn) {
  return heapValue(TAG_FUNCTION, fn);
}

export function mkArray(arr) {
  return heapValue(TAG_ARRAY, arr);
}

export function mkPromise(promise) {
  return heapValue(TAG_PROMISE, promise);
}

export function mkIterator(iterator) {
  return heapValue(TAG_ITERATOR, iterator);
}

export function mkGenerator(gen) {
  return heapValue(TAG_GENERATOR, gen);
}

export function mkRegex(nativeRegex) {
  return heapValue(TAG_REGEX, { nativeRegex, lastIndex: 0 });
}

export function mkSymbol(sym) {
  return heapValue(TAG_SYMBOL, sym);
}

export function mkUndefined() {
  return CODE_UNDEFINED;
}

export function mkNull() {
  return CODE_NULL;
}

export function mkNumber(n) {
  if (n === 0 && (1 / n) === -Infinity) return mkDouble(n);
  if (Number.isInteger(n) && n >= SMI_MIN && n <= SMI_MAX) {
    return mkSmi(n);
  }
  return mkDouble(n);
}

export function getTag(v) {
  return CODE_TO_TAG[codeOf(v)] || TAG_UNDEFINED;
}

export function getPayload(v) {
  switch (codeOf(v)) {
    case CODE_SMI:
      return Math.trunc(v / (1 << TAG_BITS));
    case CODE_FALSE:
      return false;
    case CODE_TRUE:
      return true;
    case CODE_NULL:
      return null;
    case CODE_UNDEFINED:
      return undefined;
    case CODE_DOUBLE:
    case CODE_STRING:
    case CODE_OBJECT:
    case CODE_FUNCTION:
    case CODE_ARRAY:
    case CODE_PROMISE:
    case CODE_ITERATOR:
    case CODE_GENERATOR:
    case CODE_REGEX:
    case CODE_SYMBOL:
      return heapPayloads[heapId(v)];
    default:
      return undefined;
  }
}

export function isTaggedValue(v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return false;
  const code = codeOf(v);
  if (code === CODE_SMI) return Number.isInteger(v / (1 << TAG_BITS));
  if (
    code === CODE_FALSE ||
    code === CODE_TRUE ||
    code === CODE_UNDEFINED ||
    code === CODE_NULL
  )
    return v === code;
  const id = heapId(v);
  return id > 0 && id < heapPayloads.length && heapPayloads[id] !== undefined;
}

export function isSmi(v) {
  return codeOf(v) === CODE_SMI;
}
export function isDouble(v) {
  return codeOf(v) === CODE_DOUBLE;
}
export function isNumber(v) {
  return isSmi(v) || isDouble(v);
}
export function isBool(v) {
  return codeOf(v) === CODE_FALSE || codeOf(v) === CODE_TRUE;
}
export function isString(v) {
  return codeOf(v) === CODE_STRING;
}
export function isObject(v) {
  return codeOf(v) === CODE_OBJECT;
}
export function isFunction(v) {
  return codeOf(v) === CODE_FUNCTION;
}
export function isArray(v) {
  return codeOf(v) === CODE_ARRAY;
}
export function isPromise(v) {
  return codeOf(v) === CODE_PROMISE;
}
export function isIterator(v) {
  return codeOf(v) === CODE_ITERATOR;
}
export function isGenerator(v) {
  return codeOf(v) === CODE_GENERATOR;
}
export function isRegex(v) {
  return codeOf(v) === CODE_REGEX;
}
export function isSymbol(v) {
  return codeOf(v) === CODE_SYMBOL;
}
export function isUndefined(v) {
  return codeOf(v) === CODE_UNDEFINED;
}
export function isNull(v) {
  return codeOf(v) === CODE_NULL;
}
export function isNullish(v) {
  return isNull(v) || isUndefined(v);
}

/**
 * ToPrimitive abstract operation (simplified).
 * For objects/arrays, attempts to call valueOf() or toString() on the JSObject payload.
 * Returns a tagged primitive value, or the original if no conversion possible.
 * Note: For full spec compliance with user-defined valueOf/toString, the interpreter
 * handles calling those methods. This handles the built-in JSObject conversions.
 */
export function toPrimitive(v, hint = "default") {
  const code = codeOf(v);
  if (code !== CODE_OBJECT && code !== CODE_ARRAY) return v;

  const obj = getPayload(v);
  if (!obj) return v;

  if (obj._primitiveValue !== undefined) return obj._primitiveValue;

  if (hint === "number" || hint === "default") {
    if (typeof obj.getProperty === "function") {
      const valueOfResult = obj.getProperty("valueOf");
      if (
        valueOfResult !== undefined &&
        codeOf(valueOfResult) !== CODE_UNDEFINED
      ) {
        return valueOfResult;
      }
    }
    return mkString(code === CODE_ARRAY ? toString(v) : "[object Object]");
  }

  return mkString(code === CODE_ARRAY ? toString(v) : "[object Object]");
}

export function toNumber(v) {
  switch (codeOf(v)) {
    case CODE_SMI:
    case CODE_DOUBLE:
      return getPayload(v);
    case CODE_FALSE:
      return 0;
    case CODE_TRUE:
      return 1;
    case CODE_STRING: {
      const s = getPayload(v);
      return s === "" ? 0 : Number(s);
    }
    case CODE_NULL:
      return 0;
    case CODE_OBJECT:
    case CODE_ARRAY: {
      const prim = toPrimitive(v, "number");
      if (prim !== v) return toNumber(prim);
      return NaN;
    }
    case CODE_UNDEFINED:
    default:
      return NaN;
  }
}

export function toBool(v) {
  switch (codeOf(v)) {
    case CODE_FALSE:
    case CODE_NULL:
    case CODE_UNDEFINED:
      return false;
    case CODE_TRUE:
      return true;
    case CODE_SMI:
      return getPayload(v) !== 0;
    case CODE_DOUBLE: {
      const n = getPayload(v);
      return n !== 0 && !Number.isNaN(n);
    }
    case CODE_STRING:
      return getPayload(v).length > 0;
    default:
      return true;
  }
}

export function toString(v) {
  switch (codeOf(v)) {
    case CODE_SMI:
    case CODE_DOUBLE:
      return String(getPayload(v));
    case CODE_FALSE:
      return "false";
    case CODE_TRUE:
      return "true";
    case CODE_STRING:
      return getPayload(v);
    case CODE_NULL:
      return "null";
    case CODE_UNDEFINED:
      return "undefined";
    case CODE_FUNCTION: {
      const fn = getPayload(v);
      return `[Function: ${fn.name || "anonymous"}]`;
    }
    case CODE_OBJECT: {
      const obj = getPayload(v);
      if (obj && obj._mapData) return `Map(${obj._mapData.size})`;
      if (obj && obj._setData) return `Set(${obj._setData.size})`;
      if (obj && obj._weakMapData) return `WeakMap`;
      return obj && typeof obj.toString === "function"
        ? obj.toString()
        : "[object Object]";
    }
    case CODE_ARRAY: {
      const arr = getPayload(v);
      if (arr && arr.elements) {
        const items = arr.elements
          .map((el) => (el !== undefined ? toDisplayString(el) : "undefined"))
          .join(", ");
        return `[${items}]`;
      }
      return "[]";
    }
    case CODE_PROMISE:
      return `[Promise ${getPayload(v).state}]`;
    case CODE_ITERATOR:
      return "[Iterator]";
    case CODE_GENERATOR:
      return "[Generator]";
    case CODE_REGEX: {
      const rv = getPayload(v);
      return "/" + rv.nativeRegex.source + "/" + rv.nativeRegex.flags;
    }
    case CODE_SYMBOL: {
      const sym = getPayload(v);
      return sym.description !== undefined
        ? `Symbol(${sym.description})`
        : "Symbol()";
    }
    default:
      return String(getPayload(v));
  }
}

export function toDisplayString(v) {
  const code = codeOf(v);
  if (code === CODE_ARRAY) {
    const arr = getPayload(v);
    if (!arr) return "[]";
    const items = arr.elements
      ? arr.elements.map((el) =>
          el !== undefined ? toDisplayString(el) : "undefined",
        )
      : [];
    for (const [name, desc] of arr.hiddenClass.properties) {
      const val =
        desc.offset < 10
          ? arr.slots[desc.offset]
          : arr.overflowProperties.get(name);
      items.push(`${name}: ${toDisplayString(val)}`);
    }
    return `[${items.join(", ")}]`;
  }
  if (code === CODE_STRING) {
    return getPayload(v);
  }
  return toString(v);
}

export function typeOf(v) {
  switch (codeOf(v)) {
    case CODE_SMI:
    case CODE_DOUBLE:
      return "number";
    case CODE_FALSE:
    case CODE_TRUE:
      return "boolean";
    case CODE_STRING:
      return "string";
    case CODE_FUNCTION:
      return "function";
    case CODE_SYMBOL:
      return "symbol";
    case CODE_OBJECT:
    case CODE_ARRAY:
    case CODE_PROMISE:
    case CODE_ITERATOR:
    case CODE_GENERATOR:
    case CODE_REGEX:
    case CODE_NULL:
      return "object";
    case CODE_UNDEFINED:
      return "undefined";
    default:
      return "unknown";
  }
}

/**
 * Abstract Equality Comparison (==) per ES spec.
 * Returns a JS boolean (true/false), not a tagged value.
 */
export function abstractLooseEqual(x, y) {
  const xc = codeOf(x);
  const yc = codeOf(y);

  // Same type → strict equal
  if (xc === yc) {
    return getPayload(x) === getPayload(y);
  }

  // null == undefined → true (and vice versa)
  const xNull = xc === CODE_NULL || xc === CODE_UNDEFINED;
  const yNull = yc === CODE_NULL || yc === CODE_UNDEFINED;
  if (xNull && yNull) return true;
  if (xNull || yNull) return false;

  // SMI == DOUBLE or DOUBLE == SMI → compare as numbers
  if (
    (xc === CODE_SMI || xc === CODE_DOUBLE) &&
    (yc === CODE_SMI || yc === CODE_DOUBLE)
  ) {
    return toNumber(x) === toNumber(y);
  }

  // Number == String → toNumber(string)
  if ((xc === CODE_SMI || xc === CODE_DOUBLE) && yc === CODE_STRING) {
    return toNumber(x) === toNumber(y);
  }
  if (xc === CODE_STRING && (yc === CODE_SMI || yc === CODE_DOUBLE)) {
    return toNumber(x) === toNumber(y);
  }

  // Boolean == anything → toNumber(bool) == other
  if (xc === CODE_TRUE || xc === CODE_FALSE) {
    const xn = xc === CODE_TRUE ? 1 : 0;
    return abstractLooseEqual(mkNumber(xn), y);
  }
  if (yc === CODE_TRUE || yc === CODE_FALSE) {
    const yn = yc === CODE_TRUE ? 1 : 0;
    return abstractLooseEqual(x, mkNumber(yn));
  }

  // Object == primitive → toPrimitive(object) == primitive
  if (
    (xc === CODE_OBJECT || xc === CODE_ARRAY) &&
    (yc === CODE_SMI || yc === CODE_DOUBLE || yc === CODE_STRING)
  ) {
    const xp = toPrimitive(x, "number");
    if (xp !== x) return abstractLooseEqual(xp, y);
    return false;
  }
  if (
    (yc === CODE_OBJECT || yc === CODE_ARRAY) &&
    (xc === CODE_SMI || xc === CODE_DOUBLE || xc === CODE_STRING)
  ) {
    const yp = toPrimitive(y, "number");
    if (yp !== y) return abstractLooseEqual(x, yp);
    return false;
  }

  return false;
}

export function strictEqual(a, b) {
  const ac = codeOf(a);
  const bc = codeOf(b);
  if (ac !== bc) return false;
  switch (ac) {
    case CODE_NULL:
    case CODE_UNDEFINED:
      return true;
    default:
      return getPayload(a) === getPayload(b);
  }
}

export function isPrimitive(v) {
  switch (codeOf(v)) {
    case CODE_SMI:
    case CODE_DOUBLE:
    case CODE_FALSE:
    case CODE_TRUE:
    case CODE_STRING:
    case CODE_SYMBOL:
    case CODE_NULL:
    case CODE_UNDEFINED:
      return true;
    default:
      return false;
  }
}

export function getHeapId(v) {
  const code = codeOf(v);
  if (
    code === CODE_SMI ||
    code === CODE_FALSE ||
    code === CODE_TRUE ||
    code === CODE_UNDEFINED ||
    code === CODE_NULL
  )
    return -1;
  return heapId(v);
}

export function pinHeapSlot(v) {
  const id = getHeapId(v);
  if (id > 0) pinnedHeapIds.add(id);
}

export function sweepHeapPayloads(liveIds) {
  let freed = 0;
  for (let i = 1; i < heapPayloads.length; i++) {
    if (heapPayloads[i] !== null && !pinnedHeapIds.has(i) && !liveIds.has(i)) {
      heapPayloads[i] = null;
      heapFreeList.push(i);
      freed++;
    }
  }
  return freed;
}

export function heapPayloadCount() {
  return heapPayloads.length - 1 - heapFreeList.length;
}

const globalSymbolRegistry = new Map();
const globalSymbolReverseRegistry = new Map();
export function symbolFor(key) {
  if (globalSymbolRegistry.has(key)) return globalSymbolRegistry.get(key);
  const tagged = mkSymbol(new JSSymbol(key));
  globalSymbolRegistry.set(key, tagged);
  globalSymbolReverseRegistry.set(getPayload(tagged), key);
  return tagged;
}
export function symbolKeyFor(taggedSym) {
  return globalSymbolReverseRegistry.get(getPayload(taggedSym));
}

export const wellKnownSymbols = {};
export function initWellKnownSymbols() {
  wellKnownSymbols.iterator = mkSymbol(new JSSymbol("Symbol.iterator"));
  wellKnownSymbols.hasInstance = mkSymbol(new JSSymbol("Symbol.hasInstance"));
  wellKnownSymbols.toPrimitive = mkSymbol(new JSSymbol("Symbol.toPrimitive"));
  wellKnownSymbols.toStringTag = mkSymbol(new JSSymbol("Symbol.toStringTag"));
}

let nextSymbolId = 0;
export class JSSymbol {
  constructor(description) {
    this.id = nextSymbolId++;
    this.description = description;
  }
  toString() {
    return this.description !== undefined
      ? `Symbol(${this.description})`
      : "Symbol()";
  }
}

export class JSFunction {
  constructor(compiledFunction, name, closure) {
    this.compiled = compiledFunction;
    this.name =
      name || (compiledFunction ? compiledFunction.name : "<anonymous>");
    this.closure = closure || null;
    this.prototype = null;
    this.constructorOf = null;
    this.prototypeObj = null;
  }
}
