import time
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import httpx
import os

# Инициализация FastAPI приложения
app = FastAPI()

# Переменные окружения для OpenAI API
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
BACKEND_URL = os.getenv("BACKEND_URL")  # URL для отправки результатов обратно

# Хранение состояния пользователей и запросов
USERS = {}
active_generations = set()
LAST_REQUEST_TIME = {}

# Модели запросов от пользователей
class ActionRequest(BaseModel):
    user_id: int
    action: str | None = None
    text: str | None = None

# Функция для получения пользователя
def get_user(user_id):
    if user_id not in USERS:
        USERS[user_id] = {
            "mode": None,
            "last_prompt": None,
        }
    return USERS[user_id]

# Проверка лимита запросов
def check_rate_limit(user_id):
    now = time.time()
    last = LAST_REQUEST_TIME.get(user_id, 0)
    if now - last < 2:
        return False
    LAST_REQUEST_TIME[user_id] = now
    return True

# Обработка запроса на создание изображения через OpenAI (DALL·E)
async def generate_image(prompt: str):
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json"
    }
    
    data = {
        "model": "dall-e-2",  # Модель DALL·E для генерации изображений
        "prompt": prompt,
        "num_images": 1,
        "size": "1024x1024"  # Можно уменьшить размер для более дешевой генерации
    }

    async with httpx.AsyncClient() as client:
        response = await client.post("https://api.openai.com/v1/images/generations", json=data, headers=headers)

    if response.status_code == 200:
        result = response.json()
        image_url = result["data"][0]["url"]
        return f"Готово! Вот ваше изображение: {image_url}"
    else:
        return f"❌ Ошибка при генерации изображения: {response.status_code}, {response.text}"

# Обработка запроса к более дешевой модели ChatGPT (gpt-3.5-turbo)
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
        return f"Ответ от ChatGPT: {text}"
    else:
        return f"❌ Ошибка при общении с ChatGPT: {response.status_code}, {response.text}"

# Главный POST запрос для приема сообщений от пользователя
@app.post("/message")
async def message(req: ActionRequest):
    user = get_user(req.user_id)

    # Логирование входящего текста
    print(f"Получено сообщение от пользователя {req.user_id}: {req.text}")

    # Проверяем, если текст содержит слово "фото", то генерируем картинку
    if req.text and ("фото" in req.text.lower() or "image" in req.text.lower()):
        result = await generate_image(req.text)  # Генерация изображения
    else:
        result = await chat_with_gpt(req.text)  # Обработка запроса через ChatGPT

    # Отправка результата обратно в бэкенд
    async with httpx.AsyncClient() as client:
        response = await client.post(f"{BACKEND_URL}/result", json={
            "user_id": req.user_id,
            "result": result
        })

    if response.status_code != 200:
        raise HTTPException(status_code=500, detail="Ошибка при отправке результата")
    
    return {"status": "ok"}

# Эндпоинт для получения результата после обработки (для воркера)
@app.post("/result")
async def result(data: dict):
    print(f"✅ Результат для пользователя {data['user_id']}: {data['result']}")
    return {"status": "ok"}

# Главная страница
@app.get("/")
async def root():
    return {"status": "backend ok"}
