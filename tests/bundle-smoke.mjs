import { JSDOM, VirtualConsole } from "jsdom";
import { join } from "node:path";
// Smoke test of a PATCHED bundle in jsdom: fake OpenAI brain on :8099 + real Hy-MT3.
//   unzip voice-brain.apk "assets/www/*" -d /tmp/apk
//   python3 patches/apply-to-bundle.py /tmp/apk/assets/www/js/bundle.js
//   npm i jsdom@24 && HY_MT3_URL=http://127.0.0.1:8081 WWW=/tmp/apk/assets/www node tests/bundle-smoke.mjs
const WWW = process.env.WWW || "assets/www";
import http from "node:http";
import { readFileSync } from "node:fs";
// Fake brain LLM (OpenAI format) that records what it was asked
const seen = [];
const srv = http.createServer((req, res) => {
  let b = ""; req.on("data", c => b += c); req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    if (req.url.endsWith("/models")) return res.end(JSON.stringify({ data: [{ id: "fake" }] }));
    const j = JSON.parse(b || "{}"); seen.push(j);
    const last = j.messages.filter(m => m.role === "user").pop().content;
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: `Sure. The weather in Dhaka today will be warm and sunny, about 28 degrees.` } }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }));
  });
}).listen(8099);
const vc = new VirtualConsole(); const errs = [];
vc.on("jsdomError", e => errs.push(String(e.message).slice(0,200)));
vc.on("error", e => errs.push(String(e).slice(0,200)));
const html = readFileSync(join(WWW, "index.html"), "utf8");
const dom = new JSDOM(html, { url: "http://localhost/", runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(w) {
    w.fetch = (u, i) => fetch(new URL(u, "http://localhost/").href.startsWith("http://localhost/") && !String(u).startsWith("http") ? "http://127.0.0.1:1/" : u, i);
    w.HTMLCanvasElement.prototype.getContext = function () { return new Proxy({}, { get: (t, k) => k === "canvas" ? this : (k === "measureText" ? () => ({ width: 10 }) : (k in t ? t[k] : () => ({ addColorStop(){} }))), set: (t,k,v)=>(t[k]=v,true) }); };
    w.speechSynthesis = { speak(){}, cancel(){}, getVoices: () => [], addEventListener(){}, onvoiceschanged: null };
    w.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} }; w.IntersectionObserver = w.ResizeObserver; w.requestIdleCallback = (f)=>setTimeout(f,1); w.matchMedia = () => ({ matches: false, addEventListener(){}, addListener(){} });
  } });
dom.window.document.querySelector('script[src="js/bundle.js"]')?.remove();
const s = dom.window.document.createElement("script"); s.textContent = readFileSync(join(WWW, "js", "bundle.js"), "utf8"); dom.window.document.body.appendChild(s);
for (let i = 0; i < 50 && !dom.window.VoiceBrain; i++) await new Promise(r => setTimeout(r, 100));
const VB = dom.window.VoiceBrain; if (!VB) { console.log("BOOT FAIL", errs.filter(e=>!e.includes("Could not load")).slice(0,6)); process.exit(1); }
console.log("booted; schema has Translation:", !!VB.options.get("translate.model"));
const thoughts=[]; VB.bus.on(VB.EV.BRAIN_THOUGHT, t => thoughts.push(t.level+": "+t.text)); VB.bus.on(VB.EV.ACTIVITY, t => thoughts.push("ACT: "+t.text));
const langs = []; VB.bus.on("brain:language", g => langs.push(g.code));
const o = VB.options;
o.set("brain.provider", "openai"); o.set("brain.endpoint", "http://127.0.0.1:8099"); o.set("brain.model", "fake"); o.set("brain.mode", "model");
o.set("translate.enabled", true); o.set("translate.endpoint", process.env.HY_MT3_URL || "http://127.0.0.1:8081");
const ask = async (t) => { o.set("brain.provider", "openai"); const t0 = Date.now(); const r = await VB.brain.think(t); return { ms: Date.now() - t0, reply: r.reply, translated: r.translated }; };
let r = await ask("আজ ঢাকায় আবহাওয়া কেমন থাকবে?");
console.log("A) pivot on:", JSON.stringify(r));
const req = seen.at(-1); console.log("   brain got:", JSON.stringify(req.messages.at(-1).content), "| sys has 'Reply in English':", JSON.stringify(req.messages).includes("Reply in English"));
console.log("   history en:", JSON.stringify(VB.brain.history.slice(-2).map(h => h.en)), "langs:", langs.join(","));
console.log(thoughts.splice(0).join("\n"));
o.set("translate.replyInBangla", false); langs.length = 0;
r = await ask("আমাকে একটা ছোট গল্প বলো একটা বিড়াল নিয়ে"); console.log("B) replyInBangla off:", r.reply, "| langs:", langs.join(","));
console.log("   brain got:", JSON.stringify(seen.at(-1).messages.at(-1).content), "| prior turn sent as:", JSON.stringify(seen.at(-1).messages.at(-3)?.content));
console.log(thoughts.splice(0).join("\n"));
o.set("translate.replyInBangla", true); o.set("translate.endpoint", "http://127.0.0.1:9"); o.set("translate.timeout", 3);
r = await ask("মনে রাখো আমার প্রিয় রং সবুজ"); console.log("C) translator down:", r.reply.slice(0,60), "| translated:", r.translated, "| brain got:", JSON.stringify(seen.at(-1).messages.at(-1).content));
o.set("translate.enabled", false);
r = await ask("তুমি কে?"); console.log("D) disabled: brain got:", JSON.stringify(seen.at(-1).messages.at(-1).content), "| translated:", r.translated);
console.log("errors:", errs.length, errs.slice(0,3));
srv.close(); process.exit(0);
