import { G } from './state.js';

const down = new Set();
const pressedSet = new Set();
const mDown = [false, false, false];
const mPressed = [false, false, false];
let dx = 0, dy = 0, wheel = 0;

export const input = {
  locked: false,
  down: (c) => down.has(c),
  pressed: (c) => pressedSet.has(c),
  mouse: (b) => mDown[b],
  mousePressed: (b) => mPressed[b],
  takeMouse() { const r = [dx, dy]; dx = 0; dy = 0; return r; },
  takeWheel() { const w = wheel; wheel = 0; return w; },
  endFrame() { pressedSet.clear(); mPressed[0] = mPressed[1] = mPressed[2] = false; },
  axis() {
    let x = 0, y = 0;
    if (down.has('KeyA') || down.has('ArrowLeft')) x -= 1;
    if (down.has('KeyD') || down.has('ArrowRight')) x += 1;
    if (down.has('KeyW') || down.has('ArrowUp')) y += 1;
    if (down.has('KeyS') || down.has('ArrowDown')) y -= 1;
    return { x, y };
  },
  init(canvas) {
    window.addEventListener('keydown', (e) => {
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!down.has(e.code)) pressedSet.add(e.code);
      down.add(e.code);
    });
    window.addEventListener('keyup', (e) => down.delete(e.code));
    window.addEventListener('blur', () => { down.clear(); mDown[0] = mDown[1] = mDown[2] = false; });
    canvas.addEventListener('mousedown', (e) => {
      if (!input.locked && G.started && !G.paused && !G.modal) { canvas.requestPointerLock?.(); }
      mDown[e.button] = true; mPressed[e.button] = true;
    });
    window.addEventListener('mouseup', (e) => { mDown[e.button] = false; });
    window.addEventListener('mousemove', (e) => {
      if (input.locked) { dx += e.movementX; dy += e.movementY; }
    });
    window.addEventListener('wheel', (e) => { wheel += Math.sign(e.deltaY); }, { passive: true });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      input.locked = document.pointerLockElement === canvas;
      if (!input.locked && G.started && !G.modal && !G.dead) G.onUnlock?.();
    });
    input.canvas = canvas;
  },
  setKey(code, v) { if (v) { if (!down.has(code)) pressedSet.add(code); down.add(code); } else down.delete(code); },
  setMouse(b, v) { if (v && !mDown[b]) mPressed[b] = true; mDown[b] = v; },
  lock() { input.canvas.requestPointerLock?.(); },
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); },
};
