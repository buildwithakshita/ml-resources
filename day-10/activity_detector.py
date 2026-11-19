"""
activity_detector.py - live webcam pose tracking with an activity label overlay.

Tracks your body with MediaPipe Pose, draws the skeleton on the video feed, and
names what you are doing in big on-screen text: TYPING, EATING, SLOUCHING,
STRETCHING, WAVING, SITTING or STANDING.
No training - every action is a few lines of geometry on the body landmarks.

Run:   python activity_detector.py
Keys:  q = quit   p = framing (wide / fit / crop)   d = debug numbers
       k = forget posture history (sit up straight, then press k)

Before you film, read README.md and test all three actions on camera.
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
        '    pip install "mediapipe==0.10.14" opencv-python numpy\n\n'
        "Note: mediapipe needs Python 3.9-3.12, and the pinned version is what\n"
        "provides the mediapipe.solutions.pose API this script uses."
        % missing.name
    )

import time
from collections import Counter, deque

import theme

# ---------------------------------------------------------------- settings
CAMERA_INDEX = 0        # try 1 if the wrong camera opens (e.g. your iPhone)
VIEW_MODE = "wide"      # wide / fit / crop - press p to cycle

STRETCH_STRAIGHT = 150  # stretching: elbow angle (degrees) counted as "arm extended"
TYPE_BENT = 130         # typing: elbow angle below this counts as "elbow bent"
TYPE_STILL = 0.35       # typing: max wrist movement (shoulder widths per second)
WAVE_SWING = 0.25       # waving: side-to-side travel, in shoulder widths
WAVE_SECONDS = 1.0      # waving: how much recent history to look at (see Motion)
STILL_SECONDS = 0.4     # typing: how much recent history the stillness check uses
STAND_THIGH = 0.55      # standing: thigh length / torso length above this
EAT_NEAR = 0.6          # eating: hand-to-mouth distance, in shoulder widths
EAT_BENT = 145          # eating: elbow angle below this counts as "bent"
SLOUCH_DROP = 0.82      # slouching: neck this much shorter than your usual-best
SLOUCH_CLEAR = 0.88     # slouching: sit back above this to clear it (hysteresis)
SLOUCH_MEMORY = 30      # slouching: seconds of posture history to compare against
VOTE_FRAMES = 15        # majority vote over this many frames (less flicker)

# Brand colours live in theme.py. Here we only say which labels shout: those
# are drawn as an Oat "paper card" with Ink text, the rest as a Forest card.
SHOUT = {"SLOUCHING", "STRETCHING", "WAVING", "EATING"}

TITLE = "Activity Detector  (q = quit)"


def view_size():
    return theme.window_size(VIEW_MODE)


FONT = cv2.FONT_HERSHEY_DUPLEX
mp_pose = mp.solutions.pose
mp_draw = mp.solutions.drawing_utils
P = mp_pose.PoseLandmark


# ---------------------------------------------------------------- drawing
def to_view(frame):
    return theme.fit_frame(frame, VIEW_MODE)


def pill(img, x0, y0, x1, y1, radius=22, alpha=0.55):
    """Soft dark rounded panel behind text - keeps contrast without a black bar."""
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(img.shape[1], x1), min(img.shape[0], y1)
    if x1 <= x0 or y1 <= y0:
        return
    shape = np.zeros(img.shape[:2], np.uint8)
    cv2.rectangle(shape, (x0 + radius, y0), (x1 - radius, y1), 255, -1)
    cv2.rectangle(shape, (x0, y0 + radius), (x1, y1 - radius), 255, -1)
    for cx, cy in ((x0 + radius, y0 + radius), (x1 - radius, y0 + radius),
                   (x0 + radius, y1 - radius), (x1 - radius, y1 - radius)):
        cv2.circle(shape, (cx, cy), radius, 255, -1)
    region = shape.astype(bool)
    img[region] = (img[region] * (1 - alpha)).astype(np.uint8)


def big_text(img, text, center_y, color, max_scale=2.6, margin=24):
    """Centered, black-outlined text that shrinks to fit the frame width."""
    w = img.shape[1]
    scale = max_scale
    while True:
        thick = max(2, int(scale * 1.6))
        (tw, th), _ = cv2.getTextSize(text, FONT, scale, thick)
        if tw <= w - 2 * margin or scale <= 0.5:
            break
        scale -= 0.1
    org = ((w - tw) // 2, center_y + th // 2)
    cv2.putText(img, text, org, FONT, scale, (0, 0, 0), thick + 6, cv2.LINE_AA)
    cv2.putText(img, text, org, FONT, scale, color, thick, cv2.LINE_AA)
    return tw, th


# ---------------------------------------------------------------- the "model"
def angle_at(a, b, c):
    """Angle in degrees at point b, formed by a-b-c (e.g. shoulder-elbow-wrist)."""
    ba, bc = a - b, c - b
    cosine = np.dot(ba, bc) / (np.linalg.norm(ba) * np.linalg.norm(bc) + 1e-9)
    return float(np.degrees(np.arccos(np.clip(cosine, -1.0, 1.0))))


class Motion:
    """Remembers where one wrist has been, to spot a wave and to measure stillness.

    Positions are stored in shoulder widths relative to the chest, so stepping
    closer to or further from the camera does not change the numbers.

    History is kept by TIME, not by a frame count: a wave is about two swings a
    second, so a fixed "last 10 frames" would cover less than half a swing on a
    fast webcam and the oscillation below could never trigger.
    """

    def __init__(self):
        self.history = deque()                     # (time, x, y), last WAVE_SECONDS

    def update(self, now, x, y, visible):
        if not visible:
            self.history.clear()
            return
        self.history.append((now, x, y))
        while self.history and now - self.history[0][0] > WAVE_SECONDS:
            self.history.popleft()

    def recent(self, seconds):
        if not self.history:
            return []
        cutoff = self.history[-1][0] - seconds
        return [s for s in self.history if s[0] >= cutoff]

    def speed(self):
        """Wrist travel per second, in shoulder widths. 0 when standing still."""
        samples = self.recent(STILL_SECONDS)
        if len(samples) < 3:
            return 0.0
        seconds = samples[-1][0] - samples[0][0]
        if seconds <= 0:
            return 0.0
        moved = sum(
            abs(b[1] - a[1]) + abs(b[2] - a[2])
            for a, b in zip(samples, samples[1:])
        )
        return moved / seconds

    def is_oscillating(self):
        """True when the wrist has swung side to side, not just drifted once."""
        xs = [x for _, x, _ in self.history]
        if len(xs) < 6 or max(xs) - min(xs) < WAVE_SWING:
            return False
        flips, last_dir, anchor = 0, 0, xs[0]
        for x in xs[1:]:
            if abs(x - anchor) < 0.06:          # ignore tiny jitter
                continue
            direction = 1 if x > anchor else -1
            if last_dir and direction != last_dir:
                flips += 1
            last_dir, anchor = direction, x
        return flips >= 2


class Posture:
    """Watches how tall you sit, and notices when you sink.

    "Neck length" is the gap between your nose and your shoulder line, divided
    by shoulder width so distance from the camera doesn't matter. Slouching
    shortens it: your head drops forward and your shoulders come up.

    There is no calibration step: it compares you against how you have been
    sitting for the last SLOUCH_MEMORY seconds. Press k to wipe that memory.

    The benchmark is the 60th percentile of recent measurements, NOT the
    highest one. Landmark positions jitter frame to frame, and one lucky frame
    (or a moment of leaning back) would otherwise set a bar you can never meet
    again - which shows up as "SLOUCHING" while you sit perfectly straight.
    """

    def __init__(self):
        self.history = deque()          # (time, neck ratio)
        self.slouching = False          # current state, for hysteresis

    def reset(self):
        self.history.clear()
        self.slouching = False

    def update(self, now, ratio):
        self.history.append((now, ratio))
        while self.history and now - self.history[0][0] > SLOUCH_MEMORY:
            self.history.popleft()

    def is_slouching(self, ratio):
        # a couple of seconds of history before judging anyone
        if not self.history or self.history[-1][0] - self.history[0][0] < 2.0:
            return False, 0.0
        good = float(np.percentile([r for _, r in self.history], 60))
        # hysteresis: easy to clear, so a borderline posture doesn't flicker
        limit = (SLOUCH_CLEAR if self.slouching else SLOUCH_DROP) * good
        self.slouching = ratio < limit
        return self.slouching, good


def classify(lm, now, motion, posture=None):
    """lm = 33 pose landmarks (x, y in 0..1, y grows downward).

    Returns (label or None, debug text). None means "nothing matched
    confidently" - the caller then keeps showing the last stable label.
    """
    def pt(i):
        return np.array([lm[i].x, lm[i].y])

    def seen(i):
        """Visible AND actually inside the picture.

        MediaPipe keeps predicting a joint after it leaves the frame, with the
        confidence still high. Sitting close to a laptop, both wrists get
        guessed somewhere above the top edge - which looks exactly like arms
        raised, and the label flips to STRETCHING while you sit still. So a
        joint only counts when its coordinates are on screen.
        """
        return (lm[i].visibility > 0.5
                and 0.0 <= lm[i].x <= 1.0 and 0.0 <= lm[i].y <= 1.0)

    l_sh, r_sh = pt(P.LEFT_SHOULDER), pt(P.RIGHT_SHOULDER)
    l_el, r_el = pt(P.LEFT_ELBOW), pt(P.RIGHT_ELBOW)
    l_wr, r_wr = pt(P.LEFT_WRIST), pt(P.RIGHT_WRIST)
    l_hip, r_hip = pt(P.LEFT_HIP), pt(P.RIGHT_HIP)
    sh_mid, hip_mid = (l_sh + r_sh) / 2, (l_hip + r_hip) / 2
    sw = max(float(np.linalg.norm(l_sh - r_sh)), 1e-3)      # shoulder width = our ruler

    # feed both wrists into the motion trackers (positions in shoulder widths)
    for side, wrist in enumerate((l_wr, r_wr)):
        joint = P.LEFT_WRIST if side == 0 else P.RIGHT_WRIST
        motion[side].update(now, (wrist[0] - sh_mid[0]) / sw,
                            (wrist[1] - sh_mid[1]) / sw, seen(joint))

    l_up = seen(P.LEFT_WRIST) and l_wr[1] < l_sh[1]         # wrist above shoulder
    r_up = seen(P.RIGHT_WRIST) and r_wr[1] < r_sh[1]
    l_angle = angle_at(l_sh, l_el, l_wr)
    r_angle = angle_at(r_sh, r_el, r_wr)
    debug = "L%.0f R%.0f  spd %.2f/%.2f" % (
        l_angle, r_angle, motion[0].speed(), motion[1].speed())

    neck = (sh_mid[1] - lm[P.NOSE].y) / sw if seen(P.NOSE) else None
    slouching, best_neck = False, 0.0
    if neck is not None and posture is not None:
        slouching, best_neck = posture.is_slouching(neck)
        posture.update(now, neck)
        debug += "  neck %.2f/%.2f" % (neck, best_neck)

    # --- with no shoulders in shot there is nothing to measure against
    if not (seen(P.LEFT_SHOULDER) and seen(P.RIGHT_SHOULDER)):
        return "STEP BACK", debug

    # Hands out of frame is normal at a desk, so instead of demanding a better
    # shot we just skip the rules that need them and fall through to posture.
    hands_in_shot = seen(P.LEFT_WRIST) and seen(P.RIGHT_WRIST)

    # --- STRETCHING: both wrists above the shoulders with the arms extended
    if hands_in_shot and l_up and r_up and l_angle > STRETCH_STRAIGHT and r_angle > STRETCH_STRAIGHT:
        return "STRETCHING", debug

    # --- WAVING: one raised wrist swinging side to side
    waving = (l_up and motion[0].is_oscillating()) or (r_up and motion[1].is_oscillating())
    if hands_in_shot and waving and not (l_up and r_up):
        return "WAVING", debug

    # --- SLOUCHING: sitting noticeably shorter than your own best posture
    if slouching:
        return "SLOUCHING", debug

    # --- EATING: a hand parked at your mouth, elbow bent. Checked after
    # waving, because a raised waving hand also passes near the face - and
    # the hand must be at or below nose level, which a wave is not.
    if seen(P.MOUTH_LEFT) and seen(P.MOUTH_RIGHT) and seen(P.NOSE):
        mouth = (pt(P.MOUTH_LEFT) + pt(P.MOUTH_RIGHT)) / 2
        for joint, wrist, elbow_angle in ((P.LEFT_WRIST, l_wr, l_angle),
                                          (P.RIGHT_WRIST, r_wr, r_angle)):
            if (seen(joint) and elbow_angle < EAT_BENT
                    and wrist[1] > lm[P.NOSE].y
                    and float(np.linalg.norm(wrist - mouth)) < EAT_NEAR * sw):
                return "EATING", debug

    # --- TYPING: both hands down near desk height, elbows bent, hardly moving
    hands_low = all(
        seen(joint) and wrist[1] > sh_mid[1] + 0.3 * sw and wrist[1] < hip_mid[1] + 0.6 * sw
        for joint, wrist in ((P.LEFT_WRIST, l_wr), (P.RIGHT_WRIST, r_wr))
    )
    elbows_bent = l_angle < TYPE_BENT and r_angle < TYPE_BENT
    still = max(motion[0].speed(), motion[1].speed()) < TYPE_STILL
    if hands_low and elbows_bent and still:
        return "TYPING", debug

    # --- SITTING / STANDING: compare thigh length to torso length.
    # Standing side-on to the camera, the thigh is seen at full length; sitting,
    # it points towards the lens and looks short. Both knees must be in frame -
    # at desk distance they usually are not - and at a desk you are sitting,
    # so that is the sensible resting state rather than no label at all.
    thighs = []
    for hip, knee, sh in ((P.LEFT_HIP, P.LEFT_KNEE, l_sh), (P.RIGHT_HIP, P.RIGHT_KNEE, r_sh)):
        if seen(hip) and seen(knee) and lm[knee].y < 1.0:
            torso = max(lm[hip].y - sh[1], 1e-3)
            thighs.append((lm[knee].y - lm[hip].y) / torso)
    if thighs:
        ratio = float(np.mean(thighs))
        debug += "  thigh %.2f" % ratio
        return ("STANDING" if ratio > STAND_THIGH else "SITTING"), debug

    return "SITTING", debug     # knees out of frame: you are at the desk


# ---------------------------------------------------------------- main loop
def main():
    global VIEW_MODE
    cap = cv2.VideoCapture(CAMERA_INDEX)
    if not cap.isOpened():
        print("Could not open the camera. Allow camera access for your terminal in "
              "System Settings > Privacy & Security > Camera, or change CAMERA_INDEX "
              "at the top of this file.")
        return
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    # WINDOW_NORMAL = you can drag the window corner to resize it,
    # or green-button it to full screen. WINDOW_AUTOSIZE (the default)
    # locks it to WINDOW_HEIGHT.
    cv2.namedWindow(TITLE, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(TITLE, view_size()[0], view_size()[1])

    motion = (Motion(), Motion())
    posture = Posture()
    votes = deque(maxlen=VOTE_FRAMES)
    stable = None                       # last label we were confident about
    show_debug = False

    with mp_pose.Pose(model_complexity=1, min_detection_confidence=0.5,
                      min_tracking_confidence=0.5) as pose:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            view = to_view(frame)
            result = pose.process(cv2.cvtColor(view, cv2.COLOR_BGR2RGB))

            debug = ""
            if result.pose_landmarks:
                guess, debug = classify(result.pose_landmarks.landmark, time.time(),
                                        motion, posture)

                # hide the face dots (landmarks 0-10) - drawing_utils skips
                # anything below 0.5 visibility, and a face full of dots is the
                # ugliest part of the default overlay
                for i in range(11):
                    result.pose_landmarks.landmark[i].visibility = 0.0
                joints, bones = theme.skeleton_specs(mp_draw)
                mp_draw.draw_landmarks(view, result.pose_landmarks,
                                       mp_pose.POSE_CONNECTIONS, joints, bones)
                if guess is not None:
                    votes.append(guess)
                if votes:
                    stable = Counter(votes).most_common(1)[0][0]
                label = stable or "GET IN FRAME"
            else:
                votes.clear()
                label = "GET IN FRAME"

            theme.caption(view, "I THINK YOU ARE", label, accent=label in SHOUT)
            if show_debug and debug:
                theme.hint(view, debug)

            cv2.imshow(TITLE, view)
            key = cv2.waitKey(1) & 0xFF
            if key == ord("q"):
                break
            if key == ord("p"):                   # wide -> fit -> crop -> wide
                modes = ("wide", "fit", "crop")
                VIEW_MODE = modes[(modes.index(VIEW_MODE) + 1) % len(modes)]
                cv2.resizeWindow(TITLE, *view_size())
            if key == ord("k"):                   # forget my posture history
                posture.reset()
            if key == ord("d"):
                show_debug = not show_debug

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
