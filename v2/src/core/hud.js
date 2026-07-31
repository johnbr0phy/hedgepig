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

  let toastT = 0;

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

    flash(msg, secs = 2.6) {
      if (!el.toast) return;
      el.toast.innerHTML = `<span class="panel">${msg}</span>`;
      el.toast.classList.add('on');
      toastT = secs;
    },

    /** Redraw the compass.  See `drawCompass` for what it does and does not show. */
    setCompass(data) { drawCompass(data); },

    update(dt) {
      if (toastT > 0) {
        toastT -= dt;
        if (toastT <= 0) el.toast?.classList.remove('on');
      }
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
