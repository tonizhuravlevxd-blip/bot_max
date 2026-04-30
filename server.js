import express from "express";
import pg from "pg";


const app = express();
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 10000;
const MAX_BOT_TOKEN = process.env.MAX_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const IMAGE_REQUEST_LIMIT = 8; 
const CHATGPT_REQUEST_LIMIT = 15;
const VIDEO_REQUEST_LIMIT = Number(process.env.VIDEO_REQUEST_LIMIT || 5);
const VIDEO_REQUESTS_BEFORE_SUBSCRIPTION = Number(
  process.env.VIDEO_REQUESTS_BEFORE_SUBSCRIPTION || 1
);

const WORKER_MAKE_VIDEO_URL = process.env.WORKER_MAKE_VIDEO_URL || "";

// После этих значений нужна подписка
const IMAGE_REQUESTS_BEFORE_SUBSCRIPTION = Number(
  process.env.IMAGE_REQUESTS_BEFORE_SUBSCRIPTION || 2
);

const CHATGPT_REQUESTS_BEFORE_SUBSCRIPTION = Number(
  process.env.CHATGPT_REQUESTS_BEFORE_SUBSCRIPTION || 4
);

// Каналы MAX, на которые нужна обязательная подписка
const REQUIRED_CHANNELS = [
  {
    id: process.env.REQUIRED_CHANNEL_ID || "-73970192098593",
    url: process.env.REQUIRED_CHANNEL_URL || "https://max.ru/id236700415542_biz",
    title: "Наш Канал"
  },
  {
    id: process.env.REQUIRED_CHANNEL_ID_2 || "-74096616285473",
    url: process.env.REQUIRED_CHANNEL_URL_2 || "https://max.ru/join/P7GhkQ-vh7uGxJE2UYOY4QoDG27pJLFh1yfA9tj-ag0",
    title: "Канал 2"
  },
  {
    id: process.env.REQUIRED_CHANNEL_ID_3 || "-74076280037437",
    url: process.env.REQUIRED_CHANNEL_URL_3 || "https://max.ru/join/ufG4-ZgGP_lVbmSohw5ZWND7y5udP2zGDXhS7MI0pmw",
    title: "Канал 3"
  }
].filter((channel) => channel.id);

// Payload кнопки "Проверить"
const SUBSCRIPTION_CHECK_PAYLOAD = "check_subscription";

// Пользователи, которые уже прошли проверку подписки
const subscriptionVerifiedUsers = new Set();

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
    update?.callback?.user?.user_id ||
    update?.user?.user_id ||
    update?.user_id ||
    target?.id ||
    "unknown"
  );
}

function getUserFirstName(update) {
  const candidates = [
    update?.message?.sender?.first_name,
    update?.message?.sender?.firstName,
    update?.message?.sender?.name,
    update?.message?.sender?.full_name,
    update?.callback?.user?.first_name,
    update?.callback?.user?.firstName,
    update?.callback?.user?.name,
    update?.callback?.user?.full_name,
    update?.user?.first_name,
    update?.user?.firstName,
    update?.user?.name,
    update?.user?.full_name
  ];

  for (const value of candidates) {
    const text = String(value || "").trim();

    if (text) {
      return text.split(/\s+/)[0].slice(0, 50);
    }
  }

  return "";
}

function normalizeFloodText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function getRealUserIdForBroadcast(update, target) {
  return (
    update?.message?.sender?.user_id ||
    update?.callback?.user?.user_id ||
    update?.user?.user_id ||
    update?.user_id ||
    (target?.type === "user_id" ? target.id : "") ||
    ""
  );
}

function isValidUserIdForBroadcast(userId) {
  const value = String(userId || "").trim();

  return (
    value &&
    value !== "unknown" &&
    value !== "undefined" &&
    value !== "null"
  );
}

function isAdminUser(userId) {
  return ADMIN_USER_IDS.has(String(userId));
}

async function initBroadcastUsersDb() {
  if (!dbPool) return;

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS max_bot_broadcast_users (
      user_id TEXT NOT NULL,
      bot_key TEXT NOT NULL,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, bot_key)
    )
  `);

  await dbPool.query(`
    CREATE INDEX IF NOT EXISTS idx_max_bot_broadcast_users_user_id
    ON max_bot_broadcast_users (user_id)
  `);

  await dbPool.query(`
    CREATE INDEX IF NOT EXISTS idx_max_bot_broadcast_users_bot_key
    ON max_bot_broadcast_users (bot_key)
  `);

  console.log("Broadcast users DB initialized");
}

async function registerBotUserInDb(userId) {
  if (!dbPool) return false;
  if (!isValidUserIdForBroadcast(userId)) return false;

  const key = String(userId);

  await dbPool.query(
    `
      INSERT INTO max_bot_broadcast_users (user_id, bot_key)
      VALUES ($1, $2)
      ON CONFLICT (user_id, bot_key)
      DO UPDATE SET last_seen_at = NOW()
    `,
    [key, BOT_KEY]
  );

  return true;
}

async function getBroadcastRecipientsFromDb() {
  if (!dbPool) return [];

  const result = BROADCAST_USE_ALL_BOTS
    ? await dbPool.query(`
        SELECT DISTINCT user_id
        FROM max_bot_broadcast_users
        ORDER BY user_id
      `)
    : await dbPool.query(
        `
          SELECT DISTINCT user_id
          FROM max_bot_broadcast_users
          WHERE bot_key = $1
          ORDER BY user_id
        `,
        [BOT_KEY]
      );

  return result.rows
    .map((row) => String(row.user_id || "").trim())
    .filter(isValidUserIdForBroadcast);
}

function parseBroadcastCommand(text) {
  const value = String(text || "");

  const match = value.match(
    /^\s*\/(?:post|пост|broadcast|sendall|рассылка)(?:@\S+)?(?:\s+([\s\S]*))?$/iu
  );

  if (!match) return null;

  return String(match[1] || "").trim();
}

function isBroadcastCommand(text) {
  return parseBroadcastCommand(text) !== null;
}

async function handleBroadcastCommand(target, adminUserId, userText) {
  const broadcastText = parseBroadcastCommand(userText);

  if (broadcastText === null) {
    return false;
  }

  if (!isAdminUser(adminUserId)) {
    console.warn(`User ${adminUserId} tried to use broadcast command`);

    await sendMaxMessage(
      target,
      "⛔ Эта команда доступна только администратору."
    );

    return true;
  }

  if (!dbPool) {
    await sendMaxMessage(
      target,
      "⚠️ DATABASE_URL не задан. Рассылка через базу недоступна."
    );

    return true;
  }

  if (!broadcastText) {
    await sendMaxMessage(
      target,
      [
        "✍️ Напишите текст рассылки после команды.",
        "",
        "Примеры:",
        "`/post Всем привет! Это сообщение от бота.`",
        "`/рассылка Сегодня важное объявление.`"
      ].join("\n")
    );

    return true;
  }

  const recipients = await getBroadcastRecipientsFromDb();

  if (!recipients.length) {
    await sendMaxMessage(
      target,
      "⚠️ В базе пока нет пользователей для рассылки."
    );

    return true;
  }

  await sendMaxMessage(
    target,
    `📣 Начинаю рассылку для ${recipients.length} пользователей...`
  );

  let sentCount = 0;
  let failedCount = 0;

  for (const recipientUserId of recipients) {
    try {
      await sendMaxMessage(
        {
          type: "user_id",
          id: recipientUserId
        },
        broadcastText
      );

      sentCount += 1;
    } catch (error) {
      failedCount += 1;

      console.warn(
        `Broadcast failed for user ${recipientUserId}:`,
        error?.message || error
      );
    }

    if (BROADCAST_DELAY_MS > 0) {
      await sleep(BROADCAST_DELAY_MS);
    }
  }

  await sendMaxMessage(
    target,
    [
      "✅ Рассылка завершена.",
      "",
      `📨 Успешно отправлено: ${sentCount}`,
      `⚠️ Ошибок: ${failedCount}`,
      `👥 Получателей в выборке: ${recipients.length}`,
      "",
      BROADCAST_USE_ALL_BOTS
        ? "Режим: пользователи всех ботов из общей таблицы."
        : `Режим: только пользователи BOT_KEY=${BOT_KEY}.`
    ].join("\n")
  );

  return true;
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

async function sendBusyWarningIfNeeded(target, userId, firstName = "") {
  const now = Date.now();
  const lastWarningAt = userBusyWarningAt.get(userId) || 0;

  if (now - lastWarningAt < USER_BUSY_WARNING_COOLDOWN_MS) return;

  userBusyWarningAt.set(userId, now);

  const namePrefix = firstName ? `${firstName}, ` : "";

  await sendMaxMessage(
    target,
    `😅 ${namePrefix}Может хватит спамить? Пожалуйста, дождитесь ответа.`
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

  if (!userRequestCounts[key]) {
    userRequestCounts[key] = { images: 0, chatgpt: 0, videos: 0 };
  }

  if (!Number.isFinite(userRequestCounts[key][type])) {
    userRequestCounts[key][type] = 0;
  }

  userRequestCounts[key][type] += 1;
}

function isRequestLimitReached(userId, type, limit) {
  const key = getUserRequestKey(userId);
  return userRequestCounts[key]?.[type] >= limit;
}

function getUserRequestCounts(userId) {
  const key = getUserRequestKey(userId);

  if (!userRequestCounts[key]) {
    userRequestCounts[key] = { images: 0, chatgpt: 0, videos: 0 };
  }

  return userRequestCounts[key];
}

function isSubscriptionVerified(userId) {
  return subscriptionVerifiedUsers.has(String(userId));
}

function markSubscriptionVerified(userId) {
  subscriptionVerifiedUsers.add(String(userId));
}

function isSubscriptionRequiredForRequest(userId, type) {
  if (isSubscriptionVerified(userId)) return false;

  const counts = getUserRequestCounts(userId);

  if (type === "images") {
    return counts.images >= IMAGE_REQUESTS_BEFORE_SUBSCRIPTION;
  }

  if (type === "chatgpt") {
    return counts.chatgpt >= CHATGPT_REQUESTS_BEFORE_SUBSCRIPTION;
  }

  if (type === "videos") {
    return counts.videos >= VIDEO_REQUESTS_BEFORE_SUBSCRIPTION;
  }

  return false;
}

function resetDailyLimits() {
  // Сбрасываем лимиты ежедневно, можно настроить с помощью cron-job на сброс в полночь
  setInterval(() => {
    Object.keys(userRequestCounts).forEach((key) => {
      userRequestCounts[key] = { images: 0, chatgpt: 0, videos: 0 };
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
const STATUS_UPDATE_INTERVAL_MS = Number(process.env.STATUS_UPDATE_INTERVAL_MS || 2000);

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

const OPENAI_TEXT_CONCURRENCY = Number(process.env.OPENAI_TEXT_CONCURRENCY || 10);
const OPENAI_IMAGE_CONCURRENCY = Number(process.env.OPENAI_IMAGE_CONCURRENCY || 2);

function createConcurrencyLimiter(maxConcurrent) {
  let activeCount = 0;
  const queue = [];

  async function runNext() {
    if (activeCount >= maxConcurrent) return;

    const item = queue.shift();
    if (!item) return;

    activeCount += 1;

    try {
      const result = await item.task();
      item.resolve(result);
    } catch (error) {
      item.reject(error);
    } finally {
      activeCount -= 1;
      runNext();
    }
  }

  return function limit(task) {
    return new Promise((resolve, reject) => {
      queue.push({
        task,
        resolve,
        reject
      });

      runNext();
    });
  };
}

const runTextOpenAI = createConcurrencyLimiter(OPENAI_TEXT_CONCURRENCY);
const runImageOpenAI = createConcurrencyLimiter(OPENAI_IMAGE_CONCURRENCY);

function getIncomingText(update) {
  return update?.message?.body?.text?.trim() || update?.payload?.trim() || "";
}

function getCallbackPayload(update) {
  const candidates = [
    update?.callback?.payload,
    update?.callback?.button?.payload,
    update?.callback?.data,
    update?.payload,
    update?.button?.payload,
    update?.message?.body?.payload
  ];

  for (const value of candidates) {
    if (value === undefined || value === null) continue;

    if (typeof value === "string" || typeof value === "number") {
      const text = String(value).trim();
      if (text) return text;
    }

    if (typeof value === "object") {
      const nested =
        value.payload ||
        value.data ||
        value.value ||
        value.text;

      if (nested !== undefined && nested !== null) {
        const text = String(nested).trim();
        if (text) return text;
      }
    }
  }

  return "";
}

function getCallbackId(update) {
  return String(
    update?.callback?.callback_id ||
    update?.callback?.id ||
    update?.callback_id ||
    update?.message_callback?.callback_id ||
    ""
  ).trim();
}

function isSubscriptionCheckPayload(payload) {
  const value = String(payload || "").trim();

  return (
    value === SUBSCRIPTION_CHECK_PAYLOAD ||
    value.startsWith(`${SUBSCRIPTION_CHECK_PAYLOAD}:`)
  );
}

function getUserIdFromSubscriptionPayload(payload) {
  const value = String(payload || "").trim();

  if (!value.startsWith(`${SUBSCRIPTION_CHECK_PAYLOAD}:`)) {
    return "";
  }

  return value.slice(`${SUBSCRIPTION_CHECK_PAYLOAD}:`.length).trim();
}

function getReplyTarget(update) {
  const callback = update?.callback;
  const callbackMessage = callback?.message;
  const callbackRecipient = callbackMessage?.recipient;

  // Для callback сначала пытаемся ответить туда, где была нажата кнопка
  if (callbackRecipient?.chat_id) {
    return { type: "chat_id", id: callbackRecipient.chat_id };
  }

  if (callbackRecipient?.user_id) {
    return { type: "user_id", id: callbackRecipient.user_id };
  }

  const message = update?.message;
  const recipient = message?.recipient;

  if (recipient?.chat_id) {
    return { type: "chat_id", id: recipient.chat_id };
  }

  if (recipient?.user_id) {
    return { type: "user_id", id: recipient.user_id };
  }

  if (message?.sender?.user_id) {
    return { type: "user_id", id: message.sender.user_id };
  }

  const callbackUserId = callback?.user?.user_id;

  if (callbackUserId) {
    return { type: "user_id", id: callbackUserId };
  }

  if (callbackMessage?.sender?.user_id) {
    return { type: "user_id", id: callbackMessage.sender.user_id };
  }

  if (update?.chat_id) {
    return { type: "chat_id", id: update.chat_id };
  }

  if (update?.user?.user_id) {
    return { type: "user_id", id: update.user.user_id };
  }

  if (update?.user_id) {
    return { type: "user_id", id: update.user_id };
  }

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

const VIDEO_PROMPT_RE_1 =
  /(?:^|[^\p{L}\p{N}_])(?:создай|создать|сделай|сгенерируй|generate|make|create)\s+видео(?:\b|$)/iu;

const VIDEO_PROMPT_RE_2 =
  /(?:^|[^\p{L}\p{N}_])(?:оживи|оживить)\s+(?:фото|картинку|изображение)(?:\b|$)/iu;

const VIDEO_PROMPT_RE_3 =
  /(?:^|[^\p{L}\p{N}_])(?:оживи|оживить)\s+видео(?:\b|$)/iu;

function isVideoRequest(userText, hasIncomingImage) {
  const text = String(userText || "").trim();
  if (!text) return false;
  if (!hasIncomingImage) return false; // video делаем только из фото

  return (
    VIDEO_PROMPT_RE_1.test(text) ||
    VIDEO_PROMPT_RE_2.test(text) ||
    VIDEO_PROMPT_RE_3.test(text)
  );
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

async function answerMaxCallback(callbackId, notification = "") {
  if (!callbackId) return false;

  const text = String(notification || "").trim();

  try {
    await maxRequest("/answers", {
      method: "POST",
      query: {
        callback_id: callbackId
      },
      body: {
        notification: text || null
      }
    });

    return true;
  } catch (firstError) {
    console.warn("MAX callback answer with query failed:", firstError?.message || firstError);
  }

  try {
    await maxRequest("/answers", {
      method: "POST",
      body: {
        callback_id: callbackId,
        notification: text || null
      }
    });

    return true;
  } catch (secondError) {
    console.warn("MAX callback answer with body failed:", secondError?.message || secondError);
    return false;
  }
}

async function sendMaxSingleMessage(target, text, notify = true) {
  return maxRequest("/messages", {
    method: "POST",
    query: { [target.type]: target.id },
    body: {
      text,
      notify,
      format: "markdown" // Указание формата для Markdown
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

async function sendSubscriptionPrompt(target, userId, prefixText = "") {
  const text =
    `${prefixText ? `${prefixText}\n\n` : ""}` +
    "🔒 Чтобы продолжить пользоваться ботом бесплатно НАВСЕГДА, подпишитесь на обязательные каналы и нажмите кнопку Я подписан.";

  // ВАЖНО: кладём userId в payload, чтобы при callback проверять именно пользователя,
  // а не бота или чат.
  const checkPayload = `${SUBSCRIPTION_CHECK_PAYLOAD}:${userId}`;

  const subscribeButtons = REQUIRED_CHANNELS
    .filter((channel) => channel.url)
    .map((channel, index) => [
      {
        type: "link",
        text: `📢 Подписаться на ${channel.title || `канал ${index + 1}`}`,
        url: channel.url
      }
    ]);

  const buttons = [
    ...subscribeButtons,
    [
      {
        type: "callback",
        text: "✅ Я подписан(а)",
        payload: checkPayload
      }
    ]
  ];

  const attachments = [
    {
      type: "inline_keyboard",
      payload: {
        buttons
      }
    }
  ];

  try {
    await sendMaxMessageWithAttachments(target, text, attachments);
  } catch (error) {
    console.warn(
      "Failed to send subscription buttons, fallback to text:",
      error?.message || error
    );

    const channelsText = REQUIRED_CHANNELS
      .map((channel, index) => {
        const title = channel.title || `канал ${index + 1}`;
        return channel.url
          ? `📢 ${title}: ${channel.url}`
          : `📢 ${title}: ссылка не указана`;
      })
      .join("\n");

    await sendMaxMessage(
      target,
      `${text}\n\n${channelsText}\n\nПосле подписки отправьте команду: /проверить`
    );
  }
}





function extractMembersFromMaxResponse(body) {
  if (!body) return [];

  const candidates = [
    body.members,
    body.items,
    body.users,
    body.subscribers,
    body.chat_members,
    body.chatMembers,
    body.data,
    body.result?.members,
    body.result?.items,
    body.result?.users,
    body.result?.subscribers,
    body.payload?.members,
    body.payload?.items,
    body.payload?.users,
    body.payload?.subscribers,
    body.response?.members,
    body.response?.items,
    body.response?.users,
    body.response?.subscribers
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  if (Array.isArray(body)) {
    return body;
  }

  return [];
}

function getMemberUserId(member) {
  return (
    member?.user_id ||
    member?.userId ||
    member?.id ||
    member?.user?.user_id ||
    member?.user?.userId ||
    member?.user?.id ||
    member?.member?.user_id ||
    member?.member?.userId ||
    member?.member?.id ||
    member?.profile?.user_id ||
    member?.profile?.userId ||
    member?.profile?.id ||
    ""
  );
}

function isMemberActive(member) {
  if (!member) return false;

  const status = String(
    member?.status ||
    member?.membership?.status ||
    member?.member?.status ||
    member?.role ||
    ""
  ).toLowerCase();

  const negativeStatuses = [
    "left",
    "leave",
    "kicked",
    "banned",
    "blocked",
    "not_member",
    "not_found",
    "none",
    "deleted"
  ];

  if (negativeStatuses.includes(status)) {
    return false;
  }

  if (
    member?.is_member === false ||
    member?.isMember === false ||
    member?.subscribed === false ||
    member?.is_subscriber === false ||
    member?.isSubscriber === false
  ) {
    return false;
  }

  // В ответе MAX из Postman у участников нет status, но есть user_id.
  // Поэтому если user_id есть и нет отрицательного статуса — считаем участником/подписчиком.
  return Boolean(getMemberUserId(member));
}

function responseContainsActiveUser(body, userId) {
  const expectedUserId = String(userId);
  const members = extractMembersFromMaxResponse(body);

  for (const member of members) {
    const memberUserId = String(getMemberUserId(member));

    if (memberUserId === expectedUserId && isMemberActive(member)) {
      return true;
    }
  }

  return false;
}

function getNextMembersMarker(body) {
  return String(
    body?.marker ||
    body?.next_marker ||
    body?.nextMarker ||
    body?.pagination?.marker ||
    body?.pagination?.next_marker ||
    body?.result?.marker ||
    body?.result?.next_marker ||
    body?.payload?.marker ||
    body?.payload?.next_marker ||
    ""
  ).trim();
}

async function checkSingleRequiredChannelSubscription(userId, requiredChannel) {
  if (!requiredChannel?.id) {
    console.warn("Required channel ID is not set. Cannot check subscription.");
    return false;
  }

  const channelId = encodeURIComponent(requiredChannel.id);
  const expectedUserId = String(userId);

  try {
    /*
      Проверяем участников канала:
      GET /chats/{channelId}/members
    */

    let marker = "";
    let page = 0;
    const maxPages = 20;

    while (page < maxPages) {
      page += 1;

      const query = {};

      if (marker) {
        query.marker = marker;
      }

      console.log(
        "Outgoing subscription check:",
        JSON.stringify({
          method: "GET",
          path: `/chats/${channelId}/members`,
          query,
          expectedUserId,
          requiredChannelId: requiredChannel.id
        })
      );

      const result = await maxRequest(`/chats/${channelId}/members`, {
        method: "GET",
        query
      });

      console.log(
        `Subscription check response page ${page} for user ${userId}, channel ${requiredChannel.id}`
      );

      if (responseContainsActiveUser(result, expectedUserId)) {
        console.log(
          `Subscription check result for user ${userId}, channel ${requiredChannel.id}: true`
        );

        return true;
      }

      const nextMarker = getNextMembersMarker(result);

      if (!nextMarker || nextMarker === marker) {
        break;
      }

      marker = nextMarker;
    }

    console.log(
      `Subscription check result for user ${userId}, channel ${requiredChannel.id}: false`
    );

    return false;
  } catch (error) {
    const message = String(error?.message || error);

    console.warn(
      `Subscription check failed for user ${userId}, channel ${requiredChannel.id}:`,
      message
    );

    if (/method\.not\.found/i.test(message)) {
      console.warn(
        "MAX endpoint не найден. Проверь, что используется GET /chats/{channelId}/members."
      );
    }

    if (/Method is not available for dialogs/i.test(message)) {
      console.warn(
        `MAX считает ID диалогом. Проверь ID канала: ${requiredChannel.id}`
      );
    }

    return false;
  }
}

async function checkRequiredChannelSubscription(userId) {
  if (isSubscriptionVerified(userId)) return true;

  if (!REQUIRED_CHANNELS.length) {
    console.warn("REQUIRED_CHANNELS is empty. Cannot check subscription.");
    return false;
  }

  for (const requiredChannel of REQUIRED_CHANNELS) {
    const subscribed = await checkSingleRequiredChannelSubscription(
      userId,
      requiredChannel
    );

    if (!subscribed) {
      console.log(
        `User ${userId} is not subscribed to required channel ${requiredChannel.id}`
      );

      return false;
    }
  }

  console.log(`User ${userId} is subscribed to all required channels`);
  return true;
}

async function handleSubscriptionCheck(target, userId, callbackId = "") {
  const subscribed = await checkRequiredChannelSubscription(userId);

  if (subscribed) {
    markSubscriptionVerified(userId);

    if (callbackId) {
      await answerMaxCallback(
        callbackId,
        "✅ Подписка найдена. Доступ открыт."
      );
    }

    await sendMaxMessage(
      target,
      "✅ Подписка проверена. Доступ открыт, можете продолжать пользоваться ботом."
    );

    return true;
  }

  if (callbackId) {
    await answerMaxCallback(
      callbackId,
      "❌ Пока не вижу подписку. Подпишитесь и нажмите «Проверить» ещё раз."
    );
  }

  await sendSubscriptionPrompt(
    target,
    userId,
    "❌ Пока не вижу подписку на канал."
  );

  return false;
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

const { Pool } = pg;

// Общая база данных PostgreSQL.
// Можно использовать DATABASE_URL от другого бота.
const DATABASE_URL = process.env.DATABASE_URL || "";

// Уникальное имя этого бота в общей базе.
// Если хочешь отделять пользователей разных ботов — оставь уникальным.
const BOT_KEY = process.env.BOT_KEY || "max_openai_bot";

const BROADCAST_USE_ALL_BOTS = false;

// ID админов, которым разрешена рассылка.
// Пример:
// ADMIN_USER_IDS=282278177,282278177
const ADMIN_USER_IDS = new Set(
  String(process.env.ADMIN_USER_IDS || process.env.ADMIN_USER_ID || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
);

// Пауза между сообщениями рассылки
const BROADCAST_DELAY_MS = Number(process.env.BROADCAST_DELAY_MS || 350);

const dbPool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl:
        String(process.env.DATABASE_SSL || "true").toLowerCase() === "false"
          ? false
          : { rejectUnauthorized: false }
    })
  : null;

if (!DATABASE_URL) {
  console.warn("DATABASE_URL is not set. Broadcast users DB will be unavailable.");
}

if (!ADMIN_USER_IDS.size) {
  console.warn("ADMIN_USER_IDS is not set. Broadcast command will be unavailable.");
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

async function makeVideoFromWorkerViaHttp({ inputBuffer, prompt }) {
  if (!WORKER_MAKE_VIDEO_URL) {
    throw new Error("WORKER_MAKE_VIDEO_URL is not set");
  }

  const form = new FormData();
  // имя поля должно совпасть с тем, что ожидает python webservice: file + prompt
  form.append("file", new Blob([inputBuffer], { type: "image/png" }), "in.png");
  form.append("prompt", String(prompt || ""));

  const resp = await fetch(WORKER_MAKE_VIDEO_URL, {
    method: "POST",
    body: form
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Worker make-video failed: ${resp.status} ${t}`);
  }

  const ab = await resp.arrayBuffer();
  return Buffer.from(ab); // mp4 bytes
}

async function uploadVideoToMaxAndGetToken(videoBuffer) {
  if (!videoBuffer || !videoBuffer.length) throw new Error("Video buffer is empty");

  // step 1: получить uploadUrl и token (token часто приходит здесь)
  const uploadInfo = await maxRequest("/uploads", {
    method: "POST",
    query: { type: "video" }
  });

  const uploadUrl = uploadInfo?.url || uploadInfo?.upload_url;
  if (!uploadUrl) {
    throw new Error(`MAX /uploads(type=video) returned no url: ${JSON.stringify(uploadInfo)}`);
  }

  // token чаще всего тут
  let token = uploadInfo?.token;

  const form = new FormData();
  form.append("data", new Blob([videoBuffer], { type: "video/mp4" }), "openai-video.mp4");

  // step 2: загрузка по uploadUrl (обычно возвращает retval, а не token)
  const resp = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: MAX_BOT_TOKEN
    },
    body: form
  });

  const bodyText = await resp.text();
  if (!resp.ok) {
    throw new Error(`MAX video upload step2 failed ${resp.status}: ${bodyText?.slice(0, 500)}`);
  }

  // Fallback: если token не пришёл на step1 — попробуем вытащить из step2
  if (!token) {
    // вариант 1: JSON
    try {
      const json = JSON.parse(bodyText);
      token = json?.token;
    } catch {}

    // вариант 2: <retval>TOKEN</retval>
    if (!token) {
      const m = String(bodyText || "").match(/<retval>\s*([\s\S]*?)\s*<\/retval>/i);
      if (m?.[1]) token = m[1];
    }
  }

  if (!token) {
    throw new Error(
      `MAX video upload no token. step1=${JSON.stringify(uploadInfo)} step2=${bodyText}`
    );
  }

  return String(token).trim();
}

async function sendMaxVideo(target, text, videoBuffer) {
  const token = await uploadVideoToMaxAndGetToken(videoBuffer);

  const attachments = [
    { type: "video", payload: { token } }
  ];

  const retries = Number(process.env.VIDEO_SEND_RETRIES || 4);
  const baseDelayMs = Number(process.env.VIDEO_SEND_RETRY_DELAY_MS || 1200);

  let lastError;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      // по докам: делаем паузу перед отправкой/повтором
      await sleep(baseDelayMs * (attempt + 1));
      await sendMaxMessageWithAttachments(target, text || null, attachments);
      return;
    } catch (e) {
      lastError = e;
      const message = String(e?.message || "");
      if (!/attachment\.not\.ready|not\.processed|not ready/i.test(message)) throw e;
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

  if (isSubscriptionRequiredForRequest(userId, "images")) {
    await sendSubscriptionPrompt(
      target,
      userId,
      `Вы уже создали ${IMAGE_REQUESTS_BEFORE_SUBSCRIPTION} фото бесплатно.`
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

async function handleVideoRequest(update, target, userText, incomingImageUrl, userId = target.id) {
  const prompt = String(userText || "").trim();

  if (!incomingImageUrl) {
    await sendMaxMessage(target, "Пришлите фото и напишите: **оживи фото** или **создай видео**.");
    return;
  }

  if (!prompt) {
    await sendMaxMessage(target, "Фото получил. Теперь напишите промт: **оживи фото** / **создай видео**.");
    return;
  }

  // Лимит на день (5 по сценарию). Использует VIDEO_REQUEST_LIMIT env.
  if (isRequestLimitReached(userId, "videos", VIDEO_REQUEST_LIMIT)) {
    await sendMaxMessage(
      target,
      "🥱Вы достигли лимита на создание **видео** сегодня. Приходите позже и продолжайте."
    );
    return;
  }

  // Подписка после 1 бесплатного видео
  if (isSubscriptionRequiredForRequest(userId, "videos")) {
    await sendSubscriptionPrompt(
      target,
      userId,
      `Вы уже создали ${VIDEO_REQUESTS_BEFORE_SUBSCRIPTION} видео бесплатно.`
    );
    return;
  }

  // Инкрементируем ДО генерации
  incrementRequestCount(userId, "videos");

  const inputImage = await downloadIncomingImage(incomingImageUrl);

  const videoBuffer = await makeVideoFromWorkerViaHttp({
    inputBuffer: inputImage.buffer,
    prompt
  });

  const caption = `🎬 Готово! Сделал видео.\nПромт: ${prompt.slice(0, 700)}`;
  await sendMaxVideo(target, caption, videoBuffer);
}
async function handleUpdate(update) {
  const updateType = update?.update_type;
  const target = getReplyTarget(update);
  let status = null;
  let processingLocked = false;

  console.log("Incoming update type:", updateType);

  if (!target) {
    console.log("No reply target in update:", JSON.stringify(update));
    return;
  }

    const userId = getStableUserId(update, target);
  const firstName = getUserFirstName(update);
  

  const broadcastUserId = getRealUserIdForBroadcast(update, target);

  registerBotUserInDb(broadcastUserId).catch((error) => {
    console.warn("Failed to register bot user in DB:", error?.message || error);
  });

  try {
    if (updateType === "bot_started") {
      await sendMaxMessage(
        target,
        "**Здравствуйте**. Напишите вопрос или попросите **создать фото/картинку**. Например: создай фото кота в космосе."
      );
      return;
    }

    const userText = getIncomingText(update);
    const callbackPayload = getCallbackPayload(update);
    const callbackId = getCallbackId(update);
    const incomingImageUrl = extractIncomingImageUrl(update);

    const isCallbackUpdate =
      updateType === "message_callback" ||
      Boolean(callbackId) ||
      Boolean(callbackPayload);

    // Отдельная обработка callback-кнопок
    if (isCallbackUpdate) {
      console.log("Callback received:", {
        callbackPayload,
        callbackId,
        userId,
        target
      });

      if (isSubscriptionCheckPayload(callbackPayload)) {
        const userIdFromPayload = getUserIdFromSubscriptionPayload(callbackPayload);

        if (!userIdFromPayload) {
          console.warn(
            "Subscription callback has no userId in payload. Payload:",
            callbackPayload
          );

          if (callbackId) {
            await answerMaxCallback(
              callbackId,
              "Кнопка устарела. Отправьте /проверить или получите новую кнопку."
            );
          }

          await sendMaxMessage(
            target,
            "⚠️ Эта кнопка проверки устарела. Пожалуйста, отправьте команду /проверить или получите новую кнопку."
          );

          return;
        }

        await handleSubscriptionCheck(target, userIdFromPayload, callbackId);
        return;
      }

      if (callbackId) {
        await answerMaxCallback(callbackId, "Неизвестная кнопка.");
      }

      return;
    }

    // Админ-команда рассылки всем пользователям бота
    if (isBroadcastCommand(userText)) {
      if (updateType !== "message_created") return;

      await handleBroadcastCommand(target, userId, userText);
      return;
    }

    // Текстовая команда проверки подписки
    if (
      userText.toLowerCase() === "/check_sub" ||
      userText.toLowerCase() === "/проверить"
    ) {
      await handleSubscriptionCheck(target, userId, "");
      return;
    }

    if (updateType !== "message_created") return;

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
      await sendBusyWarningIfNeeded(target, userId,firstName);
      return;
    }

    lockUserProcessing(userId);
    processingLocked = true;

    if (isVideoRequest(userText, Boolean(incomingImageUrl))) {
      status = await startDynamicStatus(target, "🎞️Видео создается");

      await handleVideoRequest(update, target, userText, incomingImageUrl, userId);

      await status.stop();
      status = null;
      return;
    }

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

    if (isSubscriptionRequiredForRequest(userId, "chatgpt")) {
      await sendSubscriptionPrompt(
        target,
        userId,
        `Вы уже использовали ${CHATGPT_REQUESTS_BEFORE_SUBSCRIPTION} текстовых запроса бесплатно.`
      );
      return;
    }

    incrementRequestCount(userId, "chatgpt");

    status = await startDynamicStatus(target, "💬ИИ думает");

    const answer = await runTextOpenAI(() => askOpenAI(userId, userText));

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

initBroadcastUsersDb()
  .catch((error) => {
    console.warn("Broadcast DB init failed:", error?.message || error);
  })
  .finally(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`MAX OpenAI bot is running on port ${PORT}`);
    });
  });
