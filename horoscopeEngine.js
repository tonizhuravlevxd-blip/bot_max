// horoscopeEngine.js

const SIGN_RU = {
  aries: "Овен",
  taurus: "Телец",
  gemini: "Близнецы",
  cancer: "Рак",
  leo: "Лев",
  virgo: "Дева",
  libra: "Весы",
  scorpio: "Скорпион",
  sagittarius: "Стрелец",
  capricorn: "Козерог",
  aquarius: "Водолей",
  pisces: "Рыбы"
};

const SIGN_THEMES = {
  aries: {
    tone: "энергия, инициатива, смелые решения",
    advice: "не давите на события слишком резко, лучше направьте активность в одно главное дело",
    mood: "боевое",
    color: "красный",
    luckyTime: "12:00–14:00"
  },
  taurus: {
    tone: "стабильность, деньги, комфорт, практичные решения",
    advice: "не спешите менять планы, сегодня лучше укреплять то, что уже работает",
    mood: "ровное",
    color: "зелёный",
    luckyTime: "10:00–12:00"
  },
  gemini: {
    tone: "общение, идеи, переписки, новые контакты",
    advice: "проверяйте детали и не обещайте больше, чем реально успеете",
    mood: "подвижное",
    color: "жёлтый",
    luckyTime: "15:00–17:00"
  },
  cancer: {
    tone: "дом, близкие, эмоции, забота",
    advice: "не держите всё внутри, спокойный разговор даст больше, чем молчание",
    mood: "чувствительное",
    color: "серебристый",
    luckyTime: "18:00–20:00"
  },
  leo: {
    tone: "самовыражение, внимание, творчество, уверенность",
    advice: "проявляйтесь, но не превращайте каждый спор в сцену",
    mood: "яркое",
    color: "золотой",
    luckyTime: "13:00–15:00"
  },
  virgo: {
    tone: "порядок, работа, здоровье режима, точность",
    advice: "не застревайте в мелочах, сегодня важнее завершить главное",
    mood: "собранное",
    color: "бежевый",
    luckyTime: "09:00–11:00"
  },
  libra: {
    tone: "отношения, баланс, договорённости, красота",
    advice: "не соглашайтесь автоматически, сначала проверьте, удобно ли это вам",
    mood: "мягкое",
    color: "розовый",
    luckyTime: "16:00–18:00"
  },
  scorpio: {
    tone: "глубина, контроль, личные границы, внутренняя сила",
    advice: "не проверяйте людей на прочность, лучше прямо обозначьте свои ожидания",
    mood: "сосредоточенное",
    color: "бордовый",
    luckyTime: "20:00–22:00"
  },
  sagittarius: {
    tone: "движение, обучение, планы, расширение горизонтов",
    advice: "оставьте место для спонтанности, но не игнорируйте обязательства",
    mood: "оптимистичное",
    color: "фиолетовый",
    luckyTime: "11:00–13:00"
  },
  capricorn: {
    tone: "цели, дисциплина, работа, ответственность",
    advice: "не требуйте от себя невозможного, устойчивый шаг сегодня ценнее рывка",
    mood: "деловое",
    color: "тёмно-синий",
    luckyTime: "08:00–10:00"
  },
  aquarius: {
    tone: "нестандартные идеи, друзья, технологии, свобода",
    advice: "не спорьте ради самого спора, лучше покажите пользу своей идеи",
    mood: "независимое",
    color: "голубой",
    luckyTime: "14:00–16:00"
  },
  pisces: {
    tone: "интуиция, творчество, отдых, тонкие чувства",
    advice: "не растворяйтесь в чужих эмоциях, держите мягкие, но понятные границы",
    mood: "мечтательное",
    color: "морской",
    luckyTime: "19:00–21:00"
  }
};

function safeText(value, maxLength = 80) {
  return String(value || "")
    .replace(/[\r\n*_`[\]()~>#+\-=|{}]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function getSignRu(sign) {
  return SIGN_RU[String(sign || "").toLowerCase()] || "не указан";
}

function getTheme(sign) {
  const cleanSign = String(sign || "").toLowerCase();
  return SIGN_THEMES[cleanSign] || SIGN_THEMES.aries;
}

function getDateSeed(dateLabel, sign) {
  const text = `${dateLabel}:${sign}`;
  let hash = 0;

  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }

  return hash;
}

function pickBySeed(items, seed) {
  if (!Array.isArray(items) || items.length === 0) return "";
  return items[seed % items.length];
}

function buildLocalHoroscope(profile, dateLabel) {
  const name = safeText(profile?.name, 60) || "Сегодня";
  const sign = String(profile?.zodiac_sign || "").toLowerCase();
  const signRu = getSignRu(sign);
  const theme = getTheme(sign);
  const seed = getDateSeed(dateLabel, sign);

  const openings = [
    "день подойдёт для спокойного движения вперёд без резких решений",
    "сегодня важно не торопиться и внимательнее смотреть на детали",
    "день может дать хороший шанс навести порядок в делах и мыслях",
    "сегодня лучше выбирать ясность, а не догадки и эмоциональные реакции",
    "день подходит для маленьких, но точных шагов в нужную сторону"
  ];

  const workLines = [
    "В делах полезно сначала закрыть старые задачи, а уже потом брать новое.",
    "В работе и учёбе лучше держаться конкретного плана, иначе внимание быстро распылится.",
    "Хорошо пойдут задачи, где нужна собранность, аккуратность и нормальный темп.",
    "Не откладывайте короткие дела: именно они сегодня могут сильнее всего разгрузить голову.",
    "Если появится новая идея, запишите её, но не бросайте ради неё всё остальное."
  ];

  const relationLines = [
    "В общении поможет мягкость: не нужно доказывать правоту там, где можно спокойно объяснить позицию.",
    "С близкими лучше говорить прямо, но без давления.",
    "Сегодня особенно важны тон и формулировки: одно спокойное сообщение может снять лишнее напряжение.",
    "Не додумывайте за других — лучше уточнить, чем строить выводы на эмоциях.",
    "Хороший день для примирения, честного разговора или аккуратного восстановления контакта."
  ];

  const energyLines = [
    "По энергии день средний: не перегружайте себя и оставьте время на паузу.",
    "Организму может понадобиться больше спокойствия, чем обычно.",
    "Лучше не загонять себя в жёсткий режим: короткий отдых повысит продуктивность.",
    "Вечером будет полезно снизить темп и убрать лишний шум.",
    "Старайтесь не тратить силы на чужую суету."
  ];

  const finalLines = [
    "Главная подсказка дня — действовать проще и честнее.",
    "Сегодня выиграет тот, кто не суетится и держит внутренний баланс.",
    "Не требуйте от дня идеальности: достаточно сделать один правильный шаг.",
    "День станет легче, если не пытаться контролировать всё сразу.",
    "Сохраняйте спокойствие: многое прояснится само, если не торопить события."
  ];

  const luckyNumber = String((seed % 9) + 1);

  return [
    `🔮 **Гороскоп на ${dateLabel}**`,
    "",
    `${name}, ваш знак — **${signRu}**.`,
    `Общий фон дня: ${theme.tone}. ${pickBySeed(openings, seed)}.`,
    "",
    pickBySeed(workLines, seed + 1),
    pickBySeed(relationLines, seed + 2),
    pickBySeed(energyLines, seed + 3),
    "",
    `Совет дня: ${theme.advice}.`,
    pickBySeed(finalLines, seed + 4),
    "",
    `Настроение дня: **${theme.mood}**`,
    `Цвет дня: **${theme.color}**`,
    `Удачное время: **${theme.luckyTime}**`,
    `Счастливое число: **${luckyNumber}**`,
    "",
    "Это развлекательный прогноз, а не точное предсказание."
  ].join("\n");
}

function extractTextFromOpenAIResponse(data) {
  if (!data) return "";

  if (typeof data.output_text === "string") {
    return data.output_text.trim();
  }

  const chunks = [];

  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) {
        chunks.push(content.text);
      }
      if (content.type === "text" && content.text) {
        chunks.push(content.text);
      }
    }
  }

  return chunks.join("\n").trim();
}

async function buildAiHoroscope(profile, dateLabel, options = {}) {
  const openaiApiKey = String(options.openaiApiKey || "").trim();

  if (!openaiApiKey) {
    return "";
  }

  const openaiApiBase = String(options.openaiApiBase || "https://api.openai.com/v1")
    .trim()
    .replace(/\/+$/, "");

  const openaiModel = String(options.openaiModel || "gpt-4o-mini").trim();

  const name = safeText(profile?.name, 60) || "Пользователь";
  const sign = String(profile?.zodiac_sign || "").toLowerCase();
  const signRu = getSignRu(sign);
  const theme = getTheme(sign);

  const prompt = [
    "Составь персональный ежедневный гороскоп на русском языке для пользователя бота.",
    "",
    "Требования:",
    "- 6-8 коротких предложений;",
    "- стиль дружелюбный, живой, без запугивания;",
    "- не обещай гарантированных событий;",
    "- не давай медицинских, юридических или финансовых инструкций;",
    "- обязательно напиши, что прогноз развлекательный;",
    "- не используй длинные списки;",
    "- не упоминай, что текст создан ИИ.",
    "",
    `Имя: ${name}`,
    `Знак зодиака: ${signRu}`,
    `Дата прогноза: ${dateLabel}`,
    `Тема знака на день: ${theme.tone}`,
    `Совет знака: ${theme.advice}`,
    `Настроение дня: ${theme.mood}`,
    `Цвет дня: ${theme.color}`,
    `Удачное время: ${theme.luckyTime}`
  ].join("\n");

  const controller = new AbortController();
  const timeoutMs = Number(options.timeoutMs || 15000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${openaiApiBase}/responses`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiApiKey}`
      },
      body: JSON.stringify({
        model: openaiModel,
        input: [
          {
            role: "system",
            content:
              "Ты редактор коротких развлекательных гороскопов для мессенджера. Пиши по-русски, мягко, понятно и без мистических гарантий."
          },
          {
            role: "user",
            content: prompt
          }
        ]
      })
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      console.warn("OpenAI horoscope generation failed:", response.status, JSON.stringify(data));
      return "";
    }

    return extractTextFromOpenAIResponse(data);
  } catch (error) {
    console.warn("OpenAI horoscope request failed:", error?.message || error);
    return "";
  } finally {
    clearTimeout(timer);
  }
}

export async function buildHoroscopeFromEngine(profile, options = {}) {
  const dateLabel = String(options.dateLabel || "").trim();

  const aiText = await buildAiHoroscope(profile, dateLabel, options);

  if (aiText) {
    return [
      `🔮 **Гороскоп на ${dateLabel}**`,
      "",
      aiText,
      "",
      "Источник прогноза: персональная генерация."
    ].join("\n");
  }

  return buildLocalHoroscope(profile, dateLabel);
}

export function buildAllLocalHoroscopesForDate(dateLabel) {
  const result = {};

  for (const sign of Object.keys(SIGN_RU)) {
    result[sign] = buildLocalHoroscope(
      {
        name: SIGN_RU[sign],
        zodiac_sign: sign
      },
      dateLabel
    );
  }

  return result;
}
