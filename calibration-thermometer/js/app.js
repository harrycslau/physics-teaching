(function () {
  'use strict';

  const SimNS = window.CalibrationSim;
  const GEOM = SimNS.GEOM;
  const LAYOUT = SimNS.LAYOUT;
  const CONST = SimNS.CONST;

  const SCENE_W = GEOM.scene.w;
  const BENCH_Y = GEOM.scene.benchY;
  const BK = GEOM.beaker;
  const PLATE_Y = BENCH_Y - GEOM.plate.h;
  const BEAKER_TOP = BENCH_Y - BK.h;
  const WATER_MAX_H = BK.h - 28;

  const CU = {
    cx: 105,
    topY: 44,
    botY: 462,
    colHalf: 7,
    tickHalf: 20
  };
  CU.span = CU.botY - CU.topY;

  const HINTS = [
    'You need two reproducible reference temperatures.',
    'Think about temperatures associated with changes of state of water.',
    'An ice-water mixture and boiling water can provide useful fixed points.'
  ];

  const svg = document.getElementById('bench');
  const closeSvg = document.getElementById('closeup');
  const summaryCard = document.getElementById('summary-card');
  const summaryText = document.getElementById('summary-text');
  const summaryDetail = document.getElementById('summary-detail');
  const summaryClose = document.getElementById('summary-close');
  const hintBox = document.getElementById('hint-box');
  const hintBtn = document.getElementById('btn-hint');
  const resetBtn = document.getElementById('btn-reset');
  const divideBtn = document.getElementById('btn-divide');
  const steadyDot = document.getElementById('steady-dot');
  const steadyLabel = document.getElementById('steady-label');

  const sim = new SimNS();
  const ui = {
    tool: 'pen',
    pointer: { x: 0, y: 0 },
    lastTip: null,
    carriedCubeId: null,
    pourActive: false,
    swirlAngle: 0,
    done: false,
    hintStep: 0,
    bubbles: [],
    steam: [],
    bubbleAccum: 0,
    marksSig: '',
    marksCountCache: -1
  };

  let grab = null;
  let mainLayer;
  const beakerViews = {};
  let cubeLayer, steamLayer, jugStreamNode, jugGroup, plateGroup, plateCoil;
  let sceneThermo, sceneColumn;
  let columnNode, marksLayer, numbersLayer;
  const cubeNodes = new Map();

  const SVGNS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, parent) {
    const node = document.createElementNS(SVGNS, tag);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(node);
    return node;
  }

  function toLocal(svgRoot, evt) {
    const pt = svgRoot.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const m = svgRoot.getScreenCTM();
    if (!m) return { x: evt.clientX, y: evt.clientY };
    return pt.matrixTransform(m.inverse());
  }

  function roundRect(x, y, w, h, r) {
    return (
      'M' + (x + r) + ',' + y +
      ' h' + (w - 2 * r) +
      ' a' + r + ',' + r + ' 0 0 1 ' + r + ',' + r +
      ' v' + (h - 2 * r) +
      ' a' + r + ',' + r + ' 0 0 1 ' + (-r) + ',' + r +
      ' h' + (-(w - 2 * r)) +
      ' a' + r + ',' + r + ' 0 0 1 ' + (-r) + ',' + (-r) +
      ' v' + (-(h - 2 * r)) +
      ' a' + r + ',' + r + ' 0 0 1 ' + r + ',' + (-r) + ' z'
    );
  }

  function setXY(g, x, y) {
    g.setAttribute('transform', 'translate(' + x + ',' + y + ')');
  }

  function waterSurfaceY(b) {
    return BENCH_Y - 14 - Math.min(1, b.water / CONST.WATER_CAP) * WATER_MAX_H;
  }

  function fracToY(f) {
    return CU.botY - f * CU.span;
  }

  function tipOfRod() {
    const ang = (-28 * Math.PI) / 180;
    return {
      x: sim.rod.x + Math.cos(ang) * (GEOM.rod.len / 2 - 4),
      y: sim.rod.y + Math.sin(ang) * (GEOM.rod.len / 2 - 4)
    };
  }

  function buildDefs(root) {
    const defs = el('defs', {}, root);
    const glass = el('linearGradient', { id: 'gGlass', x1: '0', y1: '0', x2: '1', y2: '0' }, defs);
    el('stop', { offset: '0%', 'stop-color': '#cfe3ea', 'stop-opacity': '0.55' }, glass);
    el('stop', { offset: '40%', 'stop-color': '#f0f8fb', 'stop-opacity': '0.35' }, glass);
    el('stop', { offset: '100%', 'stop-color': '#a9c9d4', 'stop-opacity': '0.65' }, glass);
    const liq = el('linearGradient', { id: 'gLiquid', x1: '0', y1: '0', x2: '0', y2: '1' }, defs);
    el('stop', { offset: '0%', 'stop-color': '#f0685c' }, liq);
    el('stop', { offset: '100%', 'stop-color': '#c1271b' }, liq);
    const met = el('linearGradient', { id: 'gMetal', x1: '0', y1: '0', x2: '0', y2: '1' }, defs);
    el('stop', { offset: '0%', 'stop-color': '#e8edf1' }, met);
    el('stop', { offset: '100%', 'stop-color': '#9aa7b1' }, met);
    const plast = el('linearGradient', { id: 'gPlastic', x1: '0', y1: '0', x2: '1', y2: '0' }, defs);
    el('stop', { offset: '0%', 'stop-color': '#dfe9ee' }, plast);
    el('stop', { offset: '50%', 'stop-color': '#f4fafc' }, plast);
    el('stop', { offset: '100%', 'stop-color': '#ccdbe2' }, plast);
    for (const b of LAYOUT.beakers) {
      const cp = el('clipPath', { id: 'clip-' + b.id }, defs);
      el('rect', { x: 0, y: BEAKER_TOP + 8, width: BK.w - 16, height: BK.h - 22 }, cp);
    }
  }

  function buildStatic(root) {
    el('rect', { x: 0, y: 0, width: SCENE_W, height: BENCH_Y, fill: '#f4f9fb' }, root);
    const grid = el('g', {}, root);
    for (let gx = 0; gx <= SCENE_W; gx += 58) {
      el('line', { x1: gx, y1: 0, x2: gx, y2: BENCH_Y, stroke: '#eaf2f6', 'stroke-width': 1 }, grid);
    }
    for (let gy = 20; gy < BENCH_Y; gy += 58) {
      el('line', { x1: 0, y1: gy, x2: SCENE_W, y2: gy, stroke: '#eaf2f6', 'stroke-width': 1 }, grid);
    }
    el('rect', { x: 0, y: BENCH_Y, width: SCENE_W, height: 90, fill: '#cbb68d' }, root);
    el('rect', { x: 0, y: BENCH_Y, width: SCENE_W, height: 8, fill: '#dccba5' }, root);
    mainLayer = el('g', {}, root);
  }

  function buildPlate(parent) {
    plateGroup = el('g', {
      class: 'draggable',
      'data-drag': 'plate',
      tabindex: '0',
      role: 'slider',
      'aria-label': 'Hot plate. Slide along the bench with arrow keys; Enter toggles power.'
    }, parent);
    el('rect', {
      x: 0, y: PLATE_Y, width: GEOM.plate.w, height: GEOM.plate.h, rx: 6,
      fill: 'url(#gMetal)', stroke: '#7d8b95', 'stroke-width': 2
    }, plateGroup);
    el('rect', {
      x: 12, y: PLATE_Y + 5, width: GEOM.plate.w - 72, height: 9, rx: 4, fill: '#3a3f45'
    }, plateGroup);
    el('rect', {
      x: 0, y: PLATE_Y - 10, width: GEOM.plate.w, height: GEOM.plate.h + 20,
      fill: 'transparent', 'pointer-events': 'all'
    }, plateGroup);
    const swG = el('g', { 'data-switch': '1', cursor: 'pointer' }, plateGroup);
    el('title', {}, swG).textContent = 'Hot plate power switch';
    el('circle', {
      cx: GEOM.plate.w - 36, cy: PLATE_Y + GEOM.plate.h / 2, r: 11, fill: '#33404a'
    }, swG);
    plateCoil = el('circle', {
      cx: GEOM.plate.w - 36, cy: PLATE_Y + GEOM.plate.h / 2, r: 5, fill: '#78848d'
    }, swG);
    setXY(plateGroup, sim.hotplate.x, 0);
  }

  function buildBeaker(b, parent) {
    const g = el('g', {
      class: 'draggable',
      'data-drag': 'beaker:' + b.id,
      tabindex: '0',
      role: 'slider',
      'aria-label': 'Beaker ' + b.id + '. Slide along the bench with arrow keys.'
    }, parent);
    setXY(g, b.x, 0);

    el('ellipse', {
      cx: BK.w / 2, cy: BENCH_Y + 4, rx: BK.w / 2 + 8, ry: 7,
      fill: 'rgba(60,50,30,0.16)'
    }, g);

    el('path', {
      d: 'M7,' + (BEAKER_TOP + 4) + ' q-9,-7 -2,-14',
      stroke: '#b7ccd5', 'stroke-width': 4, fill: 'none', 'stroke-linecap': 'round'
    }, g);

    el('path', {
      d: roundRect(2, BEAKER_TOP, BK.w - 4, BK.h, 12),
      fill: 'url(#gGlass)', stroke: '#9fbecd', 'stroke-width': 3
    }, g);

    const waterG = el('g', { 'clip-path': 'url(#clip-' + b.id + ')' }, g);
    waterG.rect = el('rect', {
      x: 4, y: BENCH_Y - 14, width: BK.w - 8, height: 0,
      fill: 'rgba(120,190,225,0.5)'
    }, waterG);
    waterG.surface = el('ellipse', {
      cx: BK.w / 2 - 4, cy: BENCH_Y - 14, rx: (BK.w - 8) / 2, ry: 5,
      fill: 'rgba(160,215,240,0.75)'
    }, waterG);
    waterG.swirl = el('ellipse', {
      cx: BK.w / 2 - 4, ry: 13, rx: 44,
      fill: 'none', stroke: 'rgba(255,255,255,0.85)', 'stroke-width': 3,
      'stroke-dasharray': '36 56', opacity: 0
    }, waterG);
    waterG.bubbles = el('g', {}, waterG);

    el('path', {
      d: 'M18,' + (BEAKER_TOP + 34) + ' l-8,60',
      stroke: 'rgba(255,255,255,0.6)', 'stroke-width': 4, fill: 'none', 'stroke-linecap': 'round'
    }, g);

    el('text', {
      x: BK.w / 2, y: BEAKER_TOP - 10, 'text-anchor': 'middle',
      'font-size': 15, fill: '#7d93a2', 'font-weight': 700
    }, g).textContent = b.id;

    el('rect', {
      x: 0, y: BEAKER_TOP - 20, width: BK.w, height: BK.h + 28,
      fill: 'transparent', 'pointer-events': 'all'
    }, g);

    g.waterParts = waterG;
    return g;
  }

  function buildJug(parent) {
    jugStreamNode = el('path', {
      d: '', stroke: 'rgba(110,180,220,0.85)', 'stroke-width': 7, fill: 'none',
      'stroke-linecap': 'round', opacity: 0
    }, parent);
    jugGroup = el('g', {
      class: 'draggable',
      'data-drag': 'jug',
      tabindex: '0',
      role: 'application',
      'aria-label': 'Water jug. Drag it above a beaker opening to pour.'
    }, parent);
    el('title', {}, jugGroup).textContent = 'Water jug';
    const jw = GEOM.jug.w;
    const jh = GEOM.jug.h;
    el('path', {
      d: roundRect(0, 0, jw, jh, 10),
      fill: 'url(#gPlastic)', stroke: '#93aebb', 'stroke-width': 3
    }, jugGroup);
    el('rect', {
      x: 6, y: 14, width: jw - 12, height: jh - 34, rx: 7,
      fill: 'rgba(130,195,228,0.55)'
    }, jugGroup);
    el('path', {
      d: 'M' + jw + ',18 q16,-6 14,-17',
      stroke: '#9ab9c9', 'stroke-width': 5, fill: 'none', 'stroke-linecap': 'round'
    }, jugGroup);
    el('text', {
      x: jw / 2, y: jh / 2 + 5, 'text-anchor': 'middle',
      'font-size': 13, fill: '#31708f', 'font-weight': 700
    }, jugGroup).textContent = 'H₂O';
    el('rect', {
      x: -18, y: -18, width: jw + 50, height: jh + 40,
      fill: 'transparent', 'pointer-events': 'all'
    }, jugGroup);
    setXY(jugGroup, sim.jug.x, sim.jug.y);
  }

  function buildBucket(parent) {
    const bg = el('g', {
      class: 'draggable',
      'data-drag': 'ice',
      tabindex: '0',
      role: 'button',
      'aria-label': 'Ice bucket. Drag outward or press Enter to take an ice cube.'
    }, parent);
    el('title', {}, bg).textContent = 'Ice bucket';
    const bw = GEOM.bucket.w;
    const bh = GEOM.bucket.h;
    el('path', {
      d: 'M6,10 L' + (bw - 6) + ',10 L' + (bw - 22) + ',' + bh + ' L22,' + bh + ' Z',
      fill: 'url(#gPlastic)', stroke: '#9cb6c2', 'stroke-width': 3
    }, bg);
    el('ellipse', {
      cx: bw / 2, cy: 10, rx: bw / 2 - 6, ry: 9,
      fill: '#eef6f9', stroke: '#9cb6c2', 'stroke-width': 3
    }, bg);
    for (let i = 0; i < 5; i++) {
      const ix = 32 + ((i * 53) % 82);
      const iy = 15 + ((i * 31) % 16);
      el('rect', {
        x: ix, y: iy, width: 18, height: 16, rx: 4,
        transform: 'rotate(' + (i % 2 ? 14 : -12) + ' ' + (ix + 9) + ' ' + (iy + 8) + ')',
        fill: 'rgba(214,239,250,0.96)', stroke: '#9fd0e6'
      }, bg);
    }
    el('text', {
      x: bw / 2, y: bh - 10, 'text-anchor': 'middle',
      'font-size': 13, fill: '#41707f', 'font-weight': 700
    }, bg).textContent = 'ice';
    setXY(bg, sim.bucket.x, sim.bucket.y);
    return bg;
  }

  function buildRod(parent) {
    const rg = el('g', {
      class: 'draggable',
      'data-drag': 'rod',
      tabindex: '0',
      role: 'application',
      'aria-label': 'Stirring rod. Move it in circles inside a beaker to stir.'
    }, parent);
    el('title', {}, rg).textContent = 'Stirring rod';
    const L = GEOM.rod.len;
    const T = GEOM.rod.thick;
    el('rect', {
      x: -L / 2, y: -T / 2, width: L, height: T, rx: T / 2,
      transform: 'rotate(-28)',
      fill: 'url(#gGlass)', stroke: '#8fb2bf', 'stroke-width': 2
    }, rg);
    el('rect', {
      x: -L / 2 - 10, y: -T - 12, width: L + 20, height: T * 2 + 24,
      transform: 'rotate(-28)',
      fill: 'transparent', 'pointer-events': 'all'
    }, rg);
    setXY(rg, sim.rod.x, sim.rod.y);
    return rg;
  }

  function buildThermoScene(parent) {
    sceneThermo = el('g', {
      class: 'draggable',
      'data-drag': 'thermo',
      tabindex: '0',
      role: 'application',
      'aria-label': 'Unmarked thermometer. Drag it so the bulb dips into a beaker.'
    }, parent);
    el('title', {}, sceneThermo).textContent = 'Unmarked thermometer';
    const H = GEOM.thermo.stemH;
    el('rect', {
      x: -9, y: -8, width: 18, height: H + 8, rx: 8,
      fill: 'rgba(240,248,251,0.95)', stroke: '#94b7c4', 'stroke-width': 2.5
    }, sceneThermo);
    sceneColumn = el('rect', {
      x: -4, width: 8, rx: 4, fill: 'url(#gLiquid)'
    }, sceneThermo);
    el('circle', {
      cx: 0, cy: H + 18, r: 14,
      fill: 'url(#gLiquid)', stroke: '#94b7c4', 'stroke-width': 2.5
    }, sceneThermo);
    el('rect', {
      x: -24, y: -16, width: 48, height: H + 60,
      fill: 'transparent', 'pointer-events': 'all'
    }, sceneThermo);
    setXY(sceneThermo, sim.thermo.x, sim.thermo.y);
  }

  function buildCloseup() {
    const c = closeSvg;
    el('rect', { x: 0, y: 0, width: 210, height: 560, rx: 12, fill: '#fbfeff' }, c);
    el('circle', {
      cx: CU.cx, cy: 500, r: 34,
      fill: 'url(#gLiquid)', stroke: '#8fb4c1', 'stroke-width': 3
    }, c);
    el('rect', {
      x: CU.cx - 27, y: CU.topY - 18, width: 54, height: CU.span + 32, rx: 22,
      fill: 'rgba(240,249,252,0.94)', stroke: '#8fb4c1', 'stroke-width': 3
    }, c);
    columnNode = el('rect', {
      x: CU.cx - CU.colHalf, y: CU.botY, width: CU.colHalf * 2, fill: 'url(#gLiquid)'
    }, c);
    el('line', {
      x1: CU.cx - 3, y1: CU.topY - 8, x2: CU.cx - 3, y2: CU.botY,
      stroke: 'rgba(255,255,255,0.55)', 'stroke-width': 2
    }, c);
    marksLayer = el('g', {}, c);
    numbersLayer = el('g', {
      opacity: 0, 'font-size': 14, 'font-weight': 700, fill: '#1f2937',
      'text-anchor': 'start'
    }, c);
    const hit = el('rect', {
      x: 0, y: 0, width: 210, height: 560,
      fill: 'transparent', 'pointer-events': 'all', cursor: 'crosshair'
    }, c);
    hit.addEventListener('pointerdown', onCloseupDown);
  }

  function onCloseupDown(evt) {
    const p = toLocal(closeSvg, evt);
    if (p.y < CU.topY - 10 || p.y > CU.botY + 10) return;
    const frac = Math.min(1, Math.max(0, (CU.botY - p.y) / CU.span));
    if (ui.tool === 'pen') {
      sim.addMark(frac);
    } else {
      sim.eraseNear(frac, 0.022);
    }
    ui.marksSig = '';
    refreshMarks(true);
    evt.preventDefault();
  }

  function sortedMarksInSpan() {
    const res = sim.checkCalibration();
    if (!res.complete || !res.lowMark || !res.highMark) return [];
    return sim.marks
      .filter((m) => m.frac >= res.lowMark.frac - 1e-6 && m.frac <= res.highMark.frac + 1e-6)
      .sort((a, b) => a.frac - b.frac);
  }

  function refreshMarks(force) {
    const sig = sim.marks.map((m) => m.id).join(',') + '|' + String(ui.done);
    if (!force && sig === ui.marksSig) return;
    ui.marksSig = sig;

    while (marksLayer.firstChild) marksLayer.removeChild(marksLayer.firstChild);
    for (const m of sim.marks) {
      const y = fracToY(m.frac);
      el('line', {
        x1: CU.cx - CU.tickHalf - 3, y1: y,
        x2: CU.cx + CU.tickHalf + 3, y2: y,
        stroke: m.type === 'fixed' ? '#111827' : '#374151',
        'stroke-width': m.type === 'fixed' ? 4 : 2.5,
        'stroke-dasharray': m.type === 'fixed' ? 'none' : '5 4',
        'stroke-linecap': 'round'
      }, marksLayer);
      if (m.type === 'fixed') {
        el('circle', {
          cx: CU.cx + CU.tickHalf + 9, cy: y, r: 3.2, fill: '#111827'
        }, marksLayer);
      }
    }

    while (numbersLayer.firstChild) numbersLayer.removeChild(numbersLayer.firstChild);
    const ms = sortedMarksInSpan();
    const showNumbers = ui.done && ms.length === 11;
    numbersLayer.setAttribute('opacity', showNumbers ? 1 : 0);
    if (showNumbers) {
      ms.forEach((m, i) => {
        el('text', { x: CU.cx + CU.tickHalf + 17, y: fracToY(m.frac) + 5 }, numbersLayer)
          .textContent = String(i * 10);
      });
    }
  }

  function endGrab() {
    if (!grab) return;
    if (grab.key.indexOf('cube:') === 0) {
      const id = Number(grab.key.slice(5));
      const c = sim.cubes.find(function (k) { return k.id === id; });
      if (c && c.beaker === null) {
        sim.dropCube(c, c.x, c.y);
        c._vy = 0;
      }
      ui.carriedCubeId = null;
    }
    grab = null;
    ui.pourActive = false;
    ui.lastTip = null;
    document.body.style.cursor = '';
  }

  function bindPointer() {
    svg.addEventListener('pointerdown', function (evt) {
      const sw = evt.target.closest('[data-switch]');
      if (sw) {
        sim.toggleHotplate();
        evt.preventDefault();
        return;
      }
      const target = evt.target.closest('[data-drag]');
      if (!target) return;
      const key = target.getAttribute('data-drag');
      const local = toLocal(svg, evt);
      ui.pointer = local;

      if (key === 'ice') {
        const cube = sim.spawnCube(
          Math.max(sim.bucket.x - 70, 30),
          Math.min(local.y, 300)
        );
        cube._vy = 0;
        ui.carriedCubeId = cube.id;
        grab = { key: 'cube:' + cube.id, lastX: local.x };
      } else {
        grab = { key: key, lastX: local.x };
      }
      try { svg.setPointerCapture(evt.pointerId); } catch (e) { /* ignore */ }
      document.body.style.cursor = 'grabbing';
      evt.preventDefault();
    });

    svg.addEventListener('pointermove', function (evt) {
      const local = toLocal(svg, evt);
      ui.pointer = local;
      if (!grab) return;
      if (grab.key === 'beaker:A' || grab.key === 'beaker:B') {
        const id = grab.key.slice(7);
        const b = sim.beakers.find(function (k) { return k.id === id; });
        if (b) {
          b.x = Math.min(SCENE_W - BK.w - 14, Math.max(14, b.x + local.x - grab.lastX));
        }
        grab.lastX = local.x;
        return;
      }
      if (grab.key === 'plate') {
        sim.hotplate.x = Math.min(SCENE_W - GEOM.plate.w - 10, Math.max(10, sim.hotplate.x + local.x - grab.lastX));
        grab.lastX = local.x;
        return;
      }
      if (grab.key === 'jug') {
        sim.jug.x = Math.min(SCENE_W - 80, Math.max(10, local.x - GEOM.jug.w / 2));
        sim.jug.y = Math.min(BENCH_Y - 64, Math.max(215, local.y - 16));
        ui.pourActive = !!sim.findMouthAt(sim.jug.x + GEOM.jug.w / 2, sim.jug.y + 20);
        return;
      }
      if (grab.key === 'rod') {
        sim.rod.x = Math.min(SCENE_W - 30, Math.max(30, local.x));
        sim.rod.y = Math.min(BENCH_Y - 6, Math.max(255, local.y));
        return;
      }
      if (grab.key === 'thermo') {
        sim.thermo.x = Math.min(SCENE_W - 20, Math.max(20, local.x));
        sim.thermo.y = Math.min(442, Math.max(228, local.y - GEOM.thermo.stemH / 2));
        return;
      }
      if (grab.key.indexOf('cube:') === 0) {
        const id = Number(grab.key.slice(5));
        const c = sim.cubes.find(function (k) { return k.id === id; });
        if (c) {
          c.x = Math.min(SCENE_W - 20, Math.max(20, local.x));
          c.y = Math.min(BENCH_Y, Math.max(170, local.y));
          c.beaker = null;
          c._vy = 0;
        }
      }
    });

    svg.addEventListener('pointerup', endGrab);
    svg.addEventListener('pointercancel', endGrab);
  }

  function bindKeyboard() {
    svg.addEventListener('keydown', function (evt) {
      const target = evt.target.closest('[data-drag]');
      if (!target) return;
      const key = target.getAttribute('data-drag');
      const stepMap = {
        ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, -8], ArrowDown: [0, 8]
      };
      const step = stepMap[evt.key];
      if (step) {
        applyStep(key, step[0], step[1]);
        evt.preventDefault();
        return;
      }
      if (evt.key === 'Enter' || evt.key === ' ') {
        if (key === 'ice') {
          const cube = sim.spawnCube(sim.bucket.x + GEOM.bucket.w / 2, 290);
          cube._vy = 0;
          ui.carriedCubeId = cube.id;
          evt.preventDefault();
        } else if (key === 'plate') {
          sim.toggleHotplate();
          evt.preventDefault();
        }
      }
    });
  }

  function applyStep(key, dx, dy) {
    if (key === 'beaker:A' || key === 'beaker:B') {
      const b = sim.beakers.find(function (k) { return k.id === key.slice(7); });
      if (b) b.x = Math.min(SCENE_W - BK.w - 14, Math.max(14, b.x + dx));
    } else if (key === 'plate') {
      sim.hotplate.x = Math.min(SCENE_W - GEOM.plate.w - 10, Math.max(10, sim.hotplate.x + dx));
    } else if (key === 'jug') {
      sim.jug.x = Math.min(SCENE_W - 80, Math.max(10, sim.jug.x + dx));
      sim.jug.y = Math.min(BENCH_Y - 64, Math.max(215, sim.jug.y + dy));
    } else if (key === 'rod') {
      sim.rod.x = Math.min(SCENE_W - 30, Math.max(30, sim.rod.x + dx));
      sim.rod.y = Math.min(BENCH_Y - 6, Math.max(255, sim.rod.y + dy));
    } else if (key === 'thermo') {
      sim.thermo.x = Math.min(SCENE_W - 20, Math.max(20, sim.thermo.x + dx));
      sim.thermo.y = Math.min(442, Math.max(228, sim.thermo.y + dy));
    } else if (key === 'ice') {
      sim.bucket.x = Math.min(SCENE_W - GEOM.bucket.w, Math.max(0, sim.bucket.x + dx));
    }
  }

  function setupToolbar() {
    const toolBtns = document.querySelectorAll('.tool[data-tool]');
    toolBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        ui.tool = btn.getAttribute('data-tool');
        toolBtns.forEach(function (o) {
          const sel = o === btn;
          o.classList.toggle('selected', sel);
          o.setAttribute('aria-pressed', String(sel));
        });
      });
    });
    divideBtn.addEventListener('click', function () {
      sim.divideSpan();
      refreshMarks(true);
    });
    resetBtn.addEventListener('click', doReset);
    summaryClose.addEventListener('click', function () {
      summaryCard.hidden = true;
    });
    hintBtn.addEventListener('click', function () {
      const expanded = hintBtn.getAttribute('aria-expanded') === 'true';
      if (expanded || ui.hintStep >= HINTS.length) {
        hintBox.hidden = true;
        hintBtn.setAttribute('aria-expanded', 'false');
        hintBtn.textContent = 'Hint';
        ui.hintStep = 0;
        return;
      }
      hintBox.hidden = false;
      hintBox.innerHTML =
        '<strong>Hint ' + (ui.hintStep + 1) + '</strong><br>' + HINTS[ui.hintStep];
      ui.hintStep += 1;
      hintBtn.setAttribute('aria-expanded', 'true');
      if (ui.hintStep >= HINTS.length) hintBtn.textContent = 'Hide hints';
    });
  }

  function doReset() {
    sim.reset();
    grab = null;
    ui.carriedCubeId = null;
    ui.pourActive = false;
    ui.lastTip = null;
    ui.done = false;
    ui.bubbles.forEach(function (b) { b.node.remove(); });
    ui.steam.forEach(function (s) { s.node.remove(); });
    ui.bubbles.length = 0;
    ui.steam.length = 0;
    summaryCard.hidden = true;
    setXY(jugGroup, sim.jug.x, sim.jug.y);
    setXY(plateGroup, sim.hotplate.x, 0);
    setXY(sceneThermo, sim.thermo.x, sim.thermo.y);
    for (const b of sim.beakers) setXY(beakerViews[b.id], b.x, 0);
    refreshMarks(true);
  }

  function applyStirring(dtReal) {
    if (!grab || grab.key !== 'rod') {
      ui.lastTip = null;
      return;
    }
    const tip = tipOfRod();
    if (ui.lastTip) {
      const dist = Math.hypot(tip.x - ui.lastTip.x, tip.y - ui.lastTip.y);
      sim.stir(tip.x, tip.y, Math.min(0.5, dist * 0.05) * dtReal);
    }
    ui.lastTip = tip;
  }

  function applyPouring(dtReal) {
    if (!grab || grab.key !== 'jug' || !ui.pourActive) return;
    sim.pour(sim.jug.x + GEOM.jug.w / 2, sim.jug.y + 20, 62 * dtReal);
  }

  function updateParticles(dtReal) {
    for (const b of sim.beakers) {
      if (b.water > 6 && b.temp > 86) {
        const boil = b.temp >= 99.4;
        const rate = boil ? 26 : b.temp > 93 ? 10 : 3.5;
        ui.bubbleAccum += rate * dtReal;
        while (ui.bubbleAccum > 1) {
          ui.bubbleAccum -= 1;
          if (ui.bubbles.length >= 64) break;
          const bn = el('circle', { r: 2, fill: 'rgba(255,255,255,0.85)' }, beakerViews[b.id].waterParts.bubbles);
          ui.bubbles.push({
            bid: b.id,
            x: 24 + Math.random() * (BK.w - 48),
            y: BENCH_Y - 22 - Math.random() * 8,
            r: boil ? 2.4 + Math.random() * 3.2 : 1.2 + Math.random() * 1.6,
            vy: -(boil ? 66 + Math.random() * 42 : 38 + Math.random() * 18),
            vx: (Math.random() - 0.5) * 14,
            life: 0,
            node: bn
          });
        }
      }
      if (b.boiling && ui.steam.length < 26 && Math.random() < dtReal * 14) {
        const sn = el('circle', { fill: 'rgba(200,214,222,0.4)' }, steamLayer);
        ui.steam.push({
          bid: b.id,
          x: b.x + 30 + Math.random() * (BK.w - 60),
          y: waterSurfaceY(b) - 6,
          r: 7 + Math.random() * 8,
          vy: -(34 + Math.random() * 22),
          drift: (Math.random() - 0.5) * 22,
          life: 0,
          node: sn
        });
      }
    }
    for (let i = ui.bubbles.length - 1; i >= 0; i--) {
      const bu = ui.bubbles[i];
      const host = sim.beakers.find(function (b) { return b.id === bu.bid; });
      bu.life += dtReal;
      bu.y += bu.vy * dtReal;
      bu.x += bu.vx * dtReal;
      const surf = host ? waterSurfaceY(host) : 0;
      const dead = !host || host.water <= 6 || bu.y <= surf + 4 || bu.life > 3;
      if (dead) {
        bu.node.remove();
        ui.bubbles.splice(i, 1);
      } else {
        bu.node.setAttribute('cx', bu.x);
        bu.node.setAttribute('cy', bu.y);
        bu.node.setAttribute('r', bu.r);
      }
    }
    for (let i = ui.steam.length - 1; i >= 0; i--) {
      const st = ui.steam[i];
      st.life += dtReal;
      st.y += st.vy * dtReal;
      st.x += st.drift * dtReal;
      const alpha = Math.max(0, 0.42 - st.life * 0.22);
      if (alpha <= 0 || st.life > 2.4) {
        st.node.remove();
        ui.steam.splice(i, 1);
      } else {
        st.node.setAttribute('cx', st.x);
        st.node.setAttribute('cy', st.y);
        st.node.setAttribute('r', st.r + st.life * 10);
        st.node.setAttribute('fill-opacity', alpha);
      }
    }
  }

  function renderScene(dtReal) {
    for (const b of sim.beakers) {
      const view = beakerViews[b.id];
      setXY(view, b.x, 0);
      const surf = waterSurfaceY(b);
      view.waterParts.rect.setAttribute('y', surf);
      view.waterParts.rect.setAttribute('height', Math.max(0, BENCH_Y - 14 - surf));
      view.waterParts.surface.setAttribute('cy', surf);
      const ripple = (b.stir > 0.05 ? b.stir * 3.4 : 0) + (b.boiling ? Math.abs(Math.sin(ui.timeAnim * 6)) * 1.8 : 0);
      view.waterParts.surface.setAttribute('ry', 5 + ripple * 0.6);
      const swirlOp = b.water > 6 ? Math.min(1, b.mix * 1.5) : 0;
      view.waterParts.swirl.setAttribute('opacity', swirlOp);
      if (swirlOp > 0) {
        ui.swirlAngle += b.mix * dtReal * 340;
        const cyS = (surf + BENCH_Y - 16) / 2;
        view.waterParts.swirl.setAttribute('cy', cyS);
        view.waterParts.swirl.setAttribute(
          'transform',
          'rotate(' + (ui.swirlAngle % 360) + ' ' + (BK.w / 2 - 4) + ' ' + cyS + ')'
        );
      }
    }

    plateGroup.coil.setAttribute('fill', sim.hotplate.on ? '#ff5a2a' : '#78848d');

    const pouringNow = !!grab && grab.key === 'jug' && ui.pourActive;
    jugGroup.setAttribute(
      'transform',
      'translate(' + sim.jug.x + ',' + sim.jug.y + ') rotate(' + (pouringNow ? -34 : 0) + ' 66 16)'
    );
    if (pouringNow) {
      const mouth = sim.findMouthAt(sim.jug.x + GEOM.jug.w / 2, sim.jug.y + 20);
      if (mouth) {
        const lipX = sim.jug.x + GEOM.jug.w + 4;
        const lipY = sim.jug.y - 10;
        const tSurf = waterSurfaceY(mouth);
        const jit = Math.sin(ui.timeAnim * 22) * 2;
        jugStreamNode.setAttribute(
          'd',
          'M' + lipX + ',' + lipY +
          ' Q' + (mouth.x + 30 + jit) + ',' + ((lipY + tSurf) / 2) +
          ' ' + (mouth.x + 34) + ',' + tSurf
        );
        jugStreamNode.setAttribute('opacity', 0.85);
      } else {
        jugStreamNode.setAttribute('opacity', 0);
      }
    } else {
      jugStreamNode.setAttribute('opacity', 0);
    }

    setXY(sceneThermo, sim.thermo.x, sim.thermo.y);
    const fracScene = sim.fracOfTemp(sim.thermo.bulb);
    const H = GEOM.thermo.stemH;
    const colH = Math.max(2, fracScene * (H - 8));
    sceneColumn.setAttribute('height', colH);
    sceneColumn.setAttribute('y', H - 6 - colH);

    syncCubeNodes(dtReal);
    updateParticles(dtReal);
  }

  function syncCubeNodes(dtReal) {
    const seen = new Set();
    for (const c of sim.cubes) {
      seen.add(c.id);
      let node = cubeNodes.get(c.id);
      if (!node) {
        node = el('g', { class: 'draggable', 'data-drag': 'cube:' + c.id }, cubeLayer);
        el('title', {}, node).textContent = 'Ice cube';
        el('rect', {
          x: -10, y: -9, width: 20, height: 18, rx: 4.5,
          fill: 'rgba(224,244,252,0.95)', stroke: '#93cbe3', 'stroke-width': 2
        }, node);
        el('polyline', {
          points: '-6,-4 -1,-6', stroke: 'rgba(255,255,255,0.9)',
          'stroke-width': 2, fill: 'none'
        }, node);
        cubeNodes.set(c.id, node);
      }
      const beingCarried = grab && grab.key === 'cube:' + c.id;
      if (!beingCarried && c.beaker === null) {
        c._vy = (c._vy || 0) + 900 * dtReal;
        c.y = Math.min(BENCH_Y - 12, c.y + c._vy * dtReal);
        if (c.y >= BENCH_Y - 12) c._vy = 0;
      }
      const host = c.beaker ? sim.beakers.find(function (b) { return b.id === c.beaker; }) : null;
      let cx = c.x;
      let cy = c.y;
      let rot = 0;
      if (host && host.water > 8) {
        cy = waterSurfaceY(host) - 2 + Math.sin(ui.timeAnim * 2 + c.phase) * 2.5;
        rot = Math.sin(ui.timeAnim * 1.6 + c.phase) * 7;
      }
      node.setAttribute(
        'transform',
        'translate(' + cx + ',' + cy + ') rotate(' + rot + ') scale(' +
        Math.max(0.25, c.size / 20) + ')'
      );
    }
    for (const pair of Array.from(cubeNodes.entries())) {
      if (!seen.has(pair[0])) {
        pair[1].remove();
        cubeNodes.delete(pair[0]);
      }
    }
  }

  function renderCloseup() {
    const frac = sim.fracOfTemp(sim.thermo.bulb);
    const y = fracToY(frac);
    columnNode.setAttribute('y', y);
    columnNode.setAttribute('height', Math.max(0, CU.botY - y));
    const steady = sim.thermo.stabilized;
    steadyDot.classList.toggle('on', steady);
    steadyLabel.textContent = steady ? 'reading steady' : 'not steady';

    const fx = sim.fixedSorted();
    const canDivide = fx.length >= 2 && (fx[fx.length - 1].frac - fx[0].frac) > 0.05;
    divideBtn.disabled = !canDivide;
    divideBtn.classList.toggle('ready', canDivide);
  }

  function checkDone() {
    if (ui.done) return;
    const res = sim.checkCalibration();
    if (!res.complete) return;
    ui.done = true;
    summaryCard.hidden = false;
    summaryText.textContent =
      'Your two marks are reproducible reference temperatures: a well-stirred ice-water mixture always settles at 0 °C while ice remains, and pure water at normal pressure boils at about 100 °C.';
    summaryDetail.textContent =
      'Because the liquid expands steadily with temperature, ten equal divisions between the marks are steps of exactly 10 °C — the thermometer now reads 0 to 100 °C.';
    refreshMarks(true);
  }

  function init() {
    buildDefs(svg);
    buildStatic(svg);

    buildPlate(mainLayer);
    for (const b of LAYOUT.beakers) {
      const simB = sim.beakers.find(function (s) { return s.id === b.id; });
      beakerViews[b.id] = buildBeaker(simB, mainLayer);
    }
    cubeLayer = el('g', {}, mainLayer);
    steamLayer = el('g', {}, mainLayer);
    buildJug(mainLayer);
    buildBucket(mainLayer);
    buildRod(mainLayer);
    buildThermoScene(mainLayer);

    buildCloseup();

    ui.timeAnim = 0;
    bindPointer();
    bindKeyboard();
    setupToolbar();
    refreshMarks(true);

    let last = performance.now();
    let acc = 0;
    const STEP = 1 / 30;

    function frame(now) {
      let dt = (now - last) / 1000;
      last = now;
      if (dt > 0.25) dt = 0.25;
      ui.timeAnim += dt;
      applyStirring(dt);
      applyPouring(dt);
      acc += dt;
      while (acc >= STEP) {
        sim.step(STEP);
        acc -= STEP;
      }
      renderScene(dt);
      renderCloseup();
      refreshMarks(false);
      checkDone();
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
