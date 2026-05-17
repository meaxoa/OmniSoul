<script setup>
import { computed, ref, watch } from 'vue';
import AiConversation from './components/AiConversation.vue';
import ArCameraStage from './components/ArCameraStage.vue';
import ArDialog from './components/ArDialog.vue';
import ArSoulModel from './components/ArSoulModel.vue';
import ArSoulSprite from './components/ArSoulSprite.vue';
import CameraIntro from './components/CameraIntro.vue';
import ObjectHotspots from './components/ObjectHotspots.vue';
import RecognitionPanel from './components/RecognitionPanel.vue';
import { dormantSpiritText, getDemoObjectById } from './data/demoObjects';
import { useArCamera } from './composables/useArCamera';
import { useRealtimeObjectScanner } from './composables/useRealtimeObjectScanner';

const detectedLabel = ref('');
const detectedObjectId = ref('succulent');
const selectedObjectId = ref('');
const selectedObjectAnchor = ref({ x: 0.5, y: 0.58 });
const showDialog = ref(false);
const dialogText = ref('');
const spiritAwake = ref(false);
const summonBurst = ref(false);
const showSoulModel = ref(false);

const selectedDemoObject = computed(() => getDemoObjectById(detectedObjectId.value));
const activeSpirit = computed(() =>
  spiritAwake.value && selectedDemoObject.value?.enabledSpirit ? selectedDemoObject.value : null,
);

const {
  canStart,
  errorText,
  loading,
  ready,
  startCamera,
  statusText,
  videoRef,
} = useArCamera();

const scannerEnabled = computed(() => ready.value && !showSoulModel.value);

const {
  errorText: scannerErrorText,
  objects: scannedObjects,
  primaryLabel,
  primaryObjectId,
  scanning,
} = useRealtimeObjectScanner({
  videoRef,
  enabled: scannerEnabled,
});

const showSpawnButton = computed(
  () => Boolean(detectedLabel.value && selectedDemoObject.value?.enabledSpirit && !spiritAwake.value),
);

function syncDetectedObject(objectId, label) {
  if (objectId !== detectedObjectId.value) {
    spiritAwake.value = false;
    showDialog.value = false;
    summonBurst.value = false;
    selectedObjectId.value = '';
  }

  detectedObjectId.value = objectId;
  detectedLabel.value = label;
}

function wakeSucculentSpirit() {
  const demoObject = selectedDemoObject.value;
  if (!demoObject?.enabledSpirit) return;

  spiritAwake.value = true;
  showSoulModel.value = true;
  summonBurst.value = false;

  requestAnimationFrame(() => {
    summonBurst.value = true;
    window.setTimeout(() => {
      summonBurst.value = false;
    }, 1200);
  });

  statusText.value = `已唤醒：${demoObject.spiritName}`;
}

function selectObject(object) {
  const demoObject = getDemoObjectById(object.objectId) || {
    id: 'other',
    label: object.label || '物体',
    enabledSpirit: false,
  };

  selectedObjectId.value = object.id;
  selectedObjectAnchor.value = { x: object.x, y: object.y };
  syncDetectedObject(demoObject.id, demoObject.label);

  if (!demoObject.enabledSpirit) {
    dialogText.value = dormantSpiritText;
    showDialog.value = true;
    statusText.value = `已识别：${demoObject.label}`;
    window.setTimeout(() => {
      showDialog.value = false;
    }, 2600);
    return;
  }

  wakeSucculentSpirit();
}

function exitSoulModel() {
  showSoulModel.value = false;
  spiritAwake.value = false;
  selectedObjectId.value = '';
  selectedObjectAnchor.value = { x: 0.5, y: 0.58 };
  detectedLabel.value = '';
  statusText.value = '实时扫描中，请把物体放入画面';
}

watch([scannedObjects, scannerErrorText], ([objects, scanError]) => {
  if (!ready.value) return;
  if (showSoulModel.value) return;

  if (!objects.length) {
    selectedObjectId.value = '';
    detectedLabel.value = '';
    spiritAwake.value = false;
    statusText.value = scanError || '实时扫描中，请把物体放入画面';
    return;
  }

  statusText.value = `发现 ${objects.length} 个可互动小物件`;

  if (!selectedObjectId.value && primaryLabel.value) {
    syncDetectedObject(primaryObjectId.value, primaryLabel.value);
  }
});
</script>

<template>
  <main class="app-shell">
    <ArCameraStage v-model:video-ref="videoRef" />

    <div class="camera-soft-overlay" aria-hidden="true"></div>
    <div v-if="ready && !showSoulModel" class="camera-reticle" aria-hidden="true">
      <span></span>
      <span></span>
      <span></span>
      <span></span>
    </div>
    <button
      v-if="ready && showSpawnButton"
      class="spawn-btn"
      type="button"
      @click="wakeSucculentSpirit"
    >
      唤醒小灵体
    </button>
    <div v-else-if="ready && !activeSpirit" class="camera-bottom-hint">
      <span></span>
      轻点发光标记
    </div>

    <ArSoulModel
      v-if="ready && activeSpirit && activeSpirit.spiritType !== 'sprite'"
      :key="selectedObjectId || activeSpirit.id"
      :anchor-x="selectedObjectAnchor.x"
      :anchor-y="selectedObjectAnchor.y"
      :model-url="activeSpirit.modelUrl"
    />

    <ArSoulSprite
      v-if="ready && activeSpirit && activeSpirit.spiritType === 'sprite'"
      :key="selectedObjectId || activeSpirit.id"
      :anchor-x="selectedObjectAnchor.x"
      :anchor-y="selectedObjectAnchor.y"
      :sprite-url="activeSpirit.spriteUrl"
      :accent-color="activeSpirit.theme?.glow || activeSpirit.theme?.accent || '#9bf06b'"
    />

    <button
      v-if="showSoulModel"
      class="exit-soul-btn"
      type="button"
      aria-label="退出灵体视图"
      @click="exitSoulModel"
    >
      退出
    </button>

    <CameraIntro
      v-if="!ready"
      :can-start="canStart"
      :error-text="errorText"
      :loading="loading"
      @start="startCamera"
    />

    <RecognitionPanel
      v-if="ready && !showSoulModel"
      :detected-label="detectedLabel"
      :object-count="scannedObjects.length"
      :scanning="scanning"
    />

    <div v-if="summonBurst" class="summon-burst" aria-hidden="true">
      <span></span>
      <span></span>
      <span></span>
    </div>

    <ArDialog
      v-if="showDialog"
      :text="dialogText"
    />

    <AiConversation
      v-if="ready && activeSpirit"
      :key="activeSpirit.id"
      :character-name="activeSpirit.spiritName"
      :context-label="activeSpirit.label"
      :initial-greeting="activeSpirit.initialGreeting"
      :system-prompt="activeSpirit.systemPrompt"
      :voice="activeSpirit.voice"
    />

    <ObjectHotspots
      v-if="ready && !showSoulModel"
      :objects="scannedObjects"
      :selected-id="selectedObjectId"
      @select="selectObject"
    />

  </main>
</template>
