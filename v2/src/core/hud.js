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
  };
  const last = {};

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
