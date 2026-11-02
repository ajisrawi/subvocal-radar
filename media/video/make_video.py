"""Subvocal Radar: 90-second motion-graphics video with voiceover, music and sound effects.

Everything is generated here: frames (numpy + OpenCV + PIL), music and effects (numpy/scipy), mixed with the
voiceover from build/vo/*.wav (edge-tts, see make_vo.py), encoded with the ffmpeg bundled in imageio-ffmpeg.

    python make_vo.py        # voiceover clips (needs internet)
    python make_video.py     # -> subvocal-radar.mp4
"""
import json
import math
import os
import subprocess
import sys

import cv2
import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.io import wavfile
from scipy.signal import lfilter, butter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
BUILD = os.path.join(HERE, 'build')
W, H, FPS, SR = 1920, 1080, 30, 48000
PREVIEW = '--preview' in sys.argv          # quick low-fps pass for checking layout

# ---------------------------------------------------------------- timing
script = json.load(open(os.path.join(HERE, 'script.json'), encoding='utf-8'))
vo_durs = json.load(open(os.path.join(BUILD, 'vo', 'durations.json')))
SCENES = [s['id'] for s in script['scenes']]
durs = [max(vo_durs[s['id']] + 1.2, s['min']) for s in script['scenes']]
extra = 90.0 - sum(durs)
durs[0] += extra / 2; durs[-1] += extra / 2
starts = np.concatenate([[0], np.cumsum(durs)[:-1]])
TOTAL = float(sum(durs))
VO_DELAY = 0.45

# ---------------------------------------------------------------- palette, fonts
BG0 = np.array([15, 18, 22], np.float32)     # #0F1216
BG1 = np.array([10, 40, 42], np.float32)
TEAL = (44, 196, 176); TEAL_D = (14, 138, 130); WHITE = (232, 235, 239); MUTED = (152, 162, 174); ORANGE = (240, 138, 93)
FONT_DIR = 'C:/Windows/Fonts'
def font(name, size): return ImageFont.truetype(os.path.join(FONT_DIR, name), size)
F_BOLD, F_SEMI, F_REG = 'segoeuib.ttf', 'seguisb.ttf', 'segoeui.ttf'

def ease(x): x = min(max(x, 0.0), 1.0); return 1 - (1 - x) ** 3
def ease_io(x): x = min(max(x, 0.0), 1.0); return x * x * (3 - 2 * x)
def spring(x):
    x = min(max(x, 0.0), 1.0)
    return 1 - math.exp(-6 * x) * math.cos(10 * x)
def window(t, a, b, fade=0.35):
    """1 inside [a, b], easing in/out over `fade` seconds."""
    return min(ease((t - a) / fade), 1 - ease((t - (b - fade)) / fade)) if b > a else 0.0

# ---------------------------------------------------------------- sprites (RGBA float32)
_cache = {}
def text_sprite(s, fname, size, color=WHITE, spans=None):
    """Rendered text. spans: list of (substring, color) to recolour parts."""
    key = (s, fname, size, color, tuple(spans or ()))
    if key in _cache: return _cache[key]
    f = font(fname, size)
    x0, y0, x1, y1 = f.getbbox(s)
    im = Image.new('RGBA', (x1 - x0 + 8, y1 - y0 + 8), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.text((4 - x0, 4 - y0), s, font=f, fill=color + (255,))
    if spans:
        for sub, col in spans:
            i = s.find(sub)
            if i < 0: continue
            px = f.getlength(s[:i])
            d.text((4 - x0 + px, 4 - y0), sub, font=f, fill=col + (255,))
    a = np.asarray(im).astype(np.float32) / 255.0
    _cache[key] = a
    return a

def image_sprite(path, width):
    key = ('img', path, width)
    if key in _cache: return _cache[key]
    im = Image.open(path).convert('RGBA')
    h = int(im.height * width / im.width)
    a = np.asarray(im.resize((width, h), Image.LANCZOS)).astype(np.float32) / 255.0
    _cache[key] = a
    return a

def icon_sprite(size):
    """The Subvocal Radar icon (teal rounded square, speech bubble, radar waves), drawn at 4x and reduced."""
    key = ('icon', size)
    if key in _cache: return _cache[key]
    S = size * 4
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    grad = Image.new('RGBA', (S, S))
    gp = np.zeros((S, S, 4), np.uint8)
    yy, xx = np.mgrid[0:S, 0:S]
    t = ((xx + yy) / (2 * S))[..., None]
    c0, c1 = np.array([44, 196, 176]), np.array([14, 138, 130])
    gp[..., :3] = (c0 * (1 - t) + c1 * t).astype(np.uint8); gp[..., 3] = 255
    grad = Image.fromarray(gp)
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, S - 1, S - 1), radius=int(S * 0.234), fill=255)
    im.paste(grad, (0, 0), mask)
    d = ImageDraw.Draw(im)
    u = S / 128.0
    lw = int(6.5 * u)
    bubble = [(26, 26), (102, 26), (112, 36), (112, 78), (102, 88), (58, 88), (41, 103), (41, 88), (26, 88), (16, 78), (16, 36)]
    d.line([(x * u + 6 * u, y * u + 6 * u) for x, y in bubble + bubble[:1]], fill=(255, 255, 255, 255), width=lw, joint='curve')
    cx, cy = 44 * u, 63 * u
    d.ellipse((cx - 6.5 * u, cy - 6.5 * u, cx + 6.5 * u, cy + 6.5 * u), fill=(255, 255, 255, 255))
    for r, a in ((18, 255), (31, 205), (44, 140)):
        d.arc((cx - r * u + 13 * u, cy - r * u, cx + r * u + 13 * u, cy + r * u), -55, 55, fill=(255, 255, 255, a), width=lw)
    small = im.resize((size, size), Image.LANCZOS)
    arr = np.asarray(small).astype(np.float32) / 255.0
    _cache[key] = arr
    return arr

def paste(frame, spr, cx, cy, alpha=1.0, scale=1.0, anchor='c'):
    if alpha <= 0.003: return
    s = spr
    if abs(scale - 1.0) > 1e-3:
        h, w = spr.shape[:2]
        nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
        s = cv2.resize(spr, (nw, nh), interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR)
    h, w = s.shape[:2]
    if anchor == 'c': x0, y0 = int(cx - w / 2), int(cy - h / 2)
    elif anchor == 'l': x0, y0 = int(cx), int(cy - h / 2)
    elif anchor == 'r': x0, y0 = int(cx - w), int(cy - h / 2)
    x1, y1 = x0 + w, y0 + h
    fx0, fy0, fx1, fy1 = max(0, x0), max(0, y0), min(W, x1), min(H, y1)
    if fx1 <= fx0 or fy1 <= fy0: return
    sub = s[fy0 - y0:fy1 - y0, fx0 - x0:fx1 - x0]
    a = sub[..., 3:4] * alpha
    frame[fy0:fy1, fx0:fx1] = frame[fy0:fy1, fx0:fx1] * (1 - a) + sub[..., :3] * 255.0 * a

def layer(frame, draw_fn, alpha):
    """Draw with OpenCV on a copy and blend (for anti-aliased lines with opacity)."""
    if alpha <= 0.003: return
    lay = frame.copy()
    draw_fn(lay)
    frame[:] = frame * (1 - alpha) + lay * alpha

# ---------------------------------------------------------------- background
_yy, _xx = np.mgrid[0:H, 0:W].astype(np.float32)
_rad = np.sqrt(((_xx - W * 0.5) / W) ** 2 + ((_yy - H * 0.55) / H) ** 2)
_vign = np.clip(1.0 - _rad * 1.25, 0, 1)[..., None]
BG = (BG0 * (1 - _vign * 0.55) + BG1 * _vign * 0.55).astype(np.float32)
_dots = np.zeros((H, W), np.float32)
_dots[::48, ::48] = 1.0
_dots = cv2.GaussianBlur(_dots, (3, 3), 0)[..., None] * 9.0

def background(t):
    f = BG.copy()
    f += _dots * 38.0 * _vign
    return f

def radar_rings(f, cx, cy, t, alpha=1.0, color=TEAL, period=2.6, maxr=900, n=4):
    def draw(lay):
        for k in range(n):
            p = ((t / period) + k / n) % 1.0
            r = int(40 + p * maxr)
            col = tuple(int(c * (1 - p) + b * p) for c, b in zip(color, (15, 18, 22)))
            cv2.circle(lay, (int(cx), int(cy)), r, col, 2, cv2.LINE_AA)
    layer(f, draw, alpha)

# ---------------------------------------------------------------- motion signal for the jaw / trace
def articulation(t):
    """A plausible jaw/lip displacement (mm): bursts of 4-8 Hz movement, like silently mouthed syllables."""
    v = 0.0
    for c, a, w, fq in ((0.8, 0.9, 0.35, 5.0), (2.2, 1.2, 0.5, 4.2), (3.6, 0.7, 0.3, 6.5), (5.0, 1.0, 0.45, 5.5), (6.6, 0.8, 0.4, 4.8)):
        tt = (t % 7.6) - c
        v += a * math.exp(-0.5 * (tt / w) ** 2) * math.sin(2 * math.pi * fq * tt)
    return v

# ---------------------------------------------------------------- scenes (t = seconds since scene start, d = scene length)
def s_hook(f, t, d):
    radar_rings(f, W / 2, H / 2, t, 0.55, maxr=1100)
    a1 = window(t, 0.4, d - 0.2); a2 = window(t, 2.0, d - 0.2)
    l1 = text_sprite('What if you could talk to your computer', F_SEMI, 72)
    l2 = text_sprite('without making a sound?', F_BOLD, 96, WHITE, [('a sound?', TEAL)])
    paste(f, l1, W / 2, H / 2 - 70 + 30 * (1 - ease((t - 0.4) / 0.8)), a1)
    paste(f, l2, W / 2, H / 2 + 60 + 30 * (1 - ease((t - 2.0) / 0.8)), a2)

def card(f, cx, cy, w, h, alpha):
    def draw(lay):
        x0, y0, x1, y1 = int(cx - w / 2), int(cy - h / 2), int(cx + w / 2), int(cy + h / 2)
        cv2.rectangle(lay, (x0 + 18, y0), (x1 - 18, y1), (28, 34, 41), -1, cv2.LINE_AA)
        cv2.rectangle(lay, (x0, y0 + 18), (x1, y1 - 18), (28, 34, 41), -1, cv2.LINE_AA)
        for px, py in ((x0 + 18, y0 + 18), (x1 - 18, y0 + 18), (x0 + 18, y1 - 18), (x1 - 18, y1 - 18)):
            cv2.circle(lay, (px, py), 18, (28, 34, 41), -1, cv2.LINE_AA)
    layer(f, draw, alpha)

def s_problem(f, t, d):
    a = window(t, 0.2, d - 0.1)
    head = text_sprite('Voice is the fastest way to type.', F_SEMI, 64)
    paste(f, head, W / 2, 210 - 20 * (1 - ease(t / 0.7)), a)
    items = [('Open office', 'office'), ('Cafe', 'cafe'), ('Train', 'train')]
    for i, (label, kind) in enumerate(items):
        ta = 2.2 + i * 0.9
        ai = window(t, ta, d - 0.1) * a
        cx = W / 2 + (i - 1) * 420; cy = 560 + 40 * (1 - ease((t - ta) / 0.6))
        card(f, cx, cy, 340, 340, ai)
        def ico(lay, cx=cx, cy=cy, kind=kind):
            c = (210, 216, 222); th = 6
            if kind == 'office':
                cv2.rectangle(lay, (int(cx - 80), int(cy - 90)), (int(cx + 80), int(cy + 10)), c, th, cv2.LINE_AA)
                cv2.line(lay, (int(cx), int(cy + 10)), (int(cx), int(cy + 40)), c, th, cv2.LINE_AA)
                cv2.line(lay, (int(cx - 110), int(cy + 45)), (int(cx + 110), int(cy + 45)), c, th, cv2.LINE_AA)
            elif kind == 'cafe':
                cv2.rectangle(lay, (int(cx - 60), int(cy - 50)), (int(cx + 40), int(cy + 40)), c, th, cv2.LINE_AA)
                cv2.ellipse(lay, (int(cx + 52), int(cy - 5)), (26, 26), 0, -90, 90, c, th, cv2.LINE_AA)
                for k in (-30, 0):
                    cv2.ellipse(lay, (int(cx + k), int(cy - 90)), (10, 22), 0, 90, 270, c, 4, cv2.LINE_AA)
            else:
                cv2.rectangle(lay, (int(cx - 70), int(cy - 100)), (int(cx + 70), int(cy + 40)), c, th, cv2.LINE_AA)
                cv2.rectangle(lay, (int(cx - 45), int(cy - 75)), (int(cx + 45), int(cy - 20)), c, 4, cv2.LINE_AA)
                for k in (-35, 35): cv2.circle(lay, (int(cx + k), int(cy + 10)), 10, c, -1, cv2.LINE_AA)
                cv2.line(lay, (int(cx - 50), int(cy + 70)), (int(cx - 70), int(cy + 95)), c, 4, cv2.LINE_AA)
                cv2.line(lay, (int(cx + 50), int(cy + 70)), (int(cx + 70), int(cy + 95)), c, 4, cv2.LINE_AA)
        layer(f, ico, ai)
        paste(f, text_sprite(label, F_SEMI, 40, MUTED), cx, cy + 125, ai)
    a3 = window(t, 5.4, d - 0.1) * a
    paste(f, text_sprite("Speaking out loud doesn't work everywhere.", F_BOLD, 56, WHITE, [("doesn't work", ORANGE)]), W / 2, 905, a3)

def s_reveal(f, t, d):
    a = window(t, 0.0, d - 0.1)
    radar_rings(f, W / 2 - 430, 470, t, 0.45 * a, maxr=700, period=2.0)
    sc = 0.2 + 0.8 * spring((t - 0.3) / 1.1)
    paste(f, icon_sprite(300), W / 2 - 430, 470, a * ease((t - 0.3) / 0.3), sc)
    tw = ease((t - 1.0) / 0.8)
    word = text_sprite('Subvocal Radar', F_BOLD, 130, WHITE, [('Radar', TEAL)])
    paste(f, word, W / 2 - 230 + 60 * (1 - tw), 430, a * tw, anchor='l')
    paste(f, text_sprite('60 GHz radar  ·  USB-C  ·  silent speech', F_SEMI, 46, MUTED), W / 2 - 226, 535, a * ease((t - 1.8) / 0.8), anchor='l')
    paste(f, text_sprite('Inspired by The Subvocal Company (YC F26)', F_REG, 34, (120, 130, 142)), W / 2, 880, a * ease((t - 4.0) / 0.8))

FACE = np.array([(0.00, 0.00), (0.10, -0.02), (0.18, 0.05), (0.21, 0.15), (0.20, 0.25), (0.27, 0.36), (0.22, 0.40), (0.21, 0.47),
                 (0.23, 0.50), (0.205, 0.535), (0.21, 0.565), (0.22, 0.59), (0.20, 0.63), (0.17, 0.70), (0.10, 0.74), (0.00, 0.73),
                 (-0.04, 0.80), (-0.05, 0.95)], np.float32)
JAW_IDX = range(10, 16)   # lower lip, chin and jaw move with the articulation

def s_sense(f, t, d):
    a = window(t, 0.0, d - 0.1)
    m = articulation(t)
    pts = FACE.copy()
    for i in JAW_IDX: pts[i, 1] += 0.012 * m * (1 if i < 14 else 0.6)
    fx, fy, fs = 360, 150, 640
    poly = np.stack([fx + pts[:, 0] * fs, fy + pts[:, 1] * fs], 1).astype(np.int32)
    layer(f, lambda lay: cv2.polylines(lay, [poly], False, (220, 226, 232), 7, cv2.LINE_AA), a)
    # dongle and waves towards the mouth
    dx, dy = 1010, fy + 0.55 * fs
    def dongle(lay):
        cv2.rectangle(lay, (int(dx), int(dy - 40)), (int(dx + 170), int(dy + 40)), TEAL_D, -1, cv2.LINE_AA)
        cv2.rectangle(lay, (int(dx + 170), int(dy - 16)), (int(dx + 210), int(dy + 16)), (170, 176, 184), -1, cv2.LINE_AA)
        cv2.circle(lay, (int(dx + 40), int(dy)), 14, (255, 255, 255), -1, cv2.LINE_AA)
    layer(f, dongle, a * ease((t - 0.4) / 0.6))
    def waves(lay):
        for k in range(5):
            p = ((t / 1.4) + k / 5) % 1.0
            r = int(30 + p * 380)
            col = tuple(int(c * (1 - p) + 22 * p) for c in TEAL)
            cv2.ellipse(lay, (int(dx + 20), int(dy)), (r, r), 0, 150, 210, col, 5, cv2.LINE_AA)
    layer(f, waves, a * ease((t - 0.8) / 0.6))
    paste(f, text_sprite('60 GHz', F_BOLD, 44, TEAL), dx + 90, dy - 85, a * ease((t - 1.0) / 0.6))
    # trace panel
    px0, py0, pw, ph = 1260, 300, 560, 300
    pa = a * ease((t - 2.4) / 0.7)
    card(f, px0 + pw / 2, py0 + ph / 2, pw, ph, pa)
    def trace(lay):
        xs = np.linspace(0, 1, 280)
        ys = [articulation(t - 3.0 + x * 3.0) for x in xs]
        p = np.stack([px0 + 30 + xs * (pw - 60), py0 + ph / 2 - np.array(ys) * 52], 1).astype(np.int32)
        cv2.line(lay, (px0 + 30, int(py0 + ph / 2)), (px0 + pw - 30, int(py0 + ph / 2)), (60, 68, 78), 2, cv2.LINE_AA)
        cv2.polylines(lay, [p], False, TEAL, 4, cv2.LINE_AA)
    layer(f, trace, pa)
    paste(f, text_sprite('jaw + lip motion', F_SEMI, 32, MUTED), px0 + 30, py0 + 36, pa, anchor='l')
    stats = [('µm', 'skin motion', 4.6), ('200×', 'per second', 6.0), ('3 Rx', 'receivers', 7.4)]
    for i, (big, small, ts) in enumerate(stats):
        sa = a * ease((t - ts) / 0.6)
        cx = px0 + 80 + i * 200
        paste(f, text_sprite(big, F_BOLD, 52, WHITE), cx, 700 + 20 * (1 - ease((t - ts) / 0.6)), sa)
        paste(f, text_sprite(small, F_REG, 28, MUTED), cx, 752, sa)
    paste(f, text_sprite('Silent articulation still moves the skin', F_SEMI, 48), W / 2, 940, a * ease((t - 1.5) / 0.8))

BOARD = os.path.join(ROOT, 'docs', 'images', 'board-top.png')
def s_hardware(f, t, d):
    a = window(t, 0.0, d - 0.1)
    z = 1.0 + 0.06 * ease_io(t / d)
    bw = 1500
    spr = image_sprite(BOARD, bw)
    bx, by = W / 2, 455
    paste(f, spr, bx + 80 * (1 - ease(t / 0.9)), by, a * ease(t / 0.6), z)
    sw, sh = bw * z, spr.shape[0] * z
    def at(u, v): return bx - sw / 2 + u * sw, by - sh / 2 + v * sh
    callouts = [(0.105, 0.48, 'Infineon BGT60TR13C', '60 GHz radar, 3 receivers', 1.0, -1),
                (0.535, 0.47, 'Raspberry Pi RP2040', '1.8 V I/O, USB', 4.2, -1),
                (0.95, 0.48, 'USB-C plug', 'phone + laptop', 7.0, 1)]
    for u, v, title, sub, ts, side in callouts:
        ca = a * ease((t - ts) / 0.5)
        px, py = at(u, v)
        lx, ly = px + (-60 if side < 0 else -120), by + sh / 2 + 60
        def line(lay, px=px, py=py, lx=lx, ly=ly):
            cv2.circle(lay, (int(px), int(py)), 16, ORANGE, 4, cv2.LINE_AA)
            cv2.line(lay, (int(px), int(py + 16)), (int(px), int(ly - 10)), ORANGE, 3, cv2.LINE_AA)
        layer(f, line, ca)
        paste(f, text_sprite(title, F_BOLD, 38), px, ly + 16, ca)
        paste(f, text_sprite(sub, F_REG, 28, MUTED), px, ly + 58, ca)
    chips = ['4 layers', '17 × 46 mm', 'Designed with OpenSchematic · OpenBoard · OpenRoute']
    x = W / 2 - 610
    for i, c in enumerate(chips):
        ca = a * ease((t - (9.5 + i * 0.7)) / 0.5)
        s = text_sprite(c, F_SEMI, 32, WHITE)
        w = s.shape[1] + 50
        card(f, x + w / 2, 975, w, 66, ca)
        paste(f, s, x + w / 2, 975, ca)
        x += w + 24

def device(lay, kind, cx, cy, s, col=(200, 206, 214)):
    if kind == 'laptop':
        cv2.rectangle(lay, (int(cx - 210 * s), int(cy - 150 * s)), (int(cx + 210 * s), int(cy + 110 * s)), col, int(8 * s), cv2.LINE_AA)
        pts = np.array([(cx - 270 * s, cy + 140 * s), (cx + 270 * s, cy + 140 * s), (cx + 230 * s, cy + 112 * s), (cx - 230 * s, cy + 112 * s)], np.int32)
        cv2.fillPoly(lay, [pts], col, cv2.LINE_AA)
    else:
        cv2.rectangle(lay, (int(cx - 85 * s), int(cy - 170 * s)), (int(cx + 85 * s), int(cy + 170 * s)), col, int(8 * s), cv2.LINE_AA)
        cv2.circle(lay, (int(cx), int(cy + 145 * s)), int(9 * s), col, -1, cv2.LINE_AA)

def s_plug(f, t, d):
    a = window(t, 0.0, d - 0.1)
    lx, px = 640, 1290
    layer(f, lambda lay: device(lay, 'laptop', lx, 470, 1.0), a * ease(t / 0.6))
    layer(f, lambda lay: device(lay, 'phone', px, 470, 1.0), a * ease((t - 0.3) / 0.6))
    for i, (cx, cy) in enumerate(((lx + 270, 600), (px, 640))):
        p = ease((t - 0.9 - i * 0.5) / 0.9)
        sx = cx + (1 - p) * 160 * (1 if i == 0 else 0); sy = cy + (1 - p) * (0 if i == 0 else 140)
        def dg(lay, sx=sx, sy=sy, i=i):
            if i == 0:
                cv2.rectangle(lay, (int(sx), int(sy - 14)), (int(sx + 120), int(sy + 14)), TEAL_D, -1, cv2.LINE_AA)
                cv2.circle(lay, (int(sx + 95), int(sy)), 7, (255, 255, 255), -1, cv2.LINE_AA)
            else:
                cv2.rectangle(lay, (int(sx - 14), int(sy)), (int(sx + 14), int(sy + 120)), TEAL_D, -1, cv2.LINE_AA)
                cv2.circle(lay, (int(sx), int(sy + 95)), 7, (255, 255, 255), -1, cv2.LINE_AA)
        layer(f, dg, a * ease((t - 0.9 - i * 0.5) / 0.3))
    ma = a * spring((t - 2.4) / 0.9)
    def mic(lay):
        c = (W // 2 - 250, 190)
        cv2.rectangle(lay, (c[0] - 22, c[1] - 55), (c[0] + 22, c[1] + 15), TEAL, -1, cv2.LINE_AA)
        cv2.circle(lay, (c[0], c[1] - 55), 22, TEAL, -1, cv2.LINE_AA); cv2.circle(lay, (c[0], c[1] + 15), 22, TEAL, -1, cv2.LINE_AA)
        cv2.ellipse(lay, (c[0], c[1] + 5), (42, 42), 0, 0, 180, TEAL, 6, cv2.LINE_AA)
        cv2.line(lay, (c[0], c[1] + 47), (c[0], c[1] + 70), TEAL, 6, cv2.LINE_AA)
    layer(f, mic, min(1.0, ma))
    paste(f, text_sprite('shows up as "Radar Microphone"', F_BOLD, 50), W / 2 - 180, 190, min(1.0, ma), anchor='l')
    for i, c in enumerate(['Windows', 'Android', 'iPhone', 'No drivers']):
        ca = a * ease((t - (4.6 + i * 0.6)) / 0.5)
        s = text_sprite(c, F_SEMI, 40, TEAL if c == 'No drivers' else WHITE)
        cx = W / 2 + (i - 1.5) * 300
        card(f, cx, 860 + 20 * (1 - ca), s.shape[1] + 70, 84, ca)
        paste(f, s, cx, 860 + 20 * (1 - ca), ca)

def s_demo(f, t, d):
    a = window(t, 0.0, d - 0.1)
    # window mock
    x0, y0, x1, y1 = 420, 190, 1500, 760
    def win(lay):
        cv2.rectangle(lay, (x0, y0), (x1, y1), (236, 239, 243), -1, cv2.LINE_AA)
        cv2.rectangle(lay, (x0, y0), (x1, y0 + 56), (214, 219, 226), -1, cv2.LINE_AA)
        for k, c in enumerate(((236, 106, 94), (245, 191, 79), (98, 197, 84))):
            cv2.circle(lay, (x0 + 30 + k * 30, y0 + 28), 9, c[::-1] if False else c, -1, cv2.LINE_AA)
        cv2.rectangle(lay, (x0 + 60, y0 + 330), (x1 - 60, y0 + 430), (255, 255, 255), -1, cv2.LINE_AA)
        cv2.rectangle(lay, (x0 + 60, y0 + 330), (x1 - 60, y0 + 430), TEAL_D, 3, cv2.LINE_AA)
        for k in range(3):
            cv2.rectangle(lay, (x0 + 60, y0 + 100 + k * 60), (x0 + 60 + (600 - k * 140), y0 + 130 + k * 60), (205, 211, 219), -1, cv2.LINE_AA)
    layer(f, win, a * ease(t / 0.5))
    paste(f, text_sprite('Message', F_SEMI, 30, (93, 102, 115)), x0 + 62, y0 + 305, a * ease(t / 0.5), anchor='l')
    # hold F8
    hold = 1.4 <= t <= 4.6
    ka = a * ease((t - 0.9) / 0.4)
    def key(lay):
        c = TEAL if hold else (60, 68, 78)
        off = 6 if hold else 0
        cv2.rectangle(lay, (W // 2 - 70, 850 + off), (W // 2 + 70, 960 + off), c, -1, cv2.LINE_AA)
    layer(f, key, ka)
    paste(f, text_sprite('F8', F_BOLD, 56, WHITE), W / 2, 905 + (6 if hold else 0), ka)
    paste(f, text_sprite('hold', F_REG, 30, MUTED), W / 2 - 150, 905, ka * (1 if hold else 0.5), anchor='r')
    # listening wave while held
    if 1.4 <= t <= 4.8:
        wa = a * window(t, 1.4, 4.8, 0.25)
        def wave(lay):
            xs = np.linspace(0, 1, 200)
            ys = [articulation(t * 1.3 + x * 2.5) for x in xs]
            p = np.stack([W / 2 - 300 + xs * 600, 1035 - np.array(ys) * 16], 1).astype(np.int32)
            cv2.polylines(lay, [p], False, TEAL, 3, cv2.LINE_AA)
        layer(f, wave, wa)
    # typed text
    msg = 'on my way '
    n = int(np.clip((t - 4.9) / 0.09, 0, len(msg)))
    tx = x0 + 90
    if n > 0: paste(f, text_sprite(msg[:n], F_REG, 52, (20, 23, 28)), tx, y0 + 380, a, anchor='l')
    cur_x = tx + (font(F_REG, 52).getlength(msg[:n]) if n else 0) + 6
    if (t * 2) % 1 < 0.6 or n < len(msg):
        layer(f, lambda lay: cv2.line(lay, (int(cur_x), y0 + 352), (int(cur_x), y0 + 408), (20, 23, 28), 3, cv2.LINE_AA), a)
    pa = a * ease((t - 6.0) / 0.5)
    card(f, W / 2, 1035, 520, 64, pa * (0 if 1.4 <= t <= 4.8 else 1))
    paste(f, text_sprite('Typed: "on my way"', F_SEMI, 34, TEAL), W / 2, 1035, pa * (0 if 1.4 <= t <= 4.8 else 1))
    paste(f, text_sprite('Your own phrases · 5 takes each · any app', F_SEMI, 40, MUTED), W / 2, 110, a * ease((t - 7.0) / 0.6))

def s_outro(f, t, d):
    a = window(t, 0.0, d + 1.0) * (1 - ease((t - (d - 1.2)) / 1.1))
    radar_rings(f, W / 2 - 400, 420, t, 0.4 * a, maxr=650, period=2.2)
    paste(f, icon_sprite(240), W / 2 - 400, 420, a * ease(t / 0.4), 0.3 + 0.7 * spring(t / 1.0))
    paste(f, text_sprite('Subvocal Radar', F_BOLD, 112, WHITE, [('Radar', TEAL)]), W / 2 - 240, 395, a * ease((t - 0.5) / 0.7), anchor='l')
    paste(f, text_sprite('Type with silent speech', F_SEMI, 44, MUTED), W / 2 - 236, 490, a * ease((t - 0.9) / 0.7), anchor='l')
    ca = a * ease((t - 2.0) / 0.6)
    s = text_sprite('Ready to order, fully assembled  ·  JLCPCB', F_SEMI, 38, WHITE)
    card(f, W / 2, 700, s.shape[1] + 80, 84, ca); paste(f, s, W / 2, 700, ca)
    paste(f, text_sprite('github.com/ajisrawi/subvocal-radar', F_BOLD, 58, TEAL), W / 2, 845, a * ease((t - 3.4) / 0.7))

SCENE_FN = dict(hook=s_hook, problem=s_problem, reveal=s_reveal, sense=s_sense, hardware=s_hardware, plug=s_plug, demo=s_demo, outro=s_outro)
XF = 0.45   # crossfade between scenes

def render_frame(T):
    f = background(T)
    for i, sid in enumerate(SCENES):
        a, b = starts[i], starts[i] + durs[i]
        if a - XF <= T < b + XF:
            t = T - a
            if t < -XF or t > durs[i] + XF: continue
            layerf = background(T) if (t < 0 or t > durs[i]) else None
            if layerf is None:
                SCENE_FN[sid](f, t, durs[i])
            else:
                g = background(T); SCENE_FN[sid](g, max(t, 0), durs[i])
                w = 1 - ease(abs(t if t < 0 else t - durs[i]) / XF)
                f[:] = f * (1 - w) + g * w
    # fade in / out
    k = min(ease(T / 0.8), 1 - ease((T - (TOTAL - 0.6)) / 0.6))
    return np.clip(f * k, 0, 255).astype(np.uint8)

# ---------------------------------------------------------------- audio
def midi(n): return 440.0 * 2 ** ((n - 69) / 12)

def synth_music(dur):
    n = int(dur * SR); tt = np.arange(n) / SR
    out = np.zeros(n, np.float32)
    bpm = 96; beat = 60 / bpm; bar = 4 * beat
    chords = [(57, 60, 64), (53, 57, 60), (48, 52, 55), (55, 59, 62)]   # Am F C G
    b, a = butter(2, 1400 / (SR / 2))
    pad = np.zeros(n, np.float32)
    for ci in range(int(dur / (2 * bar)) + 2):
        s0 = ci * 2 * bar
        notes = chords[ci % 4]
        i0, i1 = int(s0 * SR), min(n, int((s0 + 2 * bar + 0.6) * SR))
        if i0 >= n: break
        seg = tt[i0:i1] - s0
        env = np.minimum(1, seg / 0.9) * np.minimum(1, np.maximum(0, (2 * bar + 0.6 - seg)) / 0.9)
        v = np.zeros_like(seg)
        for nn in notes + (notes[0] - 12,):
            for det in (-0.12, 0.12):
                fr = midi(nn + det)
                v += 2 * ((seg * fr) % 1.0) - 1.0
        pad[i0:i1] += (v * env * 0.035).astype(np.float32)
    out += lfilter(b, a, pad).astype(np.float32)
    # arpeggio plucks (8ths) from the reveal on
    arp_from = starts[2]
    for k in range(int(dur / (beat / 2))):
        s0 = k * beat / 2
        if s0 < arp_from or s0 > TOTAL - 2.5: continue
        notes = chords[int(s0 / (2 * bar)) % 4]
        nn = (notes + (notes[0] + 12,))[k % 4] + 12
        i0 = int(s0 * SR); L = int(0.45 * SR)
        seg = np.arange(min(L, n - i0)) / SR
        out[i0:i0 + len(seg)] += (np.sin(2 * np.pi * midi(nn) * seg) * np.exp(-seg * 9) * 0.06).astype(np.float32)
    # soft kick on beats 1 and 3, light hats on off-beats, from the reveal to the outro
    for k in range(int(dur / beat)):
        s0 = k * beat
        if s0 < starts[2] or s0 > TOTAL - 3: continue
        i0 = int(s0 * SR)
        if k % 2 == 0:
            L = int(0.35 * SR); seg = np.arange(min(L, n - i0)) / SR
            fq = 45 + 75 * np.exp(-seg * 22)
            out[i0:i0 + len(seg)] += (np.sin(2 * np.pi * np.cumsum(fq) / SR) * np.exp(-seg * 9) * 0.22).astype(np.float32)
        if s0 > starts[3]:
            j0 = int((s0 + beat / 2) * SR); L = int(0.05 * SR)
            if j0 + L < n:
                hat = np.random.default_rng(k).standard_normal(L) * np.exp(-np.arange(L) / SR * 90)
                bh, ah = butter(2, 7000 / (SR / 2), 'high')
                out[j0:j0 + L] += (lfilter(bh, ah, hat) * 0.025).astype(np.float32)
    return out

def whoosh(L=0.7):
    n = int(L * SR); x = np.random.default_rng(7).standard_normal(n)
    env = np.sin(np.linspace(0, np.pi, n)) ** 2
    y = np.zeros(n)
    for i, fc in enumerate(np.geomspace(500, 5000, 8)):
        b, a = butter(2, [fc * 0.7 / (SR / 2), min(0.99, fc * 1.3 / (SR / 2))], 'band')
        part = lfilter(b, a, x) * np.exp(-((np.linspace(0, 1, n) - i / 8) ** 2) / 0.02)
        y += part
    return (y * env * 0.18).astype(np.float32)

def blip(freq=880, L=0.25, vol=0.12):
    seg = np.arange(int(L * SR)) / SR
    return (np.sin(2 * np.pi * freq * seg) * np.exp(-seg * 14) * vol).astype(np.float32)

def click(vol=0.08):
    L = int(0.02 * SR); x = np.random.default_rng(3).standard_normal(L) * np.exp(-np.arange(L) / SR * 400)
    return (x * vol).astype(np.float32)

def add(buf, x, at):
    i = int(at * SR)
    if i >= len(buf): return
    j = min(len(buf), i + len(x)); buf[i:j] += x[:j - i]

def build_audio():
    n = int(TOTAL * SR)
    vo = np.zeros(n, np.float32)
    for i, sid in enumerate(SCENES):
        sr, x = wavfile.read(os.path.join(BUILD, 'vo', f'{sid}.wav'))
        x = x.astype(np.float32) / 32768.0
        add(vo, x * 0.95, starts[i] + VO_DELAY)
    music = synth_music(TOTAL)
    # duck the music under the voice
    env = np.abs(vo); k = int(0.25 * SR)
    env = np.convolve(env, np.ones(k) / k, 'same')
    duck = 1.0 - 0.55 * np.clip(env / 0.04, 0, 1)
    music *= duck.astype(np.float32)
    sfx = np.zeros(n, np.float32)
    w = whoosh()
    for i in range(1, len(SCENES)): add(sfx, w, starts[i] - 0.35)
    add(sfx, blip(660, 0.5, 0.12) + 0, starts[2] + 0.3); add(sfx, blip(990, 0.4, 0.08), starts[2] + 0.42)
    for ts in (1.0, 4.2, 7.0): add(sfx, blip(1200, 0.18, 0.06), starts[4] + ts)
    add(sfx, blip(784, 0.3, 0.08), starts[5] + 2.4)
    for i in range(10): add(sfx, click(0.1), starts[6] + 4.9 + i * 0.09)
    add(sfx, blip(1320, 0.3, 0.07), starts[6] + 6.0)
    add(sfx, blip(523, 1.2, 0.1) + 0, starts[7] + 0.1)
    mix = vo + music * 0.9 + sfx
    # gentle master fade and limiter
    fade = np.minimum(1, np.arange(n) / (0.6 * SR)) * np.minimum(1, (n - np.arange(n)) / (1.2 * SR))
    mix *= fade
    peak = np.max(np.abs(mix)) + 1e-9
    mix = np.tanh(mix / peak * 1.2) / np.tanh(1.2) * 0.89
    return mix

def main():
    os.makedirs(BUILD, exist_ok=True)
    wav = os.path.join(BUILD, 'mix.wav')
    print('audio...'); mix = build_audio()
    wavfile.write(wav, SR, (np.stack([mix, mix], 1) * 32767).astype(np.int16))
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    fps = 6 if PREVIEW else FPS
    out = os.path.join(HERE, 'preview.mp4' if PREVIEW else 'subvocal-radar.mp4')
    cmd = [ff, '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(fps), '-i', '-',
           '-i', wav, '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
           '-shortest', '-movflags', '+faststart', out]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    nf = int(TOTAL * fps)
    for k in range(nf):
        T = k / fps
        fr = render_frame(T)
        p.stdin.write(fr.tobytes())
        if k % (fps * 5) == 0: print(f'  {T:5.1f}s / {TOTAL:.0f}s', flush=True)
    p.stdin.close(); p.wait()
    print('wrote', out)
    if '--stills' in sys.argv:
        for i, sid in enumerate(SCENES):
            Image.fromarray(render_frame(starts[i] + durs[i] * 0.72)).save(os.path.join(BUILD, f'still-{i}-{sid}.jpg'), quality=88)

if __name__ == '__main__':
    if '--stills-only' in sys.argv:
        os.makedirs(BUILD, exist_ok=True)
        for i, sid in enumerate(SCENES):
            Image.fromarray(render_frame(starts[i] + durs[i] * 0.72)).save(os.path.join(BUILD, f'still-{i}-{sid}.jpg'), quality=88)
        print('stills written')
    else:
        main()
