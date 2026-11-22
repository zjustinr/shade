import math, random, sys, subprocess, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

W, H, S, FPS = 1280, 720, 2, 24
DUR = 92.0
NF = int(DUR * FPS)
FB = "/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf"
FR = "/usr/share/fonts/opentype/inter/Inter-Bold.otf"
_f = {}
def font(sz, bold=True):
    k = (sz, bold)
    if k not in _f:
        _f[k] = ImageFont.truetype(FB if bold else FR, int(sz * S))
    return _f[k]

def clamp(x, a=0, b=1): return max(a, min(b, x))
def ease(x): x = clamp(x); return x * x * (3 - 2 * x)
def eo(x): x = clamp(x); return 1 - (1 - x) ** 3
def lerp(a, b, t): return a + (b - a) * t
def seg(t, a, b): return clamp((t - a) / (b - a))
def mix(c1, c2, t): return tuple(int(lerp(a, b, t)) for a, b in zip(c1, c2))

class C:
    def __init__(s):
        s.im = Image.new("RGB", (W * S, H * S), (0, 0, 0))
        s.d = ImageDraw.Draw(s.im, "RGBA")
    def r(s, x0, y0, x1, y1, fill, rad=0, outline=None, w=0):
        s.d.rounded_rectangle([x0 * S, y0 * S, x1 * S, y1 * S], radius=rad * S, fill=fill, outline=outline, width=int(w * S))
    def e(s, cx, cy, rx, ry=None, fill=None, outline=None, w=0):
        ry = rx if ry is None else ry
        s.d.ellipse([(cx - rx) * S, (cy - ry) * S, (cx + rx) * S, (cy + ry) * S], fill=fill, outline=outline, width=int(w * S))
    def p(s, pts, fill):
        s.d.polygon([(x * S, y * S) for x, y in pts], fill=fill)
    def l(s, pts, fill, w=2):
        s.d.line([(x * S, y * S) for x, y in pts], fill=fill, width=max(1, int(w * S)), joint="curve")
    def t(s, x, y, txt, sz=24, fill=(255, 255, 255), anchor="la", bold=True, shadow=None):
        if shadow:
            s.d.text(((x + 2) * S, (y + 2) * S), txt, font=font(sz, bold), fill=shadow, anchor=anchor)
        s.d.text((x * S, y * S), txt, font=font(sz, bold), fill=fill, anchor=anchor)
    def glow(s, cx, cy, rad, col, a=60, n=8):
        for i in range(n):
            f = 1 - i / n
            s.e(cx, cy, rad * (0.35 + 0.65 * (i / n) + 0.0), fill=col + (int(a * (1 - i / n) * 0.55),))
    def out(s):
        return s.im.resize((W, H), Image.LANCZOS)

# ---------------------------------------------------------------- palette
SKIN = (240, 190, 150); HAIR = (40, 30, 30); SHIRT = (38, 118, 200); PANTS = (40, 44, 70)
SUN = (255, 190, 40); RED = (230, 70, 50); BLUE = (60, 140, 230); LEAF = (60, 170, 90)
INK = (30, 30, 45); PAPER = (250, 244, 232)

# ---------------------------------------------------------------- Andrew
def andrew(c, x, fy, sc=1.0, t=0, talk=False, pose="idle", face=-1, walk=False):
    bob = math.sin(t * 6) * 3 * sc if walk else math.sin(t * 2) * 1.5 * sc
    f = face
    def X(dx): return x + dx * f * sc
    def Y(dy): return fy + dy * sc + bob
    c.e(x, fy + 4, 62 * sc, 10 * sc, fill=(0, 0, 0, 70))  # shadow
    # legs
    sw = math.sin(t * 8) * 14 * sc if walk else 0
    for i, o in enumerate((-14, 14)):
        s_ = sw if i == 0 else -sw
        c.l([(X(o), Y(-100)), (X(o + s_), Y(0))], PANTS, 22 * sc)
        c.e(X(o + s_ + 6), Y(0), 17 * sc, 8 * sc, fill=(25, 25, 30))
    # torso
    c.r(X(-38) if f > 0 else X(38), Y(-205), X(38) if f > 0 else X(-38), Y(-90), SHIRT, rad=22 * sc)
    c.r(x - 38 * sc, Y(-205), x + 38 * sc, Y(-170), (255, 255, 255, 40), rad=18 * sc)
    c.e(x, Y(-160), 6 * sc, fill=(255, 255, 255, 200))  # lapel pin
    # arms
    sh = (X(30), Y(-190))
    ph = math.sin(t * 7)
    if pose == "point":
        hand = (X(30 + 95), Y(-250 + ph * 6)); el = (X(30 + 55), Y(-200))
    elif pose == "wave":
        hand = (X(30 + 40), Y(-285 + ph * 12)); el = (X(30 + 50), Y(-215))
    elif pose == "cheer":
        hand = (X(30 + 30), Y(-310 + ph * 8)); el = (X(30 + 48), Y(-240))
    else:
        hand = (X(30 + 12), Y(-110)); el = (X(30 + 26), Y(-150))
    c.l([sh, el, hand], SHIRT, 17 * sc); c.e(*hand, 11 * sc, fill=SKIN)
    if pose == "cheer":
        sh2 = (X(-30), Y(-190)); h2 = (X(-30 - 30), Y(-310 - ph * 8)); e2 = (X(-30 - 48), Y(-240))
        c.l([sh2, e2, h2], SHIRT, 17 * sc); c.e(*h2, 11 * sc, fill=SKIN)
    else:
        sh2 = (X(-30), Y(-190)); h2 = (X(-30 - 8), Y(-112)); e2 = (X(-30 - 14), Y(-152))
        c.l([sh2, e2, h2], SHIRT, 17 * sc); c.e(*h2, 11 * sc, fill=SKIN)
        if pose == "point":  # clicker
            c.r(hand[0] - 3 * sc, hand[1] - 3 * sc, hand[0] + 6 * sc, hand[1] + 3 * sc, (30, 30, 30), rad=2)
    # head
    hy = Y(-250)
    c.r(x - 8 * sc, Y(-232), x + 8 * sc, Y(-205), SKIN)
    c.e(x, hy, 38 * sc, 42 * sc, fill=SKIN)
    c.e(X(-37), hy + 3 * sc, 7 * sc, 10 * sc, fill=SKIN)
    c.d.pieslice([(x - 41 * sc) * S, (hy - 47 * sc) * S, (x + 41 * sc) * S, (hy + 20 * sc) * S], 180, 360, fill=HAIR)
    c.e(x + 18 * sc * f, hy - 40 * sc, 16 * sc, 9 * sc, fill=HAIR)
    # glasses
    for ox in (-15, 15):
        c.e(x + ox * sc + 6 * f * sc, hy - 2 * sc, 12 * sc, outline=(20, 20, 30), w=2.4 * sc)
    c.l([(x - 3 * sc + 6 * f * sc, hy - 2 * sc), (x + 3 * sc + 6 * f * sc, hy - 2 * sc)], (20, 20, 30), 2.4 * sc)
    blink = (t % 3.2) < 0.12
    for ox in (-15, 15):
        if blink: c.l([(x + ox * sc + 1 * f * sc, hy - 2 * sc), (x + ox * sc + 11 * f * sc, hy - 2 * sc)], INK, 2 * sc)
        else: c.e(x + ox * sc + 8 * f * sc, hy - 2 * sc, 3.5 * sc, fill=INK)
    # mouth
    mo = (abs(math.sin(t * 14)) * 9 + 3) if talk else 3
    mx, my = x + 6 * f * sc, hy + 22 * sc
    if talk: c.e(mx, my, 10 * sc, mo * sc / 1.4, fill=(120, 30, 40))
    else: c.l([(mx - 9 * sc, my - 2 * sc), (mx, my + 4 * sc), (mx + 9 * sc, my - 2 * sc)], (120, 30, 40), 3 * sc)
    # headset mic
    c.l([(x - 36 * sc * f * -1 * -1, hy + 5 * sc), (x + 28 * sc * f, hy + 20 * sc)], (30, 30, 30), 2 * sc)
    c.e(x + 28 * sc * f, hy + 20 * sc, 4 * sc, fill=(30, 30, 30))

# ---------------------------------------------------------------- stage
def curtains(c, openness, width=None):
    w = lerp(W / 2, 70, eo(openness)) if width is None else width
    for side in (0, 1):
        x0 = 0 if side == 0 else W - w
        c.r(x0, 0, x0 + w, H, (150, 22, 38))
        for i in range(0, int(w), 26):
            c.r(x0 + i, 0, x0 + i + 10, H, (110, 14, 28, 120))
    c.r(0, 0, W, 34, (90, 12, 24)); c.r(0, 30, W, 36, (200, 150, 50))

def stage_bg(c, t):
    c.r(0, 0, W, H, (24, 22, 40))
    for y in range(0, 560, 8):
        c.r(0, y, W, y + 8, mix((38, 30, 62), (18, 16, 34), y / 560))
    c.r(0, 590, W, H, (120, 78, 48))
    for i in range(0, W, 90):
        c.l([(i, 590), (i - 60 + 10, H)], (90, 56, 34), 2)
    c.l([(0, 590), (W, 590)], (200, 140, 80), 4)

def spotlight(c, x, t):
    ov = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0)); d = ImageDraw.Draw(ov)
    sw = math.sin(t * 0.8) * 20
    for i, a in enumerate((26, 18, 12)):
        wd = 90 + i * 40
        d.polygon([((x + sw - 30) * S, 0), ((x + sw + 30) * S, 0), ((x + sw + wd) * S, 650 * S), ((x + sw - wd) * S, 650 * S)], fill=(255, 245, 200, a))
    c.im.paste(ov, (0, 0), ov)

def subtitle(c, txt, t0, t1, t, y=640, xmax=None, col=(255, 255, 255), sz=25):
    a = min(seg(t, t0, t0 + 0.3), 1 - seg(t, t1 - 0.25, t1))
    if a <= 0: return
    # wrap
    words = txt.split(); lines = []; cur = ""
    mw = (xmax or 1100)
    for w_ in words:
        test = (cur + " " + w_).strip()
        if font(sz).getlength(test) / S > mw and cur: lines.append(cur); cur = w_
        else: cur = test
    lines.append(cur)
    bw = max(font(sz).getlength(l_) for l_ in lines) / S + 40
    bh = len(lines) * (sz + 8) + 22
    cx = W / 2; yy = y - (len(lines) - 1) * (sz + 8) / 2
    ov = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    d.rounded_rectangle([(cx - bw / 2) * S, (yy - sz / 2 - 12) * S, (cx + bw / 2) * S, (yy - sz / 2 - 12 + bh) * S], radius=16 * S, fill=(10, 10, 20, int(190 * a)))
    for i, l_ in enumerate(lines):
        d.text((cx * S, (yy + i * (sz + 8)) * S), l_, font=font(sz), fill=col + (int(255 * a),), anchor="mm")
    c.im.paste(ov, (0, 0), ov)

# ---------------------------------------------------------------- icons
def person(c, x, y, sc=1, col=(60, 60, 80), sweat=0, t=0, walk=True):
    sw = math.sin(t * 7 + x) * 6 * sc if walk else 0
    c.l([(x, y - 16 * sc), (x + sw, y)], col, 5 * sc); c.l([(x, y - 16 * sc), (x - sw, y)], col, 5 * sc)
    c.r(x - 7 * sc, y - 40 * sc, x + 7 * sc, y - 14 * sc, col, rad=4 * sc)
    c.e(x, y - 48 * sc, 7 * sc, fill=(235, 190, 150))
    if sweat > 0:
        for i in range(2):
            ph = (t * 1.5 + i * .5 + x * .01) % 1
            c.e(x + (8 + i * 4) * sc, y - 52 * sc + ph * 14 * sc, 2 * sc, 3 * sc, fill=(120, 190, 255, int(255 * sweat * (1 - ph))))

def thermometer(c, x, y, h, lvl, label=None, w=26):
    c.r(x - w / 2, y, x + w / 2, y + h, (240, 240, 240), rad=w / 2)
    fh = max(8, (h - 10) * lvl)
    col = mix((90, 170, 255), (240, 40, 30), clamp(lvl * 1.1))
    c.r(x - w / 2 + 5, y + h - 5 - fh, x + w / 2 - 5, y + h - 5, col, rad=6)
    c.e(x, y + h + 14, w * 0.85, fill=(240, 240, 240)); c.e(x, y + h + 14, w * 0.62, fill=col)
    for i in range(1, 6):
        c.l([(x + w / 2, y + i * h / 6), (x + w / 2 + 8, y + i * h / 6)], (255, 255, 255, 160), 2)
    if label: c.t(x, y - 16, label, 18, anchor="mm")

def tree(c, x, y, sc=1, grow=1, col=LEAF):
    if grow <= 0: return
    g = grow
    c.r(x - 5 * sc * g, y - 60 * sc * g, x + 5 * sc * g, y, (110, 74, 44), rad=2)
    for dx, dy, r in ((0, -80, 34), (-24, -62, 26), (24, -62, 26), (0, -100, 24)):
        c.e(x + dx * sc * g, y + dy * sc * g, r * sc * g, fill=col)

def sun(c, x, y, rad, t, glowc=(255, 190, 40)):
    c.glow(x, y, rad * 3.2, glowc, a=70, n=10)
    for i in range(14):
        a = i / 14 * 2 * math.pi + t * 0.5
        c.l([(x + math.cos(a) * rad * 1.25, y + math.sin(a) * rad * 1.25), (x + math.cos(a) * rad * (1.6 + 0.15 * math.sin(t * 4 + i)), y + math.sin(a) * rad * (1.6 + 0.15 * math.sin(t * 4 + i)))], (255, 210, 80, 220), 5)
    c.e(x, y, rad, fill=(255, 225, 90)); c.e(x, y, rad * 0.8, fill=(255, 240, 150))

def buildings(c, base, items, wincol=(255, 220, 130), seed=1, t=0, lit=0.4):
    rnd = random.Random(seed)
    for (x, w_, h_, col) in items:
        c.r(x, base - h_, x + w_, base, col)
        for wy in range(int(base - h_ + 14), int(base - 14), 22):
            for wx in range(int(x + 8), int(x + w_ - 14), 18):
                on = rnd.random() < lit
                c.r(wx, wy, wx + 9, wy + 12, wincol + (200,) if on else (40, 50, 80, 160))

# ---------------------------------------------------------------- scene 2: chinatown
SKY = [(255, 170, 90), (255, 110, 60), (230, 60, 40)]
BLD = [(60, 40, 50), (80, 50, 60), (70, 45, 70), (90, 60, 60), (55, 38, 58)]

def skyline_scene(c, t, heat, rows=None):
    # sky gradient by heat
    top = mix((255, 200, 120), (190, 30, 30), heat); bot = mix((255, 235, 170), (255, 120, 50), heat)
    for y in range(0, 520, 10): c.r(0, y, W, y + 10, mix(top, bot, y / 520))
    sun(c, 960, 130 + (1 - heat) * 60, 52 + heat * 10, t)
    rnd = random.Random(4); items = []; x = -20
    while x < W:
        w_ = rnd.randint(70, 130); items.append((x, w_, rnd.randint(150, 330), BLD[rnd.randint(0, 4)])); x += w_ + 4
    buildings(c, 520, items, seed=2, lit=0.25)
    # paifang gate (stylised)
    gx = 420
    for dx in (-100, -50, 50, 100): c.r(gx + dx - 9, 400, gx + dx + 9, 520, (180, 40, 40))
    c.r(gx - 130, 380, gx + 130, 404, (200, 50, 50))
    for k, wd in enumerate((150, 110, 70)):
        c.p([(gx - wd, 380 - k * 18), (gx + wd, 380 - k * 18), (gx + wd - 24, 362 - k * 18), (gx - wd + 24, 362 - k * 18)], (30, 120, 90) if k % 2 == 0 else (200, 160, 50))
    c.t(gx, 392, "CHINATOWN", 15, anchor="mm", fill=(255, 225, 120))
    # street + sidewalk
    c.r(0, 520, W, H, (80, 78, 88)); c.r(0, 520, W, 548, (150, 140, 135))
    for i in range(0, W, 140): c.r(i + (t * 30 % 140), 610, i + 60 + (t * 30 % 140), 618, (230, 210, 120, 160))
    return

def sec2(c, t):  # t = global seconds (10..40)
    lt = t - 10
    heat = ease(seg(lt, 0, 20)) * 0.8 + 0.1
    if lt < 6:
        skyline_scene(c, t, heat)
        for i in range(9): person(c, (i * 160 + t * 24) % (W + 100) - 40, 540, 1.0, (50, 40, 70) if i % 2 else (90, 40, 50), sweat=heat, t=t)
        k = eo(seg(lt, 0.2, 1.0)); c.t(W / 2, 92 - (1 - k) * 30, "BOSTON'S CHINATOWN", 58, anchor="mm", shadow=(0, 0, 0, 120))
        c.t(W / 2, 148, "dense  .  paved  .  packed with people", 26, anchor="mm", bold=False, fill=(255, 245, 230))
        thermometer(c, 90, 220, 260, heat, "HEAT")
    elif lt < 12:  # sun vs shade
        k = lt - 6
        for y in range(0, 500, 10): c.r(0, y, W, y + 10, mix((120, 170, 230), (220, 110, 80), y / 500 * 0.6 + 0.2))
        # building casting shadow
        c.r(120, 100, 520, 500, (74, 70, 96))
        for wy in range(130, 480, 46):
            for wx in range(150, 500, 56): c.r(wx, wy, wx + 28, wy + 28, (140, 150, 190, 160))
        c.p([(520, 500), (520, 100), (700, 500)], (0, 0, 0, 0))
        sun(c, 1100, 110, 46, t)
        c.r(0, 500, W, H, (140, 134, 130))
        c.r(0, 500, 700, H, (60, 90, 150, 140))  # shade region
        # shimmer on sun side
        for i in range(24):
            xx = 760 + i * 22; amp = math.sin(t * 5 + i) * 6
            c.l([(xx, 540), (xx + amp, 520), (xx - amp, 500)], (255, 150, 70, 120), 3)
        c.r(700, 500, W, H, (255, 130, 60, 100))
        a = eo(seg(k, 0.5, 1.2))
        c.r(60, 528, 640, 628, (20, 30, 70, 210), rad=16)
        c.t(350, 564, "SHADE SIDE", 30, anchor="mm", fill=(150, 200, 255))
        c.t(350, 600, "cooler under foot", 20, anchor="mm", bold=False)
        c.r(740, 528, 1220, 628, (90, 20, 10, 210), rad=16)
        c.t(980, 564, "SUN SIDE", 30, anchor="mm", fill=(255, 190, 120))
        c.t(980, 600, "same street, same minute", 20, anchor="mm", bold=False)
        thermometer(c, 380, 300, 130, 0.25 * a + 0.02, None, 20); thermometer(c, 980, 300, 130, 0.25 + 0.7 * a, None, 20)
        b = eo(seg(k, 2.5, 3.4))
        c.t(W / 2, 60, "TENS OF DEGREES", 54, anchor="mm", fill=(255, 245, 200), shadow=(0, 0, 0, 160))
        c.t(W / 2, 108, "between the two sides of one street", 24, anchor="mm", bold=False)
        for i in range(5): person(c, 820 + i * 80, 515, 1.3, (60, 40, 40), sweat=1, t=t)
        for i in range(3): person(c, 220 + i * 120, 515, 1.3, (40, 40, 70), sweat=0, t=t, walk=True)
    elif lt < 18:  # no shade map
        k = lt - 12
        c.r(0, 0, W, H, (22, 28, 44))
        c.t(W / 2, 54, "THE CITY'S COOLING MAP", 42, anchor="mm", fill=(180, 220, 255))
        layers = ["Cooling centres", "Pools", "Splash pads", "Libraries"]
        for i, nme in enumerate(layers):
            a = eo(seg(k, 0.3 + i * 0.35, 0.8 + i * 0.35))
            y0 = 110 + i * 70
            c.r(100 - (1 - a) * 300, y0, 640 - (1 - a) * 300, y0 + 54, (50, 90, 150, 230), rad=12)
            c.t(130 - (1 - a) * 300, y0 + 27, nme, 26, anchor="lm")
            c.t(600 - (1 - a) * 300, y0 + 27, "indoor / water", 18, anchor="rm", bold=False, fill=(190, 220, 255))
        a = eo(seg(k, 2.2, 3.0))
        y0 = 110 + 4 * 70
        c.r(100, y0, 640, y0 + 54, (120, 40, 40, int(240 * a)), rad=12)
        c.t(130, y0 + 27, "SHADE", 26, anchor="lm", fill=(255, 200, 200)); c.t(600, y0 + 27, "no data", 20, anchor="rm", bold=False)
        # right: a walk
        c.r(700, 110, 1200, 470, (36, 44, 66), rad=20)
        c.l([(740, 430), (900, 430), (900, 260), (1100, 260), (1100, 160)], (255, 120, 60, 200), 6)
        for q in range(0, 10):
            pp = (t * 0.22 + q / 10) % 1
        pos = [(740, 430), (900, 430), (900, 260), (1100, 260), (1100, 160)]
        pr = ease(seg(k, 1.0, 5.0)) * 4
        i0 = min(3, int(pr)); fr = pr - i0
        px = lerp(pos[i0][0], pos[i0 + 1][0], fr); py = lerp(pos[i0][1], pos[i0 + 1][1], fr)
        person(c, px, py + 10, 1.5, (240, 240, 240), sweat=1, t=t)
        c.e(1100, 160, 22, fill=(70, 160, 255)); c.t(1100, 160, "+", 30, anchor="mm")
        c.t(1100, 124, "cooling centre", 16, anchor="mm", bold=False)
        c.t(740, 450, "home", 16, anchor="lt", bold=False)
        c.t(950, 330, "the walk is the dangerous part", 20, anchor="mm", fill=(255, 190, 120))
        c.t(950, 504, "no one has mapped shade on the way", 20, anchor="mm", bold=False)
    elif lt < 24:  # 59%
        k = lt - 18
        c.r(0, 0, W, H, (28, 24, 40))
        c.t(W / 2, 70, "WHO FINDS OUT?", 40, anchor="mm", fill=(255, 220, 140))
        n = 100; lit = int(eo(seg(k, 0.6, 3.2)) * 59)
        for i in range(n):
            cx_ = 260 + (i % 20) * 38; cy_ = 150 + (i // 20) * 56
            col = (255, 140, 70) if i < lit else (70, 70, 100)
            c.e(cx_, cy_ - 10, 9, fill=col); c.r(cx_ - 9, cy_ - 1, cx_ + 9, cy_ + 28, col, rad=6)
        c.t(W / 2, 470, f"{lit}%", 110, anchor="mm", fill=(255, 150, 80), shadow=(0, 0, 0, 120))
        c.t(W / 2, 560, "of Chinatown residents speak English less than \"very well\"", 24, anchor="mm", bold=False)
        c.t(W / 2, 600, "heat warnings and tips mostly arrive in English", 20, anchor="mm", bold=False, fill=(190, 190, 220))
    else:  # why
        k = lt - 24
        c.r(0, 0, W, H, (24, 30, 38))
        c.t(W / 2, 60, "WHY IS CHINATOWN SO HOT?", 48, anchor="mm", fill=(255, 210, 140))
        cards = [("1", "CONCRETE CANYONS", "670 mapped buildings,\nbut only 433 street trees", (200, 90, 70)),
                 ("2", "NO SHADE MAP", "Boston has never published one,\nso nobody can plan around shade", (230, 150, 50)),
                 ("3", "NOT REACHING EVERYONE", "warnings in one language,\nin a trilingual neighbourhood", (90, 140, 220))]
        for i, (n_, ttl, body, col) in enumerate(cards):
            a = eo(seg(k, 0.5 + i * 1.2, 1.2 + i * 1.2))
            x0 = 70 + i * 395; y0 = 150 + (1 - a) * 80
            c.r(x0, y0, x0 + 360, y0 + 330, col + (int(235 * a),), rad=22)
            c.t(x0 + 30, y0 + 48, n_, 64, fill=(255, 255, 255, int(255 * a)), anchor="lm")
            c.t(x0 + 30, y0 + 120, ttl, 24, fill=(255, 255, 255, int(255 * a)))
            for j, ln in enumerate(body.split("\n")):
                c.t(x0 + 30, y0 + 160 + j * 28, ln, 20, bold=False, fill=(255, 255, 255, int(255 * a)))
            if i == 0:
                for q in range(6):
                    c.r(x0 + 30 + q * 30, y0 + 295 - (q % 3) * 14 - 20, x0 + 52 + q * 30, y0 + 315, (60, 40, 40, int(255 * a)))
            if i == 1:
                c.e(x0 + 180, y0 + 270, 28, outline=(255, 255, 255, int(255 * a)), w=5); c.l([(x0 + 200, y0 + 290), (x0 + 224, y0 + 314)], (255, 255, 255, int(255 * a)), 6)
                c.t(x0 + 180, y0 + 268, "?", 30, anchor="mm", fill=(255, 255, 255, int(255 * a)))
            if i == 2:
                for q, lab in enumerate(("EN", "zh", "vi")):
                    c.r(x0 + 50 + q * 90, y0 + 255, x0 + 120 + q * 90, y0 + 305, (255, 255, 255, int(235 * a) if q else int(255 * a)), rad=10)
                    c.t(x0 + 85 + q * 90, y0 + 280, lab, 22, anchor="mm", fill=(40, 70, 130))
        c.t(W / 2, 560, "Source: project README and City open data (tree + building layers)", 17, anchor="mm", bold=False, fill=(160, 170, 190))
        b = eo(seg(k, 4.8, 5.8))
        c.t(W / 2, 620, "So how do we measure, prove, and fix it?", 34, anchor="mm", fill=(255, 245, 200, int(255 * b)))

# ---------------------------------------------------------------- scene 4 steps (inside screen)
SCR = (100, 50, 1060, 560)

def screen_frame(c):
    x0, y0, x1, y1 = SCR
    c.r(x0 - 12, y0 - 12, x1 + 12, y1 + 12, (20, 20, 30), rad=22)
    c.r(x0, y0, x1, y1, PAPER, rad=14)

def step_header(c, n, name, col, k):
    x0, y0, x1, y1 = SCR
    a = eo(seg(k, 0, 0.5))
    c.r(x0 + 20 - (1 - a) * 300, y0 + 16, x0 + 400 - (1 - a) * 300, y0 + 76, col, rad=14)
    c.t(x0 + 44 - (1 - a) * 300, y0 + 46, f"STEP {n}", 18, anchor="lm", fill=(255, 255, 255, 220))
    c.t(x0 + 140 - (1 - a) * 300, y0 + 46, name, 32, anchor="lm")

def step_nav(c, cur):
    names = ["MEASURE", "QUANTIFY", "ROOT-CAUSE", "FIX"]; cols = [BLUE, (230, 140, 40), (150, 80, 200), LEAF]
    for i in range(4):
        x = 150 + i * 220
        on = i == cur
        c.r(x, 574, x + 200, 600, cols[i] if on else (70, 70, 90, 160), rad=13)
        c.t(x + 100, 587, names[i], 14, anchor="mm", fill=(255, 255, 255, 255 if on else 140))

def streets(c, x0, y0, x1, y1):
    c.r(x0, y0, x1, y1, (225, 220, 205))
    bx = [(x0 + 20, x0 + 190), (x0 + 220, x0 + 400), (x0 + 430, x0 + 560), (x0 + 590, x0 + 760), (x0 + 790, x0 + 920)]
    by = [(y0 + 10, y0 + 100), (y0 + 130, y0 + 230), (y0 + 260, y0 + 340)]
    for (a, b) in bx:
        for (cc, d) in by:
            if a < x1 - 20 and b < x1: c.r(a, cc, b, d, (190, 185, 170), rad=6)

def step1(c, k):
    x0, y0, x1, y1 = SCR
    step_header(c, 1, "MEASURE", BLUE, k)
    mx0, my0, mx1, my1 = x0 + 20, y0 + 100, x0 + 630, y0 + 470
    c.r(mx0, my0, mx1, my1, (225, 220, 205), rad=12)
    rnd = random.Random(7)
    for i in range(5):
        for j in range(3):
            c.r(mx0 + 20 + i * 120, my0 + 20 + j * 115, mx0 + 120 + i * 120, my0 + 105 + j * 115, (190, 185, 170), rad=6)
    # shade shadows
    pins = [(mx0 + 40 + rnd.random() * 540, my0 + 40 + rnd.random() * 290) for _ in range(30)]
    n = int(eo(seg(k, 0.8, 6.5)) * 30)
    for i, (px, py) in enumerate(pins[:n]):
        a = clamp((k - (0.8 + i * 5.7 / 30)) * 4)
        c.e(px - 7, py, 6 + 2 * (1 - a), fill=RED); c.e(px + 7, py, 6 + 2 * (1 - a), fill=BLUE)
    c.t(mx0 + 20, my1 + 22, f"{n * 2} paired readings so far  (plan: ~60 sites)", 20, anchor="lm", fill=INK)
    # legend + phone
    px0 = x0 + 650
    c.t(px0, y0 + 112, "Crew of six + IR thermometer", 20, anchor="la", fill=INK)
    c.e(px0 + 12, y0 + 165, 8, fill=RED); c.t(px0 + 30, y0 + 165, "sun surface", 20, anchor="lm", fill=INK, bold=False)
    c.e(px0 + 12, y0 + 195, 8, fill=BLUE); c.t(px0 + 30, y0 + 195, "shade surface", 20, anchor="lm", fill=INK, bold=False)
    # phone
    c.r(px0 + 10, y0 + 230, px0 + 150, y0 + 450, (30, 30, 45), rad=18)
    c.r(px0 + 18, y0 + 244, px0 + 142, y0 + 436, (255, 255, 255), rad=8)
    c.t(px0 + 80, y0 + 270, "Field Tool", 15, anchor="mm", fill=INK)
    for q, (lab, col) in enumerate((("sun  41.2", RED), ("shade 29.8", BLUE), ("source: tree", INK), ("photo taken", LEAF))):
        c.r(px0 + 26, y0 + 290 + q * 34, px0 + 134, y0 + 316 + q * 34, col + (255,) if q < 2 else (235, 235, 240), rad=6)
        c.t(px0 + 80, y0 + 303 + q * 34, lab, 13, anchor="mm", fill=(255, 255, 255) if q < 2 else INK)
    c.t(px0 + 160, y0 + 270, "airplane mode?\nstill works.", 16, anchor="la", fill=INK, bold=False)
    c.t(px0 + 160, y0 + 330, "records WHAT\ncast the shade", 16, anchor="la", fill=(150, 80, 200), bold=False)
    c.t(px0 + 160, y0 + 390, "illustrative values", 13, anchor="la", fill=(120, 120, 130), bold=False)

def step2(c, k):
    x0, y0, x1, y1 = SCR
    step_header(c, 2, "QUANTIFY", (230, 140, 40), k)
    # left: sun sweep
    lx0, ly0, lx1, ly1 = x0 + 20, y0 + 100, x0 + 440, y0 + 400
    c.r(lx0, ly0, lx1, ly1, (205, 225, 245), rad=12)
    gy = ly1 - 40
    c.r(lx0, gy, lx1, ly1, (150, 145, 140), rad=0)
    ang = lerp(0.35, 1.05, ease(seg(k, 0.5, 6)))  # sun altitude-ish low->high->?
    alt = math.sin(seg(k, 0.5, 6.5) * math.pi) * 0.9 + 0.25
    sxp = lerp(lx0 + 40, lx1 - 40, seg(k, 0.5, 6.5)); syp = ly0 + 40 + (1 - math.sin(seg(k, 0.5, 6.5) * math.pi)) * 40
    sun(c, sxp, syp, 14, k)
    sl = clamp(1.0 / math.tan(alt), 0, 3.2)
    for bx, bh in ((lx0 + 140, 110), (lx0 + 260, 80)):
        c.r(bx, gy - bh, bx + 60, gy, (110, 100, 120))
        sh = bh * sl * 0.5
        dirx = 1 if sxp < (lx0 + lx1) / 2 else -1
        if dirx > 0: c.p([(bx + 60, gy), (bx + 60 + sh, gy), (bx + 60, gy - 0)], (0, 0, 0, 0)); c.r(bx + 60, gy, bx + 60 + sh, gy + 14, (40, 50, 90, 150))
        else: c.r(bx - sh, gy, bx, gy + 14, (40, 50, 90, 150))
    c.t(lx0 + 14, ly0 + 18, "model: shadow = height / tan(sun angle)", 17, anchor="lm", fill=INK, bold=False)
    # right: scatter
    rx0, ry0, rx1, ry1 = x0 + 480, y0 + 100, x0 + 930, y0 + 400
    c.r(rx0, ry0, rx1, ry1, (255, 255, 255), rad=12, outline=(200, 200, 210), w=2)
    c.l([(rx0 + 40, ry1 - 30), (rx1 - 20, ry1 - 30)], INK, 2); c.l([(rx0 + 40, ry1 - 30), (rx0 + 40, ry0 + 40)], INK, 2)
    c.t((rx0 + rx1) / 2 + 10, ry1 - 10, "model says: shade benefit", 15, anchor="mm", fill=INK, bold=False)
    c.l([(rx0 + 40, ry1 - 30), (rx1 - 30, ry0 + 50)], (200, 200, 210), 3)
    rnd = random.Random(3); n = int(eo(seg(k, 1.5, 5.5)) * 46)
    for i in range(46):
        u = rnd.random(); tx = rx0 + 55 + u * (rx1 - rx0 - 100); ty = ry1 - 45 - u * (ry1 - ry0 - 110) + rnd.gauss(0, 20)
        if i < n:
            out = i % 9 == 4
            c.e(tx, ty - (45 if out else 0), 6, fill=(230, 70, 50) if out else (60, 120, 220, 220))
    if n > 8: c.t(rx1 - 30, ry0 + 28, "disagreements flagged, never deleted", 14, anchor="rm", fill=RED, bold=False)

    c.t(rx0 + 8 - 5, ry0 - 10, "", 1)
    # honest null result
    a = eo(seg(k, 6.2, 7.2))
    c.r(x0 + 20, y0 + 418, x0 + 930, y0 + 478, (255, 240, 205), rad=14, outline=(230, 170, 60), w=3)
    c.t(x0 + 40, y0 + 436, "Reality check - CAPA Heat Watch 2019, 100 afternoon points:", 18, anchor="lm", fill=INK)
    c.t(x0 + 40, y0 + 462, "shade vs sun  +0.46 F, p = 0.09 -> a NULL. Expected: car air temperature is not sidewalk surface. We report it anyway.", 15, anchor="lm", fill=(110, 80, 20), bold=False)

def step3(c, k):
    x0, y0, x1, y1 = SCR
    step_header(c, 3, "ROOT-CAUSE", (150, 80, 200), k)
    # left: a disagreement dot -> magnifier
    c.r(x0 + 20, y0 + 100, x0 + 330, y0 + 470, (240, 232, 250), rad=14)
    c.t(x0 + 175, y0 + 124, "model: SHADE", 20, anchor="mm", fill=INK)
    c.t(x0 + 175, y0 + 150, "crew reading: HOT", 20, anchor="mm", fill=RED)
    mk = eo(seg(k, 0.5, 1.5))
    c.e(x0 + 175, y0 + 290, 60 + 8 * math.sin(k * 5) * (1 - mk), fill=(255, 120, 90, 90), outline=RED, w=4)
    c.t(x0 + 175, y0 + 290, "?", 70, anchor="mm", fill=RED)
    c.e(x0 + 215, y0 + 330, 52 * mk, fill=(255, 255, 255, 90), outline=(70, 70, 90), w=6)
    c.l([(x0 + 252, y0 + 368), (x0 + 295, y0 + 415)], (70, 70, 90), 10)
    c.t(x0 + 175, y0 + 452, "ask: what was really up there?", 15, anchor="mm", fill=INK, bold=False)
    # right: ranked causes
    causes = [("Awning / scaffold (not modelled)", 0.78, (150, 80, 200)), ("Tree crown is not an opaque disc", 0.55, LEAF),
              ("79 of 670 buildings have no height", 0.40, (230, 140, 40)), ("Wind / surface material (asphalt vs. stone)", 0.28, BLUE),
              ("Other / measurement error", 0.14, (120, 120, 130))]
    c.t(x0 + 370, y0 + 112, "Tag every miss, then rank the causes", 22, anchor="lm", fill=INK)
    for i, (lab, v, col) in enumerate(causes):
        a = eo(seg(k, 1.8 + i * 0.7, 2.8 + i * 0.7))
        yy = y0 + 150 + i * 62
        c.t(x0 + 370, yy, lab, 17, anchor="lm", fill=INK, bold=False)
        c.r(x0 + 370, yy + 16, x0 + 370 + 540, yy + 38, (225, 220, 235), rad=8)
        c.r(x0 + 370, yy + 16, x0 + 370 + max(10, 540 * v * a), yy + 38, col, rad=8)
    c.t(x0 + 910, y0 + 470, "ILLUSTRATIVE - to be filled by the crew's data", 14, anchor="rm", fill=(120, 80, 150), bold=False)
    b = eo(seg(k, 5.8, 6.8))
    c.t(x0 + 20, y0 + 490, "Change ONE cause in the model at a time -> does the error shrink?", 20, anchor="lm", fill=(110, 40, 150, int(255 * b)))

def step4(c, k):
    x0, y0, x1, y1 = SCR
    step_header(c, 4, "FIX", LEAF, k)
    gy = y0 + 400
    c.r(x0 + 20, y0 + 100, x0 + 930, y0 + 470, (214, 232, 248), rad=14)
    c.r(x0 + 20, gy, x0 + 930, y0 + 470, (150, 145, 140), rad=0)
    sun(c, x0 + 840, y0 + 160, 36, k)
    # hot street left half
    heat = 1 - eo(seg(k, 4.0, 6.0)) * 0.7
    for i in range(14):
        xx = x0 + 60 + i * 60; amp = math.sin(k * 5 + i) * 5
        c.l([(xx, gy - 10), (xx + amp, gy - 40), (xx - amp, gy - 70)], (255, 120, 60, int(110 * heat)), 3)
    # planting
    g1 = eo(seg(k, 1.0, 3.0)); g2 = eo(seg(k, 1.6, 3.6))
    tree(c, x0 + 330, gy, 2.0, g1); tree(c, x0 + 640, gy, 2.0, g2)
    if g1 > 0.5:
        c.p([(x0 + 330 + 40, gy), (x0 + 330 + 40 + 150 * g1, gy), (x0 + 330, gy)], (0, 0, 0, 0))
        c.r(x0 + 240, gy + 4, x0 + 240 + 180 * g1, gy + 22, (30, 60, 90, 110))
    s_ = eo(seg(k, 3.2, 4.2))
    if s_ > 0:
        c.r(x0 + 380, gy - 34 * s_, x0 + 470, gy - 28 * s_, (140, 90, 50), rad=3); c.r(x0 + 385, gy - 28 * s_, x0 + 395, gy, (100, 60, 40)); c.r(x0 + 455, gy - 28 * s_, x0 + 465, gy, (100, 60, 40))
        c.t(x0 + 425, gy - 54, "seating", 14, anchor="mm", fill=INK, bold=False)
    c.t(x0 + 485, y0 + 125, "COOL CORNER", 26 , anchor="mm", fill=(30, 100, 60, int(255 * g1)))
    thermometer(c, x0 + 880, y0 + 240, 120, heat * 0.9, None, 18)
    c.t(x0 + 880, y0 + 215, "surface", 14, anchor="mm", fill=INK, bold=False)
    # re-measure loop
    b = eo(seg(k, 6.0, 7.0))
    if b > 0:
        c.r(x0 + 20, y0 + 485, x0 + 930, y0 + 510, (255, 255, 255, 0), rad=0)
        c.t(x0 + 20, y0 + 488, "Then measure again: did surface temperature drop? (summer 2027 validation)", 21, anchor="lm", fill=(30, 100, 60, int(255 * b)))
    # circular arrow
    ang = k * 3
    c.d.arc([(x0 + 780) * S, (y0 + 290) * S, (x0 + 860) * S, (y0 + 370) * S], 0 + ang * 50, 270 + ang * 50, fill=(30, 100, 60), width=int(6 * S)) if b > 0 else None

# ---------------------------------------------------------------- confetti
def confetti(c, t0, t):
    rnd = random.Random(11)
    for i in range(120):
        x = rnd.random() * W; sp = 80 + rnd.random() * 160; ph = rnd.random() * 6
        y = ((t - t0) * sp + ph * 100) % (H + 60) - 30
        col = [(255, 90, 90), (255, 200, 60), (90, 200, 120), (90, 160, 255), (200, 110, 255)][i % 5]
        xx = x + math.sin(t * 3 + ph) * 20
        c.p([(xx, y), (xx + 8, y + 3), (xx + 4, y + 11)], col)

# ---------------------------------------------------------------- timeline
SCRIPT_STAGE = [
    (3.2, 9.5, "Hi, I'm Andrew. Let's talk about heat - and who gets to escape it."),
    (40.5, 45.8, "So here's the plan: four steps. Measure it. Quantify it. Find the root cause. Fix it."),
    (46.2, 54.5, "Step 1 - MEASURE. A youth crew takes paired sun and shade surface temperatures, with photos, even offline."),
    (55.2, 63.5, "Step 2 - QUANTIFY. Model the shade, check it against readings, and publish the nulls honestly."),
    (64.2, 72.5, "Step 3 - ROOT-CAUSE. Every disagreement gets a tag. Rank the causes. Change one at a time."),
    (73.2, 81.5, "Step 4 - FIX. Build Cool Corners: trees plus seating. Then measure again to prove it worked."),
    (82.5, 91.0, "Shade is a public good. Let's map it, prove it, and build it."),
]
SCRIPT_NARR = [
    (10.5, 15.5, "Boston's Chinatown: dense, paved, and packed with people."),
    (16.5, 21.5, "On one street at one moment, sun and shade can differ by tens of degrees underfoot."),
    (22.3, 27.8, "The City's cooling map is all indoor or water. Shade: no data. The walk there is the risk."),
    (28.4, 33.8, "And 59% of residents speak English less than 'very well'."),
]

def frame(i):
    t = i / FPS
    c = C()
    if t < 10 or t >= 40:
        # ---------- stage scenes
        stage_bg(c, t)
        if t < 10:
            op = seg(t, 0.4, 3.0)
            # screen showing title
            c.r(300, 70, 980, 420, (240, 235, 225), rad=14); c.r(290, 60, 990, 430, (20, 20, 30, 0), rad=14)
            tk = eo(seg(t, 3.0, 4.0))
            c.t(640, 170, "CHINATOWN", 62, anchor="mm", fill=(200, 60, 50, int(255 * tk)))
            c.t(640, 240, "COOL CORNERS", 62, anchor="mm", fill=(30, 110, 80, int(255 * tk)))
            c.t(640, 310, "a research plan to map, prove and build shade", 24, anchor="mm", bold=False, fill=(60, 60, 80, int(255 * tk)))
            c.t(640, 360, "in four steps", 20, anchor="mm", bold=False, fill=(120, 120, 130, int(255 * tk)))
            ax = lerp(1400, 1020, ease(seg(t, 1.6, 4.4)))
            walk = t < 4.4
            talk = 3.4 < t < 9.5
            spotlight(c, ax, t)
            andrew(c, ax, 690, 1.15, t, talk=talk, pose="wave" if (t > 4.4 and t < 7) else ("point" if t >= 7 else "idle"), walk=walk)
            curtains(c, op)
            if t < 0.6: c.r(0, 0, W, H, (0, 0, 0, int(255 * (1 - t / 0.6))))
        else:
            if t < 46:
                screen_frame(c)
                k = t - 40
                x0, y0, x1, y1 = SCR
                c.t((x0 + x1) / 2, 110, "THE PLAN", 24, anchor="mm", fill=(120, 120, 140))
                names = [("1", "MEASURE", BLUE), ("2", "QUANTIFY", (230, 140, 40)), ("3", "ROOT-CAUSE", (150, 80, 200)), ("4", "FIX", LEAF)]
                for j, (n_, nm, col) in enumerate(names):
                    a = eo(seg(k, 1.2 + j * 0.9, 1.9 + j * 0.9))
                    cx_ = x0 + 140 + j * 225; cy_ = y0 + 270 - (1 - a) * 60
                    c.e(cx_, cy_, 78 * a + 1, fill=col)
                    c.t(cx_, cy_ - 6, n_, 64 * a + 1, anchor="mm")
                    c.t(cx_, cy_ + 120, nm, 22, anchor="mm", fill=INK)
                    if j < 3: c.t(cx_ + 112, cy_, ">", 40, anchor="mm", fill=(170, 170, 180, int(255 * a)))
            elif t < 82:
                screen_frame(c)
                st = int((t - 46) // 9); st = min(st, 3)
                k = t - 46 - st * 9
                (step1, step2, step3, step4)[st](c, k)
                step_nav(c, st)
            else:
                # finale
                screen_frame(c); x0, y0, x1, y1 = SCR
                k = t - 82
                c.t((x0 + x1) / 2, y0 + 150, "CHINATOWN COOL CORNERS", 52, anchor="mm", fill=(200, 60, 50))
                c.t((x0 + x1) / 2, y0 + 215, "measure  >  quantify  >  root-cause  >  fix  >  repeat", 28, anchor="mm", fill=INK, bold=False)
                for j in range(5):
                    a = eo(seg(k, 0.5 + j * 0.3, 1.2 + j * 0.3))
                    tree(c, x0 + 190 + j * 150, y0 + 400, 1.4, a)
                c.t((x0 + x1) / 2, y0 + 440, "Shade is a public good.", 36, anchor="mm", fill=(30, 100, 60))
            ap = 1160
            spotlight(c, ap, t)
            pose = "point" if 46 <= t < 82 else ("cheer" if t >= 84 and t < 89 else ("wave" if t < 46 else "idle"))
            talk = any(a <= t <= b for a, b, _ in SCRIPT_STAGE if a >= 40)
            andrew(c, ap, 700, 0.85 if t < 82 else 0.9, t, talk=talk, pose=pose)
            curtains(c, 1, width=60)
            if t >= 84: confetti(c, 84, t)
            if t > 91: c.r(0, 0, W, H, (0, 0, 0, int(255 * seg(t, 91, 92))))
        for a, b, tx in SCRIPT_STAGE: subtitle(c, tx, a, b, t, y=650 if t > 40 else 650, xmax=900 if t > 40 else 1000, sz=24)
        return c.out()
    # ---------- cut to Chinatown (10..40)
    sec2(c, t)
    im = c.out()
    arr = np.asarray(im)
    # heat shimmer
    amp = (1.0 + 2.5 * clamp((t - 10) / 10)) if t < 22 else 0.0
    ys = np.arange(H); shift = (np.sin(ys / 9.0 + t * 6) * amp).astype(int)
    xs = (np.arange(W)[None, :] + shift[:, None]) % W
    arr = arr[ys[:, None], xs]
    # vignette
    arr = (arr * VIG[:, :, None]).astype(np.uint8)
    im = Image.fromarray(arr)
    c2 = C(); c2.im = im.resize((W * S, H * S)); c2.d = ImageDraw.Draw(c2.im, "RGBA")
    # cut flash
    for a, b, tx in SCRIPT_NARR: subtitle(c2, tx, a, b, t, y=680, sz=23)
    if t < 10.5:
        c2.r(0, 0, W, H, (255, 255, 255, int(255 * (1 - seg(t, 10, 10.5)))))
    if t > 39.4:
        c2.r(0, 0, W, H, (255, 255, 255, int(255 * seg(t, 39.4, 40))))
    c2.t(30, 24, "CUT TO:  CHINATOWN, 3:00 PM, JULY", 18, anchor="lm", fill=(255, 255, 255, 220), shadow=(0, 0, 0, 160)) if t < 16 else None
    return c2.out()

yy, xx = np.mgrid[0:H, 0:W]
VIG = 1 - 0.38 * (((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2) / 2

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "test":
        for ti in [1.5, 4, 8, 12, 19, 25, 31, 37, 42, 50, 59, 68, 78, 88]:
            frame(int(ti * FPS)).save(f"{os.environ['OUT']}/t{ti}.png")
        sys.exit()
    from multiprocessing import Pool
    out = sys.argv[1]
    ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                           "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", out], stdin=subprocess.PIPE)
    with Pool(4) as p:
        for n, im in enumerate(p.imap(frame_bytes := None or frame, range(NF), chunksize=4)):
            ff.stdin.write(im.tobytes())
            if n % 120 == 0: print(n, NF, flush=True)
    ff.stdin.close(); ff.wait()
