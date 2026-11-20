"""
finger_circle_game.py - the perfect circle challenge, drawn in mid-air.

Track your index fingertip with MediaPipe Hands, draw a circle in the air,
and get scored out of 100 on how round it was. It then overlays the perfect
circle it fitted to your attempt, so you can see exactly where you went wrong.
Your best score of the session stays on screen.

There is no model here: the score is the average distance of your stroke from
a best-fit circle, as a percentage of that circle's radius.

Run:   python finger_circle_game.py
Keys:  q = quit   c = clear   r = reset best   p = framing (wide / fit / crop)

  POINT (index out, other fingers curled) -> draw
  OPEN PALM                               -> lift the pen and get scored
  FIST (held ~half a second)              -> wipe and try again
"""

import sys

try:
    import cv2
    import mediapipe as mp
    import numpy as np
except ImportError as missing:
    sys.exit(
        "Missing package: %s\n\n"
        "Install the dependencies with:\n"
        "    pip install -r requirements.txt\n"
        "or:\n"
        '    pip install "mediapipe==0.10.14" opencv-python numpy pillow\n'
        % missing.name
    )

import math
import time

import theme

# ---------------------------------------------------------------- settings
CAMERA_INDEX = 0
VIEW_MODE = "wide"      # wide / fit / crop - press p to cycle

LINE_THICKNESS = 10
FIST_HOLD_SECONDS = 0.5
SMOOTHING = 0.5         # 0 = raw fingertip, closer to 1 = smoother but laggier
MIN_POINTS = 25
MIN_RADIUS = 45         # pixels; smaller than this is a doodle, not an attempt
COVERAGE = 0.80         # how much of the way round you must get (0.8 = 288 deg)
HARSHNESS = 2.5         # how fast the score falls as the stroke wanders

# Edit these freely - they are the punchline on camera.
GRADES = [
    (97, "ARE YOU A PRINTER?"),
    (93, "THAT'S ELITE"),
    (85, "PRETTY GOOD"),
    (75, "NOT BAD"),
    (60, "THAT'S AN EGG"),
    (0, "THAT'S A POTATO"),
]

TITLE = "Perfect Circle Challenge  (q = quit)"
mp_hands = mp.solutions.hands
mp_draw = mp.solutions.drawing_utils
FINGERS = [(8, 6), (12, 10), (16, 14), (20, 18)]    # (tip, middle knuckle)


def view_size():
    return theme.window_size(VIEW_MODE)


def to_view(frame):
    return theme.fit_frame(frame, VIEW_MODE)


# ---------------------------------------------------------------- gestures
def fingers_up(lm, w, h):
    def p(i):
        return np.array([lm[i].x * w, lm[i].y * h])

    wrist = p(0)
    return [np.linalg.norm(p(tip) - wrist) > 1.1 * np.linalg.norm(p(pip) - wrist)
            for tip, pip in FINGERS]


def read_gesture(up):
    index, middle, ring, pinky = up
    if index and not middle and not ring and not pinky:
        return "point"
    if not any(up):
        return "fist"
    if sum(up) >= 3:
        return "palm"
    return "other"


# ---------------------------------------------------------------- scoring
def fit_circle(pts):
    """Least-squares circle through the points (Kasa's method).

    Solves for the centre that makes every point the same distance away, by
    turning the circle equation into a plain linear system. Falls back to the
    centroid if the maths is degenerate.
    """
    x, y = pts[:, 0], pts[:, 1]
    a = np.column_stack([x, y, np.ones(len(pts))])
    b = x ** 2 + y ** 2
    try:
        cx, cy, c = np.linalg.lstsq(a, b, rcond=None)[0]
        centre = np.array([cx / 2, cy / 2])
        radius = math.sqrt(max(c + centre[0] ** 2 + centre[1] ** 2, 1e-6))
    except np.linalg.LinAlgError:
        centre = pts.mean(axis=0)
        radius = float(np.hypot(*(pts - centre).T).mean())
    return centre, radius


def score_circle(points):
    """Returns (score 0-100, centre, radius) or (None, reason, None).

    The score is how far your stroke strays from the fitted circle: we take
    the average gap, measure it as a fraction of the radius, and subtract.
    A gap of 4% of the radius costs 10 points.
    """
    if len(points) < MIN_POINTS:
        return None, "KEEP GOING", None
    pts = np.array(points, np.float32)
    centre, radius = fit_circle(pts)
    if radius < MIN_RADIUS:
        return None, "DRAW IT BIGGER", None

    # did you actually go most of the way round?
    angles = np.sort(np.arctan2(pts[:, 1] - centre[1], pts[:, 0] - centre[0]))
    gaps = np.diff(np.r_[angles, angles[0] + 2 * math.pi])
    covered = (2 * math.pi - gaps.max()) / (2 * math.pi)
    if covered < COVERAGE:
        return None, "FINISH THE CIRCLE", None

    radii = np.hypot(*(pts - centre).T)
    wander = float(np.abs(radii - radius).mean()) / radius
    score = int(round(max(0.0, min(100.0, 100 * (1 - HARSHNESS * wander)))))
    return score, centre, radius


def grade(score):
    for cut, text in GRADES:
        if score >= cut:
            return text
    return GRADES[-1][1]


# ---------------------------------------------------------------- main loop
def main():
    global VIEW_MODE
    cap = cv2.VideoCapture(CAMERA_INDEX)
    if not cap.isOpened():
        print("Could not open the camera. Allow camera access for your terminal in "
              "System Settings > Privacy & Security > Camera, or change CAMERA_INDEX.")
        return
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    cv2.namedWindow(TITLE, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(TITLE, *view_size())

    canvas = None
    points = []                 # the stroke, in view pixels
    prev = tip = None
    point_frames = 0
    fist_since = None
    score = problem = None      # the verdict, once the pen lifts
    fit = None                  # (centre, radius) of the fitted circle
    best = 0

    with mp_hands.Hands(max_num_hands=1, model_complexity=1,
                        min_detection_confidence=0.6,
                        min_tracking_confidence=0.6) as hands:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            view = to_view(frame)
            h, w = view.shape[:2]
            if canvas is None or canvas.shape != view.shape:
                canvas = np.zeros_like(view)
                points, prev, score, problem, fit = [], None, None, None, None
            result = hands.process(cv2.cvtColor(view, cv2.COLOR_BGR2RGB))
            now = time.time()
            drawing = False

            if result.multi_hand_landmarks:
                hand = result.multi_hand_landmarks[0]
                gesture = read_gesture(fingers_up(hand.landmark, w, h))
                raw = np.array([hand.landmark[8].x * w, hand.landmark[8].y * h])
                tip = raw if tip is None else SMOOTHING * tip + (1 - SMOOTHING) * raw
                pos = (int(tip[0]), int(tip[1]))

                point_frames = point_frames + 1 if gesture == "point" else 0
                fist_since = (fist_since or now) if gesture == "fist" else None

                if point_frames >= 2:                       # pen down
                    if prev is None:                        # a new attempt
                        canvas[:] = 0
                        points, score, problem, fit = [], None, None, None
                    else:
                        cv2.line(canvas, prev, pos, theme.MOSS,
                                 LINE_THICKNESS, cv2.LINE_AA)
                    prev = pos
                    points.append(pos)
                    drawing = True
                else:
                    if prev is not None:                    # pen just lifted
                        score, extra, radius = score_circle(points)
                        if score is None:
                            problem, fit = extra, None
                        else:
                            problem, fit = None, (extra, radius)
                            best = max(best, score)
                    prev = None
                    if gesture == "fist" and now - fist_since >= FIST_HOLD_SECONDS:
                        canvas[:] = 0
                        points, score, problem, fit = [], None, None, None

                joints, bones = theme.skeleton_specs(mp_draw)
                mp_draw.draw_landmarks(view, hand, mp_hands.HAND_CONNECTIONS,
                                       joints, bones)
            else:
                prev, tip, point_frames, fist_since = None, None, 0, None

            # your stroke, then the circle you were aiming for
            mask = canvas.any(axis=2)
            view[mask] = canvas[mask]
            if fit is not None:
                centre, radius = fit
                cv2.circle(view, (int(centre[0]), int(centre[1])), int(radius),
                           theme.OAT, 2, cv2.LINE_AA)
            if tip is not None and result.multi_hand_landmarks:
                cv2.circle(view, (int(tip[0]), int(tip[1])), 13, (0, 0, 0), 5)
                cv2.circle(view, (int(tip[0]), int(tip[1])), 13,
                           theme.MOSS if drawing else theme.OAT, 3)

            # --- the cards
            if score is not None:
                theme.card(view, grade(score), "%d%%" % score, accent=True,
                           sub="cream line = the perfect circle")
            elif problem:
                theme.card(view, "NOT YET", problem)
            elif drawing:
                theme.card(view, "DRAWING", "KEEP GOING")
            else:
                theme.card(view, "PERFECT CIRCLE CHALLENGE", "DRAW A CIRCLE",
                           sub="point to draw, open palm to score")
            if best:
                theme.hint(view, "best this session: %d%%" % best)

            cv2.imshow(TITLE, view)
            key = cv2.waitKey(1) & 0xFF
            if key == ord("q"):
                break
            if key == ord("c"):
                canvas[:] = 0
                points, score, problem, fit = [], None, None, None
            if key == ord("r"):
                best = 0
            if key == ord("p"):
                VIEW_MODE = theme.next_mode(VIEW_MODE)
                cv2.resizeWindow(TITLE, *view_size())

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
