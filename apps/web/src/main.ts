import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "./styles/fonts.ts";
import "./styles/base.css";

const app = createApp(App);
/**
 * ★★★ 第 256 轮：**错误出口必须在页面上看得见**。
 *   由来：用户截图里「观看战斗」整块空白（连兜底文案都没有），而组件级 SSR、逐帧 Presenter、
 *   Worker 三种探针全绿 —— 也就是说**出了错也没人看得见**，只能靠猜。
 *   这一族（静默失败）在本仓库已经栽过好几次（启动器不打开浏览器、报表比现实乐观…），
 *   处置一致：把它变成一句看得见的话。
 *   ① 挂全局 errorHandler（渲染/生命周期/侦听器里的异常都会走到这里）；
 *   ② 往 #app 里塞一个固定的错误条（不依赖 Vue 的渲染树 —— 树自己坏了它才最需要工作）。
 */
app.config.errorHandler = (err, _inst, info) => {
  const msg = (err as any)?.message ?? String(err);
  console.error("[engine-ui] " + info + ": " + msg, err);
  try {
    const host = document.getElementById("app");
    if (!host) return;
    let bar = document.getElementById("dsh-crash");
    if (!bar) {
      bar = document.createElement("pre");
      bar.id = "dsh-crash";
      bar.style.cssText = "position:fixed;left:0;right:0;bottom:0;max-height:35vh;overflow:auto;margin:0;padding:10px 14px;background:#3a1414;color:#ffd9d9;font:12px/1.5 ui-monospace,Consolas,monospace;border-top:1px solid #a33;z-index:9999;white-space:pre-wrap";
      host.appendChild(bar);
    }
    bar.textContent = "⚠ UI error (" + info + "): " + msg + "\nThis bar appears automatically so errors are never silent. Send a screenshot of this text to the maintainer." + (bar.textContent ? "\n\n" + bar.textContent : "");
  } catch { /* 连错误条都画不出来时，至少 console 里有 */ }
};
app.use(createPinia()).mount("#app");
