// KEYFALL — a gravity keyhole puzzle built on Matter.js and Kenney's
// rolling-ball asset pack (recolored to the game's teal / magenta / yellow / ink palette).

(function () {
  "use strict";

  const { Engine, World, Bodies, Body, Composite, Events, Vertices, Bounds } = Matter;

  // Polyfill for older browsers lacking CanvasRenderingContext2D.roundRect
  if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      this.moveTo(x + r, y);
      this.arcTo(x + w, y, x + w, y + h, r);
      this.arcTo(x + w, y + h, x, y + h, r);
      this.arcTo(x, y + h, x, y, r);
      this.arcTo(x, y, x + w, y, r);
      this.closePath();
      return this;
    };
  }

  // ---------------------------------------------------------------------
  // Constants & level data
  // ---------------------------------------------------------------------

  const W = 440;
  const H = 760;
  const WALL_T = 16;
  const BALL_R = 13;
  const SPAWN = { x: 220, y: 40 };

  const ARM_W = 36;   // portrait footprint; rotated 90deg it becomes the landscape footprint
  const ARM_H = 70;

  // [x, y, initialAngle] — initialAngle 0 = portrait (tall/narrow), PI/2 = landscape (wide/flat)
  const ARM_DATA = [
    [140, 90, 0],
    [300, 90, Math.PI / 2],
    [90, 250, Math.PI / 2],
    [220, 250, 0],
    [350, 250, Math.PI / 2],
    [140, 410, 0],
    [300, 410, Math.PI / 2],
    [90, 570, Math.PI / 2],
    [220, 570, 0],
    [350, 570, Math.PI / 2],
    [240, 690, 0],
  ];

  // [x, y, ledgeWidth, number]
  const KEYHOLE_DATA = [
    [220, 170, 100, 1],
    [120, 330, 100, 2],
    [320, 490, 100, 3],
    [180, 650, 100, 4],
    [300, 730, 100, 5],
  ];

  const LEDGE_H = 14;
  const KEY_SENSOR_R = 22;

  // ---------------------------------------------------------------------
  // DOM & canvas
  // ---------------------------------------------------------------------

  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d");
  const dropBtn = document.getElementById("dropBtn");
  const resetBtn = document.getElementById("resetBtn");
  const nudgeBtn = document.getElementById("nudgeBtn");
  const attemptsLine = document.getElementById("attemptsLine");
  const statusLine = document.getElementById("statusLine");
  const keyholeTrack = document.getElementById("keyholeTrack");
  const bonusSlot = document.getElementById("bonusSlot");
  const bonusLocked = document.getElementById("bonusStarLocked");
  const bonusUnlocked = document.getElementById("bonusStarUnlocked");

  // ---------------------------------------------------------------------
  // Asset loading
  // ---------------------------------------------------------------------

  const ASSET_NAMES = ["ball", "platform", "platform_narrow", "pivot_arm", "keyhole", "star"];
  const NUMBER_NAMES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => "number_" + n);
  const images = {};

  function loadImage(name) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = () => resolve(); // fail soft — draw a placeholder shape instead
      img.src = "assets/" + name + ".png";
      images[name] = img;
    });
  }

  const allAssets = ASSET_NAMES.concat(NUMBER_NAMES);
  Promise.all(allAssets.map(loadImage)).then(start);

  // ---------------------------------------------------------------------
  // Audio (tiny WebAudio synth, no asset files needed)
  // ---------------------------------------------------------------------

  let actx = null;
  function tone(freq, dur, type, vol, delay) {
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      const t0 = actx.currentTime + (delay || 0);
      const osc = actx.createOscillator();
      const gain = actx.createGain();
      osc.type = type || "sine";
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(vol || 0.15, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(gain);
      gain.connect(actx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    } catch (e) { /* audio not available — ignore */ }
  }

  const sfx = {
    click: () => tone(520, 0.05, "square", 0.08),
    key: (n) => { tone(660 + n * 40, 0.14, "sine", 0.16); },
    win: () => { tone(660, 0.14, "sine", 0.18, 0); tone(880, 0.14, "sine", 0.18, 0.12); tone(1180, 0.22, "sine", 0.2, 0.24); },
    lose: () => { tone(220, 0.22, "sawtooth", 0.12, 0); tone(140, 0.28, "sawtooth", 0.12, 0.1); },
    nudge: () => tone(300, 0.08, "triangle", 0.1),
  };

  // ---------------------------------------------------------------------
  // Physics world
  // ---------------------------------------------------------------------

  const engine = Engine.create();
  engine.world.gravity.y = 1.05;

  const world = engine.world;

  function wall(x, y, w, h) {
    return Bodies.rectangle(x, y, w, h, { isStatic: true, friction: 0.05, restitution: 0.3, label: "wall" });
  }

  Composite.add(world, [
    wall(WALL_T / 2, H / 2, WALL_T, H * 2),
    wall(W - WALL_T / 2, H / 2, WALL_T, H * 2),
    wall(W / 2, -20, W, 40), // soft ceiling so the ball can't be flicked out the top
  ]);

  // Pivot arms
  const arms = ARM_DATA.map(([x, y, angle], i) => {
    const body = Bodies.rectangle(x, y, ARM_W, ARM_H, {
      isStatic: true,
      angle,
      friction: 0.02,
      restitution: 0.35,
      chamfer: { radius: 4 },
      label: "arm",
    });
    return { id: i, body, tweening: false, from: angle, to: angle, start: 0, dur: 190 };
  });
  Composite.add(world, arms.map((a) => a.body));

  // Keyhole ledges + sensors
  const keyholes = KEYHOLE_DATA.map(([x, y, w, num], i) => {
    const ledge = Bodies.rectangle(x, y + LEDGE_H / 2, w, LEDGE_H, {
      isStatic: true,
      friction: 0.03,
      restitution: 0.25,
      chamfer: { radius: 3 },
      label: "ledge",
    });
    const sensor = Bodies.circle(x, y - 4, KEY_SENSOR_R, {
      isStatic: true,
      isSensor: true,
      label: "keyhole",
    });
    sensor.keyholeIndex = i;
    Composite.add(world, [ledge, sensor]);
    return { index: i, x, y, num, ledge, sensor, hit: false };
  });

  // Ball
  const ball = Bodies.circle(SPAWN.x, SPAWN.y, BALL_R, {
    isStatic: true,
    friction: 0.02,
    frictionAir: 0.0015,
    restitution: 0.42,
    density: 0.004,
    label: "ball",
  });
  Composite.add(world, ball);

  // ---------------------------------------------------------------------
  // Game state
  // ---------------------------------------------------------------------

  let state = "ready"; // ready | falling | ended
  let attempt = 0;
  let allCleared = false;
  const particles = [];

  function buildKeyholeHud() {
    keyholeTrack.innerHTML = "";
    keyholes.forEach((k) => {
      const chip = document.createElement("div");
      chip.className = "keyhole-chip";
      chip.textContent = String(k.num);
      chip.id = "chip-" + k.index;
      keyholeTrack.appendChild(chip);
    });
  }
  buildKeyholeHud();

  function setStatus(msg, cls) {
    statusLine.textContent = msg;
    statusLine.className = "status" + (cls ? " " + cls : "");
  }

  function resetKeyholesVisual() {
    keyholes.forEach((k) => {
      k.hit = false;
      const chip = document.getElementById("chip-" + k.index);
      if (chip) chip.classList.remove("hit");
    });
  }

  function resetBonusVisual() {
    bonusSlot.classList.remove("unlocked");
    bonusLocked.hidden = false;
    bonusUnlocked.hidden = true;
  }

  function spawnParticles(x, y, color) {
    for (let i = 0; i < 14; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 1 + Math.random() * 2.5;
      particles.push({
        x, y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 1,
        life: 1,
        color,
      });
    }
  }

  function releaseBall() {
    if (state !== "ready") return;
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
    Body.setStatic(ball, false);
    Body.setVelocity(ball, { x: 0, y: 0 });
    state = "falling";
    attempt += 1;
    attemptsLine.textContent = "Attempt " + attempt;
    setStatus("Falling… click the magenta arms to steer the ball!");
    dropBtn.disabled = true;
    dropBtn.textContent = "Falling…";
  }

  function respawnBall() {
    Body.setStatic(ball, true);
    Body.setPosition(ball, SPAWN);
    Body.setVelocity(ball, { x: 0, y: 0 });
    Body.setAngularVelocity(ball, 0);
  }

  function endRound(won) {
    state = "ended";
    dropBtn.disabled = false;
    dropBtn.textContent = "Drop Again";
    if (won) {
      setStatus("🎉 Ball cleared every keyhole — great run!", "win");
      sfx.win();
    } else {
      const hitCount = keyholes.filter((k) => k.hit).length;
      setStatus("Ball exited the bottom — " + hitCount + "/" + keyholes.length + " keyholes triggered. Try again!", "lose");
      sfx.lose();
    }
  }

  function fullReset() {
    arms.forEach((a, i) => {
      a.tweening = false;
      Body.setAngle(a.body, ARM_DATA[i][2]);
    });
    resetKeyholesVisual();
    resetBonusVisual();
    respawnBall();
    allCleared = false;
    attempt = 0;
    state = "ready";
    dropBtn.disabled = false;
    dropBtn.textContent = "Drop Ball";
    attemptsLine.textContent = "Attempt 1";
    setStatus("Drop the ball, then click the magenta arms to steer it.");
  }

  // Buttons
  dropBtn.addEventListener("click", () => {
    if (state === "ended") {
      resetKeyholesVisual();
      resetBonusVisual();
      allCleared = false;
      respawnBall();
      state = "ready";
      releaseBall();
    } else {
      releaseBall();
    }
  });

  resetBtn.addEventListener("click", fullReset);

  nudgeBtn.addEventListener("click", () => {
    if (state !== "falling") return;
    sfx.nudge();
    Body.applyForce(ball, ball.position, {
      x: (Math.random() - 0.5) * 0.006,
      y: -0.003,
    });
  });

  // ---------------------------------------------------------------------
  // Arm rotation on click / tap
  // ---------------------------------------------------------------------

  function canvasPointFromEvent(evt) {
    const rect = canvas.getBoundingClientRect();
    const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
    const clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  function startArmTween(arm) {
    arm.tweening = true;
    arm.from = arm.body.angle;
    arm.to = arm.body.angle + Math.PI / 2;
    arm.start = performance.now();
  }

  function handlePointer(evt) {
    const p = canvasPointFromEvent(evt);
    for (const arm of arms) {
      if (arm.tweening) continue;
      if (!Bounds.contains(arm.body.bounds, p)) continue;
      if (Vertices.contains(arm.body.vertices, p)) {
        startArmTween(arm);
        sfx.click();
        evt.preventDefault();
        break;
      }
    }
  }

  canvas.addEventListener("click", handlePointer);
  canvas.addEventListener("touchstart", handlePointer, { passive: false });

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function updateArmTweens(now) {
    for (const arm of arms) {
      if (!arm.tweening) continue;
      const t = Math.min(1, (now - arm.start) / arm.dur);
      const eased = easeInOutCubic(t);
      Body.setAngle(arm.body, arm.from + (arm.to - arm.from) * eased);
      if (t >= 1) {
        arm.tweening = false;
        Body.setAngle(arm.body, arm.to);
      }
    }
  }

  // ---------------------------------------------------------------------
  // Collisions — keyhole triggers
  // ---------------------------------------------------------------------

  Events.on(engine, "collisionStart", (evt) => {
    for (const pair of evt.pairs) {
      const a = pair.bodyA, b = pair.bodyB;
      const keySensor = a.label === "keyhole" ? a : b.label === "keyhole" ? b : null;
      const other = keySensor === a ? b : a;
      if (keySensor && other.label === "ball") {
        const k = keyholes[keySensor.keyholeIndex];
        if (!k.hit) {
          k.hit = true;
          const chip = document.getElementById("chip-" + k.index);
          if (chip) chip.classList.add("hit");
          spawnParticles(k.x, k.y, "#f8e060");
          sfx.key(k.index);
          const hitCount = keyholes.filter((kk) => kk.hit).length;
          if (hitCount < keyholes.length) {
            setStatus("Keyhole " + k.num + " triggered! (" + hitCount + "/" + keyholes.length + ")");
          } else if (!allCleared) {
            allCleared = true;
            bonusSlot.classList.add("unlocked");
            bonusLocked.hidden = true;
            bonusUnlocked.hidden = false;
            setStatus("✨ All keyholes cleared — bonus star unlocked!", "win");
            spawnParticles(W / 2, H / 2, "#f8e060");
          }
        }
      }
    }
  });

  // ---------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------

  function drawSprite(img, x, y, w, h, angle) {
    ctx.save();
    ctx.translate(x, y);
    if (angle) ctx.rotate(angle);
    if (img && img.complete && img.naturalWidth) {
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
    }
    ctx.restore();
  }

  function drawFallbackRect(x, y, w, h, angle, fill, stroke) {
    ctx.save();
    ctx.translate(x, y);
    if (angle) ctx.rotate(angle);
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, 6);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function render() {
    ctx.clearRect(0, 0, W, H);

    // background
    ctx.fillStyle = "#101018";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#05050a";

    // faint grid dots for depth
    ctx.fillStyle = "#1a1a26";
    for (let gx = 30; gx < W; gx += 30) {
      for (let gy = 30; gy < H; gy += 30) {
        ctx.fillRect(gx, gy, 2, 2);
      }
    }

    // walls
    drawFallbackRect(WALL_T / 2, H / 2, WALL_T, H, 0, "#0d3f3a", "#05050a");
    drawFallbackRect(W - WALL_T / 2, H / 2, WALL_T, H, 0, "#0d3f3a", "#05050a");

    // ledges (platforms)
    keyholes.forEach((k) => {
      const body = k.ledge;
      const w = KEYHOLE_DATA[k.index][2];
      if (images.platform_narrow && images.platform_narrow.complete) {
        drawSprite(images.platform_narrow, body.position.x, body.position.y, w, LEDGE_H * 2.2, body.angle);
      } else {
        drawFallbackRect(body.position.x, body.position.y, w, LEDGE_H, body.angle, "#60d0c0", "#05050a");
      }
    });

    // pivot arms
    arms.forEach((arm) => {
      drawSprite(images.pivot_arm, arm.body.position.x, arm.body.position.y, ARM_W, ARM_H, arm.body.angle);
      if (!images.pivot_arm || !images.pivot_arm.complete) {
        drawFallbackRect(arm.body.position.x, arm.body.position.y, ARM_W, ARM_H, arm.body.angle, "#d840b8", "#05050a");
      }
    });

    // keyholes + numbers
    keyholes.forEach((k) => {
      const s = k.sensor;
      const d = KEY_SENSOR_R * 2;
      const glow = k.hit;
      if (glow) {
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = "#f8e060";
        ctx.beginPath();
        ctx.arc(s.position.x, s.position.y, d * 0.75, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      drawSprite(images.keyhole, s.position.x, s.position.y, d, d, 0);
      if (!images.keyhole || !images.keyhole.complete) {
        ctx.save();
        ctx.fillStyle = glow ? "#f8e060" : "#8a7a30";
        ctx.strokeStyle = "#05050a";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(s.position.x, s.position.y, d / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      const numImg = images["number_" + k.num];
      drawSprite(numImg, s.position.x, s.position.y + 1, 16, 24, 0);
    });

    // particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.05;
      p.life -= 0.025;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
      ctx.restore();
    }

    // ball
    drawSprite(images.ball, ball.position.x, ball.position.y, BALL_R * 2.2, BALL_R * 2.2, ball.angle);
    if (!images.ball || !images.ball.complete) {
      ctx.save();
      ctx.fillStyle = "#f8e060";
      ctx.strokeStyle = "#05050a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ball.position.x, ball.position.y, BALL_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // exit chute marker at bottom
    ctx.save();
    ctx.strokeStyle = "#60d0c0";
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(0, H - 4);
    ctx.lineTo(W, H - 4);
    ctx.stroke();
    ctx.restore();
  }

  function tick(now) {
    updateArmTweens(now);
    Engine.update(engine, 1000 / 60);

    if (state === "falling" && ball.position.y - BALL_R > H) {
      endRound(allCleared);
    }

    render();
    requestAnimationFrame(tick);
  }

  function start() {
    setStatus("Drop the ball, then click the magenta arms to steer it.");
    requestAnimationFrame(tick);
  }
})();
