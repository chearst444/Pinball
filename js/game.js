// TILT — a real-physics pinball table built on canvas, styled after a
// classic chrome-cabinet machine. A ball with gravity bounces off chrome
// rails, cyan/red/gold numbered bumpers, white standup targets, and
// yellow slingshots; two yellow flippers (rotating capsules driven by
// keys, on-screen buttons, or taps on the table itself) are the only
// thing standing between the ball and the drain — save for a lucky
// dead-center "Shoot Again" kickback.

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
  var legendDetails = document.getElementById("legendDetails");

  var STORAGE_KEY = "tilt-best-score";

  // ---------- colors (mirrors css/style.css :root) ----------
  var COLOR_INK = "#101018";
  var COLOR_YELLOW = "#f8e060";
  var COLOR_ORANGE = "#f2994a"; // side paddles — deliberately not flipper-yellow
  var COLOR_WHITE = "#f2f0e8"; // standup targets
  var COLOR_CHROME_HI = "#eef3f6";
  var COLOR_CHROME_LO = "#7c8894";

  // classic-cabinet bumper hues, cyan / red / gold like the reference photo
  var BUMPER_STYLES = {
    cyan: { hi: "#7fe6f2", lo: "#0f7a92" },
    red: { hi: "#ff8a80", lo: "#9c1c1c" },
    gold: { hi: "#ffe08a", lo: "#b8790f" },
  };

  // standup-target sprite — the actual platform_narrow.png shape shared
  // across this repo's sibling games, recolored white to match the photo
  var standupSprite = null;
  (function loadStandupSprite() {
    var img = new Image();
    img.onload = function () {
      var off = document.createElement("canvas");
      off.width = img.width;
      off.height = img.height;
      var octx = off.getContext("2d");
      octx.drawImage(img, 0, 0);
      octx.globalCompositeOperation = "source-in";
      octx.fillStyle = COLOR_WHITE;
      octx.fillRect(0, 0, off.width, off.height);
      standupSprite = off;
    };
    img.src = "assets/platform_narrow.png";
  })();

  // ---------- logical table geometry (fixed virtual units) ----------
  var W = 400;
  var H = 720;
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
  var stuckWatch = { t: 0, bestY: 0, windowStartY: 0 }; // catches an abandoned ball going nowhere
  var lastInputAt = 0; // performance.now() of the last flipper press, for the watchdog below

  var activators = { left: new Set(), right: new Set() };
  var pointerSides = {}; // pointerId -> 'left' | 'right'

  var walls = buildWalls();
  var bumpers = buildBumpers();
  var pegs = buildPegs();
  var shootAgain = buildShootAgain();
  var flippers = buildFlippers();
  var sideFlippers = buildSideFlippers();
  var chevrons = buildChevrons();
  var tableBgGradient = null; // built lazily once ctx is in hand

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
    wall(20, 60, 20, 590);
    // top-left rounded corner
    arcSegments(w, 60, 60, 40, Math.PI, Math.PI * 1.5, 6);
    // top wall
    wall(60, 20, 340, 20);
    // top-right rounded corner
    arcSegments(w, 340, 60, 40, Math.PI * 1.5, Math.PI * 2, 6);
    // right outer wall
    wall(380, 60, 380, 590);

    // funnels guiding a dropping ball toward each flipper
    wall(20, 590, 75, 628);
    wall(380, 590, 325, 628);

    // slingshot kickers just above each flipper — extra bouncy, score points
    wall(68, 525, 120, 575, 1.6, "sling");
    wall(332, 525, 280, 575, 1.6, "sling");

    return w;
  }

  // cyan/red/gold trio with real point values printed on the target,
  // same arrangement (two up top, one centered below) both clusters
  function buildBumpers() {
    return [
      // upper cluster
      { x: 160, y: 140, r: 15, style: "cyan", value: 25, flash: 0 },
      { x: 240, y: 140, r: 15, style: "red", value: 100, flash: 0 },
      { x: 200, y: 200, r: 17, style: "gold", value: 50, flash: 0 },
      // lower-middle cluster
      { x: 140, y: 370, r: 14, style: "cyan", value: 25, flash: 0 },
      { x: 260, y: 370, r: 14, style: "red", value: 100, flash: 0 },
      { x: 200, y: 415, r: 16, style: "gold", value: 50, flash: 0 },
    ];
  }

  // small white standup targets between the bumper clusters and the
  // side-flipper rows — worth a little less than a bumper
  function buildPegs() {
    return [
      { x: 100, y: 320, r: 9, value: 20, flash: 0 },
      { x: 300, y: 320, r: 9, value: 20, flash: 0 },
    ];
  }

  // center "shoot again" kickback sitting in the drain gap — a rare save
  // if the ball falls dead-center, like the lit target on a real table.
  // Small and set well below the flippers' resting reach (~676) so it
  // only catches a ball that has actually gotten past them, not one
  // that's merely bouncing between the two resting flipper tips.
  function buildShootAgain() {
    return { x: 200, y: 700, r: 7, value: 250, flash: 0 };
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
      left: makeFlipper("left", { x: 130, y: 630 }),
      right: makeFlipper("right", { x: 270, y: 630 }),
    };
  }

  // Small paddles mounted on the side walls, two rows per side. They sit
  // tucked flat against the wall until the matching flipper is pressed —
  // pressing left fires the left flipper AND both left-side paddles — so
  // there's no new control to learn, and nothing moves on its own.
  function makeSidePaddle(side, pivot) {
    var rest = side === "left" ? 1.2 : Math.PI - 1.2;
    var active = side === "left" ? -0.1 : Math.PI + 0.1;
    return {
      side: side,
      pivot: pivot,
      length: 55,
      radius: 9,
      angle: rest,
      restAngle: rest,
      activeAngle: active,
      pressed: false,
      angVel: 0,
      isSidePaddle: true,
    };
  }

  function buildSideFlippers() {
    return [
      makeSidePaddle("left", { x: 20, y: 260 }),
      makeSidePaddle("right", { x: 380, y: 260 }),
      makeSidePaddle("left", { x: 20, y: 480 }),
      makeSidePaddle("right", { x: 380, y: 480 }),
    ];
  }

  // purely decorative direction chevrons climbing the outer lanes, like
  // the arrow rows on a real cabinet — no collision, just flavor
  function buildChevrons() {
    var rows = [100, 170, 345, 545];
    var list = [];
    rows.forEach(function (y, i) {
      var color = i % 2 === 0 ? COLOR_YELLOW : COLOR_ORANGE;
      list.push({ x: 34, y: y, color: color });
      list.push({ x: 366, y: y, color: color });
    });
    return list;
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

    // Two things used to let the ball get trapped bouncing forever in a
    // dense bumper cluster: (1) a perfectly fixed-speed kick straight back
    // along the normal can lock into an exact repeating loop between two
    // kickers, and (2) scaling the kick up to 1.2x the incoming speed only
    // ever added energy on every hit, with nothing to bleed it back off —
    // a ball bouncing rapidly between bumpers would ratchet up to top
    // speed and stay there, never slow enough for gravity to pull it clear
    // between hits. Kick at a flat speed (small jitter only, no incoming-
    // speed amplification) and jitter the angle too.
    var jitter = (Math.random() - 0.5) * 0.5; // ~±14 degrees
    var ang = Math.atan2(ny, nx) + jitter;
    var speed = kickSpeed * (0.92 + Math.random() * 0.16);
    b.vx = Math.cos(ang) * speed;
    b.vy = Math.sin(ang) * speed;
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

  // ---------- game flow ----------

  function updateHud() {
    scoreValue.textContent = String(score);
    ballsValue.textContent = String(Math.max(ballsLeft, 0));
  }

  function spawnBall() {
    ball = { x: SPAWN.x, y: SPAWN.y, vx: 0, vy: 0, r: BALL_R };
    state = "idle";
    stuckWatch.t = 0;
    stuckWatch.bestY = SPAWN.y;
    stuckWatch.windowStartY = SPAWN.y;
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

    gameOverLine.textContent = "Final score " + score + "." + (isNewBest ? " New best!" : "");
    statusLine.textContent = "Game over.";

    if (isNewBest) spawnStarBurst();
    gameOverOverlay.hidden = false;
  }

  function newGame() {
    score = 0;
    ballsLeft = TOTAL_BALLS;
    gameOverOverlay.hidden = true;
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
    // side paddles fire in lockstep with the main flipper on their side —
    // no separate control, and they sit still until told to move
    sideFlippers.forEach(function (sf) { sf.pressed = flippers[sf.side].pressed; });

    [flippers.left, flippers.right].concat(sideFlippers).forEach(function (f) {
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
        score += b.value;
        updateHud();
      }
    });

    pegs.forEach(function (p) {
      var hit = resolveCircleKick(ball, p.x, p.y, p.r, 260);
      if (hit) {
        p.flash = performance.now();
        score += p.value;
        updateHud();
      }
    });

    // "shoot again" kickback sitting in the drain gap — a strong straight
    // launch back into play instead of a generic radial bounce, like a
    // real kickback target, plus a solid score for the rare dead-center save
    var dxSA = ball.x - shootAgain.x;
    var dySA = ball.y - shootAgain.y;
    if (Math.hypot(dxSA, dySA) < ball.r + shootAgain.r) {
      shootAgain.flash = performance.now();
      score += shootAgain.value;
      updateHud();
      ball.x = shootAgain.x;
      ball.y = shootAgain.y - shootAgain.r - ball.r;
      ball.vx = Math.random() * 60 - 30;
      ball.vy = -820;
      statusLine.textContent = "Shoot Again! +" + shootAgain.value;
    }

    [flippers.left, flippers.right].concat(sideFlippers).forEach(function (f) {
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
      if (ball.y - ball.r > H) { loseBall(); return; }

      // Safety net for an abandoned ball: a resting (unpressed) flipper is
      // a legitimate solid obstacle, same as a real machine, so this must
      // never fire on a ball a player is actively contesting — even a
      // long bumper-camping rally that makes no downward progress at all
      // is exactly what should happen there. It only engages once BOTH
      // (a) the deepest point reached hasn't advanced across a full 2.5s
      // window, and (b) no flipper has been pressed in 3+ seconds — i.e.
      // the ball has genuinely been left to bounce with nobody playing it.
      stuckWatch.bestY = Math.max(stuckWatch.bestY, ball.y);
      stuckWatch.t += dt;
      if (stuckWatch.t > 2.5) {
        var noProgress = stuckWatch.bestY - stuckWatch.windowStartY < 20;
        var abandoned = performance.now() - lastInputAt > 3000;
        if (noProgress && abandoned) {
          loseBall();
          return;
        }
        stuckWatch.windowStartY = stuckWatch.bestY;
        stuckWatch.t = 0;
      }
    }
  }

  // ---------- rendering ----------

  function drawChevron(x, y, color) {
    ctx.beginPath();
    ctx.moveTo(x, y - 7);
    ctx.lineTo(x + 6, y + 5);
    ctx.lineTo(x - 6, y + 5);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function drawStandupTarget(p, glow) {
    var w = 11, h = 44;
    if (standupSprite) {
      ctx.save();
      if (glow) {
        ctx.shadowColor = "#ffffff";
        ctx.shadowBlur = 8;
      }
      ctx.drawImage(standupSprite, p.x - w / 2, p.y - h / 2, w, h);
      ctx.restore();
      return;
    }
    // fallback shape while the sprite is still loading
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.fillStyle = glow ? "#ffffff" : COLOR_WHITE;
    ctx.strokeStyle = "#b9b6ac";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, 4);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawBumper(b) {
    var flashT = performance.now() - b.flash;
    var glow = flashT < 150;
    var style = BUMPER_STYLES[b.style];
    var grad = ctx.createRadialGradient(
      b.x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.15,
      b.x, b.y, b.r
    );
    if (glow) {
      grad.addColorStop(0, "#ffffff");
      grad.addColorStop(1, style.hi);
    } else {
      grad.addColorStop(0, style.hi);
      grad.addColorStop(1, style.lo);
    }
    ctx.beginPath();
    ctx.fillStyle = grad;
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#ffffff";
    ctx.globalAlpha = 0.6;
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.fillStyle = "#ffffff";
    ctx.font = "700 " + Math.round(b.r * 0.62) + "px \"Segoe UI\", sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(b.value), b.x, b.y + 1);
  }

  function render() {
    ctx.clearRect(0, 0, W, H);

    if (!tableBgGradient) {
      tableBgGradient = ctx.createRadialGradient(200, 160, 30, 200, 500, 480);
      tableBgGradient.addColorStop(0, "#1c4a7a");
      tableBgGradient.addColorStop(0.55, "#123159");
      tableBgGradient.addColorStop(1, "#081a30");
    }
    ctx.fillStyle = tableBgGradient;
    ctx.fillRect(0, 0, W, H);

    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    chevrons.forEach(function (c) { drawChevron(c.x, c.y, c.color); });

    var chromeGrad = ctx.createLinearGradient(0, 0, W, 0);
    chromeGrad.addColorStop(0, COLOR_CHROME_LO);
    chromeGrad.addColorStop(0.5, COLOR_CHROME_HI);
    chromeGrad.addColorStop(1, COLOR_CHROME_LO);
    ctx.strokeStyle = chromeGrad;
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

    bumpers.forEach(drawBumper);

    pegs.forEach(function (p) {
      var flashT = performance.now() - p.flash;
      drawStandupTarget(p, flashT < 150);
    });

    // shoot-again kickback — a small lit red/white bullseye deep in the
    // drain gap, too small at this scale for its own label to read
    (function () {
      var flashT = performance.now() - shootAgain.flash;
      var glow = flashT < 220;
      var grad = ctx.createRadialGradient(
        shootAgain.x, shootAgain.y, 0.5,
        shootAgain.x, shootAgain.y, shootAgain.r
      );
      grad.addColorStop(0, glow ? "#ffffff" : "#ff5a4d");
      grad.addColorStop(0.6, "#c81e1e");
      grad.addColorStop(1, "#7a0f0f");
      ctx.beginPath();
      ctx.fillStyle = grad;
      ctx.arc(shootAgain.x, shootAgain.y, shootAgain.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
    })();

    [flippers.left, flippers.right].concat(sideFlippers).forEach(function (f) {
      var tip = {
        x: f.pivot.x + f.length * Math.cos(f.angle),
        y: f.pivot.y + f.length * Math.sin(f.angle),
      };
      ctx.strokeStyle = f.isSidePaddle ? COLOR_ORANGE : COLOR_YELLOW;
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
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(8, 20, 38, 0.5)";
      ctx.stroke();
    }

    if (state === "idle") {
      ctx.fillStyle = "rgba(249, 230, 96, 0.9)";
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
    lastInputAt = performance.now();
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
