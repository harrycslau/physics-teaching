(function (global) {
  'use strict';

  const T_MIN = -20;
  const T_MAX = 110;
  const T_SPAN = T_MAX - T_MIN;
  const AMBIENT = 22;
  const WATER_CAP = 150;
  const TAP_TEMP = 17;

  const GEOM = {
    scene: { w: 1160, h: 700, benchY: 610 },
    beaker: { w: 185, h: 215 },
    plate: { w: 235, h: 26 },
    jug: { w: 76, h: 112 },
    bucket: { w: 150, h: 104 },
    rod: { len: 150, thick: 9 },
    thermo: { stemH: 150 }
  };

  const LAYOUT = {
    beakers: [
      { id: 'A', x: 150 },
      { id: 'B', x: 455 }
    ],
    hotplateX: 330,
    jug: { x: 790, y: 498 },
    bucket: { x: 960, y: 506 },
    rod: { x: 680, y: 596 },
    thermo: { x: 70, y: 430 }
  };

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  class CalibrationSim {
    constructor() {
      this.reset();
    }

    reset() {
      this.time = 0;
      this.ambient = AMBIENT;
      this.beakers = LAYOUT.beakers.map((b) => ({
        id: b.id,
        x: b.x,
        water: 0,
        temp: AMBIENT,
        stir: 0,
        mix: 0,
        boiling: false,
        heated: false,
        _lift: 0
      }));
      this.hotplate = { x: LAYOUT.hotplateX, on: false, targetId: null };
      this.jug = { x: LAYOUT.jug.x, y: LAYOUT.jug.y };
      this.bucket = { x: LAYOUT.bucket.x, y: LAYOUT.bucket.y };
      this.rod = { x: LAYOUT.rod.x, y: LAYOUT.rod.y };
      this.thermo = {
        x: LAYOUT.thermo.x,
        y: LAYOUT.thermo.y,
        bulb: AMBIENT,
        dBulb: 0,
        steadyFor: 0,
        stabilized: false,
        inBeakerId: null
      };
      this.cubes = [];
      this.marks = [];
      this.seq = 0;
    }

    fracOfTemp(t) {
      return clamp((t - T_MIN) / T_SPAN, 0, 1);
    }

    tempOfFrac(f) {
      return f * T_SPAN + T_MIN;
    }

    spawnCube(x, y) {
      const cube = {
        id: ++this.seq,
        x,
        y,
        size: 26 + ((this.seq * 29) % 9),
        temp: -16,
        phase: (this.seq * 1.7) % 6.28,
        beaker: null
      };
      this.cubes.push(cube);
      return cube;
    }

    dropCube(cube, x, y) {
      cube.x = x;
      cube.y = y;
      cube.beaker = null;
      for (const b of this.beakers) {
        if (x > b.x && x < b.x + GEOM.beaker.w && y > GEOM.scene.benchY - GEOM.beaker.h - 30 && y <= GEOM.scene.benchY + 8) {
          cube.beaker = b.id;
          cube.x = clamp(x, b.x + 20, b.x + GEOM.beaker.w - 20);
          break;
        }
      }
      return cube.beaker !== null;
    }

    removeCube(id) {
      this.cubes = this.cubes.filter((c) => c.id !== id);
    }

    findBeakerAt(x, yTop, yBottom) {
      for (const b of this.beakers) {
        if (x > b.x && x < b.x + GEOM.beaker.w && yBottom > GEOM.scene.benchY - GEOM.beaker.h && yTop < GEOM.scene.benchY) {
          return b;
        }
      }
      return null;
    }

    pour(x, y, amount) {
      const mouth = this.findMouthAt(x, y);
      if (!mouth) return false;
      if (mouth.water >= WATER_CAP) return true;
      const add = Math.min(amount, WATER_CAP - mouth.water);
      const nw = mouth.water + add;
      if (mouth.water <= 4) {
        let iceCold = false;
        for (const c of this.cubes) {
          if (c.beaker === mouth.id && c.temp < 4) iceCold = true;
        }
        mouth.temp = iceCold ? Math.min(mouth.temp, 6) : TAP_TEMP;
        if (iceCold) mouth.temp = TAP_TEMP * 0.35 + mouth.temp * 0.65;
      } else {
        mouth.temp = (mouth.temp * mouth.water + TAP_TEMP * add) / nw;
      }
      mouth.water = nw;
      return true;
    }

    findMouthAt(x, y) {
      for (const b of this.beakers) {
        const top = GEOM.scene.benchY - GEOM.beaker.h;
        if (x > b.x + 6 && x < b.x + GEOM.beaker.w - 6 && y > top - 170 && y < top + 110) return b;
      }
      return null;
    }

    stir(x, y, amount) {
      const b = this.findBeakerAt(x, y, y);
      if (b && b.water > 2) b.stir = Math.min(1, b.stir + amount);
    }

    toggleHotplate() {
      this.hotplate.on = !this.hotplate.on;
      return this.hotplate.on;
    }

    addMark(fracV) {
      const mark = { id: ++this.seq, frac: clamp(fracV, 0, 1), type: 'fixed' };
      this.marks.push(mark);
      return mark;
    }

    eraseNear(fracV, tol) {
      const tolerance = tol == null ? 0.02 : tol;
      let best = null;
      let bestD = Infinity;
      for (const m of this.marks) {
        const d = Math.abs(m.frac - fracV);
        if (d < bestD) {
          bestD = d;
          best = m;
        }
      }
      if (best && bestD <= tolerance) {
        this.marks = this.marks.filter((m) => m.id !== best.id);
        return best;
      }
      return null;
    }

    fixedSorted() {
      return this.marks
        .filter((m) => m.type === 'fixed')
        .sort((a, b) => a.frac - b.frac);
    }

    divideSpan() {
      const fx = this.fixedSorted();
      if (fx.length < 2) return 0;
      const a = fx[0].frac;
      const bFx = fx[fx.length - 1].frac;
      if (bFx - a < 0.05) return 0;
      this.marks = this.marks.filter(
        (m) => !(m.type === 'div' && m.frac > a && m.frac < bFx)
      );
      for (let i = 1; i <= 9; i++) {
        this.marks.push({
          id: ++this.seq,
          frac: a + ((bFx - a) * i) / 10,
          type: 'div'
        });
      }
      return 10;
    }

    checkCalibration() {
      const res = { complete: false, lower: null, upper: null, interval: null, lowMark: null, highMark: null };
      const fx = this.fixedSorted();
      if (fx.length < 2) return res;
      const lo = fx[0];
      const hi = fx[fx.length - 1];
      const tLo = this.tempOfFrac(lo.frac);
      const tHi = this.tempOfFrac(hi.frac);
      res.lowMark = lo;
      res.highMark = hi;
      res.lower = tLo;
      res.upper = tHi;
      res.interval = tHi - tLo;
      if (Math.abs(tLo) > 3.5) return res;
      if (Math.abs(tHi - 100) > 5) return res;
      if (tHi <= tLo) return res;
      const span = hi.frac - lo.frac;
      const stepI = span / 10;
      const divs = this.marks.filter(
        (m) => m.type === 'div' &&
          m.frac > lo.frac + stepI * 0.3 &&
          m.frac < hi.frac - stepI * 0.3
      );
      if (divs.length < 9) return res;
      let ok = true;
      for (let i = 1; i <= 9; i++) {
        const expect = lo.frac + span * (i / 10);
        let near = false;
        for (const d of divs) {
          if (Math.abs(d.frac - expect) <= stepI * 0.14) {
            near = true;
            break;
          }
        }
        if (!near) {
          ok = false;
          break;
        }
      }
      res.complete = ok;
      return res;
    }

    _bulbMedium() {
      const th = this.thermo;
      const bulbCx = th.x;
      const bulbCy = th.y + GEOM.thermo.stemH + 18;
      const b = this.findBeakerAt(bulbCx, bulbCy - 40, bulbCy + 6);
      th.inBeakerId = b ? b.id : null;
      if (!b) return { t: this.ambient, noisy: false };

      const cubesIn = this.cubes.filter((c) => c.beaker === b.id);

      if (cubesIn.length > 0 && b.water <= 4) {
        let sum = 0;
        for (const c of cubesIn) sum += c.temp;
        const avg = sum / cubesIn.length;
        const wobble =
          Math.sin(this.time * 0.9 + cubesIn[0].phase) * 1.1 +
          Math.sin(this.time * 2.3) * 0.5;
        return { t: avg + wobble, noisy: true };
      }

      let medium = b.temp;
      if (cubesIn.length > 0) {
        const bias = (1 - b.mix) * 3.4;
        medium += bias + Math.sin(this.time * 0.7) * 0.5 * (1 - b.mix);
      }
      return { t: medium, noisy: false };
    }

    step(dt) {
      this.time += dt;
      const hp = this.hotplate;

      let targetId = null;
      let bestD = Infinity;
      const plateCx = hp.x + GEOM.plate.w / 2;
      for (const b of this.beakers) {
        const d = Math.abs(b.x + GEOM.beaker.w / 2 - plateCx);
        if (d < 110 && d < bestD) {
          bestD = d;
          targetId = b.id;
        }
      }
      hp.targetId = targetId;

      for (const b of this.beakers) {
        b.heated = hp.targetId === b.id && hp.on;
        b.stir = Math.max(0, b.stir - 0.1 * dt);
        b.mix += (b.stir - b.mix) * Math.min(1, 0.4 * dt);
        b.boiling = false;

        const cubesIn = this.cubes.filter((c) => c.beaker === b.id);
        const wet = b.water > 4 && cubesIn.length > 0;

        if (wet) {
          let meltRate = 0.35 + b.stir * 1.4 + Math.max(0, b.temp) * 0.05 + (b.heated ? 4 : 0);
          const meltTotal = meltRate * dt;
          const perCube = meltTotal / cubesIn.length;
          let gained = 0;
          for (const c of cubesIn) {
            const take = Math.min(c.size, perCube);
            c.size -= take;
            gained += take * 0.32;
            c.temp += (0 - c.temp) * Math.min(1, 0.9 * dt);
          }
          b.water = Math.min(WATER_CAP, b.water + gained);
          const rt = b.heated ? 0.09 : 0.05 + 0.75 * b.mix;
          b.temp += (0 - b.temp) * rt * dt;
          if (b.heated) b.temp += 0.11 * dt;
        } else if (b.water > 4) {
          if (b.heated) {
            const power = 340 / (60 + b.water * 1.6);
            b.temp = Math.min(100, b.temp + power * dt);
            if (b.temp >= 99.5) {
              b.boiling = true;
              b.water = Math.max(0, b.water - 0.4 * dt);
            }
            if (b.water <= 2) b.boiling = false;
          } else {
            b.temp += (this.ambient - b.temp) * 0.02 * dt;
          }
        } else {
          if (b.heated && b.water > 0.5) {
            b.temp = Math.min(130, b.temp + 0.8 * dt);
          } else {
            b.temp += (this.ambient - b.temp) * 0.05 * dt;
          }
        }
      }

      const dead = [];
      for (const c of this.cubes) {
        const host = c.beaker ? this.beakers.find((b) => b.id === c.beaker) : null;
        const dry = !host || host.water <= 4;
        if (dry) {
          c.temp += (this.ambient - c.temp) * (host ? 0.008 : 0.02) * dt;
          if (!host) c.size = Math.max(0, c.size - 0.025 * dt);
        }
        if (host && host.water > 4) {
          c.x = clamp(c.x, host.x + 22, host.x + GEOM.beaker.w - 22);
        }
        if (c.size <= 0.5) dead.push(c.id);
      }
      if (dead.length) this.cubes = this.cubes.filter((c) => !dead.includes(c.id));

      const med = this._bulbMedium();
      const th = this.thermo;
      const prev = th.bulb;
      th.bulb += (med.t - th.bulb) * Math.min(1, 0.33 * dt);
      th.dBulb = (th.bulb - prev) / Math.max(dt, 1e-6);
      const settled = Math.abs(th.dBulb) < 0.06 && Math.abs(med.t - th.bulb) < 0.6 && !med.noisy;
      th.steadyFor = settled ? th.steadyFor + dt : 0;
      th.stabilized = th.steadyFor > 1.6;
    }
  }

  CalibrationSim.GEOM = GEOM;
  CalibrationSim.LAYOUT = LAYOUT;
  CalibrationSim.CONST = { T_MIN, T_MAX, WATER_CAP, AMBIENT };

  global.CalibrationSim = CalibrationSim;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CalibrationSim;
  }
})(typeof window !== 'undefined' ? window : globalThis);
