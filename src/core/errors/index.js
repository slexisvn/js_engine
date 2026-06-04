/**
 * Typed error classes for the VM runtime.
 * These wrap error info so catch handlers can inspect error type.
 */

export class VMError {
  constructor(type, message) {
    this.type = type;
    this.name = type;
    this.message = message;
    this.stack = new Error().stack;
  }

  toString() {
    return `${this.type}: ${this.message}`;
  }
}

export class VMTypeError extends VMError {
  constructor(message) {
    super("TypeError", message);
  }
}

export class VMReferenceError extends VMError {
  constructor(message) {
    super("ReferenceError", message);
  }
}

export class VMRangeError extends VMError {
  constructor(message) {
    super("RangeError", message);
  }
}

export class VMSyntaxError extends VMError {
  constructor(message) {
    super("SyntaxError", message);
  }
}

/**
 * Check if a host-level thrown value is a VMError.
 * Used by the interpreter's catch handler to wrap or pass through.
 */
export function isVMError(err) {
  return err instanceof VMError;
}

/**
 * Convert a VMError to a tagged JSObject that JS-level catch can inspect.
 * Returns { name, message, stack } as a JSObject.
 */
export function vmErrorToTagged(err, mkString, mkObject, createJSObject) {
  const obj = createJSObject();
  obj.setProperty("name", mkString(err.name));
  obj.setProperty("message", mkString(err.message));
  obj.setProperty("stack", mkString(err.stack || ""));
  return mkObject(obj);
}
