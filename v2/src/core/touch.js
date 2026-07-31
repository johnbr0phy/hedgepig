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
 *          **double-tap-and-hold rolls him**, which is the same gesture the
 *          keys use — two taps of a direction, the second one held.
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
 * ------------------------------------------------------------------ */

/** How far from the stick's origin counts as full throttle, in pixels. */
const STICK_R = 62;
/** Under this it is a dead zone, or resting a thumb creeps him forward. */
const STICK_DEAD = 9;
/** Two taps closer together than this, and the second is a roll. */
const DOUBLE_MS = 340;

const CSS = `
.hg-touch { position: absolute; pointer-events: none; }
#hg-stick {
  width: ${STICK_R * 2}px; height: ${STICK_R * 2}px;
  margin: -${STICK_R}px 0 0 -${STICK_R}px;
  border-radius: 50%;
  border: 2px solid rgba(255, 253, 248, 0.5);
  background: rgba(90, 78, 120, 0.13);
  opacity: 0; transition: opacity 160ms ease;
}
#hg-stick.on { opacity: 1; }
#hg-stick.roll { border-color: rgba(233, 168, 90, 0.95); background: rgba(233, 168, 90, 0.2); }
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

/* On a touch screen the keyboard legend is a lie, and the panels are sized
   for a desktop window.  Both get fixed here rather than in index.html,
   because both are consequences of there being a thumb on the glass.
   (No back-quotes in this comment: it is inside a template literal, and one
   stray one ends the stylesheet mid-rule.  Second time — the shader in
   sky.js went the same way.) */
/* The keyboard legend is a lie once there is a thumb on the glass.  The
   rest of the small-screen layout lives in index.html, where it belongs:
   panel sizes are a consequence of how wide the SCREEN is, and this
   stylesheet is only injected on the first touch — so a narrow desktop
   window would never have seen it. */
body.touch #keys { display: none; }
`;

/**
 * @param {object} o
 * @param {HTMLCanvasElement} o.canvas
 * @param {object} o.chase      the camera, which must lend us its pointers
 * @param {() => void} o.onHop
 * @param {() => void} o.onAct  the contextual button — climbing aboard
 */
export function createTouch({ canvas, chase, onHop, onAct }) {
  const doc = typeof document !== 'undefined' ? document : null;
  const hud = doc?.getElementById?.('hud') || null;
  /* No DOM, no controls, and everything below still answers `drive()` with a
   * dead stick — the harness has a `getElementById` that returns null and the
   * frame loop must not care. */
  const live = !!(hud && doc.createElement && hud.appendChild);

  const stick = { on: false, id: -1, ox: 0, oy: 0, x: 0, y: 0, roll: false, moved: 0, t: 0 };
  const was = { x: 0, y: 0 };
  let lastTapAt = -1e9;
  let touched = false;
  let el = null;

  function build() {
    if (!live || el) return;
    const style = doc.createElement('style');
    style.textContent = CSS;
    (doc.head || doc.body).appendChild(style);

    const ring = doc.createElement('div');
    ring.id = 'hg-stick';
    ring.className = 'hg-touch';
    const nub = doc.createElement('div');
    nub.id = 'hg-nub';
    ring.appendChild(nub);

    const hop = doc.createElement('button');
    hop.id = 'hg-hop';
    hop.className = 'hg-btn';
    hop.textContent = 'hop';
    const act = doc.createElement('button');
    act.id = 'hg-act';
    act.className = 'hg-btn';
    act.textContent = 'climb\naboard';
    act.style.whiteSpace = 'pre';
    act.style.textAlign = 'center';
    act.style.lineHeight = '1.25';

    /* `pointerdown` and not `click`: a click on a touch screen arrives up to
     * 300 ms after the finger lands, and a hop you asked for a third of a
     * second ago has already been missed. */
    const fire = (node, fn) => node.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      fn?.();
    });
    fire(hop, () => onHop?.());
    fire(act, () => onAct?.());

    hud.appendChild(ring);
    hud.appendChild(hop);
    hud.appendChild(act);
    doc.body.classList.add('touch');
    el = { ring, nub, hop, act };
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
    const now = performance.now();
    /* Double-tap-and-hold rolls him, which is the keys' gesture exactly: the
     * first tap has already set him walking, so the second is an *upgrade*
     * rather than a fresh start, and that is why it feels immediate. */
    stick.roll = now - lastTapAt < DOUBLE_MS;
    lastTapAt = now;
    stick.on = true;
    stick.id = e.pointerId;
    stick.ox = e.clientX; stick.oy = e.clientY;
    stick.x = 0; stick.y = 0;
    stick.moved = 0; stick.t = now;
    was.x = 0; was.y = 0;
    if (el) {
      el.ring.style.left = `${e.clientX}px`;
      el.ring.style.top = `${e.clientY}px`;
      el.ring.classList.add('on');
      el.ring.classList.toggle('roll', stick.roll);
      el.nub.style.transform = 'translate(0px, 0px)';
    }
  }, { passive: true });

  canvas.addEventListener('pointermove', (e) => {
    if (!stick.on || e.pointerId !== stick.id) return;
    stick.x = e.clientX - stick.ox;
    stick.y = e.clientY - stick.oy;
    const d = Math.hypot(stick.x, stick.y);
    /* The ring **follows the thumb** once it is dragged past its own edge.
     * Without that, walking any distance means your thumb wanders off the
     * stick and the throttle silently pins at full in a direction you can no
     * longer steer. */
    if (d > STICK_R) {
      const k = (d - STICK_R) / d;
      stick.ox += stick.x * k;
      stick.oy += stick.y * k;
      stick.x *= STICK_R / d;
      stick.y *= STICK_R / d;
      if (el) {
        el.ring.style.left = `${stick.ox}px`;
        el.ring.style.top = `${stick.oy}px`;
      }
    }
    stick.moved += Math.abs(stick.x - was.x) + Math.abs(stick.y - was.y);
    was.x = stick.x; was.y = stick.y;
    /* The nub is clamped inside the ring rather than to it: at the full
     * radius, half of a 46 px nub hangs outside a 62 px ring and it reads as
     * having come off its own stick. */
    if (el) {
      const k = Math.min(1, STICK_R * 0.62 / (Math.hypot(stick.x, stick.y) || 1));
      el.nub.style.transform = `translate(${stick.x * k}px, ${stick.y * k}px)`;
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
  };
}
