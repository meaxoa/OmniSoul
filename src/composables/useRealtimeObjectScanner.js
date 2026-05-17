import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { getDemoObjectById } from '../data/demoObjects';

const captureMaxWidth = 640;
const jpegQuality = 0.72;
const maxObjects = 5;
const scanInterval = 500;
const resultTtl = 6000;
const whitelistMinConfidence = 0.8;
const otherMinConfidence = 0.58;
const nearbySuppressionRadius = 0.14;

const visionModel = 'gemini-2.5-flash';
const visionApiKey = 'YOUR_VISION_API_KEY';
const visionEndpoint = 'https://api.openai-next.com/v1/chat/completions';

const whitelistIds = new Set(['succulent', 'creeper', 'stitch_plush']);

const recognitionPrompt = `
你是 OmniSoul AR demo 的视觉识别器。请只根据图片内容识别可点击物体，并返回严格 JSON。

白名单强保护物体：
1. succulent = 多肉植物：真实多肉、肉质叶片小盆栽、盆里的多肉植物。
2. creeper = 苦力怕模型：Minecraft Creeper 苦力怕、绿色像素方块风格模型或摆件。
3. stitch_plush = 史迪仔玩具：蓝色史迪仔 Stitch 玩偶、毛绒玩具或玩具摆件。

强保护规则：
- 只有非常确定是上述三类之一时，才放入 whitelistObjects。
- 不要因为颜色相似、形状相似、盆栽、普通玩具、普通绿色物体、普通蓝色物体而猜成白名单。
- 不确定时放入 otherObjects，或者不返回。
- 可以识别其他明显物体，给中文通用名称，但这些不能映射成白名单。
- 忽略人物、手、背景、桌面、墙面、光影、屏幕 UI。

返回格式必须是 JSON，不能包含解释、Markdown 或代码块：
{
  "whitelistObjects": [
    {
      "id": "succulent | creeper | stitch_plush",
      "label": "多肉植物 | 苦力怕模型 | 史迪仔玩具",
      "box_2d": [ymin, xmin, ymax, xmax],
      "confidence": 0.0
    }
  ],
  "otherObjects": [
    {
      "label": "中文物体名称",
      "box_2d": [ymin, xmin, ymax, xmax],
      "confidence": 0.0
    }
  ]
}

box_2d 使用 0 到 1000 的整数坐标，顺序固定为 [ymin, xmin, ymax, xmax]。
confidence 使用 0 到 1 的小数。
`;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function displayPosition(video, x, y) {
  const viewWidth = window.innerWidth || 1;
  const viewHeight = window.innerHeight || 1;
  const videoAspect = (video.videoWidth || captureMaxWidth) / (video.videoHeight || captureMaxWidth);
  const viewAspect = viewWidth / viewHeight;

  let displayX = x;
  let displayY = y;

  if (videoAspect > viewAspect) {
    const visibleWidth = viewAspect / videoAspect;
    const cropLeft = (1 - visibleWidth) / 2;
    displayX = (x - cropLeft) / visibleWidth;
  } else {
    const visibleHeight = videoAspect / viewAspect;
    const cropTop = (1 - visibleHeight) / 2;
    displayY = (y - cropTop) / visibleHeight;
  }

  return {
    x: clamp(displayX, 0.04, 0.96),
    y: clamp(displayY, 0.08, 0.92),
  };
}

function normalizeConfidence(value) {
  const confidence = Number(value);
  if (!Number.isFinite(confidence)) return 0;
  return clamp(confidence, 0, 1);
}

function normalizeBox(box) {
  if (!Array.isArray(box) || box.length !== 4) return null;

  const [yMinRaw, xMinRaw, yMaxRaw, xMaxRaw] = box.map(Number);
  if (![yMinRaw, xMinRaw, yMaxRaw, xMaxRaw].every(Number.isFinite)) return null;

  const yMin = clamp(Math.min(yMinRaw, yMaxRaw) / 1000, 0, 1);
  const xMin = clamp(Math.min(xMinRaw, xMaxRaw) / 1000, 0, 1);
  const yMax = clamp(Math.max(yMinRaw, yMaxRaw) / 1000, 0, 1);
  const xMax = clamp(Math.max(xMinRaw, xMaxRaw) / 1000, 0, 1);
  const width = xMax - xMin;
  const height = yMax - yMin;
  const area = width * height;

  if (width < 0.035 || height < 0.035 || area < 0.003 || area > 0.88) return null;

  return {
    xMin,
    yMin,
    xMax,
    yMax,
    centerX: (xMin + xMax) / 2,
    centerY: (yMin + yMax) / 2,
  };
}

function cleanOtherLabel(label) {
  const text = String(label || '').replace(/[<>{}[\]"'`]/g, '').trim();
  if (!text) return '物体';
  return text.slice(0, 12);
}

function extractJson(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    try {
      return JSON.parse(withoutFence);
    } catch {
      const start = trimmed.indexOf('{');
      const end = trimmed.lastIndexOf('}');
      if (start === -1 || end === -1 || end <= start) return null;
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }
}

function captureVideoFrame(video, canvas, context) {
  const sourceWidth = video.videoWidth || captureMaxWidth;
  const sourceHeight = video.videoHeight || Math.round(captureMaxWidth * 0.75);
  const scale = Math.min(1, captureMaxWidth / sourceWidth);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  canvas.width = width;
  canvas.height = height;
  context.drawImage(video, 0, 0, width, height);

  const dataUrl = canvas.toDataURL('image/jpeg', jpegQuality);
  return dataUrl.split(',')[1] || '';
}

async function requestVisionRecognition(imageBase64, signal) {
  const response = await fetch(visionEndpoint, {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${visionApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: visionModel,
      temperature: 0.05,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: recognitionPrompt,
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${imageBase64}`,
              },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Vision recognition failed: ${response.status}`);
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  const text = Array.isArray(content)
    ? content.map((part) => part.text || '').join('\n')
    : String(content || '');
  const parsed = extractJson(text);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Vision recognition returned invalid JSON');
  }

  return parsed;
}

function buildWhitelistCandidate(item, index) {
  const id = String(item?.id || '').trim();
  if (!whitelistIds.has(id)) return null;

  const confidence = normalizeConfidence(item.confidence);
  if (confidence < whitelistMinConfidence) return null;

  const box = normalizeBox(item.box_2d);
  if (!box) return null;

  const demoObject = getDemoObjectById(id);
  if (!demoObject) return null;

  return {
    id,
    objectId: id,
    label: demoObject.label,
    enabledSpirit: demoObject.enabledSpirit,
    confidence,
    priority: 2,
    ...box,
  };
}

function buildOtherCandidate(item, index) {
  const confidence = normalizeConfidence(item?.confidence);
  if (confidence < otherMinConfidence) return null;

  const box = normalizeBox(item?.box_2d);
  if (!box) return null;

  const label = cleanOtherLabel(item.label);

  return {
    id: `other-${index}-${label}`,
    objectId: 'other',
    label,
    enabledSpirit: false,
    confidence,
    priority: 1,
    ...box,
  };
}

function overlapsPicked(candidate, picked) {
  return picked.some((item) => {
    const dx = item.centerX - candidate.centerX;
    const dy = item.centerY - candidate.centerY;
    return Math.hypot(dx, dy) < nearbySuppressionRadius;
  });
}

function suppressOverlappingCandidates(candidates) {
  const picked = [];
  const sorted = [...candidates].sort(
    (a, b) => b.priority - a.priority || b.confidence - a.confidence,
  );

  for (const candidate of sorted) {
    if (!overlapsPicked(candidate, picked)) {
      picked.push(candidate);
    }
    if (picked.length >= maxObjects) break;
  }

  return picked.sort((a, b) => a.centerX - b.centerX);
}

function mapGeminiObjects(result, video) {
  const whitelistObjects = Array.isArray(result.whitelistObjects) ? result.whitelistObjects : [];
  const otherObjects = Array.isArray(result.otherObjects) ? result.otherObjects : [];

  const candidates = [
    ...whitelistObjects.map(buildWhitelistCandidate).filter(Boolean),
    ...otherObjects.map(buildOtherCandidate).filter(Boolean),
  ];

  return suppressOverlappingCandidates(candidates).map((candidate) => {
    const marker = displayPosition(video, candidate.centerX, candidate.yMin - 0.04);

    return {
      id: candidate.id,
      objectId: candidate.objectId,
      label: candidate.label,
      enabledSpirit: candidate.enabledSpirit,
      confidence: candidate.confidence,
      x: marker.x,
      y: marker.y,
    };
  });
}

function preferredPrimary(objects) {
  return objects.find((object) => object.objectId === 'succulent') || objects[0] || null;
}

export function useRealtimeObjectScanner({ videoRef, enabled }) {
  const objects = ref([]);
  const scanning = ref(false);
  const errorText = ref('');

  let timerId = 0;
  let scanCanvas = null;
  let scanContext = null;
  let requestInFlight = false;
  let abortController = null;
  let scanSessionId = 0;
  let lastSuccessfulScanAt = 0;

  const primaryObject = computed(() => preferredPrimary(objects.value));
  const primaryLabel = computed(() => primaryObject.value?.label ?? '');
  const primaryObjectId = computed(() => primaryObject.value?.objectId ?? '');

  function ensureCanvas() {
    if (scanCanvas) return;

    scanCanvas = document.createElement('canvas');
    scanContext = scanCanvas.getContext('2d');
  }

  async function scanFrame() {
    const sessionId = scanSessionId;
    const video = videoRef.value;
    if (
      !scanning.value ||
      requestInFlight ||
      !video ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      !scanContext
    ) {
      return;
    }

    if (!visionApiKey) {
      errorText.value = '未配置视觉识别 API Key';
      objects.value = [];
      return;
    }

    requestInFlight = true;
    abortController = new AbortController();
    errorText.value = '';

    try {
      const imageBase64 = captureVideoFrame(video, scanCanvas, scanContext);
      const result = await requestVisionRecognition(imageBase64, abortController.signal);
      if (!scanning.value || sessionId !== scanSessionId) return;
      objects.value = mapGeminiObjects(result, video);
      lastSuccessfulScanAt = Date.now();
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (!scanning.value || sessionId !== scanSessionId) return;
      console.error(err);
      errorText.value = '视觉识别暂时不可用，正在重试';

      if (Date.now() - lastSuccessfulScanAt > resultTtl) {
        objects.value = [];
      }
    } finally {
      if (sessionId === scanSessionId) {
        requestInFlight = false;
        abortController = null;
      }
    }
  }

  function start() {
    if (timerId) return;

    ensureCanvas();
    scanSessionId += 1;
    scanning.value = true;
    scanFrame();
    timerId = window.setInterval(scanFrame, scanInterval);
  }

  function stop() {
    window.clearInterval(timerId);
    timerId = 0;
    scanSessionId += 1;
    abortController?.abort();
    abortController = null;
    scanning.value = false;
    errorText.value = '';
    objects.value = [];
    requestInFlight = false;
    lastSuccessfulScanAt = 0;
  }

  watch(
    enabled,
    (shouldScan) => {
      if (shouldScan) {
        start();
      } else {
        stop();
      }
    },
    { immediate: true },
  );

  onBeforeUnmount(stop);

  return {
    errorText,
    objects,
    primaryLabel,
    primaryObjectId,
    scanning,
  };
}
