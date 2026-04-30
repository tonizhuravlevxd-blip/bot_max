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

    # движение (motion_mode)
    motion_mode = "camera_move"
    if any(k in p for k in ["кинематограф", "кино", "cinematic", "драм", "dram"]):
        motion_mode = "cinematic"
    elif any(k in p for k in ["мягк", "нежн", "soft", "спокой", "calm"]):
        motion_mode = "soft"
    elif any(k in p for k in ["глич", "glitch", "сбой", "glitchy"]):
        motion_mode = "glitch"
    elif any(k in p for k in ["зум", "zoom", "приблизи", "макро", "macro"]):
        motion_mode = "zoom"

    # параметры движения по режимам
    if motion_mode == "soft":
        motion_scale = 0.7
        shake_scale = 0.35
        blur_scale = 1.0
    elif motion_mode == "cinematic":
        motion_scale = 1.0
        shake_scale = 0.55
        blur_scale = 0.6
    elif motion_mode == "glitch":
        motion_scale = 0.95
        shake_scale = 0.25
        blur_scale = 0.0
    elif motion_mode == "zoom":
        motion_scale = 0.75
        shake_scale = 0.25
        blur_scale = 0.7
    else:
        motion_scale = 1.0
        shake_scale = 0.55
        blur_scale = 0.6

    # overlay эффекты (can stack)
    want_rain = any(k in p for k in ["дождь", "rain", "ливень", "storm", "stormy"])
    want_snow = any(k in p for k in ["снег", "snow", "метель", "blizzard"])
    want_fog = any(k in p for k in ["туман", "дымка", "fog", "haze", "mist"])
    want_fire = any(k in p for k in ["огонь", "пламя", "fire", "flame", "burn"])
    want_neon = any(k in p for k in ["неон", "neon", "неоновые", "glow", "lights", "свет"])

    return intensity, motion_mode, motion_scale, shake_scale, blur_scale, want_rain, want_snow, want_fog, want_fire, want_neon


def make_video_from_image_b64(image_bgr: np.ndarray, prompt: str, duration_sec: float = 2.5, fps: int = 12):
    intensity, motion_mode, motion_scale, shake_scale, blur_scale, want_rain, want_snow, want_fog, want_fire, want_neon = parse_effect_params(
        prompt
    )

    frames = max(12, int(duration_sec * fps))

    h, w = image_bgr.shape[:2]

    out_w = min(720, w)
    out_h = int(out_w * h / w)

    img2 = cv2.resize(image_bgr, (out_w, out_h), interpolation=cv2.INTER_AREA)
    h2, w2 = img2.shape[:2]
    cx, cy = w2 / 2, h2 / 2

    # контур для shake / neon
    gray = cv2.cvtColor(img2, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 30, 100)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)

    mask = edges.astype(np.float32) / 255.0
    mask = cv2.GaussianBlur(mask, (0, 0), 2)

    # виньетка (cinematic)
    yy, xx = np.mgrid[0:h2, 0:w2]
    dxn = (xx - cx) / (w2 / 2)
    dyn = (yy - cy) / (h2 / 2)
    r = dxn * dxn + dyn * dyn
    vignette = np.clip(1.0 - r, 0, 1).astype(np.float32)
    vignette = cv2.GaussianBlur(vignette, (0, 0), 25)

    # Подготовка overlay-частиц (один раз)
    rng = np.random.default_rng(42)

    # rain
    if want_rain:
        drop_count = int(max(180, min(520, (h2 * w2) / 5200)))
        rain_x = rng.integers(0, w2, size=drop_count, dtype=np.int32)
        rain_y0 = rng.integers(-h2, h2, size=drop_count, dtype=np.int32)
        rain_len = rng.integers(10, 28, size=drop_count, dtype=np.int32)
        rain_thick = rng.integers(1, 2, size=drop_count, dtype=np.int32)
        rain_speed = rng.uniform(12, 28, size=drop_count).astype(np.float32) * (0.7 + intensity)
        rain_max_len = int(np.max(rain_len))
        rain_period = h2 + rain_max_len * 2

    # snow
    if want_snow:
        snow_count = int(max(160, min(520, (h2 * w2) / 4800)))
        snow_x = rng.integers(0, w2, size=snow_count, dtype=np.int32)
        snow_y0 = rng.integers(-h2, h2, size=snow_count, dtype=np.int32)
        snow_len = rng.integers(6, 18, size=snow_count, dtype=np.int32)
        snow_thick = rng.integers(1, 2, size=snow_count, dtype=np.int32)
        snow_speed = rng.uniform(4, 14, size=snow_count).astype(np.float32) * (0.6 + intensity)
        snow_max_len = int(np.max(snow_len))
        snow_period = h2 + snow_max_len * 2

    # neon mask (pre-blur для скорости)
    if want_neon:
        neon_base = (edges.astype(np.float32) / 255.0)
        neon_base = cv2.GaussianBlur(neon_base, (0, 0), 1.5)

        # цвет неона: чуть меняется от intensity
        neon_r = int(190 + 40 * intensity)
        neon_g = int(90 + 60 * intensity)
        neon_b = int(230 + 10 * intensity)

        neon_color = (neon_b, neon_g, neon_r)  # OpenCV BGR
        neon_glow_kernel = (0, 0)

    # fog gradient mask
    if want_fog:
        # “глубина”: центр чище, края/низ более туманные
        yyf, xxf = np.mgrid[0:h2, 0:w2]
        depth = 1.0 - np.clip((np.abs(yyf - 0.65 * h2) / h2) ** 1.2, 0, 1)
        fog_grad = (0.55 * (1 - depth)).astype(np.float32)
        fog_grad = cv2.GaussianBlur(fog_grad, (0, 0), 25)

    out_frames = []
    prev = None

    for i in range(frames):
        t = i / max(1, frames - 1)

        # движение камеры
        base_pan = (w2 * 0.03) * motion_scale
        base_pan_y = (h2 * 0.03) * motion_scale
        base_zoom = 1.0 + (math.sin(t * 2 * math.pi) * intensity) * 0.04 * motion_scale
        base_rot = (math.sin(t * 2 * math.pi) * intensity) * 2.0 * motion_scale

        if motion_mode == "zoom":
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

        # shake по контуру
        if motion_mode != "glitch":
            noise = np.random.normal(0, 1, (h2, w2)).astype(np.float32)
            noise = cv2.GaussianBlur(noise, (0, 0), 2)
            shake = (mask * intensity * 8.0 * shake_scale).astype(np.float32)

            warped_f = warped.astype(np.float32)
            for c in range(3):
                warped_f[:, :, c] = warped_f[:, :, c] + noise * shake
            warped = np.clip(warped_f, 0, 255).astype(np.uint8)

        # soft blur
        if motion_mode == "soft" and blur_scale > 0:
            k = 5 if intensity > 0.4 else 3
            warped = cv2.GaussianBlur(warped, (k, k), 0)

        # cinematic: контраст + виньетка + grain
        if motion_mode == "cinematic":
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
        if motion_mode == "glitch":
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

        # -------- overlays --------

        # rain
        if want_rain:
            rain_img = np.zeros((h2, w2, 3), dtype=np.uint8)
            y_pos = rain_y0 + rain_speed * float(i)
            y_mod = (np.mod(y_pos + rain_max_len, rain_period) - rain_max_len).astype(np.float32)

            color = (180, 200, 255)
            for x, y, L, T in zip(rain_x, y_mod, rain_len, rain_thick):
                yy_i = int(y)
                if yy_i < -30 or yy_i > h2 + 30:
                    continue
                cv2.line(rain_img, (int(x), yy_i), (int(x), yy_i + int(L)), color, int(T))

            rain_img = cv2.GaussianBlur(rain_img, (3, 3), 0)

            alpha = float(0.18 + 0.25 * intensity)
            warped = cv2.addWeighted(warped, 1.0 - alpha, rain_img, alpha, 0)
            warped = cv2.GaussianBlur(warped, (3, 3), 0)

        # snow
        if want_snow:
            snow_img = np.zeros((h2, w2, 3), dtype=np.uint8)
            y_pos = snow_y0 + snow_speed * float(i)
            y_mod = (np.mod(y_pos + snow_max_len, snow_period) - snow_max_len).astype(np.float32)

            # делаем снежинки “мягкими палочками”
            base_white = (230, 235, 255)
            for x, y, L, T in zip(snow_x, y_mod, snow_len, snow_thick):
                yy_i = int(y)
                if yy_i < -30 or yy_i > h2 + 30:
                    continue
                cv2.line(snow_img, (int(x), yy_i), (int(x), yy_i + int(L)), base_white, int(T))

            snow_img = cv2.GaussianBlur(snow_img, (3, 3), 0)

            alpha = float(0.10 + 0.18 * intensity)
            warped = cv2.addWeighted(warped, 1.0 - alpha, snow_img, alpha, 0)

            # лёгкая зернистость (снег “живее”)
            if intensity > 0.2:
                grain = np.random.normal(0, 10, (h2, w2, 1)).astype(np.float32) * (0.2 + intensity)
                warped_f = warped.astype(np.float32)
                warped_f += grain
                warped = np.clip(warped_f, 0, 255).astype(np.uint8)

        # fog
        if want_fog:
            # туман “дышит”
            fog_strength = 0.18 + 0.35 * intensity
            breath = 0.15 * math.sin(t * 2 * math.pi)
            fog_alpha = float(max(0.05, min(0.65, fog_strength + breath)))

            # градиент + немного по кадру
            fog_mask = fog_grad.copy()
            fog_mask = fog_mask / (np.max(fog_mask) + 1e-6)

            # туман: белёсый overlay
            fog_img = np.full((h2, w2, 3), 245, dtype=np.uint8)
            # применяем маску как “прозрачность”
            fog_alpha_map = (fog_mask * fog_alpha).astype(np.float32)
            warped_f = warped.astype(np.float32)

            for c in range(3):
                warped_f[:, :, c] = warped_f[:, :, c] * (1.0 - fog_alpha_map) + fog_img[:, :, c] * fog_alpha_map

            warped = np.clip(warped_f, 0, 255).astype(np.uint8)
            warped = cv2.GaussianBlur(warped, (5, 5), 0)

        # fire
        if want_fire:
            # “тепловая дымка” + оранжевый overlay
            base_alpha = float(0.12 + 0.25 * intensity)

            fire_img = np.zeros((h2, w2, 3), dtype=np.uint8)
            # сделать “пламя” как гладкие размытые пятна
            # (быстро и без тяжёлых моделей)
            num_blobs = 6
            for _ in range(num_blobs):
                x0 = int(rng.uniform(0, w2))
                y0 = int(rng.uniform(0, h2))
                rad = int(rng.uniform(30, 120) * (0.8 + intensity))
                col = (0, int(130 + 80 * intensity), 255)  # BGR: оранж/красн
                cv2.circle(fire_img, (x0, y0), rad, col, -1)

            fire_img = cv2.GaussianBlur(fire_img, (0, 0), 25)

            # heat shimmer: лёгкое “шевеление” по вертикали волнами
            shimmer = int((math.sin(t * 2 * math.pi) * intensity) * 4)
            if shimmer != 0:
                # сдвиг полос по Y
                out = warped.copy()
                for y in range(0, h2, 4):
                    dy = int((math.sin((y / h2) * math.pi * 2 + t * 2 * math.pi) * intensity) * 2)
                    out[y:y + 4, :] = warped[max(0, y + dy):min(h2, y + dy + 4), :]
                warped = cv2.addWeighted(out, 0.85, warped, 0.15, 0)

            warped = cv2.addWeighted(warped, 1.0 - base_alpha, fire_img, base_alpha, 0)
            warped = cv2.GaussianBlur(warped, (3, 3), 0)

        # neon
        if want_neon:
            # “bloom”: сильно размытый edge-сигнал
            neon = (edges.astype(np.float32) / 255.0)
            neon = cv2.GaussianBlur(neon, neon_glow_kernel, 3.0)

            glow_strength = float(0.12 + 0.35 * intensity)
            neon_col = np.zeros((h2, w2, 3), dtype=np.float32)
            nb, ng, nr = neon_color
            neon_col[:, :, 0] = nb
            neon_col[:, :, 1] = ng
            neon_col[:, :, 2] = nr

            warped_f = warped.astype(np.float32)
            # добавляем glow как “светимость”
            for c in range(3):
                warped_f[:, :, c] = warped_f[:, :, c] + neon_col[:, :, c] * neon * glow_strength

            warped = np.clip(warped_f, 0, 255).astype(np.uint8)
            warped = cv2.GaussianBlur(warped, (3, 3), 0)

        # минимальный motion blur (для cinematic/soft/rain/snow/fog)
        if motion_mode in ["cinematic", "soft", "camera_move"] and prev is not None and blur_scale > 0:
            if want_rain or want_snow or want_fog:
                a = 0.12 + 0.18 * intensity
                warped = cv2.addWeighted(warped, 1.0, prev, a, 0)
            elif motion_mode in ["cinematic", "soft"]:
                a = 0.15 + 0.2 * intensity
                warped = cv2.addWeighted(warped, 1.0, prev, a, 0)

        out_frames.append(warped)
        prev = warped.copy()

    return out_frames, fps
