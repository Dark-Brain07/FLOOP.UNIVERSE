// ==========================================================================
// FLOOP UNIVERSE — CRIMSON SKY-ROAD & INFINITE-RUN ROBOT LANDING SCENE
// Combines a glowing red atmospheric backdrop, 3D flying cyber-road (Three.js),
// and a 60fps articulated infinite-run rig built from the mascot sprites.
// ==========================================================================

import * as THREE from '/vendor/three/three.module.js';

const ROAD_WIDTH = 4.8;
const ROAD_LENGTH = 130;
const ROAD_BASE_Y = -1.32;
const ROBOT_BASE_Z = 1.15;
const RUN_OMEGA = 17.5; // rad/s (~2.78 full L+R stride cycles/sec)
const ROAD_SCROLL_SPEED = 24.0;
const VEHICLE_SPEED = 25.5;
const PUNCH_DURATION = 0.42;

// Exact 1x source coordinates (626x351) -> used as reference ratios for 2x sprites
const RIG = {
  torsoCenter: { x: 296, y: 185 },
  groundOffsetY: 106, // vertical px from torso center to road contact in 1x coords
  head: {
    w: 156, h: 150,
    pivot: { x: 76, y: 132 },
    offsetFromTorso: { x: 6, y: -37 },
    eyes: [
      { x: 52, y: 92, r: 16 },
      { x: 121, y: 93, r: 15 },
    ],
  },
  torso: {
    w: 90, h: 70,
    pivot: { x: 48, y: 31 },
  },
  armLeft: {
    w: 77, h: 103,
    pivot: { x: 58, y: 22 },
    mirrorPivot: { x: 77 - 58, y: 22 },
    offsetFromTorso: { x: -70, y: -87 },
  },
  armRight: {
    w: 90, h: 103,
    pivot: { x: 16, y: 20 },
    mirrorPivot: { x: 90 - 16, y: 20 },
    offsetFromTorso: { x: 88, y: -83 },
  },
  legPush: {
    w: 72, h: 104,
    pivot: { x: 58, y: 12 },
    mirrorPivot: { x: 72 - 58, y: 12 },
  },
  legDrive: {
    w: 70, h: 130,
    pivot: { x: 14, y: 22 },
    mirrorPivot: { x: 70 - 14, y: 22 },
  },
  hipLeftOffset: { x: -34, y: 9 },
  hipRightOffset: { x: 30, y: 9 },
};

const SPRITE_FILES = {
  head: '/media/robot/head.png',
  torso: '/media/robot/torso.png',
  armLeft: '/media/robot/arm_left.png',
  armLeftMirror: '/media/robot/arm_left_mirror.png',
  armRight: '/media/robot/arm_right.png',
  armRightMirror: '/media/robot/arm_right_mirror.png',
  legPush: '/media/robot/leg_push.png',
  legPushMirror: '/media/robot/leg_push_mirror.png',
  legDrive: '/media/robot/leg_drive.png',
  legDriveMirror: '/media/robot/leg_drive_mirror.png',
};

function clamp(val, lo, hi) {
  return Math.max(lo, Math.min(hi, val));
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Create a high-resolution procedural road surface texture for the flying cyber-highway.
 */
function createRoadTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');

  // Deep obsidian-crimson deck base
  const deckGrad = ctx.createLinearGradient(0, 0, canvas.width, 0);
  deckGrad.addColorStop(0.0, '#180506');
  deckGrad.addColorStop(0.08, '#100709');
  deckGrad.addColorStop(0.5, '#190b0d');
  deckGrad.addColorStop(0.92, '#100709');
  deckGrad.addColorStop(1.0, '#180506');
  ctx.fillStyle = deckGrad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Subtle longitudinal asphalt sheen & metallic deck grain
  ctx.fillStyle = 'rgba(255, 95, 45, 0.035)';
  for (let x = 36; x < canvas.width - 36; x += 18) {
    ctx.fillRect(x, 0, 2, canvas.height);
  }

  // Transverse deck panel seams & subtle glowing ribs (gives unmistakable hovering platform feel)
  for (let y = 0; y < canvas.height; y += 128) {
    ctx.fillStyle = 'rgba(255, 80, 20, 0.16)';
    ctx.fillRect(28, y, canvas.width - 56, 3);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(28, y + 3, canvas.width - 56, 4);
  }

  // Luminous edge curb strips (warm neon amber-orange outer + thin cyan inner tech trace)
  ctx.fillStyle = '#ff521b';
  ctx.fillRect(10, 0, 14, canvas.height);
  ctx.fillRect(canvas.width - 24, 0, 14, canvas.height);

  ctx.fillStyle = '#ffbb55';
  ctx.fillRect(14, 0, 6, canvas.height);
  ctx.fillRect(canvas.width - 20, 0, 6, canvas.height);

  ctx.fillStyle = 'rgba(0, 229, 255, 0.68)';
  ctx.fillRect(34, 0, 4, canvas.height);
  ctx.fillRect(canvas.width - 38, 0, 4, canvas.height);

  // Center glowing dashed speed strips
  const dashCount = 4;
  const step = canvas.height / dashCount;
  for (let i = 0; i < dashCount; i++) {
    const y = i * step + 28;
    const h = step * 0.56;
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, 'rgba(255, 195, 70, 0.15)');
    g.addColorStop(0.5, 'rgba(255, 130, 35, 0.95)');
    g.addColorStop(1, 'rgba(255, 225, 130, 0.95)');
    ctx.fillStyle = g;
    ctx.fillRect(canvas.width * 0.5 - 7, y, 14, h);

    // Flanking speed chevrons pointing FORWARD toward the viewer (+Z / v=0)
    ctx.strokeStyle = 'rgba(255, 130, 50, 0.34)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(canvas.width * 0.25, y + h * 0.25);
    ctx.lineTo(canvas.width * 0.5, y + h * 0.78);
    ctx.lineTo(canvas.width * 0.75, y + h * 0.25);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 14);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Create a soft radial glow texture for the crimson horizon sun and particles.
 */
function createGlowTexture(innerColor, midColor, outerColor) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 2, 128, 128, 128);
  g.addColorStop(0, innerColor);
  g.addColorStop(0.35, midColor);
  g.addColorStop(1, outerColor);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Build a stylized 3D futuristic sports cyber-car with glowing headlights and neon wheels.
 */
function createCyberCar() {
  const group = new THREE.Group();
  const wheels = [];

  // Main low-slung sculpted body
  const bodyMat = new THREE.MeshBasicMaterial({ color: 0x220a10 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.26, 0.34, 2.35), bodyMat);
  body.position.y = 0.28;
  group.add(body);

  // Racing hood stripe
  const stripeMat = new THREE.MeshBasicMaterial({ color: 0xff4c18 });
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.36, 2.37), stripeMat);
  stripe.position.y = 0.28;
  group.add(stripe);

  // Tinted glossy cabin canopy
  const cabinMat = new THREE.MeshBasicMaterial({ color: 0x0b2234 });
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.28, 1.15), cabinMat);
  cabin.position.set(0, 0.56, -0.1);
  group.add(cabin);

  // Cyan windshield visor strip
  const visorMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.08, 0.14), visorMat);
  visor.position.set(0, 0.54, 0.44);
  group.add(visor);

  // Rear spoiler wing
  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.06, 0.26), stripeMat);
  spoiler.position.set(0, 0.58, -1.04);
  group.add(spoiler);

  // Twin bright headlights facing +Z (coming down the road toward viewer/robot)
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff4d2 });
  for (const sx of [-0.42, 0.42]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.09, 0.08), headMat);
    lamp.position.set(sx, 0.28, 1.17);
    group.add(lamp);
  }

  // Under-chassis neon hover glow
  const underMat = new THREE.MeshBasicMaterial({
    color: 0x00e5ff,
    transparent: true,
    opacity: 0.72,
    side: THREE.DoubleSide,
  });
  const under = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 1.95), underMat);
  under.rotation.x = Math.PI / 2;
  under.position.y = 0.05;
  group.add(under);

  // 4 wheels with glowing cyan/amber rims
  const tireGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.18, 14);
  tireGeo.rotateZ(Math.PI / 2);
  const tireMat = new THREE.MeshBasicMaterial({ color: 0x111116 });
  const rimGeo = new THREE.TorusGeometry(0.16, 0.032, 8, 16);
  rimGeo.rotateY(Math.PI / 2);
  const rimMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });

  for (const [wx, wz] of [[-0.64, 0.72], [0.64, 0.72], [-0.64, -0.72], [0.64, -0.72]]) {
    const wGroup = new THREE.Group();
    wGroup.position.set(wx, 0.24, wz);
    wGroup.add(new THREE.Mesh(tireGeo, tireMat));
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.position.x = wx < 0 ? -0.09 : 0.09;
    wGroup.add(rim);
    group.add(wGroup);
    wheels.push(wGroup);
  }

  group.userData.wheels = wheels;
  return group;
}

/**
 * Build a stylized 3D futuristic neon cyber-bike (motorcycle) with glowing wheels.
 */
function createCyberBike() {
  const group = new THREE.Group();
  const wheels = [];

  // Aggressive cyber-bike body & fairing
  const frameMat = new THREE.MeshBasicMaterial({ color: 0xff5518 });
  const darkMat = new THREE.MeshBasicMaterial({ color: 0x171820 });
  const cyanMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.34, 1.25), darkMat);
  chassis.position.set(0, 0.44, 0);
  group.add(chassis);

  const fairing = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.28, 0.78), frameMat);
  fairing.position.set(0, 0.58, 0.25);
  fairing.rotation.x = 0.22;
  group.add(fairing);

  const windscreen = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.26, 0.08), cyanMat);
  windscreen.position.set(0, 0.78, 0.44);
  windscreen.rotation.x = -0.45;
  group.add(windscreen);

  // Handlebars
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.05, 0.07), darkMat);
  bar.position.set(0, 0.76, 0.34);
  group.add(bar);

  // Bright headlight facing +Z
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.09), new THREE.MeshBasicMaterial({ color: 0xfff8dc }));
  lamp.position.set(0, 0.56, 0.66);
  group.add(lamp);

  // Twin glowing neon ring wheels (distinct motorcycle silhouette)
  const tireGeo = new THREE.TorusGeometry(0.3, 0.085, 10, 20);
  tireGeo.rotateY(Math.PI / 2);
  const rimGeo = new THREE.TorusGeometry(0.24, 0.032, 8, 20);
  rimGeo.rotateY(Math.PI / 2);
  const tireMat = new THREE.MeshBasicMaterial({ color: 0x101016 });

  for (const wz of [0.68, -0.68]) {
    const wGroup = new THREE.Group();
    wGroup.position.set(0, 0.34, wz);
    wGroup.add(new THREE.Mesh(tireGeo, tireMat));
    wGroup.add(new THREE.Mesh(rimGeo, cyanMat));
    group.add(wGroup);
    wheels.push(wGroup);
  }

  group.userData.wheels = wheels;
  return group;
}

class LandingScene {
  constructor(container) {
    this.container = container;
    this.paused = false;
    this.disposed = false;
    this.frameId = 0;
    this.lastTime = 0;
    this.elapsed = 0;

    // Infinite chase & kick state
    this.runPhase = 0.25;
    this.robotZ = ROBOT_BASE_Z;
    this.lastStrikeHalf = -1;
    this.blinkTimer = 2.4;
    this.blinkProgress = 0;

    // Punch animation state
    this.punchActive = false;
    this.punchTimer = 0;
    this.punchSide = 1; // -1 = left fist punch, +1 = right fist punch
    this.punchImpactDone = false;

    // Camera impact shake
    this.shakeTime = 0;
    this.shakeMag = 0;

    // Approaching/kicked vehicle state
    this.nextVehicleType = 'car';
    this.vehicleCooldown = 1.4;
    this.activeVehicle = null;

    // Pointer parallax state
    this.pointerX = 0;
    this.pointerY = 0;
    this.smoothPtrX = 0;
    this.smoothPtrY = 0;

    // FX pools
    this.shockwaves = [];
    this.sparks = [];
    this.speedLines = [];

    // Sprites
    this.sprites = {};
    this.spritesReady = false;
    this.loadSprites();

    // Build DOM layers: WebGL canvas (under) + 2D crisp robot/FX canvas (over)
    this.webglReady = this.initThreeScene();
    this.initOverlayCanvas();
    this.bindEvents();
    this.setSize();
  }

  loadSprites() {
    const keys = Object.keys(SPRITE_FILES);
    let loaded = 0;
    for (const key of keys) {
      const img = new Image();
      img.onload = () => {
        loaded += 1;
        if (loaded === keys.length) {
          this.spritesReady = true;
        }
      };
      img.src = SPRITE_FILES[key];
      this.sprites[key] = img;
    }
  }

  initThreeScene() {
    try {
      this.renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.setClearColor(0x000000, 0);

      const glEl = this.renderer.domElement;
      glEl.className = 'landing-scene-canvas landing-scene-gl';
      this.container.appendChild(glEl);

      this.scene = new THREE.Scene();
      this.scene.fog = new THREE.FogExp2(0x3a0502, 0.019);

      this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 220);
      this.camera.position.set(0, 0.52, 6.4);

      this.roadGroup = new THREE.Group();
      this.roadGroup.position.y = ROAD_BASE_Y;
      this.scene.add(this.camera);
      this.scene.add(this.roadGroup);

      // 1. Horizon glowing crimson-orange radiance behind vanishing point
      this.horizonTex = createGlowTexture(
        'rgba(255, 130, 50, 0.92)',
        'rgba(218, 36, 4, 0.55)',
        'rgba(40, 2, 1, 0)'
      );
      const horizonMat = new THREE.SpriteMaterial({
        map: this.horizonTex,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.9,
      });
      this.horizonSprite = new THREE.Sprite(horizonMat);
      this.horizonSprite.position.set(0, 1.4, -76);
      this.horizonSprite.scale.set(95, 58, 1);
      this.scene.add(this.horizonSprite);

      // 2. Main flying roadway surface
      this.roadTex = createRoadTexture();
      const roadGeo = new THREE.PlaneGeometry(ROAD_WIDTH, ROAD_LENGTH, 1, 1);
      roadGeo.rotateX(-Math.PI / 2);
      const roadMat = new THREE.MeshBasicMaterial({
        map: this.roadTex,
      });
      this.roadMesh = new THREE.Mesh(roadGeo, roadMat);
      this.roadMesh.position.set(0, 0, -ROAD_LENGTH * 0.5 + 10);
      this.roadGroup.add(this.roadMesh);

      // 3. Thick floating under-deck slab & glowing anti-gravity plasma belly
      const slabGeo = new THREE.BoxGeometry(ROAD_WIDTH + 0.36, 0.24, ROAD_LENGTH);
      const slabMat = new THREE.MeshBasicMaterial({ color: 0x160506 });
      const slabMesh = new THREE.Mesh(slabGeo, slabMat);
      slabMesh.position.set(0, -0.14, -ROAD_LENGTH * 0.5 + 10);
      this.roadGroup.add(slabMesh);

      const coreGeo = new THREE.PlaneGeometry(ROAD_WIDTH * 0.55, ROAD_LENGTH);
      coreGeo.rotateX(Math.PI / 2);
      const coreMat = new THREE.MeshBasicMaterial({
        color: 0xff5a1f,
        transparent: true,
        opacity: 0.72,
        side: THREE.DoubleSide,
      });
      const coreMesh = new THREE.Mesh(coreGeo, coreMat);
      coreMesh.position.set(0, -0.27, -ROAD_LENGTH * 0.5 + 10);
      this.roadGroup.add(coreMesh);

      // 4. Floating side neon guard rails
      const railGeo = new THREE.BoxGeometry(0.08, 0.08, ROAD_LENGTH);
      const railMatAmber = new THREE.MeshBasicMaterial({ color: 0xff6b2b });
      const railMatCyan = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
      for (const side of [-1, 1]) {
        const railOuter = new THREE.Mesh(railGeo, railMatAmber);
        railOuter.position.set(side * (ROAD_WIDTH * 0.5 + 0.28), 0.16, -ROAD_LENGTH * 0.5 + 10);
        this.roadGroup.add(railOuter);

        const railInner = new THREE.Mesh(railGeo, railMatCyan);
        railInner.position.set(side * (ROAD_WIDTH * 0.5 + 0.14), 0.05, -ROAD_LENGTH * 0.5 + 10);
        this.roadGroup.add(railInner);
      }

      // 5. Floating anti-grav side wing-pylons & sky arches flying past endlessly
      this.pylons = [];
      const pylonCount = 14;
      const pylonSpacing = 8.2;
      this.pylonLoopDist = pylonCount * pylonSpacing;
      const wingGeo = new THREE.BoxGeometry(0.75, 0.09, 1.8);
      const wingMat = new THREE.MeshBasicMaterial({ color: 0x260808 });
      const beaconGeo = new THREE.BoxGeometry(0.14, 0.16, 1.4);
      const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff8c2a });
      const thrusterGeo = new THREE.ConeGeometry(0.28, 0.95, 8);
      const thrusterMat = new THREE.MeshBasicMaterial({
        color: 0xff4514,
        transparent: true,
        opacity: 0.45,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const archGeo = new THREE.BoxGeometry(ROAD_WIDTH + 1.4, 0.055, 0.12);
      const archMat = new THREE.MeshBasicMaterial({
        color: 0xff5e22,
        transparent: true,
        opacity: 0.5,
      });

      for (let i = 0; i < pylonCount; i++) {
        const pair = new THREE.Group();
        const zPos = 8 - i * pylonSpacing;
        pair.position.z = zPos;

        for (const side of [-1, 1]) {
          const wing = new THREE.Mesh(wingGeo, wingMat);
          wing.position.set(side * (ROAD_WIDTH * 0.5 + 0.95), -0.04, 0);
          wing.rotation.z = side * -0.14;
          pair.add(wing);

          const beacon = new THREE.Mesh(beaconGeo, beaconMat);
          beacon.position.set(side * (ROAD_WIDTH * 0.5 + 0.56), 0.12, 0);
          pair.add(beacon);

          const thruster = new THREE.Mesh(thrusterGeo, thrusterMat);
          thruster.position.set(side * (ROAD_WIDTH * 0.5 + 1.05), -0.58, 0);
          thruster.rotation.x = Math.PI;
          pair.add(thruster);
        }

        // Every 3rd pylon has a sleek overhead floating light-bar gate
        if (i % 3 === 0) {
          const topBar = new THREE.Mesh(archGeo, archMat);
          topBar.position.set(0, 2.75, 0);
          pair.add(topBar);

          const postGeo = new THREE.BoxGeometry(0.06, 2.65, 0.09);
          for (const side of [-1, 1]) {
            const post = new THREE.Mesh(postGeo, archMat);
            post.position.set(side * (ROAD_WIDTH * 0.5 + 0.64), 1.42, 0);
            pair.add(post);
          }
        }

        this.roadGroup.add(pair);
        this.pylons.push(pair);
      }

      // 6. Embers & flying air-streak particles around the road
      const particleCount = 420;
      const positions = new Float32Array(particleCount * 3);
      const colors = new Float32Array(particleCount * 3);
      this.particleSpeeds = new Float32Array(particleCount);
      for (let i = 0; i < particleCount; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 24;
        positions[i * 3 + 1] = -3.8 + Math.random() * 9.0;
        positions[i * 3 + 2] = 8 - Math.random() * 105;
        this.particleSpeeds[i] = 16 + Math.random() * 24;

        const isCyan = Math.random() < 0.14;
        colors[i * 3] = isCyan ? 0.15 : 1.0;
        colors[i * 3 + 1] = isCyan ? 0.92 : 0.35 + Math.random() * 0.45;
        colors[i * 3 + 2] = isCyan ? 1.0 : 0.12;
      }
      const pGeo = new THREE.BufferGeometry();
      pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      pGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      this.emberTex = createGlowTexture(
        'rgba(255,255,255,1)',
        'rgba(255,160,60,0.65)',
        'rgba(255,60,10,0)'
      );
      const pMat = new THREE.PointsMaterial({
        size: 0.22,
        map: this.emberTex,
        vertexColors: true,
        transparent: true,
        opacity: 0.88,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      this.particles = new THREE.Points(pGeo, pMat);
      this.scene.add(this.particles);

      // 7. Pre-build reusable 3D cyber-car & cyber-bike for road kick encounters
      this.carMesh = createCyberCar();
      this.bikeMesh = createCyberBike();
      this.carMesh.visible = false;
      this.bikeMesh.visible = false;
      this.roadGroup.add(this.carMesh);
      this.roadGroup.add(this.bikeMesh);

      return true;
    } catch (err) {
      console.warn('WebGL unavailable, falling back to 2D flying road renderer:', err);
      return false;
    }
  }

  initOverlayCanvas() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'landing-scene-canvas landing-scene-overlay';
    this.ctx = this.canvas.getContext('2d');
    this.container.appendChild(this.canvas);
  }

  bindEvents() {
    this.onResize = () => this.setSize();
    const updatePointer = (clientX, clientY) => {
      const rect = this.container.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      this.pointerX = clamp(((clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
      this.pointerY = clamp(((clientY - rect.top) / rect.height) * 2 - 1, -1, 1);
    };
    this.onPointerMove = (e) => updatePointer(e.clientX, e.clientY);
    this.onTouchMove = (e) => {
      if (e.touches && e.touches.length) {
        updatePointer(e.touches[0].clientX, e.touches[0].clientY);
      }
    };
    window.addEventListener('resize', this.onResize);
    window.visualViewport?.addEventListener('resize', this.onResize);
    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    window.addEventListener('touchmove', this.onTouchMove, { passive: true });
  }

  setSize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const aspect = w / Math.max(1, h);

    this.width = w;
    this.height = h;
    this.dpr = dpr;
    this.baseCameraZ = aspect < 0.85 ? 7.2 : 6.4;

    if (this.webglReady && this.renderer) {
      this.renderer.setSize(w, h);
      this.camera.aspect = aspect;
      // Widen vertical FOV smoothly on narrow portrait mobile so the flying road & vehicles stay in frame
      this.camera.fov = aspect < 1 ? clamp(48 / Math.max(0.56, aspect * 1.14), 48, 74) : 48;
      this.camera.updateProjectionMatrix();
    }

    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  setPaused(paused) {
    this.paused = !!paused;
    if (!this.paused && !this.disposed && !this.frameId) {
      this.lastTime = performance.now();
      this.loop(this.lastTime);
    }
  }

  start() {
    this.lastTime = performance.now();
    this.loop(this.lastTime);
  }

  loop(now) {
    if (this.disposed) return;
    if (this.paused) {
      this.frameId = 0;
      return;
    }

    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTime) / 1000));
    this.lastTime = now;
    this.elapsed += dt;

    this.update(dt);
    this.render();

    this.frameId = requestAnimationFrame((t) => this.loop(t));
  }

  update(dt) {
    // Smooth pointer parallax
    const ease = 1 - Math.exp(-dt * 5);
    this.smoothPtrX += (this.pointerX - this.smoothPtrX) * ease;
    this.smoothPtrY += (this.pointerY - this.smoothPtrY) * ease;

    // Endless relentless chase + punch lunge (never stops or resets)
    this.runPhase += RUN_OMEGA * dt;
    let punchT = 0;
    let punchLunge = 0;
    if (this.punchActive) {
      this.punchTimer += dt;
      punchT = clamp(this.punchTimer / PUNCH_DURATION, 0, 1);
      punchLunge = Math.sin(punchT * Math.PI) * 0.52;
      if (this.punchTimer >= PUNCH_DURATION) {
        this.punchActive = false;
        this.punchTimer = 0;
      }
    }

    this.robotZ =
      ROBOT_BASE_Z +
      Math.sin(this.elapsed * 1.15) * 0.65 +
      Math.sin(this.elapsed * 2.55) * 0.24 +
      punchLunge;

    const halfStep = Math.floor(this.runPhase / Math.PI);
    const roadHoverY = Math.sin(this.elapsed * 1.45) * 0.055;

    // Decay impact shake
    let shakeX = 0;
    let shakeY = 0;
    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - dt);
      const decay = this.shakeTime / 0.24;
      shakeX = (Math.random() - 0.5) * this.shakeMag * decay;
      shakeY = (Math.random() - 0.5) * this.shakeMag * decay;
    }

    if (this.webglReady) {
      // Subtle right-of-center framing on desktop; center & lift slightly above mobile bottom dock on phones
      const isMobile = this.width <= 860;
      const desktopBias = isMobile ? 0 : -0.18;
      const lookY = isMobile ? -0.18 : -0.46;
      this.camera.position.x = desktopBias + this.smoothPtrX * 0.28 + shakeX;
      this.camera.position.y = (isMobile ? 0.62 : 0.54) - this.smoothPtrY * 0.14 + shakeY;
      this.camera.position.z = this.baseCameraZ || 6.4;
      this.camera.lookAt(desktopBias * 0.9, lookY, -24);

      this.roadGroup.position.y = ROAD_BASE_Y + roadHoverY;
      this.roadGroup.rotation.z = -this.smoothPtrX * 0.028 + Math.sin(this.elapsed * 0.9) * 0.007;

      // Scroll road & fly side pylons BACKWARD (-Z) into horizon as camera retreats ahead of the chasing robot
      this.roadTex.offset.y -= (ROAD_SCROLL_SPEED / (ROAD_LENGTH / 14)) * dt;
      const minPylonZ = 10 - this.pylonLoopDist;
      for (const pylon of this.pylons) {
        pylon.position.z -= ROAD_SCROLL_SPEED * dt;
        if (pylon.position.z < minPylonZ) {
          pylon.position.z += this.pylonLoopDist;
        }
      }

      // Embers stream backward past the charging robot into the crimson horizon
      const posAttr = this.particles.geometry.getAttribute('position');
      const arr = posAttr.array;
      for (let i = 0; i < this.particleSpeeds.length; i++) {
        arr[i * 3 + 2] -= this.particleSpeeds[i] * dt;
        if (arr[i * 3 + 2] < -95) {
          arr[i * 3] = (Math.random() - 0.5) * 24;
          arr[i * 3 + 1] = -3.8 + Math.random() * 9.0;
          arr[i * 3 + 2] = 9 + Math.random() * 4;
        }
      }
      posAttr.needsUpdate = true;

      // Subtle horizon glow breath
      const pulse = 1 + Math.sin(this.elapsed * 2.1) * 0.04;
      this.horizonSprite.scale.set(95 * pulse, 58 * pulse, 1);
    }

    // Update approaching / punched car & bike encounters
    this.updateVehicle(dt, roadHoverY, punchT);

    // Compute anchor screen position on the flying road at live robotZ
    const anchor = this.getRoadAnchor(roadHoverY);
    anchor.x += shakeX * 90;
    anchor.y += shakeY * 90;
    this.currentAnchor = anchor;

    // Detect footfall impact moments (twice per full cycle)
    if (halfStep !== this.lastStrikeHalf) {
      this.lastStrikeHalf = halfStep;
      const footSide = halfStep % 2 === 0 ? 1 : -1;
      this.spawnFootfallFX(anchor.x + footSide * anchor.scale * 22, anchor.y, anchor.scale, 1);
    }

    // Occasional natural eye blink
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blinkProgress += dt / 0.14;
      if (this.blinkProgress >= 1) {
        this.blinkProgress = 0;
        this.blinkTimer = 2.6 + Math.random() * 3.2;
      }
    }

    // Update FX pools (shockwaves drift backward into horizon with the flying road)
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.life += dt;
      sw.y -= dt * 32 * sw.scale;
      if (sw.life >= sw.maxLife) this.shockwaves.splice(i, 1);
    }

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const sp = this.sparks[i];
      sp.life += dt;
      sp.x += sp.vx * dt;
      sp.y += sp.vy * dt;
      sp.vy += 260 * dt;
      if (sp.life >= sp.maxLife) this.sparks.splice(i, 1);
    }

    // Continuous radial chase speed lines bursting outward so it feels like the robot is catching you endlessly
    const surge = smoothstep(0.4, 2.2, this.robotZ);
    const maxLines = 22 + Math.round(surge * 18);
    if (this.speedLines.length < maxLines && Math.random() < (0.45 + surge * 0.4)) {
      const angle = Math.random() * Math.PI * 2;
      const rStart = (50 + Math.random() * 145) * anchor.scale;
      const speed = (280 + surge * 340) * (0.7 + Math.random() * 0.6);
      this.speedLines.push({
        x: anchor.x + Math.cos(angle) * rStart,
        y: anchor.y - 95 * anchor.scale + Math.sin(angle) * rStart * 0.75,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.75,
        len: 32 + Math.random() * (44 + surge * 40),
        life: 0,
        maxLife: 0.22 + Math.random() * 0.22,
        cyan: Math.random() < 0.3,
      });
    }
    for (let i = this.speedLines.length - 1; i >= 0; i--) {
      const sl = this.speedLines[i];
      sl.life += dt;
      sl.x += sl.vx * dt;
      sl.y += sl.vy * dt;
      if (sl.life >= sl.maxLife) this.speedLines.splice(i, 1);
    }
  }

  updateVehicle(dt, roadHoverY, punchT) {
    if (!this.activeVehicle) {
      this.vehicleCooldown -= dt;
      if (this.vehicleCooldown <= 0) {
        this.spawnVehicle();
      }
      return;
    }

    const v = this.activeVehicle;
    if (v.state === 'approaching') {
      v.z += VEHICLE_SPEED * dt;

      // Trigger robot wind-up punch shortly before impact
      if (!this.punchActive && v.z >= this.robotZ - 4.5) {
        this.punchActive = true;
        this.punchTimer = 0;
        this.punchSide = v.laneSide;
        this.punchImpactDone = false;
      }

      // Connect punch at peak fist strike frame (or fallback if vehicle reached robotZ)
      if ((this.punchActive && !this.punchImpactDone && punchT >= 0.40) || v.z >= this.robotZ + 0.1) {
        this.punchImpactDone = true;
        v.state = 'punched';
        v.vx = v.laneSide * (12.5 + Math.random() * 3.5);
        v.vy = 6.6 + Math.random() * 2.2;
        v.vz = 15.5 + Math.random() * 3.5;
        v.rx = (Math.random() > 0.5 ? 1 : -1) * 8.0;
        v.ry = v.laneSide * 10.0;
        v.rz = -v.laneSide * 9.0;

        this.shakeTime = 0.24;
        this.shakeMag = 0.16;
        this.spawnPunchImpactFX(v.x, ROAD_BASE_Y + roadHoverY + 0.55, v.z);
      }
    } else if (v.state === 'punched') {
      v.x += v.vx * dt;
      v.y += v.vy * dt;
      v.z += v.vz * dt;
      v.vy -= 11.0 * dt;
      v.rotX += v.rx * dt;
      v.rotY += v.ry * dt;
      v.rotZ += v.rz * dt;

      if (v.z > 9.5 || Math.abs(v.x) > 15 || v.y > 11 || v.y < -8) {
        if (v.mesh) v.mesh.visible = false;
        this.activeVehicle = null;
        this.vehicleCooldown = 1.6 + Math.random() * 1.4;
        return;
      }
    }

    if (this.webglReady && v.mesh) {
      v.mesh.position.set(v.x, v.y, v.z);
      v.mesh.rotation.set(v.rotX, v.rotY, v.rotZ);
      const wheels = v.mesh.userData.wheels || [];
      for (const w of wheels) {
        w.rotation.x += 22 * dt;
      }
    }
  }

  spawnVehicle() {
    const type = this.nextVehicleType;
    this.nextVehicleType = type === 'car' ? 'bike' : 'car';
    const laneSide = Math.random() < 0.5 ? -1 : 1;

    let mesh = null;
    if (this.webglReady) {
      mesh = type === 'car' ? this.carMesh : this.bikeMesh;
      mesh.visible = true;
    }

    const laneOffset = (this.width && this.width <= 860) ? 0.74 : 0.92;
    this.activeVehicle = {
      type,
      laneSide,
      state: 'approaching',
      x: laneSide * laneOffset,
      y: 0.02,
      z: -46,
      vx: 0,
      vy: 0,
      vz: 0,
      rotX: 0,
      rotY: 0,
      rotZ: type === 'bike' ? laneSide * 0.12 : 0,
      rx: 0,
      ry: 0,
      rz: 0,
      mesh,
    };

    if (mesh) {
      mesh.position.set(this.activeVehicle.x, this.activeVehicle.y, this.activeVehicle.z);
      mesh.rotation.set(0, 0, this.activeVehicle.rotZ);
    }
  }

  spawnPunchImpactFX(worldX, worldY, worldZ) {
    const w = this.width || 1280;
    const h = this.height || 720;
    let sx = w * 0.5 + worldX * 140;
    let sy = h * 0.62;
    if (this.webglReady) {
      const p = new THREE.Vector3(worldX, worldY, worldZ);
      p.project(this.camera);
      sx = (p.x * 0.5 + 0.5) * w;
      sy = (-p.y * 0.5 + 0.5) * h;
    }
    const scale = this.currentAnchor ? this.currentAnchor.scale : 1;

    this.shockwaves.push({
      x: sx,
      y: sy,
      scale: scale * 1.45,
      alpha: 1,
      life: 0,
      maxLife: 0.42,
    });

    for (let i = 0; i < 24; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = (200 + Math.random() * 440) * scale;
      this.sparks.push({
        x: sx,
        y: sy,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 90 * scale,
        size: (3.0 + Math.random() * 4.5) * scale,
        life: 0,
        maxLife: 0.34 + Math.random() * 0.25,
        cyan: i % 2 === 0,
      });
    }
  }

  getRoadAnchor(roadHoverY) {
    const w = this.width || 1280;
    const h = this.height || 720;
    const isMobile = w <= 860;
    const cameraZ = this.webglReady ? this.camera.position.z : (this.baseCameraZ || 6.4);
    const dist = Math.max(2.1, cameraZ - this.robotZ);

    let x = isMobile ? w * 0.5 : w * 0.56;
    let y = isMobile ? h * 0.56 : h * 0.72;

    if (this.webglReady) {
      const p = new THREE.Vector3(0, ROAD_BASE_Y + roadHoverY, this.robotZ);
      p.project(this.camera);
      x = (p.x * 0.5 + 0.5) * w;
      y = (-p.y * 0.5 + 0.5) * h;
    }

    const baseHeight = isMobile
      ? clamp(Math.min(h * 0.30, w * 0.54), 135, 240)
      : clamp(h * 0.39, 210, 330);
    const scale = (baseHeight / 276) * (cameraZ / dist);

    return { x, y, scale, alpha: 1 };
  }

  spawnFootfallFX(x, y, scale, alpha = 1) {
    if (alpha < 0.15) return;
    this.shockwaves.push({
      x,
      y,
      scale,
      alpha,
      life: 0,
      maxLife: 0.38,
    });

    for (let i = 0; i < 10; i++) {
      const angle = -Math.PI * (0.1 + Math.random() * 0.8);
      const speed = (110 + Math.random() * 210) * scale;
      this.sparks.push({
        x,
        y: y - 4 * scale,
        vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 90,
        vy: Math.sin(angle) * speed * 0.55 - 20,
        size: (2.2 + Math.random() * 3.2) * scale,
        life: 0,
        maxLife: 0.28 + Math.random() * 0.22,
        cyan: i % 3 === 0,
      });
    }
  }

  render() {
    if (this.webglReady) {
      this.renderer.render(this.scene, this.camera);
    }

    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    // Fallback 2D perspective flying road if WebGL is unavailable
    if (!this.webglReady) {
      this.renderFallbackRoad2D(ctx);
    }

    const anchor = this.currentAnchor || this.getRoadAnchor(0);
    this.renderRoadFX(ctx, anchor);

    if (this.spritesReady) {
      this.renderRobot(ctx, anchor);
    }

    this.renderForegroundFX(ctx);
    ctx.restore();
  }

  renderFallbackRoad2D(ctx) {
    const w = this.width;
    const h = this.height;
    const vx = w > 860 ? w * 0.58 : w * 0.5;
    const vy = h * 0.43;

    // Crimson horizon glow
    const sun = ctx.createRadialGradient(vx, vy, 10, vx, vy, Math.max(w, h) * 0.55);
    sun.addColorStop(0, 'rgba(255, 110, 35, 0.72)');
    sun.addColorStop(0.4, 'rgba(180, 20, 4, 0.35)');
    sun.addColorStop(1, 'rgba(10, 1, 2, 0)');
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, w, h);

    // Flying road trapezoid
    const topHalf = w * 0.025;
    const botHalf = Math.min(w * 0.36, 440);
    ctx.beginPath();
    ctx.moveTo(vx - topHalf, vy);
    ctx.lineTo(vx + topHalf, vy);
    ctx.lineTo(vx + botHalf, h + 10);
    ctx.lineTo(vx - botHalf, h + 10);
    ctx.closePath();
    ctx.fillStyle = '#150809';
    ctx.fill();

    // Glowing rails
    ctx.strokeStyle = '#ff591c';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(vx - topHalf, vy);
    ctx.lineTo(vx - botHalf, h + 10);
    ctx.moveTo(vx + topHalf, vy);
    ctx.lineTo(vx + botHalf, h + 10);
    ctx.stroke();

    // Infinite center dashes flowing backward into horizon
    const loop = 1 - ((this.elapsed * 3.2) % 1);
    for (let i = 0; i < 8; i++) {
      const t0 = ((i + loop) / 8);
      const t1 = ((i + loop + 0.45) / 8);
      const p0 = t0 * t0;
      const p1 = Math.min(1, t1 * t1);
      const y0 = vy + (h - vy) * p0;
      const y1 = vy + (h - vy) * p1;
      ctx.strokeStyle = `rgba(255, 165, 55, ${0.25 + p0 * 0.75})`;
      ctx.lineWidth = 2 + p0 * 10;
      ctx.beginPath();
      ctx.moveTo(vx, y0);
      ctx.lineTo(vx, y1);
      ctx.stroke();
    }

    // Fallback 2D car/bike silhouette if WebGL is unavailable
    if (this.activeVehicle) {
      const v = this.activeVehicle;
      const dist = Math.max(1.2, 6.4 - v.z);
      const pScale = 6.4 / dist;
      const sx = vx + v.x * 110 * pScale;
      const sy = vy + (h * 0.34 - v.y * 85) * Math.min(2.2, pScale);
      const vw = (v.type === 'car' ? 92 : 44) * pScale;
      const vh = (v.type === 'car' ? 46 : 62) * pScale;

      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(v.rotZ);
      ctx.fillStyle = v.type === 'car' ? '#2c0a12' : '#ff5518';
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 2;
      ctx.fillRect(-vw * 0.5, -vh, vw, vh);
      ctx.strokeRect(-vw * 0.5, -vh, vw, vh);
      ctx.fillStyle = '#fff5d6';
      ctx.fillRect(-vw * 0.35, -vh * 0.45, vw * 0.22, vh * 0.2);
      if (v.type === 'car') {
        ctx.fillRect(vw * 0.13, -vh * 0.45, vw * 0.22, vh * 0.2);
      }
      ctx.restore();
    }
  }

  renderRoadFX(ctx, anchor) {
    const s = anchor.scale;
    const bounceAbs = Math.abs(Math.sin(this.runPhase));
    const visAlpha = anchor.alpha ?? 1;

    // Dynamic perspective contact shadow on the flying road
    if (visAlpha > 0.02) {
      ctx.save();
      ctx.globalAlpha = visAlpha;
      const shadowW = (76 - bounceAbs * 14) * s;
      const shadowH = (18 - bounceAbs * 4) * s;
      const shGrad = ctx.createRadialGradient(
        anchor.x, anchor.y + 4 * s, 2,
        anchor.x, anchor.y + 4 * s, shadowW
      );
      shGrad.addColorStop(0, 'rgba(4, 1, 2, 0.85)');
      shGrad.addColorStop(0.65, 'rgba(18, 2, 2, 0.55)');
      shGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = shGrad;
      ctx.beginPath();
      ctx.ellipse(anchor.x, anchor.y + 4 * s, shadowW, shadowH, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Footfall energy shockwaves on the road
    for (const sw of this.shockwaves) {
      const t = sw.life / sw.maxLife;
      const alpha = (1 - t) * 0.75 * (sw.alpha ?? 1);
      const rx = (18 + t * 58) * sw.scale;
      const ry = (5 + t * 16) * sw.scale;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(255, 170, 50, ${alpha})`;
      ctx.lineWidth = (2.5 - t * 1.6) * sw.scale;
      ctx.beginPath();
      ctx.ellipse(sw.x, sw.y, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = `rgba(0, 229, 255, ${alpha * 0.75})`;
      ctx.lineWidth = (1.6 - t * 1.0) * sw.scale;
      ctx.beginPath();
      ctx.ellipse(sw.x, sw.y, rx * 0.72, ry * 0.72, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * Draw an articulated sprite part with local 1x pivot coordinates (auto-scaled to 2x PNG).
   */
  drawPart(ctx, img, x, y, pivot1xX, pivot1xY, w1x, h1x, scale, rot = 0, scaleX = 1, scaleY = 1, alpha = 1) {
    const finalAlpha = alpha * (this.activeRobotAlpha ?? 1);
    if (!img || !img.complete || finalAlpha <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = finalAlpha;
    ctx.translate(x, y);
    if (rot) ctx.rotate(rot);
    ctx.scale(scale * scaleX, scale * scaleY);
    ctx.drawImage(img, -pivot1xX, -pivot1xY, w1x, h1x);
    ctx.restore();
  }

  renderRobot(ctx, anchor) {
    const visAlpha = anchor.alpha ?? 1;
    if (visAlpha <= 0.01) return;

    const s = anchor.scale;
    const p = this.runPhase;
    this.activeRobotAlpha = visAlpha;

    // Energetic double-bounce + volume-preserving squash/stretch + punch lean
    const bounceAbs = Math.abs(Math.sin(p));
    const impact = Math.pow(1 - bounceAbs, 3);
    const punchT = this.punchActive ? clamp(this.punchTimer / PUNCH_DURATION, 0, 1) : 0;
    const punchSwing = this.punchActive
      ? (punchT < 0.24
        ? -(punchT / 0.24) * 0.38
        : Math.sin(Math.min(1, (punchT - 0.24) / 0.52) * Math.PI))
      : 0;

    const bounceY = (-bounceAbs * 14 + impact * 3.5 - Math.max(0, punchSwing) * 6) * s;
    const swayX = (Math.sin(p) * 5.5 + (this.punchActive ? this.punchSide * punchSwing * 14 : 0)) * s;
    const torsoRoll = Math.sin(p) * 0.065 + (this.punchActive ? this.punchSide * punchSwing * 0.18 : 0);
    const torsoSX = 1 + impact * 0.035;
    const torsoSY = 1 - impact * 0.035;

    const torsoX = anchor.x + swayX;
    const torsoY = anchor.y - RIG.groundOffsetY * s + bounceY;

    // Head follows torso with slight elastic delay
    const headBounceY = (-Math.abs(Math.sin(p - 0.35)) * 6) * s;
    const headRoll = Math.sin(p - 0.3) * 0.045;
    const headX = torsoX + RIG.head.offsetFromTorso.x * s;
    const headY = torsoY + RIG.head.offsetFromTorso.y * s + headBounceY;

    // Animated golden-amber speed wings behind the robot (echoing the source motion streaks)
    this.renderRobotAuraAndStreaks(ctx, torsoX, torsoY, s, p);

    // 1. LEGS (draw pushing/back leg behind driving/front leg)
    const legSpecs = [
      {
        side: -1, // Left leg (starts in push phase at p=0)
        phase: p + Math.PI,
        hipX: torsoX + RIG.hipLeftOffset.x * s,
        hipY: torsoY + RIG.hipLeftOffset.y * s,
        driveImg: this.sprites.legDriveMirror,
        drivePivot: RIG.legDrive.mirrorPivot,
        pushImg: this.sprites.legPush,
        pushPivot: RIG.legPush.pivot,
      },
      {
        side: 1, // Right leg (starts in knee-up drive at p=0)
        phase: p,
        hipX: torsoX + RIG.hipRightOffset.x * s,
        hipY: torsoY + RIG.hipRightOffset.y * s,
        driveImg: this.sprites.legDrive,
        drivePivot: RIG.legDrive.pivot,
        pushImg: this.sprites.legPushMirror,
        pushPivot: RIG.legPush.mirrorPivot,
      },
    ];

    // Sort so whichever leg is further forward draws last
    legSpecs.sort((a, b) => Math.sin(a.phase) - Math.sin(b.phase));

    for (const leg of legSpecs) {
      const driveSignal = Math.sin(leg.phase); // +1 = high knee forward, -1 = back push
      const cosSignal = Math.cos(leg.phase);

      // Switch cleanly at ds > 0.08 so crossover passes briefly through the sleek extended stance (never both knees wide)
      if (driveSignal > 0.08) {
        const dNorm = (driveSignal - 0.08) / 0.92;
        const driveLiftY = (-15 * dNorm + 5 * Math.max(0, -cosSignal)) * s;
        const driveScaleX = 0.96 + 0.10 * dNorm;
        const driveScaleY = 0.88 + 0.16 * dNorm;
        const driveRot = leg.side * (-0.11 * cosSignal);
        this.drawPart(
          ctx,
          leg.driveImg,
          leg.hipX,
          leg.hipY + driveLiftY,
          leg.drivePivot.x,
          leg.drivePivot.y,
          RIG.legDrive.w,
          RIG.legDrive.h,
          s,
          driveRot,
          driveScaleX,
          driveScaleY,
          1
        );
      } else {
        const back = Math.max(0, -driveSignal);
        const pushLiftY = (5 * back) * s;
        const pushScale = 1.0 - 0.10 * back;
        const pushScaleY = pushScale * (0.88 + 0.14 * Math.sin(back * Math.PI));
        const pushRot = leg.side * (0.16 * cosSignal);
        this.drawPart(
          ctx,
          leg.pushImg,
          leg.hipX,
          leg.hipY + pushLiftY,
          leg.pushPivot.x,
          leg.pushPivot.y,
          RIG.legPush.w,
          RIG.legPush.h,
          s,
          pushRot,
          pushScale,
          pushScaleY,
          1
        );
      }
    }

    // 2. TORSO
    this.drawPart(
      ctx,
      this.sprites.torso,
      torsoX,
      torsoY,
      RIG.torso.pivot.x,
      RIG.torso.pivot.y,
      RIG.torso.w,
      RIG.torso.h,
      s,
      torsoRoll,
      torsoSX,
      torsoSY,
      1
    );

    // 3. ARMS (contra-lateral pump: right arm pumps forward when left leg drives)
    const armCollarY = torsoY + headBounceY * 0.55;
    const armSpecs = [
      {
        side: -1,
        phase: p, // pumps forward when right leg drives
        sx: torsoX + RIG.armLeft.offsetFromTorso.x * s,
        sy: armCollarY + RIG.armLeft.offsetFromTorso.y * s,
        fwdImg: this.sprites.armRightMirror,
        fwdPivot: RIG.armRight.mirrorPivot,
        fwdW: RIG.armRight.w,
        backImg: this.sprites.armLeft,
        backPivot: RIG.armLeft.pivot,
        backW: RIG.armLeft.w,
      },
      {
        side: 1,
        phase: p + Math.PI,
        sx: torsoX + RIG.armRight.offsetFromTorso.x * s,
        sy: armCollarY + RIG.armRight.offsetFromTorso.y * s,
        fwdImg: this.sprites.armRight,
        fwdPivot: RIG.armRight.pivot,
        fwdW: RIG.armRight.w,
        backImg: this.sprites.armLeftMirror,
        backPivot: RIG.armLeft.mirrorPivot,
        backW: RIG.armLeft.w,
      },
    ];

    // 3. NON-PUNCHING ARM (draw before head), then 4. HEAD, then 5. PUNCHING ARM (foreground strike!)
    let activePunchArm = null;
    for (const arm of armSpecs) {
      const isPunchingArm = this.punchActive && arm.side === this.punchSide;
      if (isPunchingArm && punchSwing > 0.05) {
        activePunchArm = arm;
        continue;
      }

      const swing = Math.sin(arm.phase);
      const windUp = isPunchingArm && punchSwing < 0 ? punchSwing : 0;
      const armPumpY = (-9 * swing + windUp * 12) * s;
      const armRot = arm.side * (-0.24 * swing + 0.06 * Math.cos(arm.phase) - windUp * 0.7);
      const armScale = (0.96 + 0.09 * Math.abs(swing)) * (1 + windUp * 0.14);

      if (swing >= 0 && windUp === 0) {
        this.drawPart(
          ctx,
          arm.fwdImg,
          arm.sx,
          arm.sy + armPumpY,
          arm.fwdPivot.x,
          arm.fwdPivot.y,
          arm.fwdW,
          RIG.armRight.h,
          s,
          armRot,
          armScale,
          armScale,
          1
        );
      } else {
        this.drawPart(
          ctx,
          arm.backImg,
          arm.sx,
          arm.sy + armPumpY,
          arm.backPivot.x,
          arm.backPivot.y,
          arm.backW,
          RIG.armLeft.h,
          s,
          armRot,
          armScale,
          armScale,
          1
        );
      }
    }

    // 4. HEAD + GLOWING CYAN EYES + NATURAL BLINK
    this.drawPart(
      ctx,
      this.sprites.head,
      headX,
      headY,
      RIG.head.pivot.x,
      RIG.head.pivot.y,
      RIG.head.w,
      RIG.head.h,
      s,
      headRoll,
      torsoSX,
      torsoSY,
      1
    );

    this.renderEyeFX(ctx, headX, headY, s, headRoll, torsoSX, torsoSY);

    // 5. HAYMAKER PUNCHING FIST (drawn in foreground with glowing fist energy trail)
    if (activePunchArm) {
      const arm = activePunchArm;
      const punchX = arm.sx + arm.side * punchSwing * 28 * s;
      const punchY = arm.sy - punchSwing * 8 * s;
      const punchRot = -arm.side * 0.85 * punchSwing;
      const punchScale = 1.04 + 0.36 * punchSwing;

      // Glowing fist punch arc behind the striking fist
      if (punchSwing > 0.25) {
        const fistX = punchX + arm.side * 66 * punchScale * s;
        const fistY = punchY + 4 * s;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const fg = ctx.createRadialGradient(fistX, fistY, 2, fistX, fistY, 34 * s);
        fg.addColorStop(0, `rgba(255, 225, 110, ${0.75 * punchSwing})`);
        fg.addColorStop(0.5, `rgba(0, 235, 255, ${0.42 * punchSwing})`);
        fg.addColorStop(1, 'rgba(255, 100, 20, 0)');
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.arc(fistX, fistY, 34 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      this.drawPart(
        ctx,
        arm.fwdImg,
        punchX,
        punchY,
        arm.fwdPivot.x,
        arm.fwdPivot.y,
        arm.fwdW,
        RIG.armRight.h,
        s,
        punchRot,
        punchScale,
        punchScale,
        1
      );
    }
  }

  renderRobotAuraAndStreaks(ctx, torsoX, torsoY, s, p) {
    ctx.save();
    ctx.globalAlpha = this.activeRobotAlpha ?? 1;
    ctx.globalCompositeOperation = 'lighter';

    // Subtle crimson-gold speed wings flaring on left & right sides
    const flicker = 0.72 + Math.sin(p * 2.0) * 0.2;
    for (const side of [-1, 1]) {
      const startX = torsoX + side * 42 * s;
      const startY = torsoY - 12 * s;
      for (let k = 0; k < 3; k++) {
        const len = (72 + k * 24 + Math.sin(p * 3 + k) * 14) * s;
        const angle = side * (0.28 + k * 0.18);
        const endX = startX + side * Math.cos(angle) * len;
        const endY = startY + Math.sin(Math.abs(angle)) * len * 0.35 - k * 14 * s;

        const g = ctx.createLinearGradient(startX, startY, endX, endY);
        g.addColorStop(0, `rgba(255, 195, 65, ${0.32 * flicker})`);
        g.addColorStop(1, 'rgba(255, 90, 20, 0)');
        ctx.strokeStyle = g;
        ctx.lineWidth = (9 - k * 2.2) * s;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(startX, startY - k * 8 * s);
        ctx.lineTo(endX, endY);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  renderEyeFX(ctx, headX, headY, s, rot, sx, sy) {
    ctx.save();
    ctx.globalAlpha = this.activeRobotAlpha ?? 1;
    ctx.translate(headX, headY);
    if (rot) ctx.rotate(rot);
    ctx.scale(s * sx, s * sy);

    const pulse = 0.28 + Math.sin(this.elapsed * 5.2) * 0.08;
    const blinkAmount = this.blinkProgress > 0 ? Math.sin(this.blinkProgress * Math.PI) : 0;

    for (const eye of RIG.head.eyes) {
      const ex = eye.x - RIG.head.pivot.x;
      const ey = eye.y - RIG.head.pivot.y;

      // Subtle cyan eye energy bloom
      if (blinkAmount < 0.7) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const eg = ctx.createRadialGradient(ex, ey, 1, ex, ey, eye.r * 1.45);
        eg.addColorStop(0, `rgba(0, 245, 255, ${pulse * (1 - blinkAmount)})`);
        eg.addColorStop(1, 'rgba(0, 180, 255, 0)');
        ctx.fillStyle = eg;
        ctx.beginPath();
        ctx.arc(ex, ey, eye.r * 1.45, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Natural eyelid blink sweep
      if (blinkAmount > 0.02) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(ex, ey, eye.r * 0.92, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = '#d97b24';
        ctx.fillRect(ex - eye.r, ey - eye.r, eye.r * 2, eye.r * 2 * blinkAmount);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  renderForegroundFX(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // Sparks kicked up from the flying road
    for (const sp of this.sparks) {
      const t = sp.life / sp.maxLife;
      const alpha = 1 - t;
      ctx.fillStyle = sp.cyan
        ? `rgba(0, 235, 255, ${alpha})`
        : `rgba(255, 200, 75, ${alpha})`;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sp.size * (1 - t * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }

    // Wind speed lines rushing past the sides
    for (const sl of this.speedLines) {
      const t = sl.life / sl.maxLife;
      const alpha = Math.sin(t * Math.PI) * 0.55;
      const mag = Math.hypot(sl.vx, sl.vy) || 1;
      const dx = (sl.vx / mag) * sl.len;
      const dy = (sl.vy / mag) * sl.len;
      ctx.strokeStyle = sl.cyan
        ? `rgba(0, 229, 255, ${alpha})`
        : `rgba(255, 195, 85, ${alpha})`;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(sl.x, sl.y);
      ctx.lineTo(sl.x + dx, sl.y + dy);
      ctx.stroke();
    }

    ctx.restore();
  }

  dispose() {
    this.disposed = true;
    if (this.frameId) cancelAnimationFrame(this.frameId);
    window.removeEventListener('resize', this.onResize);
    window.visualViewport?.removeEventListener('resize', this.onResize);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('touchmove', this.onTouchMove);

    if (this.webglReady && this.renderer) {
      this.roadTex?.dispose();
      this.horizonTex?.dispose();
      this.emberTex?.dispose();
      this.renderer.dispose();
      if (this.renderer.domElement.parentNode === this.container) {
        this.container.removeChild(this.renderer.domElement);
      }
    }
    if (this.canvas && this.canvas.parentNode === this.container) {
      this.container.removeChild(this.canvas);
    }
  }
}

export function initLandingScene(container) {
  const scene = new LandingScene(container);
  scene.start();
  return {
    setPaused: (paused) => scene.setPaused(paused),
    destroy: () => scene.dispose(),
  };
}
