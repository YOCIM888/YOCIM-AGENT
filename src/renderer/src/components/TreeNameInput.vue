<script setup lang="ts">
import { onMounted, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    initial?: string
    selectBasename?: boolean
    testid?: string
  }>(),
  { initial: '', selectBasename: false, testid: 'tree-name-input' }
)

const emit = defineEmits<{
  commit: [value: string]
  cancel: []
}>()

const input = ref<HTMLInputElement | null>(null)
const value = ref(props.initial)
let done = false

onMounted(() => {
  const element = input.value
  if (!element) return
  element.focus()
  if (props.selectBasename) {
    const dot = props.initial.lastIndexOf('.')
    const end = dot > 0 ? dot : props.initial.length
    element.setSelectionRange(0, end)
  } else {
    element.select()
  }
})

function commit(): void {
  if (done) return
  done = true
  emit('commit', value.value.trim())
}

function cancel(): void {
  if (done) return
  done = true
  emit('cancel')
}
</script>

<template>
  <input
    ref="input"
    v-model="value"
    class="name-input"
    type="text"
    spellcheck="false"
    :data-testid="testid"
    @click.stop
    @dblclick.stop
    @keydown.enter.prevent="commit"
    @keydown.esc.prevent="cancel"
    @blur="commit"
  />
</template>

<style scoped>
.name-input {
  flex: 1;
  min-width: 0;
  padding: 1px 4px;
  border: 1px solid var(--accent);
  border-radius: 3px;
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-size: 12.5px;
  outline: none;
}
</style>
