import { STRING_METHODS } from "./string-methods.js";
import { ARRAY_METHODS } from "./array-methods.js";
import { NUMBER_METHODS } from "./number-methods.js";
import { BOOLEAN_METHODS } from "./boolean-methods.js";
import { REGEX_METHODS } from "./regex-methods.js";
import { MAP_METHODS } from "./map-methods.js";
import { SET_METHODS } from "./set-methods.js";
import { WEAKMAP_METHODS } from "./weakmap-methods.js";
import { createJSObject } from "../../objects/heap/factory.js";
import { mkFunction, wellKnownSymbols } from "../../core/value/index.js";

function populatePrototype(methods) {
  const proto = createJSObject();
  for (const [name, method] of Object.entries(methods)) {
    proto.setProperty(name, mkFunction(method));
  }
  return proto;
}

export function createBuiltinPrototypes() {
  const mapPrototype = populatePrototype(MAP_METHODS);
  const setPrototype = populatePrototype(SET_METHODS);
  const weakMapPrototype = populatePrototype(WEAKMAP_METHODS);

  if (wellKnownSymbols.iterator) {
    const mapEntries = mapPrototype.getProperty("entries");
    if (mapEntries !== undefined) mapPrototype.setSymbolProperty(wellKnownSymbols.iterator, mapEntries);

    const setValues = setPrototype.getProperty("values");
    if (setValues !== undefined) setPrototype.setSymbolProperty(wellKnownSymbols.iterator, setValues);
  }

  return {
    stringPrototype: populatePrototype(STRING_METHODS),
    arrayPrototype: populatePrototype(ARRAY_METHODS),
    numberPrototype: populatePrototype(NUMBER_METHODS),
    booleanPrototype: populatePrototype(BOOLEAN_METHODS),
    regexPrototype: populatePrototype(REGEX_METHODS),
    mapPrototype,
    setPrototype,
    weakMapPrototype,
  };
}
