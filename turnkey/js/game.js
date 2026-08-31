// TURNKEY — a Lights-Out style keyhole/lock puzzle built with Kenney's
// rolling-ball asset pack, recolored to the game's ink / yellow / magenta / teal palette.
//
// Rule: clicking a keyhole toggles it and its orthogonal neighbors between
// locked (ink) and unlocked (yellow). Get every keyhole unlocked in as few
// clicks as possible.

(function () {
  "use strict";

  var board = document.getElementById("board");
  var movesValue = document.getElementById("movesValue");
  var bestValue = document.getElementById("bestValue");
  var statusLine = document.getElementById("statusLine");
  var sizeButtons = Array.prototype.slice.call(document.querySelectorAll(".size-btn"));
  var newBtn = document.getElementById("newBtn");
  var resetBtn = document.getElementById("resetBtn");
  var solvedOverlay = document.getElementById("solvedOverlay");
  var solvedLine = document.getElementById("solvedLine");
  var playAgainBtn = document.getElementById("playAgainBtn");
  var starBurst = document.getElementById("starBurst");
  var trophySlot = document.getElementById("trophySlot");
  var trophyLocked = document.getElementById("trophyLocked");
  var trophyUnlocked = document.getElementById("trophyUnlocked");

  var STORAGE_PREFIX = "turnkey-best-";
  var FLIP_MS = 260;

  var size = 5;
  var grid = [];          // current state, 1 = unlocked, 0 = locked
  var startGrid = [];     // the scrambled state this puzzle began at
  var moves = 0;
  var solved = false;
  var cellEls = [];

  function idx(r, c) { return r * size + c; }

  function neighbors(r, c) {
    var out = [[r, c]];
    if (r > 0) out.push([r - 1, c]);
    if (r < size - 1) out.push([r + 1, c]);
    if (c > 0) out.push([r, c - 1]);
    if (c < size - 1) out.push([r, c + 1]);
    return out;
  }

  function applyToggle(target, r, c) {
    neighbors(r, c).forEach(function (rc) {
      var i = idx(rc[0], rc[1]);
      target[i] = target[i] ? 0 : 1;
    });
  }

  function isSolved(g) {
    for (var i = 0; i < g.length; i++) if (!g[i]) return false;
    return true;
  }

  function bestKey() { return STORAGE_PREFIX + size; }

  function getBest() {
    var raw = null;
    try { raw = localStorage.getItem(bestKey()); } catch (e) { /* ignore */ }
    return raw ? parseInt(raw, 10) : null;
  }

  function maybeSaveBest(n) {
    var current = getBest();
    if (current === null || n < current) {
      try { localStorage.setItem(bestKey(), String(n)); } catch (e) { /* ignore */ }
      return true;
    }
    return false;
  }

  function renderBest() {
    var b = getBest();
    bestValue.textContent = b === null ? "—" : String(b);
  }

  // ---------- puzzle generation ----------

  function generatePuzzle(n) {
    size = n;
    board.style.setProperty("--size", size);

    var g = [];
    for (var i = 0; i < size * size; i++) g.push(1); // all unlocked = solved

    var scrambleClicks = size * size + Math.floor(Math.random() * size);
    for (var k = 0; k < scrambleClicks; k++) {
      var r = Math.floor(Math.random() * size);
      var c = Math.floor(Math.random() * size);
      applyToggle(g, r, c);
    }
    // guarantee it isn't already solved
    if (isSolved(g)) {
      applyToggle(g, Math.floor(size / 2), Math.floor(size / 2));
    }

    grid = g.slice();
    startGrid = g.slice();
    moves = 0;
    solved = false;

    buildBoardDom();
    syncCells();
    renderBest();
    updateMoves();
    statusLine.textContent = "Click a keyhole to turn it — and its neighbors — toward Yellow.";
    resetTrophy();
  }

  function restartFromScramble() {
    grid = startGrid.slice();
    moves = 0;
    solved = false;
    syncCells();
    updateMoves();
    statusLine.textContent = "Board reset to its starting scramble.";
    resetTrophy();
  }

  // ---------- DOM ----------

  function buildBoardDom() {
    board.innerHTML = "";
    cellEls = [];
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "cell";
        btn.dataset.r = r;
        btn.dataset.c = c;

        var keyhole = document.createElement("span");
        keyhole.className = "keyhole";
        btn.appendChild(keyhole);

        var badge = document.createElement("span");
        badge.className = "rotate-badge";
        btn.appendChild(badge);

        btn.addEventListener("click", onCellClick);
        btn.addEventListener("pointerenter", onCellHoverIn);
        btn.addEventListener("pointerleave", onCellHoverOut);
        btn.addEventListener("focus", onCellHoverIn);
        btn.addEventListener("blur", onCellHoverOut);

        board.appendChild(btn);
        cellEls.push(btn);
      }
    }
  }

  function syncCells() {
    for (var i = 0; i < cellEls.length; i++) {
      var on = !!grid[i];
      cellEls[i].classList.toggle("is-on", on);
      cellEls[i].setAttribute(
        "aria-label",
        "Keyhole " + (Math.floor(i / size) + 1) + "-" + ((i % size) + 1) + ", " + (on ? "unlocked" : "locked")
      );
      cellEls[i].setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  function updateMoves() {
    movesValue.textContent = String(moves);
  }

  function resetTrophy() {
    trophySlot.classList.remove("pop");
    trophyLocked.hidden = false;
    trophyUnlocked.hidden = true;
    solvedOverlay.hidden = true;
  }

  // ---------- hover preview ----------

  function affectedIndices(r, c) {
    return neighbors(r, c).map(function (rc) { return idx(rc[0], rc[1]); });
  }

  function onCellHoverIn(e) {
    if (solved) return;
    var btn = e.currentTarget;
    var r = parseInt(btn.dataset.r, 10);
    var c = parseInt(btn.dataset.c, 10);
    affectedIndices(r, c).forEach(function (i) { cellEls[i].classList.add("is-preview"); });
    btn.classList.add("is-target");
  }

  function onCellHoverOut(e) {
    var btn = e.currentTarget;
    var r = parseInt(btn.dataset.r, 10);
    var c = parseInt(btn.dataset.c, 10);
    affectedIndices(r, c).forEach(function (i) { cellEls[i].classList.remove("is-preview"); });
    btn.classList.remove("is-target");
  }

  // ---------- clicking ----------

  function onCellClick(e) {
    if (solved) return;
    var btn = e.currentTarget;
    var r = parseInt(btn.dataset.r, 10);
    var c = parseInt(btn.dataset.c, 10);
    var touched = affectedIndices(r, c);

    applyToggle(grid, r, c);
    moves += 1;
    updateMoves();

    touched.forEach(function (i) { cellEls[i].classList.add("is-flipping"); });

    window.setTimeout(function () {
      touched.forEach(function (i) { cellEls[i].classList.remove("is-flipping"); });
      syncCells();

      if (isSolved(grid)) {
        onSolved();
      }
    }, FLIP_MS);
  }

  function onSolved() {
    solved = true;
    var isNewBest = maybeSaveBest(moves);
    renderBest();

    trophySlot.classList.add("pop");
    trophyLocked.hidden = true;
    trophyUnlocked.hidden = false;

    solvedLine.textContent = "Unlocked in " + moves + " move" + (moves === 1 ? "" : "s") + "." +
      (isNewBest ? " New best!" : "");
    statusLine.textContent = "Every keyhole is unlocked!";

    spawnStarBurst();
    solvedOverlay.hidden = false;
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

  // ---------- controls ----------

  sizeButtons.forEach(function (b) {
    b.addEventListener("click", function () {
      sizeButtons.forEach(function (x) { x.classList.toggle("active", x === b); });
      generatePuzzle(parseInt(b.dataset.size, 10));
    });
  });

  newBtn.addEventListener("click", function () { generatePuzzle(size); });
  resetBtn.addEventListener("click", restartFromScramble);
  playAgainBtn.addEventListener("click", function () {
    solvedOverlay.hidden = true;
    generatePuzzle(size);
  });

  // ---------- init ----------

  sizeButtons.forEach(function (b) {
    b.classList.toggle("active", parseInt(b.dataset.size, 10) === size);
  });
  generatePuzzle(size);
})();
