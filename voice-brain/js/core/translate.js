// voice-brain/js/core/translate.js
//
// Bangla ⇄ English pivot for the model path, powered by Tencent Hy-MT3-1.8B
// (GGUF, Apache-2.0) running on any OpenAI-compatible server — Ollama,
// llama.cpp `llama-server`, LM Studio.
//
//   Bangla speech ─▶ Hy-MT3 ─▶ English ─▶ brain.provider (tools, reasoning)
//                                              │
//   Bangla voice ◀─ Hy-MT3 ◀─ English reply ◀──┘
//
// Small chat models reason and call tools far better in English than in
// Bangla, so only the model path is pivoted. Known commands that the local
// NLU already understands never come through here.

import { options } from "./options.js";

export const BANGLA_RE = /[\u0980-\u09FF]/;
const BANGLA_ALL = /[\u0980-\u09FF]/g;
const LETTER_ALL = /\p{L}/gu;

export const ENGLISH = { code: "en-US", language: "en", name: "English", confidence: 1, pivot: true };

const DEFAULTS = {
  "translate.enabled": false,
  "translate.endpoint": "http://localhost:11434/v1",
  "translate.model": "hf.co/tencent/Hy-MT3-1.8B-GGUF:Q4_K_M",
  "translate.replyInBangla": true,
  "translate.timeout": 20,
  "translate.glossary": "মিউজ=muse, মিউজে=muse, স্পার্ক=spark, নোভা=Nova, কোর=Core, ম্যাট্রিক্স=matrix, ব্রেইন=Brain"
};

const MAX_INPUT = 2000;
const CACHE_LIMIT = 64;

function opt(key) {
  const v = options && typeof options.get === "function" ? options.get(key) : undefined;
  return v === undefined || v === null || v === "" ? DEFAULTS[key] : v;
}

/** Share of letters that are Bangla script, 0‥1. */
export function banglaRatio(text) {
  const s = String(text || "");
  const letters = (s.match(LETTER_ALL) || []).length;
  if (!letters) return 0;
  return (s.match(BANGLA_ALL) || []).length / letters;
}

export function normaliseBase(url) {
  let base = String(url || "").trim().replace(/\/+$/, "");
  if (!base) base = DEFAULTS["translate.endpoint"];
  base = base.replace(/\/chat\/completions$/, "");
  if (!/\/v\d+$/.test(base)) base += "/v1";
  return base;
}

/** "মিউজ=muse, কোর=Core" or one pair per line → [[src, dst], …] */
export function parseGlossary(raw) {
  return String(raw || "")
    .split(/[,\n;]/)
    .map((p) => p.split("=").map((s) => s.trim()))
    .filter((p) => p.length === 2 && p[0] && p[1]);
}

const TARGET_NAME = { en: "English", bn: "Bengali" };

/** Prompt templates from the Hy-MT3 model card (no system prompt). */
export function buildPrompt(text, target, glossary = []) {
  const lang = TARGET_NAME[target] || target;
  // Only the terms that actually occur, so the prompt stays short.
  const src = String(text);
  const pairs = glossary
    .map(([a, b]) => (target === "en" ? [a, b] : [b, a]))
    .filter(([a]) => src.toLowerCase().includes(a.toLowerCase()));
  const head = pairs.length
    ? "Reference the following translations:\n" + pairs.map(([a, b]) => `${a} translates to ${b}`).join("\n") + "\n\n"
    : "";
  return `${head}Translate the following text into ${lang}. Note that you should only output the translated result without any additional explanation:\n\n${src}`;
}

export function cleanOutput(raw) {
  let s = String(raw || "");
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<\/?think>/gi, "");
  s = s.trim();
  s = s.replace(/^(translation|translated text|english|bengali|bangla)\s*[:：]\s*/i, "");
  s = s.replace(/^অনুবাদ\s*[:：]\s*/, "");
  const q = s.match(/^["“'‘「](.*)["”'’」]$/s);
  if (q) s = q[1];
  return s.trim();
}

/** Reject outputs that are obviously not a translation. */
export function looksValid(input, output, target) {
  if (!output) return false;
  if (output.length > Math.max(40, input.length * 4)) return false;
  const ratio = banglaRatio(output);
  if (target === "en" && ratio > 0.3) return false;
  if (target === "bn" && ratio < 0.3) return false;
  return true;
}

class Translator {
  constructor() {
    this.cache = new Map();
    this.fetch = (...a) => globalThis.fetch(...a);
    this.stats = { calls: 0, hits: 0, failures: 0, lastMs: 0 };
  }

  enabled() {
    return opt("translate.enabled") === true || opt("translate.enabled") === "true";
  }

  config() {
    return {
      base: normaliseBase(opt("translate.endpoint")),
      model: String(opt("translate.model")),
      timeout: Math.max(3, Number(opt("translate.timeout")) || 20) * 1000,
      replyInBangla: opt("translate.replyInBangla") !== false && opt("translate.replyInBangla") !== "false",
      glossary: parseGlossary(opt("translate.glossary"))
    };
  }

  /** True when the server answers /models. Never throws. */
  async available() {
    const { base, timeout } = this.config();
    try {
      const res = await this._timed(`${base}/models`, { method: "GET" }, Math.min(timeout, 4000));
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Pivot when enabled, the request goes to a real model, and the user spoke Bangla. */
  shouldPivot(utterance, language, providerId = "") {
    if (!this.enabled()) return false;
    if (providerId === "local") return false;
    const lang = language && (language.language || String(language.code || "").split("-")[0]);
    if (lang === "bn") return true;
    return banglaRatio(utterance) >= 0.3;
  }

  async _timed(url, init, ms) {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), ms) : null;
    try {
      return await this.fetch(url, ctrl ? { ...init, signal: ctrl.signal } : init);
    } catch (err) {
      if (err && err.name === "AbortError") throw new Error(`translation timed out after ${Math.round(ms / 1000)}s`);
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Translate `text` into `target` ("en" | "bn"). Throws on failure so the
   * caller decides the fallback; the brain falls back to the original text.
   */
  async translate(text, target = "en") {
    const input = String(text || "").trim().slice(0, MAX_INPUT);
    if (!input) return "";
    const key = `${target}\u0000${input}`;
    if (this.cache.has(key)) {
      const hit = this.cache.get(key);
      this.cache.delete(key);
      this.cache.set(key, hit);
      this.stats.hits++;
      return hit;
    }
    const { base, model, timeout, glossary } = this.config();
    const body = {
      model,
      messages: [{ role: "user", content: buildPrompt(input, target, glossary) }],
      // Model-card sampling; a cooler temperature keeps commands literal.
      temperature: 0.3,
      top_p: 0.6,
      top_k: 20,
      repetition_penalty: 1.05,
      repeat_penalty: 1.05,
      max_tokens: Math.min(2048, Math.max(64, input.length * 3)),
      stream: false
    };
    const t0 = Date.now();
    this.stats.calls++;
    try {
      const res = await this._timed(
        `${base}/chat/completions`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
        timeout
      );
      if (!res.ok) throw new Error(`translation server answered ${res.status}`);
      const data = await res.json();
      const raw = data && data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : "";
      const out = cleanOutput(raw);
      if (!looksValid(input, out, target)) throw new Error("translation looked wrong");
      this.stats.lastMs = Date.now() - t0;
      this.cache.set(key, out);
      if (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value);
      return out;
    } catch (err) {
      this.stats.failures++;
      throw err;
    }
  }

  toEnglish(text) {
    return this.translate(text, "en");
  }

  /** Back to Bangla; text that is already Bangla is returned unchanged. */
  async toBangla(text) {
    if (banglaRatio(text) >= 0.3) return String(text || "");
    return this.translate(text, "bn");
  }
}

export const translator = new Translator();
export default translator;
