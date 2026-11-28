/**
 * Real components cut from the existing complete painting. No image warping.
 *
 * import { mountObjectMotion, READER_OBJECTS, LIBRARY_OBJECTS } from './object-motion.js';
 * const motion = mountObjectMotion({ canvas, fallbackImage: image,
 *   imageUrl: image.src, cleanImageUrl: 'assets/reader-clean-v3.png',
 *   objects: READER_OBJECTS, fit: 'fill', reduceMotion: media.matches });
 * motion.bindRegion(button, button.dataset.motion);
 *
 * The canvas overlays the persistent original IMG. Accessible action buttons
 * stay separate; this module adds no text, tooltip, click handler or navigation.
 * Paths use the original 1672 x 941 image coordinates, not screen coordinates.
 */

const WIDTH = 1672, HEIGHT = 941;
const DEG = Math.PI / 180;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const ease = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

const PROGRAMME_FLAP = 'M145 164 L182 142 L207 294 L171 317 Z';
const BACK_CARD_VISIBLE = 'M45 423 Q42 417 50 415 L171 400 Q178 399 179 406 L180 412 L46 429 Z';
const BACK_CARD_FULL = 'M45 423 Q42 417 50 415 L171 400 Q178 399 179 406 L193 511 Q194 518 187 520 L65 535 Q58 536 57 529 Z';
const CARDS_AND_FOLDER = 'M28 437 Q31 430 42 427 L177 411 Q186 409 190 421 L208 625 L202 637 L48 652 L37 642 Z';
const READER_TASSEL = 'M1593 337 C1598 337 1602 342 1602 349 L1600 354 C1608 366 1618 381 1634 392 L1630 397 L1624 395 L1621 400 L1614 396 L1611 402 L1605 399 L1601 404 L1597 399 L1592 402 C1590 383 1589 367 1593 354 C1587 349 1588 342 1593 337 Z';
const LEFT_SPOOL = 'M34 755 C36 741 55 725 78 714 C96 705 115 700 121 712 C126 721 124 730 120 737 L149 786 C159 784 168 789 171 798 C178 815 158 833 133 843 C111 853 91 851 85 841 C81 835 83 828 88 822 L54 775 C44 775 34 766 34 755 Z';
const RIGHT_SPOOL = 'M1547 701 C1547 691 1555 687 1566 690 C1591 693 1627 713 1636 733 C1641 744 1634 753 1622 753 L1591 793 C1597 802 1599 812 1593 821 C1583 837 1557 823 1537 813 C1516 801 1504 789 1507 779 C1508 769 1521 765 1532 768 L1550 723 C1545 716 1544 708 1547 701 Z';
const LIBRARY_TASSEL = 'M1580 331 C1587 331 1593 337 1592 344 L1588 351 C1593 363 1608 381 1626 390 L1622 397 L1617 395 L1614 402 L1608 398 L1605 405 L1599 401 L1596 408 L1590 404 L1587 409 L1580 405 L1574 408 C1572 389 1572 367 1578 351 C1572 347 1573 337 1580 331 Z';
const NEW_BOOK_CARD = 'M1446 614 Q1444 611 1451 610 L1576 588 Q1584 587 1585 594 L1592 628 L1556 639 Q1528 667 1494 656 L1452 653 Z';
const NEW_BOOK_CARD_FULL = 'M1446 614 Q1444 611 1451 610 L1576 588 Q1584 587 1585 594 L1604 709 L1472 733 Z';
const NEW_BOOK_WALLET = 'M1430 656 L1451 650 Q1490 645 1508 657 Q1534 665 1553 641 L1607 627 L1629 748 L1452 778 Z';
const WRAPPER_UPPER_FLAP = 'M559 227 L541 119 Q540 109 547 102 L610 35 Q621 25 635 26 L1047 26 Q1059 26 1068 37 L1125 101 Q1132 110 1130 123 L1114 227 Z';
const REGISTER_CARD = 'M134 174 L124 121 Q123 112 132 109 L249 90 Q257 88 261 96 L270 154 Z';
const REGISTER_CARD_FULL = 'M134 174 L124 121 Q123 112 132 109 L249 90 Q257 88 261 96 L283 243 L148 264 Z';
const REGISTER_BOOK = 'M84 190 L107 179 L288 150 Q299 149 304 163 L348 406 L337 426 L142 458 L121 448 Z';

/** All extracted artwork is sampled from the original complete reader image. */
export const READER_OBJECTS = Object.freeze([
  { id:'programme', mode:'fold', path:PROGRAMME_FLAP, bounds:[143,139,67,182],
    pivot:[145,164], hinge:[171,317], fold:.28, duration:400, erasePadding:3, shadow:1.2 },
  { id:'cards', mode:'slide', path:BACK_CARD_VISIBLE, fullPath:BACK_CARD_FULL,
    bounds:[41,397,157,143], pivot:[115,470], dx:-2, dy:-20, rotate:-.35,
    duration:420, erasePadding:1, shadow:.7, occluders:[CARDS_AND_FOLDER],
    paper:{ sample:[96,433,62,20], target:[44,400,151,136] }, paperUnderlay:false },
  { id:'key', mode:'swing', path:READER_TASSEL, bounds:[1586,334,51,73],
    pivot:[1595,342], rotate:8, duration:950, erasePadding:3, shadow:.6 },
  { id:'previous', mode:'roll', path:LEFT_SPOOL, bounds:[29,697,149,158],
    pivot:[103,777], dx:8, dy:-4, rotate:.5, duration:1500, erasePadding:8, shadow:5,
    face:{ center:[133,823], radius:[31,12], angle:-32 } },
  { id:'next', mode:'roll', path:RIGHT_SPOOL, bounds:[1504,685,135,146],
    pivot:[1571,758], dx:-8, dy:-4, rotate:-.5, duration:1500, erasePadding:8, shadow:5,
    face:{ center:[1544,801], radius:[31,11], angle:28 } },
]);

/** The new book card is drawn together with the full library painting. */
export const LIBRARY_OBJECTS = Object.freeze([
  { id:'key', mode:'swing', path:LIBRARY_TASSEL, bounds:[1569,327,61,86],
    pivot:[1584,338], rotate:6, duration:950, erasePadding:4, shadow:.45 },
  { id:'newbook', mode:'slide', path:NEW_BOOK_CARD, fullPath:NEW_BOOK_CARD_FULL,
    bounds:[1442,585,165,150], pivot:[1510,650], dx:-2, dy:-16, rotate:-.3,
    duration:420, erasePadding:2, shadow:.7, occluders:[NEW_BOOK_WALLET],
    paper:{ sample:[1468,617,70,14], target:[1442,585,165,150] }, paperUnderlay:false },
]);

/** The fold follows the painted paper crease; the table and live ink remain still. */
export const IMPORT_OBJECTS = Object.freeze([
  { id:'wrapper', mode:'fold', path:WRAPPER_UPPER_FLAP, bounds:[539,23,596,207],
    pivot:[558,227], hinge:[1114,227], fold:.065, duration:500, erasePadding:3, shadow:2 },
  { id:'register', mode:'slide', path:REGISTER_CARD, fullPath:REGISTER_CARD_FULL,
    bounds:[121,87,166,181], pivot:[202,164], dx:-1.4, dy:-13, rotate:-.35,
    duration:420, erasePadding:2, shadow:.7, occluders:[REGISTER_BOOK],
    paper:{ sample:[160,129,72,20], target:[121,87,166,181] }, paperUnderlay:false },
]);

function normalize(input) {
  if (!Array.isArray(input) || input.length > 16) throw new TypeError('Provide at most 16 scene objects.');
  const ids = new Set();
  return input.map(object => {
    const id = String(object.id || '');
    if (!id || ids.has(id)) throw new TypeError('Object IDs must be unique and nonempty.');
    ids.add(id);
    if (!['slide','fold','swing','roll','lift'].includes(object.mode)
        || typeof object.path !== 'string' || !Array.isArray(object.bounds)
        || object.bounds.length !== 4 || !object.bounds.every(Number.isFinite)
        || object.bounds[2] <= 0 || object.bounds[3] <= 0) {
      throw new TypeError(`Invalid component definition: ${id}`);
    }
    return { ...object, id, duration:clamp(Number(object.duration) || 420, 120, 2400),
      level:0, from:0, target:0, started:0, transition:0, pulseStart:null, prepared:null };
  });
}

export function mountObjectMotion({
  canvas, fallbackImage, imageUrl, cleanImageUrl, objects = READER_OBJECTS,
  fit = 'fill', reduceMotion, maxDpr = 2, onStatus,
} = {}) {
  if (canvas?.tagName !== 'CANVAS' || fallbackImage?.tagName !== 'IMG') {
    throw new TypeError('Object motion needs a canvas and its persistent original image.');
  }
  if (!['fill','contain','cover'].includes(fit)) throw new TypeError('Invalid scene fit.');
  const doc = canvas.ownerDocument, win = doc.defaultView;
  const originalUrl = new URL(String(imageUrl || fallbackImage.currentSrc || fallbackImage.src), doc.baseURI).href;
  const cleanUrl = cleanImageUrl ? new URL(String(cleanImageUrl), doc.baseURI).href : '';
  let parts = normalize(objects), context = null, source = null, clean = null;
  let frame = 0, dead = false, failed = '', wanted = null, lastReport = '', pulseTimer = 0;
  let reducedOverride = typeof reduceMotion === 'boolean' ? reduceMotion : null;
  const media = reduceMotion && typeof reduceMotion === 'object'
    ? reduceMotion : win.matchMedia?.('(prefers-reduced-motion: reduce)');
  const reduced = () => reducedOverride ?? !!media?.matches;
  const dprLimit = clamp(Number(maxDpr) || 2, 1, 2);
  const cleanups = [], bindings = new Set();
  const prior = { canvasVisibility:canvas.style.visibility, canvasPointer:canvas.style.pointerEvents,
    canvasHidden:canvas.hidden, imageVisibility:fallbackImage.style.visibility,
    imagePointer:fallbackImage.style.pointerEvents, imageHidden:fallbackImage.hidden };
  canvas.hidden = false; canvas.style.pointerEvents = 'none'; canvas.style.visibility = 'hidden';
  fallbackImage.hidden = false; fallbackImage.style.pointerEvents = 'none'; fallbackImage.style.visibility = 'visible';
  // Never change object-fit, object-position or the narrow-screen crop rules.

  function report(mode, reason = '') {
    const key = `${mode}|${reason}`;
    if (key === lastReport) return;
    lastReport = key;
    try { onStatus?.({ mode, reason }); } catch { /* Diagnostics remain optional. */ }
  }
  function staticFrame(reason = '') {
    canvas.style.visibility = 'hidden'; fallbackImage.style.visibility = 'visible';
    report('static', reason || failed);
  }
  function listen(target, name, fn, options) {
    target.addEventListener(name, fn, options);
    const off = () => target.removeEventListener(name, fn, options);
    cleanups.push(off); return off;
  }
  function stop() { if (frame) win.cancelAnimationFrame(frame); frame = 0; }
  function queue() { if (!dead && !failed && !frame && !doc.hidden) frame = win.requestAnimationFrame(tick); }
  function surface(width, height) {
    const c = doc.createElement('canvas'); c.width = Math.max(1, Math.ceil(width)); c.height = Math.max(1, Math.ceil(height));
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('Canvas2D is unavailable.');
    return [c, ctx];
  }
  function path(value) { return new win.Path2D(value); }

  function extracted(shape, box, fillRule = 'nonzero', paper) {
    const [x,y,width,height] = box, [c,ctx] = surface(width,height);
    ctx.translate(-x,-y);
    if (paper) {
      ctx.save(); ctx.clip(path(shape.fullPath || shape.path), 'nonzero');
      ctx.drawImage(source, ...paper.sample, ...paper.target); ctx.restore();
    }
    ctx.save(); ctx.clip(path(typeof shape === 'string' ? shape : shape.path), fillRule);
    ctx.drawImage(source, 0,0,WIDTH,HEIGHT); ctx.restore();
    return { image:c, x,y,width:c.width,height:c.height };
  }

  function background(part, box) {
    const [x,y,width,height] = box;
    const [c,ctx] = surface(width,height), [mask,maskContext] = surface(width,height);
    maskContext.translate(-x,-y);
    const p = path(part.erasePath || part.path);
    const padding = Number(part.erasePadding) || 0;
    maskContext.fillStyle = '#fff'; maskContext.strokeStyle = '#fff';
    maskContext.lineJoin = 'round'; maskContext.lineCap = 'round';
    maskContext.lineWidth = 2 * padding;
    maskContext.fill(p, part.erasePath ? 'nonzero' : part.fillRule || 'nonzero');
    if (padding) maskContext.stroke(p);
    // Only the old component silhouette and its small contact shadow are
    // replaced, with a soft fixed edge. No desk rectangle ever moves.
    const [softMask,softContext] = surface(width,height);
    softContext.filter = `blur(${Math.max(1.3,padding*.5)}px)`;
    softContext.drawImage(mask,0,0); softContext.filter = 'none';
    softContext.translate(-x,-y); softContext.fillStyle = '#fff';
    // Keep the component itself fully erased while feathering only the fixed
    // surrounding paper. A broad feather never creates a half-visible ghost.
    softContext.fill(p,part.erasePath ? 'nonzero' : part.fillRule || 'nonzero');
    ctx.drawImage(clean, x,y,width,height, 0,0,width,height);
    ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(softMask,0,0);
    return { image:c, x,y,width:c.width,height:c.height };
  }

  function prepare() {
    context = canvas.getContext('2d', { alpha:true });
    if (!context || !win.Path2D) throw new Error('Canvas2D component drawing is unavailable.');
    for (const part of parts) {
      const [x,y,w,h] = part.bounds, pad = Math.max(12,(part.erasePadding || 0)+5);
      const box = [Math.max(0,Math.floor(x-pad)),Math.max(0,Math.floor(y-pad)),
        Math.min(WIDTH,x+w+pad)-Math.max(0,Math.floor(x-pad)),
        Math.min(HEIGHT,y+h+pad)-Math.max(0,Math.floor(y-pad))];
      const prepared = {
        sprite:extracted(part,part.bounds,part.fillRule || 'nonzero',part.paper),
        background:background(part,box),
        occluders:(part.occluders || []).map(p => ({ path:path(p) })),
      };
      if (part.paper && part.paperUnderlay !== false) {
        // The small newly exposed strip uses the original card group's paper. The
        // unchanged pocket is redrawn above it, keeping a real occlusion edge.
        const [under,underContext] = surface(w,h);
        underContext.translate(-x,-y); underContext.clip(path(part.path));
        underContext.drawImage(source,...part.paper.sample,...part.paper.target);
        prepared.underlay = { image:under,x,y };
      }
      if (part.face) {
        const f = part.face, facePath = new win.Path2D();
        facePath.ellipse(f.center[0],f.center[1],f.radius[0],f.radius[1],f.angle*DEG,0,Math.PI*2);
        prepared.facePath = facePath;
      }
      part.prepared = prepared;
    }
  }

  function layout() {
    const box = canvas.getBoundingClientRect();
    if (box.width < 1 || box.height < 1 || !canvas.getClientRects().length) return null;
    const ratio = Math.min(dprLimit,win.devicePixelRatio || 1,Math.sqrt(6_000_000/(box.width*box.height)));
    const width = Math.max(1,Math.round(box.width*ratio)), height = Math.max(1,Math.round(box.height*ratio));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    let imageWidth = width, imageHeight = height;
    if (fit !== 'fill') {
      const s = fit === 'cover' ? Math.max(width/WIDTH,height/HEIGHT) : Math.min(width/WIDTH,height/HEIGHT);
      imageWidth = WIDTH*s; imageHeight = HEIGHT*s;
    }
    return { width,height,sx:imageWidth/WIDTH,sy:imageHeight/HEIGHT,
      x:(width-imageWidth)/2,y:(height-imageHeight)/2 };
  }

  function advance(now) {
    let moving = false;
    for (const part of parts) {
      if (part.pulseStart !== null) {
        if (now - part.pulseStart >= part.duration) part.pulseStart = null;
        else moving = true;
      }
      if (part.level !== part.target) {
        const t = part.transition ? clamp((now-part.started)/part.transition,0,1) : 1;
        part.level = t === 1 ? part.target : part.from + (part.target-part.from)*ease(t);
        moving ||= t < 1;
      }
    }
    return moving;
  }

  function pose(part, now) {
    if (part.mode === 'roll') {
      if (part.pulseStart === null) return null;
      const t = clamp((now-part.pulseStart)/part.duration,0,1), e = ease(t);
      const travel = Math.sin(Math.PI*e);
      return { level:travel, dx:(part.dx || 0)*travel,dy:(part.dy || 0)*travel,
        rotation:(part.rotate || 0)*DEG*travel,spin:Math.PI*4*e };
    }
    if (part.mode === 'swing') {
      if (part.pulseStart === null) return null;
      const t = clamp((now-part.pulseStart)/part.duration,0,1);
      const swing = Math.sin(t*Math.PI*3)*Math.sin(t*Math.PI);
      return { level:Math.abs(swing),dx:0,dy:0,rotation:(part.rotate || 6)*DEG*swing };
    }
    if (part.level <= .00001) return null;
    return { level:part.level,dx:(part.dx || 0)*part.level,dy:(part.dy || 0)*part.level,
      rotation:(part.rotate || 0)*DEG*part.level };
  }

  function drawLayer(layer) { context.drawImage(layer.image,layer.x,layer.y); }

  function drawPart(part, state) {
    const prepared = part.prepared, pivot = part.pivot || [part.bounds[0],part.bounds[1]];
    context.save();
    context.translate(pivot[0]+state.dx,pivot[1]+state.dy);
    if (part.mode === 'fold') {
      // A rigid paper panel rotates about its existing fold. Only its projected
      // width changes; the hinge and all neighbouring artwork stay fixed.
      const axis = Math.atan2(part.hinge[1]-pivot[1],part.hinge[0]-pivot[0]);
      context.rotate(axis); context.scale(1,1-(part.fold || .28)*state.level); context.rotate(-axis);
    } else context.rotate(state.rotation || 0);
    context.translate(-pivot[0],-pivot[1]);
    context.shadowColor = 'rgba(70,39,48,.19)';
    const shadowAmount = part.mode === 'roll' ? 1 : state.level;
    context.shadowBlur = (part.shadow || 0)*shadowAmount;
    context.shadowOffsetY = (part.shadow || 0)*shadowAmount;
    drawLayer(prepared.sprite);
    context.shadowColor = 'transparent'; context.shadowBlur = 0; context.shadowOffsetY = 0;
    if (part.face && state.spin != null) {
      const f = part.face;
      context.save(); context.clip(prepared.facePath);
      // A circular wooden end rotates in its own plane, projected as the SAME
      // ellipse. The spool's cylinder never turns into a flat spinning sticker.
      context.translate(f.center[0],f.center[1]); context.rotate(f.angle*DEG);
      context.scale(f.radius[0],f.radius[1]); context.rotate(state.spin);
      context.scale(1/f.radius[0],1/f.radius[1]); context.rotate(-f.angle*DEG);
      context.translate(-f.center[0],-f.center[1]);
      context.drawImage(source,0,0,WIDTH,HEIGHT); context.restore();
    }
    context.restore();
  }

  function tick(now) {
    frame = 0;
    if (dead || doc.hidden) return;
    if (reduced()) { staticFrame('reduced-motion'); return; }
    const moving = advance(now);
    if (!source || !clean || !context) { staticFrame(failed || 'loading-components'); return; }
    const active = parts.map(part => ({part,state:pose(part,now)})).filter(item => item.state);
    if (!active.length) { staticFrame(); if (moving) queue(); return; }
    const size = layout();
    if (!size) { staticFrame('scene-not-visible'); return; }
    try {
      context.setTransform(1,0,0,1,0,0); context.clearRect(0,0,size.width,size.height);
      context.setTransform(size.sx,0,0,size.sy,size.x,size.y);
      context.drawImage(source,0,0,WIDTH,HEIGHT);
      for (const {part} of active) {
        drawLayer(part.prepared.background);
        if (part.prepared.underlay) drawLayer(part.prepared.underlay);
      }
      for (const {part,state} of active) drawPart(part,state);
      for (const {part} of active) for (const occluder of part.prepared.occluders) {
        context.save(); context.clip(occluder.path); context.drawImage(source,0,0,WIDTH,HEIGHT); context.restore();
      }
      canvas.style.visibility = 'visible'; fallbackImage.style.visibility = 'hidden';
      report('canvas2d');
    } catch (error) { failed = error.message || 'Component drawing failed.'; staticFrame(); return; }
    if (moving) queue();
  }

  function setActive(id) {
    if (dead) return;
    const next = id == null ? null : String(id), changed = next !== wanted;
    wanted = parts.some(part => part.id === next) ? next : null;
    const now = win.performance.now(); advance(now);
    for (const part of parts) {
      if (part.mode === 'roll' || part.mode === 'swing') {
        if (changed && part.id === wanted && !reduced()) part.pulseStart = now;
        continue;
      }
      const target = part.id === wanted && !reduced() ? 1 : 0;
      if (target === part.target) continue;
      part.from = part.level; part.target = target; part.started = now;
      part.transition = part.duration*Math.max(.4,Math.abs(target-part.level));
    }
    if (reduced()) { reset(); staticFrame('reduced-motion'); } else queue();
  }

  function reset() {
    stop();
    for (const part of parts) { part.level = part.from = part.target = 0; part.pulseStart = null; }
  }
  function bindingActive() {
    const list = [...bindings];
    const hovered = list.slice().reverse().find(binding => binding.hovered);
    const focused = list.find(binding => binding.focused);
    setActive(hovered?.id || focused?.id || null);
  }
  function pulse(id) {
    if (dead || reduced()) return;
    if (pulseTimer) win.clearTimeout(pulseTimer);
    setActive(null); setActive(id);
    pulseTimer = win.setTimeout(() => { pulseTimer = 0; bindingActive(); },540);
  }
  function bindRegion(element, id) {
    if (dead) return () => {};
    if (!element?.addEventListener) throw new TypeError('Bind an accessible DOM button.');
    const binding = { id:String(id),hovered:false,focused:false,off:[] };
    bindings.add(binding);
    const on = (name,fn) => {
      element.addEventListener(name,fn);
      binding.off.push(() => element.removeEventListener(name,fn));
    };
    on('pointerenter',event => { if (event.pointerType !== 'touch') { binding.hovered = true; bindingActive(); } });
    const leave = () => { binding.hovered = false; bindingActive(); };
    on('pointerleave',leave); on('pointercancel',leave);
    on('pointerdown',event => { if (event.pointerType === 'touch') pulse(binding.id); });
    on('focus',() => {
      try { binding.focused = element.matches(':focus-visible'); } catch { binding.focused = true; }
      bindingActive();
    });
    on('blur',() => { binding.focused = false; bindingActive(); });
    let removed = false;
    const unbind = () => {
      if (removed) return; removed = true; binding.off.forEach(off => off()); bindings.delete(binding);
      if (!dead) bindingActive();
    };
    cleanups.push(unbind); return unbind;
  }

  function reducedChanged() {
    const selected = wanted; reset(); wanted = null;
    if (reduced()) staticFrame('reduced-motion'); else setActive(selected);
  }
  if (media?.addEventListener) listen(media,'change',reducedChanged);
  else if (media?.addListener) { media.addListener(reducedChanged); cleanups.push(() => media.removeListener(reducedChanged)); }
  listen(win,'resize',queue,{passive:true});
  listen(doc,'visibilitychange',() => {
    if (doc.hidden) { reset(); staticFrame('document-hidden'); }
    else { const selected = wanted; wanted = null; setActive(selected); }
  });
  const observer = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(queue) : null;
  observer?.observe(canvas); cleanups.push(() => observer?.disconnect());

  function load(url) {
    return new Promise((resolve,reject) => {
      if (!url) { reject(new Error('The matching clean plate is required for component movement.')); return; }
      const image = new win.Image();
      const timeout = win.setTimeout(() => reject(new Error('Scene component image timed out.')),15000);
      image.crossOrigin = 'anonymous'; image.decoding = 'async';
      image.onload = () => { win.clearTimeout(timeout); resolve(image); };
      image.onerror = () => { win.clearTimeout(timeout); reject(new Error(`Unable to load scene image: ${url}`)); };
      cleanups.push(() => { win.clearTimeout(timeout); image.onload = image.onerror = null; resolve(null); });
      image.src = url;
    });
  }
  const ready = Promise.all([load(originalUrl),load(cleanUrl)]).then(([original,plate]) => {
    if (dead) return {mode:'destroyed'};
    source = original; clean = plate; prepare();
    const selected = wanted; wanted = null; setActive(selected);
    return {mode:'canvas2d',objects:parts.length,width:WIDTH,height:HEIGHT};
  }).catch(error => {
    failed = error.message || 'Unable to prepare scene components.';
    if (!dead) staticFrame();
    return {mode:dead ? 'destroyed' : 'static',reason:failed};
  });

  return {
    ready,setActive,bindRegion,pulse,resize:queue,
    setReducedMotion(value = null) { reducedOverride = value == null ? null : !!value; reducedChanged(); },
    setObjects(next) {
      if (dead) return;
      const normalized = normalize(next); reset(); parts = normalized;
      if (source && clean) prepare();
      const selected = wanted; wanted = null; setActive(selected);
    },
    destroy() {
      if (dead) return; dead = true; stop();
      if (pulseTimer) win.clearTimeout(pulseTimer);
      cleanups.splice(0).forEach(off => off()); parts.forEach(part => { part.prepared = null; });
      context = source = clean = null;
      canvas.style.visibility = prior.canvasVisibility; canvas.style.pointerEvents = prior.canvasPointer; canvas.hidden = prior.canvasHidden;
      fallbackImage.style.visibility = prior.imageVisibility; fallbackImage.style.pointerEvents = prior.imagePointer; fallbackImage.hidden = prior.imageHidden;
    },
  };
}

// Compatibility for hosts that retain the previous controller function name.
export { mountObjectMotion as mountSceneMotion };
