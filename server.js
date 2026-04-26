import express from "express";


const app = express();
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 10000;
const MAX_BOT_TOKEN = process.env.MAX_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const IMAGE_REQUEST_LIMIT = 8; 
const CHATGPT_REQUEST_LIMIT = 15; 

const userRequestCounts = {};

const FLOOD_WINDOW_MS = Number(process.env.FLOOD_WINDOW_MS || 10_000);
const FLOOD_MAX_MESSAGES = Number(process.env.FLOOD_MAX_MESSAGES || 5);
const FLOOD_BLOCK_MS = Number(process.env.FLOOD_BLOCK_MS || 20_000);
const FLOOD_WARNING_COOLDOWN_MS = Number(process.env.FLOOD_WARNING_COOLDOWN_MS || 12_000);

const SAME_MESSAGE_WINDOW_MS = Number(process.env.SAME_MESSAGE_WINDOW_MS || 20_000);
const SAME_MESSAGE_MAX = Number(process.env.SAME_MESSAGE_MAX || 3);

const USER_BUSY_TTL_MS = Number(process.env.USER_BUSY_TTL_MS || 5 * 60_000);
const USER_BUSY_WARNING_COOLDOWN_MS = Number(process.env.USER_BUSY_WARNING_COOLDOWN_MS || 10_000);

const userFloodStates = new Map();
const userBusyUntil = new Map();
const userBusyWarningAt = new Map();

function getStableUserId(update, target) {
  return (
    update?.message?.sender?.user_id ||
    update?.user?.user_id ||
    target?.id ||
    "unknown"
  );
}

function normalizeFloodText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function checkAntiFlood(userId, textForCheck = "") {
  const now = Date.now();

  let state = userFloodStates.get(userId);

  if (!state) {
    state = {
      windowStart: now,
      count: 0,
      blockedUntil: 0,
      lastWarningAt: 0,
      lastText: "",
      lastTextAt: 0,
      sameTextCount: 0
    };

    userFloodStates.set(userId, state);
  }

  if (state.blockedUntil > now) {
    const canWarn = now - state.lastWarningAt >= FLOOD_WARNING_COOLDOWN_MS;

    if (canWarn) {
      state.lastWarningAt = now;
    }

    return {
      blocked: true,
      reason: "blocked",
      retryAfterMs: state.blockedUntil - now,
      shouldWarn: canWarn
    };
  }

  if (now - state.windowStart > FLOOD_WINDOW_MS) {
    state.windowStart = now;
    state.count = 0;
  }

  state.count += 1;

  const normalizedText = normalizeFloodText(textForCheck);

  if (
    normalizedText &&
    normalizedText === state.lastText &&
    now - state.lastTextAt <= SAME_MESSAGE_WINDOW_MS
  ) {
    state.sameTextCount += 1;
  } else {
    state.lastText = normalizedText;
    state.lastTextAt = now;
    state.sameTextCount = normalizedText ? 1 : 0;
  }

  const tooManyMessages = state.count > FLOOD_MAX_MESSAGES;
  const tooManySameMessages = state.sameTextCount > SAME_MESSAGE_MAX;

  if (tooManyMessages || tooManySameMessages) {
    state.blockedUntil = now + FLOOD_BLOCK_MS;
    state.windowStart = now;
    state.count = 0;

    const canWarn = now - state.lastWarningAt >= FLOOD_WARNING_COOLDOWN_MS;

    if (canWarn) {
      state.lastWarningAt = now;
    }

    return {
      blocked: true,
      reason: tooManySameMessages ? "same_message" : "too_many_messages",
      retryAfterMs: FLOOD_BLOCK_MS,
      shouldWarn: canWarn
    };
  }

  return {
    blocked: false
  };
}

async function sendFloodWarningIfNeeded(target, userId, floodResult) {
  if (!floodResult?.shouldWarn) return;

  const seconds = Math.ceil((floodResult.retryAfterMs || FLOOD_BLOCK_MS) / 1000);

  console.warn(`Flood detected: user ${userId}, reason: ${floodResult.reason}`);

  await sendMaxMessage(
    target,
    `📛 **Вы отправляете сообщения слишком часто.** Подождите примерно ${seconds} сек.`
  ).catch((error) => {
    console.error("Failed to send flood warning:", error);
  });
}

function isUserBusy(userId) {
  const now = Date.now();
  const busyUntil = userBusyUntil.get(userId) || 0;

  if (busyUntil <= now) {
    userBusyUntil.delete(userId);
    return false;
  }

  return true;
}

function lockUserProcessing(userId) {
  userBusyUntil.set(userId, Date.now() + USER_BUSY_TTL_MS);
}

function unlockUserProcessing(userId) {
  userBusyUntil.delete(userId);
}

async function sendBusyWarningIfNeeded(target, userId) {
  const now = Date.now();
  const lastWarningAt = userBusyWarningAt.get(userId) || 0;

  if (now - lastWarningAt < USER_BUSY_WARNING_COOLDOWN_MS) return;

  userBusyWarningAt.set(userId, now);

  await sendMaxMessage(
    target,
    "⏳ Предыдущий запрос ещё обрабатывается. Пожалуйста, дождитесь ответа."
  ).catch((error) => {
    console.error("Failed to send busy warning:", error);
  });
}

setInterval(() => {
  const now = Date.now();

  for (const [userId, state] of userFloodStates.entries()) {
    const inactiveTooLong =
      now - state.windowStart > 60 * 60_000 &&
      state.blockedUntil <= now;

    if (inactiveTooLong) {
      userFloodStates.delete(userId);
    }
  }

  for (const [userId, busyUntil] of userBusyUntil.entries()) {
    if (busyUntil <= now) {
      userBusyUntil.delete(userId);
    }
  }

  for (const [userId, lastWarningAt] of userBusyWarningAt.entries()) {
    if (now - lastWarningAt > 60 * 60_000) {
      userBusyWarningAt.delete(userId);
    }
  }
}, 10 * 60_000).unref?.();


const CONTEXT_MAX_REQUESTS = Number(process.env.CONTEXT_MAX_REQUESTS || 3);
const CONTEXT_MAX_TEXT_CHARS = Number(process.env.CONTEXT_MAX_TEXT_CHARS || 3000);
const CONTEXT_TTL_MS = Number(process.env.CONTEXT_TTL_MS || 30 * 60_000);

const userChatContexts = new Map();

function clipForContext(text) {
  return String(text || "").slice(0, CONTEXT_MAX_TEXT_CHARS);
}

function getChatContext(userId) {
  const key = String(userId || "unknown");
  const context = userChatContexts.get(key);

  if (!context) return [];

  const now = Date.now();

  if (now - context.updatedAt > CONTEXT_TTL_MS) {
    userChatContexts.delete(key);
    return [];
  }

  return context.messages || [];
}

function rememberChatTurn(userId, userText, assistantText) {
  const key = String(userId || "unknown");

  let context = userChatContexts.get(key);

  if (!context) {
    context = {
      requestCount: 0,
      messages: [],
      updatedAt: Date.now()
    };
  }

  context.requestCount += 1;
  context.updatedAt = Date.now();

  context.messages.push({
    role: "user",
    content: clipForContext(userText)
  });

  context.messages.push({
    role: "assistant",
    content: clipForContext(assistantText)
  });

  // После 3 запросов контекст полностью забывается
  if (context.requestCount >= CONTEXT_MAX_REQUESTS) {
    userChatContexts.delete(key);
    return;
  }

  userChatContexts.set(key, context);
}

function clearChatContext(userId) {
  const key = String(userId || "unknown");
  userChatContexts.delete(key);
}

setInterval(() => {
  const now = Date.now();

  for (const [userId, context] of userChatContexts.entries()) {
    if (now - context.updatedAt > CONTEXT_TTL_MS) {
      userChatContexts.delete(userId);
    }
  }
}, 10 * 60_000).unref?.();

function getUserRequestKey(userId) {
  return userId; // Можно использовать любой идентификатор пользователя (например, userId или chatId)
}

function incrementRequestCount(userId, type) {
  const key = getUserRequestKey(userId);
  if (!userRequestCounts[key]) userRequestCounts[key] = { images: 0, chatgpt: 0 };

  userRequestCounts[key][type] += 1;
}

function isRequestLimitReached(userId, type, limit) {
  const key = getUserRequestKey(userId);
  return userRequestCounts[key]?.[type] >= limit;
}

function resetDailyLimits() {
  // Сбрасываем лимиты ежедневно, можно настроить с помощью cron-job на сброс в полночь
  setInterval(() => {
    Object.keys(userRequestCounts).forEach((key) => {
      userRequestCounts[key] = { images: 0, chatgpt: 0 };
    });
  }, 86400000); // Сбрасываем каждый день (86400000 мс)
}

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
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
      notify,
      format: "Markdown" // Указание формата для Markdown
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

async function askOpenAI(userId, userText) {
  const history = getChatContext(userId);

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
        ...history,
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

  const answer =
    extractOpenAIText(data) ||
    "Я получил сообщение, но не смог сформировать ответ.";

  rememberChatTurn(userId, userText, answer);

  return answer;
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

async function handleImageRequest(update, target, userText, incomingImageUrl, userId = target.id) {
  const prompt = String(userText || "").trim();

  if (!prompt) {
    await sendMaxMessage(
      target,
      "Пришлите описание изображения. Например: создай фото кота в космосе, кинематографичный стиль."
    );
    return;
  }

  if (isRequestLimitReached(userId, "images", IMAGE_REQUEST_LIMIT)) {
    await sendMaxMessage(
      target,
      "🥱Вы достигли лимита на создание **Шедевров** сегодня, приходите позже и продолжайте"
    );
    return;
  }

  incrementRequestCount(userId, "images");

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
  let processingLocked = false;

  if (!target) {
    console.log("No reply target in update:", JSON.stringify(update));
    return;
  }

  const userId = getStableUserId(update, target);

  try {
    if (updateType === "bot_started") {
      await sendMaxMessage(
        target,
        "**Здравствуйте**. Напишите вопрос или попросите **создать фото/картинку**. Например: создай фото кота в космосе."
      );
      return;
    }

    if (updateType !== "message_created") return;

    const userText = getIncomingText(update);
    const incomingImageUrl = extractIncomingImageUrl(update);

    const floodCheckText = `${userText || ""} ${incomingImageUrl ? "[image]" : ""}`;

    const floodResult = checkAntiFlood(userId, floodCheckText);

    if (floodResult.blocked) {
      await sendFloodWarningIfNeeded(target, userId, floodResult);
      return;
    }

    if (userText === "/start") {
      await sendMaxMessage(
        target,
        "🦄**Бот работает**. Напишите вопрос или попросите создать фото/картинку."
      );
      return;
    }

    if (["/reset", "/new", "/clear", "/сброс"].includes(userText.toLowerCase())) {
      clearChatContext(userId);

      await sendMaxMessage(
        target,
        "🧹 Контекст диалога очищен. Можем начать заново."
      );

      return;
    }
    

    if (userText.toLowerCase().includes("spam")) {
      await sendMaxMessage(
        target,
        "**Это уже не смешно🥺. Стоп спам, пожалуйста😢**."
      );
      return;
    }

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

    if (isUserBusy(userId)) {
      await sendBusyWarningIfNeeded(target, userId);
      return;
    }

    lockUserProcessing(userId);
    processingLocked = true;

    if (isImageRequest(userText, Boolean(incomingImageUrl))) {
      status = await startDynamicStatus(target, "👽Шедевр создается");

      await handleImageRequest(update, target, userText, incomingImageUrl, userId);

      await status.stop();
      status = null;
      return;
    }

    if (isRequestLimitReached(userId, "chatgpt", CHATGPT_REQUEST_LIMIT)) {
      await sendMaxMessage(
        target,
        "Кажется вам надо немного отдохнуть от ИИ🏝️, **приходите чуть позже и продолжайте**🦦"
      );
      return;
    }

    incrementRequestCount(userId, "chatgpt");

    status = await startDynamicStatus(target, "💬ИИ думает");

    const answer = await askOpenAI(userId, userText);

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
  } finally {
    if (processingLocked) {
      unlockUserProcessing(userId);
    }
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
  res.status(200).type("text/plain").send("ok");
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

resetDailyLimits();

app.listen(PORT, "0.0.0.0", () => {
  console.log(`MAX OpenAI bot is running on port ${PORT}`);
});
