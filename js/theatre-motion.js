/** Small paper-object gestures for the homepage; tool contents stay independent. */
export function initTheatreMotion(stage, { onActivate } = {}) {
  if (!stage?.querySelectorAll) throw new TypeError('A theatre stage element is required.');

  const doc = stage.ownerDocument;
  const win = doc.defaultView;
  const lifetime = new AbortController();
  const buttons = [...stage.querySelectorAll('.hotspot[data-tool]')];
  const birdButton = buttons.find(button => button.dataset.tool === 'inspiration');
  let hovered = null;
  let focused = null;
  let keyboardMode = true;
  let pull = null;
  let pendingClick = null;
  let destroyed = false;

  function listen(target, type, listener, options = {}) {
    target?.addEventListener(type, listener, { ...options, signal: lifetime.signal });
  }

  function numberProperty(name, fallback) {
    const value = Number.parseFloat(win.getComputedStyle(stage).getPropertyValue(name));
    return Number.isFinite(value) ? value : fallback;
  }

  function activeButton() {
    if (pull) return pull.button;
    return keyboardMode ? (focused || hovered) : hovered;
  }

  function updateActive() {
    const button = activeButton();
    if (button) stage.dataset.active = button.dataset.tool;
    else delete stage.dataset.active;
  }

  function setPull(distance, stringLength) {
    stage.style.setProperty('--bird-pull', `${distance.toFixed(2)}px`);
    stage.style.setProperty('--bird-string-scale', String(1 + distance / Math.max(1, stringLength)));
  }

  function refreshStringScale() {
    const length = numberProperty('--bird-string-length', 220);
    const hover = numberProperty('--bird-hover', 16);
    stage.style.setProperty('--bird-string-hover-scale', String(1 + hover / Math.max(1, length)));
  }

  function releaseCapture(current) {
    try {
      if (current?.button.hasPointerCapture?.(current.pointerId)) {
        current.button.releasePointerCapture(current.pointerId);
      }
    } catch { /* The browser may already have released a cancelled pointer. */ }
  }

  function reset() {
    const current = pull;
    pull = null;
    hovered = null;
    focused = null;
    stage.classList.remove('is-pulling');
    stage.style.removeProperty('--bird-pull');
    stage.style.removeProperty('--bird-string-scale');
    delete stage.dataset.active;
    releaseCapture(current);
  }

  function pointerMove(event) {
    if (!pull || event.pointerId !== pull.pointerId) return;
    pull.dx = (event.clientX - pull.startX) * pull.unitsPerPixel;
    pull.dy = (event.clientY - pull.startY) * pull.unitsPerPixel;
    pull.moved ||= Math.hypot(event.clientX - pull.startX, event.clientY - pull.startY) >= 6;
    const distance = Math.max(0, Math.min(pull.maximum, pull.hoverDistance + pull.dy));
    setPull(distance, pull.stringLength);
    if (pull.moved) event.preventDefault();
  }

  function endPull(event, cancelled = false) {
    if (!pull || event.pointerId !== pull.pointerId) return;
    if (!cancelled) pointerMove(event);
    const current = pull;
    pull = null;

    if (current.moved) {
      pendingClick = { button: current.button, until: Date.now() + 650 };
      event.preventDefault();
    }

    stage.classList.remove('is-pulling');
    stage.style.removeProperty('--bird-pull');
    stage.style.removeProperty('--bird-string-scale');
    releaseCapture(current);

    const deliberate = !cancelled && current.moved && current.dy >= current.threshold
      && Math.abs(current.dx) <= Math.max(40, current.dy * 1.7);
    if (deliberate) {
      hovered = null;
      focused = null;
      updateActive();
      if (onActivate) onActivate('inspiration', current.button);
      else current.button.click();
      return;
    }

    if (event.pointerType !== 'mouse') hovered = null;
    else {
      const bounds = current.button.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right
          || event.clientY < bounds.top || event.clientY > bounds.bottom) hovered = null;
    }
    updateActive();
  }

  for (const button of buttons) {
    listen(button, 'pointerenter', event => {
      if (event.pointerType === 'touch' || pull) return;
      keyboardMode = false;
      focused = null;
      hovered = button;
      if (button === birdButton) refreshStringScale();
      updateActive();
    });
    listen(button, 'pointerleave', () => {
      if (hovered === button) hovered = null;
      if (!pull) updateActive();
    });
    listen(button, 'focus', () => {
      if (!keyboardMode) return;
      focused = button;
      if (button === birdButton) refreshStringScale();
      updateActive();
    });
    listen(button, 'blur', () => {
      if (focused === button) focused = null;
      if (!pull) updateActive();
    });
  }

  listen(doc, 'keydown', event => {
    if (event.key === 'Tab' || event.key === 'Enter' || event.key === ' '
        || event.key.startsWith('Arrow')) {
      keyboardMode = true;
      if (buttons.includes(doc.activeElement)) focused = doc.activeElement;
      updateActive();
    }
    if (event.key === 'Escape' && pull) {
      pendingClick = { button: pull.button, until: Date.now() + 650 };
      reset();
    }
  }, { capture: true });

  listen(doc, 'pointerdown', () => {
    keyboardMode = false;
    focused = null;
    if (!pull) updateActive();
  }, { capture: true });

  listen(stage, 'pointerleave', () => {
    hovered = null;
    if (!pull) updateActive();
  });

  // A completed drag must not also run the button's ordinary click handler.
  // Native keyboard and programmatic clicks have no pointer gesture and stay usable.
  listen(stage, 'click', event => {
    if (!pendingClick || Date.now() > pendingClick.until) { pendingClick = null; return; }
    const button = event.target.closest?.('.hotspot[data-tool]');
    const pointerClick = event.detail > 0 || !!event.pointerType;
    if (button === pendingClick.button && pointerClick) {
      pendingClick = null;
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, { capture: true });

  if (birdButton) {
    listen(birdButton, 'pointerdown', event => {
      if (pull || event.isPrimary === false || event.button !== 0) return;
      const bounds = stage.getBoundingClientRect();
      if (!bounds.width) return;
      const viewBox = stage.querySelector('.scene-overlay')?.viewBox?.baseVal;
      const viewWidth = viewBox?.width || 2048;
      const stringLength = numberProperty('--bird-string-length', 220);
      const hoverDistance = event.pointerType === 'mouse' ? numberProperty('--bird-hover', 16) : 0;
      pull = {
        button: birdButton,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        unitsPerPixel: viewWidth / bounds.width,
        stringLength,
        hoverDistance,
        maximum: Math.max(1, numberProperty('--bird-max-pull', 85)),
        threshold: Math.max(1, numberProperty('--bird-pull-threshold', 20)),
        dx: 0, dy: 0, moved: false,
      };
      pendingClick = null;
      stage.classList.add('is-pulling');
      setPull(hoverDistance, stringLength);
      updateActive();
      try { birdButton.setPointerCapture(event.pointerId); } catch { /* Pointer may have ended. */ }
    });
    listen(birdButton, 'pointermove', pointerMove);
    listen(birdButton, 'pointerup', event => endPull(event));
    listen(birdButton, 'pointercancel', event => endPull(event, true));
    listen(birdButton, 'lostpointercapture', event => {
      if (pull?.pointerId === event.pointerId) endPull(event, true);
    });
    listen(birdButton, 'dragstart', event => event.preventDefault());
  }

  listen(win, 'blur', reset);
  listen(doc, 'visibilitychange', () => { if (doc.hidden) reset(); });

  return {
    reset,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      lifetime.abort();
      reset();
      pendingClick = null;
      stage.style.removeProperty('--bird-string-hover-scale');
    },
  };
}
