require('dotenv').config(); // Загружаем переменные окружения
const express = require('express');
const axios = require('axios');
const { Bot } = require('@maxhub/max-bot-api'); // Импортируем MAX Bot API

// Переменные окружения
const MAX_BOT_TOKEN = process.env.MAX_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Инициализация Express
const app = express();
app.use(express.json());

// Инициализация MAX Bot API
const bot = new Bot(MAX_BOT_TOKEN);

// Функция для общения с OpenAI API
async function getOpenAIResponse(prompt) {
  const url = 'https://api.openai.com/v1/completions';
  const headers = {
    'Authorization': `Bearer ${OPENAI_API_KEY}`,
    'Content-Type': 'application/json'
  };
  const payload = {
    model: 'gpt-3.5-turbo',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 150
  };

  try {
    const response = await axios.post(url, payload, { headers });
    return response.data.choices[0].message.content;
  } catch (error) {
    throw new Error(`Error from OpenAI API: ${error.message}`);
  }
}

// Функция для генерации изображения через OpenAI
async function generateImage(prompt) {
  const url = 'https://api.openai.com/v1/images/generations';
  const headers = {
    'Authorization': `Bearer ${OPENAI_API_KEY}`,
    'Content-Type': 'application/json'
  };
  const payload = {
    prompt: prompt,
    n: 1,
    size: '1024x1024'
  };

  try {
    const response = await axios.post(url, payload, { headers });
    return response.data.data[0].url;
  } catch (error) {
    throw new Error(`Error generating image: ${error.message}`);
  }
}

// Устанавливаем команды бота через MAX Bot API
bot.api.setMyCommands([
  {
    name: 'hello',
    description: 'Поприветствовать бота',
  },
]);

// Обработчик команды '/hello' для MAX Bot API
bot.command('hello', (ctx) => {
  const user = ctx.user(); // Получаем данные пользователя

  if (!user) {
    return ctx.reply('Привет! ✨'); // Ответ без имени
  }

  return ctx.reply(`Привет, ${user.first_name || 'незнакомец'}! ✨`); // Приветствие с именем пользователя
});

// Обработка входящих запросов через Express
app.post('/process_request', async (req, res) => {
  const prompt = req.body.text;

  try {
    if (prompt.toLowerCase().includes('image')) {
      // Информируем пользователя о процессе создания изображения
      console.log("Создаю шедевр...");
      const imageUrl = await generateImage(prompt);
      res.json({ message: `Вот твой шедевр: ${imageUrl}` });
    } else {
      // Информируем пользователя о процессе получения ответа
      console.log("Думаю над ответом...");
      const responseText = await getOpenAIResponse(prompt);
      res.json({ message: responseText });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Запуск приложения
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Запускаем бота
bot.start();
