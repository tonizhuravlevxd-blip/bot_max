import asyncio
import time
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

# ================== ХРАНЕНИЕ ==================
USERS = {}
active_generations = set()
LAST_REQUEST_TIME = {}

# ================== ОЧЕРЕДИ ==================
generation_queue_image = asyncio.Queue()
generation_queue_video = asyncio.Queue()
generation_queue_music = asyncio.Queue()

# ================== НАСТРОЙКИ ==================
MAX_QUEUE = 300
RATE_LIMIT_SECONDS = 2


# ================== МОДЕЛЬ ==================
class ActionRequest(BaseModel):
    user_id: int
    action: str | None = None
    text: str | None = None


# ================== USER ==================
def get_user(user_id):
    if user_id not in USERS:
        USERS[user_id] = {
            "mode": None,
            "last_prompt": None,
            "last_images": [],
            "generation_count": 0,
        }
    return USERS[user_id]


# ================== УТИЛИТЫ ==================
def check_rate_limit(user_id):
    now = time.time()
    last = LAST_REQUEST_TIME.get(user_id, 0)

    if now - last < RATE_LIMIT_SECONDS:
        return False

    LAST_REQUEST_TIME[user_id] = now
    return True


def get_queue_size():
    return (
        generation_queue_image.qsize()
        + generation_queue_video.qsize()
        + generation_queue_music.qsize()
    )


# ================== ACTION (КНОПКИ) ==================
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
            return {"text": "⚠️ Нет данных для повторной генерации"}

        return await add_to_queue(req.user_id, user["last_prompt"], user["mode"])

    if req.action == "reset":
        USERS[req.user_id] = {
            "mode": None,
            "last_prompt": None,
            "last_images": [],
            "generation_count": 0,
        }
        return {"text": "🔄 Сброшено"}

    return {"text": "❓ Неизвестное действие"}


# ================== MESSAGE ==================
@app.post("/message")
async def message(req: ActionRequest):
    user = get_user(req.user_id)

    # нет режима
    if not user["mode"]:
        return {
            "text": "⚠️ Сначала выбери режим",
            "buttons": [
                {"text": "🖼 Фото", "action": "photo"},
                {"text": "🎬 Видео", "action": "video"},
                {"text": "🎵 Музыка", "action": "music"},
            ],
        }

    # анти-флуд
    if not check_rate_limit(req.user_id):
        return {"text": "⏳ Подожди 2 секунды"}

    # уже генерирует
    if req.user_id in active_generations:
        return {"text": "⏳ Уже генерируется..."}

    # перегрузка
    if get_queue_size() > MAX_QUEUE:
        return {"text": "🚫 Сервер перегружен"}

    prompt = req.text

    if not prompt or len(prompt) > 800:
        return {"text": "⚠️ Неверный текст"}

    user["last_prompt"] = prompt

    return await add_to_queue(req.user_id, prompt, user["mode"])


# ================== ДОБАВЛЕНИЕ В ОЧЕРЕДЬ ==================
async def add_to_queue(user_id, prompt, mode):
    active_generations.add(user_id)

    job = {
        "user_id": user_id,
        "prompt": prompt,
        "mode": mode,
        "created_at": time.time(),
    }

    queue_map = {
        "image": generation_queue_image,
        "video": generation_queue_video,
        "music": generation_queue_music,
    }

    queue = queue_map.get(mode, generation_queue_image)

    position = queue.qsize() + 1

    await queue.put(job)

    return {
        "text": f"⏳ В очереди: {position}\nГенерация началась..."
    }


# ================== ВОРКЕРЫ ==================
async def worker(queue, name):
    while True:
        job = await queue.get()

        user_id = job["user_id"]
        prompt = job["prompt"]
        mode = job["mode"]

        print(f"🔥 [{name}] {mode} | {prompt}")

        # имитация генерации
        await asyncio.sleep(5)

        print(f"✅ Готово для {user_id}")

        active_generations.discard(user_id)


# ================== ROOT (фикс 404) ==================
@app.get("/")
async def root():
    return {"status": "ok"}


# ================== STARTUP ==================
@app.on_event("startup")
async def startup():

    # IMAGE воркеры
    for _ in range(5):
        asyncio.create_task(worker(generation_queue_image, "IMAGE"))

    # VIDEO воркеры
    for _ in range(2):
        asyncio.create_task(worker(generation_queue_video, "VIDEO"))

    # MUSIC воркеры
    for _ in range(2):
        asyncio.create_task(worker(generation_queue_music, "MUSIC"))

    print("🚀 MAX бот запущен")
