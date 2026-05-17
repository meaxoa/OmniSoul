<script setup>
defineProps({
  canStart: {
    type: Boolean,
    required: true,
  },
  errorText: {
    type: String,
    default: '',
  },
  loading: {
    type: Boolean,
    required: true,
  },
});

defineEmits(['start']);
</script>

<template>
  <section class="intro">
    <div class="intro-mascot" aria-hidden="true">
      <span></span>
    </div>
    <div class="intro-kicker">AR Soul Camera</div>
    <h1>万物有灵</h1>
    <p>把喜欢的小物件放进画面，轻轻唤醒它的 AI 灵体，像养成伙伴一样慢慢聊天。</p>
    <button class="primary-btn" :disabled="!canStart" @click="$emit('start')">
      {{ loading ? '正在打开相机...' : '打开 AR 相机' }}
    </button>
    <p v-if="errorText" class="error">{{ errorText }}</p>
  </section>
</template>
