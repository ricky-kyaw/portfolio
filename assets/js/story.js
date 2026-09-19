// The Story page: nine fullscreen slides over live voxel scenes.
//
// Without JavaScript the page is a plain scrolling article with a picture per
// chapter. With it, the chapters become slides: on-screen arrows, the arrow
// keys and a swipe move between them; you can drag the scene to look around;
// and on the Loikaw slides, press and hold to see the town clearly.

import { Renderer } from './voxel/engine.js';
import { SCENES, MOODS } from './voxel/scenes.js';
import { applyPixelText } from './pixelfont.js';

export function initStory(main) {
  const deck = main.querySelector('[data-deck]');
  const canvas = deck && deck.querySelector('canvas');
  const slides = deck ? [...deck.querySelectorAll('.slide')] : [];
  if (!deck || !canvas || !slides.length) return null;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const coarse = matchMedia('(pointer: coarse)');
  const ui = {
    prev: deck.querySelector('[data-prev]'), next: deck.querySelector('[data-next]'),
    ticks: deck.querySelector('.deck-ticks'), rotate: deck.querySelector('[data-rotate]'),
    look: deck.querySelector('[data-look]'), clear: deck.querySelector('[data-clear]'),
  };
  const status = document.getElementById('status');
  const renderer = new Renderer(canvas);
  if (!renderer.ctx) return null; // no drawing surface: the page stays a plain article
  const built = {};
  const cam = { yaw: 0, pitch: 0.56, zoom: 1, shiftX: 0, shiftY: 0 };

  let index = -1;
  let scene = null, mood = null;
  let clarity = 0, clarityTarget = 0;
  let rotating = !reduced.matches && !coarse.matches;
  let rotateSince = performance.now();
  let looking = false;          // touch devices: drag orbits instead of swiping
  let velocity = 0;             // leftover spin after a drag
  let dirty = true;
  let fitScale = 1, slideZoom = 1; // the window's share of the zoom, and the slide's
  const applyZoom = () => { cam.zoom = slideZoom * fitScale; };
  let raf = 0, last = 0, alive = true;
  let swapTimer = 0, sayTimer = 0;

  // ---------- size: one scene pixel is always a whole number of screen pixels ----------
  function fit() {
    const rect = deck.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    // one scene pixel is about one CSS pixel (two on big windows), and never more than the budget below
    let k = Math.max(1, Math.round((rect.width >= 1140 ? 2 : 1) * dpr));
    while (((rect.width * dpr) / k) * ((rect.height * dpr) / k) > 900000) k++;
    const W = Math.ceil((rect.width * dpr) / k), H = Math.ceil((rect.height * dpr) / k);
    renderer.resize(W, H);
    canvas.style.width = (W * k) / dpr + 'px';
    canvas.style.height = (H * k) / dpr + 'px';
    // keep the whole model on screen: shrink it on short, wide windows and when it is moved aside
    // (on a narrow screen the edges of the ground may run off the sides; the landmarks stay in view)
    fitScale = Math.min(1, H / (W * 0.58)) * (rect.width >= 900 ? 0.82 : rect.width < 600 ? 1.2 : 1);
    applyZoom();
    place();
    dirty = true;
    if (scene) draw(); // sizing a canvas wipes it; do not leave it blank for a frame
  }

  // Wide screens: the text sits bottom-left, so the model moves right.
  // Narrow screens: the text fills the bottom, so the model sits in the space above it.
  function place() {
    const rect = deck.getBoundingClientRect();
    if (!rect.height) return;
    if (rect.width >= 900) { cam.shiftX = 0.1; cam.shiftY = 0; return; }
    const body = slides[index] && slides[index].querySelector('.slide-body');
    const top = body ? body.getBoundingClientRect().top - rect.top : rect.height * 0.6;
    const middle = (56 + Math.max(160, top)) / 2;
    cam.shiftX = 0;
    cam.shiftY = Math.max(-0.4, Math.min(0, middle / rect.height - 0.64 + 0.07));
  }

  function sceneFor(name) {
    if (!built[name]) built[name] = SCENES[name]();
    return built[name];
  }

  // ---------- drawing ----------
  function draw() {
    if (!scene) return;
    renderer.render(scene, cam, mood, clarity);
    dirty = false;
  }

  function frame(now) {
    raf = 0;
    if (!alive) return;
    const dt = Math.min(0.1, (now - last) / 1000 || 0);
    if (now - last < 30) { schedule(); return; } // about 30 frames a second is plenty
    last = now;

    if (rotating && !dragging) {
      if (now - rotateSince < 25000) { cam.yaw += dt * 0.07; dirty = true; }
      else setRotating(false); // it has turned long enough; the button offers to turn it again
    }
    if (Math.abs(velocity) > 0.0005 && !dragging) { cam.yaw += velocity; velocity *= 0.9; dirty = true; }
    if (clarity !== clarityTarget) {
      const step = reduced.matches ? 1 : dt * 2.6;
      clarity = clarityTarget > clarity ? Math.min(clarityTarget, clarity + step) : Math.max(clarityTarget, clarity - step);
      dirty = true;
    }
    if (dirty) draw();
    if (wantsFrames()) schedule();
  }
  const wantsFrames = () => alive && !document.hidden && (dirty || dragging || clarity !== clarityTarget || Math.abs(velocity) > 0.0005 || (rotating && performance.now() - rotateSince < 25000));
  function schedule() { if (!raf && alive) raf = requestAnimationFrame(frame); }
  function wake() { dirty = true; schedule(); }

  // ---------- slides ----------
  function paintTicks() {
    if (!ui.ticks) return;
    ui.ticks.textContent = '';
    slides.forEach((_, i) => {
      const t = document.createElement('span');
      if (i === index) t.className = 'is-on';
      ui.ticks.appendChild(t);
    });
  }

  function go(i, { announce = true, focus = false, write = true } = {}) {
    i = Math.max(0, Math.min(slides.length - 1, i));
    if (i === index) return;
    // If the keyboard focus sits in the slide that is about to go quiet, carry it to the new one.
    const leaving = slides[index];
    if (leaving && leaving.contains(document.activeElement)) focus = true;
    index = i;
    const s = slides[i];
    slides.forEach((el, k) => {
      const on = k === i;
      el.classList.toggle('is-active', on);
      if (on) el.removeAttribute('inert'); else el.setAttribute('inert', '');
    });
    // aria-disabled, not disabled: a disabled button would drop the keyboard focus it is holding
    if (ui.prev) ui.prev.setAttribute('aria-disabled', String(i === 0));
    if (ui.next) ui.next.setAttribute('aria-disabled', String(i === slides.length - 1));
    paintTicks();

    const swap = () => {
      swapTimer = 0;
      const s = slides[index]; // the newest slide, however many changes were asked for meanwhile
      scene = sceneFor(s.dataset.scene);
      mood = MOODS[s.dataset.mood] || MOODS['loikaw-day'];
      cam.yaw = scene.start.yaw + Number(s.dataset.yaw || 0);
      cam.pitch = scene.start.pitch + Number(s.dataset.pitch || 0);
      slideZoom = Number(s.dataset.zoom || 1);
      applyZoom();
      place();
      clarity = clarityTarget = 0;
      velocity = 0;
      rotateSince = performance.now();
      draw();
      canvas.classList.remove('is-swapping');
      schedule();
    };
    clearTimeout(swapTimer);
    if (scene && !reduced.matches) { canvas.classList.add('is-swapping'); swapTimer = setTimeout(() => alive && swap(), 190); } else swap();

    const canHold = s.hasAttribute('data-hold');
    if (ui.clear) { ui.clear.hidden = !canHold; ui.clear.setAttribute('aria-pressed', 'false'); }
    if (looking) setLooking(false);

    if (write) {
      try { history.replaceState(history.state, '', '#' + s.id); } catch (e) { /* fine */ }
    }
    const title = s.querySelector('.slide-title');
    const label = `Slide ${i + 1} of ${slides.length}` + (title ? `. ${title.textContent.trim()}` : '');
    if (focus) {
      const target = s.querySelector('.slide-plate');
      if (target) { target.setAttribute('tabindex', '-1'); target.focus({ preventScroll: true }); }
    } else if (announce && status) {
      status.textContent = '';
      clearTimeout(sayTimer);
      sayTimer = setTimeout(() => { if (alive) status.textContent = label; }, 30);
    }
  }

  // The slide a "#slide-N" address names, or -1 when the hash is about something else (the skip link, say).
  const fromHash = () => {
    const m = /^#slide-(\d+)$/.exec(location.hash);
    return m ? Math.max(0, Math.min(slides.length - 1, Number(m[1]) - 1)) : -1;
  };

  // ---------- tools ----------
  function setRotating(on) {
    rotating = on;
    rotateSince = performance.now();
    if (ui.rotate) { ui.rotate.textContent = on ? 'pause' : 'turn'; ui.rotate.setAttribute('aria-label', on ? 'Pause the slow turn' : 'Turn the scene slowly'); }
    wake();
  }
  function setLooking(on) {
    looking = on;
    deck.classList.toggle('is-looking', on);
    if (ui.look) { ui.look.textContent = on ? 'done' : 'look around'; ui.look.setAttribute('aria-pressed', String(on)); }
  }
  function setClear(on) {
    clarityTarget = on ? 1 : 0;
    if (ui.clear) ui.clear.setAttribute('aria-pressed', String(on));
    wake();
  }

  // ---------- pointer: drag to look around, swipe to change slide, hold to see clearly ----------
  let dragging = false, pointerId = null, startX = 0, startY = 0, lastX = 0, lastY = 0, startT = 0, moved = 0, holdTimer = 0, holding = false;
  const interactive = (t) => t.closest && t.closest('a, button, .slide-plate, .deck-tools, .deck-nav');

  function onDown(e) {
    if (interactive(e.target) || (e.pointerType === 'mouse' && e.button !== 0)) return;
    pointerId = e.pointerId; startX = lastX = e.clientX; startY = lastY = e.clientY; startT = performance.now(); moved = 0;
    const orbit = e.pointerType !== 'touch' || looking;
    dragging = orbit;
    if (orbit) { try { deck.setPointerCapture(e.pointerId); } catch (err) { /* fine */ } deck.classList.add('is-dragging'); }
    if (slides[index] && slides[index].hasAttribute('data-hold')) {
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => { if (moved < 8) { holding = true; setClear(true); } }, 300);
    }
  }
  function onMove(e) {
    if (e.pointerId !== pointerId) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    moved = Math.max(moved, Math.hypot(e.clientX - startX, e.clientY - startY));
    lastX = e.clientX; lastY = e.clientY;
    if (!dragging) return;
    if (rotating) setRotating(false); // once you take hold of it, it stops turning by itself
    cam.yaw -= dx * 0.006;
    cam.pitch = Math.max(0.36, Math.min(0.95, cam.pitch + dy * 0.004));
    velocity = -dx * 0.006 * 0.5;
    wake();
  }
  function onUp(e) {
    if (e.pointerId !== pointerId) return;
    clearTimeout(holdTimer);
    const dx = e.clientX - startX, dy = e.clientY - startY;
    const quick = performance.now() - startT < 700;
    if (e.type === 'pointerup' && !dragging && !holding && quick && Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) go(index + (dx < 0 ? 1 : -1));
    if (holding) { holding = false; setClear(false); }
    if (reduced.matches) velocity = 0;
    dragging = false; pointerId = null;
    deck.classList.remove('is-dragging');
    schedule();
  }

  // ---------- keyboard ----------
  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    const r = deck.getBoundingClientRect();
    if (r.bottom < 80 || r.top > innerHeight - 80) return; // the deck is not on screen
    let to = null;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') to = index + 1;
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') to = index - 1;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = slides.length - 1;
    if (to === null) return;
    to = Math.max(0, Math.min(slides.length - 1, to));
    if (to === index) return; // at either end the key keeps its usual job (scrolling)
    if (document.querySelector('.site-nav.is-open')) return; // the phone menu is open over the deck
    e.preventDefault();
    go(to);
  }

  const onHash = () => { const i = fromHash(); if (i >= 0) go(i, { focus: true, write: false }); };
  const onVisible = () => { if (!document.hidden) wake(); };
  const onContext = (e) => { if (!interactive(e.target)) e.preventDefault(); };
  const onClick = (e) => {
    const b = e.target.closest('button');
    if (!b || !deck.contains(b)) return;
    if (b.getAttribute('aria-disabled') === 'true') return;
    if (b === ui.prev) go(index - 1);
    else if (b === ui.next) go(index + 1);
    else if (b === ui.rotate) setRotating(!rotating);
    else if (b === ui.look) setLooking(!looking);
    else if (b === ui.clear) setClear(clarityTarget === 0); // keyboard and switch users toggle it
  };

  const ro = 'ResizeObserver' in window ? new ResizeObserver(() => { fit(); schedule(); }) : null;
  const deckEvents = [['pointerdown', onDown], ['pointermove', onMove], ['pointerup', onUp], ['pointercancel', onUp], ['contextmenu', onContext], ['click', onClick]];
  // older Safari only knows addListener
  const watch = (mq, fn, on) => {
    if (mq.addEventListener) mq[on ? 'addEventListener' : 'removeEventListener']('change', fn);
    else if (mq.addListener) mq[on ? 'addListener' : 'removeListener'](fn);
  };

  // Touch screens get a "look around" switch (a drag there means swipe); the slow turn is for mice only.
  const syncTools = () => {
    if (ui.look) ui.look.hidden = !coarse.matches;
    if (ui.rotate) ui.rotate.hidden = coarse.matches || reduced.matches;
    if (coarse.matches || reduced.matches) rotating = false;
    if (!coarse.matches && looking) setLooking(false);
    setRotating(rotating);
    fit();
  };

  function destroy() {
    alive = false;
    cancelAnimationFrame(raf);
    clearTimeout(holdTimer); clearTimeout(swapTimer); clearTimeout(sayTimer);
    deckEvents.forEach(([type, fn]) => deck.removeEventListener(type, fn));
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('hashchange', onHash);
    window.removeEventListener('resize', fit);
    if (ro) ro.disconnect();
    watch(coarse, syncTools, false);
    watch(reduced, syncTools, false);
  }

  try {
    applyPixelText(deck);
    deckEvents.forEach(([type, fn]) => deck.addEventListener(type, fn));
    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('hashchange', onHash);
    if (ro) ro.observe(deck); else window.addEventListener('resize', fit);
    watch(coarse, syncTools, true);
    watch(reduced, syncTools, true);
    deck.classList.add('is-live');
    syncTools();
    go(Math.max(0, fromHash()), { announce: false, focus: fromHash() >= 0, write: false });
  } catch (e) {
    // Put the page back the way a plain article expects it, then let main.js report the failure.
    destroy();
    deck.classList.remove('is-live');
    slides.forEach((el) => { el.removeAttribute('inert'); el.classList.remove('is-active'); });
    throw e;
  }

  // ---------- dev only: save one picture per slide for the no-script page ----------
  if (/[?&]capture=1/.test(location.search) && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) capture();
  async function capture() {
    rotating = false;
    const off = document.createElement('canvas');
    const r2 = new Renderer(off);
    r2.resize(720, 405);
    for (let i = 0; i < slides.length; i++) {
      const s = slides[i], sc = sceneFor(s.dataset.scene);
      const c = { yaw: sc.start.yaw + Number(s.dataset.yaw || 0), pitch: sc.start.pitch + Number(s.dataset.pitch || 0), zoom: Number(s.dataset.zoom || 1) * 0.82, shiftX: 0, shiftY: 0.08 };
      r2.render(sc, c, MOODS[s.dataset.mood], 0);
      const blob = await new Promise((ok) => off.toBlob(ok, 'image/png'));
      await fetch(`/__capture/slide-${i + 1}.png`, { method: 'POST', body: blob });
    }
    document.title = 'captured';
  }

  return { destroy };
}
