<script setup>
defineProps({
  text: {
    type: String,
    required: true,
  },
});
</script>

<template>
  <div class="dialog-bubble">
    {{ text }}
  </div>
</template>
