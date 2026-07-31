/* ------------------------------------------------------------------ *
 * The conversation panel.
 *
 * A hedgehog listening to a badger, not a visual novel.  One panel low in
 * the middle, a name, a line that types itself on, and a mark that says the
 * line has finished.  No portrait, no border, no sound, no box within a box.
 *
 * It builds its own DOM and its own stylesheet, because `index.html` belongs
 * to the whole game and this is one feature — but the *treatment* is taken
 * whole from `.panel` there (warm paper at 0.72, a soft violet shadow, 0.9rem
 * corners, a 3 px backdrop blur), and the root carries the `panel` class
 * itself so that it goes on being a HUD panel without a second copy of those
 * numbers to keep in step.
 *
 * That class is also what makes photo mode work.  `body.photo .panel` is
 * (0,2,1) and every rule in here is at most (0,2,0), so photo mode wins on
 * specificity from a stylesheet it has never heard of.  The temptation is to
 * hang the state off `#dialogue` — an id is (1,0,0) and it would beat photo
 * mode, and the panel would sit in the middle of every screenshot with the
 * rest of the HUD faded politely away around it.  Hence: classes only, no id
 * used for styling.
 * ------------------------------------------------------------------ */

/** Seconds per character.  Faster than this and it is a flicker, not typing. */
const CHAR = 0.018;

/** How long a mark of punctuation holds the line before the next character. */
const PAUSE = { '.': 0.16, ',': 0.09, ';': 0.12, ':': 0.12, '—': 0.14, '?': 0.16 };

/** A completed line waits this long before the mark appears, so it does not pop. */
const SETTLE = 0.22;

/** The mark's breath, in seconds.  A hard blink is a terminal; this is not one. */
const BREATH = 1.5;

const CSS = `
.hg-say {
  left: 50%;
  bottom: 5.4rem;
  transform: translate(-50%, 0.4rem);
  max-width: min(30rem, 76vw);
  padding: 0.62rem 0.85rem 0.6rem;
  font-size: 0.92rem;
  line-height: 1.62;
  text-align: left;
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transition: opacity 300ms ease, transform 300ms ease, visibility 0s linear 300ms;
}
.hg-say.hg-on {
  opacity: 1;
  transform: translate(-50%, 0);
  transition: opacity 300ms ease, transform 300ms ease, visibility 0s;
}
.hg-who {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.09em;
  opacity: 0.5;
  margin-bottom: 0.12rem;
}
/* The remainder of the line is *present and invisible*, not absent — see the
   note on reflow below. */
.hg-rest { visibility: hidden; }
.hg-mark {
  display: inline-block;
  width: 0.34em;
  height: 0.34em;
  margin-left: 0.34em;
  border-radius: 50%;
  background: currentColor;
  opacity: 0;
}
`;

export function createDialogue() {
  /* ------------------------------ the DOM ------------------------------ *
   *
   * All of it is optional.  The smoke harness has a document with a
   * `createElement` that returns four properties and a `getElementById` that
   * returns null, so there is no `#hud` to hang this on — and the part of a
   * conversation worth asserting is the state machine, not the paint.  No
   * HUD, no DOM, and everything below still counts characters correctly.
   */
  const doc = typeof document !== 'undefined' ? document : null;
  const hud = doc?.getElementById?.('hud') || null;
  let root = null, whoEl = null, saidEl = null, restEl = null, markEl = null;

  if (hud && typeof doc.createElement === 'function' && typeof hud.appendChild === 'function') {
    const head = doc.head || doc.body;
    if (head && !doc.getElementById('hg-say-css')) {
      const style = doc.createElement('style');
      style.id = 'hg-say-css';
      style.textContent = CSS;
      head.appendChild(style);
    }

    root = doc.createElement('div');
    root.className = 'panel hg-say';

    whoEl = doc.createElement('div');
    whoEl.className = 'hg-who';

    const line = doc.createElement('div');
    saidEl = doc.createElement('span');
    restEl = doc.createElement('span');
    restEl.className = 'hg-rest';
    markEl = doc.createElement('i');
    markEl.className = 'hg-mark';
    line.appendChild(saidEl);
    line.appendChild(restEl);
    line.appendChild(markEl);

    root.appendChild(whoEl);
    root.appendChild(line);
    hud.appendChild(root);
  }

  /* ------------------------------- state ------------------------------- */
  let queue = [];         // the lines still to say, this one included
  let at = 0;             // which of them we are on
  let full = '';          // the whole of the current line
  let shown = 0;          // how much of it has arrived
  let live = false;       // open, as far as anyone asking is concerned
  let acc = 0;            // typing clock
  let settle = 0;         // seconds since the line finished
  let breath = 0;         // the mark's own clock
  let paintedShown = -1;  // what the DOM was last told, so we do not tell it twice
  let paintedMark = -1;

  /* The cost of revealing the character at `i`: one character, plus whatever
   * the character *before* it is holding the line for.  Putting the pause on
   * the predecessor is what makes a full stop land as a beat after the stop
   * rather than a stutter before the next word. */
  const costOf = (s, i) => CHAR + (i > 0 ? (PAUSE[s[i - 1]] || 0) : 0);

  const typing = () => shown < full.length;

  /* Writing only the typed half of the line and letting the box grow makes
   * the panel jitter for the whole of every sentence, and the last word of a
   * wrapped line jumps down a row as it arrives.  So the untyped remainder
   * stays in the flow at `visibility: hidden`: the panel is its final size
   * and every word breaks where it will finally break, from the first
   * character on.  Nothing moves while he is being spoken to. */
  function paint() {
    if (!root || shown === paintedShown) return;
    paintedShown = shown;
    saidEl.textContent = full.slice(0, shown);
    restEl.textContent = full.slice(shown);
  }

  /* Quantised to fiftieths.  `hud.js`'s rule is that nothing writes to the DOM
   * on a frame where the value has not changed, and a slow sine crossed with
   * a float is a value that changes on literally every frame for ever. */
  function paintMark(o) {
    if (!markEl) return;
    const q = Math.round(o * 50) / 50;
    if (q === paintedMark) return;
    paintedMark = q;
    markEl.style.opacity = String(q);
  }

  function start(text) {
    full = String(text ?? '');
    shown = 0;
    /* Forced, not compared: a new line that happens to be as far along as the
     * old one left off would otherwise skip its repaint and leave the previous
     * line on screen — the sort of fault that only shows up on one pairing of
     * lines out of thirty. */
    paintedShown = -1;
    acc = 0;
    settle = 0;
    breath = 0;
    paint();
    paintMark(0);
  }

  /** Fade out.  He stops listening at once; the panel takes a moment. */
  function close() {
    if (!live) return;
    live = false;
    root?.classList.remove('hg-on');
    paintMark(0);
  }

  /* These are declared here rather than as methods on the returned object so
   * that `advance` can call `close` without going through `this`.  A caller
   * that pulls the methods off — `const { advance } = createDialogue()`, which
   * is exactly what a key handler wants to do — has no `this`, and the last
   * line of every conversation would throw. */
  function advance() {
    if (!live) return false;
    if (typing()) {
      shown = full.length;
      acc = 0;
      settle = 0;
      breath = 0;
      paint();
      return true;
    }
    at += 1;
    if (at >= queue.length) { close(); return true; }
    start(queue[at]);
    return true;
  }

  return {
    /**
     * Show `lines` as `who`.  A bare string is one line.  Calling this while
     * already open simply replaces what is being said — the panel does not
     * blink out and back in, because it is the same conversation.
     */
    open(who, lines) {
      const list = (Array.isArray(lines) ? lines : [lines])
        .map((l) => String(l ?? '').trim())
        .filter(Boolean);
      if (!list.length) return;

      queue = list;
      at = 0;
      live = true;
      if (whoEl) {
        whoEl.textContent = who || '';
        whoEl.style.display = who ? '' : 'none';
      }
      start(queue[0]);
      root?.classList.add('hg-on');
    },

    /**
     * The one interaction convention everybody already knows: finish the line
     * if it is still arriving, otherwise move on.  Past the last line this
     * closes.
     *
     * Returns whether it did anything, so a caller can swallow the key —
     * without that, the same press advances the line *and* does whatever it
     * normally does, and he wanders off mid-sentence.
     */
    advance,

    close,

    isOpen() { return live; },

    update(dt) {
      if (!live) return;

      /* Clamped: coming back to a tab that has been away for a minute should
       * finish the line, not spend a thousand iterations of the loop below
       * discovering that it has. */
      const step = Math.min(dt, 0.25);

      if (typing()) {
        acc += step;
        while (shown < full.length) {
          const need = costOf(full, shown);
          if (acc < need) break;
          acc -= need;
          shown += 1;
        }
        paint();
        if (typing()) { paintMark(0); return; }
      }

      /* Finished.  A short settle, then the mark breathes rather than blinks
       * — it is an invitation, and an invitation does not flash. */
      settle += step;
      if (settle < SETTLE) { paintMark(0); return; }
      breath += step;
      const wave = 0.5 - 0.5 * Math.cos((breath / BREATH) * Math.PI * 2);
      paintMark(0.14 + 0.34 * wave);
    },
  };
}
