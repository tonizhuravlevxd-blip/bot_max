import express from "express";

const app = express();
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 10000;
const MAX_BOT_TOKEN = process.env.MAX_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.4";
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
const OPENAI_IMAGE_SIZE = process.env.OPENAI_IMAGE_SIZE || "1024x1024";
const OPENAI_IMAGE_QUALITY = process.env.OPENAI_IMAGE_QUALITY || "medium";
const OPENAI_IMAGE_OUTPUT_FORMAT = process.env.OPENAI_IMAGE_OUTPUT_FORMAT || "png";

const OPENAI_API_BASE = process.env.OPENAI_API_BASE || "https://api.openai.com/v1";
const MAX_API_BASE = process.env.MAX_API_BASE || "https://platform-api.max.ru";
const MAX_WEBHOOK_SECRET = process.env.MAX_WEBHOOK_SECRET || "";
const MAX_ATTACHMENT_RETRIES = Number(process.env.MAX_ATTACHMENT_RETRIES || 5);
const MAX_INPUT_IMAGE_BYTES = Number(process.env.MAX_INPUT_IMAGE_BYTES || 20 * 1024 * 1024);

if (!MAX_BOT_TOKEN) console.warn("MAX_BOT_TOKEN is not set");
if (!OPENAI_API_KEY) console.warn("OPENAI_API_KEY is not set");

const IMAGE_REQUEST_RE =
  /^\s*(сгенерируй\s+(?:фото|картинку|изображение|рисунок|арт)|создай\s+(?:фото|картинку|изображение|рисунок|арт)|сделай\s+(?:фото|картинку|изображение|рисунок|арт)|generate\s+(?:an?\s+)?image|make\s+(?:an?\s+)?image)/i;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const headers = {
    Authorization: MAX_BOT_TOKEN
  };

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
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

async function sendMaxMessageWithAttachments(target, text, attachments) {
  return maxRequest("/messages", {
    method: "POST",
    query: { [target.type]: target.id },
    body: {
      text: text || null,
      attachments,
      notify: true
    }
  });
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

async function askOpenAI(userText) {
  const response = await fetch(`${OPENAI_API_BASE}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`
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

function extractImageBase64(data) {
  const fromImagesApi = data?.data?.[0]?.b64_json;
  if (typeof fromImagesApi === "string" && fromImagesApi.trim()) {
    return fromImagesApi.trim();
  }

  const fromResponsesApi = [];

  for (const item of data?.output || []) {
    if (item?.type === "image_generation_call" && typeof item?.result === "string") {
      fromResponsesApi.push(item.result);
    }
  }

  return fromResponsesApi[0] || "";
}

function buildImageJsonBody(prompt) {
  const body = {
    model: OPENAI_IMAGE_MODEL,
    prompt,
    n: 1,
    size: OPENAI_IMAGE_SIZE,
    quality: OPENAI_IMAGE_QUALITY,
    output_format: OPENAI_IMAGE_OUTPUT_FORMAT
  };

  if (OPENAI_IMAGE_MODEL.startsWith("dall-e")) {
    body.response_format = "b64_json";
  }

  return body;
}

async function generateOpenAIImage(prompt) {
  const response = await fetch(`${OPENAI_API_BASE}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify(buildImageJsonBody(prompt))
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(`OpenAI image API ${response.status}: ${JSON.stringify(data)}`);
  }

  const imageBase64 = extractImageBase64(data);
  if (!imageBase64) {
    throw new Error("OpenAI image API did not return b64_json");
  }

  return Buffer.from(imageBase64, "base64");
}

async function editOpenAIImage(prompt, inputImage) {
  const form = new FormData();

  form.append("model", OPENAI_IMAGE_MODEL);
  form.append("prompt", prompt);
  form.append("size", OPENAI_IMAGE_SIZE);
  form.append("quality", OPENAI_IMAGE_QUALITY);
  form.append("output_format", OPENAI_IMAGE_OUTPUT_FORMAT);

  if (OPENAI_IMAGE_MODEL.startsWith("dall-e")) {
    form.append("response_format", "b64_json");
  }

  form.append(
    "image",
    new Blob([inputImage.buffer], { type: inputImage.mime || "image/png" }),
    inputImage.filename || "input.png"
  );

  const response = await fetch(`${OPENAI_API_BASE}/images/edits`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: form
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(`OpenAI image edit API ${response.status}: ${JSON.stringify(data)}`);
  }

  const imageBase64 = extractImageBase64(data);
  if (!imageBase64) {
    throw new Error("OpenAI image edit API did not return b64_json");
  }

  return Buffer.from(imageBase64, "base64");
}

// Функция для извлечения URL изображения из вложений
function collectUrls(value, urls = []) {
  if (!value) return urls;

  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value)) urls.push(value);
    return urls;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, urls);
    return urls;
  }

  if (typeof value === "object") {
    for (const item of Object.values(value)) collectUrls(item, urls);
  }

  return urls;
}

function extractIncomingImageUrl(update) {
  const attachments = update?.message?.body?.attachments || [];

  for (const attachment of attachments) {
    const type = String(attachment?.type || "").toLowerCase();

    if (type && !["image", "photo", "file"].includes(type)) continue;

    const urls = collectUrls(attachment);
    const imageUrl =
      urls.find((url) => /\.(png|jpe?g|webp|gif|bmp|tiff?|heic)(\?|#|$)/i.test(url)) ||
      urls[0];

    if (imageUrl) return imageUrl;
  }

  return "";
}

async function sendThinkingMessage(target, text) {
  let dots = 0;
  const messageId = Date.now(); // Уникальный идентификатор для сообщения

  // Начинаем с пустых точек
  await sendMaxMessage(target, `${text}...`);

  while (true) {
    const message = `${text}${'.'.repeat(dots)}`;
    await sendMaxMessage(target, message); // Обновляем сообщение с точками
    dots = (dots + 1) % 4;
    await sleep(500); // Ожидание перед следующим обновлением
  }
}

async function handleImageRequest(update, target, userText, incomingImageUrl) {
  const prompt = userText.trim();

  if (!prompt) {
    await sendMaxMessage(
      target,
      "Пришлите описание изображения. Например: создать картинку кота в космосе, кинематографичный стиль."
    );
    return;
  }

  const textDuringProcessing = "Шедевр создается";
  await sendThinkingMessage(target, textDuringProcessing); // Динамическое обновление точек

  const inputImage = incomingImageUrl ? await downloadIncomingImage(incomingImageUrl) : null;

  const imageBuffer = inputImage
    ? await editOpenAIImage(prompt, inputImage)
    : await generateOpenAIImage(prompt);

  await sendMaxImage(target, `Готово: Промт - ${prompt}`, imageBuffer);
}

async function handleUpdate(update) {
  const updateType = update?.update_type;
  const target = getReplyTarget(update);

  if (!target) {
    console.log("No reply target in update:", JSON.stringify(update));
    return;
  }

  try {
    if (updateType === "bot_started") {
      await sendMaxMessage(
        target,
        "Здравствуйте. Напишите запрос, или отправьте описание для создания фото/картинки."
      );
      return;
    }

    if (updateType !== "message_created") return;

    const userText = getIncomingText(update);
    const incomingImageUrl = extractIncomingImageUrl(update);

    if (userText && IMAGE_REQUEST_RE.test(userText)) {
      await handleImageRequest(update, target, userText, incomingImageUrl);
    } else {
      const answer = await askOpenAI(userText);
      await sendMaxMessage(target, answer);
    }
  } catch (error) {
    console.error("Update handling failed:", error);
    await sendMaxMessage(target, "Произошла ошибка при обработке запроса.");
  }
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
      console.error("Unhandled update handling failure:", error);
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`MAX OpenAI bot is running on port ${PORT}`);
});
