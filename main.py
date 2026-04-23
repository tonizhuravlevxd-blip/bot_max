import asyncio
import time
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

# ====== ХРАНЕНИЕ СОСТОЯНИЯ ======
USERS = {}
active_generations = set()

# ====== ОЧЕРЕДИ ======
generation_queue = asyncio.Queue()

# ====== МОДЕЛЬ ЗАПРОСА ======
class ActionRequest(BaseModel):
    user_id: int
    action: str | None = None
    text: str | None = None


# ====== УТИЛИТЫ ======
def get_user(user_id):
    if user_id not in USERS:
        USERS[user_id] = {
            "mode": None,
            "last_prompt": None
        }
    return USERS[user_id]


# ====== ОСНОВНОЙ ACTION (КНОПКИ) ======
@app.post("/action")
async def action(req: ActionRequest):
    user = get_user(req.user_id)

    if req.action == "photo":
        user["mode"] = "image"
        return {
            "text": "🖼 Режим изображения\nНапиши текст"
        }

    if req.action == "video":
        user["mode"] = "video"
        return {
            "text": "🎬 Режим видео\nНапиши текст"
        }

    if req.action == "music":
        user["mode"] = "music"
        return {
            "text": "🎵 Напиши текст песни"
        }

    if req.action == "reset":
        user["mode"] = None
        return {
            "text": "🔄 Сброшено"
        }

    return {"text": "❓ Неизвестное действие"}


# ====== СООБЩЕНИЯ (ТЕКСТ) ======
@app.post("/message")
async def message(req: ActionRequest):
    user = get_user(req.user_id)

    if not user["mode"]:
        return {
            "text": "⚠️ Сначала выбери режим",
            "buttons": [
                {"text": "🖼 Фото", "action": "photo"},
                {"text": "🎬 Видео", "action": "video"},
                {"text": "🎵 Музыка", "action": "music"}
            ]
        }

    if req.user_id in active_generations:
        return {"text": "⏳ Уже генерируется..."}

    prompt = req.text
    user["last_prompt"] = prompt

    active_generations.add(req.user_id)

    await generation_queue.put({
        "user_id": req.user_id,
        "prompt": prompt,
        "mode": user["mode"]
    })

    return {
        "text": "⏳ Добавлено в очередь..."
    }


# ====== ВОРКЕР ======
async def worker():
    while True:
        job = await generation_queue.get()

        user_id = job["user_id"]
        prompt = job["prompt"]
        mode = job["mode"]

        print(f"🔥 Генерация: {mode} | {prompt}")

        await asyncio.sleep(5)  # имитация генерации

        print(f"✅ Готово для {user_id}")

        active_generations.discard(user_id)


# ====== ЗАПУСК ======
@app.on_event("startup")
async def startup():
    for _ in range(3):
        asyncio.create_task(worker())
