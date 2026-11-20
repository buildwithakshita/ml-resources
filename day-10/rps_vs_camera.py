"""
rps_vs_camera.py - rock, paper, scissors against your laptop.

Tracks one hand with MediaPipe Hands and reads its shape:
  ROCK      = fist (no fingers out)
  PAPER     = open hand (all four fingers out)
  SCISSORS  = index + middle out, ring + pinky curled

Press SPACE: it counts "3, 2, 1, SHOOT!", reads your hand on SHOOT, picks a
random move for the computer, shows both and who won. Score is kept on top.

Run:   python rps_vs_camera.py
Keys:  SPACE = play a round   r = reset score   q = quit   p = framing (wide / fit / crop)
"""

import random
import time
from collections import Counter

import theme

import cv2
import mediapipe as mp
import numpy as np

# ---------------------------------------------------------------- settings
CAMERA_INDEX = 0
VIEW_MODE = "wide"      # wide / fit / crop - press p to cycle

COUNT_STEP = 0.8            # seconds per "3", "2", "1"
SHOOT_WINDOW = 0.6          # seconds we watch your hand after "SHOOT!"
RESULT_SECONDS = 4.0        # how long the result stays up

MOVES = ["ROCK", "PAPER", "SCISSORS"]
BEATS = {"ROCK": "SCISSORS", "PAPER": "ROCK", "SCISSORS": "PAPER"}   # key beats value

TITLE = "Rock Paper Scissors  (space = play, q = quit)"


def view_size():
    return theme.window_size(VIEW_MODE)


FONT = cv2.FONT_HERSHEY_DUPLEX
mp_hands = mp.solutions.hands
mp_draw = mp.solutions.drawing_utils
FINGERS = [(8, 6), (12, 10), (16, 14), (20, 18)]   # (tip, middle knuckle)


# ---------------------------------------------------------------- drawing
def to_view(frame):
    return theme.fit_frame(frame, VIEW_MODE)


def darken(img, y0, y1, amount=0.65):
    img[y0:y1] = (img[y0:y1] * (1 - amount)).astype(np.uint8)


def big_text(img, text, center_y, color, max_scale=2.6, margin=24):
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


# ---------------------------------------------------------------- the "model"
def fingers_up(lm, w, h):
    """[index, middle, ring, pinky] -> True if the fingertip is clearly farther
    from the wrist than the finger's middle knuckle (= finger is straight)."""
    def p(i):
        return np.array([lm[i].x * w, lm[i].y * h])

    wrist = p(0)
    return [np.linalg.norm(p(tip) - wrist) > 1.1 * np.linalg.norm(p(pip) - wrist)
            for tip, pip in FINGERS]


def read_move(up):
    index, middle, ring, pinky = up
    if not any(up):
        return "ROCK"
    if all(up):
        return "PAPER"
    if index and middle and not ring and not pinky:
        return "SCISSORS"
    return None


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
    # WINDOW_NORMAL = you can drag the window corner to resize it,
    # or green-button it to full screen. WINDOW_AUTOSIZE (the default)
    # locks it to WINDOW_HEIGHT.
    cv2.namedWindow(TITLE, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(TITLE, view_size()[0], view_size()[1])

    score = {"you": 0, "cpu": 0}
    phase, phase_start = "idle", 0.0        # idle -> countdown -> shoot -> result
    seen_moves = []                          # hand shapes seen during "shoot"
    you = cpu = outcome = None

    with mp_hands.Hands(max_num_hands=1, model_complexity=1,
                        min_detection_confidence=0.6,
                        min_tracking_confidence=0.6) as hands:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            view = to_view(frame)
            h, w = view.shape[:2]
            result = hands.process(cv2.cvtColor(view, cv2.COLOR_BGR2RGB))
            now = time.time()
            t = now - phase_start

            move = None
            if result.multi_hand_landmarks:
                hand = result.multi_hand_landmarks[0]
                move = read_move(fingers_up(hand.landmark, w, h))
                joints, bones = theme.skeleton_specs(mp_draw)
                mp_draw.draw_landmarks(view, hand, mp_hands.HAND_CONNECTIONS,
                                       joints, bones)

            # --- move the game forward
            if phase == "countdown" and t >= 3 * COUNT_STEP:
                phase, phase_start, seen_moves, t = "shoot", now, [], 0.0
            if phase == "shoot":
                if move:
                    seen_moves.append(move)
                if t >= SHOOT_WINDOW:
                    you = Counter(seen_moves).most_common(1)[0][0] if seen_moves else None
                    cpu = random.choice(MOVES)
                    if you is None:
                        outcome = "none"
                    elif you == cpu:
                        outcome = "draw"
                    elif BEATS[you] == cpu:
                        outcome = "win"
                        score["you"] += 1
                    else:
                        outcome = "lose"
                        score["cpu"] += 1
                    phase, phase_start = "result", now
            elif phase == "result" and t >= RESULT_SECONDS:
                phase = "idle"

            # --- scoreboard, always on top; it flips to a bright Oat card
            # for a few seconds whenever you win a round
            just_won = phase == "result" and outcome == "win" and t < 2.0
            theme.caption(view, "YOU  -  CPU",
                          "%d : %d" % (score["you"], score["cpu"]), accent=just_won)

            if phase == "idle":
                theme.card(view, "I SEE", move or "NO HAND", anchor="bottom",
                           accent=bool(move), sub="press SPACE to play")
            elif phase == "countdown":
                theme.big_middle(view, str(3 - int(t / COUNT_STEP)))
            elif phase == "shoot":
                theme.big_middle(view, "SHOOT!", accent=True)
            elif phase == "result":
                if outcome == "none":
                    theme.card(view, "NO HAND SEEN", "TRY AGAIN", anchor="bottom",
                               sub="hold your shape up on SHOOT!")
                else:
                    text = {"win": "YOU WIN", "lose": "CPU WINS", "draw": "DRAW"}[outcome]
                    theme.card(view, "%s  vs  %s" % (you, cpu), text, anchor="bottom",
                               accent=outcome == "win")

            cv2.imshow(TITLE, view)
            key = cv2.waitKey(1) & 0xFF
            if key == ord("q"):
                break
            if key == ord(" ") and phase in ("idle", "result"):
                phase, phase_start = "countdown", time.time()
            if key == ord("r"):
                score = {"you": 0, "cpu": 0}
            if key == ord("p"):
                VIEW_MODE = theme.next_mode(VIEW_MODE)
                cv2.resizeWindow(TITLE, *view_size())

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
