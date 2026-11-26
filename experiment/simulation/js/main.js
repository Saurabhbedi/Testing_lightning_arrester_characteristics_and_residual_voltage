/* =================================================================
   Virtual Lab – Testing Lightning Arrester Characteristics
   & Residual Voltage
   Developer : Saurabh Bedi | REC Banda
   Three.js r128 + Chart.js 3.9.1
   ================================================================= */

'use strict';

// ───────────────────────── Scene globals ─────────────────────────
let scene, camera, renderer;
let arresterGroup = null;
let lightningLines = [];
let frame = 0;

// Camera orbit state
let isDrag = false, prevMX = 0, prevMY = 0;
let camTheta = 0.55, camPhi = 0.42, camR = 14;
const CAM_TARGET = new THREE.Vector3(0, 2.6, 0);

const VIEW_PRESETS = [
  { theta: 0.55,            phi: 0.42, r: 14  }, // default 3/4
  { theta: 0,               phi: 0.35, r: 11  }, // front
  { theta: Math.PI / 2,     phi: 0.38, r: 11  }, // right side
  { theta: -Math.PI / 2,    phi: 0.38, r: 11  }, // left side
  { theta: 0.55,            phi: 1.42, r: 10  }, // top-down
];
let viewIdx = 0;

// ───────────────────────── Lab state ─────────────────────────────
let isRunning  = false;
let canAdd     = false;
let pendingObs = null;
let observations = [];
let viChart    = null;
let runTimer   = null;

// ───────────────── Physics tables (IEC 60099-4) ──────────────────
const SYS_DATA = {
  11:  { vr10: 29.5, bil: 75,  rated: 9,  mcov: 7.2  },
  33:  { vr10: 88.0, bil: 170, rated: 30, mcov: 24   },
  66:  { vr10: 172,  bil: 325, rated: 60, mcov: 48   },
  110: { vr10: 288,  bil: 550, rated: 96, mcov: 77   },
};
const CURR_MULT  = { 1: 0.86, 2.5: 0.92, 5: 0.96, 10: 1.00, 20: 1.05, 40: 1.12 };
const WAVE_MULT  = { '8/20': 1.00, '4/10': 1.10, '30/60': 0.88 };
const CLASS_MULT = { porcelain: 1.00, polymer: 1.03 };

// =================================================================
//  ENTRY POINT
// =================================================================
window.addEventListener('load', () => {
  initScene();
  buildRoom();
  buildEquipment();
  setupMouse();
  animate();
});
window.addEventListener('resize', onResize);

// =================================================================
//  THREE.JS SCENE SETUP
// =================================================================
function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x060810);
  scene.fog = new THREE.FogExp2(0x060810, 0.028);

  // Camera
  camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  syncCamera();

  // Renderer
  const canvas = document.getElementById('labCanvas');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  onResize();

  // ── Lighting ──
  // General ambient
  scene.add(new THREE.AmbientLight(0x1a2535, 1.1));

  // Warm hemisphere (sky=cool lab, ground=concrete)
  scene.add(new THREE.HemisphereLight(0x2040a0, 0x101820, 0.5));

  // Ceiling fluorescent tubes  
  const tubes = [
    [-5, 7.6, -5], [0, 7.6, -5], [5, 7.6, -5],
    [-5, 7.6,  2], [0, 7.6,  2], [5, 7.6,  2],
  ];
  tubes.forEach(([x, y, z]) => {
    const pt = new THREE.PointLight(0xd0e0ff, 0.9, 18);
    pt.position.set(x, y, z);
    pt.castShadow = true;
    scene.add(pt);
    // Tube mesh
    addMesh(new THREE.BoxGeometry(0.07, 0.05, 1.3),
            new THREE.MeshBasicMaterial({ color: 0xeeffff }),
            x, y, z);
  });

  // Strobe (red warning, during test)
  const strobe = new THREE.PointLight(0xff2200, 0, 7);
  strobe.name = 'strobe';
  strobe.position.set(0, 7.2, 0);
  scene.add(strobe);

  // Arrester arc glow (during test)
  const arcGlow = new THREE.PointLight(0x4488ff, 0, 6);
  arcGlow.name = 'arcGlow';
  arcGlow.position.set(0, 4.5, -1.5);
  scene.add(arcGlow);
}

// =================================================================
//  ROOM GEOMETRY
// =================================================================
function buildRoom() {
  // Floor
  const floorM = mat(0x1a1f30);
  const floor  = addMesh(new THREE.PlaneGeometry(22, 22), floorM, 0, 0, 0);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;

  // Floor grid overlay
  scene.add(new THREE.GridHelper(22, 22, 0x1e3050, 0x0d1830));

  // Ceiling
  const ceil = addMesh(new THREE.PlaneGeometry(22, 22), mat(0x0c111c), 0, 8, 0);
  ceil.rotation.x = Math.PI / 2;

  // Walls (all DoubleSide to avoid culling issues)
  const wm = new THREE.MeshLambertMaterial({ color: 0x0f1825, side: THREE.DoubleSide });
  // Back
  const bw = addMesh(new THREE.PlaneGeometry(22, 8), wm, 0, 4, -11);
  // Left
  const lw = addMesh(new THREE.PlaneGeometry(22, 8), wm.clone(), -11, 4, 0);
  lw.rotation.y = Math.PI / 2;
  // Right
  const rw = addMesh(new THREE.PlaneGeometry(22, 8), wm.clone(), 11, 4, 0);
  rw.rotation.y = -Math.PI / 2;

  // Safety stripe band (back wall, floor level)
  for (let x = -10; x <= 10; x++) {
    const stripe = addMesh(
      new THREE.PlaneGeometry(1, 1.6),
      new THREE.MeshBasicMaterial({ color: x % 2 === 0 ? 0xffcc00 : 0x151515, side: THREE.DoubleSide }),
      x, 0.8, -10.98
    );
  }

  // Ceiling support beams
  const beamM = mat(0x1e3040);
  for (let z = -9; z <= 7; z += 8) {
    addMesh(new THREE.BoxGeometry(22, 0.18, 0.18), beamM, 0, 7.9, z);
  }
  for (let x = -8; x <= 8; x += 8) {
    addMesh(new THREE.BoxGeometry(0.18, 0.18, 22), beamM.clone(), x, 7.9, 0);
  }

  // Warning danger plates on side walls
  [-10.98, 10.98].forEach((x, i) => {
    const sign = addMesh(new THREE.PlaneGeometry(1.6, 0.8),
                         new THREE.MeshBasicMaterial({ color: 0xdd2200, side: THREE.DoubleSide }),
                         x, 4, 0);
    sign.rotation.y = i === 0 ? Math.PI / 2 : -Math.PI / 2;
  });

  // Floor edge perimeter strip (yellow)
  const stripM = new THREE.MeshBasicMaterial({ color: 0xffcc00 });
  for (const [x, z, rY] of [
    [0, -10.5, 0], [0, 10.5, Math.PI],
    [-10.5, 0, Math.PI / 2], [10.5, 0, -Math.PI / 2]
  ]) {
    const s = addMesh(new THREE.BoxGeometry(21, 0.03, 0.12), stripM.clone(), x, 0.02, z);
    s.rotation.y = rY;
  }
}

// =================================================================
//  ALL EQUIPMENT
// =================================================================
function buildEquipment() {
  buildTestBench();
  buildArrester();
  buildHVTransformer();
  buildImpulseGenerator();
  buildOscilloscope();
  buildVoltageDivider();
  buildGroundBus();
  buildCables();
  buildControlDesk();
  buildSafetyBarrier();
}

// ─── Test Bench ──────────────────────────────────────────────────
function buildTestBench() {
  const bm = mat(0x1e2d3f);
  const lm = mat(0x14202e);

  // Top surface
  const top = addMesh(new THREE.BoxGeometry(10, 0.12, 2.8), bm, 0, 1.44, -0.6);
  top.castShadow = true; top.receiveShadow = true;

  // Legs
  [[-4.6, 0.72, -1.8], [4.6, 0.72, -1.8], [-4.6, 0.72, 0.6], [4.6, 0.72, 0.6]].forEach(p => {
    addMesh(new THREE.BoxGeometry(0.09, 1.44, 0.09), lm, ...p);
  });

  // Lower shelf
  addMesh(new THREE.BoxGeometry(10, 0.08, 2.8), mat(0x18263a), 0, 0.5, -0.6);

  // Rubber insulation mat (green)
  addMesh(new THREE.BoxGeometry(9.8, 0.025, 2.6),
          new THREE.MeshPhongMaterial({ color: 0x1a4a1a, shininess: 60 }),
          0, 1.52, -0.6);

  // Front lip (metal trim)
  addMesh(new THREE.BoxGeometry(10, 0.04, 0.05),
          new THREE.MeshPhongMaterial({ color: 0x556677, shininess: 120 }),
          0, 1.5, 0.74);
}

// ─── Lightning Arrester ──────────────────────────────────────────
function buildArrester() {
  if (arresterGroup) {
    scene.remove(arresterGroup);
    arresterGroup = null;
  }

  const grp = new THREE.Group();
  grp.name = 'arrester';

  const isPolymer = document.getElementById('aType').value === 'polymer';
  const bodyColor = isPolymer ? 0x9b7a52 : 0xddd8cc;
  const shininess = isPolymer ? 18 : 85;

  const bodyM = new THREE.MeshPhongMaterial({
    color: bodyColor, shininess,
    specular: isPolymer ? 0x111111 : 0x444444,
  });
  const metalM = new THREE.MeshPhongMaterial({
    color: 0xc0c0c0, shininess: 220, specular: 0x999999,
  });
  const baseM = new THREE.MeshPhongMaterial({
    color: 0x888888, shininess: 150,
  });

  const SHEDS   = 14;
  const SPACING = 0.37;

  for (let i = 0; i < SHEDS; i++) {
    const y = i * SPACING;
    // Core column between sheds
    addToGroup(grp, new THREE.CylinderGeometry(0.09, 0.09, SPACING, 14), bodyM, 0, y + SPACING / 2, 0);
    // Main shed disk
    addToGroup(grp, new THREE.CylinderGeometry(0.31, 0.31, 0.055, 24), bodyM, 0, y + 0.07, 0);
    // Under-rib
    if (!isPolymer) {
      addToGroup(grp, new THREE.CylinderGeometry(0.21, 0.21, 0.04, 20), bodyM, 0, y + 0.14, 0);
    }
  }

  // Top metal cap + ball terminal
  addToGroup(grp, new THREE.CylinderGeometry(0.11, 0.11, 0.24, 16), metalM, 0, SHEDS * SPACING + 0.08, 0);
  const ball = addToGroup(grp, new THREE.SphereGeometry(0.09, 14, 14), metalM.clone(), 0, SHEDS * SPACING + 0.28, 0);

  // Bottom base flange
  addToGroup(grp, new THREE.CylinderGeometry(0.21, 0.23, 0.14, 16), baseM, 0, -0.07, 0);
  // Ground lug
  addToGroup(grp, new THREE.BoxGeometry(0.32, 0.05, 0.08), metalM.clone(), 0.22, -0.07, 0);

  grp.position.set(0, 1.52, -1.5);
  scene.add(grp);
  arresterGroup = grp;
}

// Called from HTML when arrester type changes
function rebuildArrester() {
  buildArrester();
}

// ─── HV Test Transformer ─────────────────────────────────────────
function buildHVTransformer() {
  const grp = new THREE.Group();

  // Oil tank
  const tankM = new THREE.MeshPhongMaterial({ color: 0x2c3f30, shininess: 25 });
  addToGroup(grp, new THREE.BoxGeometry(1.4, 2.1, 1.0), tankM, 0, 0, 0);

  // Cooling radiator fins
  const finM = new THREE.MeshPhongMaterial({ color: 0x1e2e22 });
  for (let z = -0.4; z <= 0.4; z += 0.2) {
    addToGroup(grp, new THREE.BoxGeometry(0.055, 1.6, 0.6), finM, 0.75, 0, z);
    addToGroup(grp, new THREE.BoxGeometry(0.055, 1.6, 0.6), finM.clone(), -0.75, 0, z);
  }

  // HV porcelain bushing (top)
  const bushM = new THREE.MeshPhongMaterial({ color: 0xe8d8b0, shininess: 60 });
  for (let i = 0; i < 7; i++) {
    addToGroup(grp, new THREE.CylinderGeometry(0.1 - i * 0.004, 0.1 - i * 0.004, 0.065, 14), bushM, 0, 1.08 + i * 0.22, 0);
    addToGroup(grp, new THREE.CylinderGeometry(0.055, 0.055, 0.155, 10),   bushM, 0, 1.11 + i * 0.22, 0);
  }
  // Top corona ring
  addToGroup(grp, new THREE.TorusGeometry(0.14, 0.02, 8, 24), new THREE.MeshPhongMaterial({ color: 0xbbbbbb, shininess: 200 }), 0, 1.08 + 7 * 0.22, 0);

  // LV bushings (side)
  const lvBushM = new THREE.MeshPhongMaterial({ color: 0xd0c8a0, shininess: 40 });
  for (const z of [-0.25, 0.25]) {
    const lb = addToGroup(grp, new THREE.CylinderGeometry(0.07, 0.07, 0.42, 10), lvBushM, 0, 0, z);
    lb.rotation.x = Math.PI / 2;
    lb.position.set(-0.9, 0.5, z);
  }

  // Rating plate
  addToGroup(grp, new THREE.BoxGeometry(0.75, 0.38, 0.015),
             new THREE.MeshBasicMaterial({ color: 0x002244 }), 0, -0.6, 0.52);

  grp.position.set(-5, 2.55, -1.5);
  scene.add(grp);
}

// ─── Impulse / Surge Generator ───────────────────────────────────
function buildImpulseGenerator() {
  const grp = new THREE.Group();

  // Cabinet
  const cabM = new THREE.MeshPhongMaterial({ color: 0x3a2a18, shininess: 15 });
  addToGroup(grp, new THREE.BoxGeometry(1.1, 1.9, 0.72), cabM, 0, 0, 0);

  // Front panel
  const panM = new THREE.MeshPhongMaterial({ color: 0x2c2010, shininess: 8 });
  addToGroup(grp, new THREE.PlaneGeometry(1.0, 1.8), panM, 0, 0, 0.37);

  // LCD display
  addToGroup(grp, new THREE.PlaneGeometry(0.68, 0.28),
             new THREE.MeshBasicMaterial({ color: 0x003300 }), 0, 0.52, 0.375);

  // Knobs
  const knobM = new THREE.MeshPhongMaterial({ color: 0x111111, shininess: 100 });
  [[-0.26, 0.1], [0, 0.1], [0.26, 0.1], [-0.2, -0.22], [0.2, -0.22]].forEach(([x, y]) => {
    const k = addToGroup(grp, new THREE.CylinderGeometry(0.052, 0.052, 0.04, 12), knobM, x, y, 0.39);
    k.rotation.x = Math.PI / 2;
  });

  // Push buttons (green/red)
  [[0xdd0000, -0.15], [0x00aa00, 0], [0x00aa00, 0.15]].forEach(([c, x]) => {
    const b = addToGroup(grp, new THREE.CylinderGeometry(0.038, 0.038, 0.03, 10),
                          new THREE.MeshPhongMaterial({ color: c, shininess: 80 }),
                          x, -0.5, 0.39);
    b.rotation.x = Math.PI / 2;
  });

  // HV output terminal (top)
  addToGroup(grp, new THREE.CylinderGeometry(0.07, 0.07, 0.3, 10),
             new THREE.MeshPhongMaterial({ color: 0xdd4400, shininess: 80 }), 0, 1.1, 0);

  // Corona ring on HV terminal
  addToGroup(grp, new THREE.TorusGeometry(0.12, 0.018, 7, 20),
             new THREE.MeshPhongMaterial({ color: 0xbbbbbb, shininess: 180 }), 0, 1.3, 0);

  grp.position.set(5, 2.5, -1.5);
  scene.add(grp);
}

// ─── Oscilloscope ────────────────────────────────────────────────
function buildOscilloscope() {
  const grp = new THREE.Group();

  addToGroup(grp, new THREE.BoxGeometry(1.4, 0.95, 0.72),
             new THREE.MeshPhongMaterial({ color: 0x1a2520, shininess: 12 }), 0, 0, 0);

  // Screen bezel
  addToGroup(grp, new THREE.BoxGeometry(0.88, 0.72, 0.02),
             new THREE.MeshPhongMaterial({ color: 0x0d1810, shininess: 5 }), -0.1, 0.06, 0.37);

  // Screen
  addToGroup(grp, new THREE.PlaneGeometry(0.78, 0.62),
             new THREE.MeshBasicMaterial({ color: 0x002200 }), -0.1, 0.06, 0.38);

  // Screen grid lines
  const gridLM = new THREE.LineBasicMaterial({ color: 0x005500 });
  for (let v = -0.25; v <= 0.3; v += 0.1) {
    mkLine(grp, [[-0.5 + 0.1, v + 0.06, 0.39], [0.3, v + 0.06, 0.39]], gridLM);
    mkLine(grp, [[v - 0.1, -0.25, 0.39], [v - 0.1, 0.37, 0.39]], gridLM);
  }

  // Channel knobs
  const kM = new THREE.MeshPhongMaterial({ color: 0x444444, shininess: 80 });
  for (let i = 0; i < 4; i++) {
    const k = addToGroup(grp, new THREE.CylinderGeometry(0.055, 0.055, 0.04, 10), kM, 0.52, 0.28 - i * 0.17, 0.39);
    k.rotation.x = Math.PI / 2;
  }

  // BNC connectors (front bottom)
  const bncM = new THREE.MeshPhongMaterial({ color: 0x888888, shininess: 150 });
  for (const x of [-0.4, -0.2, 0, 0.2]) {
    const c = addToGroup(grp, new THREE.CylinderGeometry(0.025, 0.025, 0.055, 8), bncM, x, -0.4, 0.39);
    c.rotation.x = Math.PI / 2;
  }

  grp.position.set(-5, 2.15, 1.0);
  scene.add(grp);
}

// ─── Capacitive Voltage Divider ──────────────────────────────────
function buildVoltageDivider() {
  const grp = new THREE.Group();
  const capM  = new THREE.MeshPhongMaterial({ color: 0x3a1515, shininess: 10 });
  const diskM = new THREE.MeshPhongMaterial({ color: 0x1a1a1a, shininess: 5 });
  const stemM = new THREE.MeshPhongMaterial({ color: 0xbbbbbb, shininess: 110 });

  const UNITS = 6, SP = 0.44;
  for (let i = 0; i < UNITS; i++) {
    addToGroup(grp, new THREE.CylinderGeometry(0.14, 0.14, 0.33, 14), capM,  0, i * SP + 0.165, 0);
    addToGroup(grp, new THREE.CylinderGeometry(0.21, 0.21, 0.05,  16), diskM, 0, i * SP + 0.345, 0);
  }
  addToGroup(grp, new THREE.SphereGeometry(0.07, 10, 10), stemM, 0, UNITS * SP + 0.07, 0);
  addToGroup(grp, new THREE.BoxGeometry(0.28, 0.14, 0.02),
             new THREE.MeshBasicMaterial({ color: 0x003366 }), 0, 0.5, 0.17);

  grp.position.set(2.8, 1.52, 1.0);
  scene.add(grp);
}

// ─── Ground Bus ──────────────────────────────────────────────────
function buildGroundBus() {
  const busM = new THREE.MeshPhongMaterial({ color: 0x226633, shininess: 50 });
  addMesh(new THREE.BoxGeometry(11, 0.04, 0.07), busM, 0, 1.52, 1.6);

  const studM = new THREE.MeshPhongMaterial({ color: 0x33aa44, shininess: 100 });
  for (let x = -4.5; x <= 4.5; x += 1.5) {
    addMesh(new THREE.CylinderGeometry(0.025, 0.025, 0.1, 8), studM, x, 1.57, 1.6);
  }
  for (const x of [-4, 0, 4]) {
    addMesh(new THREE.BoxGeometry(0.03, 0.4, 0.03), busM.clone(), x, 1.3, 1.6);
    for (let j = 0; j < 3; j++) {
      addMesh(new THREE.BoxGeometry(0.28 - j * 0.08, 0.025, 0.025), busM.clone(), x, 1.1 - j * 0.06, 1.6);
    }
  }
}

// ─── Cables / Connections ────────────────────────────────────────
function buildCables() {
  // HV: transformer bushing → arrester top
  cable([[-5, 3.85, -1.5], [-3.5, 5.3, -1.5], [0, 5.6, -1.5], [0, 5.5, -1.5]], 0xff4400);
  // HV: impulse gen → arrester top
  cable([[5, 3.7, -1.5], [3.5, 5.1, -1.5], [0.5, 5.6, -1.5], [0, 5.6, -1.5]], 0xff4400);
  // Ground: arrester base → bus
  cable([[0.22, 1.52, -1.5], [0.5, 1.53, 1.6]], 0x00cc44);
  // Ground: transformer → bus
  cable([[-5, 1.5, -1.5], [-5, 1.52, 1.6], [0, 1.52, 1.6]], 0x00cc44);
  // Ground: gen → bus
  cable([[5, 1.5, -1.5], [5, 1.52, 1.6], [0, 1.52, 1.6]], 0x00cc44);
  // Measurement: arrester → voltage divider
  cable([[0.3, 2.6, -1.5], [2.8, 3.8, 1.0]], 0x0088ff);
  // Osc: voltage divider → oscilloscope
  cable([[2.8, 2.9, 1.0], [-5, 2.5, 1.0]], 0x888800);
}

// ─── Control desk (back of room) ─────────────────────────────────
function buildControlDesk() {
  const deskM = mat(0x1a2535);
  const top = addMesh(new THREE.BoxGeometry(5.5, 0.1, 1.5), deskM, 0, 1.0, 7.5);
  top.receiveShadow = true;

  [[-2.3, 0.5, 6.9], [2.3, 0.5, 6.9], [-2.3, 0.5, 8.1], [2.3, 0.5, 8.1]].forEach(p => {
    addMesh(new THREE.BoxGeometry(0.07, 1.0, 0.07), deskM.clone(), ...p);
  });

  // Monitor on desk
  addMesh(new THREE.BoxGeometry(1.6, 0.03, 0.4),   deskM.clone(), 0, 1.07, 7.4);
  addMesh(new THREE.BoxGeometry(1.4, 0.95, 0.055),
          new THREE.MeshPhongMaterial({ color: 0x0d1a0d, shininess: 60 }), 0, 1.63, 7.14).rotation.x = 0.14;
  addMesh(new THREE.PlaneGeometry(1.2, 0.8),
          new THREE.MeshBasicMaterial({ color: 0x003311 }), 0, 1.63, 7.12).rotation.x = 0.14;

  // Keyboard
  addMesh(new THREE.BoxGeometry(1.1, 0.03, 0.35),
          new THREE.MeshPhongMaterial({ color: 0x222222, shininess: 50 }), 0, 1.07, 7.75);
}

// ─── Safety Barrier ──────────────────────────────────────────────
function buildSafetyBarrier() {
  const poleM   = new THREE.MeshPhongMaterial({ color: 0xdd4400, shininess: 40 });
  const ropeM   = new THREE.LineBasicMaterial({ color: 0xffcc00 });
  const polePos = [[-5, 0, 3.5], [0, 0, 3.5], [5, 0, 3.5]];

  polePos.forEach(([x, y, z]) => {
    addMesh(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 8), poleM, x, 0.6, z);
  });
  mkLine(scene, [[-5, 1.1, 3.5], [0, 1.1, 3.5], [5, 1.1, 3.5]], ropeM);
  mkLine(scene, [[-5, 0.8, 3.5], [0, 0.8, 3.5], [5, 0.8, 3.5]], ropeM.clone());

  // "DANGER HIGH VOLTAGE" sign on barrier
  addMesh(new THREE.BoxGeometry(1.4, 0.4, 0.02),
          new THREE.MeshBasicMaterial({ color: 0xffcc00 }), 0, 1.15, 3.5);
}

// =================================================================
//  ANIMATION LOOP
// =================================================================
function animate() {
  requestAnimationFrame(animate);
  frame++;

  if (isRunning) {
    // Strobe light
    const strobe = scene.getObjectByName('strobe');
    if (strobe) strobe.intensity = (Math.sin(frame * 0.18) > 0 ? 2.8 : 0);

    // Arc glow pulse
    const ag = scene.getObjectByName('arcGlow');
    if (ag) ag.intensity = 0.6 + Math.sin(frame * 0.12) * 0.35;

    // Spawn lightning bolt every few frames
    if (frame % 6 === 0) spawnBolt();
  }

  // Fade out lightning lines
  for (let i = lightningLines.length - 1; i >= 0; i--) {
    const ln = lightningLines[i];
    ln.userData.life -= 0.07;
    if (ln.material) ln.material.opacity = Math.max(0, ln.userData.life);
    if (ln.userData.life <= 0) {
      scene.remove(ln);
      lightningLines.splice(i, 1);
    }
  }

  renderer.render(scene, camera);
}

// =================================================================
//  LIGHTNING BOLT EFFECT
// =================================================================
function spawnBolt() {
  // Primary bolt: arrester top → base
  const pts = [];
  let x = 0, z = -1.5;
  const startY = 5.6, endY = 1.55;
  pts.push(new THREE.Vector3(x, startY, z));
  for (let i = 1; i <= 12; i++) {
    x += (Math.random() - 0.5) * 0.28;
    z += (Math.random() - 0.5) * 0.18;
    pts.push(new THREE.Vector3(x, startY - (startY - endY) * (i / 12), z));
  }
  const col = Math.random() > 0.4 ? 0x44aaff : 0xffffff;
  mkLightningLine(pts, col);

  // Occasional secondary branch
  if (Math.random() > 0.65) {
    const branch = [pts[3].clone()];
    let bx = pts[3].x, bz = pts[3].z;
    for (let i = 0; i < 5; i++) {
      bx += (Math.random() - 0.5) * 0.3;
      bz += (Math.random() - 0.5) * 0.2;
      branch.push(new THREE.Vector3(bx, pts[3].y - i * 0.4, bz));
    }
    mkLightningLine(branch, 0x88ccff);
  }
}

function mkLightningLine(pts, color) {
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 });
  const ln  = new THREE.Line(geo, mat);
  ln.userData.life = 1.0;
  scene.add(ln);
  lightningLines.push(ln);
}

// =================================================================
//  MOUSE / TOUCH ORBIT CONTROLS
// =================================================================
function setupMouse() {
  const cv = document.getElementById('labCanvas');

  cv.addEventListener('mousedown', e => { isDrag = true; prevMX = e.clientX; prevMY = e.clientY; });
  window.addEventListener('mouseup',   () => { isDrag = false; });
  window.addEventListener('mousemove', e => {
    if (!isDrag) return;
    camTheta -= (e.clientX - prevMX) * 0.008;
    camPhi    = Math.max(0.05, Math.min(1.5, camPhi - (e.clientY - prevMY) * 0.008));
    prevMX = e.clientX; prevMY = e.clientY;
    syncCamera();
  });
  cv.addEventListener('wheel', e => {
    camR = Math.max(3, Math.min(28, camR + e.deltaY * 0.022));
    syncCamera();
    e.preventDefault();
  }, { passive: false });

  // Touch
  cv.addEventListener('touchstart', e => {
    isDrag = true;
    prevMX = e.touches[0].clientX;
    prevMY = e.touches[0].clientY;
  });
  window.addEventListener('touchend',   () => { isDrag = false; });
  window.addEventListener('touchmove',  e => {
    if (!isDrag) return;
    camTheta -= (e.touches[0].clientX - prevMX) * 0.009;
    camPhi    = Math.max(0.05, Math.min(1.5, camPhi - (e.touches[0].clientY - prevMY) * 0.009));
    prevMX = e.touches[0].clientX;
    prevMY = e.touches[0].clientY;
    syncCamera();
  });
}

function syncCamera() {
  camera.position.set(
    CAM_TARGET.x + camR * Math.sin(camTheta) * Math.cos(camPhi),
    CAM_TARGET.y + camR * Math.sin(camPhi),
    CAM_TARGET.z + camR * Math.cos(camTheta) * Math.cos(camPhi)
  );
  camera.lookAt(CAM_TARGET);
}

function onResize() {
  const col = document.getElementById('sceneCol');
  if (!col || !renderer) return;
  const w = col.clientWidth, h = col.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// =================================================================
//  PHYSICS CALCULATIONS
// =================================================================
function calcVr(sysV, iKA, waveform, arrType) {
  const d  = SYS_DATA[sysV];   if (!d) return 0;
  const im = CURR_MULT[iKA] ?? 1.0;
  const wm = WAVE_MULT[waveform] ?? 1.0;
  const cm = CLASS_MULT[arrType] ?? 1.0;
  const jitter = 1 + (Math.random() - 0.5) * 0.03;  // ±1.5% natural variation
  return +(d.vr10 * im * wm * cm * jitter).toFixed(1);
}

function getResult(vr, sysV) {
  const bil = SYS_DATA[sysV]?.bil ?? 170;
  return vr < bil * 0.80 ? 'PASS' : 'FAIL';
}

// =================================================================
//  UI HANDLERS
// =================================================================
function runTest() {
  if (isRunning) return;
  isRunning = true;
  canAdd    = false;
  pendingObs = null;

  setBtn('bRun', '⏳ TESTING…', true);
  setBtn('bAdd', '➕ ADD', true);
  setBar('sb-running', '◉ TEST IN PROGRESS – STAND CLEAR');
  setDisp('--', '--', '--', 'TESTING', 'running');

  clearTimeout(runTimer);
  runTimer = setTimeout(finishTest, 3600);
}

function finishTest() {
  const sysV  = +document.getElementById('sVolt').value;
  const iKA   = +document.getElementById('iDisc').value;
  const wave  = document.getElementById('iWave').value;
  const atype = document.getElementById('aType').value;

  const vr     = calcVr(sysV, iKA, wave, atype);
  const bil    = SYS_DATA[sysV]?.bil ?? 0;
  const result = getResult(vr, sysV);

  pendingObs = { sysV, iKA, wave, atype, vr, bil, result };

  setDisp(iKA + ' kA', vr + ' kV', bil + ' kV', result, result.toLowerCase());

  isRunning = false;
  canAdd    = true;

  setBtn('bRun', '▶ RUN TEST', false);
  setBtn('bAdd', '➕ ADD', false);
  setBar('sb-done', '✔ TEST COMPLETE — Click ADD to record observation');

  // Turn off effects
  const strobe = scene.getObjectByName('strobe');
  const ag     = scene.getObjectByName('arcGlow');
  if (strobe) strobe.intensity = 0;
  if (ag)     ag.intensity     = 0;
}

function addObs() {
  if (!pendingObs) return;
  observations.push({ ...pendingObs, sr: observations.length + 1 });
  renderTable();
  renderChart();

  pendingObs = null;
  canAdd     = false;
  setBtn('bAdd', '➕ ADD', true);
  setBar('sb-ready', '● READY TO TEST');
}

function cycleView() {
  viewIdx = (viewIdx + 1) % VIEW_PRESETS.length;
  const v = VIEW_PRESETS[viewIdx];
  camTheta = v.theta; camPhi = v.phi; camR = v.r;
  syncCamera();
}

function resetAll() {
  isRunning  = false;
  canAdd     = false;
  pendingObs = null;
  clearTimeout(runTimer);

  // Clear lightning
  lightningLines.forEach(l => scene.remove(l));
  lightningLines.length = 0;

  // Turn off lights
  ['strobe', 'arcGlow'].forEach(n => {
    const l = scene.getObjectByName(n);
    if (l) l.intensity = 0;
  });

  setBtn('bRun', '▶ RUN TEST', false);
  setBtn('bAdd', '➕ ADD', true);
  setBar('sb-ready', '● READY TO TEST');
  setDisp('-- kA', '-- kV', '-- kV', 'READY', 'ready');

  observations = [];
  renderTable();
  if (viChart) { viChart.destroy(); viChart = null; }
  const ctx = document.getElementById('viChart').getContext('2d');
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  viewIdx = 0;
  const v = VIEW_PRESETS[0];
  camTheta = v.theta; camPhi = v.phi; camR = v.r;
  syncCamera();
}

function printReport() {
  if (observations.length === 0) {
    alert('No observations recorded.\nRun at least one test and click ADD before printing.');
    return;
  }
  window.print();
}

// =================================================================
//  TABLE RENDER
// =================================================================
function renderTable() {
  const tbody = document.getElementById('obsBody');
  if (observations.length === 0) {
    tbody.innerHTML = '<tr class="no-data"><td colspan="7">No observations yet. Run a test first.</td></tr>';
    return;
  }
  tbody.innerHTML = observations.map(o => `
    <tr>
      <td>${o.sr}</td>
      <td>${o.sysV}</td>
      <td>${o.iKA}</td>
      <td>${o.vr}</td>
      <td>${o.bil}</td>
      <td>${o.wave}</td>
      <td class="${o.result === 'PASS' ? 'pass' : 'fail'}">${o.result}</td>
    </tr>
  `).join('');
}

// =================================================================
//  CHART RENDER
// =================================================================
function renderChart() {
  const ctx    = document.getElementById('viChart').getContext('2d');
  const sorted = [...observations].sort((a, b) => a.iKA - b.iKA);

  if (viChart) viChart.destroy();

  viChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: sorted.map(o => o.iKA + ' kA'),
      datasets: [{
        label: 'Residual Voltage Vᵣ (kV)',
        data: sorted.map(o => o.vr),
        borderColor:     '#00d4ff',
        backgroundColor: 'rgba(0,212,255,0.07)',
        pointBackgroundColor: '#00ff99',
        pointBorderColor:     '#00d4ff',
        pointRadius: 5,
        pointHoverRadius: 7,
        borderWidth: 2,
        tension: 0.4,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      animation: { duration: 600 },
      plugins: {
        legend: { labels: { color: '#8aabcc', font: { size: 10 } } },
        tooltip: {
          backgroundColor: 'rgba(5,15,30,0.9)',
          titleColor: '#00d4ff',
          bodyColor:  '#ccdde8',
        },
      },
      scales: {
        x: {
          ticks: { color: '#4a6680', font: { size: 9 } },
          grid:  { color: '#18293f' },
          title: { display: true, text: 'Discharge Current (kA)', color: '#5a7a99', font: { size: 10 } },
        },
        y: {
          ticks: { color: '#4a6680', font: { size: 9 } },
          grid:  { color: '#18293f' },
          title: { display: true, text: 'Residual Voltage (kV)', color: '#5a7a99', font: { size: 10 } },
        },
      },
    },
  });
}

// =================================================================
//  DISPLAY HELPERS
// =================================================================
function setDisp(curr, volt, bil, stat, cls) {
  document.getElementById('dI').textContent   = curr;
  document.getElementById('dV').textContent   = volt;
  document.getElementById('dBIL').textContent = bil;
  const el = document.getElementById('dStat');
  el.textContent = stat;
  el.className   = 'digi-val digi-' + (cls || 'ready');
}

function setBar(cls, txt) {
  const el = document.getElementById('statusBar');
  el.className   = 'status-bar ' + cls;
  el.textContent = txt;
}

function setBtn(id, txt, disabled) {
  const el = document.getElementById(id);
  el.textContent = txt;
  el.disabled    = disabled;
}

// =================================================================
//  THREE.JS UTILITY HELPERS
// =================================================================
function mat(color, shininess = 15) {
  return new THREE.MeshPhongMaterial({ color, shininess });
}

function addMesh(geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow    = true;
  m.receiveShadow = true;
  scene.add(m);
  return m;
}

function addToGroup(grp, geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow    = true;
  m.receiveShadow = true;
  grp.add(m);
  return m;
}

function cable(pointArrays, color) {
  const pts = pointArrays.map(p => new THREE.Vector3(...p));
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  scene.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color })));
}

function mkLine(target, pointArrays, material) {
  const pts = pointArrays.map(p => new THREE.Vector3(...p));
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const ln  = new THREE.Line(geo, material);
  if (target instanceof THREE.Group) target.add(ln);
  else target.add ? target.add(ln) : scene.add(ln);
}
