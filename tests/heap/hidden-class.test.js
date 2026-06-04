import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  HiddenClass,
  ROOT_HIDDEN_CLASS,
  resetHiddenClasses,
  isMapDeprecated,
  getMigrationTarget,
  getDeprecatedMapCount,
  MAX_TRANSITIONS_BEFORE_UNSTABLE,
} from "../../src/objects/maps/hidden-class.js";
import { createJSObject } from "../../src/objects/heap/factory.js";
import {
  JSObject,
  getMigrationStats,
  resetMigrationStats,
} from "../../src/objects/heap/js-object.js";
import { mkSmi, mkString, getPayload } from "../../src/core/value/index.js";

describe("HiddenClass", () => {
  beforeEach(() => {
    resetHiddenClasses();
    resetMigrationStats();
  });

  describe("ROOT_HIDDEN_CLASS", () => {
    it("has id 0", () => {
      assert.equal(ROOT_HIDDEN_CLASS.id, 0);
    });

    it("has no parent", () => {
      assert.equal(ROOT_HIDDEN_CLASS.parent, null);
    });

    it("has zero properties", () => {
      assert.equal(ROOT_HIDDEN_CLASS.propertyCount, 0);
    });

    it("starts with no transitions", () => {
      assert.equal(ROOT_HIDDEN_CLASS.transitions.size, 0);
    });

    it("lookupProperty returns null for any name", () => {
      assert.equal(ROOT_HIDDEN_CLASS.lookupProperty("x"), null);
      assert.equal(ROOT_HIDDEN_CLASS.lookupProperty("anything"), null);
    });

    it("hasProperty returns false", () => {
      assert.equal(ROOT_HIDDEN_CLASS.hasProperty("x"), false);
    });
  });

  describe("transitions", () => {
    it("creates a new hidden class on transition", () => {
      const hc1 = ROOT_HIDDEN_CLASS.transition("x");
      assert.notEqual(hc1, ROOT_HIDDEN_CLASS);
      assert.equal(hc1.parent, ROOT_HIDDEN_CLASS);
    });

    it("new class has incremented id", () => {
      const hc1 = ROOT_HIDDEN_CLASS.transition("x");
      assert.equal(hc1.id, 1);
    });

    it("new class has the added property", () => {
      const hc1 = ROOT_HIDDEN_CLASS.transition("x");
      assert.equal(hc1.propertyCount, 1);
      assert.equal(hc1.hasProperty("x"), true);
    });

    it("property has offset 0 for first property", () => {
      const hc1 = ROOT_HIDDEN_CLASS.transition("x");
      const info = hc1.lookupProperty("x");
      assert.notEqual(info, null);
      assert.equal(info.offset, 0);
    });

    it("second property has offset 1", () => {
      const hc1 = ROOT_HIDDEN_CLASS.transition("x");
      const hc2 = hc1.transition("y");
      const info = hc2.lookupProperty("y");
      assert.equal(info.offset, 1);
    });

    it("child class inherits parent properties", () => {
      const hc1 = ROOT_HIDDEN_CLASS.transition("x");
      const hc2 = hc1.transition("y");
      assert.equal(hc2.hasProperty("x"), true);
      assert.equal(hc2.hasProperty("y"), true);
      assert.equal(hc2.lookupProperty("x").offset, 0);
      assert.equal(hc2.lookupProperty("y").offset, 1);
    });

    it("marks parent as not stable", () => {
      assert.equal(ROOT_HIDDEN_CLASS.isStable, true);
      ROOT_HIDDEN_CLASS.transition("x");
      assert.equal(ROOT_HIDDEN_CLASS.isStable, false);
    });
  });

  describe("transition reuse", () => {
    it("same property name returns the same child", () => {
      const hc1 = ROOT_HIDDEN_CLASS.transition("x");
      const hc2 = ROOT_HIDDEN_CLASS.transition("x");
      assert.equal(hc1, hc2);
    });

    it("reused child has same id", () => {
      const hc1 = ROOT_HIDDEN_CLASS.transition("x");
      const hc2 = ROOT_HIDDEN_CLASS.transition("x");
      assert.equal(hc1.id, hc2.id);
    });

    it("transition is cached in parent", () => {
      ROOT_HIDDEN_CLASS.transition("x");
      assert.equal(ROOT_HIDDEN_CLASS.transitions.has("x"), true);
    });

    it("chained transitions also reuse", () => {
      const path1 = ROOT_HIDDEN_CLASS.transition("x").transition("y");
      const path2 = ROOT_HIDDEN_CLASS.transition("x").transition("y");
      assert.equal(path1, path2);
    });
  });

  describe("different property orders", () => {
    it("different order creates different classes", () => {
      const xy = ROOT_HIDDEN_CLASS.transition("x").transition("y");
      const yx = ROOT_HIDDEN_CLASS.transition("y").transition("x");
      assert.notEqual(xy, yx);
      assert.notEqual(xy.id, yx.id);
    });

    it("different order gives different offsets", () => {
      const xy = ROOT_HIDDEN_CLASS.transition("x").transition("y");
      const yx = ROOT_HIDDEN_CLASS.transition("y").transition("x");
      assert.equal(xy.lookupProperty("x").offset, 0);
      assert.equal(xy.lookupProperty("y").offset, 1);
      assert.equal(yx.lookupProperty("y").offset, 0);
      assert.equal(yx.lookupProperty("x").offset, 1);
    });

    it("both have same total property count", () => {
      const xy = ROOT_HIDDEN_CLASS.transition("x").transition("y");
      const yx = ROOT_HIDDEN_CLASS.transition("y").transition("x");
      assert.equal(xy.propertyCount, 2);
      assert.equal(yx.propertyCount, 2);
    });
  });

  describe("multi-step chains", () => {
    it("three-property chain", () => {
      const hc1 = ROOT_HIDDEN_CLASS.transition("a");
      const hc2 = hc1.transition("b");
      const hc3 = hc2.transition("c");

      assert.equal(hc3.propertyCount, 3);
      assert.equal(hc3.lookupProperty("a").offset, 0);
      assert.equal(hc3.lookupProperty("b").offset, 1);
      assert.equal(hc3.lookupProperty("c").offset, 2);
    });

    it("five-property chain has correct ids", () => {
      let hc = ROOT_HIDDEN_CLASS;
      const names = ["a", "b", "c", "d", "e"];
      for (const name of names) {
        hc = hc.transition(name);
      }
      assert.equal(hc.propertyCount, 5);
      for (let i = 0; i < names.length; i++) {
        assert.equal(hc.lookupProperty(names[i]).offset, i);
      }
    });
  });

  describe("getTransitionPath", () => {
    it("returns empty for root", () => {
      const path = ROOT_HIDDEN_CLASS.getTransitionPath();
      assert.deepEqual(path, []);
    });

    it("returns single-element path", () => {
      const hc = ROOT_HIDDEN_CLASS.transition("x");
      assert.deepEqual(hc.getTransitionPath(), ["x"]);
    });

    it("returns full path for chain", () => {
      const hc = ROOT_HIDDEN_CLASS.transition("x")
        .transition("y")
        .transition("z");
      assert.deepEqual(hc.getTransitionPath(), ["x", "y", "z"]);
    });
  });

  describe("toString", () => {
    it("root toString is empty braces", () => {
      const s = ROOT_HIDDEN_CLASS.toString();
      assert.ok(s.includes("HC0"), s);
      assert.ok(s.includes("{}") || s.includes("{"), s);
    });

    it("single property shows in toString", () => {
      const hc = ROOT_HIDDEN_CLASS.transition("x");
      const s = hc.toString();
      assert.ok(s.includes("x"), s);
    });
  });

  describe("resetHiddenClasses", () => {
    it("resets root id to 0", () => {
      ROOT_HIDDEN_CLASS.transition("x");
      ROOT_HIDDEN_CLASS.transition("y");
      resetHiddenClasses();
      assert.equal(ROOT_HIDDEN_CLASS.id, 0);
    });

    it("clears all transitions", () => {
      ROOT_HIDDEN_CLASS.transition("x");
      ROOT_HIDDEN_CLASS.transition("y");
      resetHiddenClasses();
      assert.equal(ROOT_HIDDEN_CLASS.transitions.size, 0);
    });

    it("new transitions after reset get fresh ids starting at 1", () => {
      ROOT_HIDDEN_CLASS.transition("a");
      ROOT_HIDDEN_CLASS.transition("b");
      resetHiddenClasses();
      const hc = ROOT_HIDDEN_CLASS.transition("c");
      assert.equal(hc.id, 1);
    });
  });

  describe("JSObject integration", () => {
    it("new object starts at root", () => {
      const obj = createJSObject();
      assert.equal(obj.hiddenClass, ROOT_HIDDEN_CLASS);
    });

    it("setting property transitions hidden class", () => {
      const obj = createJSObject();
      obj.setProperty("x", mkSmi(10));
      assert.notEqual(obj.hiddenClass, ROOT_HIDDEN_CLASS);
      assert.equal(obj.hiddenClass.propertyCount, 1);
    });

    it("two objects same shape share hidden class", () => {
      const obj1 = createJSObject();
      const obj2 = createJSObject();
      obj1.setProperty("x", mkSmi(1));
      obj1.setProperty("y", mkSmi(2));
      obj2.setProperty("x", mkSmi(10));
      obj2.setProperty("y", mkSmi(20));
      assert.equal(obj1.hiddenClass, obj2.hiddenClass);
    });

    it("different shapes get different hidden classes", () => {
      const obj1 = createJSObject();
      const obj2 = createJSObject();
      obj1.setProperty("x", mkSmi(1));
      obj1.setProperty("y", mkSmi(2));
      obj2.setProperty("a", mkSmi(10));
      obj2.setProperty("b", mkSmi(20));
      assert.notEqual(obj1.hiddenClass, obj2.hiddenClass);
    });

    it("getProperty reads correct slot", () => {
      const obj = createJSObject();
      obj.setProperty("x", mkSmi(42));
      obj.setProperty("y", mkSmi(99));
      const x = obj.getProperty("x");
      const y = obj.getProperty("y");
      assert.equal(getPayload(x), 42);
      assert.equal(getPayload(y), 99);
    });

    it("setProperty overwrites existing property", () => {
      const obj = createJSObject();
      obj.setProperty("x", mkSmi(1));
      const hcBefore = obj.hiddenClass;
      obj.setProperty("x", mkSmi(99));
      assert.equal(obj.hiddenClass, hcBefore);
      assert.equal(getPayload(obj.getProperty("x")), 99);
    });

    it("getPropertyByOffset works", () => {
      const obj = createJSObject();
      obj.setProperty("a", mkSmi(10));
      obj.setProperty("b", mkString("hi"));
      assert.equal(getPayload(obj.getPropertyByOffset(0)), 10);
      assert.equal(getPayload(obj.getPropertyByOffset(1)), "hi");
    });

    it("getMapId returns hidden class id", () => {
      const obj = createJSObject();
      assert.equal(obj.getMapId(), ROOT_HIDDEN_CLASS.id);
      obj.setProperty("x", mkSmi(1));
      assert.equal(obj.getMapId(), obj.hiddenClass.id);
    });
  });

  describe("Map Deprecation & Migration", () => {
    it("deprecate() marks HC as deprecated and creates migration target", () => {
      const hc1 = ROOT_HIDDEN_CLASS.transition("x");
      const hc2 = hc1.transition("y");
      assert.equal(hc2.isDeprecated, false);

      const target = hc2.deprecate("test-reason");
      assert.equal(hc2.isDeprecated, true);
      assert.notEqual(target, null);
      assert.notEqual(target, hc2);
      assert.equal(target.propertyCount, hc2.propertyCount);
      assert.equal(target.isDeprecated, false);
      assert.equal(target.isStable, true);
    });

    it("migration target has same properties", () => {
      const hc1 = ROOT_HIDDEN_CLASS.transition("a");
      const hc2 = hc1.transition("b");
      const hc3 = hc2.transition("c");

      const target = hc3.deprecate("test");
      assert.equal(target.hasProperty("a"), true);
      assert.equal(target.hasProperty("b"), true);
      assert.equal(target.hasProperty("c"), true);
      assert.equal(target.propertyCount, 3);
    });

    it("deprecate() is idempotent", () => {
      const hc = ROOT_HIDDEN_CLASS.transition("x");
      const target1 = hc.deprecate("first");
      const target2 = hc.deprecate("second");
      assert.equal(target1, target2);
    });

    it("isMapDeprecated() and getMigrationTarget() work", () => {
      const hc = ROOT_HIDDEN_CLASS.transition("x");
      assert.equal(isMapDeprecated(hc.id), false);

      hc.deprecate("test");
      assert.equal(isMapDeprecated(hc.id), true);
      const target = getMigrationTarget(hc.id);
      assert.notEqual(target, null);
      assert.equal(target, hc.migrationTarget);
    });

    it("getDeprecatedMapCount() tracks deprecations", () => {
      assert.equal(getDeprecatedMapCount(), 0);

      const hc1 = ROOT_HIDDEN_CLASS.transition("x");
      hc1.deprecate("test1");
      assert.equal(getDeprecatedMapCount(), 1);

      const hc2 = ROOT_HIDDEN_CLASS.transition("y");
      hc2.deprecate("test2");
      assert.equal(getDeprecatedMapCount(), 2);
    });

    it("auto-deprecates when transitions exceed 2x threshold", () => {
      let hc = ROOT_HIDDEN_CLASS;

      for (let i = 0; i < MAX_TRANSITIONS_BEFORE_UNSTABLE * 2 + 1; i++) {
        hc = ROOT_HIDDEN_CLASS.transition(`prop_${i}`);
      }

      assert.equal(ROOT_HIDDEN_CLASS.isDeprecated, true);
    });

    it("JSObject.migrateInstance() moves object to new HC", () => {
      const obj = createJSObject();
      obj.setProperty("x", mkSmi(10));
      obj.setProperty("y", mkSmi(20));

      const oldHC = obj.hiddenClass;
      oldHC.deprecate("test-migration");

      assert.equal(obj.needsMigration(), true);
      const migrated = obj.migrateInstance();
      assert.equal(migrated, true);
      assert.notEqual(obj.hiddenClass, oldHC);
      assert.equal(obj.hiddenClass.isDeprecated, false);

      assert.equal(getPayload(obj.getProperty("x")), 10);
      assert.equal(getPayload(obj.getProperty("y")), 20);
    });

    it("lazy migration triggers on getProperty", () => {
      const obj = createJSObject();
      obj.setProperty("x", mkSmi(42));
      const oldHC = obj.hiddenClass;
      oldHC.deprecate("lazy-test");

      const val = obj.getProperty("x");
      assert.equal(getPayload(val), 42);
      assert.notEqual(obj.hiddenClass, oldHC);
      assert.equal(obj.hiddenClass.isDeprecated, false);
    });

    it("lazy migration triggers on setProperty", () => {
      const obj = createJSObject();
      obj.setProperty("x", mkSmi(1));
      const oldHC = obj.hiddenClass;
      oldHC.deprecate("lazy-test");

      obj.setProperty("x", mkSmi(99));
      assert.notEqual(obj.hiddenClass, oldHC);
      assert.equal(getPayload(obj.getProperty("x")), 99);
    });

    it("migration stats track total migrations", () => {
      const obj1 = createJSObject();
      obj1.setProperty("x", mkSmi(1));
      const obj2 = createJSObject();
      obj2.setProperty("x", mkSmi(2));

      const hc = obj1.hiddenClass;
      hc.deprecate("stats-test");

      obj1.getProperty("x");
      obj2.getProperty("x");
      assert.equal(getMigrationStats().totalMigrations, 2);
    });

    it("toString shows DEPRECATED status", () => {
      const hc = ROOT_HIDDEN_CLASS.transition("x");
      hc.deprecate("test");
      const str = hc.toString();
      assert.ok(str.includes("DEPRECATED"));
      assert.ok(str.includes("→HC"));
    });
  });
});

describe("Deprecation Memoization", () => {
  it("caches migration target for same property set", () => {
    resetHiddenClasses();

    // Create two hidden classes with identical property sets
    const hc1Root = new HiddenClass(null, null, null, 0);
    const hc1a = hc1Root.transition("x");
    const hc1b = hc1a.transition("y");

    const hc2Root = new HiddenClass(null, null, null, 0);
    const hc2a = hc2Root.transition("x");
    const hc2b = hc2a.transition("y");

    // Deprecate both — should get same migration target
    const target1 = hc1b.deprecate("test1");
    const target2 = hc2b.deprecate("test2");

    assert.strictEqual(
      target1,
      target2,
      "same property set should reuse cached migration target",
    );
  });

  it("different property sets get different targets", () => {
    resetHiddenClasses();

    const hc1Root = new HiddenClass(null, null, null, 0);
    const hc1a = hc1Root.transition("x");

    const hc2Root = new HiddenClass(null, null, null, 0);
    const hc2a = hc2Root.transition("y"); // different property name

    const target1 = hc1a.deprecate("test1");
    const target2 = hc2a.deprecate("test2");

    assert.notStrictEqual(
      target1,
      target2,
      "different property sets should get different targets",
    );
  });
});
