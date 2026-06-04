export function encodeU32(n) {
  const bytes = [];
  do {
    let byte = n & 0x7f;
    n >>>= 7;
    if (n !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (n !== 0);
  return bytes;
}

export function encodeS32(n) {
  n |= 0;
  const bytes = [];
  let more = true;
  while (more) {
    let byte = n & 0x7f;
    n >>= 7;
    if ((n === 0 && !(byte & 0x40)) || (n === -1 && byte & 0x40)) {
      more = false;
    } else {
      byte |= 0x80;
    }
    bytes.push(byte);
  }
  return bytes;
}

export function encodeS64(n) {
  const bytes = [];
  let more = true;
  while (more) {
    let byte = Number(BigInt(n) & 0x7fn);
    n = Number(BigInt(n) >> 7n);
    if ((n === 0 && !(byte & 0x40)) || (n === -1 && byte & 0x40)) {
      more = false;
    } else {
      byte |= 0x80;
    }
    bytes.push(byte);
  }
  return bytes;
}

export function encodeF64(n) {
  const buf = new ArrayBuffer(8);
  new Float64Array(buf)[0] = n;
  return [...new Uint8Array(buf)];
}

export function encodeString(s) {
  const encoded = new TextEncoder().encode(s);
  return [...encodeU32(encoded.length), ...encoded];
}

export const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d];
export const WASM_VERSION = [0x01, 0x00, 0x00, 0x00];

export const SEC_TYPE = 1;
export const SEC_IMPORT = 2;
export const SEC_FUNCTION = 3;
export const SEC_EXPORT = 7;
export const SEC_CODE = 10;

export const TYPE_I32 = 0x7f;
export const TYPE_I64 = 0x7e;
export const TYPE_F64 = 0x7c;
export const TYPE_VOID = 0x40;
export const TYPE_FUNC = 0x60;

export const IMPORT_FUNC = 0x00;
export const IMPORT_MEMORY = 0x02;
export const EXPORT_FUNC = 0x00;

export const OP_UNREACHABLE = 0x00;
export const OP_NOP = 0x01;
export const OP_BLOCK = 0x02;
export const OP_LOOP = 0x03;
export const OP_IF = 0x04;
export const OP_ELSE = 0x05;
export const OP_END = 0x0b;
export const OP_BR = 0x0c;
export const OP_BR_IF = 0x0d;
export const OP_RETURN = 0x0f;
export const OP_CALL = 0x10;
export const OP_DROP = 0x1a;
export const OP_SELECT = 0x1b;
export const OP_LOCAL_GET = 0x20;
export const OP_LOCAL_SET = 0x21;
export const OP_LOCAL_TEE = 0x22;
export const OP_I32_LOAD = 0x28;
export const OP_I64_LOAD = 0x29;
export const OP_F64_LOAD = 0x2b;
export const OP_I32_STORE = 0x36;
export const OP_I64_STORE = 0x37;
export const OP_F64_STORE = 0x39;
export const OP_I32_CONST = 0x41;
export const OP_I64_CONST = 0x42;
export const OP_F64_CONST = 0x44;
export const OP_I32_EQZ = 0x45;
export const OP_I32_EQ = 0x46;
export const OP_I32_NE = 0x47;
export const OP_I32_LT_S = 0x48;
export const OP_I32_GT_S = 0x4a;
export const OP_I32_LE_S = 0x4c;
export const OP_I32_GE_S = 0x4e;
export const OP_I64_EQ = 0x51;
export const OP_I64_NE = 0x52;
export const OP_I64_LT_S = 0x53;
export const OP_I64_GT_S = 0x55;
export const OP_I64_LE_S = 0x57;
export const OP_I64_GE_S = 0x59;
export const OP_F64_EQ = 0x61;
export const OP_F64_NE = 0x62;
export const OP_F64_LT = 0x63;
export const OP_F64_GT = 0x64;
export const OP_F64_LE = 0x65;
export const OP_F64_GE = 0x66;
export const OP_I32_ADD = 0x6a;
export const OP_I32_SUB = 0x6b;
export const OP_I32_MUL = 0x6c;
export const OP_I32_DIV_S = 0x6d;
export const OP_I32_REM_S = 0x6f;
export const OP_I32_AND = 0x71;
export const OP_I32_OR = 0x72;
export const OP_I32_XOR = 0x73;
export const OP_I32_SHL = 0x74;
export const OP_I32_SHR_S = 0x75;
export const OP_I32_SHR_U = 0x76;
export const OP_I64_ADD = 0x7c;
export const OP_I64_SUB = 0x7d;
export const OP_I64_MUL = 0x7e;
export const OP_I64_SHR_S = 0x87;
export const OP_I64_EXTEND_I32_S = 0xac;
export const OP_F64_ADD = 0xa0;
export const OP_F64_SUB = 0xa1;
export const OP_F64_MUL = 0xa2;
export const OP_F64_DIV = 0xa3;
export const OP_F64_CONVERT_I32_S = 0xb7;
export const OP_I32_TRUNC_F64_S = 0xaa;
export const OP_I32_WRAP_I64 = 0xa7;
export const OP_I64_EXTEND_I32_U = 0xad;

export class WasmModuleBuilder {
  constructor() {
    this.types = [];
    this.imports = [];
    this.functions = [];
    this.exports = [];
    this.codes = [];
    this.memoryImport = null;
  }

  addType(params, results) {
    const idx = this.types.length;
    this.types.push({ params, results });
    return idx;
  }

  addFuncImport(module, field, typeIdx) {
    const idx = this.imports.length;
    this.imports.push({ module, field, typeIdx });
    return idx;
  }

  addMemoryImport(module, field) {
    this.memoryImport = { module, field };
  }

  addFunction(typeIdx) {
    const idx = this.functions.length;
    this.functions.push(typeIdx);
    return idx;
  }

  addExport(name, absoluteFuncIdx) {
    this.exports.push({ name, idx: absoluteFuncIdx });
  }

  setCode(idx, localDecls, bodyBytes) {
    this.codes[idx] = { localDecls, bodyBytes };
  }

  toBytes() {
    const out = [];
    out.push(...WASM_MAGIC, ...WASM_VERSION);

    if (this.types.length > 0) {
      const sec = [];
      sec.push(...encodeU32(this.types.length));
      for (const t of this.types) {
        sec.push(TYPE_FUNC);
        sec.push(...encodeU32(t.params.length), ...t.params);
        sec.push(...encodeU32(t.results.length), ...t.results);
      }
      out.push(SEC_TYPE, ...encodeU32(sec.length), ...sec);
    }

    const totalImports = this.imports.length + (this.memoryImport ? 1 : 0);
    if (totalImports > 0) {
      const sec = [];
      sec.push(...encodeU32(totalImports));
      for (const imp of this.imports) {
        sec.push(...encodeString(imp.module));
        sec.push(...encodeString(imp.field));
        sec.push(IMPORT_FUNC, ...encodeU32(imp.typeIdx));
      }
      if (this.memoryImport) {
        sec.push(...encodeString(this.memoryImport.module));
        sec.push(...encodeString(this.memoryImport.field));
        sec.push(IMPORT_MEMORY, 0x00, ...encodeU32(1));
      }
      out.push(SEC_IMPORT, ...encodeU32(sec.length), ...sec);
    }

    if (this.functions.length > 0) {
      const sec = [];
      sec.push(...encodeU32(this.functions.length));
      for (const typeIdx of this.functions) {
        sec.push(...encodeU32(typeIdx));
      }
      out.push(SEC_FUNCTION, ...encodeU32(sec.length), ...sec);
    }

    if (this.exports.length > 0) {
      const sec = [];
      sec.push(...encodeU32(this.exports.length));
      for (const exp of this.exports) {
        sec.push(...encodeString(exp.name));
        sec.push(EXPORT_FUNC, ...encodeU32(exp.idx));
      }
      out.push(SEC_EXPORT, ...encodeU32(sec.length), ...sec);
    }

    if (this.codes.length > 0) {
      const sec = [];
      sec.push(...encodeU32(this.codes.length));
      for (const code of this.codes) {
        const body = [];
        body.push(...encodeU32(code.localDecls.length));
        for (const decl of code.localDecls) {
          body.push(...encodeU32(decl.count), decl.type);
        }
        body.push(...code.bodyBytes, OP_END);
        sec.push(...encodeU32(body.length), ...body);
      }
      out.push(SEC_CODE, ...encodeU32(sec.length), ...sec);
    }

    return new Uint8Array(out);
  }
}
