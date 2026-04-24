import express from "express";

const app = express();
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 10000;
const MAX_BOT_TOKEN = process.env.MAX_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.4";
const OPENAI_API_BASE = process.env.OPENAI_API_BASE || "https://api.openai.com/v1";
const MAX_API_BASE = process.env.MAX_API_BASE || "https://platform-api.max.ru";
const MAX_WEBHOOK_SECRET = process.env.MAX_WEBHOOK_SECRET || "";

if (!MAX_BOT_TOKEN) console.warn("MAX_BOT_TOKEN is not set");
if (!OPENAI_API_KEY) console.warn("OPENAI_API_KEY is not set");

function getIncomingText(update) {
  return update?.message?.body?.text?.trim() || update?.payload?.trim() || "";
}

function getReplyTarget(update) {
  const message = update?.message;
  const recipient = message?.recipient;

  if (recipient?.chat_id) return { type: "chat_id", id: recipient.chat_id };
  if (message?.sender?.user_id) return { type: "user_id", id: message.sender.user_id };
  if (update?.chat_id) return { type: "chat_id", id: update.chat_id };
  if (update?.user?.user_id) return { type: "user_id", id: update.user.user_id };

  return null;
}

function splitForMax(text, maxLength = 3900) {
  const clean = String(text || "").trim();
  if (!clean) return ["Не получилось сформировать ответ."];

  const chunks = [];
  for (let i = 0; i < clean.length; i += maxLength) {
    chunks.push(clean.slice(i, i + maxLength));
  }
  return chunks;
}

async function maxRequest(path, options = {}) {
  const url = new URL(`${MAX_API_BASE}${path}`);
  
  // Убираем параметр access_token, так как его больше не следует использовать.
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${MAX_BOT_TOKEN}`  // Передаем токен через Authorization
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const bodyText = await response.text();
  let body;
  try {
    body = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    body = bodyText;
  }

  if (!response.ok) {
    const details = typeof body === "string" ? body : JSON.stringify(body);
    throw new Error(`MAX API ${response.status}: ${details}`);
  }

  return body;
}

async function sendMaxMessage(target, text) {
  const chunks = splitForMax(text);
  for (const chunk of chunks) {
    await maxRequest("/messages", {
      method: "POST",
      query: { [target.type]: target.id },
      body: {
        text: chunk,
        notify: true
      }
    });
  }
}

function extractOpenAIText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const parts = [];
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === "string") parts.push(content.text);
      if (typeof content?.output_text === "string") parts.push(content.output_text);
    }
  }

  return parts.join("\n").trim();
}

// Функция для создания изображений через OpenAI
async function createImageOpenAI(prompt) {
  const response = await fetch(`${OPENAI_API_BASE}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      prompt: prompt,
      n: 1, // Количество изображений
      size: "1024x1024" // Размер изображения
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`OpenAI Image API ${response.status}: ${JSON.stringify(data)}`);
  }

  return data.data[0].url; // Возвращаем URL изображения
}

async function askOpenAI(userText) {
  // Если запрос пользователя связан с созданием изображения, используем OpenAI для этого
  if (userText.toLowerCase().includes("создать изображение") || userText.toLowerCase().includes("сгенерировать фото")) {
    const prompt = userText.replace(/создать изображение|сгенерировать фото/i, "").trim();
    const imageUrl = await createImageOpenAI(prompt);
    return `Вот изображение, которое я создал по вашему запросу: ${imageUrl}`;
  }

  // Обычный текстовый запрос
  const response = await fetch(`${OPENAI_API_BASE}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        {
          role: "system",
          content:
            "Ты полезный ассистент внутри мессенджера MAX. Отвечай кратко, ясно и по делу. Если вопрос требует пошагового ответа, структурируй ответ простыми абзацами."
        },
        {
          role: "user",
          content: userText
        }
      ]
    })
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(`OpenAI API ${response.status}: ${JSON.stringify(data)}`);
  }

  return extractOpenAIText(data) || "Я получил сообщение, но не смог сформировать ответ.";
}

async function handleUpdate(update) {
  const updateType = update?.update_type;
  const target = getReplyTarget(update);

  if (!target) {
    console.log("No reply target in update:", JSON.stringify(update));
    return;
  }

  if (updateType === "bot_started") {
    await sendMaxMessage(target, "Напишите вопрос, и я отвечу через ChatGPT. Или ваш промт с фото");
    return;
  }

  if (updateType !== "message_created") return;

  const userText = getIncomingText(update);
  if (!userText) {
    await sendMaxMessage(target, "Я пока умею отвечать только на текстовые сообщения.");
    return;
  }

  if (userText === "/start") {
    await sendMaxMessage(target, "Бот работает. Напишите любой вопрос.");
    return;
  }

  const answer = await askOpenAI(userText);
  await sendMaxMessage(target, answer);
}

app.get("/", (req, res) => {
  res.status(200).json({
    ok: true,
    service: "MAX OpenAI bot",
    webhook: "/webhook"
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({ ok: true });
});

app.post("/webhook", (req, res) => {
  if (MAX_WEBHOOK_SECRET) {
    const receivedSecret = req.get("X-Max-Bot-Api-Secret") || "";
    if (receivedSecret !== MAX_WEBHOOK_SECRET) {
      res.status(401).json({ ok: false, error: "Invalid webhook secret" });
      return;
    }
  }

  res.status(200).json({ ok: true });

  const payload = req.body;
  const updates = Array.isArray(payload?.updates) ? payload.updates : [payload];

  for (const update of updates) {
    handleUpdate(update).catch((error) => {
      console.error("Update handling failed:", error);
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`MAX OpenAI bot is running on port ${PORT}`);
});
