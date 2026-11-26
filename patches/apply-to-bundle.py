#!/usr/bin/env python3
"""Add the Hy-MT3 Bangla->English translation step to a built bundle.js.

Usage:
    python3 patches/apply-to-bundle.py path/to/assets/www/js/bundle.js [out.js]

The script is idempotent: an already patched bundle is left untouched. Every
anchor is checked first, so an unexpected bundle (a newer build) fails loudly
instead of being half-patched. Prefer editing the ES-module sources
(see docs/hy-mt3-translation.md) once the Gradle project is in the repo;
this script is for the shipped v1.2.0 bundle.
"""
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
MODULE = HERE.parent / "voice-brain" / "js" / "core" / "translate.js"
MARK = "/* hy-mt3-translation */"


def module_as_esm() -> str:
    src = MODULE.read_text(encoding="utf-8")
    src = re.sub(r'^import .*?;\n', "", src, flags=re.M)
    src = re.sub(r'^export default .*?;\n', "", src, flags=re.M)
    src = re.sub(r'^export (const|function|class) ', r'\1 ', src, flags=re.M)
    body = "\n".join("        " + line if line else "" for line in src.splitlines())
    return (
        f"  // ../voice-brain/js/core/translate.js {MARK}\n"
        "  var translator, ENGLISH, BANGLA_RE;\n"
        "  var init_translate = __esm({\n"
        '    "../voice-brain/js/core/translate.js"() {\n'
        "      init_options();\n"
        "      ({ translator, ENGLISH, BANGLA_RE } = (() => {\n"
        f"{body}\n"
        "        return { translator, ENGLISH, BANGLA_RE };\n"
        "      })());\n"
        "    }\n"
        "  });\n\n"
    )


EDITS = [
    # 1. options.js — defaults
    (
        '        "ui.verbose": false\n      };\n      OPTION_SCHEMA = [\n',
        '        "ui.verbose": false,\n'
        "        // ── Translation (Hy-MT3) ───────────────────────────── " + MARK + "\n"
        '        "translate.enabled": false,\n'
        '        "translate.endpoint": "http://localhost:11434/v1",\n'
        '        "translate.model": "hf.co/tencent/Hy-MT3-1.8B-GGUF:Q4_K_M",\n'
        '        "translate.replyInBangla": true,\n'
        '        "translate.timeout": 20,\n'
        '        "translate.glossary": "মিউজ=muse, মিউজে=muse, স্পার্ক=spark, নোভা=Nova, কোর=Core, ম্যাট্রিক্স=matrix, ব্রেইন=Brain"\n'
        "      };\n      OPTION_SCHEMA = [\n",
    ),
    # 2. options.js — settings panel group, placed before "Interface"
    (
        '        {\n          group: "Interface",\n',
        "        {\n"
        '          group: "Translation",\n'
        "          items: [\n"
        '            { key: "translate.enabled", label: "Bangla → English pivot", type: "switch", desc: "Bangla requests are translated to English with Hy-MT3 before the model sees them, and the answer is translated back. Known commands stay instant and local." },\n'
        '            { key: "translate.endpoint", label: "Translator endpoint", type: "text", desc: "OpenAI-compatible server running Hy-MT3 (Ollama, llama.cpp, LM Studio). On a phone use your computer\'s LAN IP, not localhost." },\n'
        '            { key: "translate.model", label: "Translator model", type: "text", desc: "Ollama: hf.co/tencent/Hy-MT3-1.8B-GGUF:Q4_K_M. llama.cpp ignores the name." },\n'
        '            { key: "translate.replyInBangla", label: "Reply in Bangla", type: "switch", desc: "Off = keep the English reply and speak it with an English voice (saves one translation)." },\n'
        '            { key: "translate.timeout", label: "Translator timeout (s)", type: "number", min: 3, max: 120, step: 1 },\n'
        '            { key: "translate.glossary", label: "Glossary", type: "textarea", desc: "bangla=english pairs, comma separated. Keeps names of your entities intact." }\n'
        "          ]\n"
        "        },\n"
        '        {\n          group: "Interface",\n',
    ),
    # 3. brain.js — import
    (
        "      init_i18n();\n      HISTORY_LIMIT2 = 14;\n",
        "      init_i18n();\n      init_translate();\n      HISTORY_LIMIT2 = 14;\n",
    ),
    # 4. brain.js — think(): remember the English side of a pivoted turn
    (
        '            this.push("user", utterance);\n            this.push("assistant", result.reply);\n',
        '            this.push("user", utterance);\n            this.push("assistant", result.reply);\n'
        "            if (result.translated) {\n"
        "              const n = this.history.length;\n"
        "              if (n >= 2) {\n"
        "                this.history[n - 2].en = result.translated.utterance;\n"
        "                this.history[n - 1].en = result.translated.reply;\n"
        "              }\n"
        "            }\n",
    ),
    # 5. brain.js — runProvider(): translate the utterance before the model
    (
        "          const history = agent ? agent.history || [] : this.history;\n"
        "          const messages = [\n"
        '            ...history.slice(-8).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content || "" })),\n'
        '            { role: "user", content: utterance }\n'
        "          ];\n",
        "          const history = agent ? agent.history || [] : this.history;\n"
        "          let pivot = null;\n"
        "          let modelUtterance = utterance;\n"
        "          let modelLanguage = language;\n"
        "          if (!forceLocal && translator.shouldPivot(utterance, language, provider.id)) {\n"
        "            try {\n"
        "              modelUtterance = await translator.toEnglish(utterance);\n"
        "              modelLanguage = ENGLISH;\n"
        "              pivot = { utterance: modelUtterance };\n"
        "              say(`Hy-MT3 · bn→en “${modelUtterance}”`, \"info\");\n"
        "            } catch (err) {\n"
        "              const why = String((err == null ? void 0 : err.message) || err);\n"
        "              say(`translation failed: ${why} — sending the Bangla as-is`, \"warn\");\n"
        "              bus.emit(EV.ACTIVITY, { tag: \"brain\", text: `Translator unavailable (${why}) — sent the Bangla as-is.` });\n"
        "            }\n"
        "          }\n"
        "          const messages = [\n"
        '            ...history.slice(-8).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: (pivot && m.en) || m.content || "" })),\n'
        '            { role: "user", content: modelUtterance }\n'
        "          ];\n",
    ),
    # 6. brain.js — pass the English language to the provider
    (
        "                temperature,\n                language,\n                creds,\n",
        "                temperature,\n                language: modelLanguage,\n                creds,\n",
    ),
    # 7. brain.js — translate the reply back, return metadata
    (
        '          if (lastText.length < 2) lastText = "I could not make sense of that.";\n'
        "          return { reply: lastText, toolCalls, provider: provider.id, usage };\n",
        '          if (lastText.length < 2) lastText = "I could not make sense of that.";\n'
        "          let translated = null;\n"
        "          if (pivot) {\n"
        "            translated = { utterance: pivot.utterance, reply: lastText, engine: \"hy-mt3\" };\n"
        "            if (translator.config().replyInBangla) {\n"
        "              try {\n"
        "                lastText = await translator.toBangla(lastText);\n"
        "                say(\"Hy-MT3 · en→bn reply\", \"info\");\n"
        "              } catch (err) {\n"
        "                const why = String((err == null ? void 0 : err.message) || err);\n"
        "                say(`reply translation failed: ${why} — answering in English`, \"warn\");\n"
        "                this.language = ENGLISH;\n"
        "                bus.emit(\"brain:language\", ENGLISH);\n"
        "              }\n"
        "            } else {\n"
        "              this.language = ENGLISH;\n"
        "              bus.emit(\"brain:language\", ENGLISH);\n"
        "            }\n"
        "          }\n"
        "          return { reply: lastText, toolCalls, provider: provider.id, usage, translated };\n",
    ),
]


def patch(src: str) -> str:
    if MARK in src:
        print("already patched")
        return src
    for i, (old, _) in enumerate(EDITS, 1):
        n = src.count(old)
        if n != 1:
            sys.exit(f"edit {i}: anchor found {n} times (expected 1) — bundle is not v1.2.0?")
    for old, new in EDITS:
        src = src.replace(old, new, 1)
    anchor = "  // ../voice-brain/js/core/brain.js\n"
    if src.count(anchor) != 1:
        sys.exit("brain.js module header not found")
    return src.replace(anchor, module_as_esm() + anchor, 1)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    inp = pathlib.Path(sys.argv[1])
    out = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else inp
    out.write_text(patch(inp.read_text(encoding="utf-8")), encoding="utf-8")
    print(f"patched → {out}")
