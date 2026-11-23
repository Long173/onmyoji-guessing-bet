// tests/g132-launcher.ts — ★★★ 第 255 轮：**用户自己的入口**（tools/serve-ui.mjs / 启动UI.bat）第一次有尺子
//
// 由来（用户实测）：双击 启动UI.bat，控制台印着「检测到已有实例在 8931 端口上运行 —— 直接打开它」，
//   **浏览器里什么都没发生**。根因是那一行把 URL 拼进 shell 字符串再交给 cmd：
//     exec('start "" "' + url + '"', { shell: "cmd.exe" })  ⇒  cmd /d /s /c "start "" "http://…""
//   引号套了两层，start 拿到的是畸形参数，而回调把错误吞了 —— 服务在跑、话也说了，浏览器不动。
//
// 这一族的问题是**静默**：没有任何信号告诉用户"没打开"。所以这条尺子两件事都要管：
//   ① 源码级：浏览器必须用**参数数组**打开（不拼 shell 字符串），且"已有实例"那条分支真的调它；
//   ② 端到端：真的把这个静态服务起起来、真的 fetch 一次首页与一个静态资源（"接线了 ≠ 验过了"）。
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const src = fs.readFileSync(path.join(ROOT, "tools", "serve-ui.mjs"), "utf8");
/**
 * ★ 判据要在**剥掉注释**之后跑：这条修复的注释里**故意**留着旧写法（"原来这一行是 …"），
 *   不剥注释的话，尺子会把注释当成代码 —— 第一次跑就正是这样误报了一条（8 passed / 1 failed）。
 */
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

sec("[1] ★★★ 源码级：浏览器用**参数数组**打开（不再拼 shell 字符串）");
{
  ok("★★★ 不再有 'start \"\" \"url\"' 那种把 URL 拼进 shell 的写法（剥注释后判）",
    !/exec\(\s*'start/.test(code), (code.match(/exec\([^\n]{0,60}/) ?? [""])[0]);
  ok("★★★ 走的是 spawnSync + 参数数组（cmd /c start \"\" <url>）",
    /spawnSync\(cmd,\s*args/.test(code) && /\["cmd",\s*\["\/c",\s*"start",\s*"",\s*url\]\]/.test(code), "spawnSync(cmd, args)");
  ok("★★ 有兜底：cmd 起不来就 explorer，再不行**打印 URL**（把静默失败变成看得见的一句话）",
    /explorer\.exe/.test(code) && /浏览器没能自动打开/.test(code));
  ok("★★★ 「检测到已有实例」那条分支真的调 openBrowser（不是只打印一句话）",
    /检测到已有实例在[\s\S]{0,160}openBrowser\(/.test(code));
  ok("★★ 启动器（启动UI.bat）仍然指向这个脚本", fs.readFileSync(path.join(ROOT, "启动UI.bat"), "utf8").includes("node tools\\serve-ui.mjs"));
}

sec("[2] ★★★ 端到端：真起一个静态服务，真 fetch（零依赖、与用户双击时同一条代码路径）");
const freePort = async (): Promise<number> => new Promise((res) => {
  const s = http.createServer();
  s.listen(0, "127.0.0.1", () => { const p = (s.address() as any).port; s.close(() => res(p)); });
});
const get = (url: string): Promise<{ code: number; body: string }> => new Promise((res, rej) => {
  http.get(url, { timeout: 4000 }, (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => res({ code: r.statusCode ?? 0, body: b })); }).on("error", rej);
});
{
  const port = await freePort();
  const child = spawn(process.execPath, ["tools/serve-ui.mjs", "--no-open", "--port", String(port)], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (c) => (out += String(c)));
  child.stderr.on("data", (c) => (out += String(c)));
  const ready = await new Promise<boolean>((res) => {
    const t0 = Date.now();
    const tick = setInterval(() => {
      if (/UI 已启动/.test(out)) { clearInterval(tick); res(true); }
      else if (Date.now() - t0 > 10000) { clearInterval(tick); res(false); }
    }, 120);
  });
  try {
    ok("★★★ 服务真的起来了（控制台出现「UI 已启动」）", ready, JSON.stringify(out.slice(0, 160)));
    if (ready) {
      const home = await get("http://127.0.0.1:" + port + "/");
      ok("★★★ 首页 200 且是我们自己的产物（标题或 assets/index- 引用）", home.code === 200 && /阴阳师|assets\/index-/.test(home.body), String(home.code) + " / " + home.body.slice(0, 60));
      const asset = /assets\/index-[A-Za-z0-9_-]+\.js/.exec(home.body);
      if (asset) {
        const js = await get("http://127.0.0.1:" + port + "/" + asset[0]);
        ok("★★★ 首页引用的那个 JS 真的取得到（不是 404 的白页）", js.code === 200 && js.body.length > 1000, String(js.code) + " " + js.body.length + " bytes");
      } else {
        ok("★★★ 首页引用的那个 JS 真的取得到（不是 404 的白页）", false, "首页里找不到 assets/index-*.js 引用");
      }
      const miss = await get("http://127.0.0.1:" + port + "/definitely-missing-" + port + ".txt");
      ok("★★ 不存在的路径有明确回应（404 或 SPA 回退，不许挂住）", miss.code > 0, String(miss.code));
    }
  } finally {
    child.kill();
  }
}

console.log("\ng132-launcher: " + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
