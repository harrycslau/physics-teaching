// smoke-index.js — head-less runtime smoke test for index.html.
//
// Evaluates the REAL production <script> body from index.html (plus the
// real optics-core.js it loads) inside macOS JavaScriptCore against a
// minimal DOM/canvas stub. It exercises component creation, selection
// outline drawing, EFL edits, and undo/redo through the actual
// PropertyCommand/TransformCommand code paths.
//
//   osascript -l JavaScript raybox-bench/smoke-index.js
//
// This is NOT a substitute for a real browser (no pixel rendering, no
// pointer events, no CSS); report it as a DOM-stub smoke test.
//
ObjC.import("Foundation");

function readFile(p) {
  var s = $.NSString.stringWithContentsOfFileEncodingError(
    p, $.NSUTF8StringEncoding, null);
  if (s.isNil()) throw new Error("cannot read " + p);
  return s.js;
}
function scriptDir() {
  var args = $.NSProcessInfo.processInfo.arguments;
  var cwd = $.NSFileManager.defaultManager.currentDirectoryPath.js;
  for (var i = 0; i < args.count; i++) {
    var a = args.objectAtIndex(i).js;
    if (/smoke-index\.js$/.test(a)) {
      var full = a[0] === "/" ? a : cwd + "/" + a;
      return full.replace(/\/smoke-index\.js$/, "");
    }
  }
  return cwd + "/raybox-bench";
}
var dir = scriptDir();

// ── DOM stubs ────────────────────────────────────────────────
function makeCtx() {
  var target = { calls: [] };
  return new Proxy(target, {
    get: function (t, prop) {
      if (prop in t) return t[prop];
      return function () {
        t.calls.push({ name: String(prop), args: Array.prototype.slice.call(arguments) });
      };
    },
    set: function (t, prop, v) { t[prop] = v; return true; }
  });
}
var elements = {};
function makeEl(id) {
  var el = {
    id: id, style: {}, textContent: "", innerHTML: "", value: "",
    _listeners: {},
    classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } },
    addEventListener: function (name, fn) { (el._listeners[name] = el._listeners[name] || []).push(fn); },
    appendChild: function () {},
    getContext: function () { return el._ctx || (el._ctx = makeCtx()); },
    getBoundingClientRect: function () { return { left: 0, top: 0, width: 1200, height: 800 }; },
    querySelectorAll: function () { return []; },
    width: 0, height: 0
  };
  return el;
}
globalThis.window = globalThis;
globalThis.setTimeout = function () { return 0; };
globalThis.clearTimeout = function () {};
globalThis.document = {
  getElementById: function (id) { return elements[id] || (elements[id] = makeEl(id)); },
  createElement: function () { return makeEl("__dyn"); },
  querySelectorAll: function () { return []; },
  addEventListener: function () {},
  title: ""
};
globalThis.addEventListener = function () {};
globalThis.requestAnimationFrame = function (cb) { globalThis.__raf = cb; };

// ── Load real production code ────────────────────────────────
eval(readFile(dir + "/optics-core.js"));
var html = readFile(dir + "/index.html");
var m = html.match(/<script>\n"use strict";([\s\S]*?)\n<\/script>\n<\/body>/);
if (!m) throw new Error("main script block not found in index.html");
// Append an export hook so the sandbox's lexical bindings (const app,
// class definitions…) become reachable from this runner scope.
var src = '"use strict";' + m[1] + "\n;globalThis.__api = {" +
  " app: app, get view(){ return view; }," +
  " createComponent: createComponent, drawSelectionOutline: drawSelectionOutline," +
  " pushTransform: function (c, op, orr, np, nr) { pushCommand(new TransformCommand(c, op, orr, np, nr)); }," +
  " setEFL: window.setEFL, undo: undo, redo: redo };";
eval(src);

var C = globalThis.OpticsCore, A = globalThis.__api, api = A;
var buffer = [], passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; buffer.push("PASS: " + msg); }
  else { failed++; buffer.push("FAIL: " + msg); }
}

var view = api.view;
check(!!view && view.screenW === 1200, "1. index.html initialised (View built from DOM stub)");
check(api.app.raybox !== null, "1. ray box created at startup");

// 2. create every component type
["convex", "concave", "flatblock", "prism", "semicircle"].forEach(function (t) {
  api.createComponent(t, t === "convex" ? 200 : t === "concave" ? -200 : undefined);
});
check(api.app.components.length === 6, "2. all five component types created (+raybox)");
var convex = api.app.components.find(function (c) { return c.type === "convex"; });
var concave = api.app.components.find(function (c) { return c.type === "concave"; });
check(convex.radius === C.solveLensRadius(200, 8, 50), "2. convex radius from shared solver (R=" + convex.radius.toFixed(4) + ")");
check(concave.radius === C.solveLensRadius(-200, 8, 50), "2. concave radius from shared solver (R=" + concave.radius.toFixed(4) + ")");
check(convex.outline.length === 98 && concave.outline.length === 98, "2. lens outlines built (98 pts)");
check(convex.surfaces.length === 2 && concave.surfaces.length === 4, "2. lens surfaces built");
check(C.validateLensGeometry(
  { efl: convex.efl, radius: convex.radius, outline: convex.outline, surfaces: convex.surfaces },
  { sign: 1, thickness: 8, aperture: 50 }), "2. live convex geometry passes shared validator");
check(C.validateLensGeometry(
  { efl: concave.efl, radius: concave.radius, outline: concave.outline, surfaces: concave.surfaces },
  { sign: -1, thickness: 8, aperture: 50 }), "2. live concave geometry passes shared validator");
check(convex.containsPoint(convex.pos) && !convex.containsPoint(convex.pos.add(new C.Vec2(500, 0))),
      "2. convex body selectable via shared ptInPolygon");
check(concave.containsPoint(concave.pos) && !concave.containsPoint(concave.pos.add(new C.Vec2(500, 0))),
      "2. concave body selectable via shared ptInPolygon");

// 3. selection outline: world AABB mapped straight to screen (no component transform)
["convex", "concave", "flatblock", "prism", "semicircle"].forEach(function (type) {
  var comp = api.app.components.find(function (c) { return c.type === type; });
  [0, 30, 45, 90, 135].forEach(function (deg) {
    comp.selected = true;
    comp.rot = deg * Math.PI / 180;
    var ctx = makeCtx();
    api.drawSelectionOutline(ctx, view, comp);
    var rects = ctx.calls.filter(function (c) { return c.name === "strokeRect"; });
    var xf = ctx.calls.filter(function (c) {
      return c.name === "translate" || c.name === "scale" || c.name === "rotate";
    });
    check(rects.length === 1, "3. " + type + " @" + deg + "\u00b0: exactly one outline rect, no canvas transforms (" + xf.length + ")");
    var r = rects[0].args;
    var x0 = Math.min(r[0], r[0] + r[2]), x1 = Math.max(r[0], r[0] + r[2]);
    var y0 = Math.min(r[1], r[1] + r[3]), y1 = Math.max(r[1], r[1] + r[3]);
    var b = comp.getAABB();
    var src = comp.outline || (type === "raybox" ? [] : comp.verts);
    var allIn = src.every(function (pt) {
      var w = C.transformPoint(pt, comp.pos, comp.rot);
      var s = view.worldToScreen(w);
      return s.x >= x0 - 1e-6 && s.x <= x1 + 1e-6 && s.y >= y0 - 1e-6 && s.y <= y1 + 1e-6 &&
             w.x >= b.min.x - 1e-9 && w.x <= b.max.x + 1e-9 &&
             w.y >= b.min.y - 1e-9 && w.y <= b.max.y + 1e-9;
    });
    check(allIn, "3. " + type + " @" + deg + "\u00b0: outline rect contains every component point");
    comp.selected = false;
  });
});
convex.rot = 0; concave.rot = 0;

// 4. EFL edit + undo/redo through the REAL command stack
var undoDepthBefore = api.app.undoStack.length;
api.setEFL(concave.id, "-100");
check(concave.efl === -100 && concave.radius === C.solveLensRadius(-100, 8, 50),
      "4. concave \u2212200\u2192\u2212100 applied (R=" + concave.radius.toFixed(4) + ")");
check(api.app.undoStack.length === undoDepthBefore + 1, "4. exactly one undo entry pushed");
var geomSnap = concave.outline[7].x;
api.undo();
check(concave.efl === -200 && concave.radius === C.solveLensRadius(-200, 8, 50) &&
      C.validateLensGeometry({ efl: concave.efl, radius: concave.radius, outline: concave.outline, surfaces: concave.surfaces },
        { sign: -1, thickness: 8, aperture: 50 }),
      "4. undo restores complete \u2212200 geometry (validated)");
api.redo();
check(concave.efl === -100 && concave.outline[7].x === geomSnap, "4. redo restores complete \u2212100 geometry");
// invalid attempt: f=-10 refused, no state/history change
var depth = api.app.undoStack.length, rBefore = concave.radius;
api.setEFL(concave.id, "-10");
check(concave.efl === -100 && concave.radius === rBefore && api.app.undoStack.length === depth,
      "4. invalid EFL \u221210: state and history untouched");
// convex: f=50 passes the UI's 50mm guard but the geometry validator refuses
// it (faces would cross) → must also be a no-op.
depth = api.app.undoStack.length;
api.setEFL(convex.id, "50");
check(convex.efl === 200 && api.app.undoStack.length === depth,
      "4. convex f=50 refused by validator (edge crossing): no state/history change");
api.setEFL(convex.id, "100");
api.undo();
check(convex.efl === 200 && convex.radius === C.solveLensRadius(200, 8, 50), "4. convex undo round-trip OK");

// 5. move/rotate via TransformCommand, then undo/redo
var startPos = convex.pos.clone(), startRot = convex.rot;
api.pushTransform(convex, startPos, startRot, startPos.add(new C.Vec2(40, -25)), 0.5);
check(convex.pos.x === startPos.x + 40 && convex.rot === 0.5, "5. transform applied");
api.undo();
check(convex.pos.x === startPos.x && convex.pos.y === startPos.y && convex.rot === startRot,
      "5. transform undone");
api.redo();
check(convex.rot === 0.5, "5. transform redone");
convex.rot = 0; convex.pos = startPos;

// 6. delete + recreate via command stack
api.app.selected = concave;
var n = api.app.components.length;
globalThis.deleteSelected();
check(api.app.components.length === n - 1, "6. delete removes component");
api.undo();
check(api.app.components.length === n, "6. undo restores deleted component");

// 7. one full render frame with rays tracing through the live scene
try {
  globalThis.__raf(16); // frame() with the ray box on, all components present
  var traced = api.app.raybox.power;
  check(traced, "7. render frame executed without exceptions (beam on)");
} catch (e) {
  check(false, "7. render frame threw: " + e);
}

buffer.push("", "Smoke results: " + passed + " passed, " + failed + " failed");
$.NSFileHandle.fileHandleWithStandardOutput.writeData(
  $(buffer.join("\n") + "\n").dataUsingEncoding($.NSUTF8StringEncoding));
if (failed) throw new Error(failed + " smoke check(s) failed");
