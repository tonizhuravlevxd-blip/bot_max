# MAX + OpenAI bot for Render

This project runs a MAX Messenger webhook bot on Render and sends user text to the OpenAI Responses API.

## Files

- `server.js` — Express webhook server.
- `package.json` — Node dependencies and start command.
- `render.yaml` — optional Render Blueprint.
- `.env.example` — environment variable template.

## Required environment variables

```env
MAX_BOT_TOKEN=your_max_bot_token_here
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-5.4
OPENAI_API_BASE=https://api.openai.com/v1
MAX_WEBHOOK_SECRET=make-a-long-random-secret
MAX_API_BASE=https://platform-api.max.ru
```

Do not commit real tokens to GitHub.

## Local run

```bash
npm install
cp .env.example .env
npm run dev
```

For local webhook testing you need an HTTPS tunnel such as ngrok or Cloudflare Tunnel.

## Render setup

1. Push the project to GitHub.
2. Render Dashboard → New → Web Service.
3. Connect the repository.
4. Build command: `npm install`.
5. Start command: `npm start`.
6. Add environment variables from `.env.example` in Render Environment tab.
7. Deploy.
8. Your webhook URL will look like:

```text
https://YOUR-SERVICE.onrender.com/webhook
```

## Register MAX webhook

Replace values and run:

```bash
curl -X POST "https://platform-api.max.ru/subscriptions?access_token=$MAX_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://YOUR-SERVICE.onrender.com/webhook",
    "update_types": ["message_created", "bot_started"],
    "secret": "YOUR_MAX_WEBHOOK_SECRET"
  }'
```

## Check subscriptions

```bash
curl "https://platform-api.max.ru/subscriptions?access_token=$MAX_BOT_TOKEN"
```

## Remove webhook

```bash
curl -X DELETE "https://platform-api.max.ru/subscriptions?access_token=$MAX_BOT_TOKEN&url=https%3A%2F%2FYOUR-SERVICE.onrender.com%2Fwebhook"
```
