# Bangla → English translation step (Hy-MT3-1.8B GGUF)

Voice Brain can now translate a Bangla request into English with
[Tencent Hy-MT3-1.8B](https://huggingface.co/tencent/Hy-MT3-1.8B-GGUF) before
the chat model sees it, then translate the English answer back to Bangla.
Small local chat models reason and call tools much better in English, so this
improves answers when you speak Bangla to Ollama, llama.cpp or a cloud model.

```
Bangla speech ─▶ NLU ─┬─ known command ──────────────▶ local brain (instant, unchanged)
                      └─ converse ─▶ Hy-MT3 bn→en ─▶ brain.provider (tools, reasoning)
                                                          │
Bangla voice ◀── TTS bn ◀── Hy-MT3 en→bn ◀── English reply ┘
```

The step is off by default. It only runs when all of these are true:

- Settings → Translation → "Bangla → English pivot" is on.
- The request goes to a real model (provider ≠ `local`; in `hybrid` mode only for requests the built-in NLU doesn't recognize).
- The utterance is Bangla: `detectLanguage` returned `bn`, or at least 30 % of the letters are Bangla script.

## Run the model

Hy-MT3 is licensed under Apache 2.0. Q4_K_M is a 1.35 GB download; Q8_0 is 1.91 GB.

Ollama:

```
ollama run hf.co/tencent/Hy-MT3-1.8B-GGUF:Q4_K_M
```

llama.cpp (any recent build):

```
llama-server -hf tencent/Hy-MT3-1.8B-GGUF:Q4_K_M --host 0.0.0.0 --port 8081 -c 4096
```

Then open Settings → Translation in the app:

| Setting | Default | Notes |
|---|---|---|
| `translate.enabled` | `false` | Master switch. |
| `translate.endpoint` | `http://localhost:11434/v1` | Any OpenAI-compatible base URL; `/v1` is added when missing. On the phone, `localhost` means the phone itself, so use your PC's LAN IP (e.g. `http://192.168.0.10:11434`). |
| `translate.model` | `hf.co/tencent/Hy-MT3-1.8B-GGUF:Q4_K_M` | Ollama needs the exact name; llama.cpp ignores it. |
| `translate.replyInBangla` | `true` | Off = the English reply is kept and spoken with an English voice. This saves the second translation. |
| `translate.timeout` | `20` s | Separate from `brain.timeout`. |
| `translate.glossary` | app vocabulary | `bangla=english` pairs. Only pairs that occur in the text are sent. |

The translator and the chat model can share one Ollama server.

## What the router does

`brain.runProvider()` in `voice-brain/js/core/brain.js`:

1. If `translator.shouldPivot(...)` is true, the utterance goes to Hy-MT3 using the model card's prompt: one user message, no system prompt, `top_p 0.6, top_k 20, repetition_penalty 1.05`. The temperature is 0.3, lower than the card's 0.7, so commands stay literal.
2. The model gets the English text as the last user message, plus `language = English`, so the provider's "Reply in …" line asks for English.
3. Earlier turns of a translated conversation are sent in their English form, which is stored as `history[i].en`.
4. After the tool loop, the English reply is translated back to Bangla, and text-to-speech keeps the Bangla voice. If `replyInBangla` is off, or the back-translation fails, the reply stays English and `brain:language` switches the voice to English.
5. The result carries `translated: { utterance, reply, engine: "hy-mt3" }`.

Failure handling:

| Failure | What happens |
|---|---|
| Translator unreachable, times out, returns HTTP ≥ 400, or returns output that still looks Bangla, is empty, or is more than 4× the input length | The original Bangla is sent to the model as before. A warning appears in the activity feed. |
| Back-translation fails | The English reply is spoken with an English voice. |
| Chat provider fails | The existing fallback to the built-in brain still works; it gets the English text, which its English patterns understand. |

Translations are cached (LRU, 64 entries). Input is capped at 2,000 characters.

### Why a glossary

Without it, entity names get transliterated badly. These are real Hy-MT3 Q4_K_M outputs:

| Bangla | No glossary | With glossary |
|---|---|---|
| তিনটি মিউজ তৈরি করো | Create three **mujs**. | Create three **muse** |
| নোভা আর কোরকে সংযুক্ত করো | Connect Nova and **Kork**. | Connect Nova and **Core**. |
| ম্যাট্রিক্সে কয়টা স্পার্ক আছে আর কেন সেগুলো নীল? | — | How many sparks are in the matrix, and why are they blue? |

Add the names of your own entities and agents to `translate.glossary`.

## Latency

Each translated turn adds two short generations. On a 2-core x86 sandbox with Q4_K_M:

- About 1.0–2.2 s for a one-line request into English.
- About 5–7 s for a sentence-length reply into Bangla.

A desktop GPU or Apple Silicon is much faster. Turn `replyInBangla` off if you can read English and want the lowest latency.

## Applying it

The repo doesn't contain the web/Gradle sources yet, only `voice-brain.apk`. That leaves two ways to apply the change.

### A. Source tree (preferred)

1. Copy `voice-brain/js/core/translate.js` next to `brain.js` and `options.js`.
2. Make the edits listed in `patches/apply-to-bundle.py` (`EDITS` 1–7). They map one-to-one onto the ES modules:
   - `options.js`: the 6 `translate.*` keys in `DEFAULTS`, and the "Translation" group in `OPTION_SCHEMA`. `Options.set` rejects unknown keys, so this step is required for the settings panel.
   - `brain.js`: `import { translator, ENGLISH } from "./translate.js";`, the `pivot` block before `messages`, `language: modelLanguage` in `provider.chat`, the back-translation before `return`, and the two `history[n].en` lines in `think()`.
3. Rebuild the APK with your usual build script.

### B. Patch the shipped v1.2.0 bundle

```
unzip voice-brain.apk 'assets/www/*' -d /tmp/apk
python3 patches/apply-to-bundle.py /tmp/apk/assets/www/js/bundle.js
node --check /tmp/apk/assets/www/js/bundle.js
```

Then put `assets/www` back into your build and re-sign it with your own key. The script checks every anchor before it changes anything, and running it twice changes nothing.

## Tests

```
node --test tests/                                  # 9 unit tests, mocked fetch
HY_MT3_URL=http://localhost:8081 node --test tests/ # + live Hy-MT3 round trip
```

`tests/bundle-smoke.mjs` boots the patched bundle in jsdom against a fake OpenAI brain and real Hy-MT3. It checks four cases: translation on, `replyInBangla` off, translator offline, and translation disabled.
