<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';

const props = defineProps({
  spriteUrl: {
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
  accentColor: {
    type: String,
    default: '#9bf06b',
  },
});

const particleCanvasRef = ref(null);
const glowRef = ref(null);
const spriteRef = ref(null);

const isMobileDevice = window.matchMedia('(max-width: 720px)').matches;
const isLowPowerDevice = isMobileDevice || (navigator.hardwareConcurrency || 4) <= 4;

const PARTICLE_PALETTE = [
  'rgba(155, 240, 107, ALPHA)',
  'rgba(180, 255, 160, ALPHA)',
  'rgba(220, 255, 180, ALPHA)',
  'rgba(255, 250, 220, ALPHA)',
  'rgba(140, 220, 95, ALPHA)',
];

let rafId = 0;
let pageVisible = true;
let particleResizeObserver = null;
let lastTimestamp = 0;
let spawnAge = 0;

let particleCtx = null;
let particleDpr = 1;
let particleW = 0;
let particleH = 0;
let particleCx = 0;
let particleCy = 0;
let particles = [];

function clamp(value, min = 0, max = 1) {
  return Math.min(Math.max(value, min), max);
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

function animate(now = 0) {
  rafId = requestAnimationFrame(animate);
  if (!pageVisible || !particleCtx) return;

  const dt = lastTimestamp ? Math.min((now - lastTimestamp) / 1000, 0.05) : 0;
  lastTimestamp = now;
  spawnAge += dt;
  updateParticles(dt, spawnAge);
}

function startScene() {
  if (!particleCanvasRef.value) return;

  particleCtx = particleCanvasRef.value.getContext('2d');
  initParticles();
  particleResizeObserver = new ResizeObserver(resizeParticleCanvas);
  particleResizeObserver.observe(particleCanvasRef.value);

  spawnAge = 0;
  lastTimestamp = 0;

  if (glowRef.value) {
    glowRef.value.classList.remove('is-active');
    void glowRef.value.offsetWidth;
    glowRef.value.classList.add('is-active');
  }

  if (spriteRef.value) {
    spriteRef.value.classList.remove('is-active');
    void spriteRef.value.offsetWidth;
    spriteRef.value.classList.add('is-active');
  }

  animate();
}

function cleanupScene() {
  cancelAnimationFrame(rafId);
  particleResizeObserver?.disconnect();
  particleResizeObserver = null;
  particles = [];
  particleCtx = null;
}

function handleVisibilityChange() {
  pageVisible = !document.hidden;
  if (pageVisible) {
    lastTimestamp = 0;
  }
}

onMounted(() => {
  document.addEventListener('visibilitychange', handleVisibilityChange);
  startScene();
});

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  cleanupScene();
});
</script>

<template>
  <div
    class="ar-overlay soul-sprite-overlay"
    :style="{ '--accent': accentColor }"
  >
    <canvas ref="particleCanvasRef" class="soul-particle-canvas"></canvas>
    <div ref="glowRef" class="soul-glow"></div>
    <img
      ref="spriteRef"
      class="soul-sprite"
      :src="spriteUrl"
      alt=""
      draggable="false"
    />
  </div>
</template>

<style scoped>
.soul-sprite-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.soul-particle-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 2;
  mix-blend-mode: screen;
  pointer-events: none;
}

.soul-glow {
  position: absolute;
  left: 50%;
  top: 58%;
  width: 38%;
  height: 8%;
  transform: translate(-50%, -50%) scale(0.4);
  border-radius: 50%;
  background: radial-gradient(
    ellipse,
    color-mix(in srgb, var(--accent) 55%, transparent) 0%,
    color-mix(in srgb, var(--accent) 25%, transparent) 50%,
    transparent 80%
  );
  filter: blur(14px);
  opacity: 0;
  z-index: 1;
}

.soul-glow.is-active {
  animation:
    soul-glow-in 1.4s ease-out forwards,
    soul-glow-pulse 3s ease-in-out 1.4s infinite;
}

.soul-sprite {
  position: absolute;
  left: 50%;
  top: 50%;
  z-index: 3;
  width: auto;
  max-width: 38vw;
  max-height: 44vh;
  transform: translate(-50%, -50%) scale(0);
  opacity: 0;
  filter: drop-shadow(0 6px 18px color-mix(in srgb, var(--accent) 55%, transparent));
  user-select: none;
  -webkit-user-drag: none;
}

.soul-sprite.is-active {
  animation:
    soul-sprite-emerge 1.2s cubic-bezier(0.34, 1.56, 0.64, 1) forwards,
    soul-sprite-idle 3.4s ease-in-out 1.2s infinite;
}

@media (max-width: 520px) {
  .soul-sprite {
    max-width: 56vw;
    max-height: 38vh;
  }
}

@keyframes soul-glow-in {
  from {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.4);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
}

@keyframes soul-glow-pulse {
  0%, 100% { opacity: 0.85; }
  50%      { opacity: 1; }
}

@keyframes soul-sprite-emerge {
  0% {
    opacity: 0;
    transform: translate(-50%, 18%) scale(0) rotate(-18deg);
    filter:
      drop-shadow(0 6px 18px color-mix(in srgb, var(--accent) 55%, transparent))
      blur(8px);
  }
  35% {
    opacity: 0.6;
    transform: translate(-50%, -8%) scale(0.6) rotate(-6deg);
    filter:
      drop-shadow(0 6px 22px color-mix(in srgb, var(--accent) 75%, transparent))
      blur(2px);
  }
  60% {
    opacity: 1;
    transform: translate(-50%, -8%) scale(1.16) rotate(6deg);
    filter:
      drop-shadow(0 6px 22px color-mix(in srgb, var(--accent) 75%, transparent))
      blur(0);
  }
  78% {
    transform: translate(-50%, -3%) scale(0.94) rotate(-3deg);
  }
  100% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1) rotate(0deg);
    filter: drop-shadow(0 6px 18px color-mix(in srgb, var(--accent) 55%, transparent));
  }
}

@keyframes soul-sprite-idle {
  0%, 100% {
    transform: translate(-50%, -50%) rotate(0deg) scale(1);
  }
  25% {
    transform: translate(-50%, -53%) rotate(2deg) scale(1.018);
  }
  50% {
    transform: translate(-50%, -52%) rotate(0deg) scale(1.012);
  }
  75% {
    transform: translate(-50%, -51%) rotate(-1.8deg) scale(1.005);
  }
}
</style>
