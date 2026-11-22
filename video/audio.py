import numpy as np, wave
SR = 44100; DUR = 92.0
N = int(SR * DUR)
L = np.zeros(N); R = np.zeros(N)
rng = np.random.default_rng(5)

def add(buf_sig, t0, pan=0.0, gain=1.0):
    i0 = int(t0 * SR)
    if i0 >= N: return
    n = min(len(buf_sig), N - i0)
    L[i0:i0 + n] += buf_sig[:n] * gain * (1 - max(0, pan)); R[i0:i0 + n] += buf_sig[:n] * gain * (1 + min(0, pan))

def env(n, a=0.005, d=0.1, s=0.0, r=0.0):
    e = np.ones(n); a_ = max(1, int(a * SR)); e[:a_] = np.linspace(0, 1, a_)
    dd = np.exp(-np.arange(n) / (d * SR)); return e * (s + (1 - s) * dd)

def midi(m): return 440 * 2 ** ((m - 69) / 12)
def tone(f, dur, wave_="saw", a=0.005, d=0.15, s=0.0):
    n = int(dur * SR); ph = (np.arange(n) / SR * f) % 1
    if wave_ == "saw": y = 2 * ph - 1
    elif wave_ == "sq": y = np.sign(ph - 0.5)
    elif wave_ == "tri": y = 4 * np.abs(ph - 0.5) - 1
    else: y = np.sin(2 * np.pi * ph)
    return y * env(n, a, d, s)
def kick(): n = int(0.28 * SR); t = np.arange(n) / SR; return np.sin(2 * np.pi * (45 * t + 90 * (1 - np.exp(-t * 30)) / 30 * 1)) * np.exp(-t * 14)
def hat(open_=False):
    n = int((0.25 if open_ else 0.05) * SR); x = rng.standard_normal(n); x = np.diff(x, prepend=0); return x * np.exp(-np.arange(n) / SR * (14 if open_ else 70)) * 0.5
def snare():
    n = int(0.18 * SR); t = np.arange(n) / SR; return (rng.standard_normal(n) * np.exp(-t * 22) + np.sin(2 * np.pi * 190 * t) * np.exp(-t * 25) * 0.6)
def lowpass(x, k):
    c = np.cumsum(np.insert(x, 0, 0)); return (c[k:] - c[:-k]) / k
def whoosh(dur, rise=True):
    n = int(dur * SR); x = rng.standard_normal(n); y = lowpass(x, 30) * 6
    e = np.sin(np.linspace(0, np.pi, n)) ** 2; return y[:n] * e if len(y) >= n else np.pad(y, (0, n - len(y))) * e

# -------------------------------------------------------------- music
# Section A 0-10 playful intro (C major pentatonic bouncy), 120 bpm
def seq_notes(t0, t1, bpm, pattern, root, wave_, gain, scale, octave_shift=0, dur_beats=0.4):
    beat = 60 / bpm; t = t0; i = 0
    while t < t1:
        st = pattern[i % len(pattern)]
        if st is not None:
            m = root + scale[st % len(scale)] + 12 * (st // len(scale)) + octave_shift
            add(tone(midi(m), beat * dur_beats * 1.0, wave_, d=0.12), t, pan=((i % 4) - 1.5) * 0.15, gain=gain)
        t += beat / 2; i += 1
PENT = [0, 2, 4, 7, 9]
MINOR = [0, 2, 3, 5, 7, 8, 10]
MAJ = [0, 2, 4, 5, 7, 9, 11]

# A: intro 0-10
bpm = 120; beat = 0.5
for b in range(0, 20):
    t = b * beat
    if b % 2 == 0: add(kick(), t, gain=0.5)
    if b % 4 == 2: add(snare(), t, gain=0.12)
    add(hat(), t + beat / 2, gain=0.1)
    root = [48, 53, 55, 48][(b // 4) % 4]
    add(tone(midi(root - 12), 0.45, "sq", d=0.2), t, gain=0.12)
seq_notes(0.5, 10, 120, [0, 2, 4, 2, 5, 4, 2, 0], 72, "tri", 0.16, PENT)

# B: tension 10-40: low drone + heartbeat accelerating + cicadas + dissonant pad
for k, f in enumerate((midi(40), midi(40) * 1.5, midi(40) * 1.189)):
    n = int(30 * SR); t = np.arange(n) / SR
    pad = np.sin(2 * np.pi * f * t + np.sin(t * (0.3 + k * .1)) * 2) * 0.05 * np.minimum(1, t / 3)
    add(pad, 10, pan=(k - 1) * 0.5)
# heartbeat
t = 10.0
while t < 40:
    rate = lerp = 0.95 - 0.5 * (t - 10) / 30
    for dt, g in ((0, 0.55), (0.18 * rate / 0.95 + 0.04, 0.38)):
        n = int(0.22 * SR); tt = np.arange(n) / SR
        add(np.sin(2 * np.pi * 55 * tt) * np.exp(-tt * 18), t + dt, gain=g)
    t += rate
# cicadas: AM'd high noise, swelling
n = int(30 * SR); tt = np.arange(n) / SR
x = np.diff(rng.standard_normal(n + 2), n=2)
cic = x * (0.5 + 0.5 * np.sign(np.sin(2 * np.pi * 38 * tt))) * (0.4 + 0.6 * np.sin(2 * np.pi * 0.2 * tt) ** 2) * np.linspace(0.02, 0.06, n)
add(cic, 10, gain=1.0)
# riser to the cut
rn = int(4 * SR); rt = np.arange(rn) / SR
add(np.sin(2 * np.pi * (200 + 1200 * (rt / 4) ** 2) * rt) * (rt / 4) ** 2 * 0.1, 36, gain=1)
# minor stabs at each sub-scene start
for ts, root in ((10.5, 52), (16.5, 51), (22.3, 50), (28.4, 49), (34.4, 48)):
    for iv in (0, 3, 7):
        add(tone(midi(root + iv), 1.2, "saw", d=0.5), ts, gain=0.045)
# sizzle "whoosh" cut at 10 and 40
add(whoosh(0.8), 9.7, gain=0.5); add(whoosh(0.8), 39.7, gain=0.5)

# C: upbeat funky 40-82 at 112 bpm, bass+arp+drums
bpm = 112; beat = 60 / bpm
prog = [48, 53, 43, 55]
t = 40.0; b = 0
while t < 82:
    bar = (b // 4) % 4; root = prog[bar]
    if b % 4 in (0, 2): add(kick(), t, gain=0.5)
    if b % 4 in (1, 3): add(snare(), t, gain=0.13)
    add(hat(), t, gain=0.1); add(hat(), t + beat / 2, gain=0.07);
    if b % 4 == 3: add(hat(True), t + beat / 2, gain=0.09)
    for sub, off in ((0, 0), (1, beat / 2)):
        if (b + sub) % 3 != 2: add(tone(midi(root - 12 + (12 if sub and b % 4 == 3 else 0)), beat * 0.4, "sq", d=0.12), t + off, gain=0.11)
    b += 1; t += beat
seq_notes(40, 82, 112, [0, 2, 4, 7, 4, 2, 5, 4, 2, 4, 7, 9, 7, 4, 2, 0], 69, "tri", 0.14, MAJ)
# step-change stings
for ts in (46.1, 55.1, 64.1, 73.1):
    add(whoosh(0.5), ts - 0.4, gain=0.4)
    for i, iv in enumerate((0, 4, 7, 12)): add(tone(midi(72 + iv), 0.5, "tri", d=0.25), ts + i * 0.06, gain=0.15)

# D: finale 82-92 triumphant
for i, iv in enumerate((0, 4, 7, 12, 16, 19, 24)):
    add(tone(midi(60 + iv), 2.5, "saw", d=0.9, s=0.0), 82 + i * 0.1, gain=0.06)
bpm = 120; beat = 0.5; t = 82.0
while t < 92:
    add(kick(), t, gain=0.5); add(hat(), t + beat / 2, gain=0.1)
    if int((t - 82) / beat) % 2: add(snare(), t, gain=0.14)
    t += beat
seq_notes(82, 91, 120, [4, 7, 9, 7, 12, 9, 7, 4], 72, "sq", 0.07, MAJ)
# applause 83.5-90
n = int(7 * SR); at = np.arange(n) / SR
x = rng.standard_normal(n); x = x - lowpass(x, 8)[:n] if False else np.diff(x, prepend=0)
clap = np.zeros(n)
for k in range(1400):
    p = int(rng.random() * (n - 2000)); m = int(rng.integers(300, 1100)); clap[p:p + m] += rng.standard_normal(m) * np.exp(-np.arange(m) / (m / 4))
ap = (clap * 0.02 + x * 0.03) * np.minimum(1, at / 0.6) * np.minimum(1, (7 - at) / 2.0)
add(ap, 83.3, gain=1.0)
# footsteps & curtain whoosh in intro
add(whoosh(2.2), 0.5, gain=0.5)
for k in range(5): add(np.sin(2 * np.pi * 90 * np.arange(int(.1 * SR)) / SR) * np.exp(-np.arange(int(.1 * SR)) / SR * 30), 2.0 + k * 0.5, gain=0.15)
# "ding" on title + typing blips on 59%
add(tone(midi(88), 1.0, "sin", d=0.4), 3.2, gain=0.15)
for i in range(59): add(tone(midi(84 + (i % 5)), 0.05, "sq", d=0.03), 18 + 0.6 + i * 0.045 + 0.0, gain=0.03) if False else None
for i in range(59): add(tone(midi(76 + (i % 8) * 2), 0.04, "sq", d=0.02), 36.6 - 18 + i * 0.04, gain=0.035) if False else None
# pin blips in measure (46.8-52.5), scatter pops in quantify, bar fills root-cause, plant thumps fix
for i in range(30): add(tone(midi(79 + (i % 5) * 2), 0.07, "sine", d=0.04), 46.8 + i * 5.7 / 30, gain=0.12)
for i in range(46): add(tone(midi(70 + (i % 7)), 0.05, "sine", d=0.03), 55 + 1.5 + i * 4 / 46, gain=0.1)
for i in range(5): add(tone(midi(55 + i * 3), 0.25, "tri", d=0.12), 64 + 1.8 + i * 0.7, gain=0.2)
for t_ in (74.0, 74.6): add(np.sin(2 * np.pi * 70 * np.arange(int(.3 * SR)) / SR) * np.exp(-np.arange(int(.3 * SR)) / SR * 10), t_, gain=0.5)
for i in range(8): add(tone(midi(84 + i), 0.15, "sine", d=0.1), 73 + 3.3 + i * 0.05, gain=0.08)
# 59% counter ticks
for i in range(59): add(tone(midi(70 + (i // 4)), 0.03, "sq", d=0.02), 18.6 + 10 + i * (2.6 / 59), gain=0.03)

# master
m = np.maximum(np.abs(L).max(), np.abs(R).max())
L /= m / 0.85; R /= m / 0.85
# fade in/out
f = np.minimum(np.minimum(np.arange(N) / (SR * 0.5), 1), np.clip((N - np.arange(N)) / (SR * 1.5), 0, 1))
st = np.stack([L * f, R * f], 1)
pcm = (st * 32767).astype(np.int16)
w = wave.open("audio.wav", "wb"); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes()); w.close()
print("ok")
