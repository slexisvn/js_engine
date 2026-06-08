export const TypeKind = Object.freeze({
  Any: "Any",
  Tagged: "Tagged",
  Number: "Number",
  Smi: "Smi",
  Double: "Double",
  Boolean: "Boolean",
  String: "String",
  Object: "Object",
  Array: "Array",
  Nullish: "Nullish",
  Never: "Never",
});

const SINGLETONS = new Map([
  [TypeKind.Any, Object.freeze({ kind: TypeKind.Any })],
  [TypeKind.Tagged, Object.freeze({ kind: TypeKind.Tagged })],
  [TypeKind.Number, Object.freeze({ kind: TypeKind.Number })],
  [TypeKind.Smi, Object.freeze({ kind: TypeKind.Smi })],
  [TypeKind.Double, Object.freeze({ kind: TypeKind.Double })],
  [TypeKind.Boolean, Object.freeze({ kind: TypeKind.Boolean })],
  [TypeKind.String, Object.freeze({ kind: TypeKind.String })],
  [TypeKind.Nullish, Object.freeze({ kind: TypeKind.Nullish })],
  [TypeKind.Never, Object.freeze({ kind: TypeKind.Never })],
]);

export function anyType() {
  return SINGLETONS.get(TypeKind.Any);
}

export function taggedType() {
  return SINGLETONS.get(TypeKind.Tagged);
}

export function numberType() {
  return SINGLETONS.get(TypeKind.Number);
}

export function smiType() {
  return SINGLETONS.get(TypeKind.Smi);
}

export function doubleType() {
  return SINGLETONS.get(TypeKind.Double);
}

export function booleanType() {
  return SINGLETONS.get(TypeKind.Boolean);
}

export function stringType() {
  return SINGLETONS.get(TypeKind.String);
}

export function nullishType() {
  return SINGLETONS.get(TypeKind.Nullish);
}

export function neverType() {
  return SINGLETONS.get(TypeKind.Never);
}

export function objectType(map = null) {
  return Object.freeze({ kind: TypeKind.Object, map });
}

export function arrayType(elementsKind = null) {
  return Object.freeze({ kind: TypeKind.Array, elementsKind });
}

export function typeEquals(left, right) {
  if (!left || !right) return false;
  if (left.kind !== right.kind) return false;
  if (left.kind === TypeKind.Object) return left.map === right.map;
  if (left.kind === TypeKind.Array)
    return left.elementsKind === right.elementsKind;
  return true;
}

export function isSubtype(subtype, supertype) {
  if (!subtype || !supertype) return false;
  if (typeEquals(subtype, supertype)) return true;
  if (subtype.kind === TypeKind.Never) return true;
  if (supertype.kind === TypeKind.Any) return true;
  if (supertype.kind === TypeKind.Tagged) return subtype.kind !== TypeKind.Any;
  if (supertype.kind === TypeKind.Number) {
    return subtype.kind === TypeKind.Smi || subtype.kind === TypeKind.Double;
  }
  if (supertype.kind === TypeKind.Object) {
    if (subtype.kind === TypeKind.Array) return supertype.map === null;
    if (subtype.kind !== TypeKind.Object) return false;
    return supertype.map === null || subtype.map === supertype.map;
  }
  if (supertype.kind === TypeKind.Array) {
    if (subtype.kind !== TypeKind.Array) return false;
    return (
      supertype.elementsKind === null ||
      subtype.elementsKind === supertype.elementsKind
    );
  }
  return false;
}

export function joinTypes(left, right) {
  if (!left) return right || anyType();
  if (!right) return left;
  if (isSubtype(left, right)) return right;
  if (isSubtype(right, left)) return left;
  if (left.kind === TypeKind.Never) return right;
  if (right.kind === TypeKind.Never) return left;
  if (
    (left.kind === TypeKind.Smi ||
      left.kind === TypeKind.Double ||
      left.kind === TypeKind.Number) &&
    (right.kind === TypeKind.Smi ||
      right.kind === TypeKind.Double ||
      right.kind === TypeKind.Number)
  ) {
    return numberType();
  }
  if (left.kind === TypeKind.Object && right.kind === TypeKind.Object)
    return objectType();
  if (left.kind === TypeKind.Array && right.kind === TypeKind.Array)
    return arrayType();
  if (
    (left.kind === TypeKind.Object && right.kind === TypeKind.Array) ||
    (left.kind === TypeKind.Array && right.kind === TypeKind.Object)
  ) {
    return objectType();
  }
  return taggedType();
}

export function narrowType(current, fact) {
  if (!current) return fact || anyType();
  if (!fact) return current;
  if (isSubtype(current, fact)) return current;
  if (isSubtype(fact, current)) return fact;
  if (current.kind === TypeKind.Any || current.kind === TypeKind.Tagged)
    return fact;
  if (fact.kind === TypeKind.Any || fact.kind === TypeKind.Tagged)
    return current;
  if (
    current.kind === TypeKind.Number &&
    (fact.kind === TypeKind.Smi || fact.kind === TypeKind.Double)
  ) {
    return fact;
  }
  if (
    fact.kind === TypeKind.Number &&
    (current.kind === TypeKind.Smi || current.kind === TypeKind.Double)
  ) {
    return current;
  }
  if (
    current.kind === TypeKind.Object &&
    fact.kind === TypeKind.Array &&
    current.map === null
  )
    return fact;
  if (
    current.kind === TypeKind.Array &&
    fact.kind === TypeKind.Object &&
    fact.map === null
  )
    return current;
  return neverType();
}

export function excludeType(current, excluded) {
  if (!current || !excluded) return current || anyType();
  if (isSubtype(current, excluded)) return neverType();
  return current;
}

export function typeFromConstant(value) {
  if (value === null || value === undefined) return nullishType();
  if (typeof value === "string") return stringType();
  if (typeof value === "boolean") return booleanType();
  if (typeof value === "number")
    return Number.isInteger(value) ? smiType() : doubleType();
  if (Array.isArray(value)) return arrayType();
  if (typeof value === "object") return objectType();
  return anyType();
}

export function typeFromTypeof(value) {
  if (value === "string") return stringType();
  if (value === "boolean") return booleanType();
  if (value === "number") return numberType();
  if (value === "undefined") return nullishType();
  if (value === "function") return objectType();
  if (value === "object") return taggedType();
  return null;
}
