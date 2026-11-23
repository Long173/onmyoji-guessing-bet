<script setup lang="ts">
// 输入方式的 B 通道：JSON 导入 / 导出 / 复制 / 红蓝互换（文档第六节）
import { ref } from "vue";
import type { GuessingMatch } from "../../contracts/guessing-match";

const props = defineProps<{ match: GuessingMatch }>();
const emit = defineEmits<{ (e: "import", m: GuessingMatch): void; (e: "swap"): void; (e: "error", msg: string): void }>();
const open = ref(false);
const text = ref("");
const mode = ref<"export" | "import">("export");

function show(m: "export" | "import") { mode.value = m; text.value = m === "export" ? JSON.stringify(props.match, null, 1) : ""; open.value = true; }
function doImport() {
  try {
    const m = JSON.parse(text.value) as GuessingMatch;
    if (m?.schemaVersion !== 1 || !m.red?.units || !m.blue?.units) throw new Error("schemaVersion or structure mismatch");
    emit("import", m); open.value = false;
  } catch (e: any) { emit("error", "Import failed: " + String(e?.message ?? e)); }
}
async function copy() { try { await navigator.clipboard.writeText(text.value); } catch { /* 忽略 */ } }
</script>

<template>
  <span class="io">
    <button @click="show('export')">Export lineup</button>
    <button @click="show('import')">Import JSON</button>
    <button @click="emit('swap')">⇄ Swap Red/Blue</button>
    <div v-if="open" class="overlay" @click.self="open = false">
      <div class="dialog">
        <header><b>{{ mode === "export" ? "Export lineup JSON" : "Import lineup JSON" }}</b><span class="spacer" />
          <button v-if="mode === 'export'" @click="copy">Copy</button>
          <button @click="open = false">✕</button></header>
        <textarea v-model="text" spellcheck="false" :readonly="mode === 'export'"
                  :placeholder='mode === "import" ? "Paste GuessingMatch JSON…" : ""' />
        <footer v-if="mode === 'import'"><button class="primary" @click="doImport">Import</button></footer>
      </div>
    </div>
  </span>
</template>

<style scoped>
.io { display: inline-flex; gap: 6px; }
.overlay { position: fixed; inset: 0; background: #0009; display: grid; place-items: center; z-index: 100; }
.dialog { width: min(720px, 92vw); max-height: 80vh; display: flex; flex-direction: column; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--line); }
.spacer { flex: 1; }
textarea { flex: 1; min-height: 380px; margin: 12px; padding: 10px; background: #0f1116; color: var(--fg-dim); border: 1px solid var(--line); border-radius: 8px; font-family: var(--mono); font-size: 11px; resize: none; }
footer { padding: 0 12px 12px; }
.primary { background: #2b4a7a; border-color: #3a5f96; }
</style>
