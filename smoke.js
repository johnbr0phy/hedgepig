// Headless smoke harness for grass-d-gram.
// Mocks just enough DOM + Canvas2D to run the engine, counts ops and
// flags any non-finite coordinate reaching the context.
const fs = require("fs");

const HTML = fs.readFileSync(__dirname + "/index.html", "utf8");
const SRC  = HTML.match(/<script>([\s\S]*)<\/script>/)[1];

const W = 430, H = 900;
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
const patched = SRC.replace(/\n\}\)\(\);\s*$/, HOOK + "\n})();\n");
if (patched === SRC) throw new Error("could not find IIFE tail to hook");

eval(patched);
// the engine calls resize() on load via a listener; call it directly
(handlers.resize || []).forEach(f => f());

const tick = globalThis.__tick, peek = globalThis.__peek;

// The camera is player-controlled now, so scenarios must scroll to keep up
// exactly as a player would. Pass follow=false to deliberately abandon him.
function frames(n, fn, follow){
  for (let i=0;i<n;i++){
    nowMs += 1000/60;
    if (fn) fn(i);
    if (follow !== false) globalThis.__follow();
    tick(nowMs);
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
console.log("  ops/frame: fill", (ops.fill/3650).toFixed(0),
            " stroke", (ops.stroke/3650).toFixed(0),
            " save", (ops.save/3650).toFixed(0),
            " path", (ops.path/3650).toFixed(0));
if (bad.length){
  console.log("  !! NON-FINITE / DEGENERATE:", bad.length, "distinct");
  bad.slice(0,12).forEach(b => console.log("     ", b));
  process.exitCode = 1;
} else {
  console.log("  no non-finite coordinates");
}
