import math
import cv2
import numpy as np

def text_intensity(prompt: str) -> float:
    p = (prompt or "").lower()
    intensity = 0.35

    for k in ["сильн", "динами", "актив", "движ", "энерг", "драм"]:
        if k in p:
            intensity = 0.6
    for k in ["мягк", "нежн", "тих", "спокой"]:
        if k in p:
            intensity = 0.25

    if "поворот" in p or "rotate" in p:
        intensity += 0.1

    return max(0.15, min(0.85, intensity))

def make_video_from_image_b64(image_bgr: np.ndarray, prompt: str, duration_sec: float = 2.5, fps: int = 12):
    intensity = text_intensity(prompt)

    frames = max(12, int(duration_sec * fps))

    h, w = image_bgr.shape[:2]

    out_w = min(720, w)
    out_h = int(out_w * h / w)

    img2 = cv2.resize(image_bgr, (out_w, out_h), interpolation=cv2.INTER_AREA)

    h2, w2 = img2.shape[:2]
    cx, cy = w2 / 2, h2 / 2

    gray = cv2.cvtColor(img2, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 30, 100)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)
    mask = edges.astype(np.float32) / 255.0
    mask = cv2.GaussianBlur(mask, (0, 0), 2)

    out_frames = []
    for i in range(frames):
        t = i / max(1, frames - 1)

        dx = (math.sin(t * 2 * math.pi) * intensity) * (w2 * 0.03)
        dy = (math.cos(t * 2 * math.pi) * intensity) * (h2 * 0.03)

        zoom = 1.0 + (math.sin(t * 2 * math.pi) * intensity) * 0.04
        angle = (math.sin(t * 2 * math.pi) * intensity) * 2.0

        M = cv2.getRotationMatrix2D((cx, cy), angle, zoom)
        M[0, 2] += dx
        M[1, 2] += dy

        warped = cv2.warpAffine(
            img2, M, (w2, h2),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_REFLECT
        )

        noise = np.random.normal(0, 1, (h2, w2)).astype(np.float32)
        noise = cv2.GaussianBlur(noise, (0, 0), 2)
        shake = (mask * intensity * 8.0).astype(np.float32)

        warped_f = warped.astype(np.float32)
        for c in range(3):
            warped_f[:, :, c] = warped_f[:, :, c] + noise * shake
        warped = np.clip(warped_f, 0, 255).astype(np.uint8)

        out_frames.append(warped)

    return out_frames, fps
