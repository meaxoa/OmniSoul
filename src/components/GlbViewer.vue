<script setup>
defineProps({
  modelUrl: {
    type: String,
    required: true,
  },
});
</script>

<template>
  <div class="legacy-viewer">
    旧版模型查看器已替换为 AR 相机入口。模型路径：{{ modelUrl }}
  </div>
</template>
