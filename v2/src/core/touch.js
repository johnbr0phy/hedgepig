import { clamp } from './util.js';

/* ------------------------------------------------------------------ *
 * Playing it with your thumbs.
 *
 * Before this you could look around a phone screen, pinch to zoom and tap to
 * sow — and **you could not walk**.  Everything that moves him was on WASD,
 * the hop was on space and getting into the rocket was on E, so the whole
 * game past looking at it was keyboard-only.  This is the missing half.
 *
 * ------------------------------ the layout ------------------------------
 *
 * The screen is split down the middle, which is the arrangement every
 * touch game has converged on for the good reason that it matches where
 * thumbs are:
 *
 *   LEFT   a stick that appears wherever you put your thumb down, and
 *          **push it past its ring and he rolls**.
 *   RIGHT  drag to look, tap to sow.  Exactly what it already did.
 *
 * The stick is **floating, not fixed**.  A stick painted at a set place is a
 * stick you have to look down at to find; one that appears under your thumb
 * is one you can use without taking your eyes off a hedgehog.
 *
 * ------------------------------- the rules -------------------------------
 *
 * **The zone is decided on touch-DOWN and never revisited.**  Dragging a
 * stick past the middle of the screen must not hand the finger to the look
 * camera halfway through a walk, which is what testing whether the *current*
 * position is on the left would do.
 *
 * **It claims pointers from the chase camera rather than racing it.**  Both
 * want `pointerdown` on the same canvas; `chase.setPointerFilter` lets this
 * one say which are its own, so there is one owner per finger and no
 * ordering to get wrong.
 *
 * **Nothing here exists on a machine with a mouse.**  The controls are
 * created on the first real touch rather than from a user-agent string — a
 * laptop with a touchscreen should get both, and get the buttons only once
 * it turns out somebody is using their hands.
 *
 * ------------------------- what a thumb was missing -----------------------
 *
 * Three things were wrong with the first version of this, and all three were
 * the same mistake: **the keyboard was still the real interface, and the
 * glass was a partial translation of it.**
 *
 *  1. **The roll was on double-tap-and-hold, and it could not work.**  That
 *     is the keys' gesture, and on the keys it is unambiguous, because W is
 *     not also the sow button.  Here the same finger in the same place does
 *     both, so *every* tap armed a roll and any walk begun within a third of
 *     a second of sowing tucked him into a ball uncommanded.  The gesture is
 *     a coin flip between two things you might have meant.  It is now a
 *     **distance**: push the stick past its ring and he rolls, come back
 *     inside and he unfurls.  Nothing is timed, nothing is guessed, and —
 *     the part the double-tap could never have — **you can see it**, because
 *     the ring you are pushing past is drawn under your thumb.
 *
 *  2. **Half the verbs had no way in at all.**  Seeing the whole planet,
 *     the sound, photo mode and the journal were on P, M, C and J, which on
 *     a phone is nowhere.  They are on a menu now.
 *
 *  3. **Nothing said any of this.**  The keyboard legend is hidden on a
 *     small screen — correctly, it is a lie there — and nothing replaced it,
 *     so a phone got one button marked "hop" and no hint that the left half
 *     of the glass was a stick.  There is a card on the first touch now, and
 *     a button that brings it back.
 * ------------------------------------------------------------------ */

/** Under this it is a dead zone, or resting a thumb creeps him forward. */
const STICK_DEAD = 9;
/** The painted ring.  At its edge the throttle is already full. */
const STICK_R = 58;
/** Past this he tucks and rolls.  Coming back inside `STICK_R` unfurls him —
 *  the two are deliberately different, because a single threshold sitting
 *  exactly under a thumb that is never quite still flickers him in and out of
 *  a ball, and a ball that flickers is worse than no roll at all. */
const STICK_RUN = 84;
/** The thumb never gets further than this from the middle: past it the whole
 *  stick follows.  Without that, walking any distance means your thumb
 *  wanders off and the throttle silently pins at full in a direction you can
 *  no longer steer — and, now, pins *rolling* as well. */
const STICK_MAX = 106;

/**
 * The whole stylesheet, exported **only so the harness can look at it**.
 *
 * A stray back-quote inside this template literal ends it mid-rule, and the
 * damage depends on how many there are: an odd number is a syntax error and
 * the module will not import, which is loud; an even number closes and
 * reopens the string, and the stylesheet is silently truncated from that
 * point on.  That second one has now happened twice — `sky.js`'s shader
 * first, and this file's own stylesheet second — and neither showed up as
 * anything but "the controls look wrong on a phone".
 *
 * Nothing here builds a DOM in Node, so the harness cannot render this.  It
 * can read it, and `sTouch` asserts that every id this module creates is
 * still mentioned in it.
 */
export const TOUCH_CSS = `
.hg-touch { position: absolute; pointer-events: none; }
#hg-stick {
  width: ${STICK_RUN * 2}px; height: ${STICK_RUN * 2}px;
  margin: -${STICK_RUN}px 0 0 -${STICK_RUN}px;
  border-radius: 50%;
  border: 2px dashed rgba(255, 253, 248, 0.34);
  opacity: 0; transition: opacity 160ms ease;
}
#hg-stick.on { opacity: 1; }
/* The walk ring, inside the run ring.  Two circles and no caption: the inner
   one is how fast he walks, and the gap out to the dashed one is the roll. */
#hg-walk {
  position: absolute; left: 50%; top: 50%;
  width: ${STICK_R * 2}px; height: ${STICK_R * 2}px;
  margin: -${STICK_R}px 0 0 -${STICK_R}px;
  border-radius: 50%;
  border: 2px solid rgba(255, 253, 248, 0.5);
  background: rgba(90, 78, 120, 0.13);
  transition: border-color 120ms ease, background-color 120ms ease;
}
#hg-stick.roll { border-color: rgba(233, 168, 90, 0.9); border-style: solid; }
#hg-stick.roll #hg-walk { border-color: rgba(233, 168, 90, 0.95); background: rgba(233, 168, 90, 0.2); }
#hg-nub {
  position: absolute; left: 50%; top: 50%;
  width: 46px; height: 46px; margin: -23px 0 0 -23px;
  border-radius: 50%;
  background: rgba(255, 253, 248, 0.82);
  box-shadow: 0 2px 8px rgba(90, 78, 120, 0.28);
}
.hg-btn {
  position: absolute;
  pointer-events: auto;
  display: grid; place-content: center;
  border-radius: 50%;
  background: rgba(255, 253, 248, 0.72);
  box-shadow: 0 1px 0 rgba(255,255,255,0.8) inset, 0 2px 10px rgba(90, 78, 120, 0.18);
  backdrop-filter: blur(3px);
  font: inherit; font-size: 0.74rem; font-weight: 600;
  color: #4a4258; letter-spacing: 0.02em;
  border: 0; padding: 0;
  touch-action: none;
  -webkit-tap-highlight-color: transparent;
  transition: transform 90ms ease, opacity 200ms ease;
}
.hg-btn:active { transform: scale(0.92); }
#hg-hop { width: 74px; height: 74px; right: calc(1rem + env(safe-area-inset-right)); bottom: calc(6.6rem + env(safe-area-inset-bottom)); }
#hg-act {
  width: 88px; height: 88px;
  right: calc(5.6rem + env(safe-area-inset-right)); bottom: calc(11.4rem + env(safe-area-inset-bottom));
  background: rgba(233, 168, 90, 0.92); color: #3b2f1c;
  opacity: 0; pointer-events: none;
}
#hg-act.on { opacity: 1; pointer-events: auto; }

/* ------------------------------ the menu -------------------------------
   Seeing the whole planet, the sound, photo mode and the journal were on
   four keys, and a phone has no keys.  They live up in the corner under the
   compass rather than down by the thumbs, because they are things you do
   between walks — putting them where a thumb rests would mean pressing them
   by accident, and the cost of a misfire here is the camera leaving the
   grass entirely.

   **The button and its tray are one positioned box**, and the tray flows
   under the button rather than being placed at its own offset.  Placing both
   by hand meant three sizes of compass — 84 px, 60 px on a narrow screen,
   46 px on a short one — each needing the two of them moved in step, and the
   first version of that had the menu sitting on top of the compass on any
   screen wide enough to miss the phone media query. */
#hg-more {
  position: absolute;
  right: calc(0.5rem + env(safe-area-inset-right));
  top: calc(7.6rem + env(safe-area-inset-top));
  display: flex; flex-direction: column; align-items: flex-end; gap: 0.4rem;
  pointer-events: none;
}
#hg-menu {
  position: static;
  width: 46px; height: 46px; font-size: 1.1rem; line-height: 0;
}
/* **visibility, and not just opacity and pointer-events.**  A parent set to
   pointer-events none does not stop a child that sets auto — that is the whole
   mechanism the hud uses to be transparent to the mouse while its buttons are
   not — so a faded-out tray whose pills each declare auto is five invisible
   buttons in the top-right corner, and a look-drag that starts there launches
   you into orbit.  visibility hidden does suppress descendants, and delaying
   it by the length of the fade keeps the animation.  This cannot be caught by
   dispatching events at the elements directly, which is how the rest of this
   file is tested; it needs a hit test.
   (And no back-quotes in here: this is inside a template literal and one stray
   one ends the stylesheet mid-rule.  The comment forty lines up says exactly
   that, having been bitten twice, and writing this one cost a third.) */
#hg-tray {
  display: flex; flex-direction: column; align-items: flex-end; gap: 0.4rem;
  pointer-events: none;
  visibility: hidden;
  opacity: 0; transform: translateY(-0.35rem);
  transition: opacity 180ms ease, transform 180ms ease, visibility 0s linear 180ms;
}
#hg-tray.on {
  opacity: 1; transform: translateY(0); pointer-events: auto;
  visibility: visible;
  transition: opacity 180ms ease, transform 180ms ease, visibility 0s;
}
.hg-item {
  pointer-events: auto;
  border: 0; margin: 0;
  padding: 0.52rem 0.86rem;
  border-radius: 1.1rem;
  background: rgba(255, 253, 248, 0.86);
  box-shadow: 0 1px 0 rgba(255,255,255,0.8) inset, 0 2px 10px rgba(90, 78, 120, 0.18);
  backdrop-filter: blur(3px);
  font: inherit; font-size: 0.8rem; font-weight: 600;
  color: #4a4258;
  white-space: nowrap;
  touch-action: none;
  -webkit-tap-highlight-color: transparent;
  transition: transform 90ms ease;
}
.hg-item:active { transform: scale(0.94); }

/* The compass shrinks twice on the way down to a phone — 84 px, then 60, then
   46 — and the menu has to sit under whichever of the three it is. */
@media (max-width: 820px) { #hg-more { top: calc(5.4rem + env(safe-area-inset-top)); } }

/* ---------------------------- how to play ------------------------------
   Shown once, on the first touch, and after that only when asked for.  A
   legend you cannot dismiss is a legend printed over the game. */
#hg-help {
  position: absolute;
  left: 50%; top: 50%;
  transform: translate(-50%, -50%) scale(0.97);
  width: max-content; max-width: min(21rem, 84vw);
  padding: 1rem 1.15rem;
  border-radius: 1rem;
  background: rgba(255, 253, 248, 0.92);
  box-shadow: 0 1px 0 rgba(255,255,255,0.8) inset, 0 6px 26px rgba(90, 78, 120, 0.26);
  backdrop-filter: blur(4px);
  color: #4a4258;
  font-size: 0.86rem; line-height: 1.5;
  pointer-events: none;
  opacity: 0;
  transition: opacity 240ms ease, transform 240ms ease;
  z-index: 2;
}
#hg-help.on { opacity: 1; transform: translate(-50%, -50%) scale(1); pointer-events: auto; }
#hg-help b { display: block; font-size: 0.95rem; margin-bottom: 0.5rem; }
#hg-help dl { display: grid; grid-template-columns: auto 1fr; gap: 0.32rem 0.7rem; margin: 0; }
#hg-help dt { font-weight: 600; white-space: nowrap; }
#hg-help dd { margin: 0; opacity: 0.78; }
#hg-help small { display: block; margin-top: 0.8rem; opacity: 0.5; text-align: center; }

/* Photo mode takes the panels and the thumb controls away, which on a
   keyboard is fine because C brings them back.  A thumb has no C, so one
   pill stays — faint enough to keep out of the picture, and the only thing
   on the glass that can end it. */
#hg-done {
  position: absolute;
  left: 50%; bottom: calc(2rem + env(safe-area-inset-bottom));
  transform: translateX(-50%);
  opacity: 0; pointer-events: none;
  transition: opacity 320ms ease;
}
body.photo #hg-done.live { opacity: 0.34; pointer-events: auto; }
body.photo #hg-done.live:active { opacity: 1; }

/* ------------------------------ sideways -------------------------------
   A phone on its side has about 390 px of height, and this whole layout was
   built by counting rem up from the bottom of a tall screen: "climb aboard"
   sat at 11.4rem, which is 182 px, which is nearly half way up a landscape
   phone and directly over the meadow you are trying to walk through.  So the
   two buttons go side by side, the menu tucks up under a smaller compass,
   and the card is allowed to scroll rather than run off both ends. */
@media (max-height: 520px) {
  #hg-hop { width: 62px; height: 62px; bottom: calc(0.9rem + env(safe-area-inset-bottom)); }
  #hg-act {
    width: 74px; height: 74px; font-size: 0.68rem;
    right: calc(5.4rem + env(safe-area-inset-right));
    bottom: calc(0.9rem + env(safe-area-inset-bottom));
  }
  #hg-more { top: calc(4.2rem + env(safe-area-inset-top)); gap: 0.3rem; }
  #hg-menu { width: 40px; height: 40px; }
  #hg-tray { gap: 0.3rem; }
  .hg-item { padding: 0.4rem 0.7rem; font-size: 0.74rem; }
  #hg-help { max-height: 84vh; overflow: auto; font-size: 0.8rem; padding: 0.8rem 0.95rem; }
  #hg-done { bottom: calc(0.9rem + env(safe-area-inset-bottom)); }
}

body.touch #keys { display: none; }
`;

/**
 * @param {object} o
 * @param {HTMLCanvasElement} o.canvas
 * @param {object} o.chase      the camera, which must lend us its pointers
 * @param {() => void} o.onHop
 * @param {() => void} o.onAct  the contextual button — climbing aboard
 * @param {Array<{label: string, run: () => void}>} [o.menu]
 *        the verbs that were only ever on keys.  Declared by `main.js`,
 *        which is where those verbs live; this only draws them.
 */
export function createTouch({ canvas, chase, onHop, onAct, menu = [] }) {
  const doc = typeof document !== 'undefined' ? document : null;
  const hud = doc?.getElementById?.('hud') || null;
  /* No DOM, no controls, and everything below still answers `drive()` with a
   * dead stick — the harness has a `getElementById` that returns null and the
   * frame loop must not care. */
  const live = !!(hud && doc.createElement && hud.appendChild);

  const stick = { on: false, id: -1, ox: 0, oy: 0, x: 0, y: 0, roll: false, moved: 0, t: 0 };
  const was = { x: 0, y: 0 };
  let touched = false;
  let el = null;
  let helpT = null;

  /* ------------------------------ how to play ------------------------------ */

  const HELP = [
    ['left half', 'drag to walk him · push past the ring and he rolls'],
    ['right half', 'drag to look · pinch to close in'],
    ['tap', 'call him there, and sow whatever the place gives you'],
    ['hop', 'the button, bottom right'],
  ];

  function showHelp(secs = 0) {
    if (!el) return;
    clearTimeout(helpT);
    el.help.classList.add('on');
    if (secs) helpT = setTimeout(() => el.help.classList.remove('on'), secs * 1000);
  }
  function hideHelp() {
    if (!el) return;
    clearTimeout(helpT);
    el.help.classList.remove('on');
  }

  /* -------------------------------- building -------------------------------- */

  /* `pointerdown` and not `click`: a click on a touch screen arrives up to
   * 300 ms after the finger lands, and a hop you asked for a third of a
   * second ago has already been missed. */
  const fire = (node, fn) => node.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    fn?.();
  });

  const btn = (id, text) => {
    const b = doc.createElement('button');
    b.id = id;
    b.className = 'hg-btn';
    b.textContent = text;
    return b;
  };

  function build() {
    if (!live || el) return;
    const style = doc.createElement('style');
    style.textContent = TOUCH_CSS;
    (doc.head || doc.body).appendChild(style);

    const ring = doc.createElement('div');
    ring.id = 'hg-stick';
    ring.className = 'hg-touch';
    const walk = doc.createElement('div');
    walk.id = 'hg-walk';
    const nub = doc.createElement('div');
    nub.id = 'hg-nub';
    ring.appendChild(walk);
    ring.appendChild(nub);

    const hop = btn('hg-hop', 'hop');
    const act = btn('hg-act', 'climb\naboard');
    act.style.whiteSpace = 'pre';
    act.style.textAlign = 'center';
    act.style.lineHeight = '1.25';
    fire(hop, () => onHop?.());
    fire(act, () => onAct?.());

    /* The menu, and the tray it opens.  Anything on the tray closes it after
     * itself: these are all toggles of one thing at a time, and a tray left
     * open over the meadow is four pills you then have to dismiss. */
    const corner = doc.createElement('div');
    corner.id = 'hg-more';
    const more = btn('hg-menu', '⋯');
    more.setAttribute('aria-label', 'more');
    const tray = doc.createElement('div');
    tray.id = 'hg-tray';
    const closeTray = () => tray.classList.remove('on');
    fire(more, () => { hideHelp(); tray.classList.toggle('on'); });
    for (const item of [...menu, { label: 'how to play', run: () => showHelp() }]) {
      const pill = doc.createElement('button');
      pill.className = 'hg-item';
      pill.textContent = item.label;
      fire(pill, () => { closeTray(); item.run?.(); });
      tray.appendChild(pill);
    }
    corner.appendChild(more);
    corner.appendChild(tray);

    const help = doc.createElement('div');
    help.id = 'hg-help';
    help.innerHTML = `<b>he walks with your thumbs</b><dl>${HELP
      .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')
      }</dl><small>tap this to put it away</small>`;
    fire(help, hideHelp);

    /* The one thing photo mode leaves on the glass — see the stylesheet. */
    const done = doc.createElement('button');
    done.id = 'hg-done';
    done.className = 'hg-item live';
    done.textContent = 'back to the panels';
    fire(done, () => doc.body.classList.remove('photo'));

    hud.appendChild(ring);
    hud.appendChild(hop);
    hud.appendChild(act);
    hud.appendChild(corner);
    hud.appendChild(help);
    hud.appendChild(done);
    doc.body.classList.add('touch');
    el = { ring, walk, nub, hop, act, corner, more, tray, help, done };

    /* The card, once, on the very first touch — and long enough to read
     * rather than long enough to notice.  It is not modal: the finger that
     * summoned it is already on the glass and still drives him. */
    showHelp(7);
  }

  /** The left half is his, on touch-down, and after that the finger is his. */
  const mine = (e) => e.pointerType === 'touch' && e.clientX < window.innerWidth * 0.5;

  chase?.setPointerFilter?.((e) => {
    if (e.pointerType === 'touch') touched = true;
    if (!mine(e)) return true;                  // the camera may have it
    build();
    return false;
  });

  canvas.addEventListener('pointerdown', (e) => {
    if (!mine(e)) return;
    build();
    stick.on = true;
    stick.roll = false;
    stick.id = e.pointerId;
    stick.ox = e.clientX; stick.oy = e.clientY;
    stick.x = 0; stick.y = 0;
    stick.moved = 0; stick.t = performance.now();
    was.x = 0; was.y = 0;
    if (el) {
      el.ring.style.left = `${e.clientX}px`;
      el.ring.style.top = `${e.clientY}px`;
      el.ring.classList.add('on');
      el.ring.classList.remove('roll');
      el.nub.style.transform = 'translate(0px, 0px)';
    }
  }, { passive: true });

  canvas.addEventListener('pointermove', (e) => {
    if (!stick.on || e.pointerId !== stick.id) return;
    stick.x = e.clientX - stick.ox;
    stick.y = e.clientY - stick.oy;
    let d = Math.hypot(stick.x, stick.y);
    // the whole stick follows once the thumb is past the outside of it
    if (d > STICK_MAX) {
      const k = (d - STICK_MAX) / d;
      stick.ox += stick.x * k;
      stick.oy += stick.y * k;
      stick.x *= STICK_MAX / d;
      stick.y *= STICK_MAX / d;
      d = STICK_MAX;
      if (el) {
        el.ring.style.left = `${stick.ox}px`;
        el.ring.style.top = `${stick.oy}px`;
      }
    }
    /* **Out past the ring is a roll, back inside it is a walk.**  Two
     * thresholds and not one: a thumb held at a single boundary is never
     * still enough to stay on one side of it. */
    stick.roll = stick.roll ? d > STICK_R : d > STICK_RUN;
    stick.moved += Math.abs(stick.x - was.x) + Math.abs(stick.y - was.y);
    was.x = stick.x; was.y = stick.y;
    if (el) {
      /* The nub runs all the way out to the dashed ring, because that
       * journey is now the gesture: stopping it short at the walk ring
       * would hide the only thing that says he is about to tuck.  It stops
       * *against* that ring rather than on it — a 46 px nub centred on an
       * 84 px circle hangs half its width outside, and a nub outside its own
       * stick reads as having come off it. */
      const k = Math.min(1, (STICK_RUN - 22) / (d || 1));
      el.nub.style.transform = `translate(${stick.x * k}px, ${stick.y * k}px)`;
      el.ring.classList.toggle('roll', stick.roll);
    }
  }, { passive: true });

  const lift = (e) => {
    if (!stick.on || e.pointerId !== stick.id) return;
    /* **A tap on this side still sows.**  The stick took the whole left half
     * of the screen, and with it the tap that puts a flower down — so half
     * the world became unsowable on a phone and nothing said why.  A finger
     * that went down and came up without going anywhere was never a walk. */
    if (stick.moved < 9 && performance.now() - stick.t < 700) {
      chase?.callAt?.(e.clientX, e.clientY);
    }
    stick.on = false;
    stick.roll = false;
    stick.x = 0; stick.y = 0;
    if (el) { el.ring.classList.remove('on', 'roll'); }
  };
  canvas.addEventListener('pointerup', lift, { passive: true });
  canvas.addEventListener('pointercancel', lift, { passive: true });

  return {
    /** True once anybody has actually put a finger on the glass. */
    get touching() { return touched; },

    /**
     * What the stick is asking for: a **screen-space** direction and a
     * throttle, which `driveHog` turns into a heading against wherever the
     * camera is looking — the same path the keys take, so the two cannot
     * disagree about what "forward" means.
     *
     * Screen +y is down, and down-screen is away from the camera, so the
     * forward component is `-y`.  Getting that backwards is a stick that
     * walks him at you when you push away, and it is invisible in code.
     */
    drive() {
      if (!stick.on) return null;
      const d = Math.hypot(stick.x, stick.y);
      if (d < STICK_DEAD) return null;
      const k = clamp((d - STICK_DEAD) / (STICK_R - STICK_DEAD), 0, 1);
      return { f: -stick.y / d, r: stick.x / d, throttle: k, roll: stick.roll };
    },

    /** Show or hide the contextual button — see `main.js`. */
    setAction(label) {
      if (!el) return;
      if (label) { el.act.textContent = label; el.act.classList.add('on'); }
      else el.act.classList.remove('on');
    },

    /** The how-to-play card, on demand. */
    help: showHelp,
  };
}
