"""
theme.py - the @buildwithakshita look, shared by all four demos.

Colours come straight from "AI Video Editor/Brand Kit/brand-kit.md". Text is
drawn with Pillow using a real font, because OpenCV's built-in font is blocky
and can't be changed.

Nothing here touches the camera or the models - it is only the paint. Edit the
palette or SMALL_WEIGHT / BIG_WEIGHT below and every demo changes with it.
"""

from functools import lru_cache

import cv2
import numpy as np

try:
    from PIL import Image, ImageDraw, ImageFont
    HAVE_PIL = True
except ImportError:                     # fall back to OpenCV's own font
    HAVE_PIL = False


# ---------------------------------------------------------------- palette
def bgr(hex_colour):
    """'#4A7C59' -> (89, 124, 74) in OpenCV's blue-green-red order."""
    h = hex_colour.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return (b, g, r)


MOSS = bgr("#4A7C59")       # accent: one word at a time, small marks
FOREST = bgr("#2F4A37")     # title cards, panels
OAT = bgr("#EFE8DC")        # card backgrounds, text on Forest
INK = bgr("#23241F")        # body text on Oat
STONE = bgr("#5A5950")      # secondary text, small labels
LINE = bgr("#CFC4B2")       # hairlines, card borders

# The brand uses Fraunces / Inter, which aren't installed here. San Francisco
# is the closest thing macOS ships, and it is a variable font, so we can ask
# for real weights. Point FONT_FILE at a .ttf you've downloaded to get exact
# brand type - Inter ExtraBold for labels is the brand's caption font.
FONT_FILE = "/System/Library/Fonts/SFNS.ttf"
BIG_WEIGHT = "Black"
SMALL_WEIGHT = "Semibold"


@lru_cache(maxsize=16)
def _font(size, weight):
    if not HAVE_PIL:
        return None
    try:
        f = ImageFont.truetype(FONT_FILE, size)
        try:
            f.set_variation_by_name(weight)
        except Exception:
            pass                        # not a variable font: plain weight
        return f
    except Exception:
        return ImageFont.load_default()


# ---------------------------------------------------------------- text
def text_width(text, size, weight=BIG_WEIGHT):
    if HAVE_PIL:
        f = _font(size, weight)
        return int(f.getbbox(text)[2] - f.getbbox(text)[0])
    scale = size / 30.0
    return cv2.getTextSize(text, cv2.FONT_HERSHEY_DUPLEX, scale, 2)[0][0]


def draw_text(img, text, center, size, colour, weight=BIG_WEIGHT):
    """Draw centred text onto a BGR image, in place."""
    cx, cy = center
    if not HAVE_PIL:
        scale = size / 30.0
        thick = max(2, int(scale * 1.6))
        (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_DUPLEX, scale, thick)
        org = (int(cx - tw / 2), int(cy + th / 2))
        cv2.putText(img, text, org, cv2.FONT_HERSHEY_DUPLEX, scale, colour,
                    thick, cv2.LINE_AA)
        return
    # Only the patch of frame the text lands on is handed to Pillow. Converting
    # the whole 1280x720 frame twice per label costs ~35 ms; this costs ~2 ms.
    f = _font(size, weight)
    x0b, y0b, x1b, y1b = f.getbbox(text)
    tw, th = x1b - x0b, y1b - y0b
    pad = int(size * 0.7) + 6
    h, w = img.shape[:2]
    x0 = max(0, int(cx - tw / 2) - pad)
    x1 = min(w, int(cx + tw / 2) + pad)
    y0 = max(0, int(cy - th / 2) - pad)
    y1 = min(h, int(cy + th / 2) + pad)
    if x1 <= x0 or y1 <= y0:
        return
    region = img[y0:y1, x0:x1]
    pil = Image.fromarray(cv2.cvtColor(region, cv2.COLOR_BGR2RGB))
    d = ImageDraw.Draw(pil)
    b, g, r = colour
    d.text((cx - x0, cy - y0), text, font=f, fill=(r, g, b), anchor="mm")
    img[y0:y1, x0:x1] = cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)


def fit_size(text, max_width, start=96, floor=22, weight=BIG_WEIGHT):
    """Largest font size at which `text` fits inside max_width."""
    size = start
    while size > floor and text_width(text, size, weight) > max_width:
        size -= 2
    return size


# ---------------------------------------------------------------- shapes
def rounded(img, box, colour, alpha=0.92, radius=26, border=None):
    """Soft rounded panel, blended onto the image in place."""
    x0, y0, x1, y1 = (int(v) for v in box)
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(img.shape[1], x1), min(img.shape[0], y1)
    if x1 <= x0 or y1 <= y0:
        return
    # built at panel size, not frame size - this runs on every frame
    bw, bh = x1 - x0, y1 - y0
    radius = max(0, min(radius, bw // 2, bh // 2))
    mask = np.zeros((bh, bw), np.uint8)
    cv2.rectangle(mask, (radius, 0), (bw - radius, bh), 255, -1)
    cv2.rectangle(mask, (0, radius), (bw, bh - radius), 255, -1)
    for cx, cy in ((radius, radius), (bw - radius, radius),
                   (radius, bh - radius), (bw - radius, bh - radius)):
        cv2.circle(mask, (cx, cy), radius, 255, -1)

    region = img[y0:y1, x0:x1]
    sel = mask.astype(bool)
    region[sel] = (region[sel] * (1 - alpha)
                   + np.array(colour, float) * alpha).astype(np.uint8)
    if border:
        # outline = the panel minus a shrunken copy of itself, so the corners
        # stay rounded instead of showing the circles we built them from
        inner = cv2.erode(mask, np.ones((3, 3), np.uint8), iterations=2)
        region[(mask > 0) & (inner == 0)] = border


def card(img, small, big, anchor="top", accent=False, sub=None, margin=24):
    """The label card: a small line over a big one, optional hint underneath.

    Forest card with Oat text by default. `accent=True` flips it to an Oat
    card with Ink text - the brand's "paper card" - which is how the demos
    shout (SLOUCHING, a win, the pen going down).

    anchor="bottom" parks it above Instagram's bottom UI instead of the top.
    """
    h, w = img.shape[:2]
    # sized off the frame HEIGHT, so it stays modest on a wide window and
    # doesn't turn into a billboard
    big_size = fit_size(big, w - 150, start=max(24, int(h / 13)))
    small_size = max(11, int(big_size * 0.30))
    sub_size = max(11, int(big_size * 0.26)) if sub else 0

    pad = int(big_size * 0.75)
    widths = [text_width(big, big_size) + pad, text_width(small, small_size) + pad]
    if sub:
        widths.append(text_width(sub, sub_size, SMALL_WEIGHT) + pad)
    panel_w = min(w - 28, max(max(widths), 220))

    gap = int(big_size * 0.95)
    height = int(small_size * 1.4) + gap + 18 + (int(sub_size * 1.8) if sub else 0)
    y0 = margin if anchor == "top" else h - height - max(margin, int(h * 0.09))
    x0, x1 = (w - panel_w) // 2, (w + panel_w) // 2
    mid = (x0 + x1) // 2

    fill, ink, dim = ((OAT, INK, STONE) if accent else (FOREST, OAT, LINE))
    rounded(img, (x0, y0, x1, y0 + height), fill, radius=18,
            border=LINE if accent else MOSS)
    draw_text(img, small, (mid, y0 + int(small_size * 0.95)), small_size, dim, SMALL_WEIGHT)
    draw_text(img, big, (mid, y0 + int(small_size * 1.4) + gap // 2 + 4), big_size, ink)
    if sub:
        draw_text(img, sub, (mid, y0 + height - int(sub_size * 1.0)),
                  sub_size, dim, SMALL_WEIGHT)
    return y0 + height


def caption(img, small, big, accent=False, top=24):
    """Label card at the top of the frame (see card())."""
    return card(img, small, big, anchor="top", accent=accent, margin=top)


def big_middle(img, text, accent=False):
    """One huge word in the middle: the countdown, SHOOT!, CLEARED."""
    h, w = img.shape[:2]
    # deliberately modest: this sits over your face for a second or two, so
    # it should read instantly without hiding what you are doing
    size = fit_size(text, int(w * 0.45), start=int(h * 0.19))
    tw = text_width(text, size)
    pad = int(size * 0.30)
    box = ((w - tw) // 2 - pad, h // 2 - int(size * 0.62),
           (w + tw) // 2 + pad, h // 2 + int(size * 0.62))
    fill, ink = (OAT, INK) if accent else (FOREST, OAT)
    rounded(img, box, fill, alpha=0.86, radius=int(size * 0.26),
            border=LINE if accent else MOSS)
    draw_text(img, text, (w // 2, h // 2), size, ink)


def hint(img, text, size=None):
    """Small Stone-on-Oat strip along the bottom, for the key reminders."""
    h, w = img.shape[:2]
    size = size or max(12, int(h / 42))
    tw = text_width(text, size, SMALL_WEIGHT)
    x0, x1 = (w - tw - 44) // 2, (w + tw + 44) // 2
    rounded(img, (x0, h - 52, x1, h - 16), OAT, alpha=0.85, radius=16)
    draw_text(img, text, (w // 2, h - 34), size, STONE, SMALL_WEIGHT)


# ---------------------------------------------------------------- framing
# A webcam shoots 16:9. A reel is 9:16. You can show the whole picture (wide),
# letterbox it into a vertical window (fit), or keep the middle slice and lose
# about two thirds of the width (crop) - which looks heavily zoomed in.
MODES = ("wide", "fit", "crop")
TALL_HEIGHT = 960       # window height in fit / crop
WIDE_HEIGHT = 720       # window height in wide


def next_mode(mode):
    return MODES[(MODES.index(mode) + 1) % len(MODES)] if mode in MODES else "wide"


def window_size(mode):
    if mode == "wide":
        return (int(WIDE_HEIGHT * 16 / 9), WIDE_HEIGHT)
    return (TALL_HEIGHT * 9 // 16, TALL_HEIGHT)


def fit_frame(frame, mode):
    """Mirror the camera frame and fit it to the window."""
    frame = cv2.flip(frame, 1)
    h, w = frame.shape[:2]
    if mode == "wide":
        return cv2.resize(frame, (int(w * WIDE_HEIGHT / h), WIDE_HEIGHT))

    cw, ch = TALL_HEIGHT * 9 // 16, TALL_HEIGHT
    if mode == "crop":
        keep = int(h * 9 / 16)
        x0 = (w - keep) // 2
        return cv2.resize(frame[:, x0:x0 + keep], (cw, ch))

    scaled = cv2.resize(frame, (cw, max(1, int(h * cw / w))))
    canvas = np.zeros((ch, cw, 3), np.uint8)
    y0 = max(0, min(ch - scaled.shape[0], (ch - scaled.shape[0]) // 2 + 70))
    canvas[y0:y0 + scaled.shape[0]] = scaled
    return canvas


def skeleton_specs(mp_draw):
    """Landmark + connection styles: Oat joints, Moss bones."""
    return (mp_draw.DrawingSpec(color=OAT, thickness=2, circle_radius=3),
            mp_draw.DrawingSpec(color=MOSS, thickness=3))
