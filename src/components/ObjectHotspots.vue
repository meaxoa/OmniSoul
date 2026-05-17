<script setup>
defineProps({
  objects: {
    type: Array,
    default: () => [],
  },
  selectedId: {
    type: String,
    default: '',
  },
});

defineEmits(['select']);
</script>

<template>
  <div class="hotspot-layer" aria-label="实时扫描到的物体">
    <TransitionGroup name="hotspot">
      <button
        v-for="object in objects"
        :key="object.id"
        class="object-hotspot"
        :class="{ selected: object.id === selectedId }"
        :style="{ left: `${object.x * 100}%`, top: `${object.y * 100}%` }"
        :aria-label="`选择${object.label}`"
        type="button"
        @click="$emit('select', object)"
      >
        <span class="soul-aura"></span>
        <span class="soul-ring"></span>
        <span class="soul-spark spark-one"></span>
        <span class="soul-spark spark-two"></span>
        <span class="soul-spark spark-three"></span>
        <span class="hotspot-label">{{ object.label }}</span>
      </button>
    </TransitionGroup>
  </div>
</template>
