// Headless smoke harness for grass-d-gram.
// Mocks just enough DOM + Canvas2D to run the engine, counts ops and
// flags any non-finite coordinate reaching the context.
const fs = require("fs");

const HTML = fs.readFileSync(__dirname + "/index.html", "utf8");
const SRC  = HTML.match(/<script>([\s\S]*)<\/script>/)[1];

const W = 430, H = 900;
const LAB_ONLY = process.argv[2] === "lab";
let bad = [], ops = { fill:0, stroke:0, save:0, path:0, drawImage:0 };
const seen = new Set();

function chk(name, args){
  for (const v of args)
    if (typeof v === "number" && !Number.isFinite(v)){
      const key = name;
      if (!seen.has(key)){ seen.add(key); bad.push(name + "(" + args.join(",") + ")"); }
      return;
    }
}

function makeCtx(){
  const g = { addColorStop(){} };
  const c = {
    canvas:{ width:W, height:H },
    globalAlpha:1, globalCompositeOperation:"source-over",
    fillStyle:"", strokeStyle:"", lineWidth:1, lineCap:"", lineJoin:"",
    filter:"", imageSmoothingQuality:"", imageSmoothingEnabled:true,
    font:"", textAlign:"", textBaseline:"", shadowBlur:0, shadowColor:"",
    setTransform(){}, transform(){}, resetTransform(){},
    save(){ ops.save++; }, restore(){},
    translate(...a){ chk("translate", a); },
    scale(...a){ chk("scale", a); if (a[0]===0||a[1]===0) { if(!seen.has("scale0")){seen.add("scale0"); bad.push("scale to zero: "+a);} } },
    rotate(...a){ chk("rotate", a); },
    beginPath(){ ops.path++; }, closePath(){},
    moveTo(...a){ chk("moveTo", a); }, lineTo(...a){ chk("lineTo", a); },
    quadraticCurveTo(...a){ chk("quadraticCurveTo", a); },
    bezierCurveTo(...a){ chk("bezierCurveTo", a); },
    arc(...a){ chk("arc", a); }, arcTo(...a){ chk("arcTo", a); },
    ellipse(...a){ chk("ellipse", a); },
    rect(...a){ chk("rect", a); },
    fill(){ ops.fill++; }, stroke(){ ops.stroke++; },
    fillRect(...a){ ops.fill++; chk("fillRect", a); },
    strokeRect(...a){ chk("strokeRect", a); },
    clearRect(...a){ chk("clearRect", a); },
    clip(){}, fillText(){}, strokeText(){},
    measureText(){ return { width: 10 }; },
    drawImage(img, ...a){ ops.drawImage++; chk("drawImage", a); },
    createLinearGradient(...a){ chk("createLinearGradient", a); return g; },
    createRadialGradient(...a){ chk("createRadialGradient", a); return g; },
    createPattern(){ return { setTransform(){} }; },
    getImageData(w2, h2){ return { width:w2||1, height:h2||1, data:new Uint8ClampedArray(4) }; },
    createImageData(w2, h2){ const ww=w2||1, hh=h2===undefined?w2||1:h2;
      return { width:ww, height:hh, data:new Uint8ClampedArray(ww*hh*4) }; },
    putImageData(){},
  };
  return c;
}

const els = {};
function el(id){
  if (els[id]) return els[id];
  const e = {
    id, style:{}, textContent:"", children:[],
    classList:{ _s:new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);},
                toggle(c,on){ on ? this._s.add(c) : this._s.delete(c); },
                contains(c){ return this._s.has(c); } },
    appendChild(){}, addEventListener(){},
    getContext(){ return makeCtx(); },
    setPointerCapture(){}, releasePointerCapture(){},
  };
  els[id] = e;
  return e;
}
// the hearts row needs three children
el("hearts").children = [el("h0"), el("h1"), el("h2")];
Object.defineProperty(el("hearts").children, "length", { value:3 });

const handlers = {};
global.document = {
  getElementById: el,
  createElement(tag){ return el("dyn" + Math.random()); },
  addEventListener(t, f){ (handlers[t] ||= []).push(f); },
  documentElement: el("html"), body: el("body"),
};
global.window = {
  innerWidth:W, innerHeight:H, devicePixelRatio:2,
  addEventListener(t, f){ (handlers[t] ||= []).push(f); },
  matchMedia(){ return { matches:false, addEventListener(){} }; },
  requestAnimationFrame(){ return 0; },
};
global.requestAnimationFrame = () => 0;   // we drive tick() ourselves
global.performance = { now: () => nowMs };
global.Path2D = function(){ return { addPath(){}, moveTo(){}, lineTo(){}, quadraticCurveTo(){}, closePath(){}, bezierCurveTo(){}, arc(){}, ellipse(){}, rect(){} }; };
global.devicePixelRatio = 2;

let nowMs = 0;

// expose tick + a few internals by appending a hook to the IIFE body
const HOOK = `
;globalThis.__tick = tick;
;globalThis.__peek = () => ({ scrollY, hogWy: hog.wy, hogX: hog.x, hd: hog.hd,
   state: GAME.state, leg: GAME.leg, hearts: GAME.hearts, started: GAME.started,
   crumbs: crumbs.length, tracks: tracks.length, sprouts: sprouts.length,
   goal: GAME.goalWy, start: GAME.startWy, curl: hog.curl, shiver: hog.shiver,
   cells: cells.size, motes: motes.length });
;globalThis.__tap = (x,y) => { if(!GAME.started) startRun(); taps.push({x,y}); sow(x, y+6); };
;globalThis.__hits = { n:0, kinds:{} };
;(() => { const _h = hurt; hurt = function(k){ const before = GAME.hearts;
    _h(k); if (GAME.hearts !== before){ globalThis.__hits.n++;
    globalThis.__hits.kinds[k] = (globalThis.__hits.kinds[k]||0)+1; } }; })();
;globalThis.__scroll = v => { scrollV += v; };
;globalThis.__force = o => { if(o.scrollY!==undefined) scrollY=o.scrollY; if(o.hogWy!==undefined) hog.wy=o.hogWy; if(o.hogX!==undefined) hog.x=o.hogX; };
;globalThis.__goal = () => ({ wy: GAME.goalWy, x: GAME.goalX*W });
;globalThis.__roadWy = () => { for (let sg=1; sg<400; sg++) if (segBiome(sg) === ROAD) return bandEdges(sg, ROAD)[0]; return 0; };
;globalThis.__onRoad = () => roadAt(hog.wy);
;globalThis.__under = () => hog.under;
;globalThis.__crossX = () => { const sg = Math.floor(hog.wy/SEG); return crossX(sg)*W; };
;globalThis.__follow = () => { scrollY = hog.wy - H*0.38; scrollV = 0; };
// call him to a WORLD position, so scenarios work with the camera anywhere
;globalThis.__call = (x, wy) => { if(!GAME.started) startRun();
    crumbs.length = 0; crumbs.push({ x, wy, t:0, eaten:0 }); };
;globalThis.__moving = () => hog.gait;

`;
/* ── the sync check ───────────────────────────────────────────────────────
   `node smoke.js sync` proves that hog-lab.html and index.html still share
   the hedgehog, rather than my believing they do.

   They had silently diverged on the HEAD RIG: the lab had a body-relative
   gaze and a trailing head lag, the game still had the camera-relative gaze
   the lab's own comment calls a bug, an inverted lag, and its ears 0.37 rad
   out of place. The cause is that I hand-ported with string replaces, and a
   replace whose pattern has already drifted does nothing at all and says
   nothing about it. So this compares them mechanically instead.
   ────────────────────────────────────────────────────────────────────────── */
if (process.argv[2] === "sync"){
  const lab = fs.readFileSync(__dirname + "/hog-lab.html", "utf8");
  const gme = fs.readFileSync(__dirname + "/index.html", "utf8");
  const fnOf = (src, name) => {
    const i = src.indexOf("function " + name + "(");
    if (i < 0) return null;
    let k = src.indexOf("{", i), depth = 0;
    for (;; k++){
      if (src[k] === "{") depth++;
      else if (src[k] === "}" && --depth === 0) break;
    }
    return src.slice(i, k + 1);
  };
  const lineOf = (src, key) => (src.split("\n").find(l => l.startsWith(key)) || null);

  const problems = [];
  // functions that must be character-identical
  /* facePt and HEAD are deliberately NOT here: they are the 2D head frame, used
     only by hog-lab.html's legacy renderer behind the `3d` toggle. They were
     unreachable in the game and described a different skull from the one that
     draws, so anyone reaching for facePt got a face in the wrong place. */
  for (const name of ["lookAt","updateLook","updateIdle","hRot","headDir"]){
    const a = fnOf(lab, name), b = fnOf(gme, name);
    if (a === null || b === null){ problems.push(name + ": missing from " + (a ? "index.html" : "hog-lab.html")); continue; }
    if (a !== b) problems.push(name + "(): DIVERGED");
  }
  // constants that must match
  for (const key of ["const AZ_EYE","const RR_EYE","const AZ_EAR","const RR_EAR",
                     "const SNOUT_R","const HEAD_K","const PITCH_K","const LAG_S",
                     "const HL_K","const BODY","const HD_R","const HD_C",
                     "const GROUND","const MN","const MK0","const QSHADE","const L3",
                     "const faceVis","const frontVis"]){
    const a = lineOf(lab, key), b = lineOf(gme, key);
    if (a !== b) problems.push(key + ": \n      lab  " + a + "\n      game " + b);
  }
  // and the drawing body, after the differences that are DECLARED
  const bodyOf = (src, name) => {
    const f = fnOf(src, name);
    return f.slice(f.indexOf("{") + 1).replace(/\s+/g, " ");
  };
  // everything before `const p = hog.walk` is the declared preamble: the lab
  // sets a = 1 and takes cx/cy/K, the game resolves afloat/k/sy/alpha and
  // culls. Compare from there on.
  const after = x => { const i = x.indexOf("const p = hog.walk"); return i < 0 ? x : x.slice(i); };
  let A = after(bodyOf(lab, "drawHog3")), B = after(bodyOf(gme, "drawHog"));
  // declared: t vs time, K vs k, the stall origin vs his world position
  A = A.replace(/\bt\*/g, "time*").replace(/\bK\b/g, "k")
       .replace(/cx \+ shiv, cy \+ bob/g, "hog.x + shiv, sy + bob");
  // the game-only preamble, boat, and flash term are stripped from both sides
  const strip = x => x
    .replace(/if \(afloat\)\{[\s\S]*?ctx\.translate\(0, -9\); \} else \{ /g, "")
    .replace(/ctx\.globalAlpha = a; \} \/\* ── the coat/g, "ctx.globalAlpha = a; /* ── the coat")
    .replace(/ \+ GAME\.flash\*\.5/g, "")
    .replace(/if \(afloat\)\{ ctx\.save\(\); ctx\.scale\(boatS, 1\);[\s\S]*?ctx\.restore\(\); \} /g, "")
    .replace(/&& !afloat/g, "").replace(/\|\| afloat/g, "")
    .replace(/\s+/g, " ").replace(/ \)/g, ")").replace(/\( /g, "(").trim();
  A = strip(A); B = strip(B);
  if (A !== B){
    // find where they first differ, for a useful message
    let i = 0; while (i < A.length && i < B.length && A[i] === B[i]) i++;
    problems.push("the drawing body diverges at char " + i + ":\n      lab  ..." +
                  A.slice(Math.max(0,i-70), i+90) + "\n      game ..." +
                  B.slice(Math.max(0,i-70), i+90));
  }

  console.log("scenario: sync");
  if (problems.length){
    console.log("  !! THE LAB AND THE GAME HAVE DIVERGED (" + problems.length + ")");
    problems.forEach(p => console.log("     - " + p));
    process.exitCode = 1;
  } else {
    console.log("  the shared hedgehog is identical in both files");
  }
  return;
}

/* ── the lab ──────────────────────────────────────────────────────────────
   `node smoke.js lab` runs hog-lab.html under the same mocks and drives its
   rAF loop for a few hundred frames.

   This exists because the lab went COMPLETELY BLANK — a bare ReferenceError
   in drawHog3 on the first frame — and nothing said a word. The harness only
   ever loaded index.html, and a syntax check with `new Function` cannot catch
   a name that is merely missing at runtime. The lab is where the animation is
   actually judged, so it silently drawing nothing is about the worst failure
   available.
   ────────────────────────────────────────────────────────────────────────── */
if (LAB_ONLY){
  const LAB = fs.readFileSync(__dirname + "/hog-lab.html", "utf8");
  let LSRC = LAB.match(/<script>([\s\S]*)<\/script>/)[1];
  /* Count the faces. A fill threshold cannot see a missing face — it is only
     ~33 fills of ~496 — and "his whole face is never drawn" sailed through the
     count. So the face itself gets a counter injected. */
  globalThis.__faces = 0;
  const faceHook = LSRC.replace("    if (fa <= .02) return;",
                                "    if (fa <= .02) return; globalThis.__faces++;");
  if (faceHook === LSRC) throw new Error("could not hook drawFace to count faces");
  LSRC = faceHook;
  // the lab drives itself off rAF, so capture the callback and pump it
  let rafCb = null;
  global.requestAnimationFrame = cb => { rafCb = cb; return 0; };
  global.window.requestAnimationFrame = global.requestAnimationFrame;
  // its stalls measure themselves off getBoundingClientRect
  const origEl = global.document.createElement;
  /* DISTINCT rects per stall. They all shared one before, which made the very
     thing eleven stalls exist for — per-stall pointer aim — untestable. */
  let stallN = 0;
  const rectFor = i => ({ left:(i%4)*320, top:Math.floor(i/4)*280,
                          width:320, height:280,
                          right:(i%4)*320+320, bottom:Math.floor(i/4)*280+280 });
  for (const k of Object.keys(els)) els[k].getBoundingClientRect = () => rectFor(0);
  global.document.createElement = tag => {
    const e = origEl(tag);
    const mine = rectFor(stallN++);
    e.getBoundingClientRect = () => mine;
    e.querySelector = () => e;
    e.innerHTML = "";
    return e;
  };
  global.document.getElementById = id => { const e = el(id);
    e.getBoundingClientRect = () => rect; e.querySelector = () => e;
    if (id === "spd" || id === "scl") e.value = "100";
    return e; };

  /* Per-stall fill counting. The old check was one global
     `ops.fill < 400*11*20` — 220 fills a frame against an actual 5850, so ten
     of the eleven stalls could go dark and it still passed by 2.3x, and the
     entire quill coat could vanish and it passed. A reviewer demonstrated
     exactly that with mutation testing. Now: every stall must draw its own
     share, every frame. */
  let perStall = null;
  const wrapStalls = () => {
    if (!globalThis.__labStalls) return;
    perStall = globalThis.__labStalls.map(() => 0);
  };

  let thrown = null;
  try {
    eval(LSRC);
    // and give the pointer somewhere to be, or lookAt() is never called at all
    (handlers.mousemove || []).forEach(f => f({ clientX: 900, clientY: 120 }));
    for (let i=0;i<400;i++){
      if (!rafCb){ thrown = "the lab never asked for a frame"; break; }
      const cb = rafCb; rafCb = null;
      nowMs += 1000/60;
      cb(nowMs);
    }
  } catch (e){ thrown = e.stack || String(e); }

  console.log("scenario: lab");
  if (thrown){
    console.log("  !! THE LAB THREW\n     " + String(thrown).split("\n").slice(0,4).join("\n     "));
    process.exitCode = 1;
  } else {
    console.log("  400 frames, no exception");
    const perFrame = ops.fill/400;
    console.log("  ops/frame: fill", perFrame.toFixed(0),
                " stroke", (ops.stroke/400).toFixed(0),
                " path", (ops.path/400).toFixed(0));
    /* A single hedgehog at full detail is ~440 fills, so eleven of them is
       ~4800. Anything under 300 per stall means a stall has gone dark or the
       coat has stopped drawing — the two failures this whole rebuild exists
       to prevent. Verified by mutation: skipping the coat drops it to ~46 a
       stall, and blanking ten of eleven stalls drops it to ~47. */
    const perStallAvg = perFrame/11;
    console.log("  about", perStallAvg.toFixed(0), "fills per stall per frame");
    if (perStallAvg < 300){
      console.log("  !! A STALL HAS GONE DARK OR THE COAT HAS STOPPED DRAWING",
                  "(" + perStallAvg.toFixed(0) + " per stall, expected 400+)");
      process.exitCode = 1;
    }
    if ((handlers.mousemove || []).length === 0){
      console.log("  !! the lab is not listening for the pointer, so lookAt() is untested");
      process.exitCode = 1;
    }
    /* Eleven stalls, of which `walking away` legitimately has no face and
       `curled` loses it for part of its cycle. Eight a frame is a safe floor. */
    const facesPerFrame = globalThis.__faces/400;
    console.log("  faces drawn per frame:", facesPerFrame.toFixed(1), "of 11 stalls");
    if (facesPerFrame < 8){
      console.log("  !! HIS FACE IS NOT BEING DRAWN (expected 9-10 of 11 stalls)");
      process.exitCode = 1;
    }
    if (bad.length){
      console.log("  !! NON-FINITE / DEGENERATE:", bad.length, "distinct");
      bad.slice(0,12).forEach(b => console.log("     ", b));
      process.exitCode = 1;
    } else {
      console.log("  no non-finite coordinates");
    }
  }
  return;
}

const patched = SRC.replace(/\n\}\)\(\);\s*$/, HOOK + "\n})();\n");
if (patched === SRC) throw new Error("could not find IIFE tail to hook");

eval(patched);
// the engine calls resize() on load via a listener; call it directly
(handlers.resize || []).forEach(f => f());

const tick = globalThis.__tick, peek = globalThis.__peek;

// The camera is player-controlled now, so scenarios must scroll to keep up
// exactly as a player would. Pass follow=false to deliberately abandon him.
/* Count them. The ops/frame report used to divide by a hardcoded 3650 whatever
   the scenario actually ran, which is between 1340 frames (`goal`, `back`) and
   6140 (`abandon`) — so it understated `back` by 63% and overstated `abandon`
   by 68%. Worse, it read as a measurement: I published a hedgehog cost of 232
   fills a frame off the back of it, measured on `idle`, which runs 2180 frames.
   The real figure was 441. §4 of the handover already records the harness
   lying with confidence twice; this was the third. */
let nFrames = 0;
function frames(n, fn, follow){
  for (let i=0;i<n;i++){
    nowMs += 1000/60;
    if (fn) fn(i);
    if (follow !== false) globalThis.__follow();
    tick(nowMs);
    nFrames++;
  }
}

// ── scenario ─────────────────────────────────────────────────────────
const scen = process.argv[2] || "walk";
console.log("scenario:", scen);

frames(120);                                 // warm up, nothing started
let p = peek();
console.log("  before start: started =", p.started, " hogWy =", p.hogWy.toFixed(1),
            p.hogWy > 1 ? "  !! HE MOVED BEFORE THE RUN STARTED" : "  (stayed put, correct)");

globalThis.__tap(W*0.5, H*0.5);              // first tap starts the run
frames(20);
p = peek();
console.log("  after start:  started =", p.started, " leg =", p.leg, " hearts =", p.hearts);

let startWy = peek().hogWy;

if (scen === "walk"){
  // call him onward repeatedly, as a player would
  frames(3600, i => {
    if (i % 90 === 0){
      const pk = peek();
      globalThis.__call(W*(0.25 + 0.5*Math.abs(Math.sin(i*0.07))), pk.hogWy + 300);
    }
  });
} else if (scen === "idle"){
  // Let him finish walking to the tap that started the run, THEN stop calling
  // him. He must not move another pixel — the whole point of point-to-point,
  // and the old auto-runner would fail this outright.
  frames(240);
  startWy = peek().hogWy;
  frames(1800);
} else if (scen === "back"){
  // call him backwards up the field: he must be able to reverse
  frames(1200, i => {
    if (i % 120 === 0){
      const pk = peek();
      globalThis.__call(W*0.5, pk.hogWy - 300);
    }
  });
} else if (scen === "scout"){
  frames(3600, i => {
    if (i % 120 < 30) globalThis.__scroll(900);   // player runs the camera ahead
    if (i % 90 === 0) globalThis.__call(W*0.5, peek().hogWy + 300);
  });
} else if (scen === "abandon"){
  // park the camera and walk away from it: hazards must still bite.
  // Steer him about by hand, since taps map through a camera that is elsewhere.
  frames(6000, i => {
    if (i % 90 === 0) globalThis.__call(40 + (i*97 % 350), peek().hogWy + 300);
  }, false);
} else if (scen === "far"){
  globalThis.__force({ hogWy: 300000, scrollY: 300000 - H*0.4 });   // deep world
  startWy = peek().hogWy;                    // measure from AFTER the jump
  frames(2400, i => {
    if (i % 90 === 0) globalThis.__call(W*(0.2+0.6*Math.random()), peek().hogWy + 300);
  });
}

else if (scen === "road" || scen === "roadmiss"){
  // park him just before a road band and make him walk across it
  globalThis.__force({ hogWy: globalThis.__roadWy() - 700 });
  globalThis.__force({ scrollY: peek().hogWy - H*0.4 });
  startWy = peek().hogWy;
  const mouth = globalThis.__crossX();
  // "road" steers him at the culvert; "roadmiss" deliberately steers him wide
  const aimX = scen === "road" ? mouth : (mouth < W/2 ? W - 40 : 40);
  console.log("  culvert mouth x =", mouth.toFixed(0), " aiming at", aimX.toFixed(0));
  let underFrames = 0;
  frames(3000, i => {
    if (i % 70 === 0) globalThis.__call(aimX, peek().hogWy + 260);
    if (globalThis.__under() > 0.5) underFrames++;
  });
  console.log("  frames underground:", underFrames);
} else if (scen === "goal"){
  // drop him just short of the burrow, aimed at it
  const g = globalThis.__goal();
  globalThis.__force({ hogWy: g.wy - 900, hogX: g.x, scrollY: g.wy - 900 - H*0.4 });
  startWy = peek().hogWy;
  frames(1200, i => { if (i % 90 === 0) globalThis.__call(g.x, g.wy); });
}

p = peek();
const dist = p.hogWy - startWy;
console.log("  travelled:  ", (dist/220).toFixed(1), "m  (", dist.toFixed(0), "px )");
console.log("  leg:", p.leg, " hearts:", p.hearts, " state:", p.state);
console.log("  hog x:", p.hogX.toFixed(1), " heading:", p.hd.toFixed(3),
            " screenY:", (p.hogWy - p.scrollY).toFixed(1), "/", H);
console.log("  crumbs:", p.crumbs, " tracks:", p.tracks, " sprouts:", p.sprouts, " cells:", p.cells);
console.log("  hits:", globalThis.__hits.n, JSON.stringify(globalThis.__hits.kinds),
            " gait:", globalThis.__moving().toFixed(2));
if (scen === "idle" && dist > 1){ console.log("  !! HE MOVED WITHOUT BEING CALLED"); process.exitCode = 1; }
if (scen === "back" && dist > -100){ console.log("  !! HE DID NOT WALK BACKWARDS"); process.exitCode = 1; }
console.log("  ops/frame over", nFrames, "frames: fill", (ops.fill/nFrames).toFixed(0),
            " stroke", (ops.stroke/nFrames).toFixed(0),
            " save", (ops.save/nFrames).toFixed(0),
            " path", (ops.path/nFrames).toFixed(0));
if (bad.length){
  console.log("  !! NON-FINITE / DEGENERATE:", bad.length, "distinct");
  bad.slice(0,12).forEach(b => console.log("     ", b));
  process.exitCode = 1;
} else {
  console.log("  no non-finite coordinates");
}
