<script setup>
defineProps({
  detectedLabel: {
    type: String,
    default: '',
  },
  objectCount: {
    type: Number,
    default: 0,
  },
  scanning: {
    type: Boolean,
    required: true,
  },
});
</script>

<template>
  <section class="recognition-card">
    <div class="recognition-orb" aria-hidden="true"></div>
    <div>
      <div class="label">{{ scanning ? '正在扫描' : '扫描已暂停' }}</div>
      <div class="value">{{ detectedLabel ? detectedLabel : '寻找可互动的小物件' }}</div>
      <div class="hint">{{ objectCount ? `发现 ${objectCount} 个小物件` : '请把物品靠近镜头' }}</div>
    </div>
  </section>
</template>
