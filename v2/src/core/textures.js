import * as THREE from 'three';
import { rngKit } from './util.js';

/* ------------------------------------------------------------------ *
 * Every texture in the world is drawn at load time with Canvas2D.
 *
 * The repository carries no images, which is not austerity for its own
 * sake: v1 was one HTML file with no assets and could be opened off a USB
 * stick, and losing that would be losing something real.  These are the
 * handful of maps that shape and colour cannot express on their own —
 * cloud edges, a water ripple, the soft blob of a shadow.
 * ------------------------------------------------------------------ */

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(c, { repeat = false, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const cache = new Map();
const memo = (key, make) => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
};

/** A soft cel cloud: a few overlapping lobes with a hard-ish top edge. */
export const cloudTex = () => memo('cloud', () => {
  const [c, x] = canvas(256, 128);
  const rng = rngKit(5150);
  x.clearRect(0, 0, 256, 128);
  x.fillStyle = '#ffffff';
  const lobes = 9;
  for (let i = 0; i < lobes; i++) {
    const t = i / (lobes - 1);
    const cx = 26 + t * 204;
    const r = 16 + Math.sin(t * Math.PI) * 34 * rng.range(0.8, 1.15);
    const cy = 86 - Math.sin(t * Math.PI) * 22 * rng.range(0.7, 1.1);
    x.beginPath();
    x.arc(cx, cy, r, 0, Math.PI * 2);
    x.fill();
  }
  x.fillRect(20, 80, 216, 14);
  // feather only the underside, so the top keeps a painted edge
  const g = x.createLinearGradient(0, 78, 0, 100);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.globalCompositeOperation = 'destination-in';
  x.fillStyle = '#fff';
  x.fillRect(0, 0, 256, 78);
  x.fillStyle = g;
  x.fillRect(0, 78, 256, 30);
  x.globalCompositeOperation = 'source-over';
  return toTexture(c);
});

/** A round soft blob — contact shadows under the hog and the props. */
export const blobTex = () => memo('blob', () => {
  const [c, x] = canvas(128, 128);
  const g = x.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,255,0.92)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.42)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  return toTexture(c);
});

/**
 * Cel water: flat highlight strokes over an opaque base.
 *
 * The base matters.  Drawn on transparency, the strokes *were* the water —
 * everything between them was a hole you could see the lake bed through, so
 * the lake read as a pale film lying on mud.  A mid-grey ground means the
 * material's own colour comes through everywhere and the strokes are simply
 * where it is brightest.
 */
export const rippleTex = () => memo('ripple', () => {
  const [c, x] = canvas(256, 256);
  x.fillStyle = '#b4b4b4';
  x.fillRect(0, 0, 256, 256);
  const rng = rngKit(88);
  x.strokeStyle = 'rgba(255,255,255,0.85)';
  x.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const y = rng.range(0, 256);
    const w = rng.range(18, 74);
    const xx = rng.range(0, 256 - w);
    x.lineWidth = rng.range(1.6, 4.2);
    x.beginPath();
    x.moveTo(xx, y);
    x.bezierCurveTo(xx + w * 0.3, y - 3, xx + w * 0.7, y + 3, xx + w, y);
    x.stroke();
  }
  return toTexture(c, { repeat: true });
});

/** One grass blade card: a tapered stroke, alpha only. */
export const bladeTex = () => memo('blade', () => {
  const [c, x] = canvas(32, 128);
  x.clearRect(0, 0, 32, 128);
  x.fillStyle = '#ffffff';
  x.beginPath();
  x.moveTo(16, 0);
  x.quadraticCurveTo(27, 60, 22, 128);
  x.lineTo(10, 128);
  x.quadraticCurveTo(6, 60, 16, 0);
  x.closePath();
  x.fill();
  return toTexture(c);
});

/** A five-petal flower head, seen from above. */
export const petalTex = () => memo('petals', () => {
  const [c, x] = canvas(64, 64);
  x.clearRect(0, 0, 64, 64);
  x.fillStyle = '#ffffff';
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    x.save();
    x.translate(32, 32);
    x.rotate(a);
    x.beginPath();
    x.ellipse(0, -16, 9, 15, 0, 0, Math.PI * 2);
    x.fill();
    x.restore();
  }
  x.beginPath();
  x.arc(32, 32, 8, 0, Math.PI * 2);
  x.fill();
  return toTexture(c);
});

/** Stars: a sparse field of points, drawn once and reused on the dome. */
export const starTex = () => memo('star', () => {
  const [c, x] = canvas(64, 64);
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return toTexture(c);
});

/**
 * A painted signboard.  One texture per string, so the town can have real
 * lettering without an image file or a webfont anywhere near the build.
 */
export function signTex(text, {
  w = 256, h = 96, bg = '#f0e7d2', fg = '#4a3f39', size = 34, border = true,
} = {}) {
  return memo(`sign|${text}|${w}|${h}|${bg}|${fg}|${size}`, () => {
    const [c, x] = canvas(w, h);
    x.fillStyle = bg;
    x.fillRect(0, 0, w, h);
    if (border) {
      x.strokeStyle = fg;
      x.globalAlpha = 0.55;
      x.lineWidth = 4;
      x.strokeRect(6, 6, w - 12, h - 12);
      x.globalAlpha = 1;
    }
    x.fillStyle = fg;
    x.font = `600 ${size}px ui-rounded, "Avenir Next", system-ui, sans-serif`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(text, w / 2, h / 2 + 2, w - 24);
    return toTexture(c);
  });
}
