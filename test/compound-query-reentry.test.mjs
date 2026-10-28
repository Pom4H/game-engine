import test from "node:test";
import assert from "node:assert/strict";
import * as After from "../dist/physics/compound.js";
const tags = (items) => items.map((item) => item.tag);
const hit = (value) => value && { t: value.t, p: value.p, n: value.n, tag: value.tag, body: value.body?.tag ?? null, plane: value.plane?.tag ?? null };
const depth = (world) => assert.equal(world.candidateState().depth, 0, "every collection/consumer scope unwinds");
function nested(world, kind) {
  if (kind === "ray")
    return hit(world.ray([1000, 3, 1000], [0, -1, 0], 5));
  if (kind === "overlapsBox")
    return world.overlapsBox([1000, 0, 1000], [0.1, 0.1, 0.1]);
  return tags(world.candidates([1000, 0, 1000], 0.1));
}
test("six independently expected closer-plane hits survive nested public queries from accepting and rejecting filters", () => {
  for (const kind of ["candidates", "ray", "overlapsBox"])
    for (const accept of [false, true]) {
      const world = new After.SolidWorld({ gravity: [0, 0, 0] }), trace = [];
      world.addPlane({ p: [0, 0, 0], hu: 2, hv: 2, tag: "far", filter: () => {
        trace.push("far");
        nested(world, kind);
        return accept;
      } });
      const near = world.addPlane({ p: [0, 1, 0], hu: 2, hv: 2, tag: "near", filter: () => {
        trace.push("near");
        return true;
      } });
      const selected = world.ray([0, 3, 0], [0, -1, 0], 5);
      assert.equal(selected?.plane, near);
      assert.equal(selected?.t, 2);
      assert.deepEqual(trace, ["far", "near"]);
      depth(world);
    }
});
test("overlapsBox retains later solid overlap after a public custom boxes builder reenters", () => {
  const world = new After.SolidWorld, first = world.add(new After.SolidBody({ p: [0, 0, 0], mass: 0, tag: "empty" }));
  world.add(new After.SolidBody({ p: [0, 0, 0], mass: 0, tag: "solid" }));
  delete first.cachedBoxes;
  first.boxes = () => {
    nested(world, "candidates");
    return [];
  };
  assert.equal(world.overlapsBox([0, 0, 0], [0.5, 0.5, 0.5]), true);
  depth(world);
});
test("static contact iteration retains independently overlapping wall after plane filter queries", () => {
  const world = new After.SolidWorld({ gravity: [0, 0, 0], iterations: 1 });
  world.addPlane({ p: [0, 0, 0], hu: 2, hv: 2, tag: "floor", filter: () => {
    nested(world, "candidates");
    return true;
  } });
  world.add(new After.SolidBody({ p: [0.7, 0.49, 0], half: [0.5, 0.5, 0.5], mass: 0, tag: "wall" }));
  world.add(new After.SolidBody({ p: [0, 0.49, 0], half: [0.5, 0.5, 0.5], mass: 1, tag: "moving" }));
  world.step(1 / 120);
  assert.equal(world.contacts.filter((c) => c.tag === "wall").length, 4);
  assert.equal(world.contacts.filter((c) => c.tag === "floor").length, 4);
  depth(world);
});
test("candidate collection owns near/out arrays through enabled getters and custom-index callbacks", () => {
  for (const kind of ["enabled", "global-enabled", "index-return"]) {
    const world = new After.SolidWorld, first = world.addPlane({ p: [0, 0, 0], hu: kind === "global-enabled" ? 500 : 2, hv: 2, tag: "first" });
    world.addPlane({ p: [0, 1, 0], hu: 2, hv: 2, tag: "second" });
    let active = false;
    const reenter = () => {
      if (active)
        return;
      active = true;
      try {
        nested(world, "candidates");
      } finally {
        active = false;
      }
    };
    if (kind === "index-return") {
      const original = world.staticIndex.nearOwned;
      world.staticIndex.nearOwned = function(...args) {
        const result = original.apply(this, args);
        reenter();
        return result;
      };
    } else
      Object.defineProperty(first, "enabled", { get() {
        reenter();
        return true;
      } });
    assert.deepEqual(tags(world.candidates([0, 0, 0], 1)), ["first", "second"]);
    depth(world);
  }
});
test("custom index optional fallback preserves one getter read, its receiver and all query arguments", () => {
  function run(M) {
    const world = new M.SolidWorld, trace = [], row = { tag: "indexed", enabled: true };
    const index = { get nearOwned() {
      trace.push("nearOwned");
      return;
    }, get near() {
      trace.push("near");
      return function(...args) {
        trace.push(["call", this === index, ...args.slice(0, 3), args[4]]);
        const out = args[3];
        out.length = 0;
        out.push(row);
        return out;
      };
    } };
    world.staticIndex = index;
    return { out: tags(world.candidates([3, 7, 4], 1, 9)), trace };
  }
  assert.deepEqual(run(After), { out: ["indexed"], trace: ["nearOwned", "near", ["call", true, 3, 4, 1, 9]] });
});
test("collection/index, ray filter, overlap builder and step exceptions restore depth and exact error identity", () => {
  for (const kind of ["enabled", "index", "ray", "overlap", "step"]) {
    const world = new After.SolidWorld({ gravity: [0, 0, 0] }), error = { kind }, plane = world.addPlane({ p: [0, 0, 0], hu: 2, hv: 2 });
    if (kind === "enabled")
      Object.defineProperty(plane, "enabled", { configurable: true, get() {
        nested(world, "candidates");
        throw error;
      } });
    if (kind === "index")
      world.staticIndex.nearOwned = () => {
        throw error;
      };
    if (kind === "ray" || kind === "step")
      plane.filter = () => {
        nested(world, "candidates");
        throw error;
      };
    if (kind === "overlap") {
      const body = world.add(new After.SolidBody({ mass: 0 }));
      delete body.cachedBoxes;
      body.boxes = () => {
        nested(world, "candidates");
        throw error;
      };
    }
    if (kind === "step")
      world.add(new After.SolidBody({ p: [0, 0.49, 0], mass: 1 }));
    if (kind === "enabled") {
      let entered = false;
      Object.defineProperty(plane, "enabled", { configurable: true, get() {
        if (entered)
          return true;
        entered = true;
        try {
          nested(world, "candidates");
        } finally {
          entered = false;
        }
        throw error;
      } });
    }
    let caught;
    try {
      if (kind === "ray")
        world.ray([0, 3, 0], [0, -1, 0], 5);
      else if (kind === "overlap")
        world.overlapsBox([0, 0, 0], [1, 1, 1]);
      else if (kind === "step")
        world.step(1 / 120);
      else
        world.candidates([0, 0, 0], 1);
    } catch (value) {
      caught = value;
    }
    assert.equal(caught, error);
    depth(world);
    if (kind === "enabled")
      Object.defineProperty(plane, "enabled", { value: true, writable: true });
    if (kind === "index")
      delete world.staticIndex.nearOwned;
    plane.filter = null;
    assert(world.candidates([0, 0, 0], 1).includes(plane));
    depth(world);
  }
});
test("nested overflow has unique live outputs, retains at most8 slots, preserves retained public arrays and unwinds throws", () => {
  for (const throwing of [false, true]) {
    const world = new After.SolidWorld, retained = [];
    let level = 0;
    const error = { scope: "deepest" };
    world.addPlane({ p: [0, 0, 0], hu: 2, hv: 2, tag: "far", filter: () => {
      if (level === 12) {
        if (throwing)
          throw error;
        return false;
      }
      level++;
      try {
        const output = world.candidates([0, 0, 0], 1);
        retained.push(output);
        assert.equal(world.ray([0, 3, 0], [0, -1, 0], 5)?.tag, "near");
        return false;
      } finally {
        level--;
      }
    } });
    world.addPlane({ p: [0, 1, 0], hu: 2, hv: 2, tag: "near" });
    let caught;
    try {
      assert.equal(world.ray([0, 3, 0], [0, -1, 0], 5)?.tag, "near");
    } catch (value) {
      caught = value;
    }
    if (throwing)
      assert.equal(caught, error);
    else
      assert.equal(caught, undefined);
    depth(world);
    const slots = Reflect.get(world, "candidateState").call(world).slots;
    assert.equal(slots.length, 8);
    assert.equal(new Set(retained).size, 12);
    for (const out of retained)
      assert.deepEqual(tags(out), ["far", "near"]);
  }
});
test("Object.create static views own separate receiver state during parent/view collection and consumer leases", () => {
  for (const mode of ["filter", "enabled", "index-return"])
    for (const inside of [false, true])
      for (const direction of ["parent-view", "view-parent"])
        for (const throwing of [false, true]) {
          const parent = new After.SolidWorld, error = { mode, inside, direction }, ray = parent.ray;
          let view, armed = false, creating = false;
          const create = () => {
            view = Object.create(parent);
            view.bodies = [];
          };
          const first = parent.addPlane({ p: [0, 0, 0], hu: 2, hv: 2, tag: "far" });
          parent.addPlane({ p: [0, 1, 0], hu: 2, hv: 2, tag: "near" });
          parent.candidates([1000, 0, 1000], 0.1);
          if (!inside) {
            create();
            view.candidates([1000, 0, 1000], 0.1);
          } else if (direction === "view-parent") {
            Object.defineProperty(first, "enabled", { configurable: true, get() {
              if (!creating) {
                creating = true;
                try {
                  create();
                  view.candidates([1000, 0, 1000], 0.1);
                } finally {
                  creating = false;
                }
              }
              return true;
            } });
            parent.candidates([0, 0, 0], 1);
            delete first.enabled;
          }
          const hook = () => {
            if (!armed)
              return;
            armed = false;
            if (!view)
              create();
            const other = direction === "parent-view" ? view : parent;
            nested(other, "candidates");
            if (throwing)
              throw error;
          };
          if (mode === "filter")
            first.filter = () => {
              hook();
              return false;
            };
          if (mode === "enabled")
            Object.defineProperty(first, "enabled", { configurable: true, get() {
              hook();
              return true;
            } });
          if (mode === "index-return") {
            const index = parent.staticIndex, original = index.nearOwned;
            index.nearOwned = function(...args) {
              const result = original.apply(this, args);
              hook();
              return result;
            };
          }
          const outer = direction === "parent-view" ? parent : view;
          armed = true;
          let caught;
          try {
            if (mode === "filter")
              assert.equal(ray.call(outer, [0, 3, 0], [0, -1, 0], 5)?.tag, "near");
            else
              assert.deepEqual(tags(outer.candidates([0, 0, 0], 1)), ["far", "near"]);
          } catch (value) {
            caught = value;
          }
          if (throwing)
            assert.equal(caught, error);
          else
            assert.equal(caught, undefined);
          assert(view);
          depth(parent);
          depth(view);
          const a = Reflect.get(parent, "candidateState").call(parent), b = Reflect.get(view, "candidateState").call(view);
          assert.notEqual(a, b);
          assert.notEqual(a.slots, b.slots);
          assert.notEqual(a.slots[0].near, b.slots[0].near);
          assert.notEqual(a.slots[0].out, b.slots[0].out);
          assert.equal(ray.call(outer, [0, 3, 0], [0, -1, 0], 5)?.tag, "near");
          depth(parent);
          depth(view);
        }
});
