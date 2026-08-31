(() => {
  'use strict';

  // ---------------------------------------------------------------
  // Palette
  // ---------------------------------------------------------------
  const COLOR = {
    magenta: '#D840B8',
    teal: '#60D0C0',
    yellow: '#F8E060',
    ink: '#101018',
    inkLine: '#05050a',
    paper: '#e9e6da',
  };

  // ---------------------------------------------------------------
  // Board geometry
  // ---------------------------------------------------------------
  const BOARD_W = 440;
  const BOARD_H = 760;
  const WALL = 14;
  const DIVIDER_X = 372;      // wall separating the plunger lane from the play field
  const DIVIDER_TOP_Y = 220;  // gap above the divider the launched ball must clear
  const LANE_CENTER_X = 401;
  const LANE_FLOOR_Y = 750;

  const BUMPERS = [
    { x: 132, y: 176, n: 3, color: 'magenta' },
    { x: 292, y: 176, n: 5, color: 'teal' },
    { x: 212, y: 252, n: 7, color: 'magenta' },
    { x: 118, y: 344, n: 2, color: 'teal' },
    { x: 302, y: 344, n: 4, color: 'magenta' },
    { x: 212, y: 430, n: 9, color: 'teal' },
  ];
  const BUMPER_RADIUS = 25;

  const RAMPS = [
    { x: 60, y: 74, w: 24, h: 96, angle: -0.6 },
    { x: 377, y: 123, w: 210, h: 14, angle: 1.106, vector: true }, // lane-entry guide: deflects a launched ball off the top of the plunger lane into the field
    { x: 150, y: 560, w: 34, h: 170, angle: -0.22 },
    { x: 300, y: 640, w: 30, h: 130, angle: 0.35 },
  ];

  const TARGET_STEP = 2200;
  const TARGET_BASE = 2800;

  // ---------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------
  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const scoreValueEl = document.getElementById('scoreValue');
  const targetFillEl = document.getElementById('targetFill');
  const targetLabelEl = document.getElementById('targetLabel');
  const ballCountEl = document.getElementById('ballCount');
  const hintEl = document.getElementById('hintLine');
  const vaultEl = document.getElementById('vault');
  const vaultGlowEl = document.getElementById('vaultGlow');

  // ---------------------------------------------------------------
  // Responsive board sizing
  // ---------------------------------------------------------------
  // The board's CSS default just scales its 440x760 (tall) aspect ratio to
  // the container's *width*, with no regard for viewport height. On a phone
  // that stretches the board taller than the screen, pushing the plunger
  // lane at the bottom of the board below the visible viewport. Measure the
  // page's actual overflow (if any) against the viewport and shrink the
  // board by exactly that much, so header + board + hint always fit on
  // screen together and nothing renders off-screen.
  let sizeBoardQueued = false;

  function sizeBoard() {
    sizeBoardQueued = false;

    // Clear any previous inline size so we measure the CSS-driven natural
    // layout first (also lets the board grow back if the viewport grows,
    // e.g. rotating back to landscape or the mobile URL bar collapsing).
    canvas.style.width = '';
    canvas.style.height = '';

    const viewportH = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    const rect = canvas.getBoundingClientRect();
    // Only care whether the board's own bottom edge (where the plunger
    // lane lives) clears the viewport — content below the board, like the
    // "how to play" legend, is fine to be off-screen/scrollable.
    const overflow = rect.bottom - viewportH;
    if (overflow <= 0) return; // the board already fits

    const targetHeight = Math.max(240, rect.height - overflow - 8); // small safety margin
    const targetWidth = targetHeight * (BOARD_W / BOARD_H);

    canvas.style.width = `${targetWidth}px`;
    canvas.style.height = `${targetHeight}px`;
  }

  function queueSizeBoard() {
    if (sizeBoardQueued) return;
    sizeBoardQueued = true;
    requestAnimationFrame(sizeBoard);
  }

  sizeBoard();
  window.addEventListener('load', queueSizeBoard);
  window.addEventListener('resize', queueSizeBoard);
  window.addEventListener('orientationchange', queueSizeBoard);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', queueSizeBoard);
  }

  // ---------------------------------------------------------------
  // Asset loading
  // ---------------------------------------------------------------
  const IMG_SOURCES = {
    ball: 'assets/ball.png',
    platform: 'assets/platform.png',
    platformNarrow: 'assets/platform_narrow.png',
    n0: 'assets/number_0.png', n1: 'assets/number_1.png', n2: 'assets/number_2.png',
    n3: 'assets/number_3.png', n4: 'assets/number_4.png', n5: 'assets/number_5.png',
    n6: 'assets/number_6.png', n7: 'assets/number_7.png', n8: 'assets/number_8.png',
    n9: 'assets/number_9.png',
  };

  function loadImages(sources) {
    const entries = Object.entries(sources);
    const images = {};
    return Promise.all(entries.map(([key, src]) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { images[key] = img; resolve(); };
      img.onerror = () => resolve(); // fail soft; missing art shouldn't block the game
      img.src = src;
    }))).then(() => images);
  }

  // Recolors a sprite's opaque pixels to an exact hex color, keeping its alpha shape.
  function tint(img, hex) {
    if (!img) return null;
    const off = document.createElement('canvas');
    off.width = img.naturalWidth || img.width;
    off.height = img.naturalHeight || img.height;
    const octx = off.getContext('2d');
    octx.drawImage(img, 0, 0);
    octx.globalCompositeOperation = 'source-atop';
    octx.fillStyle = hex;
    octx.fillRect(0, 0, off.width, off.height);
    return off;
  }

  // ---------------------------------------------------------------
  // Matter.js setup
  // ---------------------------------------------------------------
  const { Bodies, Body, Events, Runner, Engine, World } = Matter;
  const engine = Engine.create();
  engine.gravity.y = 0.85;
  const world = engine.world;

  function wall(x, y, w, h) {
    return Bodies.rectangle(x, y, w, h, { isStatic: true, restitution: 0.4, friction: 0.05 });
  }

  const boundaries = [
    wall(WALL / 2, BOARD_H / 2, WALL, BOARD_H * 2),                     // left
    wall(BOARD_W - WALL / 2, BOARD_H / 2, WALL, BOARD_H * 2),           // right
    wall(BOARD_W / 2, WALL / 2, BOARD_W, WALL),                        // top
    wall(DIVIDER_X, (DIVIDER_TOP_Y + BOARD_H) / 2, 8, BOARD_H - DIVIDER_TOP_Y), // lane divider
    wall(LANE_CENTER_X, LANE_FLOOR_Y, 54, 10),                          // lane floor
  ];
  World.add(world, boundaries);

  const bumperBodies = BUMPERS.map((b) => {
    const body = Bodies.circle(b.x, b.y, BUMPER_RADIUS, {
      isStatic: true,
      restitution: 1.05,
      label: 'bumper',
    });
    body.bumperData = { ...b, radius: BUMPER_RADIUS, flashAt: -1000, lastHit: -1000 };
    return body;
  });
  World.add(world, bumperBodies);

  const rampBodies = RAMPS.map((r) => {
    const body = Bodies.rectangle(r.x, r.y, r.w, r.h, {
      isStatic: true,
      angle: r.angle,
      restitution: 0.35,
      friction: 0.02,
      chamfer: { radius: 6 },
    });
    body.rampData = r;
    return body;
  });
  World.add(world, rampBodies);

  const BALL_RADIUS = 11;
  const ball = Bodies.circle(LANE_CENTER_X, LANE_FLOOR_Y - 20, BALL_RADIUS, {
    restitution: 0.62,
    friction: 0.04,
    frictionAir: 0.0009,
    density: 0.022,
    label: 'ball',
  });
  World.add(world, ball);

  const runner = Runner.create();
  Runner.run(runner, engine);

  // A hard speed cap on the ball keeps a full-power plunge from tunnelling
  // through the thin board walls in a single physics step.
  const MAX_BALL_SPEED = 22;
  Events.on(engine, 'afterUpdate', () => {
    const v = ball.velocity;
    const speed = Math.hypot(v.x, v.y);
    if (speed > MAX_BALL_SPEED) {
      Body.setVelocity(ball, { x: (v.x / speed) * MAX_BALL_SPEED, y: (v.y / speed) * MAX_BALL_SPEED });
    }
  });

  // ---------------------------------------------------------------
  // Game state
  // ---------------------------------------------------------------
  const state = {
    score: 0,
    prevThreshold: 0,
    target: TARGET_BASE,
    ballsLaunched: 0,
    ballInLane: true,
    stuckFrames: 0,
    vaultBusy: false,
    popups: [],
    plunger: { pulling: false, pull: 0, spaceHeld: false, startY: 0 },
    images: null,
  };

  function updateScoreHUD() {
    scoreValueEl.textContent = state.score.toLocaleString();
    const span = state.target - state.prevThreshold;
    const progress = span > 0 ? (state.score - state.prevThreshold) / span : 1;
    targetFillEl.style.width = `${Math.max(0, Math.min(100, progress * 100))}%`;
    targetLabelEl.textContent = `Target ${state.target.toLocaleString()}`;
    ballCountEl.textContent = `Balls launched: ${state.ballsLaunched}`;
    vaultGlowEl.style.opacity = String(0.4 + 0.6 * Math.max(0, Math.min(1, progress)));
  }

  function addScore(amount, x, y, color) {
    state.score += amount;
    state.popups.push({ x, y, text: `+${amount}`, alpha: 1, vy: -1.3, color });
    updateScoreHUD();
    if (!state.vaultBusy && state.score >= state.target) {
      openVault();
    }
  }

  function openVault() {
    state.vaultBusy = true;
    vaultEl.classList.add('open');
    hintEl.textContent = 'Vault open! Star reward collected.';
    hintEl.classList.add('flash');
    setTimeout(() => {
      vaultEl.classList.remove('open');
      state.prevThreshold = state.target;
      state.target += TARGET_STEP;
      state.vaultBusy = false;
      hintEl.classList.remove('flash');
      hintEl.textContent = 'Drag the plunger down, then release to launch the ball.';
      updateScoreHUD();
    }, 2600);
  }

  // ---------------------------------------------------------------
  // Bumper collisions
  // ---------------------------------------------------------------
  Events.on(engine, 'collisionStart', (evt) => {
    for (const pair of evt.pairs) {
      const a = pair.bodyA, b = pair.bodyB;
      const bumper = a.label === 'bumper' ? a : (b.label === 'bumper' ? b : null);
      const ballBody = a.label === 'ball' ? a : (b.label === 'ball' ? b : null);
      if (!bumper || !ballBody) continue;

      const now = performance.now();
      if (now - bumper.bumperData.lastHit < 90) continue; // debounce a single physics contact
      bumper.bumperData.lastHit = now;
      bumper.bumperData.flashAt = now;

      const value = bumper.bumperData.n * 100;
      addScore(value, ballBody.position.x, ballBody.position.y, COLOR[bumper.bumperData.color]);

      // extra "kick" so the bounce feels punchy, on top of normal restitution
      const dx = ballBody.position.x - bumper.position.x;
      const dy = ballBody.position.y - bumper.position.y;
      const dist = Math.max(1, Math.hypot(dx, dy));
      const kick = 4.5;
      Body.setVelocity(ballBody, {
        x: ballBody.velocity.x + (dx / dist) * kick,
        y: ballBody.velocity.y + (dy / dist) * kick,
      });
    }
  });

  // ---------------------------------------------------------------
  // Plunger input
  // ---------------------------------------------------------------
  const MAX_PULL = 120;

  function canvasPos(evt) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (evt.clientX - rect.left) * scaleX,
      y: (evt.clientY - rect.top) * scaleY,
    };
  }

  function beginPull(y) {
    if (!state.ballInLane || state.plunger.pulling) return;
    state.plunger.pulling = true;
    state.plunger.startY = y;
    Body.setStatic(ball, true);
  }

  function updatePull(y) {
    if (!state.plunger.pulling) return;
    const raw = y - state.plunger.startY;
    state.plunger.pull = Math.max(0, Math.min(MAX_PULL, raw));
    Body.setPosition(ball, { x: LANE_CENTER_X, y: (LANE_FLOOR_Y - 20) + state.plunger.pull * 0.5 });
  }

  function release() {
    if (!state.plunger.pulling) return;
    state.plunger.pulling = false;
    Body.setStatic(ball, false);
    const power = 9.5 + (state.plunger.pull / MAX_PULL) * 9.5;
    Body.setVelocity(ball, { x: (Math.random() - 0.5) * 0.6, y: -power });
    state.plunger.pull = 0;
    state.ballInLane = false;
    state.ballsLaunched += 1;
    updateScoreHUD();
    hintEl.textContent = 'Ball launched!';
    setTimeout(() => {
      if (!state.vaultBusy) hintEl.textContent = 'Drag the plunger down, then release to launch the ball.';
    }, 1400);
  }

  canvas.addEventListener('pointerdown', (e) => {
    const p = canvasPos(e);
    if (p.x > DIVIDER_X - 10) {
      canvas.setPointerCapture(e.pointerId);
      beginPull(p.y);
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (state.plunger.pulling) updatePull(canvasPos(e).y);
  });
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      if (!state.plunger.spaceHeld && state.ballInLane) {
        state.plunger.spaceHeld = true;
        beginPull(0);
        state.plunger.startY = -1000; // let the rAF loop drive the pull amount instead
      }
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      state.plunger.spaceHeld = false;
      release();
    }
  });

  // ---------------------------------------------------------------
  // Drain / respawn
  // ---------------------------------------------------------------
  function respawnBall() {
    Body.setPosition(ball, { x: LANE_CENTER_X, y: LANE_FLOOR_Y - 20 });
    Body.setVelocity(ball, { x: 0, y: 0 });
    Body.setAngularVelocity(ball, 0);
    state.ballInLane = true;
    state.stuckFrames = 0;
  }

  const STUCK_LIMIT = 90; // ~1.5s at 60fps wedged against static geometry counts as lost

  function checkDrain() {
    if (ball.position.y > BOARD_H + 60) {
      respawnBall();
      return;
    }
    if (state.ballInLane) return;

    const speed = Math.hypot(ball.velocity.x, ball.velocity.y);
    if (ball.position.x > DIVIDER_X + 4 && ball.position.y > 640 && speed < 0.6) {
      // ball fell back into the lane without draining — ready to relaunch
      state.ballInLane = true;
      state.stuckFrames = 0;
    } else if (speed < 0.15) {
      // guards against the rare pocket where the ball wedges motionless
      // between static geometry and never triggers a normal drain
      state.stuckFrames += 1;
      if (state.stuckFrames > STUCK_LIMIT) respawnBall();
    } else {
      state.stuckFrames = 0;
    }
  }

  // ---------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------
  function drawBackground() {
    ctx.fillStyle = COLOR.ink;
    ctx.fillRect(0, 0, BOARD_W, BOARD_H);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    for (let y = 20; y < BOARD_H; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(BOARD_W, y); ctx.stroke();
    }
    ctx.restore();
  }

  function drawBoundaries() {
    ctx.fillStyle = COLOR.inkLine;
    ctx.fillRect(0, 0, BOARD_W, WALL);
    ctx.fillRect(0, 0, WALL, BOARD_H);
    ctx.fillRect(BOARD_W - WALL, 0, WALL, BOARD_H);
    // lane divider
    ctx.fillRect(DIVIDER_X - 4, DIVIDER_TOP_Y, 8, BOARD_H - DIVIDER_TOP_Y);
    ctx.fillStyle = COLOR.yellow;
    ctx.fillRect(DIVIDER_X - 4, DIVIDER_TOP_Y, 8, 4);
    // lane floor
    ctx.fillStyle = COLOR.inkLine;
    ctx.fillRect(LANE_CENTER_X - 27, LANE_FLOOR_Y - 5, 54, 10);
  }

  let tintedYellowWide = null;
  let tintedYellowNarrow = null;
  let tintedNumbersWhite = null;

  function drawRamps() {
    for (const body of rampBodies) {
      const r = body.rampData;
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.rotate(r.angle);
      const sprite = r.vector ? null : (r.w >= 30 ? tintedYellowWide : tintedYellowNarrow);
      if (sprite) {
        ctx.drawImage(sprite, -r.w / 2, -r.h / 2, r.w, r.h);
      } else {
        ctx.fillStyle = COLOR.yellow;
        const rad = 6;
        ctx.beginPath();
        ctx.roundRect(-r.w / 2, -r.h / 2, r.w, r.h, rad);
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(16,16,24,0.55)';
      ctx.lineWidth = 2;
      ctx.strokeRect(-r.w / 2, -r.h / 2, r.w, r.h);
      ctx.restore();
    }
  }

  function drawBumpers(now) {
    for (const body of bumperBodies) {
      const d = body.bumperData;
      const sinceHit = now - d.flashAt;
      const pulse = sinceHit >= 0 && sinceHit < 220 ? 1 + 0.28 * (1 - sinceHit / 220) : 1;
      const glow = sinceHit >= 0 && sinceHit < 260 ? 1 - sinceHit / 260 : 0;
      const radius = d.radius * pulse;
      const base = COLOR[d.color];

      ctx.save();
      ctx.translate(body.position.x, body.position.y);

      if (glow > 0) {
        ctx.save();
        ctx.shadowColor = base;
        ctx.shadowBlur = 24 * glow;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fillStyle = base;
        ctx.fill();
        ctx.restore();
      }

      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fillStyle = base;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = COLOR.inkLine;
      ctx.stroke();

      // highlight arc for a glossy "bouncy" look
      ctx.beginPath();
      ctx.arc(-radius * 0.28, -radius * 0.32, radius * 0.55, Math.PI * 1.1, Math.PI * 1.85);
      ctx.strokeStyle = glow > 0 ? '#ffffff' : 'rgba(255,255,255,0.55)';
      ctx.lineWidth = radius * 0.22;
      ctx.lineCap = 'round';
      ctx.stroke();

      // number label
      const spriteKey = 'n' + d.n;
      const sprite = tintedNumbersWhite && tintedNumbersWhite[spriteKey];
      if (sprite) {
        const targetH = radius * 0.95;
        const scale = targetH / sprite.height;
        const w = sprite.width * scale;
        const h = sprite.height * scale;
        ctx.drawImage(sprite, -w / 2, -h / 2, w, h);
      } else {
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${Math.round(radius)}px "Trebuchet MS", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(d.n), 0, 1);
      }
      ctx.restore();
    }
  }

  function drawPlunger() {
    const knobY = (LANE_FLOOR_Y - 20) + state.plunger.pull * 0.5 + BALL_RADIUS + 6;
    ctx.save();
    ctx.strokeStyle = COLOR.yellow;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    const coils = 6;
    const top = knobY;
    const bottom = LANE_FLOOR_Y - 8;
    ctx.beginPath();
    for (let i = 0; i <= coils; i++) {
      const t = i / coils;
      const y = top + (bottom - top) * t;
      const xOff = (i % 2 === 0 ? -7 : 7);
      if (i === 0) ctx.moveTo(LANE_CENTER_X, y);
      else ctx.lineTo(LANE_CENTER_X + xOff, y);
    }
    ctx.stroke();
    ctx.fillStyle = COLOR.yellow;
    ctx.beginPath();
    ctx.roundRect(LANE_CENTER_X - 16, bottom - 4, 32, 10, 4);
    ctx.fill();
    ctx.restore();
  }

  function drawBall(images) {
    ctx.save();
    ctx.translate(ball.position.x, ball.position.y);
    ctx.rotate(ball.angle);
    if (images && images.ball) {
      const s = BALL_RADIUS * 2.1;
      ctx.drawImage(images.ball, -s / 2, -s / 2, s, s);
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, BALL_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = COLOR.paper;
      ctx.fill();
    }
    ctx.restore();
  }

  function drawPopups() {
    for (const p of state.popups) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color || COLOR.yellow;
      ctx.font = 'bold 18px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeStyle = COLOR.inkLine;
      ctx.lineWidth = 3;
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillText(p.text, p.x, p.y);
      ctx.restore();
    }
  }

  function updatePopups() {
    state.popups.forEach((p) => { p.y += p.vy; p.alpha -= 0.018; });
    state.popups = state.popups.filter((p) => p.alpha > 0);
  }

  function frame() {
    const now = performance.now();

    if (state.plunger.spaceHeld) {
      state.plunger.pull = Math.min(MAX_PULL, state.plunger.pull + 3.4);
      Body.setPosition(ball, { x: LANE_CENTER_X, y: (LANE_FLOOR_Y - 20) + state.plunger.pull * 0.5 });
    }

    checkDrain();
    updatePopups();

    drawBackground();
    drawRamps();
    drawBoundaries();
    drawBumpers(now);
    drawPlunger();
    drawBall(state.images);
    drawPopups();

    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------
  loadImages(IMG_SOURCES).then((images) => {
    state.images = images;
    tintedYellowWide = tint(images.platform, COLOR.yellow);
    tintedYellowNarrow = tint(images.platformNarrow, COLOR.yellow);
    tintedNumbersWhite = {};
    for (let i = 0; i <= 9; i++) {
      tintedNumbersWhite['n' + i] = tint(images['n' + i], '#ffffff');
    }
    updateScoreHUD();
    requestAnimationFrame(frame);
  });
})();
