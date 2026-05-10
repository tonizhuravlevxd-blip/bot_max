import express from "express";
import pg from "pg";
import crypto from "crypto";
import { fal } from "@fal-ai/client";

const app = express();
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 10000;
const MAX_BOT_TOKEN = process.env.MAX_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEBUG_LOGS =
  String(process.env.DEBUG_LOGS || "false").toLowerCase() === "true";

function debugLog(...args) {
  if (DEBUG_LOGS) {
    console.log(...args);
  }
}

const IMAGE_REQUEST_LIMIT = 4; 
const CHATGPT_REQUEST_LIMIT = 8;
const VIDEO_REQUEST_LIMIT = Number(process.env.VIDEO_REQUEST_LIMIT || 5);
const VIDEO_REQUESTS_BEFORE_SUBSCRIPTION = Number(
  process.env.VIDEO_REQUESTS_BEFORE_SUBSCRIPTION || 1
);

const YOOKASSA_RECEIPT_EMAIL =
  process.env.YOOKASSA_RECEIPT_EMAIL || "toni.zhuravlev.xd@mail.ru";

const YOOKASSA_VAT_CODE = Number(process.env.YOOKASSA_VAT_CODE || 1);
const YOOKASSA_TAX_SYSTEM_CODE = process.env.YOOKASSA_TAX_SYSTEM_CODE
  ? Number(process.env.YOOKASSA_TAX_SYSTEM_CODE)
  : undefined;

const PREMIUM_IMAGE_REQUEST_LIMIT = Number(process.env.PREMIUM_IMAGE_REQUEST_LIMIT || 10);
const PREMIUM_CHATGPT_REQUEST_LIMIT = Number(process.env.PREMIUM_CHATGPT_REQUEST_LIMIT || 16);
const PREMIUM_VIDEO_REQUEST_LIMIT = Number(process.env.PREMIUM_VIDEO_REQUEST_LIMIT || 1);
const PREMIUM_DURATION_DAYS = Number(process.env.PREMIUM_DURATION_DAYS || 30);
const PREMIUM_PRICE_RUB = process.env.PREMIUM_PRICE_RUB || "199.00";
const PRODUCT_CARD_PRICE_RUB = process.env.PRODUCT_CARD_PRICE_RUB || "79.00";
const PRODUCT_CARD_PRODUCT_CODE = "product_card";
const PRODUCT_CARD_IMAGES_COUNT = Number(process.env.PRODUCT_CARD_IMAGES_COUNT || 3);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_API_BASE =
  process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com/v1beta";

const GEMINI_LYRIA_MODEL =
  process.env.GEMINI_LYRIA_MODEL || "lyria-3-clip-preview";

const MUSIC_PRICE_RUB = process.env.MUSIC_PRICE_RUB || "69.00";
const MUSIC_PRODUCT_CODE = "music_track";

const MENU_CREATE_MUSIC_PAYLOAD = "menu_create_music";
const IMAGE_MODE_MUSIC = "music";


const FAL_KEY = process.env.FAL_KEY || "";

fal.config({
  credentials: FAL_KEY
});

const FAL_SEEDANCE_IMAGE_TO_VIDEO_URL =
  process.env.FAL_SEEDANCE_IMAGE_TO_VIDEO_URL ||
  "https://queue.fal.run/fal-ai/bytedance/seedance/v1/lite/image-to-video";

const FAL_QUEUE_TIMEOUT_MS = Number(process.env.FAL_QUEUE_TIMEOUT_MS || 8 * 60_000);
const FAL_QUEUE_POLL_INTERVAL_MS = Number(process.env.FAL_QUEUE_POLL_INTERVAL_MS || 2500);

const VIDEO_PRICE_RUB = process.env.VIDEO_PRICE_RUB || "59.00";
const VIDEO_PRODUCT_CODE = "photo_animation_video";
const VIDEO_EXAMPLE_URL = process.env.VIDEO_EXAMPLE_URL || "https://v3b.fal.media/files/b/0a994a93/nP39rGAe_VTIOtxt4ZoPB_video.mp4";
const VIDEO_EXAMPLE_MAX_TOKEN = process.env.VIDEO_EXAMPLE_MAX_TOKEN || "";

let cachedVideoExampleToken = VIDEO_EXAMPLE_MAX_TOKEN;
let videoExampleTokenPromise = null;

const IMAGE_MODE_VIDEO = "video_animation";

const VIDEO_ANIMATE_PHOTO_PROMPT = `Animate this photo into a realistic video with strict identity preservation.

Keep every visible person exactly the same as in the original photo:
same face, same skin texture, same age, same proportions, same unique facial details.
No beautification, no stylization, no face alteration.

Motion:
natural blinking, gentle breathing, very slight head movement, and a very subtle natural smile.
The person should look directly at the viewer/camera.
If there are visible people in the photo, they should gently and naturally wave toward the viewer/camera, as if greeting us.
The hand wave must be small, smooth, realistic, and anatomically correct.
Facial expression should remain calm, warm, and natural.

Style:
ultra-realistic, natural skin texture, realistic motion, portrait realism.

Camera:
fixed camera, no camera shake, shallow depth of field.

Avoid:
any facial changes, makeup, skin smoothing, exaggerated motion, strong expressions, distorted hands, distorted body proportions, looking away from the camera, AI artifacts.

The final result must look like real footage of the same person from the original image, maintaining direct eye contact with the viewer, a soft natural smile, and subtle realistic waving.`;

const YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID || "";
const YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY || "";
const YOOKASSA_API_BASE = process.env.YOOKASSA_API_BASE || "https://api.yookassa.ru/v3";

const APP_PUBLIC_URL = String(
  process.env.APP_PUBLIC_URL || process.env.PUBLIC_URL || ""
).replace(/\/+$/, "");

const WORKER_MAKE_VIDEO_URL = process.env.WORKER_MAKE_VIDEO_URL || "";

// После этих значений нужна подписка
const IMAGE_REQUESTS_BEFORE_SUBSCRIPTION = Number(
  process.env.IMAGE_REQUESTS_BEFORE_SUBSCRIPTION || 1
);

const CHATGPT_REQUESTS_BEFORE_SUBSCRIPTION = Number(
  process.env.CHATGPT_REQUESTS_BEFORE_SUBSCRIPTION || 2
);

// Каналы MAX, на которые нужна обязательная подписка
const REQUIRED_CHANNELS = [
  {
    id: process.env.REQUIRED_CHANNEL_ID || "-73970192098593",
    url: process.env.REQUIRED_CHANNEL_URL || "https://max.ru/id503501079307_1_bot?startapp=TLb08ea5db5d65",
    title: "Наш Канал"
  },
  {
    id: process.env.REQUIRED_CHANNEL_ID_2 || "-74096616285473",
    url: process.env.REQUIRED_CHANNEL_URL_2 || "https://max.ru/id503501079307_1_bot?startapp=TL78917b331549",
    title: "Канал 2"
  },
  {
    id: process.env.REQUIRED_CHANNEL_ID_3 || "-74290803017086",
    url: process.env.REQUIRED_CHANNEL_URL_3 || "https://max.ru/id503501079307_1_bot?startapp=TL35c6e5db6065",
    title: "Канал 3"
  }
].filter((channel) => channel.id);

// Payload кнопки "Проверить"
const SUBSCRIPTION_CHECK_PAYLOAD = "check_subscription";

// Пейлоады для основного меню
const MENU_CREATE_PHOTO_PAYLOAD = "menu_create_photo";
const MENU_CREATE_VIDEO_PAYLOAD = "menu_create_video";
const MENU_RESTORE_PHOTO_PAYLOAD = "menu_restore_photo";
const MENU_PREMIUM_PAYLOAD = "menu_premium";
const MENU_BACK_PAYLOAD = "menu_back";
const MENU_PRODUCT_CARD_PAYLOAD = "menu_product_card";


const IMAGE_MODE_RESTORATION = "restoration";
const IMAGE_MODE_PRODUCT_CARD = "product_card";

const RESTORATION_PROMPT = `Реставрируй старую фотографию максимально аккуратно и реалистично.

Главная задача: улучшить качество изображения, сохранив оригинал без изменений личности людей, черт лица, пропорций, возраста, формы глаз, носа, губ, мимики, причёски, одежды, поз, композиции и фона.

Сохрани все лица 1:1. Не изменяй выражения лиц, не омолаживай, не делай людей красивее, не добавляй новые черты, не меняй форму головы, глаз, носа, рта, ушей и подбородка.

Сохрани все надписи, буквы, цифры, документы, вывески и текст на фото без искажений. Не переписывай текст заново, не заменяй буквы, не добавляй новые символы, не исправляй надписи творчески. Если текст плохо читается, оставь его максимально близким к оригиналу.

Убери пыль, царапины, пятна, заломы, трещины, шум, следы старения бумаги и мелкие повреждения. Восстанови потерянные участки только там, где это очевидно по соседним деталям. Не придумывай новые объекты.

Улучши резкость, контраст, детализацию и тональный баланс мягко, без чрезмерной обработки. Сохрани естественную текстуру старой фотографии, зерно плёнки и исторический характер снимка. Не делай фото пластиковым, глянцевым или похожим на современную AI-фотографию.

Если фотография чёрно-белая — оставь её чёрно-белой, если не указано иное. Если фотография цветная — восстанови естественные приглушённые цвета без перенасыщения.

Финальный результат: реалистичная реставрация архивного фото, чистое изображение, сохранённые лица и надписи, без изменения оригинальной сцены.`;

// Пользователи, которые уже прошли проверку подписки
const subscriptionVerifiedUsers = new Set();

// Сообщение с кнопкой "Я подписан(а)" для каждого пользователя
// key: userId(string) -> messageId(string)
const userSubscriptionMessages = new Map();

const userRequestCounts = {};
const registeredUserCache = new Map();
const REGISTER_USER_CACHE_TTL_MS = Number(
  process.env.REGISTER_USER_CACHE_TTL_MS || 6 * 60 * 60 * 1000
);

function shouldRegisterBotUser(userId) {
  const key = String(userId || "").trim();

  if (!isValidUserIdForBroadcast(key)) {
    return false;
  }

  const now = Date.now();
  const lastRegisteredAt = registeredUserCache.get(key) || 0;

  if (now - lastRegisteredAt < REGISTER_USER_CACHE_TTL_MS) {
    return false;
  }

  registeredUserCache.set(key, now);
  return true;
}

const userImageModes = new Map();

function setUserImageMode(userId, mode) {
  userImageModes.set(String(userId || "unknown"), mode);
}

function getUserImageMode(userId) {
  return userImageModes.get(String(userId || "unknown")) || "";
}

function clearUserImageMode(userId) {
  userImageModes.delete(String(userId || "unknown"));
}

function isRestorationMode(userId) {
  return getUserImageMode(userId) === IMAGE_MODE_RESTORATION;
}

function isProductCardMode(userId) {
  return getUserImageMode(userId) === IMAGE_MODE_PRODUCT_CARD;
}

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
  // Для callback всегда главный источник — пользователь, который нажал кнопку
  if (update?.callback?.user?.user_id) {
    return update.callback.user.user_id;
  }

  return (
    update?.message?.sender?.user_id ||
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

async function uploadImageToFalCdn(inputImage) {
  if (!FAL_KEY) {
    throw new Error("FAL_KEY is not set");
  }

  const file = new File(
    [inputImage.buffer],
    inputImage.filename || "input.png",
    { type: inputImage.mime || "image/png" }
  );

  return fal.storage.upload(file);
}

function formatChatGptAnswerWithName(firstName, answer) {
  const cleanAnswer = String(answer || "").trim();

  const cleanName = String(firstName || "")
    .replace(/[\r\n,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 50);

  if (!cleanName) {
    return cleanAnswer;
  }

  return `${cleanName}, ${cleanAnswer}`;
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

async function initLimitsDb() {
  if (!dbPool) return;

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS max_bot_limits (
      user_id TEXT NOT NULL,
      bot_key TEXT NOT NULL,
      date DATE NOT NULL,
      images INTEGER NOT NULL DEFAULT 0,
      chatgpt INTEGER NOT NULL DEFAULT 0,
      videos INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, bot_key, date)
    )
  `);

  await dbPool.query(`
    CREATE INDEX IF NOT EXISTS idx_max_bot_limits_user_date
    ON max_bot_limits (user_id, date)
  `);

  await dbPool.query(`
    CREATE INDEX IF NOT EXISTS idx_max_bot_limits_bot_key
    ON max_bot_limits (bot_key)
  `);

  console.log("Limits DB initialized");
}

async function initPremiumDb() {
  if (!dbPool) return;

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS max_bot_premium_users (
      user_id TEXT NOT NULL,
      bot_key TEXT NOT NULL,
      premium_until TIMESTAMPTZ NOT NULL,
      last_payment_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, bot_key)
    )
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS max_bot_premium_payments (
      payment_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      bot_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      amount TEXT NOT NULL DEFAULT '199.00',
      currency TEXT NOT NULL DEFAULT 'RUB',
      raw JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await dbPool.query(`
  CREATE TABLE IF NOT EXISTS max_bot_product_card_credits (
    user_id TEXT NOT NULL,
    bot_key TEXT NOT NULL,
    credits INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, bot_key)
  )
`);

await dbPool.query(`
  CREATE INDEX IF NOT EXISTS idx_max_bot_product_card_credits_user_bot
  ON max_bot_product_card_credits (user_id, bot_key)
`);

  await dbPool.query(`
  CREATE TABLE IF NOT EXISTS max_bot_music_credits (
    user_id TEXT NOT NULL,
    bot_key TEXT NOT NULL,
    credits INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, bot_key)
  )
`);

await dbPool.query(`
  CREATE INDEX IF NOT EXISTS idx_max_bot_music_credits_user_bot
  ON max_bot_music_credits (user_id, bot_key)
`);

 await dbPool.query(`
  CREATE TABLE IF NOT EXISTS max_bot_video_credits (
    user_id TEXT NOT NULL,
    bot_key TEXT NOT NULL,
    credits INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, bot_key)
  )
`);

await dbPool.query(`
  CREATE INDEX IF NOT EXISTS idx_max_bot_video_credits_user_bot
  ON max_bot_video_credits (user_id, bot_key)
`); 
  await dbPool.query(`
    CREATE INDEX IF NOT EXISTS idx_max_bot_premium_users_active
    ON max_bot_premium_users (user_id, bot_key, premium_until)
  `);

  console.log("Premium DB initialized");
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

setInterval(() => {
  const now = Date.now();

  for (const [userId, lastRegisteredAt] of registeredUserCache.entries()) {
    if (now - lastRegisteredAt > REGISTER_USER_CACHE_TTL_MS * 2) {
      registeredUserCache.delete(userId);
    }
  }
}, 60 * 60 * 1000).unref?.();


const CONTEXT_MAX_REQUESTS = Number(process.env.CONTEXT_MAX_REQUESTS || 3);
const CONTEXT_MAX_TEXT_CHARS = Number(process.env.CONTEXT_MAX_TEXT_CHARS || 3000);
const CONTEXT_TTL_MS = Number(process.env.CONTEXT_TTL_MS || 30 * 60_000);

const userChatContexts = new Map();

// Рандомные сообщения после 1–2 успешных генераций/ответов
const RANDOM_NUDGE_ENABLED =
  String(process.env.RANDOM_NUDGE_ENABLED || "true").toLowerCase() !== "false";

const RANDOM_NUDGE_MIN_GENERATIONS = Number(
  process.env.RANDOM_NUDGE_MIN_GENERATIONS || 1
);

const RANDOM_NUDGE_MAX_GENERATIONS = Number(
  process.env.RANDOM_NUDGE_MAX_GENERATIONS || 4
);

// Сюда можешь добавлять свои фразы
const RANDOM_NUDGE_MESSAGES = [
  "💡 **Совет дня:** если ты сейчас отвлечёшься от телефона на 4 секунды — это может немного успокоить и расслабить. Отвлёкся? Молодец 😌",

  "🎁 Спасибо, что пользуешься ботом. Вот **[СТИКЕРЫ](https://max.ru/stickerset/H-ZRhj8Ho-gSEXFkiTwVJqOpforgF83w7wyGrDq47VI)**",

  "🚀 **Хочешь больше продаж на Wildberries и Ozon?** 📈 **MarketAI24** покажет, где ты теряешь *деньги* и как увеличить прибыль с помощью AI-аналитики. 🔥 Попробуй **[БЕСПЛАТНО](https://marketai24.ru/?ref=5ZFAWMVO)**",

  "🧠 Маленький совет: иногда лучший промт получается, если описать не только объект, но и стиль, свет, фон и настроение.",

  "✨ Хочешь результат лучше? Проси прямо в **ЧАТ** чтобы написали промт за тебя и **создавай фото**",

  "🤖 Спасибо, что создаёшь вместе с ботом. Ты теперь нам как **семья**👨‍👨‍👦‍👦",

  "🗣️ **Твои лимиты обновляются каждый день,всегда тебя ждем**",

  "❗ *Если есть проблемы с ботом или хотите стать **спонсором/реклама**, пишите в* **[Поддержку](https://max.ru/u/f9LHodD0cOK-A0lZdI24jE547UNSp4Gdn57gyHn8TJVc5hh-0NCZiBCjktg)**."
].filter(Boolean);

// userId -> состояние рандомных подсказок
const userRandomNudgeStates = new Map();

function randomInt(min, max) {
  const safeMin = Math.max(1, Math.floor(Number(min) || 1));
  const safeMax = Math.max(safeMin, Math.floor(Number(max) || safeMin));

  return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
}

function getNextRandomNudgeAfter() {
  return randomInt(
    RANDOM_NUDGE_MIN_GENERATIONS,
    RANDOM_NUDGE_MAX_GENERATIONS
  );
}

function getRandomNudgeState(userId) {
  const key = String(userId || "unknown");

  let state = userRandomNudgeStates.get(key);

  if (!state) {
    state = {
      generatedSinceLastNudge: 0,
      nextAfter: getNextRandomNudgeAfter(),
      lastMessageIndex: -1
    };

    userRandomNudgeStates.set(key, state);
  }

  return state;
}

function pickRandomNudgeMessage(state) {
  if (!RANDOM_NUDGE_MESSAGES.length) return "";

  if (RANDOM_NUDGE_MESSAGES.length === 1) {
    state.lastMessageIndex = 0;
    return RANDOM_NUDGE_MESSAGES[0];
  }

  let index = randomInt(0, RANDOM_NUDGE_MESSAGES.length - 1);

  // Чтобы одно и то же сообщение не повторялось два раза подряд
  if (index === state.lastMessageIndex) {
    index = (index + 1) % RANDOM_NUDGE_MESSAGES.length;
  }

  state.lastMessageIndex = index;

  return RANDOM_NUDGE_MESSAGES[index];
}

async function maybeSendRandomNudgeAfterGeneration(target, userId) {
  if (!RANDOM_NUDGE_ENABLED) return false;
  if (!target) return false;
  if (!RANDOM_NUDGE_MESSAGES.length) return false;

  const state = getRandomNudgeState(userId);

  state.generatedSinceLastNudge += 1;

  if (state.generatedSinceLastNudge < state.nextAfter) {
    return false;
  }

  state.generatedSinceLastNudge = 0;
  state.nextAfter = getNextRandomNudgeAfter();

  const message = pickRandomNudgeMessage(state);

  if (!message) return false;

  try {
    await sendMaxMessage(target, message);
    return true;
  } catch (error) {
    console.warn(
      "Failed to send random nudge message:",
      error?.message || error
    );

    return false;
  }
}

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
  return String(userId || "unknown");
}

function getTodayDate() {
  // Формат YYYY-MM-DD
  return new Date().toISOString().slice(0, 10);
}

// Асинхронно получаем лимиты пользователя на сегодня
async function getUserRequestCounts(userId) {
  const key = getUserRequestKey(userId);

  // Fallback на память, если нет БД
  if (!dbPool) {
    if (!userRequestCounts[key]) {
      userRequestCounts[key] = { images: 0, chatgpt: 0, videos: 0 };
    }
    return userRequestCounts[key];
  }

  const today = getTodayDate();

  const result = await dbPool.query(
    `
      SELECT images, chatgpt, videos
      FROM ${LIMITS_TABLE}
      WHERE user_id = $1 AND bot_key = $2 AND date = $3
    `,
    [key, BOT_KEY, today]
  );

  if (!result.rows.length) {
    return { images: 0, chatgpt: 0, videos: 0 };
  }

  const row = result.rows[0];

  return {
    images: Number(row.images) || 0,
    chatgpt: Number(row.chatgpt) || 0,
    videos: Number(row.videos) || 0
  };
}

// Увеличиваем счётчик нужного типа
async function incrementRequestCount(userId, type) {
  const key = getUserRequestKey(userId);

  const allowedTypes = ["images", "chatgpt", "videos"];
  if (!allowedTypes.includes(type)) {
    throw new Error(`Unknown request type for limits: ${type}`);
  }

  // Fallback на память
  if (!dbPool) {
    if (!userRequestCounts[key]) {
      userRequestCounts[key] = { images: 0, chatgpt: 0, videos: 0 };
    }
    if (!Number.isFinite(userRequestCounts[key][type])) {
      userRequestCounts[key][type] = 0;
    }
    userRequestCounts[key][type] += 1;
    return;
  }

  const today = getTodayDate();

  // Динамически подставляем нужную колонку (images/chatgpt/videos)
  const col = type;

  await dbPool.query(
    `
      INSERT INTO ${LIMITS_TABLE} (user_id, bot_key, date, ${col})
      VALUES ($1, $2, $3, 1)
      ON CONFLICT (user_id, bot_key, date)
      DO UPDATE SET ${col} = ${LIMITS_TABLE}.${col} + 1
    `,
    [key, BOT_KEY, today]
  );
}

async function getUserPremiumUntil(userId) {
  if (!dbPool) return null;

  const key = getUserRequestKey(userId);

  const result = await dbPool.query(
    `
      SELECT premium_until
      FROM max_bot_premium_users
      WHERE user_id = $1
        AND bot_key = $2
        AND premium_until > NOW()
      LIMIT 1
    `,
    [key, BOT_KEY]
  );

  return result.rows[0]?.premium_until || null;
}

async function isPremiumUser(userId) {
  return Boolean(await getUserPremiumUntil(userId));
}

async function getUserDailyLimits(userId) {
  const premium = await isPremiumUser(userId);

  return {
    premium,
    images: premium ? PREMIUM_IMAGE_REQUEST_LIMIT : IMAGE_REQUEST_LIMIT,
    chatgpt: premium ? PREMIUM_CHATGPT_REQUEST_LIMIT : CHATGPT_REQUEST_LIMIT,
    videos: premium ? PREMIUM_VIDEO_REQUEST_LIMIT : VIDEO_REQUEST_LIMIT
  };
}
async function getVideoAccessForUser(userId) {
  const counts = await getUserRequestCounts(userId);
  const limits = await getUserDailyLimits(userId);

  const usedPremiumVideos = Number(counts.videos || 0);
  const premiumVideoLimit = Number(limits.videos || 0);

  if (limits.premium && usedPremiumVideos < premiumVideoLimit) {
    return {
      allowed: true,
      source: "premium",
      premium: true,
      usedPremiumVideos,
      premiumVideoLimit,
      premiumVideosLeft: premiumVideoLimit - usedPremiumVideos
    };
  }

  const credits = await getVideoCredits(userId);

  if (credits > 0) {
    return {
      allowed: true,
      source: "credit",
      premium: limits.premium,
      credits
    };
  }

  return {
    allowed: false,
    source: "none",
    premium: limits.premium,
    usedPremiumVideos,
    premiumVideoLimit,
    credits: 0
  };
}

async function getProductCardCredits(userId) {
  if (!dbPool) return 0;

  const key = getUserRequestKey(userId);

  const result = await dbPool.query(
    `
      SELECT credits
      FROM max_bot_product_card_credits
      WHERE user_id = $1 AND bot_key = $2
      LIMIT 1
    `,
    [key, BOT_KEY]
  );

  return Number(result.rows[0]?.credits || 0);
}

async function addProductCardCredit(userId, credits = 1) {
  if (!dbPool) {
    throw new Error("DATABASE_URL is required for product card credits");
  }

  const key = getUserRequestKey(userId);

  const result = await dbPool.query(
    `
      INSERT INTO max_bot_product_card_credits (user_id, bot_key, credits)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, bot_key)
      DO UPDATE SET
        credits = max_bot_product_card_credits.credits + EXCLUDED.credits,
        updated_at = NOW()
      RETURNING credits
    `,
    [key, BOT_KEY, credits]
  );

  return Number(result.rows[0]?.credits || 0);
}

async function consumeProductCardCredit(userId) {
  if (!dbPool) {
    throw new Error("DATABASE_URL is required for product card credits");
  }

  const key = getUserRequestKey(userId);

  const result = await dbPool.query(
    `
      UPDATE max_bot_product_card_credits
      SET credits = credits - 1,
          updated_at = NOW()
      WHERE user_id = $1
        AND bot_key = $2
        AND credits > 0
      RETURNING credits
    `,
    [key, BOT_KEY]
  );

  return {
    consumed: Boolean(result.rows.length),
    creditsLeft: Number(result.rows[0]?.credits || 0)
  };
}

async function getMusicCredits(userId) {
  if (!dbPool) return 0;

  const key = getUserRequestKey(userId);

  const result = await dbPool.query(
    `
      SELECT credits
      FROM max_bot_music_credits
      WHERE user_id = $1 AND bot_key = $2
      LIMIT 1
    `,
    [key, BOT_KEY]
  );

  return Number(result.rows[0]?.credits || 0);
}

async function addMusicCredit(userId, credits = 1) {
  if (!dbPool) {
    throw new Error("DATABASE_URL is required for music credits");
  }

  const key = getUserRequestKey(userId);

  const result = await dbPool.query(
    `
      INSERT INTO max_bot_music_credits (user_id, bot_key, credits)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, bot_key)
      DO UPDATE SET
        credits = max_bot_music_credits.credits + EXCLUDED.credits,
        updated_at = NOW()
      RETURNING credits
    `,
    [key, BOT_KEY, credits]
  );

  return Number(result.rows[0]?.credits || 0);
}

async function consumeMusicCredit(userId) {
  if (!dbPool) {
    throw new Error("DATABASE_URL is required for music credits");
  }

  const key = getUserRequestKey(userId);

  const result = await dbPool.query(
    `
      UPDATE max_bot_music_credits
      SET credits = credits - 1,
          updated_at = NOW()
      WHERE user_id = $1
        AND bot_key = $2
        AND credits > 0
      RETURNING credits
    `,
    [key, BOT_KEY]
  );

  return {
    consumed: Boolean(result.rows.length),
    creditsLeft: Number(result.rows[0]?.credits || 0)
  };
}

async function getVideoCredits(userId) {
  if (!dbPool) return 0;

  const key = getUserRequestKey(userId);

  const result = await dbPool.query(
    `
      SELECT credits
      FROM max_bot_video_credits
      WHERE user_id = $1 AND bot_key = $2
      LIMIT 1
    `,
    [key, BOT_KEY]
  );

  return Number(result.rows[0]?.credits || 0);
}

async function addVideoCredit(userId, credits = 1) {
  if (!dbPool) {
    throw new Error("DATABASE_URL is required for video credits");
  }

  const key = getUserRequestKey(userId);

  const result = await dbPool.query(
    `
      INSERT INTO max_bot_video_credits (user_id, bot_key, credits)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, bot_key)
      DO UPDATE SET
        credits = max_bot_video_credits.credits + EXCLUDED.credits,
        updated_at = NOW()
      RETURNING credits
    `,
    [key, BOT_KEY, credits]
  );

  return Number(result.rows[0]?.credits || 0);
}

async function consumeVideoCredit(userId) {
  if (!dbPool) {
    throw new Error("DATABASE_URL is required for video credits");
  }

  const key = getUserRequestKey(userId);

  const result = await dbPool.query(
    `
      UPDATE max_bot_video_credits
      SET credits = credits - 1,
          updated_at = NOW()
      WHERE user_id = $1
        AND bot_key = $2
        AND credits > 0
      RETURNING credits
    `,
    [key, BOT_KEY]
  );

  return {
    consumed: Boolean(result.rows.length),
    creditsLeft: Number(result.rows[0]?.credits || 0)
  };
}

// Проверяем, достигнут ли лимит по типу
async function isRequestLimitReached(userId, type, limit) {
  const counts = await getUserRequestCounts(userId);
  return (counts[type] || 0) >= limit;
}

function isSubscriptionVerified(userId) {
  return subscriptionVerifiedUsers.has(String(userId));
}

function markSubscriptionVerified(userId) {
  subscriptionVerifiedUsers.add(String(userId));
}

// Проверяем, нужна ли подписка для текущего запроса
async function isSubscriptionRequiredForRequest(userId, type) {
  if (await isPremiumUser(userId)) return false;
  if (isSubscriptionVerified(userId)) return false;

  const counts = await getUserRequestCounts(userId);

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

// Сбрасываем лимиты только для in-memory варианта (когда нет БД)
function resetDailyLimits() {
  setInterval(() => {
    if (!dbPool) {
      Object.keys(userRequestCounts).forEach((key) => {
        userRequestCounts[key] = { images: 0, chatgpt: 0, videos: 0 };
      });
    }
  }, 86400000); // каждый день
}

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1.5";
const OPENAI_IMAGE_SIZE = process.env.OPENAI_IMAGE_SIZE || "1024x1024";
const OPENAI_IMAGE_QUALITY = process.env.OPENAI_IMAGE_QUALITY || "low";
const OPENAI_IMAGE_OUTPUT_FORMAT = process.env.OPENAI_IMAGE_OUTPUT_FORMAT || "png";


const FIRST_IMAGE_MODEL = process.env.FIRST_IMAGE_MODEL || "gpt-image-1.5"; // сюда можно поставить нужную модель
const FIRST_IMAGE_SIZE = process.env.FIRST_IMAGE_SIZE || "1024x1024";
const FIRST_IMAGE_QUALITY = process.env.FIRST_IMAGE_QUALITY || "low";

const PREMIUM_IMAGE_MODEL = process.env.PREMIUM_IMAGE_MODEL || OPENAI_IMAGE_MODEL;
const PREMIUM_IMAGE_SIZE = process.env.PREMIUM_IMAGE_SIZE || OPENAI_IMAGE_SIZE;
const PREMIUM_IMAGE_QUALITY = process.env.PREMIUM_IMAGE_QUALITY || "low";

const PRODUCT_CARD_IMAGE_MODEL =
  process.env.PRODUCT_CARD_IMAGE_MODEL || PREMIUM_IMAGE_MODEL;

const PRODUCT_CARD_IMAGE_SIZE =
  process.env.PRODUCT_CARD_IMAGE_SIZE || OPENAI_IMAGE_SIZE;

const PRODUCT_CARD_IMAGE_QUALITY =
  process.env.PRODUCT_CARD_IMAGE_QUALITY || "high";

const OPENAI_API_BASE = process.env.OPENAI_API_BASE || "https://api.openai.com/v1";
const MAX_API_BASE = process.env.MAX_API_BASE || "https://platform-api.max.ru";
const MAX_WEBHOOK_SECRET = process.env.MAX_WEBHOOK_SECRET || "";
const MAX_ATTACHMENT_RETRIES = Number(process.env.MAX_ATTACHMENT_RETRIES || 5);
const MAX_INPUT_IMAGE_BYTES = Number(process.env.MAX_INPUT_IMAGE_BYTES || 20 * 1024 * 1024);
const STATUS_UPDATE_INTERVAL_MS = Number(process.env.STATUS_UPDATE_INTERVAL_MS || 1500);

if (!MAX_BOT_TOKEN) console.warn("MAX_BOT_TOKEN is not set");
if (!OPENAI_API_KEY) console.warn("OPENAI_API_KEY is not set");
if (!GEMINI_API_KEY) console.warn("GEMINI_API_KEY is not set");
if (!FAL_KEY) console.warn("FAL_KEY is not set");

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
const GEMINI_MUSIC_CONCURRENCY = Number(process.env.GEMINI_MUSIC_CONCURRENCY || 1);
const runMusicGemini = createConcurrencyLimiter(GEMINI_MUSIC_CONCURRENCY);

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
  if (!hasIncomingImage) return false;

  const t = String(userText || "").toLowerCase();

  // ВАЖНО: сюда добавляем "оживи фото ..." чтобы оно всегда запускало ВИДЕО
  return (
    /созда(й|ть)\s*видео/.test(t) ||
    /оживи(ть)?\s*видео/.test(t) ||
    /оживи(ть)?\s*фото/.test(t)
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

async function yookassaRequest(path, options = {}) {
  if (!YOOKASSA_SHOP_ID || !YOOKASSA_SECRET_KEY) {
    throw new Error("YOOKASSA_SHOP_ID or YOOKASSA_SECRET_KEY is not set");
  }

  const url = `${YOOKASSA_API_BASE}${path}`;

  const headers = {
    Authorization: `Basic ${Buffer.from(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`).toString("base64")}`
  };

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (options.idempotenceKey) {
    headers["Idempotence-Key"] = options.idempotenceKey;
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
    throw new Error(`YooKassa API ${response.status}: ${details}`);
  }

  return body;
}

async function createYooKassaPremiumPayment(userId) {
  if (!dbPool) {
    throw new Error("DATABASE_URL is required for premium payments");
  }

  if (!APP_PUBLIC_URL) {
    throw new Error("APP_PUBLIC_URL is not set");
  }

  const key = getUserRequestKey(userId);

  const price = Number(PREMIUM_PRICE_RUB || 199);
  const priceValue = price.toFixed(2);

  const description = "Премиум на месяц";

  const payment = await yookassaRequest("/payments", {
    method: "POST",
    idempotenceKey: crypto.randomUUID(),
    body: {
      amount: {
        value: priceValue,
        currency: "RUB"
      },
      confirmation: {
        type: "redirect",
        return_url: `${APP_PUBLIC_URL}/premium/return?user_id=${encodeURIComponent(key)}`
      },
      capture: true,
      description: `${description} для user ${key}`,
      metadata: {
        user_id: key,
        bot_key: BOT_KEY,
        product: "premium_month",
        type: "premium"
      },
      receipt: {
        customer: {
          email: `user${key}@example.com`
        },
        items: [
          {
            description,
            quantity: "1.00",
            amount: {
              value: priceValue,
              currency: "RUB"
            },
            vat_code: 1,
            payment_mode: "full_payment",
            payment_subject: "service"
          }
        ]
      }
    }
  });

  if (!payment?.id) {
    throw new Error(`YooKassa payment id is missing: ${JSON.stringify(payment)}`);
  }

  await dbPool.query(
    `
      INSERT INTO max_bot_premium_payments (
        payment_id,
        user_id,
        bot_key,
        status,
        amount,
        currency,
        raw
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      ON CONFLICT (payment_id)
      DO UPDATE SET
        status = EXCLUDED.status,
        raw = EXCLUDED.raw,
        updated_at = NOW()
    `,
    [
      String(payment.id),
      key,
      BOT_KEY,
      String(payment.status || "pending"),
      String(payment.amount?.value || priceValue),
      String(payment.amount?.currency || "RUB"),
      JSON.stringify(payment)
    ]
  );

  return payment;
}

async function createYooKassaProductCardPayment(userId) {
  if (!dbPool) {
    throw new Error("DATABASE_URL is required for product card payments");
  }

  if (!APP_PUBLIC_URL) {
    throw new Error("APP_PUBLIC_URL is not set");
  }

  const key = getUserRequestKey(userId);

  const price = Number(PRODUCT_CARD_PRICE_RUB || 79);
  const priceValue = price.toFixed(2);

  const description = "Создание карточки товара";

  const receipt = {
    customer: {
      email: YOOKASSA_RECEIPT_EMAIL || `user${key}@example.com`
    },
    items: [
      {
        description,
        quantity: "1.00",
        amount: {
          value: priceValue,
          currency: "RUB"
        },
        vat_code: YOOKASSA_VAT_CODE,
        payment_mode: "full_payment",
        payment_subject: "service"
      }
    ]
  };

  if (YOOKASSA_TAX_SYSTEM_CODE) {
    receipt.tax_system_code = YOOKASSA_TAX_SYSTEM_CODE;
  }

  const payment = await yookassaRequest("/payments", {
    method: "POST",
    idempotenceKey: crypto.randomUUID(),
    body: {
      amount: {
        value: priceValue,
        currency: "RUB"
      },
      confirmation: {
        type: "redirect",
        return_url: `${APP_PUBLIC_URL}/product-card/return?user_id=${encodeURIComponent(key)}`
      },
      capture: true,
      description: `${description} для user ${key}`,
      metadata: {
        user_id: key,
        bot_key: BOT_KEY,
        product: PRODUCT_CARD_PRODUCT_CODE,
        type: PRODUCT_CARD_PRODUCT_CODE
      },
      receipt
    }
  });

  if (!payment?.id) {
    throw new Error(`YooKassa payment id is missing: ${JSON.stringify(payment)}`);
  }

  await dbPool.query(
    `
      INSERT INTO max_bot_premium_payments (
        payment_id,
        user_id,
        bot_key,
        status,
        amount,
        currency,
        raw
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      ON CONFLICT (payment_id)
      DO UPDATE SET
        status = EXCLUDED.status,
        amount = EXCLUDED.amount,
        currency = EXCLUDED.currency,
        raw = EXCLUDED.raw,
        updated_at = NOW()
    `,
    [
      String(payment.id),
      key,
      BOT_KEY,
      String(payment.status || "pending"),
      String(payment.amount?.value || priceValue),
      String(payment.amount?.currency || "RUB"),
      JSON.stringify(payment)
    ]
  );

  return payment;
}

async function createYooKassaMusicPayment(userId) {
  if (!dbPool) {
    throw new Error("DATABASE_URL is required for music payments");
  }

  if (!APP_PUBLIC_URL) {
    throw new Error("APP_PUBLIC_URL is not set");
  }

  const key = getUserRequestKey(userId);

  const price = Number(MUSIC_PRICE_RUB || 69);
  const priceValue = price.toFixed(2);

  const description = "Создание музыки AI";

  const receipt = {
    customer: {
      email: YOOKASSA_RECEIPT_EMAIL || `user${key}@example.com`
    },
    items: [
      {
        description,
        quantity: "1.00",
        amount: {
          value: priceValue,
          currency: "RUB"
        },
        vat_code: YOOKASSA_VAT_CODE,
        payment_mode: "full_payment",
        payment_subject: "service"
      }
    ]
  };

  if (YOOKASSA_TAX_SYSTEM_CODE) {
    receipt.tax_system_code = YOOKASSA_TAX_SYSTEM_CODE;
  }

  const payment = await yookassaRequest("/payments", {
    method: "POST",
    idempotenceKey: crypto.randomUUID(),
    body: {
      amount: {
        value: priceValue,
        currency: "RUB"
      },
      confirmation: {
        type: "redirect",
        return_url: `${APP_PUBLIC_URL}/music/return?user_id=${encodeURIComponent(key)}`
      },
      capture: true,
      description: `${description} для user ${key}`,
      metadata: {
        user_id: key,
        bot_key: BOT_KEY,
        product: MUSIC_PRODUCT_CODE,
        type: MUSIC_PRODUCT_CODE
      },
      receipt
    }
  });

  if (!payment?.id) {
    throw new Error(`YooKassa payment id is missing: ${JSON.stringify(payment)}`);
  }

  await dbPool.query(
    `
      INSERT INTO max_bot_premium_payments (
        payment_id,
        user_id,
        bot_key,
        status,
        amount,
        currency,
        raw
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      ON CONFLICT (payment_id)
      DO UPDATE SET
        status = EXCLUDED.status,
        amount = EXCLUDED.amount,
        currency = EXCLUDED.currency,
        raw = EXCLUDED.raw,
        updated_at = NOW()
    `,
    [
      String(payment.id),
      key,
      BOT_KEY,
      String(payment.status || "pending"),
      String(payment.amount?.value || priceValue),
      String(payment.amount?.currency || "RUB"),
      JSON.stringify(payment)
    ]
  );

  return payment;
}

async function createYooKassaVideoPayment(userId) {
  if (!dbPool) {
    throw new Error("DATABASE_URL is required for video payments");
  }

  if (!APP_PUBLIC_URL) {
    throw new Error("APP_PUBLIC_URL is not set");
  }

  const key = getUserRequestKey(userId);

  const price = Number(VIDEO_PRICE_RUB || 59);
  const priceValue = price.toFixed(2);

  const description = "Оживление фото AI";

  const receipt = {
    customer: {
      email: YOOKASSA_RECEIPT_EMAIL || `user${key}@example.com`
    },
    items: [
      {
        description,
        quantity: "1.00",
        amount: {
          value: priceValue,
          currency: "RUB"
        },
        vat_code: YOOKASSA_VAT_CODE,
        payment_mode: "full_payment",
        payment_subject: "service"
      }
    ]
  };

  if (YOOKASSA_TAX_SYSTEM_CODE) {
    receipt.tax_system_code = YOOKASSA_TAX_SYSTEM_CODE;
  }

  const payment = await yookassaRequest("/payments", {
    method: "POST",
    idempotenceKey: crypto.randomUUID(),
    body: {
      amount: {
        value: priceValue,
        currency: "RUB"
      },
      confirmation: {
        type: "redirect",
        return_url: `${APP_PUBLIC_URL}/video/return?user_id=${encodeURIComponent(key)}`
      },
      capture: true,
      description: `${description} для user ${key}`,
      metadata: {
        user_id: key,
        bot_key: BOT_KEY,
        product: VIDEO_PRODUCT_CODE,
        type: VIDEO_PRODUCT_CODE
      },
      receipt
    }
  });

  if (!payment?.id) {
    throw new Error(`YooKassa payment id is missing: ${JSON.stringify(payment)}`);
  }

  await dbPool.query(
    `
      INSERT INTO max_bot_premium_payments (
        payment_id,
        user_id,
        bot_key,
        status,
        amount,
        currency,
        raw
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      ON CONFLICT (payment_id)
      DO UPDATE SET
        status = EXCLUDED.status,
        amount = EXCLUDED.amount,
        currency = EXCLUDED.currency,
        raw = EXCLUDED.raw,
        updated_at = NOW()
    `,
    [
      String(payment.id),
      key,
      BOT_KEY,
      String(payment.status || "pending"),
      String(payment.amount?.value || priceValue),
      String(payment.amount?.currency || "RUB"),
      JSON.stringify(payment)
    ]
  );

  return payment;
}

async function getYooKassaPayment(paymentId) {
  return yookassaRequest(`/payments/${encodeURIComponent(paymentId)}`, {
    method: "GET"
  });
}

async function applyPremiumPayment(payment) {
  if (!dbPool) {
    throw new Error("DATABASE_URL is required for premium payments");
  }

  const paymentId = String(payment?.id || "").trim();
  const status = String(payment?.status || "").trim();
  const paid = payment?.paid === true;
  const amountValue = String(payment?.amount?.value || "");
  const currency = String(payment?.amount?.currency || "");
  const metadata = payment?.metadata || {};

  const userId = String(metadata.user_id || "").trim();
  const botKey = String(metadata.bot_key || "").trim();
  const product = String(metadata.product || "").trim();

  if (!paymentId || status !== "succeeded" || !paid) {
    return { granted: false, reason: "payment_not_succeeded" };
  }

  if (!userId || botKey !== BOT_KEY || product !== "premium_month") {
    return { granted: false, reason: "metadata_mismatch" };
  }

  if (currency !== "RUB" || Number(amountValue) < Number(PREMIUM_PRICE_RUB)) {
    return { granted: false, reason: "amount_mismatch" };
  }

  const client = await dbPool.connect();

  try {
    await client.query("BEGIN");

    const existingPayment = await client.query(
      `
        SELECT status
        FROM max_bot_premium_payments
        WHERE payment_id = $1
        FOR UPDATE
      `,
      [paymentId]
    );

    const previousStatus = String(existingPayment.rows[0]?.status || "");

    await client.query(
      `
        INSERT INTO max_bot_premium_payments (
          payment_id,
          user_id,
          bot_key,
          status,
          amount,
          currency,
          raw
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
        ON CONFLICT (payment_id)
        DO UPDATE SET
          status = EXCLUDED.status,
          amount = EXCLUDED.amount,
          currency = EXCLUDED.currency,
          raw = EXCLUDED.raw,
          updated_at = NOW()
      `,
      [
        paymentId,
        userId,
        BOT_KEY,
        status,
        amountValue,
        currency,
        JSON.stringify(payment)
      ]
    );

    if (previousStatus === "succeeded") {
      await client.query("COMMIT");
      return { granted: false, reason: "already_granted", userId };
    }

    const premiumResult = await client.query(
      `
        INSERT INTO max_bot_premium_users (
          user_id,
          bot_key,
          premium_until,
          last_payment_id
        )
        VALUES (
          $1,
          $2,
          NOW() + ($3::int * INTERVAL '1 day'),
          $4
        )
        ON CONFLICT (user_id, bot_key)
        DO UPDATE SET
          premium_until = GREATEST(NOW(), max_bot_premium_users.premium_until) + ($3::int * INTERVAL '1 day'),
          last_payment_id = $4,
          updated_at = NOW()
        RETURNING premium_until
      `,
      [userId, BOT_KEY, PREMIUM_DURATION_DAYS, paymentId]
    );

    await client.query("COMMIT");

    return {
      granted: true,
      userId,
      premiumUntil: premiumResult.rows[0]?.premium_until
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function applyProductCardPayment(payment) {
  if (!dbPool) {
    throw new Error("DATABASE_URL is required for product card payments");
  }

  const paymentId = String(payment?.id || "").trim();
  const status = String(payment?.status || "").trim();
  const paid = payment?.paid === true;
  const amountValue = String(payment?.amount?.value || "");
  const currency = String(payment?.amount?.currency || "");
  const metadata = payment?.metadata || {};

  const userId = String(metadata.user_id || "").trim();
  const botKey = String(metadata.bot_key || "").trim();
  const product = String(metadata.product || "").trim();

  if (!paymentId || status !== "succeeded" || !paid) {
    return { granted: false, reason: "payment_not_succeeded" };
  }

  if (!userId || botKey !== BOT_KEY || product !== PRODUCT_CARD_PRODUCT_CODE) {
    return { granted: false, reason: "metadata_mismatch" };
  }

  if (currency !== "RUB" || Number(amountValue) < Number(PRODUCT_CARD_PRICE_RUB)) {
    return { granted: false, reason: "amount_mismatch" };
  }

  const client = await dbPool.connect();

  try {
    await client.query("BEGIN");

    const existingPayment = await client.query(
      `
        SELECT status
        FROM max_bot_premium_payments
        WHERE payment_id = $1
        FOR UPDATE
      `,
      [paymentId]
    );

    const previousStatus = String(existingPayment.rows[0]?.status || "");

    await client.query(
      `
        INSERT INTO max_bot_premium_payments (
          payment_id,
          user_id,
          bot_key,
          status,
          amount,
          currency,
          raw
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
        ON CONFLICT (payment_id)
        DO UPDATE SET
          status = EXCLUDED.status,
          amount = EXCLUDED.amount,
          currency = EXCLUDED.currency,
          raw = EXCLUDED.raw,
          updated_at = NOW()
      `,
      [
        paymentId,
        userId,
        BOT_KEY,
        status,
        amountValue,
        currency,
        JSON.stringify(payment)
      ]
    );

    if (previousStatus === "succeeded") {
      await client.query("COMMIT");
      return { granted: false, reason: "already_granted", userId };
    }

    const creditResult = await client.query(
      `
        INSERT INTO max_bot_product_card_credits (user_id, bot_key, credits)
        VALUES ($1, $2, 1)
        ON CONFLICT (user_id, bot_key)
        DO UPDATE SET
          credits = max_bot_product_card_credits.credits + 1,
          updated_at = NOW()
        RETURNING credits
      `,
      [userId, BOT_KEY]
    );

    await client.query("COMMIT");

    return {
      granted: true,
      userId,
      credits: Number(creditResult.rows[0]?.credits || 0)
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function applyMusicPayment(payment) {
  if (!dbPool) {
    throw new Error("DATABASE_URL is required for music payments");
  }

  const paymentId = String(payment?.id || "").trim();
  const status = String(payment?.status || "").trim();
  const paid = payment?.paid === true;
  const amountValue = String(payment?.amount?.value || "");
  const currency = String(payment?.amount?.currency || "");
  const metadata = payment?.metadata || {};

  const userId = String(metadata.user_id || "").trim();
  const botKey = String(metadata.bot_key || "").trim();
  const product = String(metadata.product || "").trim();

  if (!paymentId || status !== "succeeded" || !paid) {
    return { granted: false, reason: "payment_not_succeeded" };
  }

  if (!userId || botKey !== BOT_KEY || product !== MUSIC_PRODUCT_CODE) {
    return { granted: false, reason: "metadata_mismatch" };
  }

  if (currency !== "RUB" || Number(amountValue) < Number(MUSIC_PRICE_RUB)) {
    return { granted: false, reason: "amount_mismatch" };
  }

  const client = await dbPool.connect();

  try {
    await client.query("BEGIN");

    const existingPayment = await client.query(
      `
        SELECT status
        FROM max_bot_premium_payments
        WHERE payment_id = $1
        FOR UPDATE
      `,
      [paymentId]
    );

    const previousStatus = String(existingPayment.rows[0]?.status || "");

    await client.query(
      `
        INSERT INTO max_bot_premium_payments (
          payment_id,
          user_id,
          bot_key,
          status,
          amount,
          currency,
          raw
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
        ON CONFLICT (payment_id)
        DO UPDATE SET
          status = EXCLUDED.status,
          amount = EXCLUDED.amount,
          currency = EXCLUDED.currency,
          raw = EXCLUDED.raw,
          updated_at = NOW()
      `,
      [
        paymentId,
        userId,
        BOT_KEY,
        status,
        amountValue,
        currency,
        JSON.stringify(payment)
      ]
    );

    if (previousStatus === "succeeded") {
      await client.query("COMMIT");
      return { granted: false, reason: "already_granted", userId };
    }

    const creditResult = await client.query(
      `
        INSERT INTO max_bot_music_credits (user_id, bot_key, credits)
        VALUES ($1, $2, 1)
        ON CONFLICT (user_id, bot_key)
        DO UPDATE SET
          credits = max_bot_music_credits.credits + 1,
          updated_at = NOW()
        RETURNING credits
      `,
      [userId, BOT_KEY]
    );

    await client.query("COMMIT");

    return {
      granted: true,
      userId,
      credits: Number(creditResult.rows[0]?.credits || 0)
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function applyVideoPayment(payment) {
  if (!dbPool) {
    throw new Error("DATABASE_URL is required for video payments");
  }

  const paymentId = String(payment?.id || "").trim();
  const status = String(payment?.status || "").trim();
  const paid = payment?.paid === true;
  const amountValue = String(payment?.amount?.value || "");
  const currency = String(payment?.amount?.currency || "");
  const metadata = payment?.metadata || {};

  const userId = String(metadata.user_id || "").trim();
  const botKey = String(metadata.bot_key || "").trim();
  const product = String(metadata.product || "").trim();

  if (!paymentId || status !== "succeeded" || !paid) {
    return { granted: false, reason: "payment_not_succeeded" };
  }

  if (!userId || botKey !== BOT_KEY || product !== VIDEO_PRODUCT_CODE) {
    return { granted: false, reason: "metadata_mismatch" };
  }

  if (currency !== "RUB" || Number(amountValue) < Number(VIDEO_PRICE_RUB)) {
    return { granted: false, reason: "amount_mismatch" };
  }

  const client = await dbPool.connect();

  try {
    await client.query("BEGIN");

    const existingPayment = await client.query(
      `
        SELECT status
        FROM max_bot_premium_payments
        WHERE payment_id = $1
        FOR UPDATE
      `,
      [paymentId]
    );

    const previousStatus = String(existingPayment.rows[0]?.status || "");

    await client.query(
      `
        INSERT INTO max_bot_premium_payments (
          payment_id,
          user_id,
          bot_key,
          status,
          amount,
          currency,
          raw
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
        ON CONFLICT (payment_id)
        DO UPDATE SET
          status = EXCLUDED.status,
          amount = EXCLUDED.amount,
          currency = EXCLUDED.currency,
          raw = EXCLUDED.raw,
          updated_at = NOW()
      `,
      [
        paymentId,
        userId,
        BOT_KEY,
        status,
        amountValue,
        currency,
        JSON.stringify(payment)
      ]
    );

    if (previousStatus === "succeeded") {
      await client.query("COMMIT");
      return { granted: false, reason: "already_granted", userId };
    }

    const creditResult = await client.query(
      `
        INSERT INTO max_bot_video_credits (user_id, bot_key, credits)
        VALUES ($1, $2, 1)
        ON CONFLICT (user_id, bot_key)
        DO UPDATE SET
          credits = max_bot_video_credits.credits + 1,
          updated_at = NOW()
        RETURNING credits
      `,
      [userId, BOT_KEY]
    );

    await client.query("COMMIT");

    return {
      granted: true,
      userId,
      credits: Number(creditResult.rows[0]?.credits || 0)
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
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
  const startedAt = Date.now();

  try {
    console.log(
      "sendMaxMessageWithAttachments start:",
      JSON.stringify({
        target,
        textLength: String(text || "").length,
        attachmentsCount: Array.isArray(attachments) ? attachments.length : 0,
        notify: true
      })
    );

    const result = await maxRequest("/messages", {
      method: "POST",
      query: { [target.type]: target.id },
      body: {
        text: text || null,
        attachments,
        notify: true,
        format: "markdown"
      }
    });

    console.log(
      "sendMaxMessageWithAttachments success:",
      JSON.stringify({
        elapsedMs: Date.now() - startedAt,
        target,
        attachmentsCount: Array.isArray(attachments) ? attachments.length : 0
      })
    );

    return result;
  } catch (error) {
    console.error(
      "sendMaxMessageWithAttachments failed:",
      JSON.stringify({
        elapsedMs: Date.now() - startedAt,
        target,
        attachmentsCount: Array.isArray(attachments) ? attachments.length : 0,
        error: error?.message || String(error)
      })
    );

    throw error;
  }
}

function runCallbackTaskInBackground(target, taskName, task) {
  task().catch((error) => {
    console.error(`${taskName} failed:`, error);

    sendMaxMessage(target, safeUserError(error)).catch((sendError) => {
      console.error(`Failed to send ${taskName} error to MAX:`, sendError);
    });
  });
}

async function getVideoExampleMaxToken({ force = false } = {}) {
  if (!VIDEO_EXAMPLE_URL && !cachedVideoExampleToken) {
    return "";
  }

  if (!force && cachedVideoExampleToken) {
    return cachedVideoExampleToken;
  }

  if (!force && videoExampleTokenPromise) {
    return videoExampleTokenPromise;
  }

  videoExampleTokenPromise = (async () => {
    const videoBuffer = await downloadBufferFromUrl(VIDEO_EXAMPLE_URL, "video/");
    const token = await uploadVideoToMaxAndGetToken(videoBuffer);

    cachedVideoExampleToken = token;

    console.log(`VIDEO_EXAMPLE_MAX_TOKEN=${token}`);

    return token;
  })();

  try {
    return await videoExampleTokenPromise;
  } finally {
    videoExampleTokenPromise = null;
  }
}

async function sendMaxVideoToken(target, text, token) {
  const attachments = [
    {
      type: "video",
      payload: { token }
    }
  ];

  const retries = Number(process.env.VIDEO_EXAMPLE_SEND_RETRIES || 4);
  const baseDelayMs = Number(process.env.VIDEO_EXAMPLE_SEND_RETRY_DELAY_MS || 200);

  let lastError;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      await sleep(baseDelayMs * (attempt + 1));
      await sendMaxMessageWithAttachments(target, text || null, attachments);
      return true;
    } catch (error) {
      lastError = error;

      const message = String(error?.message || "");

      if (!/attachment\.not\.ready|not\.processed|not ready/i.test(message)) {
        throw error;
      }
    }
  }

  throw lastError;
}

async function sendMaxVideoTokenWithAttachments(target, text, token, extraAttachments = []) {
  const attachments = [
    {
      type: "video",
      payload: { token }
    },
    ...extraAttachments
  ];

  const retries = Number(process.env.VIDEO_EXAMPLE_SEND_RETRIES || 4);
  const baseDelayMs = Number(process.env.VIDEO_EXAMPLE_SEND_RETRY_DELAY_MS || 200);

  let lastError;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      if (attempt > 0) {
        await sleep(baseDelayMs * attempt);
      }

      await sendMaxMessageWithAttachments(target, text || null, attachments);
      return true;
    } catch (error) {
      lastError = error;

      const message = String(error?.message || "");

      if (!/attachment\.not\.ready|not\.processed|not ready/i.test(message)) {
        throw error;
      }
    }
  }

  throw lastError;
}

async function sendVideoExampleToMax(target) {
  try {
    let token = await getVideoExampleMaxToken();

    if (!token) {
      return false;
    }

    try {
      await sendMaxVideoToken(target, "🎞️ **Пример результата**", token);
      return true;
    } catch (error) {
      console.warn(
        "Cached video example token failed, trying fresh upload:",
        error?.message || error
      );

      if (!VIDEO_EXAMPLE_URL) {
        throw error;
      }

      cachedVideoExampleToken = "";
      token = await getVideoExampleMaxToken({ force: true });

      await sendMaxVideoToken(target, "🎞️ **Пример результата**", token);
      return true;
    }
  } catch (error) {
    console.warn("Failed to send video example:", error?.message || error);
    return false;
  }
}

function buildMainMenuButtons() {
  return [
    [
      {
        type: "callback",
        text: "📸 Создать фото",
        payload: MENU_CREATE_PHOTO_PAYLOAD
      }
    ],
    [
      {
        type: "callback",
        text: "🧩 Реставрация фото",
        payload: MENU_RESTORE_PHOTO_PAYLOAD
      }
    ],
    [
      {
        type: "callback",
        text: "🎬 Оживить фото",
        payload: MENU_CREATE_VIDEO_PAYLOAD
      }
    ],
    [
      {
        type: "callback",
        text: "🛍️ Создать карточку товара WB/Ozon",
        payload: MENU_PRODUCT_CARD_PAYLOAD
      }
    ],
    [
      {
        type: "callback",
        text: "🎵 Создать музыку",
        payload: MENU_CREATE_MUSIC_PAYLOAD
      }
    ],
    [
      {
        type: "callback",
        text: "💵 Отключить лимиты",
        payload: MENU_PREMIUM_PAYLOAD
      }
    ]
  ];
}

async function sendMainMenu(target, prefixText = "") {
  const text =
    prefixText ||
    "Выбери, что хочешь сделать, или пиши прямо в чат✏️.\n\n**🗣️ Совет:** *Попроси в чате написать тебе точный промт для модели Image GPT + опиши свой запрос, а потом создавай фото🔮*";

  const attachments = [
    {
      type: "inline_keyboard",
      payload: {
        buttons: buildMainMenuButtons()
      }
    }
  ];

  return sendMaxMessageWithAttachments(target, text, attachments);
}

function buildBackButtonKeyboard() {
  return [
    [
      {
        type: "callback",
        text: "⬅️ Назад",
        payload: MENU_BACK_PAYLOAD
      }
    ]
  ];
}

async function sendCreatePhotoHelp(target) {
  const text =
    "📸 **Создать фото Бесплатно**\n\n" +
    "Отправь:\n" +
    "• фото + промт (что изменить/добавить)\n" +
    "или\n" +
    "• просто промт с текстом вида: `создай фото/картинку ...`";

  const attachments = [
    {
      type: "inline_keyboard",
      payload: {
        buttons: buildBackButtonKeyboard()
      }
    }
  ];

  return sendMaxMessageWithAttachments(target, text, attachments);
}

async function sendMusicInfo(target, userId) {
  const credits = await getMusicCredits(userId);
  const buyUrl = buildMusicBuyUrl(userId);

  if (credits > 0) {
    setUserImageMode(userId, IMAGE_MODE_MUSIC);

    return sendMaxMessageWithAttachments(
      target,
      [
        "🎵 **Режим создания музыки включён.**",
        "",
        `У вас доступно оплаченных треков: **${credits}**.`,
        "",
        "Теперь отправьте описание музыки.",
        "",
        "Пример:",
        "`Создай 30-секундный энергичный поп-трек для рекламы замороженного йогурта, летнее настроение, мягкий женский вокал, припев, современный бит`",
        "",
        "Лучше писать: жанр, настроение, инструменты, вокал или без вокала, где будет использоваться трек."
      ].join("\n"),
      [
        {
          type: "inline_keyboard",
          payload: {
            buttons: buildBackButtonKeyboard()
          }
        }
      ]
    );
  }

  let text =
    "🎵 **Создать музыку AI**\n\n" +
    `Стоимость: **${Number(MUSIC_PRICE_RUB).toFixed(0)} ₽** за один трек.\n\n` +
    "После оплаты вы получите **1 кредит** и сможете создать **MP3-трек на 30 секунд** через Lyria 3 Clip.\n\n" +
    "Можно сделать:\n" +
    "• музыку для рекламы;\n" +
    "• джингл;\n" +
    "• фон для Reels / Shorts;\n" +
    "• инструментал;\n" +
    "• трек с вокалом и текстом.";

  if (!buyUrl || !YOOKASSA_SHOP_ID || !YOOKASSA_SECRET_KEY || !GEMINI_API_KEY) {
    text += "\n\n⚠️ Оплата или Gemini API пока не настроены. Проверьте APP_PUBLIC_URL, YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY и GEMINI_API_KEY.";
  }

  const buttons = [];

  if (buyUrl && YOOKASSA_SHOP_ID && YOOKASSA_SECRET_KEY && GEMINI_API_KEY) {
    buttons.push([
      {
        type: "link",
        text: `💳 Купить музыку — ${Number(MUSIC_PRICE_RUB).toFixed(0)} ₽`,
        url: buyUrl
      }
    ]);
  }

  buttons.push([
    {
      type: "callback",
      text: "⬅️ Назад к меню",
      payload: MENU_BACK_PAYLOAD
    }
  ]);

  return sendMaxMessageWithAttachments(target, text, [
    {
      type: "inline_keyboard",
      payload: {
        buttons
      }
    }
  ]);
}

async function sendRestorationPhotoHelp(target) {
  const text =
    "🛠️ **Реставрация фото**\n\n" +
    "Режим реставрации включён✅\n\n" +
    "*Теперь просто отправьте старую фотографию.* Можно отправить фото без текста или фото с любым текстом — текст будет проигнорирован.\n\n" +
    "Бот использует только встроенный промт аккуратной реалистичной реставрации.";

  const attachments = [
    {
      type: "inline_keyboard",
      payload: {
        buttons: buildBackButtonKeyboard()
      }
    }
  ];

  return sendMaxMessageWithAttachments(target, text, attachments);
}

async function sendCreateVideoHelp(target, userId) {
  const videoAccess = await getVideoAccessForUser(userId);
  const buyUrl = buildVideoBuyUrl(userId);

  if (videoAccess.allowed) {
    setUserImageMode(userId, IMAGE_MODE_VIDEO);

    const accessText =
      videoAccess.source === "premium"
        ? `У вас доступно Premium-видео сегодня: **${videoAccess.premiumVideosLeft}**.`
        : `У вас доступно оплаченных видео: **${videoAccess.credits}**.`;

    return sendMaxMessageWithAttachments(
      target,
      [
        "🎬 **Режим оживления фото✅**",
        "",
        accessText,
        "",
        "Теперь просто отправьте **фото человека**.",
        "",
        "Любой текст в сообщении будет проигнорирован — бот использует встроенный промт:",
        "человек слегка улыбается, смотрит в камеру и мягко машет рукой.",
        "",
        "Видео будет создано через **Seedance Lite**, длительность **5 секунд**, качество **1080p**."
      ].join("\n"),
      [
        {
          type: "inline_keyboard",
          payload: {
            buttons: buildBackButtonKeyboard()
          }
        }
      ]
    );
  }

  let text =
    "🎬 **Оживить фото**\n\n" +
    `Стоимость: **${Number(VIDEO_PRICE_RUB).toFixed(0)} ₽** за одно видео.\n\n` +
    "Что получится:\n" +
    "• человек сохранит лицо и внешность;\n" +
    "• слегка улыбнётся;\n" +
    "• будет смотреть в камеру;\n" +
    "• мягко помашет рукой, если это возможно по фото.\n\n";

  if (videoAccess.premium) {
    text +=
      "Ваше **Premium-видео на сегодня уже использовано**.\n" +
      "Чтобы сделать ещё одно видео сегодня, можно купить отдельный видео-кредит.\n\n";
  } else {
    text +=
      "После оплаты вы получите **1 видео-кредит**. Затем просто отправьте фото — текст будет проигнорирован.\n\n";
  }

  if (!buyUrl || !YOOKASSA_SHOP_ID || !YOOKASSA_SECRET_KEY || !FAL_KEY) {
    text += "⚠️ Оплата или FAL пока не настроены. Проверьте APP_PUBLIC_URL, YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY и FAL_KEY.";
  }

  const buttons = [];

  if (buyUrl && YOOKASSA_SHOP_ID && YOOKASSA_SECRET_KEY && FAL_KEY) {
    buttons.push([
      {
        type: "link",
        text: `💳 Купить видео — ${Number(VIDEO_PRICE_RUB).toFixed(0)} ₽`,
        url: buyUrl
      }
    ]);
  }

  buttons.push([
    {
      type: "callback",
      text: "⬅️ Назад к меню",
      payload: MENU_BACK_PAYLOAD
    }
  ]);

  const keyboardAttachment = {
    type: "inline_keyboard",
    payload: {
      buttons
    }
  };

  const token = await getVideoExampleMaxToken().catch((error) => {
    console.warn("Video example token failed:", error?.message || error);
    return "";
  });

  if (token) {
    return sendMaxVideoTokenWithAttachments(target, text, token, [
      keyboardAttachment
    ]);
  }

  return sendMaxMessageWithAttachments(target, text, [
    keyboardAttachment
  ]);
}

function isMusicMode(userId) {
  return getUserImageMode(userId) === IMAGE_MODE_MUSIC;
}

function buildPremiumBuyUrl(userId) {
  if (!APP_PUBLIC_URL) return "";

  const url = new URL(`${APP_PUBLIC_URL}/premium/buy`);
  url.searchParams.set("user_id", String(userId || ""));

  return url.toString();
}

function buildProductCardBuyUrl(userId) {
  if (!APP_PUBLIC_URL) return "";

  const url = new URL(`${APP_PUBLIC_URL}/product-card/buy`);
  url.searchParams.set("user_id", String(userId || ""));

  return url.toString();
}

function buildMusicBuyUrl(userId) {
  if (!APP_PUBLIC_URL) return "";

  const url = new URL(`${APP_PUBLIC_URL}/music/buy`);
  url.searchParams.set("user_id", String(userId || ""));

  return url.toString();
}

async function sendPremiumInfo(target, userId) {
  const premiumUntil = await getUserPremiumUntil(userId);
  const buyUrl = buildPremiumBuyUrl(userId);

  let text =
    "💸 **Отключить лимиты**\n\n" +
    "*Что дает Премиум?*\n\n" +
    "**1️⃣ Вы получите 10 фото в день с лучшей моделью.**\n" +
    "**2️⃣ Вместо ChatGPT 8 запросов — 16 запросов в день.**\n" +
    "**3️⃣ Уйдет обязательная подписка на каналы.**\n" +
    "**4️⃣ 1 оживление фото в день бесплатно.**\n\n" +
    "Вы становитесь **Спонсором Бота** и членом нашей семьи.\n\n" +
    "💳 Стоимость: *199 ₽ за 30 дней*.";

  if (premiumUntil) {
    text += `\n\n✅ Premium уже активен до: ${new Date(premiumUntil).toLocaleString("ru-RU")}`;
  }

  if (!buyUrl || !YOOKASSA_SHOP_ID || !YOOKASSA_SECRET_KEY) {
    text += "\n\n⚠️ Оплата пока не настроена. Проверьте APP_PUBLIC_URL, YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY.";
  }

  const buttons = [];

  if (buyUrl && YOOKASSA_SHOP_ID && YOOKASSA_SECRET_KEY) {
    buttons.push([
      {
        type: "link",
        text: "💳 Купить Премиум — 199 ₽",
        url: buyUrl
      }
    ]);
  }

  buttons.push([
    {
      type: "callback",
      text: "⬅️ Назад к меню",
      payload: MENU_BACK_PAYLOAD
    }
  ]);

  return sendMaxMessageWithAttachments(target, text, [
    {
      type: "inline_keyboard",
      payload: {
        buttons
      }
    }
  ]);
}

async function sendProductCardInfo(target, userId) {
  const credits = await getProductCardCredits(userId);
  const buyUrl = buildProductCardBuyUrl(userId);

  if (credits > 0) {
    setUserImageMode(userId, IMAGE_MODE_PRODUCT_CARD);

    return sendMaxMessageWithAttachments(
      target,
      [
        "🛒 **Режим карточки товара включён.**",
        "",
        `У вас доступно оплаченных пакетов: **${credits}**.`,
        "",
        "Теперь отправьте:",
        "• **фото товара + промт** — лучший вариант для точности;",
        "или",
        "• **просто промт товара** — если фото нет.",
        "",
        "Бот создаст **3 красивые карточки товара с разных ракурсов**.",
        "",
        "Пример промта:",
        "`Банка крема Nuvelora, премиальный бело-золотой дизайн, для маркетплейса, чистый фон, дорогой свет, надпись Nuvelora Anti-Age Cream`"
      ].join("\n"),
      [
        {
          type: "inline_keyboard",
          payload: {
            buttons: buildBackButtonKeyboard()
          }
        }
      ]
    );
  }

  let text =
    "🛒 **Создать карточку товара**\n\n" +
    "Стоимость: **79 ₽** за один пакет.\n\n" +
    "После оплаты вы сможете отправить **фото товара + промт** или просто **описание товара**.\n\n" +
    "Бот создаст **3 изображения товара**:\n" +
    "• фронтальная карточка;\n" +
    "• ракурс 3/4;\n" +
    "• lifestyle / премиальная витрина.\n\n" +
    "Для максимально точных надписей лучше отправлять фото товара, где текст уже есть на упаковке.";

  if (!buyUrl || !YOOKASSA_SHOP_ID || !YOOKASSA_SECRET_KEY) {
    text += "\n\n⚠️ Оплата пока не настроена. Проверьте APP_PUBLIC_URL, YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY.";
  }

  const buttons = [];

  if (buyUrl && YOOKASSA_SHOP_ID && YOOKASSA_SECRET_KEY) {
    buttons.push([
      {
        type: "link",
        text: "💳 Купить за 79 ₽",
        url: buyUrl
      }
    ]);
  }

  buttons.push([
    {
      type: "callback",
      text: "⬅️ Назад к меню",
      payload: MENU_BACK_PAYLOAD
    }
  ]);

  return sendMaxMessageWithAttachments(target, text, [
    {
      type: "inline_keyboard",
      payload: {
        buttons
      }
    }
  ]);
}

async function sendSubscriptionPrompt(target, userId, prefixText = "") {
  const text =
    `${prefixText ? `${prefixText}\n\n` : ""}` +
    "🔒 **Чтобы продолжить пользоваться ботом бесплатно НАВСЕГДА, подпишитесь на ОБЯЗАТЕЛЬНЫЕ каналы внизу👇 и нажмите кнопку Я подписан(а)**.";

  // userId кладём в payload, чтобы по нему потом проверять
  const checkPayload = `${SUBSCRIPTION_CHECK_PAYLOAD}:${userId}`;

  // Генерация кнопок с индикаторами подписки для каждого канала
  const subscribeButtons = await Promise.all(
    REQUIRED_CHANNELS.map(async (channel, index) => {
      const isSubscribed = await checkSingleRequiredChannelSubscription(userId, channel);

      return [
        {
          type: "link",
          text: `${isSubscribed ? "✅" : "❌"} Подписаться на ${channel.title || `канал ${index + 1}`}`,
          url: channel.url
        }
      ];
    })
  );

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
      "Не удалось отправить кнопки подписки, отправляем текст:",
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

  if (Array.isArray(body)) {
    return body;
  }

  const candidates = [
    body.members,
    body.items,
    body.users,
    body.subscribers,
    body.chat_members,
    body.chatMembers,
    body.memberships,

    body.data,
    body.result,

    body.result?.members,
    body.result?.items,
    body.result?.users,
    body.result?.subscribers,
    body.result?.chat_members,
    body.result?.chatMembers,
    body.result?.memberships,

    body.payload?.members,
    body.payload?.items,
    body.payload?.users,
    body.payload?.subscribers,
    body.payload?.memberships,

    body.response?.members,
    body.response?.items,
    body.response?.users,
    body.response?.subscribers,
    body.response?.memberships
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;

    if (Array.isArray(candidate)) {
      return candidate;
    }

    if (typeof candidate === "object") {
      // Если это одиночный участник
      if (getMemberUserId(candidate)) {
        return [candidate];
      }

      const values = Object.values(candidate);

      if (values.some((v) => getMemberUserId(v))) {
        return values;
      }

      const firstArray = values.find(Array.isArray);
      if (firstArray) return firstArray;
    }
  }

  if (typeof body === "object") {
    if (getMemberUserId(body)) {
      return [body];
    }

    for (const value of Object.values(body)) {
      if (Array.isArray(value)) {
        return value;
      }

      if (value && typeof value === "object" && getMemberUserId(value)) {
        return [value];
      }
    }
  }

  return [];
}

function getMemberUserId(member) {
  // Если элемент — просто число или строка, считаем, что это user_id
  if (typeof member === "string" || typeof member === "number") {
    return String(member);
  }

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

  // Если это примитив (строка/число) — считаем, что это активный user_id
  if (typeof member === "string" || typeof member === "number") {
    return true;
  }

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

  // Если API вернул сразу одного участника
  const rootUserId = String(getMemberUserId(body) || "");
  if (rootUserId === expectedUserId && isMemberActive(body)) {
    return true;
  }

  const members = extractMembersFromMaxResponse(body);

  for (const member of members) {
    const memberUserId = String(getMemberUserId(member) || "");

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
  const expectedUserId = String(userId).trim();

  const path = `/chats/${channelId}/members`;

  try {
    // 1. Сначала пробуем проверить конкретного пользователя.
    // Если MAX поддерживает фильтр user_ids/user_id — это самый правильный вариант.
    const directQueries = [
      { user_ids: expectedUserId },
      { user_id: expectedUserId },
      { count: 100, user_ids: expectedUserId },
      { count: 100, user_id: expectedUserId }
    ];

    for (const query of directQueries) {
      try {
        console.log(
          "Outgoing DIRECT subscription check:",
          JSON.stringify({
            method: "GET",
            path,
            query,
            expectedUserId,
            requiredChannelId: requiredChannel.id
          })
        );

        const directResult = await maxRequest(path, {
          method: "GET",
          query
        });

        const members = extractMembersFromMaxResponse(directResult);

        console.log(
          "DIRECT subscription check response:",
          JSON.stringify({
            channelId: requiredChannel.id,
            expectedUserId,
            membersCount: members.length,
            sampleIds: members.slice(0, 10).map((m) => String(getMemberUserId(m) || ""))
          })
        );

        if (responseContainsActiveUser(directResult, expectedUserId)) {
          console.log(
            `Subscription check result for user ${expectedUserId}, channel ${requiredChannel.id}: true by direct query`
          );
          return true;
        }
      } catch (directError) {
        console.warn(
          `Direct subscription query failed for user ${expectedUserId}, channel ${requiredChannel.id}:`,
          directError?.message || directError
        );
      }
    }

    // 2. Fallback: листаем участников.
    // ВАЖНО: 20 страниц мало. Увеличиваем.
    let marker = "";
    let page = 0;

    const maxPages = Number(process.env.SUBSCRIPTION_MAX_PAGES || 500);
    const pageSize = Number(process.env.SUBSCRIPTION_PAGE_SIZE || 100);

    const seenMarkers = new Set();

    while (page < maxPages) {
      page += 1;

      const query = {
        count: pageSize
      };

      if (marker) {
        query.marker = marker;
      }

      console.log(
        "Outgoing subscription check:",
        JSON.stringify({
          method: "GET",
          path,
          query,
          expectedUserId,
          requiredChannelId: requiredChannel.id,
          page
        })
      );

      const result = await maxRequest(path, {
        method: "GET",
        query
      });

      const members = extractMembersFromMaxResponse(result);

      console.log(
        "Subscription check page response:",
        JSON.stringify({
          page,
          channelId: requiredChannel.id,
          expectedUserId,
          membersCount: members.length,
          sampleIds: members.slice(0, 10).map((m) => String(getMemberUserId(m) || ""))
        })
      );

      if (responseContainsActiveUser(result, expectedUserId)) {
        console.log(
          `Subscription check result for user ${expectedUserId}, channel ${requiredChannel.id}: true`
        );
        return true;
      }

      const nextMarker = getNextMembersMarker(result);

      if (!nextMarker) {
        break;
      }

      if (nextMarker === marker || seenMarkers.has(nextMarker)) {
        console.warn(
          `Subscription pagination loop detected for channel ${requiredChannel.id}, marker=${nextMarker}`
        );
        break;
      }

      seenMarkers.add(nextMarker);
      marker = nextMarker;
    }

    console.log(
      `Subscription check result for user ${expectedUserId}, channel ${requiredChannel.id}: false after ${page} pages`
    );

    return false;
  } catch (error) {
    const message = String(error?.message || error);

    console.warn(
      `Subscription check failed for user ${expectedUserId}, channel ${requiredChannel.id}:`,
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
const LIMITS_TABLE = "max_bot_limits";
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
            "Ты полезный ассистент внутри мессенджера MAX. Отвечай кратко, ясно и по делу. Если вопрос требует пошагового ответа, структурируй ответ простыми абзацами. Используй смайлики в ответах"
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

function buildImageJsonBody(prompt, options = {}) {
  const model = options.model || OPENAI_IMAGE_MODEL;
  const size = options.size || OPENAI_IMAGE_SIZE;
  const quality = options.quality || OPENAI_IMAGE_QUALITY;
  const outputFormat = options.output_format || OPENAI_IMAGE_OUTPUT_FORMAT;

  const body = {
    model,
    prompt,
    n: 1,
    size,
    quality,
    output_format: outputFormat
  };

  if (model.startsWith("dall-e")) {
    body.response_format = "b64_json";
  }

  return body;
}

async function generateOpenAIImage(prompt, options = {}) {
  const response = await fetch(`${OPENAI_API_BASE}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify(buildImageJsonBody(prompt, options))
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


async function editOpenAIImage(prompt, inputImage, options = {}) {
  const form = new FormData();

  const model = options.model || OPENAI_IMAGE_MODEL;
  const size = options.size || OPENAI_IMAGE_SIZE;
  const quality = options.quality || OPENAI_IMAGE_QUALITY;
  const outputFormat = options.output_format || OPENAI_IMAGE_OUTPUT_FORMAT;

  form.append("model", model);
  form.append("prompt", prompt);
  form.append("size", size);
  form.append("quality", quality);
  form.append("output_format", outputFormat);

  if (model.startsWith("dall-e")) {
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

  const attachments = [
    { type: "image", payload },
    {
      type: "inline_keyboard",
      payload: {
        buttons: buildBackButtonKeyboard()
      }
    }
  ];

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

function getGeminiBlockReason(data) {
  return String(
    data?.promptFeedback?.blockReason ||
    data?.prompt_feedback?.block_reason ||
    ""
  ).trim();
}

class GeminiPromptBlockedError extends Error {
  constructor(blockReason, data) {
    super(`Gemini prompt blocked: ${blockReason}`);
    this.name = "GeminiPromptBlockedError";
    this.code = "GEMINI_PROMPT_BLOCKED";
    this.blockReason = blockReason;
    this.data = data;
    this.userMessage = [
      "⚠️ **Lyria не смогла создать музыку по этому описанию.**",
      "",
      `Причина: промт заблокирован фильтром Gemini: **${blockReason}**.`,
      "",
      "Кредит не списан. Отправьте описание заново.",
      "",
      "Лучше писать так:",
      "• жанр: поп, электроника, рок, джаз, lo-fi;",
      "• настроение: энергично, спокойно, премиально, летне;",
      "• инструменты: гитара, пианино, синтезатор, барабаны;",
      "• вокал: без вокала / мягкий женский вокал / мужской вокал;",
      "• не просите стиль конкретного артиста, существующую песню или узнаваемую мелодию.",
      "",
      "Пример:",
      "`30-секундный энергичный поп-трек для рекламы кафе, летнее настроение, гитара, лёгкий вокал, современный бит`"
    ].join("\n");
  }
}

function extractGeminiMusicResult(data) {
  const blockReason = getGeminiBlockReason(data);

  if (blockReason) {
    throw new GeminiPromptBlockedError(blockReason, data);
  }

  const candidate = data?.candidates?.[0];

  if (!candidate) {
    throw new Error(
      `Gemini Lyria returned no candidates: ${JSON.stringify(data).slice(0, 1200)}`
    );
  }

  const finishReason = String(
    candidate?.finishReason ||
    candidate?.finish_reason ||
    ""
  ).trim();

  if (/SAFETY|PROHIBITED_CONTENT|BLOCKLIST|IMAGE_SAFETY/i.test(finishReason)) {
    throw new GeminiPromptBlockedError(finishReason, data);
  }

  const parts = candidate?.content?.parts || [];

  let audioBase64 = "";
  let mimeType = "audio/mpeg";
  const textParts = [];

  for (const part of parts) {
    if (typeof part?.text === "string" && part.text.trim()) {
      textParts.push(part.text.trim());
    }

    const inlineData = part?.inlineData || part?.inline_data;

    if (inlineData?.data) {
      audioBase64 = String(inlineData.data);
      mimeType = String(
        inlineData.mimeType ||
        inlineData.mime_type ||
        "audio/mpeg"
      );
    }
  }

  if (!audioBase64) {
    throw new Error(
      [
        "Gemini Lyria returned candidates but no audio.",
        `finishReason=${finishReason || "none"}`,
        `text=${textParts.join("\n").slice(0, 500)}`,
        `response=${JSON.stringify(data).slice(0, 1200)}`
      ].join(" ")
    );
  }

  return {
    audioBuffer: Buffer.from(audioBase64, "base64"),
    mimeType,
    text: textParts.join("\n").trim()
  };
}

async function generateGeminiMusic(prompt) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  const cleanPrompt = String(prompt || "").trim();

  if (!cleanPrompt) {
    throw new Error("Music prompt is empty");
  }

  const finalPrompt = [
    "Create a 30-second original music track.",
    "The result must be original AI-generated music.",
    "Do not imitate any specific real artist, band, copyrighted song, soundtrack, jingle, or recognizable melody.",
    "Do not include hateful, explicit, dangerous, or illegal themes.",
    "Use generic musical descriptors only: genre, mood, tempo, instruments, vocals, arrangement, and intended use.",
    "",
    "User music brief:",
    cleanPrompt
  ].join("\n");

  const response = await fetch(
    `${GEMINI_API_BASE}/models/${encodeURIComponent(GEMINI_LYRIA_MODEL)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: finalPrompt
              }
            ]
          }
        ]
      })
    }
  );

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(`Gemini Lyria API ${response.status}: ${JSON.stringify(data)}`);
  }

  return extractGeminiMusicResult(data);
}

function makeDataUriFromImage(inputImage) {
  const mime = inputImage?.mime || "image/png";
  const base64 = inputImage?.buffer?.toString("base64");

  if (!base64) {
    throw new Error("Input image buffer is empty");
  }

  return `data:${mime};base64,${base64}`;
}

async function falRequest(url, options = {}) {
  if (!FAL_KEY) {
    throw new Error("FAL_KEY is not set");
  }

  const headers = {
    Authorization: `Key ${FAL_KEY}`
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
    throw new Error(`FAL API ${response.status}: ${details}`);
  }

  return body;
}

function extractFalVideoUrl(data) {
  return String(
    data?.video?.url ||
    data?.data?.video?.url ||
    data?.result?.video?.url ||
    ""
  ).trim();
}

async function downloadBufferFromUrl(url, expectedPrefix = "") {
  const response = await fetch(url, {
    method: "GET"
  });

  if (!response.ok) {
    throw new Error(`File download failed ${response.status}: ${await response.text().catch(() => "")}`);
  }

  const mime = String(response.headers.get("content-type") || "").toLowerCase();

  if (expectedPrefix && mime && !mime.startsWith(expectedPrefix)) {
    console.warn(`Downloaded file has unexpected mime type: ${mime}`);
  }

  const arrayBuffer = await response.arrayBuffer();

  return Buffer.from(arrayBuffer);
}

async function makeVideoFromFalSeedance({ inputImage }) {
  const imageUrl = await uploadImageToFalCdn(inputImage);

  const submitResult = await falRequest(FAL_SEEDANCE_IMAGE_TO_VIDEO_URL, {
    method: "POST",
    body: {
      prompt: VIDEO_ANIMATE_PHOTO_PROMPT,
      image_url: imageUrl,
      duration: "5",
      resolution: "480p",
      aspect_ratio: "auto",
      camera_fixed: true,
      enable_safety_checker: true
    }
  });

  let videoUrl = extractFalVideoUrl(submitResult);

  if (!videoUrl) {
    const statusUrl = String(submitResult?.status_url || "").trim();
    const responseUrl = String(submitResult?.response_url || "").trim();

    if (!statusUrl || !responseUrl) {
      throw new Error(`FAL queue response missing status_url/response_url: ${JSON.stringify(submitResult)}`);
    }

    const startedAt = Date.now();

    while (Date.now() - startedAt < FAL_QUEUE_TIMEOUT_MS) {
      await sleep(FAL_QUEUE_POLL_INTERVAL_MS);

      const statusResult = await falRequest(statusUrl, {
        method: "GET"
      });

      const status = String(statusResult?.status || "").toUpperCase();

      if (["COMPLETED", "COMPLETE", "DONE", "SUCCEEDED"].includes(status)) {
        const result = await falRequest(responseUrl, {
          method: "GET"
        });

        videoUrl = extractFalVideoUrl(result);

        if (!videoUrl) {
          throw new Error(`FAL result has no video.url: ${JSON.stringify(result).slice(0, 1200)}`);
        }

        break;
      }

      if (["FAILED", "ERROR", "CANCELLED", "CANCELED"].includes(status)) {
        throw new Error(`FAL generation failed: ${JSON.stringify(statusResult).slice(0, 1200)}`);
      }
    }
  }

  if (!videoUrl) {
    throw new Error("FAL video generation timeout");
  }

  return downloadBufferFromUrl(videoUrl, "video/");
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

function isVideoMode(userId) {
  return getUserImageMode(userId) === IMAGE_MODE_VIDEO;
}

function buildVideoBuyUrl(userId) {
  if (!APP_PUBLIC_URL) return "";

  const url = new URL(`${APP_PUBLIC_URL}/video/buy`);
  url.searchParams.set("user_id", String(userId || ""));

  return url.toString();
}

async function sendMaxVideo(target, text, videoBuffer) {
  const token = await uploadVideoToMaxAndGetToken(videoBuffer);

  const attachments = [
    { type: "video", payload: { token } },
    {
      type: "inline_keyboard",
      payload: {
        buttons: buildBackButtonKeyboard()
      }
    }
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

function extensionFromAudioMime(mime) {
  const value = String(mime || "").toLowerCase();

  if (value.includes("wav")) return "wav";
  if (value.includes("m4a")) return "m4a";
  if (value.includes("ogg")) return "ogg";

  return "mp3";
}

async function uploadAudioToMaxAndGetToken(audioBuffer, mime = "audio/mpeg") {
  if (!audioBuffer || !audioBuffer.length) {
    throw new Error("Audio buffer is empty");
  }

  const uploadInfo = await maxRequest("/uploads", {
    method: "POST",
    query: { type: "audio" }
  });

  const uploadUrl = uploadInfo?.url || uploadInfo?.upload_url;

  if (!uploadUrl) {
    throw new Error(`MAX /uploads(type=audio) returned no url: ${JSON.stringify(uploadInfo)}`);
  }

  let token = uploadInfo?.token;

  const ext = extensionFromAudioMime(mime);
  const form = new FormData();

  form.append(
    "data",
    new Blob([audioBuffer], { type: mime || "audio/mpeg" }),
    `lyria-music.${ext}`
  );

  const resp = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: MAX_BOT_TOKEN
    },
    body: form
  });

  const bodyText = await resp.text();

  if (!resp.ok) {
    throw new Error(`MAX audio upload step2 failed ${resp.status}: ${bodyText?.slice(0, 500)}`);
  }

  if (!token) {
    try {
      const json = JSON.parse(bodyText);
      token = json?.token || json?.retval;
    } catch {}

    if (!token) {
      const m = String(bodyText || "").match(/<retval>\s*([\s\S]*?)\s*<\/retval>/i);
      if (m?.[1]) token = m[1];
    }
  }

  if (!token) {
    throw new Error(
      `MAX audio upload no token. step1=${JSON.stringify(uploadInfo)} step2=${bodyText}`
    );
  }

  return String(token).trim();
}

async function sendMaxAudio(target, text, audioBuffer, mime = "audio/mpeg") {
  const token = await uploadAudioToMaxAndGetToken(audioBuffer, mime);

  const attachments = [
    {
      type: "audio",
      payload: { token }
    },
    {
      type: "inline_keyboard",
      payload: {
        buttons: buildBackButtonKeyboard()
      }
    }
  ];

  const retries = Number(process.env.AUDIO_SEND_RETRIES || 5);
  const baseDelayMs = Number(process.env.AUDIO_SEND_RETRY_DELAY_MS || 1200);

  let lastError;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      await sleep(baseDelayMs * (attempt + 1));
      await sendMaxMessageWithAttachments(target, text || null, attachments);
      return;
    } catch (error) {
      lastError = error;
      const message = String(error?.message || "");

      if (!/attachment\.not\.ready|not\.processed|not ready/i.test(message)) {
        throw error;
      }
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
  if (error?.userMessage) {
    return error.userMessage;
  }

  const message = String(error?.message || error || "Unknown error");

  // Сначала FAL / Seedance, чтобы ошибки видео не попадали в блок Gemini
  if (/FAL|fal|Seedance|queue\.fal|safety_checker|video\.url|FAL API|fal\.ai/i.test(message)) {
    return [
      "🎬 Не получилось создать видео через FAL Seedance.",
      "",
      "Возможные причины:",
      "• не задан или неверный FAL_KEY;",
      "• закончился баланс FAL;",
      "• нет доступа к модели Seedance;",
      "• фото не подошло для image-to-video;",
      "• модель заблокировала фото фильтром безопасности;",
      "• временная ошибка очереди FAL.",
      "",
      "Кредит лучше проверить вручную в базе, потому что он списывается только после успешной отправки видео."
    ].join("\n");
  }

  // Отдельно Gemini / Lyria safety
  if (/Gemini|Lyria|generativelanguage|PROHIBITED_CONTENT|promptFeedback|blockReason|prompt blocked|SAFETY|BLOCKLIST|IMAGE_SAFETY/i.test(message)) {
    return [
      "⚠️ Запрос был заблокирован фильтром безопасности Gemini/Lyria.",
      "",
      "Кредит не списан. Попробуйте переформулировать описание без реальных артистов, существующих песен, узнаваемых мелодий и спорных тем.",
      "",
      "Пример:",
      "`30-секундный энергичный поп-трек, летнее настроение, гитара, лёгкий вокал, современный рекламный бит`"
    ].join("\n");
  }

  if (/content_policy|moderation/i.test(message)) {
    return "📲 Не получилось создать изображение: запрос не прошёл проверку безопасности. Попробуйте изменить описание.";
  }

  if (/OpenAI/i.test(message)) {
    return "Не получилось получить ответ от OpenAI. Проверьте модель, ключ API и лимиты аккаунта.";
  }

  if (/MAX/i.test(message)) {
    return "Не получилось отправить ответ в MAX. Проверьте токен, webhook и права бота.";
  }

  return "Произошла ошибка при обработке запроса.";
}

const PRODUCT_CARD_ANGLES = [
  {
    title: "Главная карточка",
    instruction:
      "exact same product from the reference image, front-facing packshot, centered, pure clean marketplace background, premium studio lighting, preserve packaging exactly"
  },
  {
    title: "Карточка 3/4",
    instruction:
      "exact same product from the reference image, slight three-quarter view if possible, clean premium background, preserve packaging exactly, commercial product photography"
  },
  {
    title: "Премиальная подача",
    instruction:
      "exact same product from the reference image, elegant commercial composition, minimal premium props, preserve packaging exactly, luxury advertising look"
  }
];

function buildProductCardPrompt(userText, angleIndex, hasInputImage) {
  const angle = PRODUCT_CARD_ANGLES[angleIndex] || PRODUCT_CARD_ANGLES[0];

  if (hasInputImage) {
    return `
Создай профессиональную карточку товара для маркетплейса.

ВАЖНО: используй входное фото как точный исходник товара.
Нужно сохранить именно тот товар, который изображён на фото.
Не заменяй его другим товаром.

Тип карточки:
${angle.title}

Пожелания пользователя:
${String(userText || "").trim()}

Обязательные требования:
- сохранить товар максимально точно;
- сохранить форму упаковки;
- сохранить цвет упаковки;
- сохранить крышку, банку, флакон или тюбик без замены;
- сохранить логотип;
- сохранить название бренда;
- сохранить весь читаемый текст максимально близко к оригиналу;
- сохранить расположение надписей и элементов дизайна;
- не создавать новый продукт;
- не менять бренд;
- не выдумывать новый текст;
- не делать другую банку вместо исходной.

Можно менять только:
- фон;
- свет;
- композицию;
- тени;
- общую рекламную подачу.

Техническое направление:
${angle.instruction}

Результат:
- дорогая, чистая, продающая карточка товара;
- товар в центре внимания;
- профессиональная коммерческая подача;
- без интерфейса;
- без коллажей;
- без посторонних объектов, если они не нужны.
`.trim();
  }

  return `
Создай профессиональную карточку товара для маркетплейса.

Описание товара:
${String(userText || "").trim()}

Тип карточки:
${angle.title}

Техническое направление:
${angle.instruction}

Требования:
- дорогой коммерческий вид;
- чистая композиция;
- профессиональный студийный свет;
- товар главный объект;
- без лишних брендов и водяных знаков.

Результат:
одно готовое изображение карточки товара.
`.trim();
}

async function handleImageRequest(update, target, userText, incomingImageUrl, userId = target.id, captionOverride = "") {
  const prompt = String(userText || "").trim();

  if (!prompt) {
    await sendMaxMessage(
      target,
      "Пришлите описание изображения. Например: создай фото кота в космосе, кинематографичный стиль."
    );
    return;
  }

  // Берём текущие лимиты пользователя из БД (или памяти)
  const currentCounts = await getUserRequestCounts(userId);
  const userLimits = await getUserDailyLimits(userId);
  

  // Проверка дневного лимита по картинкам
  if (await isRequestLimitReached(userId, "images", userLimits.images)) {
    await sendMaxMessage(
      target,
      userLimits.premium
        ? "🥱Вы достигли **Premium-лимита** на сегодня: 10 фото. Приходите позже и продолжайте."
        : "🥱Вы достигли лимита на создание **Шедевров** сегодня, приходите позже и продолжайте"
    );
    return;
  }

  // Проверка необходимости подписки
  if (await isSubscriptionRequiredForRequest(userId, "images")) {
    await sendSubscriptionPrompt(
      target,
      userId,
      `Вы уже создали ${IMAGE_REQUESTS_BEFORE_SUBSCRIPTION} фото бесплатно.`
    );
    return;
  }

  // Определяем, что это ПЕРВОЕ изображение пользователя (до инкремента)
  const isFirstImageEver = (currentCounts.images || 0) === 0;

  // Сначала инкрементируем счётчик в БД
  await incrementRequestCount(userId, "images");

  // Скачиваем входное изображение (если есть)
  const inputImage = incomingImageUrl ? await downloadIncomingImage(incomingImageUrl) : null;

  // Для первой картинки — другая модель/качество/размер
  const imageOptions = userLimits.premium
    ? {
        model: PREMIUM_IMAGE_MODEL,
        size: PREMIUM_IMAGE_SIZE,
        quality: PREMIUM_IMAGE_QUALITY
      }
    : isFirstImageEver
      ? {
          model: FIRST_IMAGE_MODEL,
          size: FIRST_IMAGE_SIZE,
          quality: FIRST_IMAGE_QUALITY
        }
      : {};

  const imageBuffer = await runImageOpenAI(() =>
    inputImage
      ? editOpenAIImage(prompt, inputImage, imageOptions)
      : generateOpenAIImage(prompt, imageOptions)
  );

  await sendMaxImage(
  target,
  captionOverride || makeImageCaption(prompt, Boolean(inputImage)),
  imageBuffer
);

await maybeSendRandomNudgeAfterGeneration(target, userId);

}

async function handleProductCardRequest(update, target, userText, incomingImageUrl, userId = target.id) {
  const prompt = String(userText || "").trim();

  if (!prompt) {
    await sendMaxMessage(
      target,
      "🛒 Отправьте описание товара. Лучше всего: **фото товара + промт**.\n\nПример: `Крем для лица Nuvelora, бело-золотая упаковка, премиальная карточка для маркетплейса, чистый фон, четкая надпись Nuvelora`"
    );
    return;
  }

  const credits = await getProductCardCredits(userId);

  if (credits <= 0) {
    clearUserImageMode(userId);
    await sendProductCardInfo(target, userId);
    return;
  }

  const inputImage = incomingImageUrl ? await downloadIncomingImage(incomingImageUrl) : null;

  const imageOptions = {
    model: PRODUCT_CARD_IMAGE_MODEL,
    size: PRODUCT_CARD_IMAGE_SIZE,
    quality: PRODUCT_CARD_IMAGE_QUALITY
  };

  const imageBuffers = [];

  for (let i = 0; i < PRODUCT_CARD_IMAGES_COUNT; i += 1) {
    const productPrompt = buildProductCardPrompt(prompt, i, Boolean(inputImage));

    console.log("Product card generation:", {
      userId,
      index: i + 1,
      model: imageOptions.model,
      size: imageOptions.size,
      quality: imageOptions.quality
    });

    const imageBuffer = await runImageOpenAI(() =>
      inputImage
        ? editOpenAIImage(productPrompt, inputImage, imageOptions)
        : generateOpenAIImage(productPrompt, imageOptions)
    );

    imageBuffers.push(imageBuffer);
  }

  for (let i = 0; i < imageBuffers.length; i += 1) {
    await sendMaxImage(
      target,
      `🛒 Карточка товара ${i + 1}/${imageBuffers.length}`,
      imageBuffers[i]
    );
  }

  const consumeResult = await consumeProductCardCredit(userId);

  clearUserImageMode(userId);

  if (!consumeResult.consumed) {
    console.warn(`Product card credit was not consumed for user ${userId}`);
  }

  await sendMaxMessage(
    target,
    [
      "✅ **Готово.** Создал 3 карточки товара.",
      "",
      `Осталось оплаченных пакетов: **${consumeResult.creditsLeft || 0}**.`,
      "",
      "Если нужна ещё одна карточка товара — нажмите кнопку в меню и купите новый пакет."
    ].join("\n")
  );
}

async function handleMusicRequest(update, target, userText, userId = target.id) {
  const prompt = String(userText || "").trim();

  if (!prompt) {
    await sendMaxMessage(
      target,
      [
        "🎵 Отправьте описание музыки.",
        "",
        "Пример:",
        "`Создай 30-секундный современный рекламный трек для бренда косметики, премиальный вайб, мягкий женский вокал, поп-электроника, чистый припев`"
      ].join("\n")
    );
    return;
  }

  const credits = await getMusicCredits(userId);

  if (credits <= 0) {
    clearUserImageMode(userId);
    await sendMusicInfo(target, userId);
    return;
  }

  let result;

  try {
    result = await runMusicGemini(() => generateGeminiMusic(prompt));
  } catch (error) {
    if (error?.code === "GEMINI_PROMPT_BLOCKED") {
      console.warn("Gemini/Lyria prompt blocked:", {
        userId,
        blockReason: error.blockReason,
        prompt: prompt.slice(0, 500)
      });

      await sendMaxMessage(target, error.userMessage);
      return;
    }

    throw error;
  }

  await sendMaxAudio(
    target,
    [
      "🎵 **Готово. Создал музыку на 30 секунд.**",
      "",
      `Промт: ${prompt.slice(0, 700)}`,
      result.text ? `\n\nОписание от Lyria:\n${result.text.slice(0, 1000)}` : ""
    ].join("\n"),
    result.audioBuffer,
    result.mimeType
  );

  const consumeResult = await consumeMusicCredit(userId);

  clearUserImageMode(userId);

  if (!consumeResult.consumed) {
    console.warn(`Music credit was not consumed for user ${userId}`);
  }

  await sendMaxMessage(
    target,
    [
      "✅ **Трек создан.**",
      "",
      `Осталось оплаченных треков: **${consumeResult.creditsLeft || 0}**.`,
      "",
      "Для нового трека нажмите кнопку «Создать музыку» в меню и купите ещё один кредит."
    ].join("\n")
  );
}

async function handleVideoRequest(update, target, userText, incomingImageUrl, userId = target.id) {
  if (!incomingImageUrl) {
    await sendMaxMessage(
      target,
      "🎬 Режим оживления фото включён. Отправьте **фото человека**. Текст писать не нужно."
    );
    return;
  }

  const videoAccess = await getVideoAccessForUser(userId);

  if (!videoAccess.allowed) {
    clearUserImageMode(userId);
    await sendCreateVideoHelp(target, userId);
    return;
  }

  const inputImage = await downloadIncomingImage(incomingImageUrl);

  const videoBuffer = await makeVideoFromFalSeedance({
    inputImage
  });

  await sendMaxVideo(
    target,
    [
      "🎬 **Готово. Фото оживлено.**",
      "",
      "Видео создано на 5 секунд через Seedance Lite.",
      "",
      "Текст пользователя не использовался — применён встроенный промт оживления фото."
    ].join("\n"),
    videoBuffer
  );

  clearUserImageMode(userId);

  if (videoAccess.source === "premium") {
    await incrementRequestCount(userId, "videos");

    const countsAfter = await getUserRequestCounts(userId);
    const limitsAfter = await getUserDailyLimits(userId);

    const premiumVideosLeft = Math.max(
      0,
      Number(limitsAfter.videos || 0) - Number(countsAfter.videos || 0)
    );

    await sendMaxMessage(
      target,
      [
        "✅ **Видео создано за счёт Premium.**",
        "",
        `Premium-видео на сегодня осталось: **${premiumVideosLeft}**.`,
        "",
        premiumVideosLeft > 0
          ? "Можете создать ещё одно Premium-видео сегодня."
          : "Если нужно ещё видео сегодня — купите отдельный видео-кредит."
      ].join("\n")
    );

    await maybeSendRandomNudgeAfterGeneration(target, userId);
    return;
  }

  const consumeResult = await consumeVideoCredit(userId);

  if (!consumeResult.consumed) {
    console.warn(`Video credit was not consumed for user ${userId}`);
  }

  await sendMaxMessage(
    target,
    [
      "✅ **Видео создано.**",
      "",
      `Осталось оплаченных видео: **${consumeResult.creditsLeft || 0}**.`,
      "",
      "Для нового видео нажмите «🎬 Оживить фото» в меню и купите ещё один кредит."
    ].join("\n")
  );

  await maybeSendRandomNudgeAfterGeneration(target, userId);
}

async function handleUpdate(update) {
  const updateType = update?.update_type;
  const target = getReplyTarget(update);
  let status = null;
  let processingLocked = false;

  debugLog("Incoming update type:", updateType);

  if (!target) {
    console.log("No reply target in update:", JSON.stringify(update));
    return;
  }

  const userId = getStableUserId(update, target);
  const firstName = getUserFirstName(update);

const broadcastUserId = getRealUserIdForBroadcast(update, target);

if (shouldRegisterBotUser(broadcastUserId)) {
  registerBotUserInDb(broadcastUserId).catch((error) => {
    console.warn("Failed to register bot user in DB:", error?.message || error);
  });
}

  try {
    if (updateType === "bot_started") {
      const firstName = getUserFirstName(update);
      const namePrefix = firstName ? `, ${firstName}!` : "!";

      const text =
        `🙋🏻‍♂️ **Привет${namePrefix}**\n\n` +
        "Осуществляя работу с сервисом с помощью **Max-бота**, вы подтверждаете, что ознакомлены и согласны с [Офертой](https://disk.yandex.ru/i/8Z6BsYfupgMq1Q) и [Политикой персональных данных](https://disk.yandex.ru/i/LHakrABNtGiVMw).\n\n" +
        "Напишите вопрос прямо в **ЧАТ**✍ или выберите, что хотите сделать ниже:";

      await sendMainMenu(target, text);

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
  debugLog("Callback received:", {
    callbackPayload,
    userId,
    target
  });


      // 1) Проверка подписки по кнопке "Я подписан(а)"
      if (isSubscriptionCheckPayload(callbackPayload)) {
        // userId из payload нам нужен только чтобы понять, что это вообще кнопка проверки
        const payloadUserId = getUserIdFromSubscriptionPayload(callbackPayload);

        // А ДЛЯ ПРОВЕРКИ подписки используем ТОЛЬКО реальный ID из callback.user
        const callbackUserId = String(update?.callback?.user?.user_id || "").trim();

        if (!callbackUserId) {
          console.warn(
            "Subscription callback has no callback.user.user_id. PayloadUserId:",
            payloadUserId,
            "stableUserId:",
            userId
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

        console.log(
          "Subscription check will use user_id (from callback.user):",
          callbackUserId,
          "payloadUserId:",
          payloadUserId,
          "stableUserId:",
          userId
        );

        await handleSubscriptionCheck(target, callbackUserId, callbackId);
        return;
      }

// 2) Меню: Создать фото
if (callbackPayload === MENU_CREATE_PHOTO_PAYLOAD) {
  const startedAt = Date.now();

  console.log("PHOTO callback start:", {
    callbackId,
    userId,
    target
  });

  if (callbackId) {
    answerMaxCallback(callbackId)
      .then((ok) => {
        console.log(
          "PHOTO answerMaxCallback done:",
          Date.now() - startedAt,
          "ms",
          "ok:",
          ok
        );
      })
      .catch((error) => {
        console.warn(
          "PHOTO answerMaxCallback failed:",
          Date.now() - startedAt,
          "ms",
          error?.message || error
        );
      });
  }

  clearUserImageMode(userId);

  console.log("PHOTO before sendCreatePhotoHelp:", Date.now() - startedAt, "ms");

  sendCreatePhotoHelp(target)
    .then(() => {
      console.log("PHOTO sendCreatePhotoHelp done:", Date.now() - startedAt, "ms");
    })
    .catch((error) => {
      console.error("sendCreatePhotoHelp failed:", error);
    });

  console.log("PHOTO callback returned:", Date.now() - startedAt, "ms");

  return;
}

// 3) Меню: Реставрация
if (callbackPayload === MENU_RESTORE_PHOTO_PAYLOAD) {
  setUserImageMode(userId, IMAGE_MODE_RESTORATION);

  runCallbackTaskInBackground(target, "open restoration menu", async () => {
    await sendRestorationPhotoHelp(target);
  });

  return;
}
      // 4) Меню: Оживить фото (демо)
if (callbackPayload === MENU_CREATE_VIDEO_PAYLOAD) {
  clearUserImageMode(userId);

  await sendCreateVideoHelp(target, userId);
  return;
}

      // 5) Меню: Создать карточку товара
      if (callbackPayload === MENU_PRODUCT_CARD_PAYLOAD) {
        clearUserImageMode(userId);

        await sendProductCardInfo(target, userId);
        return;
      }

      if (callbackPayload === MENU_CREATE_MUSIC_PAYLOAD) {
        clearUserImageMode(userId);

        await sendMusicInfo(target, userId);
        return;
      }

      // 5) Меню: Отключить лимиты / Premium
      if (callbackPayload === MENU_PREMIUM_PAYLOAD) {
        clearUserImageMode(userId);

        await sendPremiumInfo(target, userId);
        return;
      }

// 6) Кнопка "Назад" — возвращаем к меню
if (callbackPayload === MENU_BACK_PAYLOAD) {
  clearUserImageMode(userId);

  runCallbackTaskInBackground(target, "open main menu", async () => {
    await sendMainMenu(target);
  });

  return;
}

      // 7) Неизвестная кнопка
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
      clearUserImageMode(userId);

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

    if (isRestorationMode(userId)) {
      if (!incomingImageUrl) {
        await sendMaxMessage(
          target,
          "🛠️ Режим реставрации включён. Отправьте старую фотографию — любой текст будет проигнорирован."
        );
        return;
      }

      if (isUserBusy(userId)) {
        await sendBusyWarningIfNeeded(target, userId, firstName);
        return;
      }

      lockUserProcessing(userId);
      processingLocked = true;

      status = await startDynamicStatus(target, "🛠️Фото реставрируется");

      await handleImageRequest(
        update,
        target,
        RESTORATION_PROMPT,
        incomingImageUrl,
        userId,
        "✅ Готово. Фото аккуратно отреставрировано."
      );

      await status.stop();
      status = null;

      return;
    }

const productCardModeActive = isProductCardMode(userId);

if (productCardModeActive) {
  if (!userText && !incomingImageUrl) {
    await sendMaxMessage(
      target,
      "🛒 Режим карточки товара включён. Отправьте **фото + промт** или просто **описание товара**."
    );
    return;
  }

  if (!userText && incomingImageUrl) {
    await sendMaxMessage(
      target,
      "🛒 Фото получил. Теперь отправьте **описание товара / промт**.\n\nНапример:\n`Крем для лица Nuvelora, бело-золотая упаковка, премиальная карточка для маркетплейса, чистый фон, четкая надпись Nuvelora`"
    );
    return;
  }

  if (isUserBusy(userId)) {
    await sendBusyWarningIfNeeded(target, userId, firstName);
    return;
  }

  lockUserProcessing(userId);
  processingLocked = true;

  status = await startDynamicStatus(target, "🛒 Карточки товара создаются");

  await handleProductCardRequest(
    update,
    target,
    userText,
    incomingImageUrl,
    userId
  );

  await status.stop();
  status = null;

  return;
}
    const musicModeActive = isMusicMode(userId);

if (musicModeActive) {
  if (!userText) {
    await sendMaxMessage(
      target,
      [
        "🎵 Режим создания музыки включён.",
        "",
        "Отправьте описание трека.",
        "",
        "Пример:",
        "`30-секундный энергичный трек для рекламы кафе, летний вайб, поп, гитара, лёгкий вокал`"
      ].join("\n")
    );
    return;
  }

  if (isUserBusy(userId)) {
    await sendBusyWarningIfNeeded(target, userId, firstName);
    return;
  }

  lockUserProcessing(userId);
  processingLocked = true;

  status = await startDynamicStatus(target, "🎵 Музыка создаётся");

  await handleMusicRequest(
    update,
    target,
    userText,
    userId
  );

  await status.stop();
  status = null;

  return;
}

    const videoModeActive = isVideoMode(userId);

if (videoModeActive) {
  if (!incomingImageUrl) {
    await sendMaxMessage(
      target,
      "🎬 Режим оживления фото включён. Отправьте **фото человека**. Текст писать не нужно."
    );
    return;
  }

  if (isUserBusy(userId)) {
    await sendBusyWarningIfNeeded(target, userId, firstName);
    return;
  }

  lockUserProcessing(userId);
  processingLocked = true;

  status = await startDynamicStatus(target, "🎞️ Видео создаётся");

  await handleVideoRequest(
    update,
    target,
    "",
    incomingImageUrl,
    userId
  );

  await status.stop();
  status = null;

  return;
}
    


if (!userText && incomingImageUrl) {
  const videoAccess = await getVideoAccessForUser(userId);

  if (videoAccess.allowed) {
    setUserImageMode(userId, IMAGE_MODE_VIDEO);

    if (isUserBusy(userId)) {
      await sendBusyWarningIfNeeded(target, userId, firstName);
      return;
    }

    lockUserProcessing(userId);
    processingLocked = true;

    status = await startDynamicStatus(target, "🎬 Оживляем фото");

    await handleVideoRequest(
      update,
      target,
      "",
      incomingImageUrl,
      userId
    );

    await status.stop();
    status = null;

    return;
  }

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
  const videoAccess = await getVideoAccessForUser(userId);

  if (!videoAccess.allowed) {
    clearUserImageMode(userId);
    await sendCreateVideoHelp(target, userId);
    return;
  }

  setUserImageMode(userId, IMAGE_MODE_VIDEO);

  status = await startDynamicStatus(target, "🎬Оживляем фото");

  await handleVideoRequest(update, target, "", incomingImageUrl, userId);

  await status.stop();
  status = null;
  return;
}



    if (isImageRequest(userText, Boolean(incomingImageUrl))) {
      status = await startDynamicStatus(target, "🔮Шедевр создается");

      await handleImageRequest(update, target, userText, incomingImageUrl, userId);

      await status.stop();
      status = null;
      return;
    }

    const userLimits = await getUserDailyLimits(userId);

    if (await isRequestLimitReached(userId, "chatgpt", userLimits.chatgpt)) {
      await sendMaxMessage(
        target,
        userLimits.premium
          ? "Кажется вам надо немного отдохнуть от ИИ🏝️ **Premium-лимит на сегодня: 16 запросов**."
          : "Кажется вам надо немного отдохнуть от ИИ🏝️, **приходите чуть позже и продолжайте**🦦"
      );
      return;
    }

    if (await isSubscriptionRequiredForRequest(userId, "chatgpt")) {
      await sendSubscriptionPrompt(
        target,
        userId,
        `Вы уже использовали ${CHATGPT_REQUESTS_BEFORE_SUBSCRIPTION} текстовых запроса бесплатно.`
      );
      return;
    }

    await incrementRequestCount(userId, "chatgpt");

    status = await startDynamicStatus(target, "💬ИИ думает");

const answer = await runTextOpenAI(() => askOpenAI(userId, userText));

await status.stop();
status = null;

await sendMaxMessage(
  target,
  formatChatGptAnswerWithName(firstName, answer)
);

await maybeSendRandomNudgeAfterGeneration(target, userId);
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

app.get("/premium/buy", async (req, res) => {
  try {
    const userId = String(req.query.user_id || "").trim();

    if (!isValidUserIdForBroadcast(userId)) {
      res.status(400).type("text/plain").send("Некорректный user_id.");
      return;
    }

    const payment = await createYooKassaPremiumPayment(userId);
    const confirmationUrl = payment?.confirmation?.confirmation_url;

    if (!confirmationUrl) {
      throw new Error(`YooKassa confirmation_url is missing: ${JSON.stringify(payment)}`);
    }

    res.redirect(302, confirmationUrl);
  } catch (error) {
    console.error("Premium payment create failed:", error);
    res
      .status(500)
      .type("text/plain")
      .send("Не удалось создать платеж. Вернитесь в бота и попробуйте позже.");
  }
});

app.get("/product-card/buy", async (req, res) => {
  try {
    const userId = String(req.query.user_id || "").trim();

    if (!isValidUserIdForBroadcast(userId)) {
      res.status(400).type("text/plain").send("Некорректный user_id.");
      return;
    }

    const payment = await createYooKassaProductCardPayment(userId);
    const confirmationUrl = payment?.confirmation?.confirmation_url;

    if (!confirmationUrl) {
      throw new Error(`YooKassa confirmation_url is missing: ${JSON.stringify(payment)}`);
    }

    res.redirect(302, confirmationUrl);
  } catch (error) {
    console.error("Product card payment create failed:", error);
    res
      .status(500)
      .type("text/plain")
      .send("Не удалось создать платеж за карточку товара. Вернитесь в бота и попробуйте позже.");
  }
});

app.get("/premium/return", (req, res) => {
  res
    .status(200)
    .type("text/html; charset=utf-8")
    .send(`
      <html>
        <body style="font-family: Arial, sans-serif; padding: 24px;">
          <h2>Спасибо за оплату</h2>
          <p>Если платеж прошел успешно, Premium будет активирован автоматически. Вернитесь в бот.</p>
        </body>
      </html>
    `);
});

app.get("/product-card/return", (req, res) => {
  res
    .status(200)
    .type("text/html; charset=utf-8")
    .send(`
      <html>
        <body style="font-family: Arial, sans-serif; padding: 24px;">
          <h2>Спасибо за оплату</h2>
          <p>Если платеж прошел успешно, доступ к созданию карточки товара будет активирован автоматически. Вернитесь в бот.</p>
        </body>
      </html>
    `);
});

app.get("/music/buy", async (req, res) => {
  try {
    const userId = String(req.query.user_id || "").trim();

    if (!isValidUserIdForBroadcast(userId)) {
      res.status(400).type("text/plain").send("Некорректный user_id.");
      return;
    }

    const payment = await createYooKassaMusicPayment(userId);
    const confirmationUrl = payment?.confirmation?.confirmation_url;

    if (!confirmationUrl) {
      throw new Error(`YooKassa confirmation_url is missing: ${JSON.stringify(payment)}`);
    }

    res.redirect(302, confirmationUrl);
  } catch (error) {
    console.error("Music payment create failed:", error);
    res
      .status(500)
      .type("text/plain")
      .send("Не удалось создать платеж за музыку. Вернитесь в бота и попробуйте позже.");
  }
});

app.get("/music/return", (req, res) => {
  res
    .status(200)
    .type("text/html; charset=utf-8")
    .send(`
      <html>
        <body style="font-family: Arial, sans-serif; padding: 24px;">
          <h2>Спасибо за оплату</h2>
          <p>Если платеж прошел успешно, доступ к созданию музыки будет активирован автоматически. Вернитесь в бот.</p>
        </body>
      </html>
    `);
});

app.get("/video/buy", async (req, res) => {
  try {
    const userId = String(req.query.user_id || "").trim();

    if (!isValidUserIdForBroadcast(userId)) {
      res.status(400).type("text/plain").send("Некорректный user_id.");
      return;
    }

    const payment = await createYooKassaVideoPayment(userId);
    const confirmationUrl = payment?.confirmation?.confirmation_url;

    if (!confirmationUrl) {
      throw new Error(`YooKassa confirmation_url is missing: ${JSON.stringify(payment)}`);
    }

    res.redirect(302, confirmationUrl);
  } catch (error) {
    console.error("Video payment create failed:", error);
    res
      .status(500)
      .type("text/plain")
      .send("Не удалось создать платеж за видео. Вернитесь в бота и попробуйте позже.");
  }
});

app.get("/video/return", (req, res) => {
  res
    .status(200)
    .type("text/html; charset=utf-8")
    .send(`
      <html>
        <body style="font-family: Arial, sans-serif; padding: 24px;">
          <h2>Спасибо за оплату</h2>
          <p>Если платеж прошел успешно, доступ к оживлению фото будет активирован автоматически. Вернитесь в бот.</p>
        </body>
      </html>
    `);
});

async function handleYooKassaWebhook(req, res) {
  // YooKassa нужно быстро получить HTTP 200.
  res.status(200).json({ ok: true });

  const notification = req.body;

  (async () => {
    try {
      const event = String(notification?.event || "");
      const object = notification?.object || {};
      const paymentId = String(object?.id || "").trim();

      if (event !== "payment.succeeded" || !paymentId) {
        return;
      }

      // Проверяем платеж повторно через YooKassa, чтобы не доверять только webhook.
      const payment = await getYooKassaPayment(paymentId);
      const metadata = payment?.metadata || {};
      const product = String(metadata.product || "").trim();

      if (product === "premium_month") {
        const result = await applyPremiumPayment(payment);

        console.log("Premium payment apply result:", result);

        if (result.granted && result.userId) {
          await sendMaxMessage(
            {
              type: "user_id",
              id: result.userId
            },
            [
              "✅ **Премиум на месяц получен!**",
              "",
              "Теперь вам открыт доступ:",
              "• 10 фото в день с лучшей моделью;",
              "• 16 запросов ChatGPT в день;",
              "• 1 оживление фото в день;",
              "• без обязательной подписки на каналы.",
              "",
              "Спасибо, вы стали Спонсором Бота и членом нашей семьи 🙌🏻"
            ].join("\n")
          ).catch((error) => {
            console.warn("Failed to send premium success message:", error?.message || error);
          });
        }

        return;
      }

      if (product === PRODUCT_CARD_PRODUCT_CODE) {
        const result = await applyProductCardPayment(payment);

        console.log("Product card payment apply result:", result);

        if (result.granted && result.userId) {
          setUserImageMode(result.userId, IMAGE_MODE_PRODUCT_CARD);

          await sendMaxMessage(
            {
              type: "user_id",
              id: result.userId
            },
            [
              "✅ **Оплата прошла. Доступ к карточке товара открыт.**",
              "",
              "Теперь отправьте:",
              "• **фото товара + промт** — лучший вариант;",
              "или",
              "• **просто промт товара**.",
              "",
              "Я создам **3 красивые карточки товара с разных ракурсов**.",
              "",
              "Пример:",
              "`Крем для лица Nuvelora, премиальная бело-золотая карточка для маркетплейса, чистый фон, четкая надпись Nuvelora`"
            ].join("\n")
          ).catch((error) => {
            console.warn("Failed to send product card success message:", error?.message || error);
          });
        }

        return;
      }

      if (product === MUSIC_PRODUCT_CODE) {
  const result = await applyMusicPayment(payment);

  console.log("Music payment apply result:", result);

  if (result.granted && result.userId) {
    setUserImageMode(result.userId, IMAGE_MODE_MUSIC);

    await sendMaxMessage(
      {
        type: "user_id",
        id: result.userId
      },
      [
        "✅ **Оплата прошла. Доступ к созданию музыки открыт.**",
        "",
        "Теперь нажмите в меню «🎵 Создать музыку» ещё раз или сразу отправьте описание трека.",
        "",
        "Я создам **MP3-трек на 30 секунд** через Lyria 3 Clip.",
        "",
        "Пример:",
        "`Создай 30-секундный энергичный поп-трек для рекламы frozen yogurt, летнее настроение, мягкий вокал, современный бит`"
      ].join("\n")
    ).catch((error) => {
      console.warn("Failed to send music success message:", error?.message || error);
    });
  }

  return;
}

      if (product === VIDEO_PRODUCT_CODE) {
  const result = await applyVideoPayment(payment);

  console.log("Video payment apply result:", result);

  if (result.granted && result.userId) {
    setUserImageMode(result.userId, IMAGE_MODE_VIDEO);

    await sendMaxMessage(
      {
        type: "user_id",
        id: result.userId
      },
      [
        "✅ **Оплата прошла. Оживление фото доступно.**",
        "",
        "Теперь просто отправьте **фото человека**.",
        "",
        "Текст можно не писать. Если отправите фото с текстом — текст будет проигнорирован.",
        "",
        "Я сделаю видео на **5 секунд** через Seedance Lite: человек будет смотреть в камеру, слегка улыбаться и мягко махать рукой."
      ].join("\n")
    ).catch((error) => {
      console.warn("Failed to send video success message:", error?.message || error);
    });
  }

  return;
}
      

      console.warn("Unknown YooKassa product:", {
        paymentId,
        product,
        metadata
      });
    } catch (error) {
      console.error("YooKassa webhook processing failed:", error);
    }
  })();
}
      
app.post("/yookassa-webhook", handleYooKassaWebhook);
app.post("/yookassa/webhook", handleYooKassaWebhook);

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


Promise.all([
  initBroadcastUsersDb(),
  initLimitsDb(),
  initPremiumDb()
])
  .catch((error) => {
    console.warn("DB init failed:", error?.message || error);
  })
  
.finally(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`MAX OpenAI bot is running on port ${PORT}`);

    setTimeout(() => {
      if (VIDEO_EXAMPLE_URL && !cachedVideoExampleToken) {
        getVideoExampleMaxToken().catch((error) => {
          console.warn("Video example warmup failed:", error?.message || error);
        });
      }
    }, 2000).unref?.();
  });
});

  
