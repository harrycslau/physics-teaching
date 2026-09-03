// smoke-index.js — head-less runtime smoke test for index.html.
//
// Evaluates the REAL production <script> body from index.html (plus the
// real optics-core.js it loads) inside macOS JavaScriptCore against a
// minimal DOM/canvas stub. It exercises component creation, selection
// outline drawing, EFL edits, undo/redo through the actual
// PropertyCommand/TransformCommand code paths, toolbar/labelling statics,
// the two prism variants, and the continuous-beam rendering branch.
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
var html = readFile(dir + "/index.html");

// ── DOM stubs ────────────────────────────────────────────────
function makeCtx() {
  var target = { calls: [] };
  return new Proxy(target, {
    get: function (t, prop) {
      if (prop === "__calls") return t.calls;
      if (prop in t) return t[prop];
      return function () {
        t.calls.push({ name: String(prop), args: Array.prototype.slice.call(arguments) });
      };
    },
    set: function (t, prop, v) {
      t[prop] = v;
      t.calls.push({ name: String(prop), args: [v], set: true });
      return true;
    }
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
globalThis.devicePixelRatio = 2;
globalThis.document = {
  getElementById: function (id) { return elements[id] || (elements[id] = makeEl(id)); },
  createElement: function () { return makeEl("__dyn" + (makeEl._n = (makeEl._n || 0) + 1)); },
  querySelectorAll: function () { return []; },
  addEventListener: function () {},
  title: ""
};
globalThis.addEventListener = function () {};
globalThis.requestAnimationFrame = function (cb) { globalThis.__raf = cb; };

// ── Static HTML checks (toolbar labels, help text) ───────────
var buffer = [], passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; buffer.push("PASS: " + msg); }
  else { failed++; buffer.push("FAIL: " + msg); }
}

function buttonInner(id) {
  var m = html.match(new RegExp('<button[^>]*id="' + id + '"[^>]*>([\\s\\S]*?)</button>'));
  return m ? m[1] : null;
}
function buttonInnerText(id) {
  var inner = buttonInner(id);
  return inner === null ? null : inner.replace(/<svg[\s\S]*?<\/svg>/g, "").trim();
}
var LENS_BUTTONS = {
  "btn-convex100": "Convex Lens A", "btn-convex200": "Convex Lens B", "btn-convex400": "Convex Lens C",
  "btn-concave100": "Concave Lens A", "btn-concave200": "Concave Lens B", "btn-concave400": "Concave Lens C"
};
Object.keys(LENS_BUTTONS).forEach(function (id) {
  var txt = buttonInnerText(id);
  check(txt === LENS_BUTTONS[id], '0. toolbar #' + id + ' label is "' + LENS_BUTTONS[id] + '" (got "' + txt + '")');
  check(txt === null || !/\d/.test(txt), "0. toolbar #" + id + " label contains no numeric focal length");
});
check(buttonInnerText("btn-prism60") === "Prism-60", "0. toolbar has Prism-60 button");
check(buttonInnerText("btn-prism90") === "Prism-90", "0. toolbar has Prism-90 button");
// Labels/tooltips/aria must not reveal focal length, strength or thickness.
var LEAK = /curvature|focal|thick|thin|strong|weak|powerful|\d+\s*mm|f\s*=/i;
Object.keys(LENS_BUTTONS).forEach(function (id) {
  var ti = html.match(new RegExp('<button[^>]*id="' + id + '"[^>]*title="([^"]*)"'));
  var al = html.match(new RegExp('<button[^>]*id="' + id + '"[^>]*aria-label="([^"]*)"'));
  check(ti && !LEAK.test(ti[1]), '0. #' + id + ' tooltip is neutral: "' + (ti ? ti[1] : "?") + '"');
  check(al && !LEAK.test(al[1]), '0. #' + id + ' aria-label is neutral: "' + (al ? al[1] : "?") + '"');
  check(ti && /variant [ABC]/.test(ti[1]) && al &&
        al[1].toLowerCase() === LENS_BUTTONS[id].toLowerCase(),
        "0. #" + id + " tooltip/aria identify the variant letter only (A/B/C)");
});
check(html.indexOf("Lens C 100") === -1 && html.indexOf("Triangular prism") === -1 &&
      html.indexOf("CV lens") === -1 && html.indexOf("CC lens") === -1,
      "0. old numeric and CV/CC strength labels removed from HTML");
check(/aria-label="Convex lens A"/.test(html) && /aria-label="Prism 90, right-angle"/.test(html),
      "0. accessible aria-labels present");
check(html.indexOf("Prism-60</b> (equilateral") !== -1 || /Prism-60[\s\S]{0,80}equilateral/i.test(html),
      "0. help overlay describes both prism variants");
check(/variants \(A, B, C\)/i.test(html), "0. help overlay matches neutral A/B/C lens naming");

// 0b. every placeable component button carries a leading, aria-hidden SVG icon
var ICON_BUTTONS = ["btn-convex100", "btn-convex200", "btn-convex400",
                    "btn-concave100", "btn-concave200", "btn-concave400",
                    "btn-flat", "btn-prism60", "btn-prism90", "btn-semi"];
ICON_BUTTONS.forEach(function (id) {
  var inner = buttonInner(id);
  check(inner !== null && /^<svg\b[^>]*aria-hidden="true"[^>]*>/.test(inner.trim()),
        "0b. #" + id + " starts with an aria-hidden SVG icon before the text");
  var inner2 = inner.replace(/<svg[\s\S]*?<\/svg>/, "").trim();
  check(inner2.length > 0, "0b. #" + id + " keeps its descriptive text label");
});
check(ICON_BUTTONS.every(function (id) {
  var m = buttonInner(id).match(/viewBox="0 0 16 16"/);
  return !!m;
}), "0b. all component icons share one 16×16 viewBox (consistent sizing)");
check(/\.tbtn svg\{width:19px;height:19px/.test(html) && /\.tbtn svg\{width:15px;height:15px\}/.test(html),
      "0b. icons enlarged to 19px on desktop, compact 15px on narrow screens");
check(/stroke-width:1\.5/.test(html), "0b. icon strokes thickened to 1.5 for clarity");
// Variant-specific icons: each lens preset keeps its recognizable profile
// (labels stay neutral A/B/C; the drawing order of arcs must flatten A→C).
function iconPath(id) { return buttonInner(id).match(/d="([^"]+)"/)[1]; }
function firstArc(pathD) { return parseFloat(/A\s*([\d.]+)/.exec(pathD)[1]); }
var cvIcons = ["btn-convex100", "btn-convex200", "btn-convex400"].map(iconPath);
var ccIcons = ["btn-concave100", "btn-concave200", "btn-concave400"].map(iconPath);
check(cvIcons.every(function (d) { return /^M8 1\.5A/.test(d); }) &&
      new Set(cvIcons).size === 3,
      "0b. convex icons are three distinct biconvex profiles");
check(ccIcons.every(function (d) { return /^M4\.5 1\.5H/.test(d); }) &&
      new Set(ccIcons).size === 3,
      "0b. concave icons are three distinct biconcave profiles");
var cvR = cvIcons.map(firstArc), ccR = ccIcons.map(firstArc);
check(cvR[0] < cvR[1] && cvR[1] < cvR[2],
      "0b. convex icons flatten A→C (arc radii " + cvR.join("/") + ")");
check(ccR[0] < ccR[1] && ccR[1] < ccR[2],
      "0b. concave icons flatten A→C (arc radii " + ccR.join("/") + ")");
check(cvR[0] > 6.5 && ccR[0] > 6.5,
      "0b. all arc radii exceed half-chord (SVG arcs are drawable)");
var pr60 = iconPath("btn-prism60");
var pr90 = iconPath("btn-prism90");
check(/M8 2L14\.75 13\.7H1\.25Z/.test(pr60), "0b. Prism-60 icon is an equilateral triangle");
check(/M8 4\.85L14\.75 11\.6H1\.25Z/.test(pr90), "0b. Prism-90 icon: right angle on top, hypotenuse base");
check(/<rect /.test(buttonInner("btn-flat")), "0b. Block icon is a rectangle");
check(/A6\.5 6\.5 0 0 1/.test(buttonInner("btn-semi")), "0b. Semi icon is a half-disc (single 6.5-radius arc)");

// 0c. White toggle moved next to Power, functionality/tooltip intact
var iPower = html.indexOf('id="btn-power"');
var iWhite = html.indexOf('id="btn-white"');
var iSlitNone = html.indexOf('id="btn-slit-none"');
check(iPower !== -1 && iWhite > iPower && iWhite < iSlitNone,
      "0c. White toggle sits immediately after Power");
check(html.indexOf('<button class="tbtn" id="btn-white" title="Toggle white-light dispersion mode">☀ White</button>') !== -1,
      "0c. White button keeps its tooltip and label");
check(html.indexOf("id=\"btn-white\"", html.indexOf("id=\"btn-undo\"")) === -1,
      "0c. only one White button remains (old position removed)");
check(/bind\('btn-white'/.test(html) && /getElementById\('btn-white'\)\.classList\.toggle\('active'/.test(html),
      "0c. White binding and active-state toggle unchanged");

// ── Load real production code ────────────────────────────────
eval(readFile(dir + "/optics-core.js"));
var m = html.match(/<script>\n"use strict";([\s\S]*?)\n<\/script>\n<\/body>/);
if (!m) throw new Error("main script block not found in index.html");
// Append an export hook so the sandbox's lexical bindings (const app,
// class definitions…) become reachable from this runner scope.
var src = '"use strict";' + m[1] + "\n;globalThis.__api = {" +
  " app: app, get view(){ return view; }," +
  " createComponent: createComponent, drawSelectionOutline: drawSelectionOutline," +
  " drawRays: drawRays, generateEmission: generateEmission, traceRay: traceRay," +
  " selectComp: selectComp, lensLabel: lensLabel," +
  " get beamBuffer(){ return beamBuffer; }," +
  " pushTransform: function (c, op, orr, np, nr) { pushCommand(new TransformCommand(c, op, orr, np, nr)); }," +
  " setEFL: window.setEFL, undo: undo, redo: redo };";
eval(src);

var C = globalThis.OpticsCore, api = globalThis.__api;
var view = api.view;
check(!!view && view.screenW === 1200, "1. index.html initialised (View built from DOM stub)");
check(api.app.raybox !== null, "1. ray box created at startup");

// 2. create every component type (six placeable definitions incl. two prisms)
[["convex", 200], ["concave", -200], ["flatblock"], ["prism60"], ["prism90"], ["semicircle"]]
  .forEach(function (t) { api.createComponent(t[0], t[1]); });
check(api.app.components.length === 7, "2. all six definitions created (+raybox)");
var convex = api.app.components.find(function (c) { return c.type === "convex"; });
var concave = api.app.components.find(function (c) { return c.type === "concave"; });
var prism60 = api.app.components.find(function (c) { return c.type === "prism" && c.variant === "60"; });
var prism90 = api.app.components.find(function (c) { return c.type === "prism" && c.variant === "90"; });
check(!!prism60 && !!prism90, "2. both prism variants placed independently");
check(convex.label === "Convex Lens B" && concave.label === "Concave Lens B",
      "2. lens labels derived from preset EFL (B = 200 mm)");
check(api.lensLabel(-100) === "Concave Lens A" && api.lensLabel(200) === "Convex Lens B" &&
      api.lensLabel(400) === "Convex Lens C" && api.lensLabel(-400) === "Concave Lens C" &&
      api.lensLabel(100) === "Convex Lens A",
      "2. lensLabel mapping: 100→A, 200→B, 400→C for both types");
check(api.lensLabel(150) === "Convex Lens" && api.lensLabel(-150) === "Concave Lens",
      "2. non-preset EFL falls back to generic type name");
check(convex.radius === C.solveLensRadius(200, 8, 50) && concave.radius === C.solveLensRadius(-200, 8, 50),
      "2. lens radii from shared solver");
check(convex.outline.length === 98 && concave.surfaces.length === 4, "2. lens geometry built via core");

// 3. prism geometry identity (production components, not copies)
function triAngles(v) {
  var out = [];
  for (var q = 0; q < 3; q++) {
    var a = v[(q + 1) % 3].sub(v[q]), b = v[(q + 2) % 3].sub(v[q]);
    out.push(Math.acos(C.clamp(a.dot(b) / (a.len() * b.len()), -1, 1)) * 180 / Math.PI);
  }
  return out;
}
var a60 = triAngles(prism60.verts);
check(a60.every(function (x) { return Math.abs(x - 60) < 1e-9; }),
      "3. Prism-60 production geometry equilateral (" + a60.map(function (x) { return x.toFixed(6); }).join("/") + "°)");
var a90 = triAngles(prism90.verts).sort(function (x, y) { return x - y; });
check(Math.abs(a90[0] - 45) < 1e-9 && Math.abs(a90[1] - 45) < 1e-9 && Math.abs(a90[2] - 90) < 1e-9,
      "3. Prism-90 production geometry is 45/45/90");
check(Math.abs(prism90.sides[1] - prism90.sides[2]) < 1e-9 &&
      Math.abs(prism90.sides[0] - prism90.sides[1] * Math.SQRT2) < 1e-6,
      "3. Prism-90 equal legs, hypotenuse = leg·√2");
var ctr60 = prism60.verts[0].add(prism60.verts[1]).add(prism60.verts[2]).mul(1 / 3);
var ctr90 = prism90.verts[0].add(prism90.verts[1]).add(prism90.verts[2]).mul(1 / 3);
check(ctr60.len() < 1e-12 && ctr90.len() < 1e-12, "3. both prisms centroid-centered at component origin");
check(prism60.surfaces.length === 3 && prism90.surfaces.length === 3 &&
      prism60.containsPoint(prism60.pos) && prism90.containsPoint(prism90.pos),
      "3. prism surfaces built; centroid selectable");
// Outward normals: for centroid-centered tris, each face midpoint must have
// a positive dot product with that face's outward normal.
var outwardOk = [prism60, prism90].every(function (pr) {
  return pr.surfaces.every(function (s) {
    var mid = s.a.add(s.b).mul(0.5);
    return mid.dot(s.normal) > 0;
  });
});
check(outwardOk, "3. prism face normals point outward");

// 4. selection outline: world AABB mapped straight to screen (no component transform)
function outlineRound(comp, label) {
  [0, 30, 45, 90, 135].forEach(function (deg) {
    comp.selected = true;
    comp.rot = deg * Math.PI / 180;
    var ctx = makeCtx();
    api.drawSelectionOutline(ctx, view, comp);
    var rects = ctx.calls.filter(function (c) { return c.name === "strokeRect" && !c.set; });
    var xf = ctx.calls.filter(function (c) {
      return !c.set && (c.name === "translate" || c.name === "scale" || c.name === "rotate");
    });
    check(rects.length === 1 && xf.length === 0,
          "4. " + label + " @" + deg + "\u00b0: one outline rect, zero canvas transforms");
    var r = rects[0].args;
    var x0 = Math.min(r[0], r[0] + r[2]), x1 = Math.max(r[0], r[0] + r[2]);
    var y0 = Math.min(r[1], r[1] + r[3]), y1 = Math.max(r[1], r[1] + r[3]);
    var b = comp.getAABB();
    var pts = comp.outline || comp.verts || [];
    var allIn = pts.every(function (pt) {
      var w = C.transformPoint(pt, comp.pos, comp.rot);
      var s = view.worldToScreen(w);
      return s.x >= x0 - 1e-6 && s.x <= x1 + 1e-6 && s.y >= y0 - 1e-6 && s.y <= y1 + 1e-6 &&
             w.x >= b.min.x - 1e-9 && w.x <= b.max.x + 1e-9 &&
             w.y >= b.min.y - 1e-9 && w.y <= b.max.y + 1e-9;
    });
    check(allIn, "4. " + label + " @" + deg + "\u00b0: rect contains every point");
    comp.selected = false;
    comp.rot = 0;
  });
}
[convex, concave,
 api.app.components.find(function (c) { return c.type === "flatblock"; }),
 prism60, prism90,
 api.app.components.find(function (c) { return c.type === "semicircle"; })
].forEach(function (comp) { outlineRound(comp, comp.label || comp.type); });

// 5. props panel title shows the variant label
api.selectComp(concave);
check(elements["props-title"].textContent === "Concave Lens B",
      "5. props title shows 'Concave Lens B' after selection");
api.selectComp(prism90);
check(elements["props-title"].textContent === "Prism-90", "5. props title shows 'Prism-90'");

// 6. EFL edit + undo/redo through the REAL command stack
var undoDepthBefore = api.app.undoStack.length;
api.setEFL(concave.id, "-100");
check(concave.efl === -100 && concave.radius === C.solveLensRadius(-100, 8, 50),
      "6. concave \u2212200\u2192\u2212100 applied (R=" + concave.radius.toFixed(4) + ")");
check(api.app.undoStack.length === undoDepthBefore + 1, "6. exactly one undo entry pushed");
api.undo();
check(concave.efl === -200 && C.validateLensGeometry(
  { efl: concave.efl, radius: concave.radius, outline: concave.outline, surfaces: concave.surfaces },
  { sign: -1, thickness: 8, aperture: 50 }), "6. undo restores complete \u2212200 geometry");
api.redo();
check(concave.efl === -100 && concave.radius === C.solveLensRadius(-100, 8, 50), "6. redo restores \u2212100");
var depth = api.app.undoStack.length, rBefore = concave.radius;
api.setEFL(concave.id, "-10");
check(concave.efl === -100 && concave.radius === rBefore && api.app.undoStack.length === depth,
      "6. invalid EFL \u221210: state and history untouched");
depth = api.app.undoStack.length;
api.setEFL(convex.id, "50");
check(convex.efl === 200 && api.app.undoStack.length === depth,
      "6. convex f=50 refused by validator: no state/history change");

// 7. duplication preserves identity (Prism-90 must not become Prism-60)
api.selectComp(prism90);
var nBefore = api.app.components.length;
globalThis.duplicateSelected();
var dup = api.app.components.find(function (c) {
  return c.type === "prism" && c.variant === "90" && c.id !== prism90.id;
});
check(api.app.components.length === nBefore + 1 && !!dup && dup.label === "Prism-90",
      "7. duplicating Prism-90 creates a Prism-90 (variant preserved)");
api.selectComp(convex);
globalThis.duplicateSelected();
var dupL = api.app.components.find(function (c) { return c.type === "convex" && c.id !== convex.id; });
check(!!dupL && dupL.label === "Convex Lens B" && dupL.efl === 200 && dupL.radius === convex.radius,
      "7. duplicating a lens preserves label/EFL/geometry");
api.selectComp(dupL);
globalThis.deleteSelected();
check(!api.app.components.includes(dupL) && api.app.components.includes(convex),
      "7. delete removes the duplicate (convex itself stays)");
api.undo();
check(api.app.components.includes(dupL), "7. undo restores the deleted duplicate");

// 8. move/rotate via TransformCommand, then undo/redo
var startPos = convex.pos.clone(), startRot = convex.rot;
api.pushTransform(convex, startPos, startRot, startPos.add(new C.Vec2(40, -25)), 0.5);
check(convex.pos.x === startPos.x + 40 && convex.rot === 0.5, "8. transform applied");
api.undo();
check(convex.pos.x === startPos.x && convex.rot === startRot, "8. transform undone");
api.redo();
check(convex.rot === 0.5, "8. transform redone");
convex.rot = 0; convex.pos = startPos;

// 9. continuous (unslit) beam rendering: brighter accumulation + 3-pass composite
var contSamples = api.generateEmission(api.app.raybox, false);
check(contSamples.length === 64, "9. unslit emission uses " + contSamples.length + " continuous samples");
for (var q = 0; q < contSamples.length; q++) api.traceRay(contSamples[q], api.app.components);
var finalCtx = makeCtx();
api.drawRays(finalCtx, view, contSamples, false);
var beamCalls = api.beamBuffer.getContext("2d").__calls.filter(function (c) {
  return c.set && c.name === "strokeStyle";
});
var maxAlpha = 0;
beamCalls.forEach(function (c) {
  var mm = /rgba\([^)]*,([\d.]+)\)$/.exec(c.args[0]);
  if (mm) maxAlpha = Math.max(maxAlpha, parseFloat(mm[1]));
});
check(beamCalls.length === 64, "9. one accumulation stroke per sample (" + beamCalls.length + ")");
check(maxAlpha > 0.09 && maxAlpha <= 0.28,
      "9. core alpha raised from legacy 0.03 to ~0.11 (max=" + maxAlpha + ")");
var composites = finalCtx.calls.filter(function (c) { return !c.set && c.name === "drawImage"; });
check(composites.length === 3, "9. continuous beam composited in 3 passes: core + halo + wide glow");
var alphas = finalCtx.calls.filter(function (c) { return c.set && c.name === "globalAlpha"; })
                        .map(function (c) { return c.args[0]; });
check(alphas.every(function (a) { return a > 0 && a <= 1; }),
      "9. controlled per-pass opacities (" + alphas.join("/") + ")");

// 9b. discrete rays keep the legacy direct path (unchanged appearance)
function accumulationStrokes() {
  return api.beamBuffer.getContext("2d").__calls.filter(function (c) {
    return c.set && c.name === "strokeStyle";
  }).length;
}
globalThis.setSlit("triple");
var discSamples = api.generateEmission(api.app.raybox, false);
check(discSamples.length === 3, "9b. triple-slit emits 3 discrete rays");
var beamBefore = accumulationStrokes();
var finalCtx2 = makeCtx();
api.drawRays(finalCtx2, view, discSamples, false);
var strokes = finalCtx2.calls.filter(function (c) { return !c.set && c.name === "stroke"; });
var drawn = finalCtx2.calls.filter(function (c) { return !c.set && c.name === "drawImage"; });
check(strokes.length === 3 && drawn.length === 0 && accumulationStrokes() === beamBefore,
      "9b. discrete rays drawn directly, accumulation buffers untouched");
var yComp = finalCtx2.calls.filter(function (c) { return c.set && c.name === "globalCompositeOperation"; });
var yAlpha = finalCtx2.calls.filter(function (c) { return c.set && c.name === "strokeStyle"; });
check(yComp.length === 3 && yComp.every(function (c) { return c.args[0] === "source-over"; }),
      "9b. yellow discrete rays keep source-over compositing");
check(yAlpha.length === 3 && yAlpha.every(function (c) { return /,0\.85\)$/.test(c.args[0]); }),
      "9b. yellow discrete ray alpha unchanged (0.85)");
globalThis.setSlit("none");

// 9c. white-light continuous keeps spectral per-wavelength strokes
var wlSamples = api.generateEmission(api.app.raybox, true);
check(wlSamples.length === 64 * 11, "9c. white-light unslit: 11 wavelengths × 64 samples");
var finalCtx3 = makeCtx();
api.drawRays(finalCtx3, view, wlSamples, true);
var wlComposites = finalCtx3.calls.filter(function (c) { return !c.set && c.name === "drawImage"; });
check(wlComposites.length === 3, "9c. white-light continuous beam uses the same bright 3-pass path");

// 9d. white-light DISCRETE rays: additive, order-independent spectral layers
globalThis.setSlit("single");
var wDisc = api.generateEmission(api.app.raybox, true);   // 1 ray × 11 wavelengths ≤ 35 → discrete branch
check(wDisc.length === 11 && wDisc.every(function (s) { return s.path.length >= 1; }),
      "9d. single-slit white = 11 coincident spectral rays, discrete path");
for (var q2 = 0; q2 < wDisc.length; q2++) api.traceRay(wDisc[q2], api.app.components);
var finalCtx4 = makeCtx();
api.drawRays(finalCtx4, view, wDisc, true);
var wComp = finalCtx4.calls.filter(function (c) { return c.set && c.name === "globalCompositeOperation"; });
var wStroke = finalCtx4.calls.filter(function (c) { return c.set && c.name === "strokeStyle"; });
var wStrokes = finalCtx4.calls.filter(function (c) { return !c.set && c.name === "stroke"; });
check(wComp.length === 11 && wComp.every(function (c) { return c.args[0] === "lighter"; }),
      "9d. every white spectral layer drawn with 'lighter' compositing (red can no longer cover others)");
var wAlphas = wStroke.map(function (c) { return parseFloat(/,([\d.]+)\)$/.exec(c.args[0])[1]); });
check(wAlphas.every(function (a) { return a >= 0.10 && a <= 0.18; }),
      "9d. per-wavelength alpha reduced for additive blending (all = " + wAlphas[0] + ")");
check(wStroke.length === 11 && wStrokes.length === 11,
      "9d. one additive stroke per wavelength layer");
// Drawing order must not matter: same multiset of colors+alphas whether red
// is drawn first or last.
var last = wStroke[wStroke.length - 1].args[0], first = wStroke[0].args[0];
check(/,0\.15\)$/.test(last) && /,0\.15\)$/.test(first) && first !== last,
      "9d. first and last (violet/red) layers use identical alpha — no dominant final draw");
// No slit restored afterwards; wide continuous white path untouched (9c).
globalThis.setSlit("none");

// 10. one full render frame with rays tracing through the live scene
try {
  globalThis.__raf(50); // frame() with the ray box on, all components present
  check(api.app.raybox.power, "10. render frame executed without exceptions (beam on)");
} catch (e) {
  check(false, "10. render frame threw: " + e);
}

buffer.push("", "Smoke results: " + passed + " passed, " + failed + " failed");
$.NSFileHandle.fileHandleWithStandardOutput.writeData(
  $(buffer.join("\n") + "\n").dataUsingEncoding($.NSUTF8StringEncoding));
if (failed) throw new Error(failed + " smoke check(s) failed");
