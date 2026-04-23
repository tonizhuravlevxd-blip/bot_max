import asyncio
from fastapi import FastAPI
from pydantic import BaseModel
import httpx
import os

app = FastAPI()

BACKEND_URL = os.getenv("BACKEND_URL")

queue = asyncio.Queue()


class GenerateRequest(BaseModel):
    user_id: int
    prompt: str
    mode: str


@app.post("/generate")
async def generate(req: GenerateRequest):
    await queue.put(req.dict())
    return {"status": "queued"}


async def worker():
    while True:
        job = await queue.get()

        user_id = job["user_id"]
        prompt = job["prompt"]
        mode = job["mode"]

        print(f"🔥 {mode} | {prompt}")

        # ===== ТУТ РЕАЛЬНАЯ ГЕНЕРАЦИЯ =====
        await asyncio.sleep(5)

        result = f"Готово: {mode} | {prompt}"

        # ===== ОТПРАВКА ОБРАТНО =====
        async with httpx.AsyncClient() as client:
            await client.post(f"{BACKEND_URL}/result", json={
                "user_id": user_id,
                "result": result
            })


@app.on_event("startup")
async def startup():
    for _ in range(5):
        asyncio.create_task(worker())

    print("🚀 Worker запущен")


@app.get("/")
async def root():
    return {"status": "worker ok"}
