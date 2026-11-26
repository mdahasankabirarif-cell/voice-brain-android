// node --test tests/
// Unit tests for voice-brain/js/core/translate.js with a mocked fetch.
// Set HY_MT3_URL=http://localhost:8081/v1 to also run the live round-trip test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, copyFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// translate.js imports ./options.js, which lives in the app source tree.
// Stage it next to a tiny stand-in so the module loads on its own.
const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "vb-tr-"));
mkdirSync(dir, { recursive: true });
copyFileSync(join(here, "..", "voice-brain", "js", "core", "translate.js"), join(dir, "translate.js"));
writeFileSync(
  join(dir, "options.js"),
  "const v = {}; export const options = { get: (k) => v[k], set: (k, x) => { v[k] = x; return true; }, _v: v };\n"
);
const mod = await import(pathToFileURL(join(dir, "translate.js")).href);
const { options } = await import(pathToFileURL(join(dir, "options.js")).href);
const { translator, buildPrompt, cleanOutput, looksValid, normaliseBase, parseGlossary, banglaRatio } = mod;

function reply(content, status = 200) {
  return { ok: status < 400, status, json: async () => ({ choices: [{ message: { content } }] }) };
}
function mockFetch(fn) {
  const calls = [];
  translator.fetch = async (url, init) => {
    calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null });
    return fn(url, init, calls.length);
  };
  translator.cache.clear();
  return calls;
}

test("off by default; pivots only Bangla on a real model", () => {
  assert.equal(translator.enabled(), false);
  assert.equal(translator.shouldPivot("তিনটি মিউজ তৈরি করো", { language: "bn" }, "ollama"), false);
  options.set("translate.enabled", true);
  assert.equal(translator.shouldPivot("তিনটি মিউজ তৈরি করো", { language: "bn" }, "ollama"), true);
  assert.equal(translator.shouldPivot("তিনটি মিউজ তৈরি করো", null, "openai"), true);
  assert.equal(translator.shouldPivot("make three muses", { language: "en" }, "ollama"), false);
  assert.equal(translator.shouldPivot("তিনটি মিউজ", { language: "bn" }, "local"), false);
});

test("endpoint normalisation", () => {
  assert.equal(normaliseBase("http://192.168.0.5:11434"), "http://192.168.0.5:11434/v1");
  assert.equal(normaliseBase("http://h:8081/v1/"), "http://h:8081/v1");
  assert.equal(normaliseBase("http://h:8081/v1/chat/completions"), "http://h:8081/v1");
  assert.equal(normaliseBase(""), "http://localhost:11434/v1");
});

test("prompt follows the model card and adds only matching glossary terms", () => {
  const g = parseGlossary("মিউজ=muse, কোর=Core\nনোভা=Nova");
  assert.deepEqual(g, [["মিউজ", "muse"], ["কোর", "Core"], ["নোভা", "Nova"]]);
  const p = buildPrompt("তিনটি মিউজ তৈরি করো", "en", g);
  assert.match(p, /^Reference the following translations:\nমিউজ translates to muse\n\n/);
  assert.doesNotMatch(p, /Nova/);
  assert.match(p, /Translate the following text into English\. Note that you should only output the translated result without any additional explanation:\n\nতিনটি মিউজ তৈরি করো$/);
  const back = buildPrompt("Nova is linked to Core.", "bn", g);
  assert.match(back, /Core translates to কোর/);
  assert.match(back, /into Bengali\./);
  assert.doesNotMatch(buildPrompt("hello", "en", g), /Reference/);
});

test("output cleaning and validation", () => {
  assert.equal(cleanOutput('<think></think>\n"Create three muses."'), "Create three muses.");
  assert.equal(cleanOutput("Translation: Hello"), "Hello");
  assert.equal(cleanOutput("অনুবাদ: হ্যালো"), "হ্যালো");
  assert.equal(looksValid("তিনটি মিউজ", "", "en"), false);
  assert.equal(looksValid("তিনটি মিউজ", "তিনটি মিউজ", "en"), false); // echoed back
  assert.equal(looksValid("হ্যাঁ", "x".repeat(500), "en"), false); // ran away
  assert.equal(looksValid("Hello there", "Hello there", "bn"), false);
  assert.equal(looksValid("তিনটি মিউজ তৈরি করো", "Create three muses.", "en"), true);
  assert.ok(banglaRatio("আমি ভাত খাই") > 0.9);
  assert.equal(banglaRatio("123 !!"), 0);
});

test("request shape: one user message, model-card sampling, /v1/chat/completions", async () => {
  options.set("translate.endpoint", "http://pc.lan:11434");
  const calls = mockFetch(() => reply("Create three muses."));
  const out = await translator.toEnglish("তিনটি মিউজ তৈরি করো");
  assert.equal(out, "Create three muses.");
  assert.equal(calls[0].url, "http://pc.lan:11434/v1/chat/completions");
  const b = calls[0].body;
  assert.equal(b.model, "hf.co/tencent/Hy-MT3-1.8B-GGUF:Q4_K_M");
  assert.equal(b.messages.length, 1);
  assert.equal(b.messages[0].role, "user");
  assert.equal(b.top_p, 0.6);
  assert.equal(b.top_k, 20);
  assert.equal(b.repetition_penalty, 1.05);
  assert.equal(b.stream, false);
});

test("cache hits skip the network", async () => {
  const calls = mockFetch(() => reply("Hello."));
  await translator.toEnglish("হ্যালো");
  await translator.toEnglish("হ্যালো");
  assert.equal(calls.length, 1);
});

test("toBangla leaves Bangla alone and translates English", async () => {
  const calls = mockFetch(() => reply("তিনটি মিউজ তৈরি হয়েছে।"));
  assert.equal(await translator.toBangla("ইতিমধ্যে বাংলা"), "ইতিমধ্যে বাংলা");
  assert.equal(calls.length, 0);
  assert.equal(await translator.toBangla("Three muses created."), "তিনটি মিউজ তৈরি হয়েছে।");
  assert.match(calls[0].body.messages[0].content, /into Bengali/);
});

test("failures throw so the brain can fall back", async () => {
  mockFetch(() => reply("", 500));
  await assert.rejects(translator.toEnglish("আবহাওয়া"), /answered 500/);
  mockFetch(() => reply("আবহাওয়া"));
  await assert.rejects(translator.toEnglish("আবহাওয়া কেমন"), /looked wrong/);
  mockFetch(() => Promise.reject(new TypeError("fetch failed")));
  await assert.rejects(translator.toEnglish("আবহাওয়া কেমন আজ"), /fetch failed/);
});

test("timeout aborts a hung server", async () => {
  options.set("translate.timeout", 3);
  translator.cache.clear();
  translator.fetch = (url, init) =>
    new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
  const t0 = Date.now();
  await assert.rejects(translator.toEnglish("ধীর সার্ভার"), /timed out after 3s/);
  assert.ok(Date.now() - t0 < 4500);
  options.set("translate.timeout", 20);
});

test("live Hy-MT3 round trip", { skip: !process.env.HY_MT3_URL }, async () => {
  options.set("translate.endpoint", process.env.HY_MT3_URL);
  translator.fetch = (...a) => globalThis.fetch(...a);
  translator.cache.clear();
  const en = await translator.toEnglish("তিনটি মিউজ তৈরি করো এবং নোভা আর কোরকে সংযুক্ত করো");
  assert.match(en, /muse/i);
  assert.match(en, /Nova/);
  assert.match(en, /Core/);
  const bn = await translator.toBangla("I created three muses and linked Nova to Core.");
  assert.ok(banglaRatio(bn) > 0.5, bn);
});
