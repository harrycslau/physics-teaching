// run-tests.js — head-less execution of the shared production test suite.
// The assertions live inside /*__TESTS_START__*/ … __TESTS_END__*/ in
// test-production.html; this runner evaluates that same block (against the
// same optics-core.js that index.html loads) using macOS JavaScriptCore:
//
//   osascript -l JavaScript raybox-bench/run-tests.js
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
    if (/run-tests\.js$/.test(a)) {
      var full = a[0] === "/" ? a : cwd + "/" + a;
      return full.replace(/\/run-tests\.js$/, "");
    }
  }
  return cwd + "/raybox-bench";
}

var dir = scriptDir();
eval(readFile(dir + "/optics-core.js"));
var html = readFile(dir + "/test-production.html");
var m = html.match(/\/\*__TESTS_START__\*\/([\s\S]*?)\/\*__TESTS_END__\*\//);
if (!m) throw new Error("TESTS block not found in test-production.html");
eval(m[1]);

var buffer = [];
var passed = 0, failed = 0, failures = [];
function check(cond, msg) {
  if (cond) passed++;
  else { failed++; failures.push(msg); }
}
function log(msg) {
  if (typeof msg === "string" && msg.indexOf("<h2>") === 0) {
    buffer.push("", msg.replace(/<\/?h2>/g, ""));
  } else if (/^\s{4}/.test(msg)) {
    buffer.push(msg); // numeric detail lines (residuals, focal measurements)
  }
}
function approx(a, b, tol) { return Math.abs(a - b) < (tol || 0.5); }

runOpticsCoreTests({ OpticsCore: globalThis.OpticsCore, check: check, log: log, approx: approx });

for (var i = 0; i < failures.length; i++) buffer.push("FAIL: " + failures[i]);
buffer.push("", "Results: " + passed + " passed, " + failed + " failed");

var outStr = buffer.join("\n") + "\n";
$.NSFileHandle.fileHandleWithStandardOutput.writeData(
  $(outStr).dataUsingEncoding($.NSUTF8StringEncoding));

// JXA has no exit() binding; throwing after writing the report gives rc≠0.
if (failed) throw new Error(failed + " production test(s) failed");
