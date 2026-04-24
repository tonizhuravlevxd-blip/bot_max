import asyncio
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import httpx
import os

# Настроим FastAPI приложение
app = FastAPI()

# Переменные окружения
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
BACKEND_URL = os.getenv("BACKEND_URL")

# Очередь для обработки задач
queue = asyncio.Queue()

# Модели запроса от пользователя
class GenerateRequest(BaseModel):
    user_id: int
    prompt: str
    mode: str  # "image" для генерации изображения или "text" для ChatGPT

# Эндпоинт для получения запроса на генерацию
@app.post("/generate")
async def generate(req: GenerateRequest):
    await queue.put(req.dict())
    return {"status": "queued"}

# Функция для обработки очереди и генерации
async def worker():
    while True:
        job = await queue.get()

        user_id = job["user_id"]
        prompt = job["prompt"]
        mode = job["mode"]

        print(f"🔥 {mode} | {prompt}")

        # Генерация изображения с OpenAI (если mode == "image")
        if mode == "image":
            result = await generate_image(prompt)
        # Генерация текста с ChatGPT (если mode == "text")
        elif mode == "text":
            result = await chat_with_gpt(prompt)
        else:
            result = "❌ Неизвестный режим"

        # Отправка результата обратно в бэкенд
        async with httpx.AsyncClient() as client:
            response = await client.post(f"{BACKEND_URL}/result", json={
                "user_id": user_id,
                "result": result
            })

        if response.status_code != 200:
            print(f"Ошибка при отправке результата для пользователя {user_id}")
        else:
            print(f"Результат успешно отправлен для пользователя {user_id}")

# Функция для генерации изображения с OpenAI API (например, DALL·E)
async def generate_image(prompt: str):
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json"
    }

    data = {
        "model": "dall-e-2",  # или другой подходящий OpenAI модель
        "prompt": prompt,
        "num_images": 1,
        "size": "1024x1024"
    }

    async with httpx.AsyncClient() as client:
        response = await client.post("https://api.openai.com/v1/images/generations", json=data, headers=headers)

    if response.status_code == 200:
        result = response.json()
        image_url = result["data"][0]["url"]
        return f"Готово! Вот ваше изображение: {image_url}"
    else:
        return f"❌ Ошибка при генерации изображения: {response.status_code}, {response.text}"

# Функция для общения с ChatGPT
async def chat_with_gpt(prompt: str):
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json"
    }

    data = {
        "model": "text-davinci-003",  # Или другой подходящий модель ChatGPT
        "prompt": prompt,
        "max_tokens": 100
    }

    async with httpx.AsyncClient() as client:
        response = await client.post("https://api.openai.com/v1/completions", json=data, headers=headers)

    if response.status_code == 200:
        result = response.json()
        text = result["choices"][0]["text"].strip()
        return f"Ответ от ChatGPT: {text}"
    else:
        return f"❌ Ошибка при общении с ChatGPT: {response.status_code}, {response.text}"

# Запуск воркера при старте
@app.on_event("startup")
async def startup():
    for _ in range(5):  # Запуск 5 воркеров для параллельной обработки
        asyncio.create_task(worker())
    print("🚀 Worker запущен")

# Главная страница
@app.get("/")
async def root():
    return {"status": "worker ok"}
