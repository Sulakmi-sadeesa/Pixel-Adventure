(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const W = canvas.width;
  const H = canvas.height;

  const GRAVITY = 0.7;
  const FRICTION = 0.82;
  const MOVE_ACCEL = 0.9;
  const MAX_SPEED = 6;
  const JUMP_POWER = -13.5;

  const $ = (id) => document.getElementById(id);

  const startScreen = $('startScreen');
  const levelScreen = $('levelScreen');
  const winScreen = $('winScreen');
  const loseScreen = $('loseScreen');
  const finalScreen = $('finalScreen');

  const winScoreEl = $('winScore');
  const loseScoreEl = $('loseScore');
  const finalScoreEl = $('finalScore');
  const winInfoEl = $('winInfo');
  const loseInfoEl = $('loseInfo');

  const levelGrid = $('levelGrid');
  const bestScoreEl = $('bestScore');

  const touch = { left: false, right: false, jump: false };

  let state = 'menu';
  let camera = { x: 0, y: 0 };
  let keys = {};
  let levelIndex = 0;
  let totalScore = 0;
  let particles = [];
  let floatingTexts = [];
  let paused = false;

  const STORAGE_BEST = 'pixelAdvBest';
  const STORAGE_UNLOCKED = 'pixelAdvUnlocked';

  let bestScore = Number(localStorage.getItem(STORAGE_BEST) || 0);
  let unlockedLevel = Number(localStorage.getItem(STORAGE_UNLOCKED) || 0);
  if (isNaN(unlockedLevel) || unlockedLevel < 0) unlockedLevel = 0;

  function saveProgress() {
    localStorage.setItem(STORAGE_BEST, String(bestScore));
    localStorage.setItem(STORAGE_UNLOCKED, String(unlockedLevel));
  }

  if (bestScoreEl) bestScoreEl.textContent = 'Best score: ' + bestScore;

  const audioCtx = (() => {
    let actx = null;
    return {
      get() {
        if (!actx) {
          try { actx = new (window.AudioContext || window.webkitAudioContext)(); }
          catch (e) { actx = null; }
        }
        if (actx && actx.state === 'suspended') actx.resume();
        return actx;
      }
    };
  })();

  function beep(freq, duration, type = 'square', volume = 0.08) {
    const ac = audioCtx.get();
    if (!ac) return;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start();
    osc.stop(ac.currentTime + duration);
  }

  function sfxJump() { beep(440, 0.12, 'square', 0.06); setTimeout(() => beep(660, 0.1, 'square', 0.05), 60); }
  function sfxCoin() { beep(880, 0.08, 'square', 0.06); setTimeout(() => beep(1320, 0.12, 'square', 0.05), 70); }
  function sfxHurt() { beep(220, 0.15, 'sawtooth', 0.1); setTimeout(() => beep(140, 0.25, 'sawtooth', 0.1), 120); }
  function sfxWin() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.18, 'square', 0.07), i * 120)); }
  function sfxStomp() { beep(180, 0.1, 'square', 0.08); setTimeout(() => beep(120, 0.1, 'square', 0.06), 60); }
  function sfxFinal() { [523, 659, 784, 1047, 1319].forEach((f, i) => setTimeout(() => beep(f, 0.25, 'square', 0.08), i * 160)); }

  class Entity {
    constructor(x, y, w, h) {
      this.x = x; this.y = y;
      this.w = w; this.h = h;
      this.vx = 0; this.vy = 0;
      this.alive = true;
    }
    get left() { return this.x; }
    get right() { return this.x + this.w; }
    get top() { return this.y; }
    get bottom() { return this.y + this.h; }
    intersects(o) {
      return this.left < o.right && this.right > o.left &&
             this.top < o.bottom && this.bottom > o.top;
    }
  }

  class Player extends Entity {
    constructor(x, y) {
      super(x, y, 32, 40);
      this.onGround = false;
      this.facing = 1;
      this.coins = 0;
      this.health = 3;
      this.invuln = 0;
      this.animTimer = 0;
      this.animFrame = 0;
      this.jumpHeld = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
    }

    update(platforms, enemies, coins, spikes, goal) {
      const left = keys['ArrowLeft'] || keys['a'] || keys['A'] || touch.left;
      const right = keys['ArrowRight'] || keys['d'] || keys['D'] || touch.right;
      const jumpPressed = keys[' '] || keys['ArrowUp'] || keys['w'] || keys['W'] || touch.jump;

      if (this.invuln > 0) this.invuln--;

      if (left) { this.vx -= MOVE_ACCEL; this.facing = -1; }
      if (right) { this.vx += MOVE_ACCEL; this.facing = 1; }
      if (!left && !right) this.vx *= FRICTION;

      this.vx = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, this.vx));

      if (jumpPressed && !this.jumpHeld) this.jumpBuffer = 8;
      if (this.jumpBuffer > 0) this.jumpBuffer--;
      this.jumpHeld = jumpPressed;

      if (this.onGround) this.coyote = 8;
      else if (this.coyote > 0) this.coyote--;

      if (this.jumpBuffer > 0 && this.coyote > 0) {
        this.vy = JUMP_POWER;
        this.jumpBuffer = 0;
        this.coyote = 0;
        this.onGround = false;
        sfxJump();
      }

      if (!jumpPressed && this.vy < 0) this.vy *= 0.5;

      this.vy += GRAVITY;
      if (this.vy > 20) this.vy = 20;

      this.x += this.vx;
      this.handleCollisions(platforms, 'x');

      this.y += this.vy;
      this.onGround = false;
      this.handleCollisions(platforms, 'y');

      if (this.y > H + 200) this.hurt(999);

      if (left || right) {
        this.animTimer++;
        if (this.animTimer > 6) { this.animTimer = 0; this.animFrame = (this.animFrame + 1) % 4; }
      } else {
        this.animFrame = 0;
      }

      for (const coin of coins) {
        if (!coin.collected && this.intersects(coin)) {
          coin.collected = true;
          this.coins++;
          totalScore += 10;
          sfxCoin();
          spawnParticles(coin.x + coin.w / 2, coin.y + coin.h / 2, '#ffd166', 10);
          floatingTexts.push({ x: coin.x + coin.w / 2, y: coin.y, text: '+10', life: 50, color: '#ffd166' });
        }
      }

      for (const spike of spikes) {
        if (this.intersects(spike)) this.hurt(1);
      }

      for (const enemy of enemies) {
        if (!enemy.alive) continue;
        if (this.intersects(enemy)) {
          if (this.vy > 0 && this.bottom - this.vy <= enemy.top + 10) {
            enemy.alive = false;
            this.vy = -9;
            totalScore += 5;
            sfxStomp();
            spawnParticles(enemy.x + enemy.w / 2, enemy.y + enemy.h / 2, '#6bcb77', 12);
            floatingTexts.push({ x: enemy.x + enemy.w / 2, y: enemy.y, text: '+5', life: 50, color: '#6bcb77' });
          } else {
            this.hurt(1);
          }
        }
      }

      if (goal && this.intersects(goal)) winLevel();

      this.x = Math.max(0, this.x);
    }

    handleCollisions(platforms, axis) {
      for (const p of platforms) {
        if (!this.intersects(p)) continue;
        if (axis === 'x') {
          if (this.vx > 0) this.x = p.left - this.w;
          else if (this.vx < 0) this.x = p.right;
          this.vx = 0;
        } else {
          if (this.vy > 0) {
            this.y = p.top - this.h;
            this.vy = 0;
            this.onGround = true;
          } else if (this.vy < 0) {
            this.y = p.bottom;
            this.vy = 0;
          }
        }
      }
    }

    hurt(amount) {
      if (this.invuln > 0 && amount < 999) return;
      if (amount >= 999) { this.die(); return; }
      this.health -= amount;
      this.invuln = 90;
      this.vy = -6;
      this.vx = this.facing * -6;
      sfxHurt();
      spawnParticles(this.x + this.w / 2, this.y + this.h / 2, '#ff6b6b', 15);
      if (this.health <= 0) this.die();
    }

    die() {
      if (state !== 'playing') return;
      state = 'lost';
      if (loseScoreEl) loseScoreEl.textContent = 'Score: ' + totalScore;
      if (loseInfoEl) loseInfoEl.textContent = 'You reached Level ' + (levelIndex + 1) + '. Try again!';
      if (loseScreen) loseScreen.classList.remove('hidden');
      updateBestScore();
    }

    draw() {
      if (this.invuln > 0 && Math.floor(this.invuln / 4) % 2 === 0) return;

      const x = Math.round(this.x - camera.x);
      const y = Math.round(this.y);
      const w = this.w;
      const h = this.h;

      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(x + 2, y + h, w - 4, 3);

      ctx.fillStyle = '#e8672e';
      ctx.fillRect(x + 4, y + 4, w - 8, h - 8);
      ctx.fillStyle = '#ff8c42';
      ctx.fillRect(x + 4, y + 4, w - 8, 6);
      ctx.fillStyle = '#c94f1c';
      ctx.fillRect(x + 4, y + h - 8, w - 8, 4);

      ctx.fillStyle = '#ffe0b2';
      ctx.fillRect(x + 8, y + 10, w - 16, h - 20);

      ctx.fillStyle = '#fff';
      ctx.fillRect(x + (this.facing === 1 ? 16 : 8), y + 14, 6, 6);
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(x + (this.facing === 1 ? 18 : 10), y + 16, 3, 3);

      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(x + (this.facing === 1 ? 14 : 18), y + 22, 4, 2);

      ctx.fillStyle = '#c94f1c';
      const bob = this.onGround && Math.abs(this.vx) > 0.5 ? (this.animFrame < 2 ? 0 : 2) : 0;
      ctx.fillRect(x + 4, y + h - 4, 8, 4 + bob);
      ctx.fillRect(x + w - 12, y + h - 4, 8, 4 - bob);

      ctx.fillStyle = '#e8672e';
      ctx.fillRect(x + 4, y, 6, 6);
      ctx.fillRect(x + w - 10, y, 6, 6);

      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(x + w - 4, y + h - 8, 4, 4);
    }
  }

  class Enemy extends Entity {
    constructor(x, y, leftBound, rightBound, speed = 1.2) {
      super(x, y, 36, 32);
      this.vx = speed;
      this.leftBound = leftBound;
      this.rightBound = rightBound;
      this.alive = true;
      this.animTimer = 0;
    }

    update() {
      if (!this.alive) return;
      this.x += this.vx;
      if (this.x <= this.leftBound) { this.x = this.leftBound; this.vx = Math.abs(this.vx); }
      if (this.x + this.w >= this.rightBound) { this.x = this.rightBound - this.w; this.vx = -Math.abs(this.vx); }
      this.animTimer++;
    }

    draw() {
      if (!this.alive) return;
      const x = Math.round(this.x - camera.x);
      const y = Math.round(this.y);
      const w = this.w;
      const h = this.h;
      const squash = Math.sin(this.animTimer * 0.15) * 2;

      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(x + 2, y + h, w - 4, 3);

      ctx.fillStyle = '#4a9c5c';
      ctx.fillRect(x + 2, y + 4 + squash, w - 4, h - 8 - squash * 2);

      ctx.fillStyle = '#6bcb77';
      ctx.fillRect(x + 2, y + 4 + squash, w - 4, 6);

      ctx.fillStyle = '#2e6b3a';
      ctx.fillRect(x + 2, y + h - 6, w - 4, 4);

      ctx.fillStyle = '#fff';
      ctx.fillRect(x + 8, y + 12 + squash, 6, 6);
      ctx.fillRect(x + w - 14, y + 12 + squash, 6, 6);
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(x + 10, y + 14 + squash, 3, 3);
      ctx.fillRect(x + w - 12, y + 14 + squash, 3, 3);
    }
  }

  function spawnParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 4;
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2,
        life: 30 + Math.random() * 20,
        maxLife: 50,
        color,
        size: 2 + Math.random() * 4
      });
    }
  }

  function updateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.3;
      p.vx *= 0.98;
      p.life--;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (let i = floatingTexts.length - 1; i >= 0; i--) {
      const t = floatingTexts[i];
      t.y -= 1;
      t.life--;
      if (t.life <= 0) floatingTexts.splice(i, 1);
    }
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x - camera.x), Math.round(p.y), p.size, p.size);
    }
    ctx.globalAlpha = 1;

    ctx.font = 'bold 16px Courier New';
    ctx.textAlign = 'center';
    for (const t of floatingTexts) {
      ctx.globalAlpha = Math.min(1, t.life / 30);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x - camera.x, t.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }

  function makeGround(width) { return { x: 0, y: 480, w: width, h: 60, type: 'ground' }; }
  function makeWall() { return { x: 0, y: 0, w: 40, h: 540, type: 'wall' }; }
  function plat(x, y, w, type = 'dirt') { return { x, y, w, h: 30, type }; }
  function coin(x, y) { return { x, y }; }
  function coinRow(x, y, n, gap = 50) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(coin(x + i * gap, y));
    return out;
  }
  function coinArc(cx, cy, n, spread = 60) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1)) * 2 - 1;
      out.push(coin(cx + t * spread, cy - (1 - t * t) * 60));
    }
    return out;
  }
  function enemy(x, left, right, speed = 1.2) { return { x, y: 448, left, right, speed }; }
  function spike(x) { return { x, y: 448, w: 24, h: 32 }; }
  function spikeRun(x, n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(spike(x + i * 24));
    return out;
  }
  function makeGoal(x) { return { x, y: 380, w: 40, h: 100 }; }

  const LEVELS = [
    {
      width: 3200, playerStart: { x: 80, y: 380 },
      platforms: [
        makeGround(3200), makeWall(),
        plat(500, 400, 200), plat(900, 340, 150),
        plat(1200, 400, 250), plat(1600, 300, 150),
        plat(1900, 380, 200), plat(2250, 320, 180), plat(2600, 400, 220)
      ],
      coins: [
        ...coinRow(550, 340, 3), ...coinRow(940, 280, 2),
        ...coinRow(1280, 340, 3), ...coinRow(1650, 240, 2),
        ...coinRow(1980, 320, 2), ...coinRow(2320, 260, 2),
        ...coinRow(2680, 340, 3), ...coinArc(1440, 260, 3)
      ],
      enemies: [enemy(700, 620, 900), enemy(1450, 1300, 1700), enemy(2050, 1900, 2250), enemy(2750, 2600, 3000)],
      spikes: [spike(1150), spike(1174), spike(2450), spike(2474)],
      goal: makeGoal(3080)
    },
    {
      width: 3600, playerStart: { x: 80, y: 380 },
      platforms: [
        makeGround(3600), makeWall(),
        plat(400, 380, 150), plat(700, 300, 150), plat(1000, 380, 150),
        plat(1300, 280, 200), plat(1700, 380, 150), plat(2000, 300, 180),
        plat(2350, 220, 150), plat(2700, 380, 200), plat(3050, 320, 180)
      ],
      coins: [
        ...coinRow(440, 320, 2), ...coinRow(740, 240, 2),
        ...coinRow(1040, 320, 2), ...coinRow(1350, 220, 3),
        ...coinRow(1740, 320, 2), ...coinRow(2050, 240, 2),
        ...coinRow(2400, 160, 2), ...coinRow(2750, 320, 2),
        ...coinRow(3100, 260, 2), ...coinArc(1650, 240, 3)
      ],
      enemies: [enemy(550, 450, 700), enemy(1150, 1000, 1300), enemy(1550, 1400, 1700), enemy(2250, 2100, 2400), enemy(2900, 2700, 3050)],
      spikes: [...spikeRun(900, 2), ...spikeRun(1900, 2), spike(2600)],
      goal: makeGoal(3450)
    },
    {
      width: 3800, playerStart: { x: 80, y: 380 },
      platforms: [
        makeGround(3800), makeWall(),
        plat(400, 380, 120), plat(650, 300, 120), plat(900, 380, 100),
        plat(1150, 280, 120), plat(1450, 380, 100), plat(1700, 300, 120),
        plat(2000, 380, 100), plat(2250, 260, 120), plat(2550, 380, 100),
        plat(2800, 300, 120), plat(3100, 380, 150)
      ],
      coins: [
        ...coinRow(420, 320, 2), ...coinRow(670, 240, 2),
        ...coinRow(920, 320, 2), ...coinRow(1170, 220, 2),
        ...coinRow(1470, 320, 2), ...coinRow(1720, 240, 2),
        ...coinRow(2020, 320, 2), ...coinRow(2270, 200, 2),
        ...coinRow(2570, 320, 2), ...coinRow(2820, 240, 2), ...coinRow(3150, 320, 2)
      ],
      enemies: [enemy(550, 450, 650), enemy(1050, 950, 1150), enemy(1550, 1450, 1650), enemy(2150, 2050, 2250), enemy(2900, 2800, 3000)],
      spikes: [...spikeRun(800, 2), ...spikeRun(1350, 2), ...spikeRun(2450, 2), ...spikeRun(2950, 2)],
      goal: makeGoal(3650)
    },
    {
      width: 3400, playerStart: { x: 80, y: 380 },
      platforms: [
        makeGround(3400), makeWall(),
        plat(400, 400, 130), plat(600, 320, 130), plat(800, 240, 130),
        plat(1000, 320, 130), plat(1200, 400, 130), plat(1450, 320, 130),
        plat(1650, 240, 130), plat(1850, 160, 130), plat(2100, 240, 130),
        plat(2300, 320, 130), plat(2550, 400, 150)
      ],
      coins: [
        ...coinRow(420, 340, 2), ...coinRow(620, 260, 2), ...coinRow(820, 180, 2),
        ...coinRow(1020, 260, 2), ...coinRow(1220, 340, 2), ...coinRow(1470, 260, 2),
        ...coinRow(1670, 180, 2), ...coinRow(1870, 100, 2), ...coinRow(2120, 180, 2),
        ...coinRow(2320, 260, 2), ...coinRow(2600, 340, 2)
      ],
      enemies: [enemy(500, 400, 600), enemy(1100, 1000, 1200), enemy(1500, 1450, 1600), enemy(2200, 2100, 2300), enemy(2700, 2550, 2850)],
      spikes: [...spikeRun(700, 2), ...spikeRun(1350, 2), ...spikeRun(2000, 2), ...spikeRun(2450, 2)],
      goal: makeGoal(3250)
    },
    {
      width: 4000, playerStart: { x: 80, y: 380 },
      platforms: [
        makeGround(4000), makeWall(),
        plat(500, 400, 200), plat(900, 340, 200), plat(1300, 400, 200),
        plat(1700, 340, 200), plat(2100, 400, 200), plat(2500, 340, 200),
        plat(2900, 400, 200), plat(3300, 340, 200)
      ],
      coins: [
        ...coinRow(550, 340, 3), ...coinRow(950, 280, 3), ...coinRow(1350, 340, 3),
        ...coinRow(1750, 280, 3), ...coinRow(2150, 340, 3), ...coinRow(2550, 280, 3),
        ...coinRow(2950, 340, 3), ...coinRow(3350, 280, 3)
      ],
      enemies: [
        enemy(600, 500, 700), enemy(1000, 900, 1100), enemy(1400, 1300, 1500),
        enemy(1800, 1700, 1900), enemy(2200, 2100, 2300), enemy(2600, 2500, 2700),
        enemy(3000, 2900, 3100), enemy(3400, 3300, 3500)
      ],
      spikes: [...spikeRun(800, 3), ...spikeRun(1600, 3), ...spikeRun(2400, 3), ...spikeRun(3200, 3)],
      goal: makeGoal(3850)
    },
    {
      width: 3600, playerStart: { x: 80, y: 380 },
      platforms: [
        makeGround(3600), makeWall(),
        plat(400, 400, 150), plat(700, 340, 150), plat(1000, 400, 150),
        plat(1300, 340, 150), plat(1600, 400, 150), plat(1900, 340, 150),
        plat(2200, 400, 150), plat(2500, 340, 150), plat(2800, 400, 150), plat(3100, 340, 150)
      ],
      coins: [
        ...coinRow(440, 340, 2), ...coinRow(740, 280, 2), ...coinRow(1040, 340, 2),
        ...coinRow(1340, 280, 2), ...coinRow(1640, 340, 2), ...coinRow(1940, 280, 2),
        ...coinRow(2240, 340, 2), ...coinRow(2540, 280, 2), ...coinRow(2840, 340, 2), ...coinRow(3140, 280, 2)
      ],
      enemies: [enemy(550, 450, 650), enemy(1150, 1050, 1250), enemy(1750, 1650, 1850), enemy(2350, 2250, 2450), enemy(2950, 2850, 3050)],
      spikes: [
        ...spikeRun(600, 4), ...spikeRun(900, 4), ...spikeRun(1200, 4),
        ...spikeRun(1500, 4), ...spikeRun(1800, 4), ...spikeRun(2100, 4),
        ...spikeRun(2400, 4), ...spikeRun(2700, 4), ...spikeRun(3000, 4)
      ],
      goal: makeGoal(3450)
    },
    {
      width: 3800, playerStart: { x: 80, y: 380 },
      platforms: [
        makeGround(3800), makeWall(),
        plat(400, 400, 80), plat(600, 320, 80), plat(800, 240, 80),
        plat(1000, 320, 80), plat(1200, 400, 80), plat(1400, 320, 80),
        plat(1600, 240, 80), plat(1800, 160, 80), plat(2000, 240, 80),
        plat(2200, 320, 80), plat(2400, 400, 80), plat(2600, 320, 80),
        plat(2800, 240, 80), plat(3000, 320, 80), plat(3200, 400, 100)
      ],
      coins: [
        ...coinRow(420, 340, 2), ...coinRow(620, 260, 2), ...coinRow(820, 180, 2),
        ...coinRow(1020, 260, 2), ...coinRow(1220, 340, 2), ...coinRow(1420, 260, 2),
        ...coinRow(1620, 180, 2), ...coinRow(1820, 100, 2), ...coinRow(2020, 180, 2),
        ...coinRow(2220, 260, 2), ...coinRow(2420, 340, 2), ...coinRow(2620, 260, 2),
        ...coinRow(2820, 180, 2), ...coinRow(3020, 260, 2), ...coinRow(3250, 340, 2)
      ],
      enemies: [enemy(500, 400, 600), enemy(1100, 1000, 1200), enemy(1700, 1600, 1800), enemy(2300, 2200, 2400), enemy(2900, 2800, 3000)],
      spikes: [...spikeRun(700, 2), ...spikeRun(1300, 2), ...spikeRun(1900, 2), ...spikeRun(2500, 2), ...spikeRun(3100, 2)],
      goal: makeGoal(3650)
    },
    {
      width: 4000, playerStart: { x: 80, y: 380 },
      platforms: [
        makeGround(4000), makeWall(),
        plat(400, 380, 120), plat(650, 280, 120), plat(900, 180, 120),
        plat(1150, 280, 120), plat(1400, 380, 120), plat(1650, 280, 120),
        plat(1900, 180, 120), plat(2150, 280, 120), plat(2400, 380, 120),
        plat(2650, 280, 120), plat(2900, 180, 120), plat(3150, 280, 120), plat(3400, 380, 150)
      ],
      coins: [
        ...coinRow(420, 320, 2), ...coinRow(670, 220, 2), ...coinRow(920, 120, 2),
        ...coinRow(1170, 220, 2), ...coinRow(1420, 320, 2), ...coinRow(1670, 220, 2),
        ...coinRow(1920, 120, 2), ...coinRow(2170, 220, 2), ...coinRow(2420, 320, 2),
        ...coinRow(2670, 220, 2), ...coinRow(2920, 120, 2), ...coinRow(3170, 220, 2), ...coinRow(3450, 320, 2)
      ],
      enemies: [enemy(500, 400, 600), enemy(1200, 1100, 1300), enemy(1900, 1800, 2000), enemy(2600, 2500, 2700), enemy(3300, 3200, 3400)],
      spikes: [...spikeRun(800, 3), ...spikeRun(1500, 3), ...spikeRun(2200, 3), ...spikeRun(2900, 3), ...spikeRun(3600, 2)],
      goal: makeGoal(3850)
    },
    {
      width: 4200, playerStart: { x: 80, y: 380 },
      platforms: [
        makeGround(4200), makeWall(),
        plat(400, 400, 100), plat(600, 340, 100), plat(800, 280, 100),
        plat(1000, 340, 100), plat(1200, 400, 100), plat(1400, 340, 100),
        plat(1600, 280, 100), plat(1800, 220, 100), plat(2000, 280, 100),
        plat(2200, 340, 100), plat(2400, 400, 100), plat(2600, 340, 100),
        plat(2800, 280, 100), plat(3000, 220, 100), plat(3200, 280, 100),
        plat(3400, 340, 100), plat(3600, 400, 150)
      ],
      coins: [
        ...coinRow(420, 340, 2), ...coinRow(620, 280, 2), ...coinRow(820, 220, 2),
        ...coinRow(1020, 280, 2), ...coinRow(1220, 340, 2), ...coinRow(1420, 280, 2),
        ...coinRow(1620, 220, 2), ...coinRow(1820, 160, 2), ...coinRow(2020, 220, 2),
        ...coinRow(2220, 280, 2), ...coinRow(2420, 340, 2), ...coinRow(2620, 280, 2),
        ...coinRow(2820, 220, 2), ...coinRow(3020, 160, 2), ...coinRow(3220, 220, 2),
        ...coinRow(3420, 280, 2), ...coinRow(3650, 340, 2)
      ],
      enemies: [
        enemy(500, 400, 600), enemy(1100, 1000, 1200), enemy(1700, 1600, 1800),
        enemy(2300, 2200, 2400), enemy(2900, 2800, 3000), enemy(3500, 3400, 3600)
      ],
      spikes: [...spikeRun(700, 2), ...spikeRun(1300, 2), ...spikeRun(1900, 2), ...spikeRun(2500, 2), ...spikeRun(3100, 2), ...spikeRun(3700, 2)],
      goal: makeGoal(4050)
    },
    {
      width: 4400, playerStart: { x: 80, y: 380 },
      platforms: [
        makeGround(4400), makeWall(),
        plat(400, 400, 200), plat(800, 340, 200), plat(1200, 400, 200),
        plat(1600, 340, 200), plat(2000, 400, 200), plat(2400, 340, 200),
        plat(2800, 400, 200), plat(3200, 340, 200), plat(3600, 400, 200)
      ],
      coins: [
        ...coinRow(450, 340, 4), ...coinRow(850, 280, 4), ...coinRow(1250, 340, 4),
        ...coinRow(1650, 280, 4), ...coinRow(2050, 340, 4), ...coinRow(2450, 280, 4),
        ...coinRow(2850, 340, 4), ...coinRow(3250, 280, 4), ...coinRow(3650, 340, 4)
      ],
      enemies: [
        enemy(500, 400, 600), enemy(700, 600, 800), enemy(1300, 1200, 1400),
        enemy(1500, 1400, 1600), enemy(2100, 2000, 2200), enemy(2300, 2200, 2400),
        enemy(2900, 2800, 3000), enemy(3100, 3000, 3200), enemy(3700, 3600, 3800)
      ],
      spikes: [...spikeRun(1000, 3), ...spikeRun(1800, 3), ...spikeRun(2600, 3), ...spikeRun(3400, 3), ...spikeRun(4000, 3)],
      goal: makeGoal(4250)
    },
    {
      width: 4600, playerStart: { x: 80, y: 380 },
      platforms: [
        makeGround(4600), makeWall(),
        plat(400, 380, 150), plat(700, 300, 150), plat(1000, 380, 150),
        plat(1300, 300, 150), plat(1600, 380, 150), plat(1900, 300, 150),
        plat(2200, 380, 150), plat(2500, 300, 150), plat(2800, 380, 150),
        plat(3100, 300, 150), plat(3400, 380, 150), plat(3700, 300, 150), plat(4000, 380, 150)
      ],
      coins: [
        ...coinRow(440, 320, 2), ...coinRow(740, 240, 2), ...coinRow(1040, 320, 2),
        ...coinRow(1340, 240, 2), ...coinRow(1640, 320, 2), ...coinRow(1940, 240, 2),
        ...coinRow(2240, 320, 2), ...coinRow(2540, 240, 2), ...coinRow(2840, 320, 2),
        ...coinRow(3140, 240, 2), ...coinRow(3440, 320, 2), ...coinRow(3740, 240, 2), ...coinRow(4040, 320, 2)
      ],
      enemies: [
        enemy(550, 450, 650), enemy(1150, 1050, 1250), enemy(1750, 1650, 1850),
        enemy(2350, 2250, 2450), enemy(2950, 2850, 3050), enemy(3550, 3450, 3650), enemy(4150, 4050, 4250)
      ],
      spikes: [
        ...spikeRun(900, 2), ...spikeRun(1500, 2), ...spikeRun(2100, 2), ...spikeRun(2700, 2),
        ...spikeRun(3300, 2), ...spikeRun(3900, 2), ...spikeRun(4400, 2)
      ],
      goal: makeGoal(4450)
    },
    {
      width: 4200, playerStart: { x: 80, y: 380 },
      platforms: [
        makeGround(4200), makeWall(),
        plat(400, 400, 100), plat(600, 320, 100), plat(800, 240, 100),
        plat(1000, 320, 100), plat(1200, 400, 100), plat(1400, 320, 100),
        plat(1600, 240, 100), plat(1800, 320, 100), plat(2000, 400, 100),
        plat(2200, 320, 100), plat(2400, 240, 100), plat(2600, 320, 100),
        plat(2800, 400, 100), plat(3000, 320, 100), plat(3200, 240, 100),
        plat(3400, 320, 100), plat(3600, 400, 150)
      ],
      coins: [
        ...coinRow(420, 340, 2), ...coinRow(620, 260, 2), ...coinRow(820, 180, 2),
        ...coinRow(1020, 260, 2), ...coinRow(1220, 340, 2), ...coinRow(1420, 260, 2),
        ...coinRow(1620, 180, 2), ...coinRow(1820, 260, 2), ...coinRow(2020, 340, 2),
        ...coinRow(2220, 260, 2), ...coinRow(2420, 180, 2), ...coinRow(2620, 260, 2),
        ...coinRow(2820, 340, 2), ...coinRow(3020, 260, 2), ...coinRow(3220, 180, 2),
        ...coinRow(3420, 260, 2), ...coinRow(3650, 340, 2)
      ],
      enemies: [
        enemy(500, 400, 600), enemy(1100, 1000, 1200), enemy(1700, 1600, 1800),
        enemy(2300, 2200, 2400), enemy(2900, 2800, 3000), enemy(3500, 3400, 3600)
      ],
      spikes: [...spikeRun(700, 2), ...spikeRun(1300, 2), ...spikeRun(1900, 2), ...spikeRun(2500, 2), ...spikeRun(3100, 2), ...spikeRun(3700, 2)],
      goal: makeGoal(4050)
    },
    {
      width: 4400, playerStart: { x: 80, y: 380 },
      platforms: [
        makeGround(4400), makeWall(),
        plat(500, 400, 150), plat(900, 340, 150), plat(1300, 400, 150),
        plat(1700, 340, 150), plat(2100, 400, 150), plat(2500, 340, 150),
        plat(2900, 400, 150), plat(3300, 340, 150), plat(3700, 400, 150)
      ],
      coins: [
        ...coinRow(540, 340, 2), ...coinRow(940, 280, 2), ...coinRow(1340, 340, 2),
        ...coinRow(1740, 280, 2), ...coinRow(2140, 340, 2), ...coinRow(2540, 280, 2),
        ...coinRow(2940, 340, 2), ...coinRow(3340, 280, 2), ...coinRow(3740, 340, 2)
      ],
      enemies: [enemy(600, 500, 700), enemy(1400, 1300, 1500), enemy(2200, 2100, 2300), enemy(3000, 2900, 3100), enemy(3800, 3700, 3900)],
      spikes: [
        ...spikeRun(700, 6), ...spikeRun(1100, 6), ...spikeRun(1500, 6),
        ...spikeRun(1900, 6), ...spikeRun(2300, 6), ...spikeRun(2700, 6),
        ...spikeRun(3100, 6), ...spikeRun(3500, 6), ...spikeRun(3900, 6)
      ],
      goal: makeGoal(4250)
    },
    {
      width: 4600, playerStart: { x: 80, y: 380 },
      platforms: [
        makeGround(4600), makeWall(),
        plat(400, 400, 120), plat(650, 300, 120), plat(900, 200, 120),
        plat(1150, 300, 120), plat(1400, 400, 120), plat(1650, 300, 120),
        plat(1900, 200, 120), plat(2150, 300, 120), plat(2400, 400, 120),
        plat(2650, 300, 120), plat(2900, 200, 120), plat(3150, 300, 120),
        plat(3400, 400, 120), plat(3650, 300, 120), plat(3900, 200, 120), plat(4150, 300, 120)
      ],
      coins: [
        ...coinRow(420, 340, 2), ...coinRow(670, 240, 2), ...coinRow(920, 140, 2),
        ...coinRow(1170, 240, 2), ...coinRow(1420, 340, 2), ...coinRow(1670, 240, 2),
        ...coinRow(1920, 140, 2), ...coinRow(2170, 240, 2), ...coinRow(2420, 340, 2),
        ...coinRow(2670, 240, 2), ...coinRow(2920, 140, 2), ...coinRow(3170, 240, 2),
        ...coinRow(3420, 340, 2), ...coinRow(3670, 240, 2), ...coinRow(3920, 140, 2), ...coinRow(4170, 240, 2)
      ],
      enemies: [
        enemy(500, 400, 600), enemy(1200, 1100, 1300), enemy(2000, 1900, 2100),
        enemy(2800, 2700, 2900), enemy(3600, 3500, 3700)
      ],
      spikes: [
        ...spikeRun(800, 2), ...spikeRun(1500, 2), ...spikeRun(2200, 2),
        ...spikeRun(2900, 2), ...spikeRun(3600, 2), ...spikeRun(4300, 2)
      ],
      goal: makeGoal(4450)
    },
    {
      width: 4800, playerStart: { x: 80, y: 380 },
      platforms: [
        makeGround(4800), makeWall(),
        plat(500, 400, 250), plat(1000, 340, 250), plat(1500, 400, 250),
        plat(2000, 340, 250), plat(2500, 400, 250), plat(3000, 340, 250),
        plat(3500, 400, 250), plat(4000, 340, 250)
      ],
      coins: [
        ...coinRow(550, 340, 5), ...coinRow(1050, 280, 5), ...coinRow(1550, 340, 5),
        ...coinRow(2050, 280, 5), ...coinRow(2550, 340, 5), ...coinRow(3050, 280, 5),
        ...coinRow(3550, 340, 5), ...coinRow(4050, 280, 5)
      ],
      enemies: [
        enemy(600, 500, 700), enemy(800, 700, 900), enemy(1600, 1500, 1700),
        enemy(1800, 1700, 1900), enemy(2600, 2500, 2700), enemy(2800, 2700, 2900),
        enemy(3600, 3500, 3700), enemy(3800, 3700, 3900), enemy(4200, 4100, 4300)
      ],
      spikes: [...spikeRun(1200, 3), ...spikeRun(2200, 3), ...spikeRun(3200, 3), ...spikeRun(4200, 3)],
      goal: makeGoal(4650)
    },
    {
      width: 4400, playerStart: { x: 80, y: 380 },
      platforms: [
        makeGround(4400), makeWall(),
        plat(400, 400, 70), plat(600, 320, 70), plat(800, 240, 70),
        plat(1000, 320, 70), plat(1200, 400, 70), plat(1400, 320, 70),
        plat(1600, 240, 70), plat(1800, 160, 70), plat(2000, 240, 70),
        plat(2200, 320, 70), plat(2400, 400, 70), plat(2600, 320, 70),
        plat(2800, 240, 70), plat(3000, 160, 70), plat(3200, 240, 70),
        plat(3400, 320, 70), plat(3600, 400, 70), plat(3800, 320, 70), plat(4000, 240, 100)
      ],
      coins: [
        ...coinRow(420, 340, 1), ...coinRow(620, 260, 1), ...coinRow(820, 180, 1),
        ...coinRow(1020, 260, 1), ...coinRow(1220, 340, 1), ...coinRow(1420, 260, 1),
        ...coinRow(1620, 180, 1), ...coinRow(1820, 100, 1), ...coinRow(2020, 180, 1),
        ...coinRow(2220, 260, 1), ...coinRow(2420, 340, 1), ...coinRow(2620, 260, 1),
        ...coinRow(2820, 180, 1), ...coinRow(3020, 100, 1), ...coinRow(3220, 180, 1),
        ...coinRow(3420, 260, 1), ...coinRow(3620, 340, 1), ...coinRow(3820, 260, 1), ...coinRow(4050, 180, 1)
      ],
      enemies: [
        enemy(500, 400, 600), enemy(1100, 1000, 1200), enemy(1800, 1700, 1900),
        enemy(2500, 2400, 2600), enemy(3300, 3200, 3400), enemy(4100, 4000, 4200)
      ],
      spikes: [
        ...spikeRun(700, 2), ...spikeRun(1300, 2), ...spikeRun(1900, 2),
        ...spikeRun(2500, 2), ...spikeRun(3100, 2), ...spikeRun(3700, 2), ...spikeRun(4300, 2)
      ],
      goal: makeGoal(4250)
    },
    {
      width: 4000, playerStart: { x: 80, y: 380 },
      platforms: [
        makeGround(4000), makeWall(),
        plat(400, 420, 100), plat(550, 360, 100), plat(700, 300, 100),
        plat(850, 240, 100), plat(1000, 180, 100), plat(1150, 240, 100),
        plat(1300, 300, 100), plat(1450, 360, 100), plat(1600, 420, 100),
        plat(1800, 360, 100), plat(1950, 300, 100), plat(2100, 240, 100),
        plat(2250, 180, 100), plat(2400, 240, 100), plat(2550, 300, 100),
        plat(2700, 360, 100), plat(2850, 420, 100), plat(3050, 360, 100),
        plat(3200, 300, 100), plat(3350, 240, 100), plat(3500, 180, 100),
        plat(3650, 240, 100), plat(3800, 300, 100)
      ],
      coins: [
        ...coinRow(420, 360, 1), ...coinRow(570, 300, 1), ...coinRow(720, 240, 1),
        ...coinRow(870, 180, 1), ...coinRow(1020, 120, 1), ...coinRow(1170, 180, 1),
        ...coinRow(1320, 240, 1), ...coinRow(1470, 300, 1), ...coinRow(1620, 360, 1),
        ...coinRow(1820, 300, 1), ...coinRow(1970, 240, 1), ...coinRow(2120, 180, 1),
        ...coinRow(2270, 120, 1), ...coinRow(2420, 180, 1), ...coinRow(2570, 240, 1),
        ...coinRow(2720, 300, 1), ...coinRow(2870, 360, 1), ...coinRow(3070, 300, 1),
        ...coinRow(3220, 240, 1), ...coinRow(3370, 180, 1), ...coinRow(3520, 120, 1),
        ...coinRow(3670, 180, 1), ...coinRow(3820, 240, 1)
      ],
      enemies: [
        enemy(500, 400, 600), enemy(1200, 1100, 1300), enemy(1900, 1800, 2000),
        enemy(2600, 2500, 2700), enemy(3300, 3200, 3400)
      ],
      spikes: [...spikeRun(800, 2), ...spikeRun(1500, 2), ...spikeRun(2200, 2), ...spikeRun(2900, 2), ...spikeRun(3600, 2)],
      goal: makeGoal(3850)
    },
    {
      width: 4600, playerStart: { x: 80, y: 380 },
      platforms: [
        makeGround(4600), makeWall(),
        plat(500, 400, 180), plat(900, 340, 180), plat(1300, 400, 180),
        plat(1700, 340, 180), plat(2100, 400, 180), plat(2500, 340, 180),
        plat(2900, 400, 180), plat(3300, 340, 180), plat(3700, 400, 180), plat(4100, 340, 180)
      ],
      coins: [
        ...coinRow(540, 340, 3), ...coinRow(940, 280, 3), ...coinRow(1340, 340, 3),
        ...coinRow(1740, 280, 3), ...coinRow(2140, 340, 3), ...coinRow(2540, 280, 3),
        ...coinRow(2940, 340, 3), ...coinRow(3340, 280, 3), ...coinRow(3740, 340, 3), ...coinRow(4140, 280, 3)
      ],
      enemies: [
        enemy(600, 500, 700), enemy(1000, 900, 1100), enemy(1400, 1300, 1500),
        enemy(1800, 1700, 1900), enemy(2200, 2100, 2300), enemy(2600, 2500, 2700),
        enemy(3000, 2900, 3100), enemy(3400, 3300, 3500), enemy(3800, 3700, 3900), enemy(4200, 4100, 4300)
      ],
      spikes: [...spikeRun(800, 4), ...spikeRun(1600, 4), ...spikeRun(2400, 4), ...spikeRun(3200, 4), ...spikeRun(4000, 4)],
      goal: makeGoal(4450)
    },
    {
      width: 4400, playerStart: { x: 80, y: 380 },
      platforms: [
        makeGround(4400), makeWall(),
        plat(400, 400, 60), plat(580, 340, 60), plat(760, 280, 60),
        plat(940, 340, 60), plat(1120, 400, 60), plat(1300, 340, 60),
        plat(1480, 280, 60), plat(1660, 220, 60), plat(1840, 280, 60),
        plat(2020, 340, 60), plat(2200, 400, 60), plat(2380, 340, 60),
        plat(2560, 280, 60), plat(2740, 220, 60), plat(2920, 280, 60),
        plat(3100, 340, 60), plat(3280, 400, 60), plat(3460, 340, 60),
        plat(3640, 280, 60), plat(3820, 220, 60), plat(4000, 280, 80)
      ],
      coins: [
        ...coinRow(420, 340, 1), ...coinRow(600, 280, 1), ...coinRow(780, 220, 1),
        ...coinRow(960, 280, 1), ...coinRow(1140, 340, 1), ...coinRow(1320, 280, 1),
        ...coinRow(1500, 220, 1), ...coinRow(1680, 160, 1), ...coinRow(1860, 220, 1),
        ...coinRow(2040, 280, 1), ...coinRow(2220, 340, 1), ...coinRow(2400, 280, 1),
        ...coinRow(2580, 220, 1), ...coinRow(2760, 160, 1), ...coinRow(2940, 220, 1),
        ...coinRow(3120, 280, 1), ...coinRow(3300, 340, 1), ...coinRow(3480, 280, 1),
        ...coinRow(3660, 220, 1), ...coinRow(3840, 160, 1), ...coinRow(4050, 220, 1)
      ],
      enemies: [
        enemy(500, 400, 600), enemy(1100, 1000, 1200), enemy(1700, 1600, 1800),
        enemy(2300, 2200, 2400), enemy(2900, 2800, 3000), enemy(3500, 3400, 3600), enemy(4100, 4000, 4200)
      ],
      spikes: [
        ...spikeRun(680, 2), ...spikeRun(1240, 2), ...spikeRun(1800, 2),
        ...spikeRun(2360, 2), ...spikeRun(2920, 2), ...spikeRun(3480, 2), ...spikeRun(4040, 2)
      ],
      goal: makeGoal(4250)
    },
    {
      width: 4800, playerStart: { x: 80, y: 380 },
      platforms: [
        makeGround(4800), makeWall(),
        plat(500, 400, 200), plat(1000, 340, 200), plat(1500, 400, 200),
        plat(2000, 340, 200), plat(2500, 400, 200), plat(3000, 340, 200),
        plat(3500, 400, 200), plat(4000, 340, 200)
      ],
      coins: [
        ...coinRow(550, 340, 4), ...coinRow(1050, 280, 4), ...coinRow(1550, 340, 4),
        ...coinRow(2050, 280, 4), ...coinRow(2550, 340, 4), ...coinRow(3050, 280, 4),
        ...coinRow(3550, 340, 4), ...coinRow(4050, 280, 4)
      ],
      enemies: [
        enemy(600, 500, 700), enemy(800, 700, 900), enemy(1100, 1000, 1200),
        enemy(1300, 1200, 1400), enemy(1600, 1500, 1700), enemy(1800, 1700, 1900),
        enemy(2100, 2000, 2200), enemy(2300, 2200, 2400), enemy(2600, 2500, 2700),
        enemy(2800, 2700, 2900), enemy(3100, 3000, 3200), enemy(3300, 3200, 3400),
        enemy(3600, 3500, 3700), enemy(3800, 3700, 3900), enemy(4100, 4000, 4200)
      ],
      spikes: [...spikeRun(1200, 4), ...spikeRun(2200, 4), ...spikeRun(3200, 4), ...spikeRun(4200, 4)],
      goal: makeGoal(4650)
    },
    {
      width: 4600, playerStart: { x: 80, y: 380 },
      platforms: [
        makeGround(4600), makeWall(),
        plat(400, 420, 80), plat(600, 360, 80), plat(800, 300, 80),
        plat(1000, 240, 80), plat(1200, 180, 80), plat(1400, 240, 80),
        plat(1600, 300, 80), plat(1800, 360, 80), plat(2000, 420, 80),
        plat(2200, 360, 80), plat(2400, 300, 80), plat(2600, 240, 80),
        plat(2800, 180, 80), plat(3000, 240, 80), plat(3200, 300, 80),
        plat(3400, 360, 80), plat(3600, 420, 80), plat(3800, 360, 80), plat(4000, 300, 100)
      ],
      coins: [
        ...coinRow(420, 360, 1), ...coinRow(620, 300, 1), ...coinRow(820, 240, 1),
        ...coinRow(1020, 180, 1), ...coinRow(1220, 120, 1), ...coinRow(1420, 180, 1),
        ...coinRow(1620, 240, 1), ...coinRow(1820, 300, 1), ...coinRow(2020, 360, 1),
        ...coinRow(2220, 300, 1), ...coinRow(2420, 240, 1), ...coinRow(2620, 180, 1),
        ...coinRow(2820, 120, 1), ...coinRow(3020, 180, 1), ...coinRow(3220, 240, 1),
        ...coinRow(3420, 300, 1), ...coinRow(3620, 360, 1), ...coinRow(3820, 300, 1), ...coinRow(4050, 240, 1)
      ],
      enemies: [
        enemy(500, 400, 600), enemy(1100, 1000, 1200), enemy(1700, 1600, 1800),
        enemy(2300, 2200, 2400), enemy(2900, 2800, 3000), enemy(3500, 3400, 3600), enemy(4100, 4000, 4200)
      ],
      spikes: [
        ...spikeRun(700, 2), ...spikeRun(1300, 2), ...spikeRun(1900, 2), ...spikeRun(2500, 2),
        ...spikeRun(3100, 2), ...spikeRun(3700, 2), ...spikeRun(4300, 2)
      ],
      goal: makeGoal(4450)
    },
    {
      width: 4800, playerStart: { x: 80, y: 380 },
      platforms: [
        makeGround(4800), makeWall(),
        plat(500, 400, 200), plat(1000, 340, 200), plat(1500, 400, 200),
        plat(2000, 340, 200), plat(2500, 400, 200), plat(3000, 340, 200),
        plat(3500, 400, 200), plat(4000, 340, 200)
      ],
      coins: [
        ...coinRow(550, 340, 4), ...coinRow(1050, 280, 4), ...coinRow(1550, 340, 4),
        ...coinRow(2050, 280, 4), ...coinRow(2550, 340, 4), ...coinRow(3050, 280, 4),
        ...coinRow(3550, 340, 4), ...coinRow(4050, 280, 4)
      ],
      enemies: [
        enemy(600, 500, 700), enemy(1000, 900, 1100), enemy(1600, 1500, 1700),
        enemy(2000, 1900, 2100), enemy(2600, 2500, 2700), enemy(3000, 2900, 3100),
        enemy(3600, 3500, 3700), enemy(4000, 3900, 4100)
      ],
      spikes: [
        ...spikeRun(700, 3), ...spikeRun(1200, 3), ...spikeRun(1700, 3), ...spikeRun(2200, 3),
        ...spikeRun(2700, 3), ...spikeRun(3200, 3), ...spikeRun(3700, 3), ...spikeRun(4200, 3), ...spikeRun(4600, 3)
      ],
      goal: makeGoal(4650)
    },
    {
      width: 5000, playerStart: { x: 80, y: 380 },
      platforms: [
        makeGround(5000), makeWall(),
        plat(500, 400, 250), plat(1000, 340, 250), plat(1500, 400, 250),
        plat(2000, 340, 250), plat(2500, 400, 250), plat(3000, 340, 250),
        plat(3500, 400, 250), plat(4000, 340, 250), plat(4500, 400, 250)
      ],
      coins: [
        ...coinRow(550, 340, 4), ...coinRow(1050, 280, 4), ...coinRow(1550, 340, 4),
        ...coinRow(2050, 280, 4), ...coinRow(2550, 340, 4), ...coinRow(3050, 280, 4),
        ...coinRow(3550, 340, 4), ...coinRow(4050, 280, 4), ...coinRow(4550, 340, 4)
      ],
      enemies: [
        enemy(600, 500, 750, 2.4), enemy(1200, 1100, 1350, 2.4),
        enemy(1800, 1700, 1950, 2.4), enemy(2400, 2300, 2550, 2.4),
        enemy(3000, 2900, 3150, 2.4), enemy(3600, 3500, 3750, 2.4),
        enemy(4200, 4100, 4350, 2.4), enemy(4700, 4600, 4850, 2.4)
      ],
      spikes: [...spikeRun(800, 3), ...spikeRun(1400, 3), ...spikeRun(2000, 3), ...spikeRun(2600, 3), ...spikeRun(3200, 3), ...spikeRun(3800, 3), ...spikeRun(4400, 3), ...spikeRun(4800, 2)],
      goal: makeGoal(4850)
    },
    {
      width: 5000, playerStart: { x: 80, y: 380 },
      platforms: [
        makeGround(5000), makeWall(),
        plat(500, 420, 90), plat(700, 360, 90), plat(900, 300, 90),
        plat(1100, 240, 90), plat(1300, 300, 90), plat(1500, 360, 90),
        plat(1700, 420, 90), plat(1900, 360, 90), plat(2100, 300, 90),
        plat(2300, 240, 90), plat(2500, 300, 90), plat(2700, 360, 90),
        plat(2900, 420, 90), plat(3100, 360, 90), plat(3300, 300, 90),
        plat(3500, 240, 90), plat(3700, 300, 90), plat(3900, 360, 90),
        plat(4100, 420, 90), plat(4300, 360, 90), plat(4500, 300, 100)
      ],
      coins: [
        ...coinRow(520, 360, 1), ...coinRow(720, 300, 1), ...coinRow(920, 240, 1),
        ...coinRow(1120, 180, 1), ...coinRow(1320, 240, 1), ...coinRow(1520, 300, 1),
        ...coinRow(1720, 360, 1), ...coinRow(1920, 300, 1), ...coinRow(2120, 240, 1),
        ...coinRow(2320, 180, 1), ...coinRow(2520, 240, 1), ...coinRow(2720, 300, 1),
        ...coinRow(2920, 360, 1), ...coinRow(3120, 300, 1), ...coinRow(3320, 240, 1),
        ...coinRow(3520, 180, 1), ...coinRow(3720, 240, 1), ...coinRow(3920, 300, 1),
        ...coinRow(4120, 360, 1), ...coinRow(4320, 300, 1), ...coinRow(4550, 240, 1)
      ],
      enemies: [
        enemy(600, 500, 700), enemy(1300, 1200, 1400), enemy(2000, 1900, 2100),
        enemy(2700, 2600, 2800), enemy(3400, 3300, 3500), enemy(4100, 4000, 4200), enemy(4700, 4600, 4800)
      ],
      spikes: [
        ...spikeRun(800, 2), ...spikeRun(1500, 2), ...spikeRun(2200, 2), ...spikeRun(2900, 2),
        ...spikeRun(3600, 2), ...spikeRun(4300, 2), ...spikeRun(4800, 2)
      ],
      goal: makeGoal(4850)
    },
    {
      width: 4800, playerStart: { x: 80, y: 380 },
      platforms: [
        makeGround(4800), makeWall(),
        plat(500, 400, 200), plat(1000, 340, 200), plat(1500, 400, 200),
        plat(2000, 340, 200), plat(2500, 400, 200), plat(3000, 340, 200),
        plat(3500, 400, 200), plat(4000, 340, 200)
      ],
      coins: [
        ...coinRow(550, 340, 4), ...coinRow(1050, 280, 4), ...coinRow(1550, 340, 4),
        ...coinRow(2050, 280, 4), ...coinRow(2550, 340, 4), ...coinRow(3050, 280, 4),
        ...coinRow(3550, 340, 4), ...coinRow(4050, 280, 4)
      ],
      enemies: [
        enemy(600, 500, 700, 1.6), enemy(1200, 1100, 1300, 1.6),
        enemy(1800, 1700, 1900, 1.6), enemy(2400, 2300, 2500, 1.6),
        enemy(3000, 2900, 3100, 1.6), enemy(3600, 3500, 3700, 1.6),
        enemy(4200, 4100, 4300, 1.6)
      ],
      spikes: [
        ...spikeRun(700, 5), ...spikeRun(1300, 5), ...spikeRun(1900, 5),
        ...spikeRun(2500, 5), ...spikeRun(3100, 5), ...spikeRun(3700, 5), ...spikeRun(4300, 5)
      ],
      goal: makeGoal(4650)
    },
    {
      width: 5200, playerStart: { x: 80, y: 380 },
      platforms: [
        makeGround(5200), makeWall(),
        plat(500, 420, 150), plat(800, 360, 150), plat(1100, 300, 150),
        plat(1400, 240, 150), plat(1700, 300, 150), plat(2000, 360, 150),
        plat(2300, 420, 150), plat(2600, 360, 150), plat(2900, 300, 150),
        plat(3200, 240, 150), plat(3500, 300, 150), plat(3800, 360, 150),
        plat(4100, 420, 150), plat(4400, 360, 150), plat(4700, 300, 150)
      ],
      coins: [
        ...coinRow(520, 360, 2), ...coinRow(820, 300, 2), ...coinRow(1120, 240, 2),
        ...coinRow(1420, 180, 2), ...coinRow(1720, 240, 2), ...coinRow(2020, 300, 2),
        ...coinRow(2320, 360, 2), ...coinRow(2620, 300, 2), ...coinRow(2920, 240, 2),
        ...coinRow(3220, 180, 2), ...coinRow(3520, 240, 2), ...coinRow(3820, 300, 2),
        ...coinRow(4120, 360, 2), ...coinRow(4420, 300, 2), ...coinRow(4750, 240, 2)
      ],
      enemies: [
        enemy(650, 500, 800, 1.8), enemy(1250, 1100, 1400, 1.8),
        enemy(1850, 1700, 2000, 1.8), enemy(2450, 2300, 2600, 1.8),
        enemy(3050, 2900, 3200, 1.8), enemy(3650, 3500, 3800, 1.8),
        enemy(4250, 4100, 4400, 1.8), enemy(4800, 4700, 5000, 1.8)
      ],
      spikes: [
        ...spikeRun(950, 3), ...spikeRun(1550, 3), ...spikeRun(2150, 3), ...spikeRun(2750, 3),
        ...spikeRun(3350, 3), ...spikeRun(3950, 3), ...spikeRun(4550, 3), ...spikeRun(5000, 2)
      ],
      goal: makeGoal(5050)
    },
    {
      width: 5400, playerStart: { x: 80, y: 380 },
      platforms: [
        makeGround(5400), makeWall(),
        plat(500, 400, 180), plat(1000, 340, 180), plat(1500, 400, 180),
        plat(2000, 340, 180), plat(2500, 400, 180), plat(3000, 340, 180),
        plat(3500, 400, 180), plat(4000, 340, 180), plat(4500, 400, 180), plat(5000, 340, 180)
      ],
      coins: [
        ...coinRow(550, 340, 3), ...coinRow(1050, 280, 3), ...coinRow(1550, 340, 3),
        ...coinRow(2050, 280, 3), ...coinRow(2550, 340, 3), ...coinRow(3050, 280, 3),
        ...coinRow(3550, 340, 3), ...coinRow(4050, 280, 3), ...coinRow(4550, 340, 3), ...coinRow(5050, 280, 3)
      ],
      enemies: [
        enemy(600, 500, 700, 1.9), enemy(1100, 1000, 1200, 1.9),
        enemy(1600, 1500, 1700, 1.9), enemy(2100, 2000, 2200, 1.9),
        enemy(2600, 2500, 2700, 1.9), enemy(3100, 3000, 3200, 1.9),
        enemy(3600, 3500, 3700, 1.9), enemy(4100, 4000, 4200, 1.9),
        enemy(4600, 4500, 4700, 1.9), enemy(5100, 5000, 5200, 1.9)
      ],
      spikes: [
        ...spikeRun(800, 4), ...spikeRun(1400, 4), ...spikeRun(2000, 4), ...spikeRun(2600, 4),
        ...spikeRun(3200, 4), ...spikeRun(3800, 4), ...spikeRun(4400, 4), ...spikeRun(5000, 4)
      ],
      goal: makeGoal(5250)
    },
    {
      width: 4800, playerStart: { x: 80, y: 380 },
      platforms: [
        makeGround(4800), makeWall(),
        plat(400, 420, 70), plat(580, 360, 70), plat(760, 300, 70),
        plat(940, 240, 70), plat(1120, 180, 70), plat(1300, 240, 70),
        plat(1480, 300, 70), plat(1660, 360, 70), plat(1840, 420, 70),
        plat(2020, 360, 70), plat(2200, 300, 70), plat(2380, 240, 70),
        plat(2560, 180, 70), plat(2740, 240, 70), plat(2920, 300, 70),
        plat(3100, 360, 70), plat(3280, 420, 70), plat(3460, 360, 70),
        plat(3640, 300, 70), plat(3820, 240, 70), plat(4000, 180, 70),
        plat(4180, 240, 70), plat(4360, 300, 90)
      ],
      coins: [
        ...coinRow(420, 380, 1), ...coinRow(600, 320, 1), ...coinRow(780, 260, 1),
        ...coinRow(960, 200, 1), ...coinRow(1140, 140, 1), ...coinRow(1320, 200, 1),
        ...coinRow(1500, 260, 1), ...coinRow(1680, 320, 1), ...coinRow(1860, 380, 1),
        ...coinRow(2040, 320, 1), ...coinRow(2220, 260, 1), ...coinRow(2400, 200, 1),
        ...coinRow(2580, 140, 1), ...coinRow(2760, 200, 1), ...coinRow(2940, 260, 1),
        ...coinRow(3120, 320, 1), ...coinRow(3300, 380, 1), ...coinRow(3480, 320, 1),
        ...coinRow(3660, 260, 1), ...coinRow(3840, 200, 1), ...coinRow(4020, 140, 1),
        ...coinRow(4200, 200, 1), ...coinRow(4400, 260, 1)
      ],
      enemies: [
        enemy(500, 400, 600), enemy(1200, 1100, 1300), enemy(1900, 1800, 2000),
        enemy(2600, 2500, 2700), enemy(3300, 3200, 3400), enemy(4000, 3900, 4100), enemy(4600, 4500, 4700)
      ],
      spikes: [
        ...spikeRun(700, 2), ...spikeRun(1400, 2), ...spikeRun(2100, 2), ...spikeRun(2800, 2),
        ...spikeRun(3500, 2), ...spikeRun(4200, 2), ...spikeRun(4700, 2)
      ],
      goal: makeGoal(4650)
    },
    {
      width: 5200, playerStart: { x: 80, y: 380 },
      platforms: [
        makeGround(5200), makeWall(),
        plat(500, 400, 180), plat(900, 340, 180), plat(1300, 400, 180),
        plat(1700, 340, 180), plat(2100, 400, 180), plat(2500, 340, 180),
        plat(2900, 400, 180), plat(3300, 340, 180), plat(3700, 400, 180),
        plat(4100, 340, 180), plat(4500, 400, 180), plat(4900, 340, 180)
      ],
      coins: [
        ...coinRow(550, 340, 3), ...coinRow(950, 280, 3), ...coinRow(1350, 340, 3),
        ...coinRow(1750, 280, 3), ...coinRow(2150, 340, 3), ...coinRow(2550, 280, 3),
        ...coinRow(2950, 340, 3), ...coinRow(3350, 280, 3), ...coinRow(3750, 340, 3),
        ...coinRow(4150, 280, 3), ...coinRow(4550, 340, 3), ...coinRow(4950, 280, 3)
      ],
      enemies: [
        enemy(600, 500, 700, 2.0), enemy(1000, 900, 1100, 2.0),
        enemy(1400, 1300, 1500, 2.0), enemy(1800, 1700, 1900, 2.0),
        enemy(2200, 2100, 2300, 2.0), enemy(2600, 2500, 2700, 2.0),
        enemy(3000, 2900, 3100, 2.0), enemy(3400, 3300, 3500, 2.0),
        enemy(3800, 3700, 3900, 2.0), enemy(4200, 4100, 4300, 2.0),
        enemy(4600, 4500, 4700, 2.0), enemy(5000, 4900, 5100, 2.0)
      ],
      spikes: [
        ...spikeRun(750, 4), ...spikeRun(1150, 4), ...spikeRun(1550, 4), ...spikeRun(1950, 4),
        ...spikeRun(2350, 4), ...spikeRun(2750, 4), ...spikeRun(3150, 4), ...spikeRun(3550, 4),
        ...spikeRun(3950, 4), ...spikeRun(4350, 4), ...spikeRun(4750, 4), ...spikeRun(5100, 2)
      ],
      goal: makeGoal(5050)
    },
    {
      width: 5600, playerStart: { x: 80, y: 380 },
      platforms: [
        makeGround(5600), makeWall(),
        plat(500, 420, 120), plat(700, 360, 120), plat(900, 300, 120),
        plat(1100, 240, 120), plat(1300, 180, 120), plat(1500, 240, 120),
        plat(1700, 300, 120), plat(1900, 360, 120), plat(2100, 420, 120),
        plat(2300, 360, 120), plat(2500, 300, 120), plat(2700, 240, 120),
        plat(2900, 180, 120), plat(3100, 240, 120), plat(3300, 300, 120),
        plat(3500, 360, 120), plat(3700, 420, 120), plat(3900, 360, 120),
        plat(4100, 300, 120), plat(4300, 240, 120), plat(4500, 180, 120),
        plat(4700, 240, 120), plat(4900, 300, 120), plat(5100, 360, 120),
        plat(5300, 420, 150)
      ],
      coins: [
        ...coinRow(520, 360, 2), ...coinRow(720, 300, 2), ...coinRow(920, 240, 2),
        ...coinRow(1120, 180, 2), ...coinRow(1320, 120, 2), ...coinRow(1520, 180, 2),
        ...coinRow(1720, 240, 2), ...coinRow(1920, 300, 2), ...coinRow(2120, 360, 2),
        ...coinRow(2320, 300, 2), ...coinRow(2520, 240, 2), ...coinRow(2720, 180, 2),
        ...coinRow(2920, 120, 2), ...coinRow(3120, 180, 2), ...coinRow(3320, 240, 2),
        ...coinRow(3520, 300, 2), ...coinRow(3720, 360, 2), ...coinRow(3920, 300, 2),
        ...coinRow(4120, 240, 2), ...coinRow(4320, 180, 2), ...coinRow(4520, 120, 2),
        ...coinRow(4720, 180, 2), ...coinRow(4920, 240, 2), ...coinRow(5120, 300, 2),
        ...coinRow(5350, 360, 2)
      ],
      enemies: [
        enemy(600, 500, 700, 2.2), enemy(1200, 1100, 1300, 2.2),
        enemy(1800, 1700, 1900, 2.2), enemy(2400, 2300, 2500, 2.2),
        enemy(3000, 2900, 3100, 2.2), enemy(3600, 3500, 3700, 2.2),
        enemy(4200, 4100, 4300, 2.2), enemy(4800, 4700, 4900, 2.2),
        enemy(5400, 5300, 5500, 2.2)
      ],
      spikes: [
        ...spikeRun(800, 3), ...spikeRun(1400, 3), ...spikeRun(2000, 3), ...spikeRun(2600, 3),
        ...spikeRun(3200, 3), ...spikeRun(3800, 3), ...spikeRun(4400, 3), ...spikeRun(5000, 3),
        ...spikeRun(5500, 2)
      ],
      goal: makeGoal(5450)
    }
  ];

  let player = null;
  let enemies = [];
  let coins = [];
  let spikes = [];
  let platforms = [];
  let goal = null;
  let levelWidth = 0;

  function loadLevel(idx) {
    const level = LEVELS[idx];
    levelWidth = level.width;

    platforms = level.platforms.map(p => {
      const e = new Entity(p.x, p.y, p.w, p.h);
      e.type = p.type;
      return e;
    });

    coins = level.coins.map(c => {
      const e = new Entity(c.x, c.y, 24, 24);
      e.collected = false;
      return e;
    });

    spikes = level.spikes.map(s => new Entity(s.x, s.y, s.w, s.h));

    enemies = level.enemies.map(en => new Enemy(en.x, en.y, en.left, en.right, en.speed || 1.2));

    goal = new Entity(level.goal.x, level.goal.y, level.goal.w, level.goal.h);

    player = new Player(level.playerStart.x, level.playerStart.y);
    particles = [];
    floatingTexts = [];
    camera.x = 0;
    camera.y = 0;
  }

  function updateCamera() {
    const targetX = player.x + player.w / 2 - W / 2;
    camera.x += (targetX - camera.x) * 0.1;
    camera.x = Math.max(0, Math.min(levelWidth - W, camera.x));
    camera.y = 0;
  }

  function drawBackground() {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    const shift = Math.min(levelIndex * 6, 120);
    grad.addColorStop(0, `rgb(${30 + shift / 4}, ${42 - shift / 8}, ${74 + shift / 6})`);
    grad.addColorStop(0.6, `rgb(${45 + shift / 6}, ${74 - shift / 6}, ${110 + shift / 8})`);
    grad.addColorStop(1, `rgb(${26 + shift / 8}, ${58 - shift / 10}, ${92 + shift / 12})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    for (let i = 0; i < 40; i++) {
      const sx = ((i * 137) % 800) - (camera.x * 0.1) % 800;
      const sy = (i * 53) % 200;
      const twinkle = Math.sin(Date.now() * 0.003 + i) * 0.4 + 0.6;
      ctx.globalAlpha = twinkle * 0.6;
      ctx.fillRect(sx, sy, 2, 2);
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.arc(800 - (camera.x * 0.05) % 1600, 100, 45, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff4cc';
    ctx.beginPath();
    ctx.arc(790 - (camera.x * 0.05) % 1600, 92, 35, 0, Math.PI * 2);
    ctx.fill();

    const mountainOffset = -(camera.x * 0.3) % 500;
    ctx.fillStyle = '#1a2d4a';
    for (let i = -1; i < 5; i++) {
      const bx = mountainOffset + i * 500;
      ctx.beginPath();
      ctx.moveTo(bx, H);
      ctx.lineTo(bx + 150, 200);
      ctx.lineTo(bx + 300, H);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = '#15304a';
    const treeOffset = -(camera.x * 0.6) % 300;
    for (let i = -1; i < 7; i++) {
      const tx = treeOffset + i * 300;
      for (let j = 0; j < 4; j++) {
        ctx.fillRect(tx + j * 60, 250, 40, 240);
        ctx.fillStyle = '#0f2438';
        ctx.fillRect(tx + j * 60 + 15, 250, 10, 240);
        ctx.fillStyle = '#15304a';
      }
    }
  }

  function drawPlatform(p) {
    const x = Math.round(p.x - camera.x);
    const y = Math.round(p.y);

    if (p.type === 'ground') {
      ctx.fillStyle = '#3a7d44';
      ctx.fillRect(x, y, p.w, 12);
      ctx.fillStyle = '#4a9c5c';
      ctx.fillRect(x, y, p.w, 6);
      ctx.fillStyle = '#6b4423';
      ctx.fillRect(x, y + 12, p.w, p.h - 12);
      ctx.fillStyle = '#4a2f18';
      for (let i = 0; i < p.w; i += 32) {
        const off = (i / 32) % 2 === 0 ? 0 : 8;
        ctx.fillRect(x + i + 4, y + 20 + off, 8, 8);
        ctx.fillRect(x + i + 18, y + 36 - off, 6, 6);
      }
    } else if (p.type === 'dirt') {
      ctx.fillStyle = '#3a7d44';
      ctx.fillRect(x, y, p.w, 8);
      ctx.fillStyle = '#4a9c5c';
      ctx.fillRect(x, y, p.w, 4);
      ctx.fillStyle = '#8b5a2b';
      ctx.fillRect(x, y + 8, p.w, p.h - 8);
      ctx.fillStyle = '#6b4423';
      ctx.fillRect(x, y + p.h - 6, p.w, 6);
      ctx.fillStyle = '#6b4423';
      for (let i = 0; i < p.w; i += 20) {
        ctx.fillRect(x + i + 4, y + 14, 6, 6);
      }
    } else if (p.type === 'wall') {
      ctx.fillStyle = '#2a2a4a';
      ctx.fillRect(x, y, p.w, p.h);
    }
  }

  function drawCoin(c) {
    if (c.collected) return;
    const x = c.x - camera.x;
    const bob = Math.sin(Date.now() * 0.005 + c.x * 0.01) * 3;
    const scale = Math.abs(Math.cos(Date.now() * 0.004 + c.x * 0.005));

    const cx = x + 12;
    const cy = c.y + 12 + bob;

    ctx.fillStyle = '#1a1a2e';
    ctx.beginPath();
    ctx.arc(cx + 1, cy + 2, 10, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.ellipse(cx, cy, 10 * scale + 1, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ff9e7a';
    ctx.beginPath();
    ctx.ellipse(cx, cy, 6 * scale, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    if (scale > 0.4) {
      ctx.fillStyle = '#fff4cc';
      ctx.fillRect(cx - 1, cy - 5, 3, 10);
    }
  }

  function drawSpike(s) {
    const x = s.x - camera.x;
    const y = s.y;
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(x, y + 28, 24, 4);

    ctx.fillStyle = '#a8b4d8';
    ctx.beginPath();
    ctx.moveTo(x + 2, y + 30);
    ctx.lineTo(x + 12, y + 2);
    ctx.lineTo(x + 22, y + 30);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#e0e6f0';
    ctx.beginPath();
    ctx.moveTo(x + 8, y + 30);
    ctx.lineTo(x + 12, y + 8);
    ctx.lineTo(x + 14, y + 30);
    ctx.closePath();
    ctx.fill();
  }

  function drawGoal(g) {
    const x = g.x - camera.x;
    const y = g.y;
    const wave = Math.sin(Date.now() * 0.008) * 4;

    ctx.fillStyle = '#6b4423';
    ctx.fillRect(x + 16, y, 6, g.h);
    ctx.fillStyle = '#4a2f18';
    ctx.fillRect(x + 16, y, 3, g.h);

    ctx.fillStyle = '#ff6b6b';
    ctx.beginPath();
    ctx.moveTo(x + 22, y + 4);
    ctx.lineTo(x + 22 + 40 + wave, y + 16);
    ctx.lineTo(x + 22, y + 34);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.arc(x + 22, y - 4, 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x + 20, y - 6, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawHUD() {
    ctx.fillStyle = 'rgba(10, 10, 26, 0.75)';
    ctx.fillRect(0, 0, W, 60);
    ctx.fillStyle = 'rgba(255, 209, 102, 0.3)';
    ctx.fillRect(0, 58, W, 2);

    for (let i = 0; i < player.health; i++) {
      drawHeart(20 + i * 36, 20);
    }

    ctx.fillStyle = '#ffd166';
    ctx.font = 'bold 22px Courier New';
    ctx.textAlign = 'left';
    ctx.fillText('🪙 ' + totalScore, 160, 38);

    const collectedCount = coins.filter(c => c.collected).length;
    ctx.fillStyle = '#a8b4d8';
    ctx.font = 'bold 20px Courier New';
    ctx.textAlign = 'right';
    ctx.fillText(collectedCount + ' / ' + coins.length, W - 160, 38);

    ctx.fillStyle = '#ff9e7a';
    ctx.font = 'bold 18px Courier New';
    ctx.fillText('LVL ' + (levelIndex + 1) + '/' + LEVELS.length, W - 40, 38);

    const barW = 200;
    const barX = W / 2 - barW / 2;
    const barY = 22;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(barX, barY, barW, 14);
    ctx.fillStyle = '#4a9c5c';
    ctx.fillRect(barX, barY, barW * (levelIndex / LEVELS.length), 14);
    ctx.fillStyle = '#6bcb77';
    ctx.fillRect(barX, barY, barW * ((levelIndex + 1) / LEVELS.length), 4);
    ctx.strokeStyle = '#2a2a4a';
    ctx.lineWidth = 2;
    ctx.strokeRect(barX, barY, barW, 14);

    ctx.textAlign = 'left';
  }

  function drawHeart(x, y) {
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(x - 2, y - 2, 26, 26);

    ctx.fillStyle = '#ff4d6d';
    ctx.fillRect(x, y + 4, 10, 10);
    ctx.fillRect(x + 12, y + 4, 10, 10);
    ctx.fillRect(x, y + 10, 22, 8);
    ctx.fillRect(x + 4, y + 16, 14, 4);
    ctx.fillRect(x + 8, y + 20, 6, 2);
  }

  function updateBestScore() {
    if (totalScore > bestScore) {
      bestScore = totalScore;
      saveProgress();
      if (bestScoreEl) bestScoreEl.textContent = 'Best score: ' + bestScore;
    }
  }

  function winLevel() {
    if (state !== 'playing') return;
    state = 'won';
    sfxWin();
    if (winScoreEl) winScoreEl.textContent = 'Score: ' + totalScore;
    updateBestScore();

    if (levelIndex + 1 > unlockedLevel) {
      unlockedLevel = Math.min(levelIndex + 1, LEVELS.length - 1);
      saveProgress();
    }

    const isLast = levelIndex >= LEVELS.length - 1;
    if (isLast) {
      if (finalScoreEl) finalScoreEl.textContent = 'Final Score: ' + totalScore;
      if (finalScreen) finalScreen.classList.remove('hidden');
      sfxFinal();
      return;
    }

    if (winInfoEl) winInfoEl.textContent = 'Level ' + (levelIndex + 1) + ' complete!';
    if (winScreen) winScreen.classList.remove('hidden');
  }

  function startGame(idx) {
    levelIndex = idx;
    if (idx === 0) totalScore = 0;
    loadLevel(idx);
    state = 'playing';
    paused = false;
    if (startScreen) startScreen.classList.add('hidden');
    if (levelScreen) levelScreen.classList.add('hidden');
    if (winScreen) winScreen.classList.add('hidden');
    if (loseScreen) loseScreen.classList.add('hidden');
    if (finalScreen) finalScreen.classList.add('hidden');
  }

  function nextLevel() {
    if (levelIndex < LEVELS.length - 1) {
      startGame(levelIndex + 1);
    } else {
      startGame(0);
    }
  }

  function showLevelSelect() {
    state = 'levelselect';
    if (startScreen) startScreen.classList.add('hidden');
    if (winScreen) winScreen.classList.add('hidden');
    if (loseScreen) loseScreen.classList.add('hidden');
    if (finalScreen) finalScreen.classList.add('hidden');
    if (levelScreen) levelScreen.classList.remove('hidden');
    buildLevelGrid();
  }

  function showStartScreen() {
    state = 'menu';
    if (startScreen) startScreen.classList.remove('hidden');
    if (levelScreen) levelScreen.classList.add('hidden');
    if (winScreen) winScreen.classList.add('hidden');
    if (loseScreen) loseScreen.classList.add('hidden');
    if (finalScreen) finalScreen.classList.add('hidden');
    loadLevel(0);
  }

  function buildLevelGrid() {
    if (!levelGrid) return;
    levelGrid.innerHTML = '';
    for (let i = 0; i < LEVELS.length; i++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'level-btn';
      btn.dataset.level = i;

      const unlocked = i <= unlockedLevel;
      if (!unlocked) btn.classList.add('locked');
      if (i === levelIndex) btn.classList.add('current');

      const span = document.createElement('span');
      span.textContent = i + 1;
      btn.appendChild(span);

      if (unlocked) {
        btn.addEventListener('click', () => {
          audioCtx.get();
          totalScore = 0;
          startGame(i);
        });
      }

      levelGrid.appendChild(btn);
    }
  }

  function update() {
    if (state !== 'playing' || paused) return;

    player.update(platforms, enemies, coins, spikes, goal);
    for (const e of enemies) e.update();
    updateParticles();
    updateCamera();
  }

  function render() {
    drawBackground();
    for (const p of platforms) drawPlatform(p);
    drawGoal(goal);
    for (const s of spikes) drawSpike(s);
    for (const c of coins) drawCoin(c);
    for (const e of enemies) e.draw();
    player.draw();
    drawParticles();
    drawHUD();

    if (paused) {
      ctx.fillStyle = 'rgba(10, 10, 26, 0.7)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ffd166';
      ctx.font = 'bold 48px Courier New';
      ctx.textAlign = 'center';
      ctx.fillText('PAUSED', W / 2, H / 2);
      ctx.font = 'bold 18px Courier New';
      ctx.fillStyle = '#a8b4d8';
      ctx.fillText('Press P to resume', W / 2, H / 2 + 40);
      ctx.textAlign = 'left';
    }
  }

  function loop() {
    requestAnimationFrame(loop);
    update();
    render();
  }

  window.addEventListener('keydown', e => {
    if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
    }
    keys[e.key] = true;
    if ((e.key === 'p' || e.key === 'P') && state === 'playing') {
      paused = !paused;
    }
    if ((e.key === 'r' || e.key === 'R') && state === 'playing') {
      startGame(levelIndex);
    }
  });

  window.addEventListener('keyup', e => {
    keys[e.key] = false;
  });

  document.addEventListener('click', (e) => {
    const id = e.target && e.target.id;

    if (id === 'playBtn') {
      audioCtx.get();
      showLevelSelect();
    } else if (id === 'backBtn') {
      showStartScreen();
    } else if (id === 'resetProgressBtn') {
      if (confirm('Reset all progress?')) {
        unlockedLevel = 0;
        bestScore = 0;
        saveProgress();
        if (bestScoreEl) bestScoreEl.textContent = 'Best score: 0';
        buildLevelGrid();
      }
    } else if (id === 'nextLevelBtn') {
      nextLevel();
    } else if (id === 'winMenuBtn' || id === 'loseMenuBtn' || id === 'finalMenuBtn') {
      showLevelSelect();
    } else if (id === 'retryBtn') {
      startGame(levelIndex);
    } else if (id === 'playAgainBtn') {
      totalScore = 0;
      startGame(0);
    }
  });

  function bindTouch(el, key) {
    if (!el) return;
    const on = e => { e.preventDefault(); touch[key] = true; el.classList.add('active'); };
    const off = e => { e.preventDefault(); touch[key] = false; el.classList.remove('active'); };
    el.addEventListener('touchstart', on, { passive: false });
    el.addEventListener('touchend', off, { passive: false });
    el.addEventListener('touchcancel', off, { passive: false });
    el.addEventListener('mousedown', on);
    el.addEventListener('mouseup', off);
    el.addEventListener('mouseleave', off);
  }

  bindTouch($('btnLeft'), 'left');
  bindTouch($('btnRight'), 'right');
  bindTouch($('btnJump'), 'jump');

  loadLevel(0);
  state = 'menu';
  requestAnimationFrame(loop);
})();
