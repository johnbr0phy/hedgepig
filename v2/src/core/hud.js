/* ------------------------------------------------------------------ *
 * The HUD.
 *
 * Plain DOM over the canvas.  Four readouts and a toast, and every one of
 * them is written only when its text actually changes — a `textContent`
 * assignment on every frame is a layout every frame, and at 26 cm tall the
 * hedgepig cannot afford the dropped ones.
 * ------------------------------------------------------------------ */

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const el = {
    hearts: $('hearts'),
    place: $('place'),
    clock: $('clock'),
    toast: $('toast'),
    start: $('start'),
    compass: $('compass'),
  };
  const last = {};

  /* ------------------------------- the compass ------------------------------ *
   *
   * An eleven-metre horizon on a three-hundred-metre planet is genuinely
   * disorienting, and that is a usability problem rather than a mood.  But
   * `AGENT.md` is firm that the answer is not a HUD full of numbers, and a
   * radar screen with blips on it would be the loudest thing on the display
   * by some margin.
   *
   * So: a ring, and **no numbers at all**.  Ten faint ticks for the ten
   * places, so the shape of the world is legible at a glance; a warm wedge
   * for the burrow, which is the thing you actually have to find; and a small
   * travelling dot on that bearing which comes in from the rim as you close
   * on it.  Distance is a *position*, not a figure — which is both quieter
   * and quicker to read than "84 m" would be.
   *
   * **Camera-relative, not north-up.**  The top of the ring is into the
   * screen, because the keys are camera-relative too and a compass that
   * disagrees with the controls is worse than none.
   */
  const cvs = el.compass?.querySelector('canvas');
  const cx2 = cvs?.getContext('2d');
  const S = 168, MID = S / 2, RING = 66;

  function drawCompass({ places = [], home = null, here = -1, folk = [] } = {}) {
    if (!cx2) return;
    cx2.clearRect(0, 0, S, S);

    // the ring
    cx2.strokeStyle = 'rgba(90, 78, 120, 0.30)';
    cx2.lineWidth = 3;
    cx2.beginPath();
    cx2.arc(MID, MID, RING, 0, Math.PI * 2);
    cx2.stroke();

    // ahead: a notch at the top, so the ring has an orientation you can find
    cx2.strokeStyle = 'rgba(90, 78, 120, 0.55)';
    cx2.lineWidth = 4;
    cx2.beginPath();
    cx2.moveTo(MID, MID - RING - 5);
    cx2.lineTo(MID, MID - RING + 7);
    cx2.stroke();

    /* The ten places.  Faint, short, and the one he is standing in is filled
     * — which turns the ring from a direction finder into a little map of
     * where everything is in relation to everything else. */
    for (const p of places) {
      const a = p.angle - Math.PI / 2;
      const cos = Math.cos(a), sin = Math.sin(a);
      const inner = p.kind === here ? RING - 13 : RING - 7;
      cx2.strokeStyle = p.kind === here
        ? 'rgba(90, 78, 120, 0.72)'
        : 'rgba(90, 78, 120, 0.26)';
      cx2.lineWidth = p.kind === here ? 5 : 3;
      cx2.beginPath();
      cx2.moveTo(MID + cos * inner, MID + sin * inner);
      cx2.lineTo(MID + cos * (RING - 1), MID + sin * (RING - 1));
      cx2.stroke();
    }

    /* The burrow.  A wedge on the rim for the bearing, and a dot that walks
     * in from the rim to the middle as he closes on it — arriving is the dot
     * reaching the centre, which needs no caption. */
    if (home) {
      const a = home.angle - Math.PI / 2;
      const cos = Math.cos(a), sin = Math.sin(a);
      cx2.fillStyle = '#c9803a';
      cx2.beginPath();
      cx2.moveTo(MID + cos * (RING + 9), MID + sin * (RING + 9));
      cx2.lineTo(MID + Math.cos(a - 0.20) * (RING - 4), MID + Math.sin(a - 0.20) * (RING - 4));
      cx2.lineTo(MID + Math.cos(a + 0.20) * (RING - 4), MID + Math.sin(a + 0.20) * (RING - 4));
      cx2.closePath();
      cx2.fill();

      const r = RING * Math.min(1, home.near);
      cx2.fillStyle = 'rgba(201, 128, 58, 0.85)';
      cx2.beginPath();
      cx2.arc(MID + cos * r, MID + sin * r, 6, 0, Math.PI * 2);
      cx2.fill();
    }

    /* The residents.  Red, because they are the one thing on this ring that
     * is a *creature* — the ticks are geography and the wedge is home, and
     * neither of those has ever been red.
     *
     * Drawn on the same grammar as the burrow's dot: a bearing, and a
     * distance that is a position rather than a figure.  Once met the dot
     * goes hollow with a tick through it, which is the whole idea — the
     * ring is a list of who is out there, and meeting somebody crosses them
     * off it rather than deleting them.  A met resident that vanished would
     * take the "go back and see her again" with it, and going back is the
     * entire point of a resident.
     *
     * They are all in one wood, so from the far side of the planet the four
     * of them stack into one blip on one bearing and separate as you close.
     * That is correct: four animals sixteen metres apart ARE one blip from a
     * hundred and fifty metres away.
     *
     * **Their `near` is not the burrow's.**  The burrow is measured against
     * half a lap, because it can genuinely be half a lap away.  Measured the
     * same way, the residents — who are only ever interesting within a wood's
     * width — all landed inside eight pixels of the middle and piled up into
     * one unreadable smudge on top of him.  `FOLK_FAR` in `main.js` is the
     * scale they use instead, and the rim here is pulled in so a dot at full
     * stretch does not sit on the place ticks.
     */
    for (const p of folk) {
      const a = p.angle - Math.PI / 2;
      const r = (RING - 10) * Math.min(1, p.near);
      const x = MID + Math.cos(a) * r, y = MID + Math.sin(a) * r;
      if (p.met) {
        cx2.strokeStyle = 'rgba(184, 58, 44, 0.55)';
        cx2.lineWidth = 1.6;
        cx2.beginPath();
        cx2.arc(x, y, 5, 0, Math.PI * 2);
        cx2.stroke();
        // the tick: down-right, up-right, and short enough to stay inside
        cx2.lineWidth = 2;
        cx2.beginPath();
        cx2.moveTo(x - 2.6, y + 0.2);
        cx2.lineTo(x - 0.6, y + 2.4);
        cx2.lineTo(x + 3.0, y - 2.6);
        cx2.stroke();
      } else {
        cx2.fillStyle = 'rgba(184, 58, 44, 0.92)';
        cx2.beginPath();
        cx2.arc(x, y, 4, 0, Math.PI * 2);
        cx2.fill();
      }
    }

    // him, in the middle, facing up because the ring turns instead of he does
    cx2.fillStyle = 'rgba(70, 60, 52, 0.85)';
    cx2.beginPath();
    cx2.arc(MID, MID, 4.5, 0, Math.PI * 2);
    cx2.fill();
  }

  const set = (node, key, text) => {
    if (!node || last[key] === text) return;
    last[key] = text;
    node.innerHTML = text;
  };

  /* ------------------------------- the toast ------------------------------- *
   *
   * **Messages queue now.  They did not, and that was the whole fault.**
   *
   * `flash` used to write straight into the element and reset one timer, so
   * two things happening on the same frame meant you read the second one and
   * the first never existed.  That is not a rare case here — there are
   * twenty-seven callers, and arriving at the burrow alone can fire the leg
   * message, a journal first, a hoglet catching up and a resident greeting
   * within a few frames of each other.  What you saw was a flicker and then
   * one line, which is why they read as broken.
   *
   * Three rules, and each one is a thing that was wrong:
   *
   *  - **Every message gets its own turn**, in the order it happened.
   *  - **A minimum on screen**, so a queued line cannot be flashed away
   *    before it can be read.  Long lines get longer: this world's messages
   *    run from two words to a full sentence and a fixed 2.6 s served
   *    neither.
   *  - **A gap between them**, spent faded out.  Swapping the text under a
   *    panel that is already up reads as a glitch rather than as a second
   *    thing being said — the eye needs the beat to know it is new.
   *
   * And the queue is capped.  A burst of nine would otherwise hold the last
   * of them thirty seconds after the moment that earned it; past the cap the
   * OLDEST go, because the newest is the one you are still looking at the
   * cause of.
   */
  const TOAST_GAP = 0.22;       // faded out between messages
  const TOAST_MIN = 1.9;        // nothing is on screen for less than this
  const TOAST_MAX_Q = 4;

  let toastT = 0;               // time left on what is showing
  let toastGap = 0;             // time left of the beat before the next one
  const toastQ = [];
  let toastNow = null;

  /* The DOM is optional here, exactly as it is in `dialogue.js` and for the
   * same reason: the part of a queue worth asserting is the order things
   * come out in, and the harness has a `getElementById` that returns null.
   * Everything below runs and counts correctly with no element at all. */
  const showToast = (m) => {
    toastNow = m;
    toastT = m.secs;
    if (!el.toast) return;
    el.toast.innerHTML = '<span class="panel"></span>';
    /* `textContent`, not interpolation: two of these messages carry a hoglet
     * name out of localStorage, and a name is not markup. */
    el.toast.firstChild.textContent = m.msg;
    el.toast.classList.add('on');
  };

  const pumpToast = (dt) => {
    if (toastGap > 0) {
      toastGap -= dt;
      if (toastGap <= 0 && toastQ.length) showToast(toastQ.shift());
      return;
    }
    if (toastNow) {
      toastT -= dt;
      if (toastT > 0) return;
      toastNow = null;
      el.toast?.classList.remove('on');
      // the beat only costs anything when somebody is waiting for it
      toastGap = toastQ.length ? TOAST_GAP : 0;
      return;
    }
    if (toastQ.length) showToast(toastQ.shift());
  };

  return {
    onStart: null,

    begin() {
      el.start?.classList.add('gone');
      setTimeout(() => el.start?.remove(), 700);
    },

    setHearts(n, max = 3) {
      const before = last.hearts;
      set(el.hearts, 'hearts', '♥ '.repeat(n) + '♡ '.repeat(Math.max(0, max - n)));
      /* A heart that changes beats once.  Class off, reflow, class on is the
       * one dance that restarts a CSS animation reliably. */
      if (before !== undefined && before !== last.hearts && el.hearts) {
        el.hearts.classList.remove('beat');
        void el.hearts.offsetWidth;
        el.hearts.classList.add('beat');
      }
    },

    setPlace(name, weather) {
      set(el.place, 'place', `<b>${name}</b><small>${weather}</small>`);
    },

    setStatus(leg, metres, extra = '') {
      set(el.clock, 'clock', `leg ${leg}<br /><small>${Math.round(metres)} m walked${extra}</small>`);
    },

    /**
     * A standing instruction — "press E" — rather than a passing remark.
     *
     * Deliberately **not** a `flash`: a toast is a thing that happened and
     * goes away, and this is a thing that is true for as long as he stands
     * there.  Putting it through the queue would either make it vanish while
     * the offer was still open, or hold the queue up for as long as he
     * loitered.  They are two different kinds of message and the fault the
     * queue was fixing was exactly that they had been one.
     */
    setPrompt(html) {
      let node = document.getElementById('prompt');
      if (!node) {
        if (!html) return;
        node = document.createElement('div');
        node.id = 'prompt';
        node.className = 'panel';
        node.style.cssText =
          'position:absolute;left:50%;bottom:12.5rem;transform:translateX(-50%);' +
          'padding:0.4rem 0.7rem;font-size:0.92rem;white-space:nowrap;' +
          'opacity:0;transition:opacity 240ms ease;pointer-events:none;';
        el.toast?.parentNode?.appendChild(node);
      }
      if (last.prompt === html) return;
      last.prompt = html;
      if (html) node.innerHTML = html;
      node.style.opacity = html ? '1' : '0';
    },

    /**
     * Say something, in its turn.  `secs` is a floor rather than a setting:
     * a long line is given time to be read whatever the caller asked for,
     * because every caller here passed the default and none of them was
     * thinking about how long their own sentence was.
     */
    flash(msg, secs = 2.6) {
      const text = String(msg ?? '').trim();
      if (!text) return;
      /* The same thing twice running is one thing.  `note()` and the caller
       * that earned it often both want to say so, and two identical lines
       * in a row reads as a stutter. */
      if (toastNow?.msg === text || toastQ.some((q) => q.msg === text)) return;
      const need = Math.max(TOAST_MIN, secs, 0.9 + text.length * 0.035);
      toastQ.push({ msg: text, secs: need });
      // past the cap the oldest go: the newest is the one you just caused
      while (toastQ.length > TOAST_MAX_Q) toastQ.shift();
    },

    /** What is being said and what is still waiting — for the harness. */
    pending() {
      return { showing: toastNow?.msg ?? null, queued: toastQ.map((q) => q.msg) };
    },

    /** Everything waiting, dropped — for a cutscene taking the screen over. */
    clearFlash() {
      toastQ.length = 0;
      toastNow = null;
      toastT = 0;
      toastGap = 0;
      el.toast?.classList.remove('on');
    },

    /** Redraw the compass.  See `drawCompass` for what it does and does not show. */
    setCompass(data) { drawCompass(data); },

    update(dt) {
      pumpToast(dt);
    },

    /**
     * The journal: a small panel of firsts, toggled by J.  Built lazily —
     * most sessions never open it, and that is fine; it is a book, not a
     * scoreboard.
     */
    toggleJournal(lines) {
      let j = document.getElementById('journal');
      if (!j) {
        j = document.createElement('div');
        j.id = 'journal';
        j.className = 'panel';
        j.style.cssText =
          'top:50%;left:50%;transform:translate(-50%,-50%);min-width:15rem;' +
          'padding:0.9rem 1.2rem;line-height:1.85;display:none;';
        document.getElementById('hud')?.appendChild(j);
      }
      if (j.style.display === 'none') {
        j.innerHTML = `<b>the journal</b><br />${lines.length
          ? lines.map((l) => `· ${l}`).join('<br />')
          : '<small>nothing written yet — everything is still a first</small>'}`;
        j.style.display = 'block';
      } else {
        j.style.display = 'none';
      }
    },
  };
}
