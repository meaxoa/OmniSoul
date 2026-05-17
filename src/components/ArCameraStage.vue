<script setup>
const videoRef = defineModel('videoRef');
</script>

<template>
  <video ref="videoRef" class="camera-view" autoplay muted playsinline></video>
</template>
