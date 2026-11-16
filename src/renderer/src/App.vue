<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { RouterView } from 'vue-router'
import UpdateNotice from './components/UpdateNotice.vue'
import { useUpdateStore } from './stores/update'

const update = useUpdateStore()

onMounted(() => update.listen())
onUnmounted(() => update.stop())
</script>

<template>
  <RouterView />
  <UpdateNotice />
</template>
