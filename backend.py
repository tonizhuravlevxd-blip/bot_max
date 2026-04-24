import os
import json
import asyncio
import logging
from datetime import datetime
from enum import Enum
from typing import Dict

from dotenv import load_dotenv
from maxapi import Bot, Dispatcher, F
from maxapi.types import (
    MessageCreated, BotStarted, MessageCallback, Command,
    CallbackButton, ButtonsPayload, Attachment, BotCommand
)
from maxapi.enums.intent import Intent
from maxapi.enums.parse_mode import ParseMode
import httpx

# Загружаем конфигурацию
load_dotenv()

# Логирование
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.FileHandler("bot.log"), logging.StreamHandler()]
)
logger = logging.getLogger(__name__)

# Конфигурация
BOT_TOKEN = os.getenv("MAX_BOT_TOKEN")
MAX_API_KEY = os.getenv("MAX_API_KEY")  # Используем MAX_API_KEY
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
BACKEND_URL = os.getenv("BACKEND_URL")

if not BOT_TOKEN or not OPENAI_API_KEY:
    logger.error("MAX_BOT_TOKEN или OPENAI_API_KEY не найден в .env")
    exit(1)

# Инициализация
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()

# ==================== СОСТОЯНИЯ ====================

class UserState(Enum):
    IDLE = "idle"
    SUPPORT_MODE = "support"
    IMAGE_MODE = "image"
    TEXT_MODE = "text"

user_states: Dict[int, UserState] = {}


# ==================== ХРАНИЛИЩЕ ====================

def load_users() -> Dict:
    try:
        os.makedirs('data', exist_ok=True)
        if os.path.exists('data/users.json'):
            with open('data/users.json', 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception as e:
        logger.error(f"Ошибка загрузки: {e}")
    return {}


def save_users(users: Dict):
    try:
        os.makedirs('data', exist_ok=True)
        with open('data/users.json', 'w', encoding='utf-8') as f:
            json.dump(users, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"Ошибка сохранения: {e}")


def add_user(user_id: int, chat_id: int, username: str = None, name: str = None):
    users = load_users()
    uid = str(user_id)
    is_new = uid not in users

    users[uid] = {
        'chat_id': chat_id,
        'username': username,
        'name': name,
        'created_at': users.get(uid, {}).get('created_at', datetime.now().isoformat()),
        'last_activity': datetime.now().isoformat()
    }
    save_users(users)
    return is_new


# ==================== КНОПКИ ====================

def create_main_menu() -> Attachment:
    buttons = ButtonsPayload(buttons=[
        [
            CallbackButton(text="📋 Помощь", payload="help", intent=Intent.DEFAULT),
            CallbackButton(text="ℹ️ О боте", payload="about", intent=Intent.DEFAULT)
        ],
        [
            CallbackButton(text="💬 Поддержка", payload="support", intent=Intent.POSITIVE)
        ]
    ])
    return Attachment(type="inline_keyboard", payload=buttons)


# ==================== ОБРАБОТЧИКИ ====================

@dp.bot_started()
async def handle_started(event: BotStarted):
    user = event.user
    name = getattr(user, 'first_name', 'друг')
    username = getattr(user, 'username', None)

    is_new = add_user(user.user_id, event.chat_id, username, name)
    logger.info(f"{'Новый' if is_new else 'Вернувшийся'} пользователь: {name}")

    await bot.send_message(
        chat_id=event.chat_id,
        text=f"👋 Привет, {name}!\n\nДобро пожаловать! Чем могу помочь?",
        attachments=[create_main_menu()]
    )


@dp.message_created(Command('start'))
async def cmd_start(event: MessageCreated):
    user = event.message.sender
    name = getattr(user, 'first_name', 'друг')

    await bot.send_message(
        chat_id=event.message.recipient.chat_id,
        text=f"👋 Привет, {name}!\n\nВыберите действие:",
        attachments=[create_main_menu()]
    )


@dp.message_created(Command('help'))
async def cmd_help(event: MessageCreated):
    await event.message.answer(
        "📋 **Справка**\n\n"
        "Доступные команды:\n"
        "• /start — Главное меню\n"
        "• /help — Эта справка\n"
        "• /support — Связаться с поддержкой\n\n"
        "Просто напишите ваш вопрос!",
        parse_mode=ParseMode.MARKDOWN
    )


@dp.message_callback(F.callback.payload == "help")
async def callback_help(event: MessageCallback):
    await event.answer(notification="📋 Справка")
    await bot.send_message(
        chat_id=event.message.recipient.chat_id,
        text="📋 **Справка**\n\nИспользуйте меню для навигации.",
        parse_mode=ParseMode.MARKDOWN
    )


@dp.message_callback(F.callback.payload == "support")
async def callback_support(event: MessageCallback):
    user_id = event.callback.user.user_id
    user_states[user_id] = UserState.SUPPORT_MODE

    await event.answer(notification="💬 Режим поддержки")

    exit_btn = CallbackButton(text="🔙 Выйти", payload="exit_support", intent=Intent.DEFAULT)
    buttons = ButtonsPayload(buttons=[[exit_btn]])

    await bot.send_message(
        chat_id=event.message.recipient.chat_id,
        text="💬 **Поддержка**\n\nОпишите вашу проблему:",
        parse_mode=ParseMode.MARKDOWN,
        attachments=[Attachment(type="inline_keyboard", payload=buttons)]
    )


@dp.message_callback(F.callback.payload == "exit_support")
async def callback_exit_support(event: MessageCallback):
    user_id = event.callback.user.user_id
    user_states.pop(user_id, None)

    await event.answer(notification="✅ Вы вышли из поддержки")
    await event.message.edit(text="✅ Вы вышли из режима поддержки.", attachments=[])


@dp.message_callback(F.callback.payload == "about")
async def callback_about(event: MessageCallback):
    await event.answer(notification="ℹ️ О боте")
    await bot.send_message(
        chat_id=event.message.recipient.chat_id,
        text="ℹ️ **О боте**\n\n"
             "Версия: 1.0.0\n"
             "Создан для автоматизации рабочих процессов.\n\n"
             "Разработка: mediaten.ru",
        parse_mode=ParseMode.MARKDOWN
    )


@dp.message_created(F.message.body.text)
async def handle_text(event: MessageCreated):
    text = event.message.body.text
    user_id = event.message.sender.user_id
    state = user_states.get(user_id, UserState.IDLE)

    if state == UserState.SUPPORT_MODE:
        # Пересылаем админу
        name = getattr(event.message.sender, 'first_name', 'Пользователь')
        logger.info(f"Сообщение в поддержку от {name}: {text[:50]}...")

        await event.message.answer(
            "✅ Сообщение отправлено!\n"
            "Мы ответим в ближайшее время."
        )
    elif state == UserState.IMAGE_MODE:
        # Генерация изображения
        image_url = await generate_image(text)
        await event.message.answer(f"Готово! Вот ваше изображение: {image_url}")
    elif state == UserState.TEXT_MODE:
        # Обработка запроса через ChatGPT
        chat_response = await chat_with_gpt(text)
        await event.message.answer(f"Ответ от ChatGPT: {chat_response}")
    else:
        await event.message.answer(
            "Не понял вас. Используйте /help для справки."
        )


# ==================== Интеграция с OpenAI ====================

# Функция для генерации изображения с OpenAI (DALL·E)
async def generate_image(prompt: str):
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json"
    }
    
    data = {
        "model": "dall-e-2",  # Используем модель DALL·E для генерации изображений
        "prompt": prompt,
        "num_images": 1,
        "size": "1024x1024"
    }

    async with httpx.AsyncClient() as client:
        response = await client.post("https://api.openai.com/v1/images/generations", json=data, headers=headers)

    if response.status_code == 200:
        result = response.json()
        image_url = result["data"][0]["url"]
        return image_url
    else:
        return f"❌ Ошибка при генерации изображения: {response.status_code}, {response.text}"

# Функция для общения с ChatGPT
async def chat_with_gpt(prompt: str):
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json"
    }

    data = {
        "model": "gpt-3.5-turbo",  # Используем более дешевую модель
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 100
    }

    async with httpx.AsyncClient() as client:
        response = await client.post("https://api.openai.com/v1/chat/completions", json=data, headers=headers)

    if response.status_code == 200:
        result = response.json()
        text = result["choices"][0]["message"]["content"].strip()
        return text
    else:
        return f"❌ Ошибка при общении с ChatGPT: {response.status_code}, {response.text}"


# ==================== ЗАПУСК ====================

async def main():
    logger.info("Запуск бота...")

    # Регистрация команд
    await bot.set_my_commands(
        BotCommand(name="start", description="Главное меню"),
        BotCommand(name="help", description="Справка"),
        BotCommand(name="support", description="Поддержка"),
    )

    await bot.delete_webhook()
    logger.info("Бот запущен")
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
