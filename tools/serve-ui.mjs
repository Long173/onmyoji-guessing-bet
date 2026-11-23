// tools/serve-ui.mjs — ★ 本地启动器：把 apps/web/dist 用零依赖静态服务跑起来，并打开浏览器
//
// 为什么需要它：这个仓库的网页端是**纯静态产物**（apps/web/src/main.ts 只做 createApp().mount，
// 全仓库 grep 不到任何 window.__DSH_BOOT__ 之类的注入点 —— 也就是说 dist 可以脱离任何宿主独立跑）。
// 原来只能在 DSH 的界面里看；这个脚本给一个「双击就能开」的入口。
//
// 用法：
//   node tools/serve-ui.mjs              # 默认 http://127.0.0.1:8931/，并自动打开浏览器
//   node tools/serve-ui.mjs --port 9000  # 换端口
//   node tools/serve-ui.mjs --no-open    # 不自动开浏览器
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { exec, spawnSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "apps", "web", "dist");
const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : dflt; };
const PORT = Number(arg("--port", "8931"));
const OPEN = !process.argv.includes("--no-open");

if (!fs.existsSync(path.join(DIST, "index.html"))) {
  console.error("找不到 apps/web/dist/index.html —— 先构建一次：");
  console.error("  cd apps/web && node node_modules/vite/bin/vite.js build");
  process.exit(1);
}

/**
 * ★ 产物新鲜度：改了 apps/web/src 却看着旧界面，是这个项目有前科的一类错位（报告 §153 记过一条）。
 *   所以启动时先比一次 mtime：src 比 dist 新 ⇒ 直接重建（--no-build 可关掉），失败就照旧服务现有产物。
 */
function newestMtime(dir) {
  let newest = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else newest = Math.max(newest, fs.statSync(f).mtimeMs);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return newest;
}
const WEB = path.join(ROOT, "apps", "web");
const srcTime = Math.max(newestMtime(path.join(WEB, "src")), fs.statSync(path.join(WEB, "index.html")).mtimeMs);
const distTime = fs.statSync(path.join(DIST, "index.html")).mtimeMs;
if (srcTime > distTime && !process.argv.includes("--no-build")) {
  console.log("检测到前端源码比产物新 —— 正在重建（约 2 秒）…");
  const r = spawnSync(process.execPath, [path.join(WEB, "node_modules", "vite", "bin", "vite.js"), "build"], { cwd: WEB, encoding: "utf8" });
  if (r.status !== 0) {
    console.log("★ 重建失败（照旧服务现有产物，界面可能落后源码）：");
    console.log((String(r.stdout ?? "") + String(r.stderr ?? "")).slice(0, 600));
  } else {
    console.log("重建完成（" + new Date(fs.statSync(path.join(DIST, "index.html")).mtimeMs).toLocaleTimeString() + "）");
  }
} else if (srcTime > distTime) {
  console.log("★ 提醒：前端源码比产物新（本次按 --no-build 跳过重建）");
} else {
  console.log("产物是最新的（不早于前端源码）");
}

/**
 * ★★ 第 171 轮：启动时顺带跑一次**图鉴索引 vs 知识库**的一致性闸门（tools/check-kb-index.mjs）。
 *   理由：这是「会旧的产物」那一族里唯一没有闸门的一处（stale dist / IR 转储 / 验收表 / 快照都有），
 *   而它偏偏是**用户看得见**的那种旧（图鉴显示旧技能/旧面板）。只打印结论，不阻塞启动。
 */
{
  const r = spawnSync(process.execPath, [path.join(ROOT, "tools", "check-kb-index.mjs")], { cwd: ROOT, encoding: "utf8" });
  const line = (String(r.stdout ?? "") + String(r.stderr ?? "")).trim().split("\n")[0] ?? "";
  if (r.status === 0) console.log("图鉴索引：" + line);
  else {
    console.log("★ 图鉴索引与知识库不一致（界面可能显示旧数据）：");
    console.log((String(r.stdout ?? "") + String(r.stderr ?? "")).trim().split("\n").slice(0, 4).join("\n"));
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2", ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
  let file = path.join(DIST, url);
  // 目录 → index.html；其余不存在的路径回落到 index.html（单页应用）
  if (url.endsWith("/")) file = path.join(file, "index.html");
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    const asDir = path.join(DIST, url, "index.html");
    file = fs.existsSync(asDir) ? asDir : path.join(DIST, "index.html");
  }
  // 防目录穿越：解析后的路径必须仍在 dist 之内
  if (!path.resolve(file).startsWith(DIST)) { res.writeHead(403).end("forbidden"); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end("not found"); return; }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
    res.end(buf);
  });
});

/**
 * ★★★ 启动的健壮性（用户实测踩到 EADDRINUSE 之后补的）：
 *   端口被占时**不要直接抛栈退出**，而是按这个顺序处理 ——
 *     ① 先问一句「那个端口上是不是我们自己的实例」：是 ⇒ 直接打开浏览器并退出 0（不重复起服务）；
 *     ② 不是 ⇒ 自动 +1 换端口重试（最多试 10 个），并把实际端口打出来；
 *     ③ 都不行 ⇒ 明确报错，告诉用户用 --port 指定。
 */
/**
 * ★★★ 第 255 轮修复（用户实测：「启动器说直接打开它，浏览器却没动」）：
 *   原来这一行是 `exec('start "" "' + url + '"', { shell: "cmd.exe" })` —— 交给 cmd 时**引号被套了两层**
 *   （`cmd /d /s /c "start "" "http://…""`），`start` 拿到的是一个畸形的标题参数 ⇒ **静默失败**：
 *   服务在跑、控制台也印着「直接打开它」，浏览器里却什么都没发生（回调把错误吞了）。
 *   改法：用**参数数组**（不拼字符串、不过 shell），再留两级兜底（explorer → 打印 URL 让用户点）。
 *   ★ 这条路径是**用户自己的入口**（双击 启动UI.bat），所以"打不开"必须是**看得见的一句话**，不许静默。
 */
function openBrowser(url) {
  if (!OPEN) return;
  const attempts = [
    ["cmd", ["/c", "start", "", url]],
    ["explorer.exe", [url]],
  ];
  for (const [cmd, args] of attempts) {
    const r = spawnSync(cmd, args, { stdio: "ignore", windowsHide: true });
    if (!r.error) return;
  }
  console.log("（浏览器没能自动打开 —— 请手动访问 " + url + "）");
}
function announce(port) {
  const url = "http://127.0.0.1:" + port + "/";
  console.log("阴阳师对弈模拟器 · UI 已启动 → " + url);
  console.log("（关掉这个窗口即停止服务。产物目录：apps/web/dist）");
  openBrowser(url);
}
function tryListen(port, left) {
  server.once("error", (err) => {
    if (err.code !== "EADDRINUSE") { console.error("启动失败：" + err.message); process.exit(1); }
    // 端口被占：先看是不是我们自己的实例（判据：首页里有我们的标题或构建产物引用）
    http.get({ host: "127.0.0.1", port, path: "/", timeout: 1500 }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => {
        if (res.statusCode === 200 && /阴阳师|assets\/index-/.test(body)) {
          console.log("检测到已有实例在 " + port + " 端口上运行 —— 直接打开它（不重复起服务）");
          openBrowser("http://127.0.0.1:" + port + "/");
          process.exit(0);
        }
        if (left <= 0) { console.error("端口 " + port + " 被别的程序占用，且换端口也失败了。用 --port 指定一个空闲端口。"); process.exit(1); }
        console.log("端口 " + port + " 被别的程序占用 —— 换到 " + (port + 1) + " 重试");
        tryListen(port + 1, left - 1);
      });
    }).on("error", () => tryListen(port + 1, left - 1)).on("timeout", function () { this.destroy(); tryListen(port + 1, left - 1); });
  });
  server.listen(port, "127.0.0.1", () => announce(port));
}
tryListen(PORT, 10);
