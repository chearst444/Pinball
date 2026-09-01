// TILT — a real-physics pinball table built on canvas, in the game's
// ink / yellow / magenta / teal palette. A ball with gravity bounces off
// walls, magenta bumpers, and yellow slingshots; two yellow flippers
// (rotating capsules driven by keys, on-screen buttons, or taps on the
// table itself) are the only thing standing between the ball and the drain.

(function () {
  "use strict";

  var canvas = document.getElementById("tableCanvas");
  var ctx = canvas.getContext("2d");
  var scoreValue = document.getElementById("scoreValue");
  var ballsValue = document.getElementById("ballsValue");
  var bestValue = document.getElementById("bestValue");
  var statusLine = document.getElementById("statusLine");
  var launchBtn = document.getElementById("launchBtn");
  var restartBtn = document.getElementById("restartBtn");
  var leftFlipperBtn = document.getElementById("leftFlipperBtn");
  var rightFlipperBtn = document.getElementById("rightFlipperBtn");
  var gameOverOverlay = document.getElementById("gameOverOverlay");
  var gameOverLine = document.getElementById("gameOverLine");
  var playAgainBtn = document.getElementById("playAgainBtn");
  var starBurst = document.getElementById("starBurst");
  var trophySlot = document.getElementById("trophySlot");
  var trophyLocked = document.getElementById("trophyLocked");
  var trophyUnlocked = document.getElementById("trophyUnlocked");
  var legendDetails = document.getElementById("legendDetails");

  var STORAGE_KEY = "tilt-best-score";

  // ---------- colors (mirrors css/style.css :root) ----------
  var COLOR_INK = "#101018";
  var COLOR_YELLOW = "#f8e060";
  var COLOR_MAGENTA = "#d840b8";
  var COLOR_TEAL = "#60d0c0";
  var COLOR_TABLE_BG = "#0c0c14";

  // ---------- logical table geometry (fixed virtual units) ----------
  var W = 400;
  var H = 650;
  var BALL_R = 8;
  var GRAVITY = 1400; // px/s^2
  var MAX_SPEED = 1100;
  var SUBSTEPS = 4;
  var SPAWN = { x: 200, y: 42 };
  var LAUNCH_VY = -200; // a small upward "serve" pop before gravity takes over

  var UP_SPEED = 16; // rad/s, flipper snapping up
  var DOWN_SPEED = 10; // rad/s, flipper falling back

  // ---------- state ----------
  var score = 0;
  var ballsLeft = 3;
  var TOTAL_BALLS = 3;
  var state = "idle"; // 'idle' | 'live' | 'over'
  var ball = null;
  var lastT = null;

  var activators = { left: new Set(), right: new Set() };
  var pointerSides = {}; // pointerId -> 'left' | 'right'

  var walls = buildWalls();
  var bumpers = buildBumpers();
  var flippers = buildFlippers();

  // ---------- geometry helpers ----------

  function arcSegments(list, cx, cy, r, startAngle, endAngle, n) {
    var prev = null;
    for (var i = 0; i <= n; i++) {
      var a = startAngle + (endAngle - startAngle) * (i / n);
      var p = { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
      if (prev) {
        list.push({ x1: prev.x, y1: prev.y, x2: p.x, y2: p.y, restitution: 0.85, kind: "wall" });
      }
      prev = p;
    }
  }

  function buildWalls() {
    var w = [];
    function wall(x1, y1, x2, y2, restitution, kind) {
      w.push({ x1: x1, y1: y1, x2: x2, y2: y2, restitution: restitution || 0.85, kind: kind || "wall" });
    }

    // left outer wall
    wall(20, 60, 20, 520);
    // top-left rounded corner
    arcSegments(w, 60, 60, 40, Math.PI, Math.PI * 1.5, 6);
    // top wall
    wall(60, 20, 340, 20);
    // top-right rounded corner
    arcSegments(w, 340, 60, 40, Math.PI * 1.5, Math.PI * 2, 6);
    // right outer wall
    wall(380, 60, 380, 520);

    // funnels guiding a dropping ball toward each flipper
    wall(20, 520, 75, 558);
    wall(380, 520, 325, 558);

    // slingshot kickers just above each flipper — extra bouncy, score points
    wall(68, 455, 120, 505, 1.6, "sling");
    wall(332, 455, 280, 505, 1.6, "sling");

    return w;
  }

  function buildBumpers() {
    return [
      { x: 160, y: 180, r: 16, flash: 0 },
      { x: 240, y: 180, r: 16, flash: 0 },
      { x: 200, y: 250, r: 18, flash: 0 },
    ];
  }

  function makeFlipper(side, pivot) {
    var rest = side === "left" ? 0.75 : Math.PI - 0.75;
    var active = side === "left" ? -0.35 : Math.PI + 0.35;
    return {
      side: side,
      pivot: pivot,
      length: 68,
      radius: 10,
      angle: rest,
      restAngle: rest,
      activeAngle: active,
      pressed: false,
      angVel: 0,
    };
  }

  function buildFlippers() {
    return {
      left: makeFlipper("left", { x: 130, y: 560 }),
      right: makeFlipper("right", { x: 270, y: 560 }),
    };
  }

  function closestPointOnSegment(px, py, x1, y1, x2, y2) {
    var dx = x2 - x1;
    var dy = y2 - y1;
    var lenSq = dx * dx + dy * dy;
    var t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return { x: x1 + t * dx, y: y1 + t * dy };
  }

  function resolveSegmentCollision(b, p1, p2, radius, restitution, surfaceVelFn) {
    var closest = closestPointOnSegment(b.x, b.y, p1.x, p1.y, p2.x, p2.y);
    var dx = b.x - closest.x;
    var dy = b.y - closest.y;
    var dist = Math.hypot(dx, dy);
    var minDist = b.r + radius;
    if (dist === 0 || dist >= minDist) return false;

    var nx = dx / dist;
    var ny = dy / dist;
    var penetration = minDist - dist;
    b.x += nx * penetration;
    b.y += ny * penetration;

    var surfaceVel = surfaceVelFn ? surfaceVelFn(closest) : { x: 0, y: 0 };
    var relVx = b.vx - surfaceVel.x;
    var relVy = b.vy - surfaceVel.y;
    var vDotN = relVx * nx + relVy * ny;
    if (vDotN < 0) {
      relVx -= (1 + restitution) * vDotN * nx;
      relVy -= (1 + restitution) * vDotN * ny;
      b.vx = relVx + surfaceVel.x;
      b.vy = relVy + surfaceVel.y;
    }
    return true;
  }

  function resolveCircleKick(b, cx, cy, radius, kickSpeed) {
    var dx = b.x - cx;
    var dy = b.y - cy;
    var dist = Math.hypot(dx, dy);
    var minDist = b.r + radius;
    if (dist === 0 || dist >= minDist) return false;

    var nx = dx / dist;
    var ny = dy / dist;
    b.x = cx + nx * minDist;
    b.y = cy + ny * minDist;

    var speed = Math.max(kickSpeed, Math.hypot(b.vx, b.vy) * 1.2);
    b.vx = nx * speed;
    b.vy = ny * speed;
    return true;
  }

  // ---------- best score ----------

  function getBest() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    return raw ? parseInt(raw, 10) : null;
  }

  function maybeSaveBest(n) {
    var current = getBest();
    if (current === null || n > current) {
      try { localStorage.setItem(STORAGE_KEY, String(n)); } catch (e) { /* ignore */ }
      return true;
    }
    return false;
  }

  function renderBest() {
    var b = getBest();
    bestValue.textContent = b === null ? "—" : String(b);
  }

  function resetTrophy() {
    trophySlot.classList.remove("pop");
    trophyLocked.hidden = false;
    trophyUnlocked.hidden = true;
  }

  // ---------- game flow ----------

  function updateHud() {
    scoreValue.textContent = String(score);
    ballsValue.textContent = String(Math.max(ballsLeft, 0));
  }

  function spawnBall() {
    ball = { x: SPAWN.x, y: SPAWN.y, vx: 0, vy: 0, r: BALL_R };
    state = "idle";
  }

  function doLaunch() {
    if (state !== "idle" || !ball) return;
    ball.vy = LAUNCH_VY;
    ball.vx = Math.random() * 40 - 20;
    state = "live";
    statusLine.textContent = "Ball in play — flip to keep it up!";
  }

  function loseBall() {
    ball = null;
    ballsLeft -= 1;
    updateHud();
    if (ballsLeft <= 0) {
      endGame();
    } else {
      spawnBall();
      statusLine.textContent = "Ball lost — " + ballsLeft + " left. Launch again!";
    }
  }

  function endGame() {
    state = "over";
    var isNewBest = maybeSaveBest(score);
    renderBest();

    trophySlot.classList.toggle("pop", isNewBest);
    trophyLocked.hidden = isNewBest;
    trophyUnlocked.hidden = !isNewBest;

    gameOverLine.textContent = "Final score " + score + "." + (isNewBest ? " New best!" : "");
    statusLine.textContent = "Game over.";

    if (isNewBest) spawnStarBurst();
    gameOverOverlay.hidden = false;
  }

  function newGame() {
    score = 0;
    ballsLeft = TOTAL_BALLS;
    gameOverOverlay.hidden = true;
    resetTrophy();
    renderBest();
    updateHud();
    spawnBall();
    statusLine.textContent = "Ball ready — press Space or tap Launch.";
  }

  function spawnStarBurst() {
    starBurst.innerHTML = "";
    var count = 12;
    for (var i = 0; i < count; i++) {
      var img = document.createElement("img");
      img.src = "assets/star.png";
      img.alt = "";
      var angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      var dist = 70 + Math.random() * 60;
      var tx = Math.cos(angle) * dist;
      var ty = Math.sin(angle) * dist;
      img.style.setProperty("--tx", tx.toFixed(0) + "px");
      img.style.setProperty("--ty", ty.toFixed(0) + "px");
      img.style.setProperty("--rot", (180 + Math.random() * 360).toFixed(0) + "deg");
      img.style.setProperty("--dur", (0.7 + Math.random() * 0.6).toFixed(2) + "s");
      img.style.setProperty("--delay", (Math.random() * 0.25).toFixed(2) + "s");
      starBurst.appendChild(img);
    }
  }

  // ---------- physics ----------

  function updateFlipperPhysics(dt) {
    [flippers.left, flippers.right].forEach(function (f) {
      var target = f.pressed ? f.activeAngle : f.restAngle;
      var maxSpeed = f.pressed ? UP_SPEED : DOWN_SPEED;
      var diff = target - f.angle;
      var step = maxSpeed * dt;
      var prevAngle = f.angle;
      if (Math.abs(diff) <= step) {
        f.angle = target;
      } else {
        f.angle += diff > 0 ? step : -step;
      }
      f.angVel = dt > 0 ? (f.angle - prevAngle) / dt : 0;
    });
    leftFlipperBtn.classList.toggle("is-pressed", flippers.left.pressed);
    rightFlipperBtn.classList.toggle("is-pressed", flippers.right.pressed);
  }

  function physicsStep(dt) {
    ball.vy += GRAVITY * dt;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    walls.forEach(function (seg) {
      var hit = resolveSegmentCollision(
        ball,
        { x: seg.x1, y: seg.y1 },
        { x: seg.x2, y: seg.y2 },
        3,
        seg.restitution,
        null
      );
      if (hit && seg.kind === "sling") {
        seg.flash = performance.now();
        score += 50;
        updateHud();
      }
    });

    bumpers.forEach(function (b) {
      var hit = resolveCircleKick(ball, b.x, b.y, b.r, 420);
      if (hit) {
        b.flash = performance.now();
        score += 100;
        updateHud();
      }
    });

    [flippers.left, flippers.right].forEach(function (f) {
      var tip = {
        x: f.pivot.x + f.length * Math.cos(f.angle),
        y: f.pivot.y + f.length * Math.sin(f.angle),
      };
      resolveSegmentCollision(ball, f.pivot, tip, f.radius, 0.35, function (pt) {
        var rx = pt.x - f.pivot.x;
        var ry = pt.y - f.pivot.y;
        return { x: -f.angVel * ry, y: f.angVel * rx };
      });
    });

    var sp = Math.hypot(ball.vx, ball.vy);
    if (sp > MAX_SPEED) {
      ball.vx *= MAX_SPEED / sp;
      ball.vy *= MAX_SPEED / sp;
    }
  }

  function update(dt) {
    updateFlipperPhysics(dt);
    if (state === "live" && ball) {
      var sdt = dt / SUBSTEPS;
      for (var i = 0; i < SUBSTEPS; i++) physicsStep(sdt);
      if (ball.y - ball.r > H) loseBall();
    }
  }

  // ---------- rendering ----------

  function render() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = COLOR_TABLE_BG;
    ctx.fillRect(0, 0, W, H);

    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.strokeStyle = COLOR_TEAL;
    ctx.lineWidth = 6;
    walls.forEach(function (seg) {
      if (seg.kind === "sling") return;
      ctx.beginPath();
      ctx.moveTo(seg.x1, seg.y1);
      ctx.lineTo(seg.x2, seg.y2);
      ctx.stroke();
    });

    ctx.lineWidth = 8;
    walls.forEach(function (seg) {
      if (seg.kind !== "sling") return;
      var flashT = performance.now() - seg.flash;
      ctx.strokeStyle = flashT < 120 ? "#ffffff" : COLOR_YELLOW;
      ctx.beginPath();
      ctx.moveTo(seg.x1, seg.y1);
      ctx.lineTo(seg.x2, seg.y2);
      ctx.stroke();
    });

    bumpers.forEach(function (b) {
      var flashT = performance.now() - b.flash;
      var glow = flashT < 150;
      ctx.beginPath();
      ctx.fillStyle = glow ? "#ffffff" : COLOR_MAGENTA;
      ctx.arc(b.x, b.y, b.r + (glow ? 3 : 0), 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.strokeStyle = COLOR_TEAL;
      ctx.lineWidth = 3;
      ctx.arc(b.x, b.y, b.r * 0.55, 0, Math.PI * 2);
      ctx.stroke();
    });

    [flippers.left, flippers.right].forEach(function (f) {
      var tip = {
        x: f.pivot.x + f.length * Math.cos(f.angle),
        y: f.pivot.y + f.length * Math.sin(f.angle),
      };
      ctx.strokeStyle = COLOR_YELLOW;
      ctx.lineWidth = f.radius * 2;
      ctx.beginPath();
      ctx.moveTo(f.pivot.x, f.pivot.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();

      ctx.beginPath();
      ctx.fillStyle = COLOR_INK;
      ctx.arc(f.pivot.x, f.pivot.y, f.radius * 0.5, 0, Math.PI * 2);
      ctx.fill();
    });

    if (ball) {
      var grad = ctx.createRadialGradient(
        ball.x - 3, ball.y - 3, 1,
        ball.x, ball.y, ball.r
      );
      grad.addColorStop(0, "#ffffff");
      grad.addColorStop(1, "#9aa7b0");
      ctx.beginPath();
      ctx.fillStyle = grad;
      ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
      ctx.fill();
    }

    if (state === "idle") {
      ctx.fillStyle = "rgba(249, 230, 96, 0.85)";
      ctx.font = "600 13px \"Segoe UI\", sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("TAP LAUNCH ↓", 200, 90);
    }
  }

  // ---------- canvas sizing ----------

  function fitCanvas() {
    var dpr = window.devicePixelRatio || 1;
    var displayW = canvas.clientWidth || W;
    var scale = (displayW / W) * dpr;
    canvas.width = Math.round(W * scale);
    canvas.height = Math.round(H * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }

  // ---------- flipper input ----------

  function press(side, id) {
    activators[side].add(id);
    flippers[side].pressed = true;
  }

  function release(side, id) {
    activators[side].delete(id);
    flippers[side].pressed = activators[side].size > 0;
  }

  function bindHold(el, side) {
    el.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      press(side, "btn");
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (evt) {
      el.addEventListener(evt, function () { release(side, "btn"); });
    });
  }

  bindHold(leftFlipperBtn, "left");
  bindHold(rightFlipperBtn, "right");

  canvas.addEventListener("pointerdown", function (e) {
    var rect = canvas.getBoundingClientRect();
    var xRatio = (e.clientX - rect.left) / rect.width;
    var side = xRatio < 0.5 ? "left" : "right";
    pointerSides[e.pointerId] = side;
    press(side, "canvas" + e.pointerId);
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });
  ["pointerup", "pointercancel"].forEach(function (evt) {
    canvas.addEventListener(evt, function (e) {
      var side = pointerSides[e.pointerId];
      if (side) release(side, "canvas" + e.pointerId);
      delete pointerSides[e.pointerId];
    });
  });

  window.addEventListener("keydown", function (e) {
    if (e.code === "ArrowLeft" || e.code === "KeyZ" ||
        e.code === "ArrowRight" || e.code === "KeyM" || e.code === "Slash" ||
        e.code === "Space" || e.code === "ArrowUp") {
      e.preventDefault();
    }
    if (e.repeat) return;
    switch (e.code) {
      case "ArrowLeft": case "KeyZ": press("left", "key"); break;
      case "ArrowRight": case "KeyM": case "Slash": press("right", "key"); break;
      case "Space": case "ArrowUp": doLaunch(); break;
    }
  });
  window.addEventListener("keyup", function (e) {
    switch (e.code) {
      case "ArrowLeft": case "KeyZ": release("left", "key"); break;
      case "ArrowRight": case "KeyM": case "Slash": release("right", "key"); break;
    }
  });

  // ---------- controls ----------

  launchBtn.addEventListener("click", doLaunch);
  restartBtn.addEventListener("click", newGame);
  playAgainBtn.addEventListener("click", newGame);
  window.addEventListener("resize", fitCanvas);

  // "How to play" starts open on desktop (room to spare) and closed on
  // phones (every bit of vertical space matters there). Only react when
  // the viewport actually crosses the breakpoint, so a manual toggle on
  // mobile doesn't get clobbered by an unrelated resize.
  var desktopQuery = window.matchMedia("(min-width: 780px)");
  var syncLegendOpen = function (e) { legendDetails.open = e.matches; };
  syncLegendOpen(desktopQuery);
  if (desktopQuery.addEventListener) {
    desktopQuery.addEventListener("change", syncLegendOpen);
  } else if (desktopQuery.addListener) {
    desktopQuery.addListener(syncLegendOpen); // older Safari
  }

  // ---------- main loop ----------

  function frame(t) {
    if (lastT === null) lastT = t;
    var dt = Math.min((t - lastT) / 1000, 0.032);
    lastT = t;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  // ---------- init ----------

  fitCanvas();
  renderBest();
  newGame();
  requestAnimationFrame(frame);
})();
