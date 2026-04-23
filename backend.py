import asyncio
import time
from fastapi import FastAPI
from pydantic import BaseModel
import httpx
import os

app = FastAPI()

# ===== CONFIG =====
WORKER_URL = os.getenv("WORKER_URL")  # URL воркера
MAX_QUEUE = 300

# ===== STORAGE =====
USERS = {}
active_generations = set()
LAST_REQUEST_TIME = {}

# ===== MODEL =====
class ActionRequest(BaseModel):
    user_id: int
    action: str | None = None
    text: str | None = None


# ===== USER =====
def get_user(user_id):
    if user_id not in USERS:
        USERS[user_id] = {
            "mode": None,
            "last_prompt": None,
        }
    return USERS[user_id]


# ===== UTILS =====
def check_rate_limit(user_id):
    now = time.time()
    last = LAST_REQUEST_TIME.get(user_id, 0)

    if now - last < 2:
        return False

    LAST_REQUEST_TIME[user_id] = now
    return True


# ===== ACTION =====
@app.post("/action")
async def action(req: ActionRequest):
    user = get_user(req.user_id)

    if req.action == "photo":
        user["mode"] = "image"
        return {"text": "🖼 Режим изображения\nНапиши текст"}

    if req.action == "video":
        user["mode"] = "video"
        return {"text": "🎬 Режим видео\nНапиши текст"}

    if req.action == "music":
        user["mode"] = "music"
        return {"text": "🎵 Напиши текст песни"}

    if req.action == "repeat":
        if not user["last_prompt"]:
            return {"text": "⚠️ Нет данных"}

        return await send_to_worker(req.user_id, user["last_prompt"], user["mode"])

    return {"text": "❓ Неизвестное действие"}


# ===== MESSAGE =====
@app.post("/message")
async def message(req: ActionRequest):
    user = get_user(req.user_id)

    if not user["mode"]:
        return {
            "text": "⚠️ Выбери режим",
            "buttons": [
                {"text": "🖼 Фото", "action": "photo"},
                {"text": "🎬 Видео", "action": "video"},
                {"text": "🎵 Музыка", "action": "music"},
            ]
        }

    if not check_rate_limit(req.user_id):
        return {"text": "⏳ Подожди"}

    if req.user_id in active_generations:
        return {"text": "⏳ Уже генерируется"}

    user["last_prompt"] = req.text

    return await send_to_worker(req.user_id, req.text, user["mode"])


# ===== SEND TO WORKER =====
async def send_to_worker(user_id, prompt, mode):
    active_generations.add(user_id)

    async with httpx.AsyncClient() as client:
        await client.post(f"{WORKER_URL}/generate", json={
            "user_id": user_id,
            "prompt": prompt,
            "mode": mode
        })

    return {"text": "⏳ Генерация запущена..."}


# ===== RESULT FROM WORKER =====
@app.post("/result")
async def result(data: dict):
    user_id = data["user_id"]

    active_generations.discard(user_id)

    print(f"✅ RESULT for {user_id}: {data}")

    # 👉 тут потом отправка обратно в MAX

    return {"status": "ok"}


@app.get("/")
async def root():
    return {"status": "backend ok"}
