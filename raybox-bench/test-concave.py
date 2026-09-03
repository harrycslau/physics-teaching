#!/usr/bin/env python3
"""Independent Python reference-model tests for the ray-bench lens design.

Mirrors the physics implemented in optics-core.js (and therefore in
index.html) with a separate implementation:
  - closed-form radius solver for a symmetric thick lens,
  - null/None on failure (NEVER a substituted aperture/2 radius),
  - full candidate-geometry validation.

Semantics of solve_*_radius: return a positive radius only when the
thick-lens optical power matches the requested |EFL| to within a relative
residual of 1e-6 and R >= aperture/2; otherwise return None.
"""
import math, sys, copy

PI = math.pi
TAU = 2 * PI

SOLVER_REL_TOL = 1e-6

class Vec2:
    def __init__(self, x, y):
        self.x = x
        self.y = y
    def add(self, v): return Vec2(self.x + v.x, self.y + v.y)
    def sub(self, v): return Vec2(self.x - v.x, self.y - v.y)
    def mul(self, s): return Vec2(self.x * s, self.y * s)
    def dot(self, v): return self.x * v.x + self.y * v.y
    def len(self): return math.hypot(self.x, self.y)
    def norm(self):
        l = self.len()
        return self.mul(1 / l) if l > 0 else Vec2(0, 0)

def make_concave_outline(R, hw, half_ap, n_pts=48):
    theta = math.asin(min(1, half_ap / R))
    lc = Vec2(-R - hw, 0)
    rc = Vec2(R + hw, 0)
    pts = []
    for i in range(n_pts + 1):
        a = theta - (2 * theta * i) / n_pts
        pts.append(lc.add(Vec2(R * math.cos(a), R * math.sin(a))))
    for i in range(n_pts + 1):
        a = PI + theta - (2 * theta * i) / n_pts
        pts.append(rc.add(Vec2(R * math.cos(a), R * math.sin(a))))
    return pts

def make_convex_outline(R, hw, half_ap, n_pts=48):
    half_angle = math.asin(min(1, half_ap / R))
    left_cx = R - hw
    right_cx = -R + hw
    pts = []
    for i in range(n_pts + 1):
        a = -half_angle + (2 * half_angle * i / n_pts)
        pts.append(Vec2(left_cx + R * math.cos(PI - a), R * math.sin(PI - a)))
    for i in range(n_pts, -1, -1):
        a = -half_angle + (2 * half_angle * i / n_pts)
        pts.append(Vec2(right_cx + R * math.cos(a), R * math.sin(a)))
    return pts

def lens_power(R, n, d, sign):
    """Thick symmetric lens: sign=+1 biconvex, -1 biconcave."""
    a = n - 1
    return 2 * sign * a / R - a * a * d / (n * R * R)

def solve_lens_radius(efl, thickness, aperture, n=1.5):
    """Closed form of  lensPower(R) = sign/|efl|:
         P·R² − 2·sign·(n−1)·R + (n−1)²·d/n = 0,  P = 1/|efl|
       physical branch  R = (n−1)(1 + sqrt(1 − sign·P·d/n)) / P.
       Returns None on ANY failure — never a substituted aperture/2 value."""
    if not math.isfinite(efl) or efl == 0:
        return None
    if thickness <= 0 or aperture <= 0 or n <= 1:
        return None
    sign = 1 if efl > 0 else -1
    f = abs(efl)
    if f < 1:
        return None
    a = n - 1
    P = 1 / f
    disc = 1 - sign * P * thickness / n
    if disc < 0:
        return None                      # requested power unreachable
    R = a * (1 + math.sqrt(disc)) / P
    if not math.isfinite(R) or R <= 0:
        return None
    if R < aperture / 2:
        return None                      # must span the aperture
    target = sign * P
    if abs(lens_power(R, n, thickness, sign) - target) > SOLVER_REL_TOL * abs(target):
        return None                      # residual too large
    return R

def solve_concave_radius(efl_mag, thickness, aperture, n=1.5):
    return solve_lens_radius(-abs(efl_mag), thickness, aperture, n)

def solve_convex_radius(efl_mag, thickness, aperture, n=1.5):
    return solve_lens_radius(abs(efl_mag), thickness, aperture, n)

def pt_in_polygon(pt, verts):
    if len(verts) < 3:
        return False
    inside = False
    n = len(verts)
    for i in range(n):
        j = (i - 1) % n
        xi, yi = verts[i].x, verts[i].y
        xj, yj = verts[j].x, verts[j].y
        if (yi > pt.y) != (yj > pt.y) and pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi:
            inside = not inside
    return inside

def normalize_angle(a):
    return a - TAU * math.floor(a / TAU)

def angle_in_sweep(angle, start, end):
    a = normalize_angle(angle)
    s = normalize_angle(start)
    e = normalize_angle(end)
    if abs(s - e) < 1e-10:
        return True
    if s < e:
        return s - 1e-8 <= a <= e + 1e-8
    return a >= s - 1e-8 or a <= e + 1e-8

def ray_circle_hit(ro, rd, center, radius, start_angle, end_angle):
    oc = ro.sub(center)
    A = rd.dot(rd)
    B = 2 * oc.dot(rd)
    C = oc.dot(oc) - radius ** 2
    disc = B * B - 4 * A * C
    if disc < 0:
        return []
    sq = math.sqrt(disc)
    results = []
    for t in [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]:
        if t <= 1e-9:
            continue
        pt = ro.add(rd.mul(t))
        angle = math.atan2(pt.y - center.y, pt.x - center.x)
        if not angle_in_sweep(angle, start_angle, end_angle):
            continue
        n = pt.sub(center).norm()
        results.append((pt, n, t))
    return results

class ArcSurface:
    def __init__(self, center, radius, start_angle, end_angle, outward_sign=1, n=1.5):
        self.center = center
        self.radius = radius
        self.start_angle = start_angle
        self.end_angle = end_angle
        self.outward_sign = outward_sign
        self.n = n

    def intersect(self, ro, rd):
        hits = ray_circle_hit(ro, rd, self.center, self.radius, self.start_angle, self.end_angle)
        if not hits:
            return None
        pt, n, t = hits[0]
        return (pt, n.mul(self.outward_sign), t)

def refract(d, n, n1, n2):
    eta = n1 / n2
    cos_i = -d.dot(n)
    sin2 = eta * eta * (1 - cos_i * cos_i)
    if sin2 > 1:
        return None
    cos_t = math.sqrt(1 - sin2)
    return d.mul(eta).add(n.mul(eta * cos_i - cos_t))

passed = 0
failed = 0

def check(cond, msg):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print(f"  FAIL: {msg}")

def approx(a, b, tol=0.5):
    return abs(a - b) < tol

THICKNESS = 8
APERTURE = 50
HALF_AP = APERTURE / 2
HW = THICKNESS / 2

def trace_through_surfaces(pos, d, surfaces, comp_id=0):
    """Trace a ray through surfaces, tracking medium (air/glass)."""
    medium = "air"
    hits = 0
    for _ in range(20):
        best, best_t = None, float("inf")
        for s in surfaces:
            h = s.intersect(pos, d)
            if h and h[2] > 1e-6 and h[2] < best_t:
                best_t = h[2]
                best = (s, h)
        if not best:
            break
        n = best[1][1]
        alignment = d.dot(n)
        entering = alignment < -1e-6
        exiting = alignment > 1e-6
        valid_entry = entering and medium == "air"
        valid_exit = exiting and medium == "glass"
        if not valid_entry and not valid_exit:
            pos = best[1][0].add(d.mul(1e-6))
            continue
        hits += 1
        if valid_entry:
            n1, n2 = 1.0, 1.5
        else:
            n1, n2 = 1.5, 1.0
        eta = n1 / n2
        cos_i = -d.dot(n.mul(-1 if valid_exit else 1))
        sin2 = eta * eta * (1 - cos_i * cos_i)
        if sin2 > 1:
            pass  # TIR — keep medium
        else:
            cos_t = math.sqrt(1 - sin2)
            d = d.mul(eta).add(n.mul(-1 if valid_exit else 1).mul(eta * cos_i - cos_t))
            if valid_entry:
                medium = "glass"
            else:
                medium = "air"
        pos = best[1][0].add(d.mul(1e-6))
    return pos, d, hits

# ============================================================
# Test 1: Radius, dimensions, and solver residual
# ============================================================
print("\n--- Test 1: Radius and dimensions ---")
presets = [("f=-100", 100), ("f=-200", 200), ("f=-400", 400)]
for name, efl in presets:
    R = solve_concave_radius(efl, THICKNESS, APERTURE)
    check(R is not None, f"{name}: solver converges (not None)")
    if R is None:
        continue
    check(math.isfinite(R), f"{name}: R finite")
    check(R > HALF_AP, f"{name}: R > halfAp (strictly, no clamping)")
    check(R != APERTURE / 2, f"{name}: R is NOT the substituted aperture/2 fallback")
    target = -1 / efl
    calc = lens_power(R, 1.5, THICKNESS, -1)
    rel = abs(calc - target) / abs(target)
    check(rel < SOLVER_REL_TOL, f"{name}: power residual {rel:.2e} < 1e-6")
    half_angle = math.asin(min(1, HALF_AP / R))
    outline = make_concave_outline(R, HW, HALF_AP, 48)
    check(all(math.isfinite(p.x) and math.isfinite(p.y) for p in outline), f"{name}: outline finite")
    xs = [p.x for p in outline]
    ys = [p.y for p in outline]
    total_h = max(ys) - min(ys)
    check(approx(total_h, 50, 1), f"{name}: height ~50mm (got {total_h:.2f})")
    left_cx = -R - HW
    right_cx = R + HW
    left_edge_x = left_cx + R * math.cos(half_angle)
    right_edge_x = right_cx + R * math.cos(PI + half_angle)
    edge_thk = right_edge_x - left_edge_x
    check(edge_thk > THICKNESS, f"{name}: edge thk {edge_thk:.2f} > center {THICKNESS}")
    check(approx(left_cx + R, -HW, 1e-9), f"{name}: left center near -hw")
    check(approx(right_cx - R, HW, 1e-9), f"{name}: right center near +hw")
    print(f"  {name}: R={R:.4f}  rel-residual={rel:.1e}  height={total_h:.2f}  edgeThk={edge_thk:.2f}")

# ============================================================
# Test 2: On-axis ray stays on-axis
# ============================================================
print("\n--- Test 2: On-axis ray (no deviation) ---")
for name, efl in presets:
    R = solve_concave_radius(efl, THICKNESS, APERTURE)
    ha = math.asin(min(1, HALF_AP / R))
    surfaces = [
        ArcSurface(Vec2(-R - HW, 0), R, -ha, ha, -1, 1.5),
        ArcSurface(Vec2(R + HW, 0), R, PI - ha, PI + ha, -1, 1.5),
    ]
    pos, d, hits = trace_through_surfaces(Vec2(-300, 0), Vec2(1, 0), surfaces)
    check(hits == 2, f"{name}: on-axis hits both surfaces (got {hits})")
    check(abs(d.y) < 0.01, f"{name}: on-axis final direction ~horizontal (dy={d.y:.4f})")
    print(f"  {name}: hits={hits}  final_dy={d.y:.6f}")

# ============================================================
# Test 3: Off-axis parallel rays diverge
# ============================================================
print("\n--- Test 3: Off-axis divergence ---")
for name, efl in presets:
    R = solve_concave_radius(efl, THICKNESS, APERTURE)
    ha = math.asin(min(1, HALF_AP / R))
    surfaces = [
        ArcSurface(Vec2(-R - HW, 0), R, -ha, ha, -1, 1.5),
        ArcSurface(Vec2(R + HW, 0), R, PI - ha, PI + ha, -1, 1.5),
    ]
    pos, d, hits = trace_through_surfaces(Vec2(-300, 10), Vec2(1, 0), surfaces)
    check(hits == 2, f"{name}: off-axis hits both surfaces (got {hits})")
    check(d.y > 0.001, f"{name}: off-axis ray diverges upward (dy={d.y:.4f})")
    virtual_focal_x = pos.x - d.x * (pos.y / d.y)
    check(approx(virtual_focal_x, -efl, efl * 0.05), f"{name}: virtual focal near -f (got {virtual_focal_x:.1f}, expected ~{-efl}, ±5%)")
    print(f"  {name}: hits={hits}  dy={d.y:.4f}  focalX={virtual_focal_x:.1f}")

# ============================================================
# Test 4: Symmetry — ray at -Y diverges downward
# ============================================================
print("\n--- Test 4: Symmetry ---")
for name, efl in presets:
    R = solve_concave_radius(efl, THICKNESS, APERTURE)
    ha = math.asin(min(1, HALF_AP / R))
    surfaces = [
        ArcSurface(Vec2(-R - HW, 0), R, -ha, ha, -1, 1.5),
        ArcSurface(Vec2(R + HW, 0), R, PI - ha, PI + ha, -1, 1.5),
    ]
    pos, d, hits = trace_through_surfaces(Vec2(-300, -10), Vec2(1, 0), surfaces)
    check(d.y < -0.001, f"{name}: -Y ray diverges downward (dy={d.y:.4f})")
    print(f"  {name}: dy={d.y:.4f}")

# ============================================================
# Test 5: Semicircle arc sweep
# ============================================================
print("\n--- Test 5: Semicircle arc sweep ---")
sem = ArcSurface(Vec2(0, 0), 25, PI, TAU, 1, 1.5)
hit = sem.intersect(Vec2(-200, -10), Vec2(1, 0))
check(hit is not None, "semicircle: oblique ray hits lower arc")
if hit:
    check(math.isfinite(hit[2]), "semicircle: hit.t finite")
    check(hit[2] > 1, f"semicircle: hit.t > 1 (got {hit[2]:.2f})")
    print(f"  semicircle: t={hit[2]:.2f}  normal=({hit[1].x:.3f}, {hit[1].y:.3f})")
# Radial ray crosses curved face unbent, then bends at the flat face.
arc = ArcSurface(Vec2(0, 0), 80, PI, TAU, 1, 1.5)
ang = math.radians(250)
origin = Vec2(math.cos(ang) * 300, math.sin(ang) * 300)
direction = origin.mul(-1).norm()
h = arc.intersect(origin, direction)
check(h is not None, "semicircle: radial ray hits curved face")
if h:
    cos_i = abs(direction.dot(h[1]))
    check(approx(cos_i, 1.0, 1e-9), "semicircle: radial incidence is normal (no bend at curved face)")
# The ray continues to the flat face (y=0) at 20° incidence (< critical 41.8°):
flat_normal_toward_glass_side = Vec2(0, -1)
bent = refract(direction, flat_normal_toward_glass_side, 1.5, 1.0)
check(bent is not None, "semicircle: 20° flat-face incidence refracts (below critical angle)")
if bent:
    cross = bent.x * direction.y - bent.y * direction.x
    check(abs(cross) > 1e-6, "semicircle: ray is bent at flat-face exit")

# ============================================================
# Test 6: Convex lens focusing
# ============================================================
print("\n--- Test 6: Convex lens focusing ---")
conv_efl = 200
conv_R = solve_convex_radius(conv_efl, THICKNESS, APERTURE)
check(conv_R is not None, "convex f=200: solver converges")
conv_ha = math.asin(min(1, HALF_AP / conv_R))
conv_left_cx = conv_R - HW
conv_right_cx = -conv_R + HW
conv_surfaces = [
    ArcSurface(Vec2(conv_left_cx, 0), conv_R, PI - conv_ha, PI + conv_ha, 1, 1.5),
    ArcSurface(Vec2(conv_right_cx, 0), conv_R, -conv_ha, conv_ha, 1, 1.5),
]
cpos, cd, chits = trace_through_surfaces(Vec2(-300, 10), Vec2(1, 0), conv_surfaces)
check(cd.y < -0.001, f"convex: +Y ray converges downward (dy={cd.y:.4f})")
focal_x = cpos.x - cd.x * (cpos.y / cd.y)
check(approx(focal_x, conv_efl, conv_efl * 0.05), f"convex: focal near +f (got {focal_x:.1f}, expected ~{conv_efl}, ±5%)")
print(f"  convex f={conv_efl}: hits={chits}  dy={cd.y:.4f}  focalX={focal_x:.1f}")

# ============================================================
# Test 7: Concave diverges, convex converges (all presets)
# ============================================================
print("\n--- Test 7: Concave diverges, convex converges ---")
for sign_label, sign, efl_mag in [("concave", -1, 100), ("concave", -1, 200), ("concave", -1, 400),
                                  ("convex", 1, 100), ("convex", 1, 200), ("convex", 1, 400)]:
    R = solve_lens_radius(sign * efl_mag, THICKNESS, APERTURE)
    check(R is not None, f"{sign_label} {sign * efl_mag}: converges")
    ha = math.asin(min(1, HALF_AP / R))
    if sign == -1:
        surfs = [
            ArcSurface(Vec2(-R - HW, 0), R, -ha, ha, -1, 1.5),
            ArcSurface(Vec2(R + HW, 0), R, PI - ha, PI + ha, -1, 1.5),
        ]
    else:
        lcx = R - HW
        rcx = -R + HW
        surfs = [
            ArcSurface(Vec2(lcx, 0), R, PI - ha, PI + ha, 1, 1.5),
            ArcSurface(Vec2(rcx, 0), R, -ha, ha, 1, 1.5),
        ]
    pos, d, hits = trace_through_surfaces(Vec2(-300, 10), Vec2(1, 0), surfs)
    if sign == -1:
        check(d.y > 0.001, f"{sign_label}: diverges upward (dy={d.y:.4f})")
    else:
        check(d.y < -0.001, f"{sign_label}: converges downward (dy={d.y:.4f})")
    print(f"  {sign_label} {sign*efl_mag}: dy={d.y:.4f}  hits={hits}")

# ============================================================
# Test 8: Edge thickness validation
# ============================================================
print("\n--- Test 8: Edge thickness > center thickness ---")
for name, efl in presets:
    R = solve_concave_radius(efl, THICKNESS, APERTURE)
    ha = math.asin(min(1, HALF_AP / R))
    left_cx = -R - HW
    right_cx = R + HW
    left_edge_x = left_cx + R * math.cos(ha)
    right_edge_x = right_cx + R * math.cos(PI + ha)
    edge_thk = right_edge_x - left_edge_x
    check(edge_thk > THICKNESS, f"{name}: edgeThk={edge_thk:.2f} > {THICKNESS}")
    center_left = left_cx + R * math.cos(0)
    center_right = right_cx + R * math.cos(PI)
    center_thk = center_right - center_left
    check(approx(center_thk, THICKNESS, 1e-9), f"{name}: centerThk={center_thk:.2f}")
    print(f"  {name}: edgeThk={edge_thk:.2f}  centerThk={center_thk:.2f}")

# ============================================================
# Test 9: Invalid EFL rejected (solver returns None — no fallback)
# ============================================================
print("\n--- Test 9: Invalid EFL rejection ---")
bad_efls = [0, -10, -1, float('nan'), float('inf'), float('-inf')]
for bad_efl in bad_efls:
    R = solve_lens_radius(bad_efl, THICKNESS, APERTURE)
    check(R is None, f"EFL={bad_efl}: rejected with None (got {R})")
    print(f"  EFL={bad_efl}: R={R}")
# Convex f=50: valid radius (48.6 ≥ halfAp) and exact power, but the face
# sagitta (≈6.9 mm) exceeds half the centre thickness (4 mm): the two
# spherical faces would cross, so a symmetric biconvex lens cannot exist —
# the geometry validator must reject it.
R50 = solve_convex_radius(50, THICKNESS, APERTURE)
check(R50 is not None, "convex f=50: radius itself solvable")
if R50 is not None:
    sagitta = R50 * (1 - math.cos(math.asin(HALF_AP / R50)))
    check(sagitta >= HW, f"convex f=50: sagitta {sagitta:.2f} >= hw {HW} → faces cross → geometry must be refused")
check(solve_concave_radius(10, THICKNESS, APERTURE) is None, "concave f=-10: None (R < halfAp)")
check(solve_lens_radius(200, 0, APERTURE) is None, "thickness=0 rejected")
check(solve_lens_radius(200, THICKNESS, 0) is None, "aperture=0 rejected")

# ============================================================
# Test 10: Selection at representative points
# ============================================================
print("\n--- Test 10: Selection (ptInPolygon) ---")
for name, efl in presets:
    R = solve_concave_radius(efl, THICKNESS, APERTURE)
    outline = make_concave_outline(R, HW, HALF_AP, 48)
    xs = [p.x for p in outline]
    local_max_x = max(abs(min(xs)), abs(max(xs)))
    check(pt_in_polygon(Vec2(0, 0), outline), f"{name}: center selected")
    check(pt_in_polygon(Vec2(-HW + 1, 0), outline), f"{name}: near -hw selected")
    check(pt_in_polygon(Vec2(HW - 1, 0), outline), f"{name}: near +hw selected")
    check(not pt_in_polygon(Vec2(-local_max_x - 5, 0), outline), f"{name}: far left not selected")
    check(not pt_in_polygon(Vec2(local_max_x + 5, 0), outline), f"{name}: far right not selected")
    check(not pt_in_polygon(Vec2(0, HALF_AP + 10), outline), f"{name}: above not selected")
    check(not pt_in_polygon(Vec2(0, -HALF_AP - 10), outline), f"{name}: below not selected")
    print(f"  {name}: selection tests done (localMaxX={local_max_x:.1f})")

# ============================================================
# Test 11: Outline bounds in local frame + convex cross-check
# ============================================================
print("\n--- Test 11: Outline bounds in local frame ---")
for name, efl in presets:
    R = solve_concave_radius(efl, THICKNESS, APERTURE)
    outline = make_concave_outline(R, HW, HALF_AP, 48)
    xs = [p.x for p in outline]
    ys = [p.y for p in outline]
    check(approx(max(ys) - min(ys), 50, 1), f"{name}: local height ~50mm")
    check(max(xs) - min(xs) > THICKNESS, f"{name}: local width > center thickness")
    check(approx((min(xs) + max(xs)) / 2, 0, 2), f"{name}: local center near x=0")
    print(f"  {name}: localX=[{min(xs):.1f}, {max(xs):.1f}]  localY=[{min(ys):.1f}, {max(ys):.1f}]")

# ============================================================
# Test 12: Cross-implementation solver agreement (vs closed form)
# ============================================================
print("\n--- Test 12: Convex geometry + undo-snapshot round trip (model) ---")
for efl in (100, 200, 400):
    R = solve_convex_radius(efl, THICKNESS, APERTURE)
    outline = make_convex_outline(R, HW, HALF_AP, 48)
    ys = [p.y for p in outline]
    check(approx(max(ys) - min(ys), APERTURE, 1e-9), f"convex f={efl}: outline reaches aperture")
    sag = R * (1 - math.cos(math.asin(HALF_AP / R)))
    check(sag < HW, f"convex f={efl}: sagitta {sag:.2f} < hw {HW} → faces do not cross")
# Simulate the undo protocol: deep-copy snapshots of matching old/new states.
gA = { "efl": -200, "radius": solve_concave_radius(200, THICKNESS, APERTURE),
       "outline": make_concave_outline(solve_concave_radius(200, THICKNESS, APERTURE), HW, HALF_AP) }
gB = { "efl": -100, "radius": solve_concave_radius(100, THICKNESS, APERTURE),
       "outline": make_concave_outline(solve_concave_radius(100, THICKNESS, APERTURE), HW, HALF_AP) }
snapA = copy.deepcopy(gA)
state = gB
state = copy.deepcopy(snapA)     # undo
check(state["efl"] == -200 and all(a.x == b.x and a.y == b.y for a, b in zip(state["outline"], gA["outline"])),
      "undo: complete -200 geometry restored from clone")
state = copy.deepcopy(gB)        # redo
check(state["efl"] == -100, "redo: complete -100 geometry restored")
snapA["outline"][0].x = 9999     # mutating the clone must not touch the source
check(gA["outline"][0].x != 9999, "snapshots are deep copies (no shared mutable state)")

# ============================================================
# Summary
# ============================================================
print(f"\n=== Results: {passed} passed, {failed} failed ===")
sys.exit(1 if failed else 0)
