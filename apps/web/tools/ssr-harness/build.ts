// tools/ssr-harness/build.ts — ★★★ 第 139 轮：SSR 验收的**共用构建器**（ui16 / ui17 都走它）
//
// 为什么抽出来：构建产物与加载方式有几条硬约束（都是实测踩出来的），写在两处必然走样：
//   ① 产物必须落在能解析到依赖的地方 —— 系统临时目录里解析不到 vue（ERR_MODULE_NOT_FOUND），
//      只有 node_modules 下面才行；
//   ② 又不能落在源码目录里 —— 本进程 import 过之后 Windows 上就删不掉了
//      （fs.rmSync 报成功但目录仍在，子进程轮询也删不掉，只有本进程退出才行）；
//   ③ 加载要用 file:// URL（Windows 上直接 import 绝对路径会 ERR_UNSUPPORTED_ESM_URL_SCHEME）。
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const WEB = path.resolve(import.meta.dirname, "..", "..");
export const HARNESS_DIR = import.meta.dirname;
export const SSR_OUT = path.join(WEB, "node_modules", ".dsh-ssr-harness");
export const VITE_BIN = path.join(WEB, "node_modules", "vite", "bin", "vite.js");
export const ENTRY_REL = "tools/ssr-harness/entry.ts";

/** 构建 + 加载。失败时返回 ok:false 与原始输出（测试自己决定怎么报）。 */
export async function buildHarness(): Promise<{ ok: boolean; module?: any; error?: string; ms: number }> {
  const t0 = Date.now();
  try {
    fs.rmSync(SSR_OUT, { recursive: true, force: true });
    execFileSync(process.execPath, [VITE_BIN, "build", "--ssr", ENTRY_REL, "--outDir", SSR_OUT, "--emptyOutDir"],
      { cwd: WEB, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e: any) {
    return { ok: false, error: String(e?.stdout ?? e?.stderr ?? e?.message ?? e).slice(0, 400), ms: Date.now() - t0 };
  }
  const out = path.join(SSR_OUT, "entry.js");
  if (!fs.existsSync(out)) return { ok: false, error: "构建产物不存在：" + out, ms: Date.now() - t0 };
  // ★ 加时间戳绕开 ESM 模块缓存（同一进程里多次构建时，第二次必须拿到新代码）
  const mod = await import(pathToFileURL(out).href + "?t=" + Date.now());
  return { ok: true, module: mod, ms: Date.now() - t0 };
}
