Voice Brain Android
A Bengali-first AI voice assistant for Android, designed to combine local AI, Ollama, and OpenAI with automatic provider fallback.
Project status: Early-stage repository. This README describes the intended product and setup direction. Features are not considered implemented until the corresponding Android app code, backend/provider integration, and tests are present.
Vision
Voice Brain aims to make it easy to speak naturally with an AI assistant in Bangla and English from an Android phone.
Planned capabilities
Bengali and English speech input.
Spoken AI replies using Android text-to-speech.
A local/free rule-based brain for basic commands and offline fallback.
Optional Ollama integration for locally hosted models.
Optional OpenAI-compatible API integration.
Automatic provider fallback when a configured provider is unavailable.
User-configurable provider, model, endpoint, and API key.
Conversation history and configurable memory.
A mobile-friendly settings screen and clear connection/error status.
Intended architecture
Android app
   |
   +--> Speech-to-text
   |
   +--> AI Router
          |
          +--> Local Brain (offline/basic fallback)
          |
          +--> Ollama (optional)
          |
          +--> OpenAI-compatible API (optional)
   |
   +--> Text-to-speech (Bangla / English)
The router should use explicit timeouts, handle provider errors, and move to the next enabled provider according to the user's configured priority. It must never silently claim that a remote provider answered when the local fallback generated the reply.
Repository status
The initial repository commit contains only starter documentation and ignore configuration. The Android application, Gradle project, provider router, and APK build workflow still need to be added.
Requirements for the planned Android build
The exact versions should be pinned when the Android project is created.
Android Studio or compatible Gradle build environment.
Android SDK and a supported JDK.
An Android device or emulator for testing.
Internet access only for remote providers and model downloads.
Ollama running on a reachable host if Ollama is enabled.
An API key only if a paid or metered remote API is enabled.
Provider configuration
Local Brain
The Local Brain should provide basic deterministic responses and app commands without requiring an API key or network connection. It is a fallback, not a replacement for a full language model.
Ollama
Install and run Ollama on a computer or server reachable by the phone.
Download a model supported by that Ollama installation.
Configure the server endpoint and model name in the app.
Ensure the phone can reach the server over the network.
localhost on an Android phone refers to the phone itself. If Ollama runs on another device, configure that device's reachable LAN address or secure server URL instead.
OpenAI-compatible API
Configure the provider's base URL and model name.
Add the API key through the app's settings.
Check the provider's pricing, quota, and usage limits before enabling it.
Remote API use may incur charges. A ChatGPT subscription does not automatically include API credits.
Fallback behavior
A recommended provider order is:
Preferred remote provider (if enabled).
Secondary provider (if enabled).
Local Brain.
Fallback should occur for connection failures, timeouts, rate limits, and provider errors. The app should show which provider produced each answer and explain when it has switched to a fallback.
Privacy and security
Do not commit API keys, passwords, access tokens, or private endpoints.
Keep secrets out of source control and avoid logging them.
Prefer Android Keystore-backed secure storage for credentials.
Request microphone permission only when voice input is used.
Explain what conversation data is stored and provide a way to clear it.
Use HTTPS for remote connections.
Do not expose an Ollama or other model server directly to the public internet without appropriate authentication and network protection.
Build and run
Build instructions will be added after the Android Gradle project is committed. There is currently no verified Gradle wrapper or Android application module in the starter commit, so an APK cannot be built from this repository state yet.
When the Android project is added, the intended build command will be similar to:
./gradlew assembleDebug
The generated debug APK is normally placed under the app module's build/outputs/apk/debug/ directory. The exact path depends on the final module configuration.
Testing checklist
[ ]
App installs and launches on a real Android device.
[ ]
Microphone permission is requested at the right time.
[ ]
Bangla speech is transcribed correctly on supported devices.
[ ]
Bangla text-to-speech works on the selected Android TTS engine.
[ ]
Local Brain works with internet disabled.
[ ]
Ollama connection and model errors are handled.
[ ]
API key is stored securely and never printed in logs.
[ ]
OpenAI-compatible provider handles quota and rate-limit errors.
[ ]
Automatic fallback works and reports the active provider.
[ ]
Conversation history can be cleared.
Contributing
Create or pick an issue describing the change.
Keep provider credentials and personal data out of commits.
Add tests for routing, fallback, and error handling.
Update this README when setup steps or supported features change.
Submit a pull request with a clear summary and test results.
License
No license has been declared yet. Until a license is added to the repository, do not assume that the source code is available for unrestricted reuse or redistribution.