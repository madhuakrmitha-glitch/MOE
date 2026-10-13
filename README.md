# MOE — Multi-agent chat

MOE is a browser-based group chat for running several AI agents together. Each agent can use its own model, provider, endpoint, API key, and system prompt. Set shared room instructions and choose whether agents reply once or discuss the topic over multiple rounds.

## Run it

No build step or package install is required. Serve this folder over HTTP, then open it in a browser:

```bash
python -m http.server 8000
```

Open `http://localhost:8000`.

## Providers

| Provider | Base URL example | Request format |
| --- | --- | --- |
| OpenAI-compatible API | `https://api.openai.com/v1` | `POST /chat/completions` |
| Ollama | `http://localhost:11434` | `POST /api/chat` |
| Hugging Face Inference Providers | `https://router.huggingface.co/v1` | `POST /chat/completions` |

MOE appends the route to the base URL. For an OpenAI-compatible service, include `/v1` in the base URL when the service expects it. Hugging Face uses its OpenAI-compatible Inference Providers router; set the model to the Hub model ID (and provider suffix if needed). For Ollama, make sure the Ollama server is running and configured to accept requests from the page's browser origin.

## How a room works

- **One pass:** every agent responds to the latest user message once.
- **Roundtable:** agents respond in order for 1–5 rounds. Later agents see earlier replies, and subsequent rounds can build on the discussion.
- **Shared room instructions:** included in every agent's system message.
- **Agent system prompts:** each agent keeps its own role and behavior across the conversation.
- **Rooms and settings:** saved automatically in this browser. New conversations copy the current room's agent setup.

The app supports up to eight agents per room. Responses are sent sequentially to keep the order of a roundtable clear.

## Privacy and browser access

MOE has no application server. Room history, provider settings, and API keys are saved in this browser's local storage. Requests go directly from the page to each provider. Anyone with access to this browser profile can access saved keys, so use a personal browser profile and remove credentials before sharing the device. Provider endpoints must allow browser cross-origin requests (CORS); local Ollama installations may need their allowed origins configured. Do not put private keys in a shared or public browser profile.

The app makes provider calls from the browser, so this repository is a client-side prototype rather than a multi-user hosted service. A production deployment that needs shared rooms, sign-in, or centrally managed secrets should add an authenticated backend.
