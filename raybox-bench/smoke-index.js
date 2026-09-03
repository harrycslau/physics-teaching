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

check(/\.tbtn svg path,\.tbtn svg rect,\.tbtn svg circle\{/.test(html),
      "0b. icon stroke CSS covers path, rect AND circle");
check(buttonInnerText("btn-mirror") === "Mirror" && buttonInnerText("btn-protractor") === "Protractor",
      "0d. Mirror and Protractor buttons carry their text labels");
check(/aria-label="Plane mirror"/.test(html) && /aria-label="Full-circle protractor"/.test(html),
      "0d. mirror/protractor accessible labels present");
var iRedo = html.indexOf('id="btn-redo"'), iZI = html.indexOf('id="btn-zoomin"'),
    iZO = html.indexOf('id="btn-zoomout"'), iHelp = html.indexOf('id="btn-help"');
check(iRedo !== -1 && iRedo < iZI && iZI < iZO && iZO < iHelp &&
      (html.slice(iZO + 10, html.lastIndexOf("<button", iHelp)).match(/<button/g) || []).length === 0,
      "0e. Zoom In / Zoom Out sit exactly between Redo and Help, no extra buttons");
check(buttonInnerText("btn-zoomin") === "Zoom In" && buttonInnerText("btn-zoomout") === "Zoom Out",
      "0e. zoom buttons keep text labels (+ magnifier icon, checked in 0e-dyn)");
check(/aria-label="Zoom in"/.test(html) && /aria-label="Zoom out"/.test(html) &&
      /title="Zoom in \(\+\)"/.test(html) && /title="Zoom out \(\u2212\)"/.test(html),
      "0e. zoom buttons have accessible names and tooltips");
check(/<b>\+ \/ \u2212<\/b> \u2013 Zoom/.test(html) && /360\u00b0 measurement overlay/.test(html) &&
      /reflects light from either side/.test(html),
      "0e. help documents zoom keys, protractor overlay, two-sided mirror");

// 0f. new components in the factory & duplication switch
check(/case 'mirror': comp = new PlaneMirror\(pos, 0\)/.test(html) &&
      /case 'protractor': comp = new Protractor\(pos, 0\)/.test(html),
      "0f. factory handles mirror & protractor");
check(/case 'mirror': dup = new PlaneMirror\(p, c\.rot, c\.length\)/.test(html) &&
      /case 'protractor': dup = new Protractor\(p, c\.rot, c\.radius\)/.test(html),
      "0f. duplication preserves mirror length / protractor radius");
check(/comp\.type === 'raybox' \|\| comp\.type === 'protractor'\) continue/.test(html),
      "0f. tracer explicitly excludes the protractor from optical intersection");

// 0g. every component button icon is aria-hidden AND pointer-transparent
["btn-convex100", "btn-convex200", "btn-convex400", "btn-concave100", "btn-concave200",
 "btn-concave400", "btn-flat", "btn-prism60", "btn-prism90", "btn-semi",
 "btn-mirror", "btn-protractor", "btn-zoomin", "btn-zoomout"].forEach(function (id) {
  check(/aria-hidden="true" focusable="false"/.test(buttonInner(id)),
      "0g. #" + id + " icon is hidden from AT and never intercepts clicks");
});

// 0b. every placeable component button carries a leading, aria-hidden SVG icon
var ICON_BUTTONS = ["btn-convex100", "btn-convex200", "btn-convex400",
                    "btn-concave100", "btn-concave200", "btn-concave400",
                    "btn-flat", "btn-prism60", "btn-prism90", "btn-semi",
                    "btn-mirror", "btn-protractor"];
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
  " hitTest: hitTest, onKeyDown: onKeyDown," +
  " selectComp: selectComp, lensLabel: lensLabel," +
  " get beamBuffer(){ return beamBuffer; }," +
  " get haloBuffer(){ return haloBuffer; }," +
  " get glowBuffer(){ return glowBuffer; }," +
  " pushTransform: function (c, op, orr, np, nr) { pushCommand(new TransformCommand(c, op, orr, np, nr)); }," +
  " setEFL: window.setEFL, undo: undo, redo: redo };";
eval(src);

var C = globalThis.OpticsCore, api = globalThis.__api;
var view = api.view;
check(!!view && view.screenW === 1200, "1. index.html initialised (View built from DOM stub)");
check(api.app.raybox !== null, "1. ray box created at startup");

// 2. create every component type (eight placeable definitions incl. two prisms)
[["convex", 200], ["concave", -200], ["flatblock"], ["prism60"], ["prism90"], ["semicircle"], ["mirror"], ["protractor"]]
  .forEach(function (t) { api.createComponent(t[0], t[1]); });
check(api.app.components.length === 9, "2. all eight definitions created (+raybox)");
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
var mirrorComp = api.app.components.find(function (c) { return c.type === "mirror"; });
var protoComp = api.app.components.find(function (c) { return c.type === "protractor"; });
check(!!mirrorComp && !!protoComp, "4a. mirror and protractor placed");
check(mirrorComp.length === 100 && mirrorComp.label === "Mirror" &&
      mirrorComp.surfaces.length === 1 && mirrorComp.surfaces[0].mirror === true,
      "4a. plane mirror: 100 mm face, one MirrorSurface");
check(protoComp.surfaces.length === 0 && protoComp.radius === 110 && protoComp.label === "Protractor",
      "4a. protractor: no optical surfaces (overlay only)");
check(mirrorComp.getRotHandlePos().sub(mirrorComp.pos).len() > 50 &&
      protoComp.getRotHandlePos().sub(protoComp.pos).len() > protoComp.radius,
      "4a. rotation handles sit outside both components");
[convex, concave,
 api.app.components.find(function (c) { return c.type === "flatblock"; }),
 prism60, prism90,
 api.app.components.find(function (c) { return c.type === "semicircle"; }),
 mirrorComp, protoComp
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

// 9e. High-DPI buffer pipeline: dpr 1, 1.5, 2, 3 — registration, clearing,
// aperture alignment, and upright text. (Stub canvases record every call,
// so we can assert transforms/coords even without pixels.)
function firstCall(calls, name) {
  for (var z = 0; z < calls.length; z++) if (calls[z].name === name && !calls[z].set) return z;
  return -1;
}
[1, 1.5, 2, 3].forEach(function (dpr) {
  globalThis.devicePixelRatio = dpr;
  view.resize();
  var samples = api.generateEmission(api.app.raybox, false);
  for (var z = 0; z < samples.length; z++) api.traceRay(samples[z], api.app.components);
  // Beam must start at the ray-box aperture plane (x = −150 + 30 + 2 = −118),
  // fanned across the 30 mm aperture (±15 mm); DPR must not move it.
  check(samples.every(function (s) { return Math.abs(s.path[0].x + 118) < 1e-9; }) &&
        Math.abs(Math.max.apply(null, samples.map(function (s) { return Math.abs(s.path[0].y); })) - 15) < 1e-9,
        "9e. dpr=" + dpr + ": beam starts at the ray-box aperture plane, fanned across 30 mm");
  var fctx = makeCtx();
  api.drawRays(fctx, view, samples, false);
  var W = Math.round(view.screenW * dpr), H = Math.round(view.screenH * dpr);
  var bufs = [["beam", api.beamBuffer], ["halo", api.haloBuffer], ["glow", api.glowBuffer]];
  check(bufs.every(function (p) { return p[1].width === W && p[1].height === H; }),
        "9e. dpr=" + dpr + ": all buffers at device size " + W + "\u00d7" + H);
  bufs.forEach(function (p) {
    var calls = p[1].getContext("2d").__calls;
    var iST = firstCall(calls, "setTransform"), iCR = firstCall(calls, "clearRect");
    check(iST === 0 && String(calls[0].args.slice(0, 6)) === String([dpr, 0, 0, dpr, 0, 0]),
          "9e. dpr=" + dpr + ": " + p[0] + " buffer gets setTransform(dpr,…) first");
    check(iCR > iST && String(calls[iCR].args) === String([0, 0, view.screenW, view.screenH]),
          "9e. dpr=" + p[0] + " cleared in CSS px under the DPR transform (dpr=" + dpr + ")");
  });
  var hDI = api.haloBuffer.getContext("2d").__calls.filter(function (c) { return !c.set && c.name === "drawImage"; });
  var gDI = api.glowBuffer.getContext("2d").__calls.filter(function (c) { return !c.set && c.name === "drawImage"; });
  check(hDI.length === 1 && String(hDI[0].args.slice(1)) === String([0, 0, view.screenW, view.screenH]) &&
        gDI.length === 1 && String(gDI[0].args.slice(1)) === String([0, 0, view.screenW, view.screenH]),
        "9e. dpr=" + dpr + ": halo/glow blit the core 1:1 into the same CSS-px rect (no offset ghost)");
  var comps = fctx.calls.filter(function (c) { return !c.set && c.name === "drawImage"; });
  check(comps.length === 3 && comps.every(function (c) {
    return String(c.args.slice(1)) === String([0, 0, view.screenW, view.screenH]);
  }), "9e. dpr=" + dpr + ": core+halo+glow composite onto identical device rect");
});

// 9f. vertical resize at fixed DPR: same width, different height must not
// leave stale-height buffers behind (browser-zoom / window-resize artifact).
globalThis.devicePixelRatio = 2;
elements["canvas"].getBoundingClientRect = function () { return { left: 0, top: 0, width: 1200, height: 600 }; };
view.resize();
var rzSamples = api.generateEmission(api.app.raybox, false);
api.drawRays(makeCtx(), view, rzSamples, false);
check(api.beamBuffer.width === 2400 && api.beamBuffer.height === 1200 &&
      api.haloBuffer.height === 1200 && api.glowBuffer.height === 1200,
      "9f. resize (same width, new height) recreated every buffer at 2400×1200");
elements["canvas"].getBoundingClientRect = function () { return { left: 0, top: 0, width: 1200, height: 800 }; };
view.resize();

// 9g. ray-box canvas text stays upright despite the Y-flipping CTM
var tctx = makeCtx();
api.app.raybox.render(tctx, view);
var tc = tctx.__calls;
var compFlip = -1, unitFlips = [], texts = [];
tc.forEach(function (c, idx) {
  if (c.set) return;
  if (c.name === "scale") {
    if (c.args[1] < 0 && c.args[0] !== 1) compFlip = idx;              // scale(zoom, −zoom)
    else if (c.args[0] === 1 && c.args[1] === -1) unitFlips.push(idx); // compensating scale(1, −1)
  }
  if (c.name === "fillText") texts.push(idx);
});
check(compFlip !== -1 && texts.length >= 1, "9g. ray-box renders text under the flipped transform");
check(unitFlips.length >= 1 && unitFlips.every(function (u) {
  return u > compFlip && texts.some(function (t) { return t > u; });
}) && texts.every(function (t) { return unitFlips.some(function (u) { return u < t; }); }),
"9g. every fillText (ON/OFF + slit label) is preceded by a compensating scale(1,−1) → upright");

// 10. one full render frame with rays tracing through the live scene
try {
  globalThis.__raf(50); // frame() with the ray box on, all components present
  check(api.app.raybox.power, "10. render frame executed without exceptions (beam on)");
} catch (e) {
  check(false, "10. render frame threw: " + e);
}

// 11. Plane mirror through the PRODUCTION tracer (single-slit beam)
globalThis.setSlit("single");
mirrorComp.pos = new C.Vec2(150, 0);
mirrorComp.rot = 135 * Math.PI / 180;                    // normal at 225°
var mray = api.generateEmission(api.app.raybox, false)[0];
api.traceRay(mray, [api.app.raybox, mirrorComp]);
check(mray.terminated && mray.path.length >= 2,
      "11. single ray reached and reflected off the mirror (depth " + mray.depth + ")");
var expectedDir = C.Vec2.fromAngle(2 * (225 * Math.PI / 180) + Math.PI); // (0,−1)
check(Math.abs(mray.direction.x - expectedDir.x) < 1e-9 &&
      Math.abs(mray.direction.y - expectedDir.y) < 1e-9,
      "11. production reflection obeys the law exactly (dir " + mray.direction.x.toFixed(6) +
      "," + mray.direction.y.toFixed(6) + ")");
var bounce = mray.path.some(function (p) { return Math.abs(p.x - 150) < 1e-6 && Math.abs(p.y) < 1e-6; });
check(bounce, "11. reflection vertex recorded at the mirror's displayed position");
check(mray.wavelength === 550 && Math.abs(mray.weight - 1) < 1e-12 &&
      mray.currentMedium.type === "air",
      "11. wavelength, intensity and medium preserved through reflection");
// 11b. the reflected ray then interacts with another optical element:
// a convex lens placed on the reflected path refracts it (on-axis, 2 faces).
var lensPos = convex.pos.clone(), lensRot = convex.rot;
convex.pos = new C.Vec2(150, -160); convex.rot = Math.PI / 2;   // axis vertical
var mray2 = api.generateEmission(api.app.raybox, false)[0];
api.traceRay(mray2, [api.app.raybox, mirrorComp, convex]);
check(mray2.path.length >= 4,
      "11b. reflected ray enters and leaves the lens afterwards (" + mray2.path.length + " path points)");
check(mray2.path.some(function (p) { return Math.abs(p.x - 150) < 1e-6 && Math.abs(p.y + 156) < 1e-3; }) &&
      mray2.currentMedium.type === "air",
      "11b. lens entry vertex at (150, −156); medium bookkeeping consistent");
convex.pos = lensPos; convex.rot = lensRot;
// 11c. move/rotate then re-reflect at the new pose:
mirrorComp.pos = new C.Vec2(200, 0); mirrorComp.rot = 45 * Math.PI / 180;
var mray3 = api.generateEmission(api.app.raybox, false)[0];
api.traceRay(mray3, [api.app.raybox, mirrorComp]);
check(mray3.path.some(function (p) { return Math.abs(p.x - 200) < 1e-6 && Math.abs(p.y) < 1e-6; }) &&
      mray3.direction.y > 0.999,
      "11c. moved+rotated mirror reflects at its displayed position (dir " +
      mray3.direction.x.toFixed(3) + "," + mray3.direction.y.toFixed(3) + ")");
mirrorComp.pos = new C.Vec2(-40, 60); mirrorComp.rot = 0;   // park off-beam for later tests

// 12. Protractor: ray-invisible, click-transparent interior, 1° markings
globalThis.setSlit("none");
protoComp.pos = new C.Vec2(20, 0); protoComp.rot = 0;
var compsAll = api.app.components;
var compsNoP = compsAll.filter(function (c) { return c !== protoComp; });
var withP = api.generateEmission(api.app.raybox, false);
withP.forEach(function (s2) { api.traceRay(s2, compsAll); });
var withoutP = api.generateEmission(api.app.raybox, false);
withoutP.forEach(function (s2) { api.traceRay(s2, compsNoP); });
var identical = withP.length === withoutP.length && withP.every(function (s2, i2) {
  var o = withoutP[i2];
  return s2.path.length === o.path.length &&
         s2.path.every(function (p, j) { return Math.abs(p.x - o.path[j].x) < 1e-12 && Math.abs(p.y - o.path[j].y) < 1e-12; });
});
check(identical, "12. every traced ray is bit-identical with the protractor in the scene");
check(withP.every(function (s2) { return s2.currentMedium.componentId !== protoComp.id; }),
      "12. no ray ever enters the protractor");
check(api.hitTest(protoComp.pos, view).comp === protoComp, "12. center hub selectable");
check(api.hitTest(protoComp.localToWorld(new C.Vec2(protoComp.radius, 0)), view).comp === protoComp,
      "12. rim band selectable");
check(api.hitTest(protoComp.localToWorld(new C.Vec2(40, 3)), view).comp === protoComp,
      "12. baseline strip selectable");
check(api.hitTest(protoComp.localToWorld(new C.Vec2(45, 30)), view).comp !== protoComp,
      "12. transparent interior passes clicks through to components underneath");
var pctx = makeCtx();
protoComp.selected = true;
protoComp.rot = 37.4 * Math.PI / 180;
protoComp.render(pctx, view);
var pMove = pctx.__calls.filter(function (c) { return !c.set && c.name === "moveTo"; });
check(pMove.length >= 360, "12. full 360° of 1° ticks drawn (" + pMove.length + " segments)");
var pTexts = pctx.__calls.filter(function (c) { return !c.set && c.name === "fillText"; });
check(pTexts.length === 37, "12. 36 labels every 10° + selected-rotation readout (got " + pTexts.length + ")");
check(pTexts[pTexts.length - 1].args[0] === "37°", "12. center readout rounds 37.4° → 37°");
protoComp.rot = 37.6 * Math.PI / 180;
api.selectComp(protoComp);
check(elements["props-title"].textContent === "Protractor" &&
      elements["props-body"].innerHTML.indexOf(">38°<") !== -1,
      "12. props title 'Protractor'; rotation readout 37.6° → 38° (1° resolution)");
protoComp.selected = false;
// 12b. duplicate/delete/undo preserve protractor & mirror identity
api.selectComp(protoComp);
globalThis.duplicateSelected();
var dupP = api.app.components.find(function (c) { return c.type === "protractor" && c.id !== protoComp.id; });
check(!!dupP && dupP.label === "Protractor" && dupP.radius === protoComp.radius,
      "12b. duplicating the protractor preserves it");
api.selectComp(mirrorComp);
globalThis.duplicateSelected();
var dupM = api.app.components.find(function (c) { return c.type === "mirror" && c.id !== mirrorComp.id; });
check(!!dupM && dupM.label === "Mirror" && dupM.length === 100 && dupM.surfaces[0].mirror === true,
      "12b. duplicating the mirror preserves length and reflective surface");
api.selectComp(dupP);
globalThis.deleteSelected();
check(!api.app.components.includes(dupP), "12b. protractor duplicate deleted");
api.undo();
check(api.app.components.includes(dupP), "12b. undo restores it");

// 13. Zoom controls (view methods, keyboard, center anchor, DPR alignment)
var z0 = view.zoom;
check(Math.abs(z0 - view.fitZoom) < 1e-12, "13. initial zoom equals fit zoom (" + z0 + ")");
view.zoomIn();
check(Math.abs(view.zoom - z0 * 1.2) < 1e-12, "13. Zoom In applies exactly ×1.2");
view.zoomOut();
check(Math.abs(view.zoom - z0) < 1e-12, "13. Zoom Out applies exactly ÷1.2");
view.zoomIn(); view.zoomIn();
var scr = view.worldToScreen(view.cameraPos);
check(Math.abs(scr.x - view.screenW / 2) < 1e-9 && Math.abs(scr.y - view.screenH / 2) < 1e-9,
      "13. zoom is anchored to the visible workspace center");
for (var zz = 0; zz < 40; zz++) view.zoomIn();
check(view.zoom === 8, "13. zoom clamps at maximum 8");
for (zz = 0; zz < 90; zz++) view.zoomOut();
check(view.zoom === 0.3, "13. zoom clamps at minimum 0.3");
view.resetZoom();
check(Math.abs(view.zoom - view.fitZoom) < 1e-12, "13. resetZoom restores the fit");
function kev(key, tag) { return { key: key, preventDefault: function () {}, target: { tagName: tag || "CANVAS" } }; }
var k0 = view.zoom;
api.onKeyDown(kev("+"));
check(Math.abs(view.zoom - k0 * 1.2) < 1e-12, "13. '+' keyboard zooms in");
api.onKeyDown(kev("_"));
check(Math.abs(view.zoom - k0) < 1e-12, "13. '−' keyboard zooms out");
api.onKeyDown(kev("0"));
check(view.zoom === view.fitZoom, "13. '0' keyboard resets zoom");
view.zoomIn();
api.onKeyDown(kev("+", "INPUT"));
check(Math.abs(view.zoom - view.fitZoom * 1.2) < 1e-12, "13. zoom keys ignored while typing in the properties field");
view.resetZoom();
// High-DPI alignment survives a zoom change (buffers sized by screen px × dpr):
globalThis.devicePixelRatio = 3; view.resize();
view.zoomIn(); view.zoomIn(); view.zoomOut();
var zSamples = api.generateEmission(api.app.raybox, false);
zSamples.forEach(function (s2) { api.traceRay(s2, compsAll); });
var zctx = makeCtx();
api.drawRays(zctx, view, zSamples, false);
var zDraw = zctx.calls.filter(function (c) { return !c.set && c.name === "drawImage"; });
check(zDraw.length === 3 && zDraw.every(function (c) {
  return String(c.args.slice(1)) === String([0, 0, view.screenW, view.screenH]);
}), "13. at dpr=3 after zooming, core/halo/glow still share one device rect (no ghost)");
check(api.beamBuffer.width === 3600 && api.beamBuffer.height === 2400 &&
      api.haloBuffer.width === 3600 && api.glowBuffer.height === 2400,
      "13. buffers recreated at dpr=3 device size after resize+zoom");
globalThis.devicePixelRatio = 2; view.resize();
protoComp.rot = 0;

buffer.push("", "Smoke results: " + passed + " passed, " + failed + " failed");
$.NSFileHandle.fileHandleWithStandardOutput.writeData(
  $(buffer.join("\n") + "\n").dataUsingEncoding($.NSUTF8StringEncoding));
if (failed) throw new Error(failed + " smoke check(s) failed");
