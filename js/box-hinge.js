/** A two-sided paper lid rotating around the box's fixed rear edge. */
export function initBoxHinge(stage) {
  if (!stage?.querySelector) throw new TypeError('A theatre stage element is required.');
  const outer = stage.querySelector('[data-box-outer]');
  const inner = stage.querySelector('[data-box-inner]');
  if (!outer || !inner) throw new TypeError('The box needs its outer and inner lid faces.');

  const win = stage.ownerDocument.defaultView;
  const vector = (value, fallback) => {
    const values = String(value || '').trim().split(/[\s,]+/).map(Number);
    return values.length === 2 && values.every(Number.isFinite) ? values : fallback;
  };
  const positive = (value, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  };
  const origin = vector(stage.dataset.boxHingeOrigin, [508, 703]);
  const hinge = vector(stage.dataset.boxHingeVector, [189, -48]);
  const depth = vector(stage.dataset.boxClosedDepth, [130, 42]);
  const rise = vector(stage.dataset.boxOpeningRise, [0, -148]);
  const openAngle = positive(stage.dataset.boxOpenAngle, 100) * Math.PI / 180;
  const duration = positive(stage.dataset.boxDuration, 560);
  const imageScale = 1672 / 1670;
  const source = (element, fallback) => ({
    origin: vector(element.dataset.boxSourceOrigin, fallback.origin),
    hinge: vector(element.dataset.boxSourceHinge, fallback.hinge),
    depth: vector(element.dataset.boxSourceDepth, fallback.depth),
  });
  const outside = source(outer, {
    origin: [506, 684], hinge: [177, -46], depth: [131, 43],
  });
  const inside = source(inner, {
    origin: [535 * imageScale, 707],
    hinge: [185 * imageScale, -42],
    depth: [43 * imageScale, -155],
  });
  const determinant = ([x, y], [u, v]) => x * v - y * u;
  for (const face of [outside, inside]) {
    if (Math.abs(determinant(face.hinge, face.depth)) < 1e-6) {
      throw new RangeError('A lid source face must have a nonzero area.');
    }
  }
  // The face changes when its projected plane becomes edge-on, before 90°.
  const closedArea = determinant(hinge, depth);
  const raisedArea = determinant(hinge, rise);
  const swapAngle = Math.atan2(closedArea, -raisedArea);
  const halfBlend = 0.7 * Math.PI / 180;
  const reducedMotion = win.matchMedia('(prefers-reduced-motion: reduce)');
  const isOpen = () => stage.dataset.active === 'tarot';
  let angle = isOpen() ? openAngle : 0;
  let target = angle;
  let startAngle = angle;
  let started = 0;
  let travelDuration = duration;
  let frame = 0;
  let destroyed = false;

  function matrix(face, projectedDepth) {
    const [sx, sy] = face.origin;
    const [ux, uy] = face.hinge;
    const [vx, vy] = face.depth;
    const [tx, ty] = hinge;
    const [dx, dy] = projectedDepth;
    const det = ux * vy - uy * vx;
    const a = (tx * vy - dx * uy) / det;
    const b = (ty * vy - dy * uy) / det;
    const c = (-tx * vx + dx * ux) / det;
    const d = (-ty * vx + dy * ux) / det;
    const e = origin[0] - a * sx - c * sy;
    const f = origin[1] - b * sx - d * sy;
    return `matrix(${[a, b, c, d, e, f].map(n => n.toFixed(8)).join(' ')})`;
  }

  function paint() {
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const projectedDepth = [
      depth[0] * cosine + rise[0] * sine,
      depth[1] * cosine + rise[1] * sine,
    ];
    outer.setAttribute('transform', matrix(outside, projectedDepth));
    inner.setAttribute('transform', matrix(inside, projectedDepth));
    const insideOpacity = Math.max(0, Math.min(1,
      (angle - swapAngle + halfBlend) / (halfBlend * 2)));
    outer.setAttribute('opacity', String(1 - insideOpacity));
    inner.setAttribute('opacity', String(insideOpacity));
  }

  function cancelFrame() {
    if (frame) win.cancelAnimationFrame(frame);
    frame = 0;
  }

  function sample(now) {
    const fraction = Math.min(1, Math.max(0, (now - started) / travelDuration));
    const eased = 1 - Math.pow(1 - fraction, 3);
    angle = startAngle + (target - startAngle) * eased;
    if (fraction === 1) angle = target;
    paint();
    return fraction === 1;
  }

  function tick(now) {
    frame = 0;
    if (destroyed) return;
    if (!sample(now)) frame = win.requestAnimationFrame(tick);
  }

  function moveTo(next, immediate = false) {
    if (destroyed) return;
    const now = win.performance.now();
    // Sample the old trajectory first so quick hover reversals never jump.
    if (frame) sample(now);
    if (next === target && !immediate && !reducedMotion.matches) return;
    cancelFrame();
    target = next;
    if (immediate || reducedMotion.matches || Math.abs(angle - target) < 1e-5) {
      angle = target;
      paint();
      return;
    }
    startAngle = angle;
    started = now;
    travelDuration = Math.max(100, duration * Math.abs(target - angle) / openAngle);
    frame = win.requestAnimationFrame(tick);
  }

  const observer = new win.MutationObserver(() => moveTo(isOpen() ? openAngle : 0));
  observer.observe(stage, { attributes: true, attributeFilter: ['data-active'] });
  const motionPreferenceChanged = () => moveTo(isOpen() ? openAngle : 0, true);
  reducedMotion.addEventListener('change', motionPreferenceChanged);
  paint();

  return {
    reset() { moveTo(0, true); },
    destroy() {
      if (destroyed) return;
      observer.disconnect();
      reducedMotion.removeEventListener('change', motionPreferenceChanged);
      cancelFrame();
      angle = 0;
      paint();
      destroyed = true;
    },
  };
}
