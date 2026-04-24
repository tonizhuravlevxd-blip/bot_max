import os
import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from maxapi import MaxAPI

# Получаем переменные окружения
MAX_BOT_TOKEN = os.getenv("MAX_BOT_TOKEN")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

# Создаем экземпляр FastAPI
app = FastAPI()

# Создаем экземпляр MaxAPI
max_api = MaxAPI(token=MAX_BOT_TOKEN)

# Класс для данных запроса
class BotRequest(BaseModel):
    text: str

# Функция для общения с OpenAI API
async def get_openai_response(prompt: str):
    url = "https://api.openai.com/v1/completions"
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": "gpt-3.5-turbo",
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 150
    }
    
    async with httpx.AsyncClient() as client:
        response = await client.post(url, headers=headers, json=payload)
        if response.status_code == 200:
            return response.json()["choices"][0]["message"]["content"]
        else:
            raise HTTPException(status_code=response.status_code, detail="Error from OpenAI API")

# Функция для генерации изображения через OpenAI
async def generate_image(prompt: str):
    url = "https://api.openai.com/v1/images/generations"
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json"
    }
    payload = {
        "prompt": prompt,
        "n": 1,
        "size": "1024x1024"
    }

    async with httpx.AsyncClient() as client:
        response = await client.post(url, headers=headers, json=payload)
        if response.status_code == 200:
            return response.json()["data"][0]["url"]
        else:
            raise HTTPException(status_code=response.status_code, detail="Error generating image")

# Обработка входящего запроса
@app.post("/process_request/")
async def process_request(request: BotRequest):
    prompt = request.text
    
    if "image" in prompt.lower():  # Если запрос на создание изображения
        # Информируем пользователя о процессе создания
        await max_api.send_message("Создаю шедевр...")  # Сообщение с "Динамическим" ответом
        
        image_url = await generate_image(prompt)
        await max_api.send_message(f"Вот твой шедевр: {image_url}")  # Отправка ссылки на картинку
        
    else:  # Запрос на ответ от ChatGPT
        # Информируем пользователя о процессе
        await max_api.send_message("Думаю над ответом...")  # Сообщение с "Динамическим" ответом
        
        response_text = await get_openai_response(prompt)
        await max_api.send_message(response_text)  # Отправка ответа от ChatGPT
    
    return {"status": "success"}

if __name__ == "__main__":
    # Запускаем приложение
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
