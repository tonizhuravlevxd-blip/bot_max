import os
import tempfile

import cv2
import numpy as np
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import Response

from .video_maker import make_video_from_image_bgr, make_video_from_image_bgr  # just in case lint


from video_maker import make_video_from_image_b64  # или как у тебя называется функция

app = FastAPI()

def decode_image_bytes(image_bytes: bytes):
    arr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return img

@app.post("/make-video")
async def make_video(
    file: UploadFile = File(...),
    prompt: str = Form(...),
):
    duration_sec = float(os.getenv("VIDEO_DURATION_SEC", "2.5"))
    fps = int(os.getenv("VIDEO_FPS", "12"))

    image_bytes = await file.read()
    img = decode_image_bytes(image_bytes)

    if img is None:
        return Response(status_code=400, content=b"Failed to decode image")

    frames, fps_out = make_video_from_image_b64(img, prompt, duration_sec=duration_sec, fps=fps)

    with tempfile.TemporaryDirectory() as td:
        out_path = os.path.join(td, "out.mp4")
        h, w = frames[0].shape[:2]

        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(out_path, fourcc, fps_out, (w, h))
        if not writer.isOpened():
            return Response(status_code=500, content=b"VideoWriter not opened")

        for fr in frames:
            writer.write(fr)

        writer.release()

        mp4_bytes = open(out_path, "rb").read()

    return Response(content=mp4_bytes, media_type="video/mp4")
