import { computed, onBeforeUnmount, ref } from 'vue';

const isMobileDevice = window.matchMedia('(max-width: 720px)').matches;
const isLowPowerDevice = isMobileDevice || (navigator.hardwareConcurrency || 4) <= 4;

const cameraConstraints = {
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: isLowPowerDevice ? 640 : 960 },
    height: { ideal: isLowPowerDevice ? 480 : 540 },
    frameRate: {
      ideal: isLowPowerDevice ? 18 : 24,
      max: isLowPowerDevice ? 24 : 30,
    },
  },
  audio: false,
};

function mapCameraError(err) {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError') return '摄像头权限被拒绝，请允许后再试。';
  if (name === 'NotFoundError') return '未找到可用摄像头。';
  if (name === 'NotReadableError') return '摄像头可能被其他应用占用。';
  if (name === 'OverconstrainedError') return '当前设备不支持请求的摄像头参数。';
  return '无法启动摄像头，请确认浏览器支持并使用 HTTPS 或 localhost。';
}

export function useArCamera() {
  const videoRef = ref(null);
  const statusText = ref('点击开始，授权后使用后置摄像头');
  const ready = ref(false);
  const loading = ref(false);
  const errorText = ref('');

  let stream = null;

  const canStart = computed(() => !loading.value && !ready.value);

  async function startCamera() {
    errorText.value = '';
    loading.value = true;
    statusText.value = '正在请求摄像头权限...';

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('unsupported');
      }

      stream = await navigator.mediaDevices.getUserMedia(cameraConstraints);

      const video = videoRef.value;
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();

      ready.value = true;
      statusText.value = '摄像头已启动，实时扫描中';
    } catch (err) {
      console.error(err);
      errorText.value = mapCameraError(err);
      statusText.value = '启动失败';
      stopCamera();
    } finally {
      loading.value = false;
    }
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    ready.value = false;
  }

  onBeforeUnmount(() => {
    stopCamera();
  });

  return {
    canStart,
    errorText,
    loading,
    ready,
    startCamera,
    statusText,
    videoRef,
  };
}
