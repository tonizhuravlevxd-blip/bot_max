import math
import cv2
import numpy as np


def parse_effect_params(prompt: str):
    p = (prompt or "").lower()

    # базовая интенсивность
    intensity = 0.35
    for k in ["сильн", "динами", "актив", "движ", "энерг", "драм"]:
        if k in p:
            intensity = 0.6
    for k in ["мягк", "нежн", "тих", "спокой"]:
        if k in p:
            intensity = 0.25
    if "поворот" in p or "rotate" in p:
        intensity = min(0.85, intensity + 0.1)

    # режим
    mode = "camera_move"
    if any(k in p for k in ["дождь", "rain", "ливень", "storm", "stormy"]):
        mode = "rain"
    elif any(k in p for k in ["кинематограф", "кино", "cinematic", "драм", "dram"]):
        mode = "cinematic"
    elif any(k in p for k in ["мягк", "нежн", "soft", "спокой", "calm"]):
        mode = "soft"
    elif any(k in p for k in ["глич", "glitch", "сбой", "glitchy"]):
        mode = "glitch"
    elif any(k in p for k in ["зум", "zoom", "приблизи", "макро", "macro"]):
        mode = "zoom"

    # параметры движения по режимам
    if mode == "soft":
        motion_scale = 0.7
        shake_scale = 0.35
        blur_scale = 1.0
    elif mode == "cinematic":
        motion_scale = 1.0
        shake_scale = 0.55
        blur_scale = 0.6
    elif mode == "glitch":
        motion_scale = 0.95
        shake_scale = 0.25
        blur_scale = 0.0
    elif mode == "zoom":
        motion_scale = 0.75
        shake_scale = 0.25
        blur_scale = 0.7
    elif mode == "rain":
        # дождь: чуть более “мягкая” камера + дождевые капли
        motion_scale = 0.85
        shake_scale = 0.25
        blur_scale = 0.8
    else:
        motion_scale = 1.0
        shake_scale = 0.55
        blur_scale = 0.6

    return intensity, mode, motion_scale, shake_scale, blur_scale


def make_video_from_image_b64(
    image_bgr: np.ndarray,
    prompt: str,
    duration_sec: float = 2.5,
    fps: int = 12
):
    intensity, mode, motion_scale, shake_scale, blur_scale = parse_effect_params(prompt)

    frames = max(12, int(duration_sec * fps))

    h, w = image_bgr.shape[:2]

    out_w = min(720, w)
    out_h = int(out_w * h / w)

    img2 = cv2.resize(image_bgr, (out_w, out_h), interpolation=cv2.INTER_AREA)
    h2, w2 = img2.shape[:2]
    cx, cy = w2 / 2, h2 / 2

    # контур для "shake"
    gray = cv2.cvtColor(img2, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 30, 100)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)
    mask = edges.astype(np.float32) / 255.0
    mask = cv2.GaussianBlur(mask, (0, 0), 2)

    # виньетка (нужно для cinematic)
    yy, xx = np.mgrid[0:h2, 0:w2]
    dx = (xx - cx) / (w2 / 2)
    dy = (yy - cy) / (h2 / 2)
    r = dx * dx + dy * dy
    vignette = np.clip(1.0 - r, 0, 1).astype(np.float32)
    vignette = cv2.GaussianBlur(vignette, (0, 0), 25)

    # ---- подготовка дождя (один раз на весь клип) ----
    if mode == "rain":
        # капель меньше, чтобы не было тормозов
        drop_count = int(max(180, min(520, (h2 * w2) / 5200)))

        rng = np.random.default_rng(42)
        rain_x = rng.integers(0, w2, size=drop_count, dtype=np.int32)
        rain_y0 = rng.integers(-h2, h2, size=drop_count, dtype=np.int32)
        rain_len = rng.integers(10, 28, size=drop_count, dtype=np.int32)
        rain_thick = rng.integers(1, 2, size=drop_count, dtype=np.int32)

        # скорость падения
        drop_speed = rng.uniform(12, 28, size=drop_count).astype(np.float32) * (0.7 + intensity)

        max_len = int(np.max(rain_len))
        rain_period = h2 + max_len * 2

    out_frames = []
    prev = None

    for i in range(frames):
        t = i / max(1, frames - 1)

        # движение камеры
        base_pan = (w2 * 0.03) * motion_scale
        base_pan_y = (h2 * 0.03) * motion_scale
        base_zoom = 1.0 + (math.sin(t * 2 * math.pi) * intensity) * 0.04 * motion_scale
        base_rot = (math.sin(t * 2 * math.pi) * intensity) * 2.0 * motion_scale

        # zoom-mode усиливаем zoom и уменьшаем pan
        if mode == "zoom":
            base_pan *= 0.45
            base_pan_y *= 0.45
            base_zoom = 1.0 + (math.sin(t * 2 * math.pi) * intensity) * 0.08

        dx_shift = (math.sin(t * 2 * math.pi) * intensity) * base_pan
        dy_shift = (math.cos(t * 2 * math.pi) * intensity) * base_pan_y
        angle = base_rot
        zoom = base_zoom

        M = cv2.getRotationMatrix2D((cx, cy), angle, zoom)
        M[0, 2] += dx_shift
        M[1, 2] += dy_shift

        warped = cv2.warpAffine(
            img2, M, (w2, h2),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_REFLECT
        )

        # "shake" (по контуру)
        if mode != "glitch":
            noise = np.random.normal(0, 1, (h2, w2)).astype(np.float32)
            noise = cv2.GaussianBlur(noise, (0, 0), 2)
            shake = (mask * intensity * 8.0 * shake_scale).astype(np.float32)

            warped_f = warped.astype(np.float32)
            for c in range(3):
                warped_f[:, :, c] = warped_f[:, :, c] + noise * shake
            warped = np.clip(warped_f, 0, 255).astype(np.uint8)

        # soft blur
        if mode == "soft" and blur_scale > 0:
            k = 5 if intensity > 0.4 else 3
            warped = cv2.GaussianBlur(warped, (k, k), 0)

        # cinematic: контраст + виньетка + grain
        if mode == "cinematic":
            alpha = 1.10 + 0.15 * intensity
            beta = -10
            warped = cv2.convertScaleAbs(warped, alpha=alpha, beta=beta)

            warped_f = warped.astype(np.float32)
            for c in range(3):
                warped_f[:, :, c] *= vignette
            warped = np.clip(warped_f, 0, 255).astype(np.uint8)

            grain = np.random.normal(0, 6, (h2, w2, 1)).astype(np.float32)
            warped_f = warped.astype(np.float32)
            warped_f += grain
            warped = np.clip(warped_f, 0, 255).astype(np.uint8)

        # glitch: сдвиги каналов + редкие полосы
        if mode == "glitch":
            shift = int((math.sin(t * 2 * math.pi) * intensity) * 6)
            if shift != 0:
                ch_b, ch_g, ch_r = cv2.split(warped)
                ch_b = np.roll(ch_b, shift, axis=1)
                ch_r = np.roll(ch_r, -shift, axis=1)
                warped = cv2.merge([ch_b, ch_g, ch_r])

            if i % max(2, frames // 12) == 0:
                for _ in range(3):
                    y = np.random.randint(0, h2 - 1)
                    hh = np.random.randint(2, 8)
                    warped[max(0, y):min(h2, y + hh), :] = warped[max(0, y):min(h2, y + hh), :][:, ::-1]

        # ---- дождь overlay ----
        if mode == "rain":
            rain_img = np.zeros((h2, w2, 3), dtype=np.uint8)

            # y: старт + скорость*i, затем “заворачиваем” по периоду
            y_pos = rain_y0 + drop_speed * float(i)
            y_mod = (np.mod(y_pos + max_len, rain_period) - max_len)

            color = (180, 200, 255)
            for x, y, L, T in zip(rain_x, y_mod, rain_len, rain_thick):
                yy_i = int(y)
                if yy_i < -30 or yy_i > h2 + 30:
                    continue
                cv2.line(
                    rain_img,
                    (int(x), yy_i),
                    (int(x), yy_i + int(L)),
                    color,
                    int(T)
                )

            rain_img = cv2.GaussianBlur(rain_img, (3, 3), 0)

            # прозрачность и лёгкое “стекло”
            alpha = float(0.18 + 0.25 * intensity)  # ~0.18..0.39
            warped = cv2.addWeighted(warped, 1.0 - alpha, rain_img, alpha, 0)

            # дополнительная мягкость
            warped = cv2.GaussianBlur(warped, (3, 3), 0)

        # минимальный motion blur (для cinematic/soft/rain)
        if mode in ["cinematic", "soft", "rain"] and prev is not None and blur_scale > 0:
            a = 0.15 + 0.2 * intensity
            warped = cv2.addWeighted(warped, 1.0, prev, a, 0)

        out_frames.append(warped)
        prev = warped.copy()

    return out_frames, fps
