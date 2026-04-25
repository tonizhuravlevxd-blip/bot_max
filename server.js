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
const STATUS_UPDATE_INTERVAL_MS = Number(process.env.STATUS_UPDATE_INTERVAL_MS || 850);

if (!MAX_BOT_TOKEN) console.warn("MAX_BOT_TOKEN is not set");
if (!OPENAI_API_KEY) console.warn("OPENAI_API_KEY is not set");

const IMAGE_COMMAND_RE =
  /^\s*\/(?:img|image|photo|фото|картинка|изображение)(?=$|[\s:—-])/iu;

const IMAGE_VERB_RE =
  /(?:^|[^\p{L}\p{N}_])(?:Нарисуй|нарисовать|сгенерируй|сгенерировать|создай|создать|сделай|сделать|генерируй|generate|make|create)(?=$|[^\p{L}\p{N}_])/iu;

const IMAGE_OBJECT_RE =
  /(?:^|[^\p{L}\p{N}_])(?:фото|фотографи[яюе]|фотку|картинк[ауие]|изображени[еяю]|рисунок|арт|логотип|аватар|постер|баннер|image|photo|picture|drawing|art|logo|avatar|poster|banner)(?=$|[^\p{L}\p{N}_])/iu;

const STATUS_DOT_FRAMES = [".", "..", "..."];

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

function isImageRequest(userText, hasIncomingImage) {
  if (hasIncomingImage) return true;

  const text = String(userText || "").trim();
  if (!text) return false;

  if (IMAGE_COMMAND_RE.test(text)) return true;

  return IMAGE_VERB_RE.test(text) && IMAGE_OBJECT_RE.test(text);
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

async function sendMaxSingleMessage(target, text, notify = true) {
  return maxRequest("/messages", {
    method: "POST",
    query: { [target.type]: target.id },
    body: {
      text,
      notify
    }
  });
}

async function sendMaxMessage(target, text) {
  const chunks = splitForMax(text);
  const results = [];

  for (const chunk of chunks) {
    const result = await sendMaxSingleMessage(target, chunk, true);
    results.push(result);
  }

  return results;
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

function extractMaxMessageId(result) {
  const candidates = [
    result?.message?.body?.mid,
    result?.message?.body?.message_id,
    result?.message?.mid,
    result?.message?.id,
    result?.body?.mid,
    result?.body?.message_id,
    result?.mid,
    result?.message_id,
    result?.id
  ];

  const found = candidates.find((value) => value !== undefined && value !== null && String(value).trim());
  return found ? String(found) : "";
}

async function editMaxMessage(messageId, text) {
  if (!messageId) return null;

  return maxRequest("/messages", {
    method: "PUT",
    query: { message_id: messageId },
    body: {
      text,
      notify: false
    }
  });
}

async function deleteMaxMessage(messageId) {
  if (!messageId) return;

  try {
    await maxRequest("/messages", {
      method: "DELETE",
      query: { message_id: messageId }
    });
    return;
  } catch (error) {
    console.warn("MAX message delete failed, fallback to clearing status:", error?.message || error);
  }

  try {
    await editMaxMessage(messageId, "⠀");
  } catch (error) {
    console.warn("MAX status clear fallback failed:", error?.message || error);
  }
}

async function startDynamicStatus(target, baseText) {
  let frameIndex = 0;
  let stopped = false;
  let editInProgress = false;

  const sent = await sendMaxSingleMessage(target, `${baseText}${STATUS_DOT_FRAMES[frameIndex]}`, false).catch(
    (error) => {
      console.warn("Failed to send dynamic status:", error?.message || error);
      return null;
    }
  );

  const messageId = extractMaxMessageId(sent);

  if (!messageId) {
    return {
      stop: async () => {}
    };
  }

  const timer = setInterval(async () => {
    if (stopped || editInProgress) return;

    editInProgress = true;
    frameIndex = (frameIndex + 1) % STATUS_DOT_FRAMES.length;

    try {
      await editMaxMessage(messageId, `${baseText}${STATUS_DOT_FRAMES[frameIndex]}`);
    } catch (error) {
      console.warn("Failed to edit dynamic status:", error?.message || error);
    } finally {
      editInProgress = false;
    }
  }, STATUS_UPDATE_INTERVAL_MS);

  return {
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await deleteMaxMessage(messageId);
    }
  };
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

function guessMimeFromUrl(url) {
  const cleanUrl = url.split("?")[0].split("#")[0].toLowerCase();

  if (cleanUrl.endsWith(".jpg") || cleanUrl.endsWith(".jpeg")) return "image/jpeg";
  if (cleanUrl.endsWith(".webp")) return "image/webp";
  if (cleanUrl.endsWith(".gif")) return "image/gif";
  if (cleanUrl.endsWith(".bmp")) return "image/bmp";
  if (cleanUrl.endsWith(".tif") || cleanUrl.endsWith(".tiff")) return "image/tiff";
  if (cleanUrl.endsWith(".heic")) return "image/heic";

  return "image/png";
}

function extensionFromMime(mime) {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  if (mime === "image/bmp") return "bmp";
  if (mime === "image/tiff") return "tiff";
  if (mime === "image/heic") return "heic";

  return "png";
}

async function fetchImageBuffer(url, withAuth = false) {
  const headers = withAuth && MAX_BOT_TOKEN ? { Authorization: MAX_BOT_TOKEN } : undefined;

  const response = await fetch(url, {
    method: "GET",
    headers
  });

  if (!response.ok) {
    throw new Error(`Image download ${response.status}: ${await response.text().catch(() => "")}`);
  }

  const contentLength = Number(response.headers.get("content-length") || 0);

  if (contentLength > MAX_INPUT_IMAGE_BYTES) {
    throw new Error(`Image is too large: ${contentLength} bytes`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.length > MAX_INPUT_IMAGE_BYTES) {
    throw new Error(`Image is too large: ${buffer.length} bytes`);
  }

  const mime = (response.headers.get("content-type") || guessMimeFromUrl(url))
    .split(";")[0]
    .trim();

  if (!mime.startsWith("image/")) {
    throw new Error(`Downloaded file is not an image: ${mime}`);
  }

  return {
    buffer,
    mime,
    filename: `input.${extensionFromMime(mime)}`
  };
}

async function downloadIncomingImage(url) {
  try {
    return await fetchImageBuffer(url, false);
  } catch (error) {
    if (!/\b(401|403)\b/.test(String(error?.message || ""))) throw error;
    return fetchImageBuffer(url, true);
  }
}

function cleanImagePrompt(text) {
  let prompt = String(text || "").trim();

  prompt = prompt
    .replace(
      /^\s*\/(?:img|image|photo|фото|картинка|изображение)(?=$|[\s:—-])\s*[:\-—]?\s*/iu,
      ""
    )
    .replace(
      /^\s*(?:сгенерируй|сгенерировать|создай|создать|сделай|сделать|генерируй)\s+(?:мне\s+)?/iu,
      ""
    )
    .replace(
      /^\s*(?:нарисуй|нарисовать)\s+(?:мне\s+)?/iu,
      ""
    )
    .replace(
      /^\s*(?:generate|make|create)\s+(?:me\s+)?(?:an?\s+)?/iu,
      ""
    )
    .replace(
      /^\s*(?:фото|фотографию|фотку|картинку|изображение|рисунок|арт)(?:\s*\/\s*(?:фото|фотографию|фотку|картинку|изображение|рисунок|арт))*\s*(?:с|из|of)?\s*[:\-—]?\s*/iu,
      ""
    )
    .replace(
      /^\s*(?:image|photo|picture|drawing|art)(?:\s*\/\s*(?:image|photo|picture|drawing|art))*\s*(?:of)?\s*[:\-—]?\s*/iu,
      ""
    )
    .replace(/^\/+\s*/, "")
    .trim();

  return prompt;
}

async function uploadImageToMax(imageBuffer) {
  const uploadInfo = await maxRequest("/uploads", {
    method: "POST",
    query: { type: "image" }
  });

  const uploadUrl = uploadInfo?.url || uploadInfo?.upload_url;

  if (!uploadUrl) {
    throw new Error(`MAX upload URL is missing: ${JSON.stringify(uploadInfo)}`);
  }

  const form = new FormData();

  form.append(
    "data",
    new Blob([imageBuffer], { type: `image/${OPENAI_IMAGE_OUTPUT_FORMAT}` }),
    `openai-image.${OPENAI_IMAGE_OUTPUT_FORMAT}`
  );

  const response = await fetch(uploadUrl, {
    method: "POST",
    body: form
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
    throw new Error(`MAX upload ${response.status}: ${details}`);
  }

  if (body?.payload && typeof body.payload === "object") return body.payload;
  if (body?.retval && typeof body.retval === "object") return body.retval;
  if (body?.token) return { token: body.token };
  if (typeof body === "object" && body) return body;

  throw new Error(`MAX upload returned unexpected body: ${JSON.stringify(body)}`);
}

async function sendMaxImage(target, text, imageBuffer) {
  const payload = await uploadImageToMax(imageBuffer);
  const attachments = [{ type: "image", payload }];

  let lastError;

  for (let attempt = 0; attempt < MAX_ATTACHMENT_RETRIES; attempt += 1) {
    try {
      await sendMaxMessageWithAttachments(target, text, attachments);
      return;
    } catch (error) {
      lastError = error;

      const message = String(error?.message || "");

      if (!/attachment\.not\.ready|not\.processed|not ready/i.test(message)) {
        throw error;
      }

      await sleep(700 * (attempt + 1));
    }
  }

  throw lastError;
}

function makeImageCaption(prompt, edited) {
  const safePrompt = String(prompt || "").slice(0, 1000);

  return edited
    ? `Готово. Отредактировал фото по запросу:\n${safePrompt}`
    : `Готово. Промт:\n${safePrompt}`;
}

function safeUserError(error) {
  const message = String(error?.message || error || "Unknown error");

  if (/content_policy|safety|moderation/i.test(message)) {
    return "Не получилось создать изображение: запрос не прошёл проверку безопасности.";
  }

  if (/OpenAI/i.test(message)) {
    return "Не получилось получить ответ от OpenAI. Проверьте модель, ключ API и лимиты аккаунта.";
  }

  if (/MAX/i.test(message)) {
    return "Не получилось отправить ответ в MAX. Проверьте токен, webhook и права бота.";
  }

  return "Произошла ошибка при обработке запроса.";
}

async function handleImageRequest(update, target, userText, incomingImageUrl) {
  const prompt = cleanImagePrompt(userText) || userText.trim();

  if (!prompt) {
    await sendMaxMessage(
      target,
      "Пришлите описание изображения. Например: создай фото кота в космосе, кинематографичный стиль."
    );
    return;
  }

  const inputImage = incomingImageUrl ? await downloadIncomingImage(incomingImageUrl) : null;

  const imageBuffer = inputImage
    ? await editOpenAIImage(prompt, inputImage)
    : await generateOpenAIImage(prompt);

  await sendMaxImage(target, makeImageCaption(prompt, Boolean(inputImage)), imageBuffer);
}

async function handleUpdate(update) {
  const updateType = update?.update_type;
  const target = getReplyTarget(update);
  let status = null;

  if (!target) {
    console.log("No reply target in update:", JSON.stringify(update));
    return;
  }

  // Handling the bot started event
  if (updateType === "bot_started") {
    await sendMaxMessage(
      target,
      "👋 <b>Здравствуйте</b>. Напишите вопрос или попросите создать фото/картинку. Например: создай фото кота в космосе."
    );
    return; // This return is now inside the function, so it's valid
  }

  if (updateType !== "message_created") return; // Ensuring the return is inside the function
}

    if (updateType !== "message_created") return;

    const userText = getIncomingText(update);
    const incomingImageUrl = extractIncomingImageUrl(update);

    if (!userText && incomingImageUrl) {
      await sendMaxMessage(
        target,
        "Фото получил. Теперь отправьте его вместе с текстом, что нужно изменить или создать на его основе."
      );
      return;
    }

    if (!userText) {
      await sendMaxMessage(
        target,
        "Я пока умею отвечать на текст, а также создавать изображения по запросам вроде: создай фото кота в космосе."
      );
      return;
    }

    if (userText === "/start") {
      await sendMaxMessage(
        target,
        "🦄Бот работает. Напишите вопрос или попросите создать фото/картинку."
      );
      return;
    }

    if (isImageRequest(userText, Boolean(incomingImageUrl))) {
      status = await startDynamicStatus(target, "Шедевр создается");
      await handleImageRequest(update, target, userText, incomingImageUrl);
      await status.stop();
      status = null;
      return;
    }

    status = await startDynamicStatus(target, "ИИ думает");
    const answer = await askOpenAI(userText);
    await status.stop();
    status = null;

    await sendMaxMessage(target, answer);
  } catch (error) {
    console.error("Update handling failed:", error);

    if (status) {
      await status.stop().catch((statusError) => {
        console.error("Failed to remove dynamic status:", statusError);
      });
    }

    await sendMaxMessage(target, safeUserError(error)).catch((sendError) => {
      console.error("Failed to send error message to MAX:", sendError);
    });
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
