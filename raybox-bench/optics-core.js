/* Raybox Bench — shared optics core.
 *
 * Pure, DOM-free math used by BOTH index.html (production) and
 * test-production.html. Plain script (no build step): in the browser it
 * attaches to window.OpticsCore; under Node/JXA it also exports via
 * module.exports so the same code can be exercised head-lessly.
 */
(function (root, factory) {
  var core = factory();
  if (root) root.OpticsCore = core;
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
})(typeof globalThis !== 'undefined' ? globalThis
   : (typeof window !== 'undefined' ? window : this), function () {
  "use strict";

  // ── Vec2 ────────────────────────────────────────────────────
  class Vec2 {
    constructor(x = 0, y = 0) { this.x = x; this.y = y; }
    static fromAngle(a, l = 1) { return new Vec2(Math.cos(a) * l, Math.sin(a) * l); }
    clone() { return new Vec2(this.x, this.y); }
    add(v) { return new Vec2(this.x + v.x, this.y + v.y); }
    sub(v) { return new Vec2(this.x - v.x, this.y - v.y); }
    mul(s) { return new Vec2(this.x * s, this.y * s); }
    div(s) { return new Vec2(this.x / s, this.y / s); }
    dot(v) { return this.x * v.x + this.y * v.y; }
    cross(v) { return this.x * v.y - this.y * v.x; }
    len() { return Math.sqrt(this.x * this.x + this.y * this.y); }
    lenSq() { return this.x * this.x + this.y * this.y; }
    norm() { const l = this.len(); return l > 1e-12 ? this.div(l) : new Vec2(0, 0); }
    perp() { return new Vec2(-this.y, this.x); }
    angle() { return Math.atan2(this.y, this.x); }
    angleTo(v) { return Math.atan2(this.cross(v), this.dot(v)); }
    rotate(a) { const c = Math.cos(a), s = Math.sin(a); return new Vec2(this.x * c - this.y * s, this.x * s + this.y * c); }
    dist(v) { return this.sub(v).len(); }
    lerp(v, t) { return new Vec2(this.x + (v.x - this.x) * t, this.y + (v.y - this.y) * t); }
  }

  const TAU = Math.PI * 2;
  const EPSILON = 1e-4;

  function deg2rad(d) { return d * Math.PI / 180; }
  function rad2deg(r) { return r * 180 / Math.PI; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function transformPoint(p, pos, rot) { return p.rotate(rot).add(pos); }

  function aabbOfPoints(points, pad = 0) {
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    return {
      min: new Vec2(Math.min(...xs) - pad, Math.min(...ys) - pad),
      max: new Vec2(Math.max(...xs) + pad, Math.max(...ys) + pad)
    };
  }

  // ── Angle utilities ─────────────────────────────────────────
  function normalizeAngle(a) {
    return ((a % TAU) + TAU) % TAU;
  }

  function angleInSweep(angle, start, end, epsilon = 1e-8) {
    angle = normalizeAngle(angle);
    start = normalizeAngle(start);
    end = normalizeAngle(end);
    if (end < start) end += TAU;
    if (angle < start) angle += TAU;
    return angle >= start - epsilon && angle <= end + epsilon;
  }

  // ── Intersection helpers ────────────────────────────────────
  /** Ray–segment intersection. Returns {point, normal, t, u} or null. */
  function raySegHit(ro, rd, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const denom = rd.x * dy - rd.y * dx;
    if (Math.abs(denom) < 1e-10) return null;
    const t = ((a.x - ro.x) * dy - (a.y - ro.y) * dx) / denom;
    const u = ((a.x - ro.x) * rd.y - (a.y - ro.y) * rd.x) / denom;
    if (t < EPSILON || u < 0 || u > 1) return null;
    const n = new Vec2(-dy, dx).norm();
    return { point: ro.add(rd.mul(t)), normal: n, t, u };
  }

  /** Ray–circle intersection with optional angular sweep filter. */
  function rayCircleHit(ro, rd, center, r, aMin, aMax) {
    const oc = ro.sub(center);
    const A = rd.dot(rd);
    const B = 2 * oc.dot(rd);
    const C = oc.dot(oc) - r * r;
    const disc = B * B - 4 * A * C;
    if (disc < 0) return [];
    const sq = Math.sqrt(disc);
    const results = [];
    for (const t of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) {
      if (t < EPSILON) continue;
      const pt = ro.add(rd.mul(t));
      const ang = Math.atan2(pt.y - center.y, pt.x - center.x);
      if (aMin !== undefined && aMax !== undefined) {
        if (!angleInSweep(ang, aMin, aMax)) continue;
      }
      const n = pt.sub(center).norm();
      results.push({ point: pt, normal: n, t });
    }
    return results;
  }

  /** Point in convex polygon (cross products all same sign). */
  function ptInConvex(pt, verts) {
    if (verts.length < 3) return false;
    let sign = 0;
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i], b = verts[(i + 1) % verts.length];
      const cp = (b.x - a.x) * (pt.y - a.y) - (b.y - a.y) * (pt.x - a.x);
      if (Math.abs(cp) < 1e-10) continue;
      const s = cp > 0 ? 1 : -1;
      if (sign === 0) sign = s; else if (s !== sign) return false;
    }
    return true;
  }

  /** Point in polygon test (any winding). */
  function ptInPolygon(pt, verts) {
    let inside = false;
    for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
      const xi = verts[i].x, yi = verts[i].y;
      const xj = verts[j].x, yj = verts[j].y;
      if ((yi > pt.y) !== (yj > pt.y) && pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi)
        inside = !inside;
    }
    return inside;
  }

  // ── Optical surfaces ────────────────────────────────────────
  class OpticalSurface {
    constructor(material = 'glass', n = 1.5) { this.material = material; this.n = n; }
    intersect(ro, rd) { return null; }
    getNormal(pt) { return new Vec2(0, 1); }
    clone() { return new OpticalSurface(this.material, this.n); }
  }

  class LineSurface extends OpticalSurface {
    constructor(a, b, n = 1.5, outwardSign = 1) {
      super('glass', n);
      this.a = a; this.b = b;
      this.outwardSign = outwardSign;
      const dx = b.x - a.x, dy = b.y - a.y;
      this.normal = new Vec2(dy, -dx).norm().mul(outwardSign);
      this.len = Math.sqrt(dx * dx + dy * dy);
    }
    intersect(ro, rd) {
      const dx = this.b.x - this.a.x, dy = this.b.y - this.a.y;
      const denom = rd.x * dy - rd.y * dx;
      if (Math.abs(denom) < 1e-10) return null;
      const t = ((this.a.x - ro.x) * dy - (this.a.y - ro.y) * dx) / denom;
      const u = ((this.a.x - ro.x) * rd.y - (this.a.y - ro.y) * rd.x) / denom;
      if (t < EPSILON || u < -0.001 || u > 1.001) return null;
      return { point: ro.add(rd.mul(t)), normal: this.normal, t, surface: this };
    }
    clone() { return new LineSurface(this.a.clone(), this.b.clone(), this.n, this.outwardSign); }
  }

  class ArcSurface extends OpticalSurface {
    constructor(center, radius, startAngle, endAngle, outwardSign = 1, n = 1.5) {
      super('glass', n);
      this.center = center; this.radius = radius;
      this.startAngle = startAngle; this.endAngle = endAngle;
      this.outwardSign = outwardSign;
    }
    intersect(ro, rd) {
      const hits = rayCircleHit(ro, rd, this.center, Math.abs(this.radius), this.startAngle, this.endAngle);
      for (const h of hits) {
        const ang = Math.atan2(h.point.y - this.center.y, h.point.x - this.center.x);
        if (angleInSweep(ang, this.startAngle, this.endAngle)) {
          h.normal = h.normal.mul(this.outwardSign);
          h.surface = this;
          return h;
        }
      }
      return null;
    }
    clone() {
      return new ArcSurface(this.center.clone(), this.radius,
        this.startAngle, this.endAngle, this.outwardSign, this.n);
    }
  }

  // ── Refraction helpers ──────────────────────────────────────
  function reflect(incident, normal) {
    return incident.sub(normal.mul(2 * incident.dot(normal)));
  }

  function refractRay(incident, normal, n1, n2) {
    const cosi = -incident.dot(normal);
    const eta = n1 / n2;
    const k = 1 - eta * eta * (1 - cosi * cosi);
    if (k < 0) return null;
    return incident.mul(eta).add(normal.mul(eta * cosi - Math.sqrt(k)));
  }

  // ── Cauchy dispersion ───────────────────────────────────────
  const CAUCHY_A = 1.488;
  const CAUCHY_B = 4163.052;
  const WAVELENGTHS = [400, 430, 460, 490, 520, 550, 580, 610, 640, 670, 700];

  function cauchyN(wavelength_nm) {
    return CAUCHY_A + CAUCHY_B / (wavelength_nm * wavelength_nm);
  }

  function wavelengthToRGB(nm) {
    let r = 0, g = 0, b = 0;
    if (nm >= 380 && nm < 440) { r = -(nm - 440) / 60; b = 1; }
    else if (nm < 490) { g = (nm - 440) / 50; b = 1; }
    else if (nm < 510) { g = 1; b = -(nm - 510) / 20; }
    else if (nm < 580) { r = (nm - 510) / 70; g = 1; }
    else if (nm < 645) { r = 1; g = -(nm - 645) / 65; }
    else if (nm <= 780) { r = 1; }
    let f = 1;
    if (nm >= 380 && nm < 420) f = 0.3 + 0.7 * (nm - 380) / 40;
    else if (nm > 700) f = 0.3 + 0.7 * (780 - nm) / 80;
    return { r: Math.round(r * f * 255), g: Math.round(g * f * 255), b: Math.round(b * f * 255) };
  }

  // ── Lens design optics ──────────────────────────────────────
  // Symmetric thick-lens power (lensmaker, sign convention: light travels +x):
  //   biconvex  R1=+R, R2=−R  →  φ = 2(n−1)/R − (n−1)²·d/(n·R²)   (>0)
  //   biconcave R1=−R, R2=+R  →  φ = −2(n−1)/R − (n−1)²·d/(n·R²)  (<0)
  // sign = +1 for biconvex, −1 for biconcave.
  const LENS_N = 1.5;

  // Relative residual tolerance for the closed-form solution. The quadratic
  // below is solved exactly, so |φ_calc − φ_target| / |φ_target| is at the
  // 1e-13 double-rounding level; 1e-6 leaves 7 orders of headroom while still
  // rejecting a radius that belongs to a different EFL (a wrong R from the
  // quadratic branches changes φ by ≫ 1e-6 relative).
  const SOLVER_REL_TOL = 1e-6;

  function lensPower(R, n, d, sign) {
    const a = n - 1;
    return 2 * sign * a / R - a * a * d / (n * R * R);
  }

  /**
   * Closed-form radius for a symmetric lens of requested signed EFL.
   * Solving  lensPower(R) = sign/|efl|  for R gives the quadratic
   *   P·R² − 2·sign·(n−1)·R + (n−1)²·d/n = 0 ,  P = 1/|efl|
   * whose physical (large-root) branch is
   *   R = (n−1)·(1 + sqrt(1 − sign·P·d/n)) / P .
   * Returns null (NEVER a substituted aperture/2 value) when:
   *   - input invalid / non-finite / |efl| < 1 mm;
   *   - discriminant negative (requested power unreachable for d, n);
   *   - radius non-finite, non-positive, or R < aperture/2 (must span aperture);
   *   - final optical-power residual exceeds SOLVER_REL_TOL.
   */
  function solveLensRadius(efl, thickness, aperture, n = LENS_N) {
    if (!Number.isFinite(efl) || efl === 0) return null;
    if (!Number.isFinite(thickness) || thickness <= 0) return null;
    if (!Number.isFinite(aperture) || aperture <= 0) return null;
    if (!Number.isFinite(n) || n <= 1) return null;
    const sign = efl > 0 ? 1 : -1;
    const f = Math.abs(efl);
    if (f < 1) return null;
    const a = n - 1, d = thickness;
    const P = 1 / f;
    const disc = 1 - sign * P * d / n;
    if (disc < 0) return null;
    const R = a * (1 + Math.sqrt(disc)) / P;
    if (!Number.isFinite(R) || R <= 0) return null;
    if (R < aperture / 2) return null;
    const target = sign * P;
    const calc = lensPower(R, n, d, sign);
    if (!Number.isFinite(calc)) return null;
    if (Math.abs(calc - target) > SOLVER_REL_TOL * Math.abs(target)) return null;
    return R;
  }

  /** Take |efl| magnitude; produce a positive biconvex power. null on failure. */
  function solveConvexRadius(eflMag, thickness, aperture, n = LENS_N) {
    return solveLensRadius(Math.abs(eflMag), thickness, aperture, n);
  }

  /** Take |efl| magnitude; produce a negative (diverging) power. null on failure. */
  function solveConcaveRadius(eflMag, thickness, aperture, n = LENS_N) {
    return solveLensRadius(-Math.abs(eflMag), thickness, aperture, n);
  }

  // ── Outline builders ────────────────────────────────────────
  /** Sampled closed outline for a symmetric biconvex lens (local coords). */
  function makeLensOutline(R, hw, halfAp, nPts) {
    const halfAngle = Math.asin(halfAp / R);
    const leftCX = R - hw;
    const rightCX = -R + hw;
    const pts = [];
    for (let i = 0; i <= nPts; i++) {
      const a = -halfAngle + (2 * halfAngle * i / nPts);
      pts.push(new Vec2(leftCX + R * Math.cos(Math.PI - a), R * Math.sin(Math.PI - a)));
    }
    for (let i = nPts; i >= 0; i--) {
      const a = -halfAngle + (2 * halfAngle * i / nPts);
      pts.push(new Vec2(rightCX + R * Math.cos(a), R * Math.sin(a)));
    }
    return pts;
  }

  /** Sampled closed outline for a symmetric biconcave lens (local coords). */
  function makeConcaveLensOutline(R, hw, halfAp, nPts = 48) {
    const theta = Math.asin(Math.min(1, halfAp / R));
    const leftCenter = new Vec2(-R - hw, 0);
    const rightCenter = new Vec2(R + hw, 0);
    const points = [];
    for (let i = 0; i <= nPts; i++) {
      const angle = theta - (2 * theta * i) / nPts;
      points.push(leftCenter.add(new Vec2(R * Math.cos(angle), R * Math.sin(angle))));
    }
    for (let i = 0; i <= nPts; i++) {
      const angle = Math.PI + theta - (2 * theta * i) / nPts;
      points.push(rightCenter.add(new Vec2(R * Math.cos(angle), R * Math.sin(angle))));
    }
    return points;
  }

  // ── Geometry validation (pure; never mutates the argument) ──
  /**
   * Validate a candidate lens geometry:
   *   { efl, radius, outline: Vec2[], surfaces: OpticalSurface[] }
   * opts: { sign (+1 convex / −1 concave), thickness, aperture, n }
   * Returns true only when every coordinate/centre/radius is finite, the
   * radius spans the aperture, centre/edge thickness are physical, the two
   * faces do not cross, outline width/height are sane, and the thick-lens
   * power matches the requested EFL within SOLVER_REL_TOL.
   */
  function validateLensGeometry(geom, opts) {
    const { sign, thickness, aperture, n = LENS_N } = opts || {};
    if (!geom || (sign !== 1 && sign !== -1)) return false;
    if (!Array.isArray(geom.outline) || geom.outline.length < 6) return false;
    if (!Array.isArray(geom.surfaces) || geom.surfaces.length < 2) return false;
    if (!Number.isFinite(geom.radius) || geom.radius <= 0) return false;
    if (!Number.isFinite(geom.efl) || geom.efl === 0 || Math.sign(geom.efl) !== sign) return false;

    const halfAp = aperture / 2, hw = thickness / 2;
    if (geom.radius < halfAp) return false; // radius must span the aperture

    // Outline coordinates finite and within sane bounds.
    for (const p of geom.outline) {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
    }
    const xs = geom.outline.map(p => p.x), ys = geom.outline.map(p => p.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
    // Height must reach the full aperture; width stays in a sane range for
    // both lens types (convex: < thickness; concave: up to ~2·sagitta wider).
    if (Math.abs(height - aperture) > 1e-6 * aperture + 1e-6) return false;
    if (width < 0.5 * thickness || width > 1.5 * aperture) return false;

    // Surface centres/radii finite; arcs must reach the aperture edges.
    let arcs = 0;
    for (const s of geom.surfaces) {
      if (!s) return false;
      if (s instanceof ArcSurface) {
        arcs++;
        if (!s.center || !Number.isFinite(s.center.x) || !Number.isFinite(s.center.y)) return false;
        if (!Number.isFinite(s.radius) || s.radius < halfAp - 1e-9) return false;
        const reach = Math.abs(Math.sin(s.startAngle)) * s.radius;
        if (Math.abs(reach - halfAp) > 1e-6 * halfAp + 1e-6) return false;
        if (!Number.isFinite(s.endAngle)) return false;
      } else if (s instanceof LineSurface) {
        if (!Number.isFinite(s.a.x) || !Number.isFinite(s.a.y) ||
            !Number.isFinite(s.b.x) || !Number.isFinite(s.b.y)) return false;
        if (s.len <= 0 || !Number.isFinite(s.len)) return false;
      } else {
        return false;
      }
    }
    if (arcs !== 2) return false;

    // Optical power vs requested EFL.
    const target = sign / Math.abs(geom.efl);
    const calc = lensPower(geom.radius, n, thickness, sign);
    if (!Number.isFinite(calc)) return false;
    if (Math.abs(calc - target) > SOLVER_REL_TOL * Math.abs(target)) return false;

    // Thickness + surface-crossing checks.
    const halfAngle = Math.asin(clamp(halfAp / geom.radius, 0, 1));
    const R = geom.radius;
    if (sign === 1) {
      // Biconvex: apexes at ∓hw; faces cross when one sagitta exceeds hw.
      const sagitta = R * (1 - Math.cos(halfAngle));
      if (!Number.isFinite(sagitta) || sagitta >= hw) return false;
      const leftEdgeX = (R - hw) - R * Math.cos(halfAngle);
      const rightEdgeX = (-R + hw) + R * Math.cos(halfAngle);
      if (leftEdgeX >= rightEdgeX) return false; // faces crossed
    } else {
      // Biconcave: centre thickness 2·hw, edges thicker still.
      const leftEdgeX = (-R - hw) + R * Math.cos(halfAngle);
      const rightEdgeX = (R + hw) + R * Math.cos(Math.PI + halfAngle);
      const edgeThk = rightEdgeX - leftEdgeX;
      if (!Number.isFinite(edgeThk) || edgeThk <= thickness) return false;
      if (edgeThk >= 2 * R) return false; // crossed / degenerate
    }
    return true;
  }

  // ── Geometry builders (pure; return candidate or null) ──────
  function buildConvexGeometry(efl, opts = {}) {
    const { thickness = 8, aperture = 50, n = LENS_N, nPts = 48 } = opts;
    if (!Number.isFinite(efl) || efl <= 0) return null;
    const halfAp = aperture / 2, hw = thickness / 2;
    const R = solveLensRadius(efl, thickness, aperture, n);
    if (R === null || !Number.isFinite(R) || R < halfAp) return null;
    const halfAngle = Math.asin(clamp(halfAp / R, 0, 1));
    const outline = makeLensOutline(R, hw, halfAp, nPts);
    const surfaces = [
      new ArcSurface(new Vec2(R - hw, 0), R, Math.PI - halfAngle, Math.PI + halfAngle, 1, n),
      new ArcSurface(new Vec2(-R + hw, 0), R, -halfAngle, halfAngle, 1, n)
    ];
    const geom = { efl, radius: R, outline, surfaces };
    return validateLensGeometry(geom, { sign: 1, thickness, aperture, n }) ? geom : null;
  }

  function buildConcaveGeometry(efl, opts = {}) {
    const { thickness = 8, aperture = 50, n = LENS_N, nPts = 48 } = opts;
    if (!Number.isFinite(efl) || efl >= 0) return null;
    const halfAp = aperture / 2, hw = thickness / 2;
    const R = solveLensRadius(efl, thickness, aperture, n);
    if (R === null || !Number.isFinite(R) || R < halfAp) return null;
    const halfAngle = Math.asin(clamp(halfAp / R, 0, 1));
    const leftCX = -R - hw, rightCX = R + hw;
    const outline = makeConcaveLensOutline(R, hw, halfAp, nPts);
    const leftTop = new Vec2(leftCX + R * Math.cos(halfAngle), R * Math.sin(halfAngle));
    const leftBottom = new Vec2(leftCX + R * Math.cos(-halfAngle), R * Math.sin(-halfAngle));
    const rightBottom = new Vec2(rightCX + R * Math.cos(Math.PI + halfAngle), R * Math.sin(Math.PI + halfAngle));
    const rightTop = new Vec2(rightCX + R * Math.cos(Math.PI - halfAngle), R * Math.sin(Math.PI - halfAngle));
    const surfaces = [
      new ArcSurface(new Vec2(leftCX, 0), R, -halfAngle, halfAngle, -1, n),
      new ArcSurface(new Vec2(rightCX, 0), R, Math.PI - halfAngle, Math.PI + halfAngle, -1, n),
      new LineSurface(leftBottom, rightBottom, n, 1),
      new LineSurface(rightTop, leftTop, n, 1)
    ];
    const geom = { efl, radius: R, outline, surfaces };
    return validateLensGeometry(geom, { sign: -1, thickness, aperture, n }) ? geom : null;
  }

  /** Deep copy of a lens geometry snapshot — snapshots stay immutable. */
  function cloneLensGeometry(geom) {
    if (!geom) return null;
    return {
      efl: geom.efl,
      radius: geom.radius,
      outline: geom.outline.map(p => p.clone()),
      surfaces: geom.surfaces.map(s => s.clone())
    };
  }

  return {
    Vec2, TAU, EPSILON, deg2rad, rad2deg, clamp, transformPoint, aabbOfPoints,
    normalizeAngle, angleInSweep, raySegHit, rayCircleHit, ptInConvex, ptInPolygon,
    OpticalSurface, LineSurface, ArcSurface,
    reflect, refractRay,
    CAUCHY_A, CAUCHY_B, WAVELENGTHS, cauchyN, wavelengthToRGB,
    LENS_N, SOLVER_REL_TOL, lensPower,
    solveLensRadius, solveConvexRadius, solveConcaveRadius,
    makeLensOutline, makeConcaveLensOutline,
    validateLensGeometry, buildConvexGeometry, buildConcaveGeometry, cloneLensGeometry
  };
});
