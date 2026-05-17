<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import {
  AmbientLight,
  AnimationMixer,
  Box3,
  Clock,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  OrthographicCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const props = defineProps({
  modelUrl: {
    type: String,
    required: true,
  },
  anchorX: {
    type: Number,
    default: 0.5,
  },
  anchorY: {
    type: Number,
    default: 0.58,
  },
});

const canvasRef = ref(null);
const particleCanvasRef = ref(null);
const glowRef = ref(null);

const isMobileDevice = window.matchMedia('(max-width: 720px)').matches;
const isLowPowerDevice = isMobileDevice || (navigator.hardwareConcurrency || 4) <= 4;
const targetFrameInterval = isLowPowerDevice ? 1000 / 24 : 1000 / 30;
const maxRenderWidth = isLowPowerDevice ? 480 : 720;
const appearDelay = 1.1;
const popDuration = 1.1;
const floatDelay = appearDelay + popDuration;
const modelFacingRotationY = -Math.PI / 2;
const soulEmissiveColor = new Color(0xd8f0df);

const PARTICLE_PALETTE = [
  'rgba(255, 248, 232, ALPHA)',
  'rgba(216, 240, 223, ALPHA)',
  'rgba(188, 219, 202, ALPHA)',
  'rgba(246, 221, 198, ALPHA)',
  'rgba(226, 235, 215, ALPHA)',
  'rgba(255, 255, 255, ALPHA)',
];

let rafId = 0;
let lastFrameTime = 0;
let pageVisible = true;
let resizeObserver = null;
let particleResizeObserver = null;
let renderer = null;
let scene = null;
let camera = null;
let root = null;
let model = null;
let animationRoot = null;
let clock = null;
let animationMixer = null;
let animationActions = [];
let modelMaterials = [];
let spawnAge = 0;

let particleCtx = null;
let particleDpr = 1;
let particleW = 0;
let particleH = 0;
let particleCx = 0;
let particleCy = 0;
let particles = [];

const spawnOrigin = new Vector3();

function clamp(value, min = 0, max = 1) {
  return Math.min(Math.max(value, min), max);
}

function smoothStep(value) {
  const progress = clamp(value);
  return progress * progress * (3 - 2 * progress);
}

function sampleSummonPop(progress) {
  const value = clamp(progress);
  const points = [
    { t: 0, opacity: 0, scale: 0, rotation: -30 },
    { t: 0.5, opacity: 1, scale: 1.15, rotation: 8 },
    { t: 0.7, opacity: 1, scale: 0.94, rotation: -4 },
    { t: 1, opacity: 1, scale: 1, rotation: 0 },
  ];

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const next = points[index];
    if (value <= next.t) {
      const localProgress = smoothStep((value - previous.t) / (next.t - previous.t));
      return {
        opacity: previous.opacity + (next.opacity - previous.opacity) * localProgress,
        scale: previous.scale + (next.scale - previous.scale) * localProgress,
        rotation: previous.rotation + (next.rotation - previous.rotation) * localProgress,
      };
    }
  }

  return points[points.length - 1];
}

function updateRootPosition() {
  if (!root) return;
  root.position.set(0, 0, 0);
}

function updateSpawnOrigin() {
  if (!camera) return;
  const worldX = camera.left + (camera.right - camera.left) * props.anchorX;
  const worldY = camera.top - (camera.top - camera.bottom) * props.anchorY;
  spawnOrigin.set(worldX, worldY, 0);
}

function createParticle() {
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.max(particleW, particleH) * 0.5 * (0.7 + Math.random() * 0.5);
  return {
    x: particleCx + Math.cos(angle) * radius,
    y: particleCy + Math.sin(angle) * radius,
    size: (1 + Math.random() * 2.2) * particleDpr,
    alpha: 0,
    color: PARTICLE_PALETTE[Math.floor(Math.random() * PARTICLE_PALETTE.length)],
    life: 0,
    delay: Math.random() * 0.55,
    phase: 'gather',
    spin: (Math.random() - 0.5) * 0.04,
    angle,
    radius,
    vx: 0,
    vy: 0,
    ambT: 0,
    ambR: 0,
    ambSpeed: 0,
    ambSeed: 0,
    ambIntensity: 0,
  };
}

function transitionToAmbient(p) {
  p.phase = 'ambient';
  p.ambT = 0;
  p.ambR = Math.min(particleW, particleH) * 0.16 + Math.random() * Math.min(particleW, particleH) * 0.22;
  p.ambSpeed = 0.25 + Math.random() * 0.5;
  p.ambSeed = Math.random() * Math.PI * 2;
  p.ambIntensity = 0.18 + Math.random() * 0.12;
  p.size *= 0.5;
}

function updateParticle(p, dt, elapsed) {
  if (p.phase === 'done') return;
  if (elapsed < p.delay) return;
  p.life += dt;
  const stepScale = dt * 60;

  if (p.phase === 'gather') {
    p.angle += p.spin * stepScale;
    p.radius *= Math.pow(0.965, stepScale);
    const wobble = Math.sin(p.life * 6) * 3 * particleDpr;
    p.x = particleCx + Math.cos(p.angle) * (p.radius + wobble);
    p.y = particleCy + Math.sin(p.angle) * (p.radius + wobble);
    p.alpha = Math.min(1, p.alpha + dt * 2.5);
    if (p.radius < 22 * particleDpr) {
      p.phase = 'burst';
      const dir = Math.random() * Math.PI * 2;
      const sp = (2.5 + Math.random() * 5) * particleDpr;
      p.vx = Math.cos(dir) * sp;
      p.vy = Math.sin(dir) * sp - 1.2 * particleDpr;
    }
  } else if (p.phase === 'burst') {
    p.x += p.vx * stepScale;
    p.y += p.vy * stepScale;
    const decay = Math.pow(0.94, stepScale);
    p.vx *= decay;
    p.vy *= decay;
    p.vy += 0.04 * particleDpr * stepScale;
    p.alpha -= dt * 0.7;
    if (p.alpha <= 0.02) {
      if (Math.random() < 0.22) {
        transitionToAmbient(p);
      } else {
        p.phase = 'done';
        p.alpha = 0;
      }
    }
  } else {
    p.ambT += dt;
    const r = p.ambR + Math.sin(p.ambT * p.ambSpeed) * 18 * particleDpr;
    p.x = particleCx + Math.cos(p.ambT * p.ambSpeed * 0.5 + p.ambSeed) * r;
    p.y = particleCy
      + Math.sin(p.ambT * p.ambSpeed * 0.7 + p.ambSeed) * r * 0.85
      - Math.sin(p.ambT * 1.5 + p.ambSeed) * 10 * particleDpr;
    p.alpha = Math.max(0, p.ambIntensity + Math.sin(p.ambT * 2.5 + p.ambSeed) * p.ambIntensity * 0.6);
  }
}

function drawParticle(p) {
  if (p.alpha <= 0) return;
  const alpha = Math.max(0, p.alpha);
  particleCtx.fillStyle = p.color.replace('ALPHA', alpha.toFixed(3));
  particleCtx.beginPath();
  particleCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
  particleCtx.fill();
  particleCtx.fillStyle = p.color.replace('ALPHA', (alpha * 0.25).toFixed(3));
  particleCtx.beginPath();
  particleCtx.arc(p.x, p.y, p.size * 2.5, 0, Math.PI * 2);
  particleCtx.fill();
}

function resizeParticleCanvas() {
  if (!particleCanvasRef.value || !particleCtx) return;
  particleDpr = window.devicePixelRatio || 1;
  const rect = particleCanvasRef.value.getBoundingClientRect();
  const cssW = rect.width || window.innerWidth;
  const cssH = rect.height || window.innerHeight;
  particleW = particleCanvasRef.value.width = Math.max(1, Math.floor(cssW * particleDpr));
  particleH = particleCanvasRef.value.height = Math.max(1, Math.floor(cssH * particleDpr));
  particleCanvasRef.value.style.width = `${cssW}px`;
  particleCanvasRef.value.style.height = `${cssH}px`;
  particleCx = particleW / 2;
  particleCy = particleH / 2;
}

function initParticles() {
  if (!particleCtx) return;
  resizeParticleCanvas();
  const baseCount = Math.round(140 * (Math.min(particleW, particleH) / (360 * particleDpr)));
  const cap = isLowPowerDevice ? 150 : 260;
  const count = Math.max(60, Math.min(cap, baseCount));
  particles = [];
  for (let i = 0; i < count; i += 1) particles.push(createParticle());
}

function updateParticles(dt, elapsed) {
  if (!particleCtx || particles.length === 0) return;
  particleCtx.clearRect(0, 0, particleW, particleH);
  particleCtx.globalCompositeOperation = 'lighter';
  let alive = 0;
  for (const p of particles) {
    updateParticle(p, dt, elapsed);
    drawParticle(p);
    if (p.phase !== 'done') alive += 1;
  }
  if (alive === 0) {
    particles = [];
    particleCtx.clearRect(0, 0, particleW, particleH);
  }
}

function updateModelMaterials(rawProgress) {
  const materialProgress = smoothStep((rawProgress - 0.08) / 0.78);
  const soulGlow = Math.max(0, Math.sin(clamp(rawProgress * 1.1) * Math.PI)) * 0.38;

  modelMaterials.forEach(({ material, opacity, emissive, emissiveIntensity }) => {
    material.opacity = opacity * materialProgress;
    material.transparent = materialProgress < 0.98 || opacity < 1;
    material.depthWrite = materialProgress > 0.76 && opacity >= 1;

    if (material.emissive) {
      material.emissive.copy(emissive);
      material.emissive.lerp(soulEmissiveColor, soulGlow);
      material.emissiveIntensity = (emissiveIntensity || 0) + soulGlow;
    }
    material.needsUpdate = true;
  });
}

function resizeOverlay() {
  if (!renderer || !camera || !canvasRef.value) return;

  const cssWidth = canvasRef.value.clientWidth || window.innerWidth;
  const cssHeight = canvasRef.value.clientHeight || window.innerHeight;
  const renderScale = Math.min(1, maxRenderWidth / cssWidth);
  const renderWidth = Math.max(1, Math.floor(cssWidth * renderScale));
  const renderHeight = Math.max(1, Math.floor(cssHeight * renderScale));

  renderer.setSize(renderWidth, renderHeight, false);

  const viewAspect = cssWidth / cssHeight;
  camera.left = -viewAspect;
  camera.right = viewAspect;
  camera.top = 1;
  camera.bottom = -1;
  camera.updateProjectionMatrix();
  updateRootPosition();
  updateSpawnOrigin();
}

function animate(now = 0) {
  rafId = requestAnimationFrame(animate);

  if (!pageVisible || !renderer || !scene || !camera) return;
  if (now - lastFrameTime < targetFrameInterval) return;
  lastFrameTime = now;

  const delta = clock ? Math.min(clock.getDelta(), 0.05) : 0;
  spawnAge += delta;
  animationMixer?.update(delta);
  updateParticles(delta, spawnAge);

  if (model) {
    const appearProgress = clamp((spawnAge - appearDelay) / popDuration);
    const pop = sampleSummonPop(appearProgress);
    const idleAge = Math.max(0, spawnAge - floatDelay);
    const floatY = idleAge > 0 ? Math.sin(idleAge * ((Math.PI * 2) / 3.4)) * 0.034 : 0;
    const sway = idleAge > 0 ? Math.sin(idleAge * ((Math.PI * 2) / 4.8)) * 3.6 * (Math.PI / 180) : 0;
    const breathe = idleAge > 0 ? 1 + Math.sin(idleAge * ((Math.PI * 2) / 2.4)) * 0.018 : 1;
    const travel = smoothStep(appearProgress);
    const offsetX = spawnOrigin.x * (1 - travel);
    const offsetY = spawnOrigin.y * (1 - travel);

    model.rotation.x = 0;
    model.rotation.y = modelFacingRotationY;
    model.rotation.z = (pop.rotation * Math.PI) / 180 + sway;
    model.scale.setScalar(model.userData.targetScale * pop.scale * breathe);
    model.position.set(
      model.userData.centerOffset.x + offsetX,
      model.userData.centerOffset.y + floatY + offsetY,
      model.userData.centerOffset.z,
    );
    updateModelMaterials(appearProgress);
  }

  renderer.render(scene, camera);
}

async function loadModel(modelUrl) {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(modelUrl);

  stopModelAnimations();
  animationRoot = gltf.scene;
  model = new Group();
  model.add(animationRoot);

  const bounds = new Box3().setFromObject(animationRoot);
  const size = bounds.getSize(new Vector3());
  const center = bounds.getCenter(new Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z, 1);
  const targetWorldSize = isLowPowerDevice ? 0.72 : 0.82;

  model.userData.targetScale = targetWorldSize / maxDimension;
  model.userData.centerOffset = center.multiplyScalar(-1);
  model.rotation.y = modelFacingRotationY;
  model.scale.setScalar(0.001);
  model.position.copy(model.userData.centerOffset);
  modelMaterials = [];

  model.traverse((child) => {
    if (!child.isMesh) return;

    child.castShadow = false;
    child.receiveShadow = false;
    child.frustumCulled = false;

    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.filter(Boolean).forEach((material) => {
      modelMaterials.push({
        material,
        opacity: material.opacity ?? 1,
        emissive: material.emissive?.clone(),
        emissiveIntensity: material.emissiveIntensity ?? 0,
      });

      material.transparent = true;
      material.opacity = 0;
      material.depthWrite = false;

      if (material.emissive) {
        material.emissive.copy(soulEmissiveColor);
        material.emissiveIntensity = 0.28;
      }
      material.needsUpdate = true;
    });
  });

  root.clear();
  startModelAnimations(gltf.animations);
  root.add(model);

  spawnAge = 0;
  initParticles();
  if (glowRef.value) {
    glowRef.value.classList.remove('is-active');
    void glowRef.value.offsetWidth;
    glowRef.value.classList.add('is-active');
  }
}

function stopModelAnimations() {
  animationActions.forEach((action) => action.stop());

  if (animationMixer && animationRoot) {
    animationMixer.stopAllAction();
    animationMixer.uncacheRoot(animationRoot);
  }

  animationMixer = null;
  animationActions = [];
}

function startModelAnimations(animations = []) {
  stopModelAnimations();

  const defaultClip = animations.find((clip) => clip.duration > 0);
  if (!defaultClip || !animationRoot) return;

  animationMixer = new AnimationMixer(animationRoot);
  const action = animationMixer.clipAction(defaultClip);
  action.reset().play();
  animationActions = [action];
}

function initScene(modelUrl) {
  const canvas = canvasRef.value;
  if (!canvas) return;

  scene = new Scene();
  scene.background = null;

  camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 2;

  renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    antialias: false,
    depth: true,
    stencil: false,
    powerPreference: isLowPowerDevice ? 'low-power' : 'high-performance',
    precision: 'mediump',
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMappingExposure = isLowPowerDevice ? 1.22 : 1.35;

  root = new Group();
  scene.add(root);

  scene.add(new AmbientLight(0xffffff, 1.85));
  scene.add(new HemisphereLight(0xeafff6, 0xb7d6ff, 1.05));

  const key = new DirectionalLight(0xffffff, 2.8);
  key.position.set(2, 4, 3);
  scene.add(key);

  const fill = new DirectionalLight(0xffe7bf, 1.15);
  fill.position.set(-3, 1.5, 2);
  scene.add(fill);

  clock = new Clock();

  if (particleCanvasRef.value) {
    particleCtx = particleCanvasRef.value.getContext('2d');
    resizeParticleCanvas();
    particleResizeObserver = new ResizeObserver(resizeParticleCanvas);
    particleResizeObserver.observe(particleCanvasRef.value);
  }

  resizeOverlay();
  updateRootPosition();
  resizeObserver = new ResizeObserver(resizeOverlay);
  resizeObserver.observe(canvas);

  animate();
  loadModel(modelUrl);
}

function disposeObject(object) {
  object.traverse((child) => {
    if (!child.isMesh) return;

    child.geometry?.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.filter(Boolean).forEach((material) => material.dispose?.());
  });
}

function cleanupScene() {
  cancelAnimationFrame(rafId);
  resizeObserver?.disconnect();
  resizeObserver = null;
  particleResizeObserver?.disconnect();
  particleResizeObserver = null;

  stopModelAnimations();
  if (model) disposeObject(model);
  model = null;
  animationRoot = null;
  particles = [];
  particleCtx = null;
  modelMaterials = [];
  root = null;
  renderer?.dispose();
  renderer = null;
  scene = null;
  camera = null;
}

function handleVisibilityChange() {
  pageVisible = !document.hidden;
  if (pageVisible && clock) {
    clock.getDelta();
    lastFrameTime = 0;
  }
}

onMounted(() => {
  window.addEventListener('resize', resizeOverlay);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  initScene(props.modelUrl);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', resizeOverlay);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  cleanupScene();
});
</script>

<template>
  <div class="ar-overlay soul-model-overlay">
    <canvas ref="canvasRef" class="soul-model-canvas"></canvas>
    <canvas ref="particleCanvasRef" class="soul-particle-canvas"></canvas>
    <div ref="glowRef" class="soul-glow"></div>
  </div>
</template>

<style scoped>
.soul-model-overlay {
  position: absolute;
  inset: 0;
}

.soul-model-canvas,
.soul-particle-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.soul-particle-canvas {
  z-index: 2;
  mix-blend-mode: screen;
}

.soul-glow {
  position: absolute;
  left: 50%;
  bottom: 12%;
  width: 62%;
  height: 12%;
  transform: translateX(-50%) scale(0.4);
  border-radius: 50%;
  background: radial-gradient(
    ellipse,
    rgba(255, 248, 232, 0.72) 0%,
    rgba(207, 231, 217, 0.34) 48%,
    transparent 80%
  );
  filter: blur(14px);
  opacity: 0;
  pointer-events: none;
  z-index: 1;
}

.soul-glow.is-active {
  animation:
    soul-glow-in 1.4s ease-out forwards,
    soul-glow-pulse 3s ease-in-out 1.4s infinite;
}

@keyframes soul-glow-in {
  from { opacity: 0; transform: translateX(-50%) scale(0.4); }
  to { opacity: 1; transform: translateX(-50%) scale(1); }
}

@keyframes soul-glow-pulse {
  0%, 100% { opacity: 0.85; }
  50% { opacity: 1; }
}
</style>
