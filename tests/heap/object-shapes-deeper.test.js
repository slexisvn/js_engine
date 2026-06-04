import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  DescriptorArray,
  ROOT_HIDDEN_CLASS,
  resetHiddenClasses,
} from "../../src/objects/maps/hidden-class.js";
import { createJSObject } from "../../src/objects/heap/factory.js";
import { resetMigrationStats } from "../../src/objects/heap/js-object.js";
import { mkSmi } from "../../src/core/value/index.js";

describe("Object shape metadata", () => {
  beforeEach(() => {
    resetHiddenClasses();
    resetMigrationStats();
  });

  it("uses descriptor arrays for map descriptors", () => {
    const xy = ROOT_HIDDEN_CLASS.transition("x").transition("y");
    assert.ok(xy.descriptors instanceof DescriptorArray);
    assert.equal(xy.descriptors.get("x").offset, 0);
    assert.equal(xy.descriptors.get("y").offset, 1);
  });

  it("reused transitions keep descriptor offsets stable", () => {
    const obj1 = createJSObject();
    const obj2 = createJSObject();
    obj1.setProperty("x", mkSmi(1));
    obj1.setProperty("y", mkSmi(2));
    obj2.setProperty("x", mkSmi(3));
    obj2.setProperty("y", mkSmi(4));
    assert.equal(obj1.hiddenClass, obj2.hiddenClass);
    assert.equal(obj1.hiddenClass.lookupProperty("x").offset, 0);
    assert.equal(obj1.hiddenClass.lookupProperty("y").offset, 1);
  });

  it("map version changes when descriptors mutate", () => {
    const obj = createJSObject();
    const oldMap = obj.hiddenClass;
    const before = oldMap.version;
    obj.setProperty("x", mkSmi(1));
    assert.ok(oldMap.version > before);
  });

  it("prototype validity changes when an existing prototype field changes", () => {
    const proto = createJSObject();
    proto.setProperty("x", mkSmi(1));
    const before = proto.getPrototypeValidityVersion();
    proto.setProperty("x", mkSmi(2));
    assert.ok(proto.getPrototypeValidityVersion() > before);
  });

  it("setPrototype invalidates the receiver map", () => {
    const obj = createJSObject();
    const proto = createJSObject();
    const before = obj.hiddenClass.version;
    obj.setPrototype(proto);
    assert.ok(obj.hiddenClass.version > before);
  });

  it("preventExtensions blocks transition stores", () => {
    const obj = createJSObject();
    obj.preventExtensions();
    assert.equal(obj.setProperty("x", mkSmi(1)), false);
    assert.equal(obj.getProperty("x"), undefined);
  });
});
