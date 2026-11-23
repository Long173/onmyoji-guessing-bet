<script setup lang="ts">
// The detected Lineup grid drawn over the screenshot: row/column lines, review-flagged cells tinted,
// the cell under the cursor in the review table outlined. Row index: 0 = name, 1–8 = stats, 9 = soul.
import { onMounted, ref, watch } from "vue";
import type { ParsedTable } from "../../screenshot/parse";

const props = defineProps<{
  table: ParsedTable;
  /** flagged[col][row] */
  flagged: boolean[][];
  focus: { c: number; r: number } | null;
}>();

const canvas = ref<HTMLCanvasElement | null>(null);
let base: HTMLCanvasElement | null = null;
let origin = { x: 0, y: 0 };

function buildBase() {
  const t = props.table, g = t.grid;
  const pad = Math.round(g.rowHeight * 0.4);
  const x = Math.max(0, g.bbox.x - pad), y = Math.max(0, g.bbox.y - pad);
  const w = Math.min(t.image.width - x, g.bbox.w + pad * 2), h = Math.min(t.image.height - y, g.bbox.h + pad * 2);
  base = document.createElement("canvas");
  base.width = w; base.height = h;
  const ctx = base.getContext("2d");
  if (!ctx) return;
  const data = new ImageData(new Uint8ClampedArray(t.image.data), t.image.width, t.image.height);
  ctx.putImageData(data, -x, -y, x, y, w, h);
  origin = { x, y };
}

function rowSpan(r: number) {
  const g = props.table.grid;
  return r === 0 ? g.header : r === 9 ? g.soulRow : g.statRows[r - 1];
}

function draw() {
  const el = canvas.value;
  if (!el || !base) return;
  el.width = base.width; el.height = base.height;
  const ctx = el.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(base, 0, 0);
  const g = props.table.grid;
  const ox = origin.x, oy = origin.y;
  const lw = Math.max(1, Math.round(g.rowHeight / 20));
  for (let c = 0; c < 5; c++) for (let r = 0; r < 10; r++) {
    if (!props.flagged[c]?.[r]) continue;
    const col = g.cols[c], row = rowSpan(r);
    ctx.fillStyle = "rgba(214, 120, 40, 0.30)";
    ctx.fillRect(col.a - ox, row.a - oy, col.b - col.a, row.b - row.a);
  }
  ctx.strokeStyle = "rgba(60, 160, 110, 0.9)";
  ctx.lineWidth = lw;
  const x0 = g.labelCol.a - ox, x1 = g.cols[4].b - ox;
  const ys = [g.header.a, g.header.b, ...g.statRows.map(s => s.b), g.soulRow.b];
  ctx.beginPath();
  for (const y of ys) { ctx.moveTo(x0, y - oy + 0.5); ctx.lineTo(x1, y - oy + 0.5); }
  for (const x of [g.labelCol.a, ...g.cols.map(c => c.a), g.cols[4].b]) { ctx.moveTo(x - ox + 0.5, g.header.a - oy); ctx.lineTo(x - ox + 0.5, g.soulRow.b - oy); }
  ctx.stroke();
  // soul icon circles
  ctx.strokeStyle = "rgba(201, 169, 97, 0.95)";
  for (const u of props.table.units) {
    if (!u.soul.icon) continue;
    const i = u.soul.icon;
    ctx.beginPath(); ctx.arc(i.x + i.w / 2 - ox, i.y + i.h / 2 - oy, i.w / 2, 0, Math.PI * 2); ctx.stroke();
  }
  if (props.focus) {
    const col = g.cols[props.focus.c], row = rowSpan(props.focus.r);
    ctx.strokeStyle = "#f0e4c6";
    ctx.lineWidth = lw * 2.5;
    ctx.strokeRect(col.a - ox, row.a - oy, col.b - col.a, row.b - row.a);
  }
}

onMounted(() => { buildBase(); draw(); });
watch(() => props.table, () => { buildBase(); draw(); });
watch(() => [props.focus, props.flagged], draw, { deep: true });
</script>

<template>
  <canvas ref="canvas" class="overlay-canvas" />
</template>

<style scoped>
.overlay-canvas { display: block; width: 100%; height: auto; border: 1px solid var(--line); border-radius: var(--radius-sm); background: #0e0c0a; }
</style>
