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

  const startScreen = document.getElementById('startScreen');
  const winScreen = document.getElementById('winScreen');
  const loseScreen = document.getElementById('loseScreen');
  const winScoreEl = document.getElementById('winScore');
  const loseScoreEl = document.getElementById('loseScore');
  const startBtn = document.getElementById('startBtn');
  const nextLevelBtn = document.getElementById('nextLevelBtn');
  const retryBtn = document.getElementById('retryBtn');

  const touch = { left: false, right: false, jump: false };

  let state = 'menu';
  let camera = { x: 0, y: 0 };
  let keys = {};
  let levelIndex = 0;
  let totalScore = 0;
  let particles = [];
  let floatingTexts = [];
  let paused = false;

  const audioCtx = (() => {
    let ctx = null;
    return {
      get() {
        if (!ctx) {
          try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
          catch (e) { ctx = null; }
        }
        return ctx;
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
      loseScoreEl.textContent = 'Score: ' + totalScore;
      loseScreen.classList.remove('hidden');
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
    constructor(x, y, leftBound, rightBound) {
      super(x, y, 36, 32);
      this.vx = 1.2;
      this.leftBound = leftBound;
      this.rightBound = rightBound;
      this.alive = true;
      this.animTimer = 0;
    }

    update() {
      if (!this.alive) return;
      this.x += this.vx;
      if (this.x <= this.leftBound) { this.x = this.leftBound; this.vx *= -1; }
      if (this.x + this.w >= this.rightBound) { this.x = this.rightBound - this.w; this.vx *= -1; }
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

  const LEVELS = [
    {
      width: 3200,
      playerStart: { x: 80, y: 380 },
      platforms: [
        { x: 0, y: 480, w: 3200, h: 60, type: 'ground' },
        { x: 0, y: 0, w: 40, h: 540, type: 'wall' },
        { x: 500, y: 400, w: 200, h: 30, type: 'dirt' },
        { x: 900, y: 340, w: 150, h: 30, type: 'dirt' },
        { x: 1200, y: 400, w: 250, h: 30, type: 'dirt' },
        { x: 1600, y: 300, w: 150, h: 30, type: 'dirt' },
        { x: 1900, y: 380, w: 200, h: 30, type: 'dirt' },
        { x: 2250, y: 320, w: 180, h: 30, type: 'dirt' },
        { x: 2600, y: 400, w: 220, h: 30, type: 'dirt' }
      ],
      coins: [
        { x: 550, y: 340 }, { x: 600, y: 340 }, { x: 650, y: 340 },
        { x: 940, y: 280 }, { x: 990, y: 280 },
        { x: 1280, y: 340 }, { x: 1330, y: 340 }, { x: 1380, y: 340 },
        { x: 1650, y: 240 }, { x: 1700, y: 240 },
        { x: 1980, y: 320 }, { x: 2030, y: 320 },
        { x: 2320, y: 260 }, { x: 2370, y: 260 },
        { x: 2680, y: 340 }, { x: 2730, y: 340 }, { x: 2780, y: 340 },
        { x: 1400, y: 200 }, { x: 1440, y: 180 }, { x: 1480, y: 200 }
      ],
      enemies: [
        { x: 700, y: 448, left: 620, right: 900 },
        { x: 1450, y: 448, left: 1300, right: 1700 },
        { x: 2050, y: 448, left: 1900, right: 2250 },
        { x: 2750, y: 448, left: 2600, right: 3000 }
      ],
      spikes: [
        { x: 1150, y: 448, w: 24, h: 32 },
        { x: 1174, y: 448, w: 24, h: 32 },
        { x: 2450, y: 448, w: 24, h: 32 },
        { x: 2474, y: 448, w: 24, h: 32 }
      ],
      goal: { x: 3080, y: 380, w: 40, h: 100 }
    },
    {
      width: 3600,
      playerStart: { x: 80, y: 380 },
      platforms: [
        { x: 0, y: 480, w: 3600, h: 60, type: 'ground' },
        { x: 0, y: 0, w: 40, h: 540, type: 'wall' },
        { x: 400, y: 380, w: 150, h: 30, type: 'dirt' },
        { x: 700, y: 300, w: 150, h: 30, type: 'dirt' },
        { x: 1000, y: 380, w: 150, h: 30, type: 'dirt' },
        { x: 1300, y: 280, w: 200, h: 30, type: 'dirt' },
        { x: 1700, y: 380, w: 150, h: 30, type: 'dirt' },
        { x: 2000, y: 300, w: 180, h: 30, type: 'dirt' },
        { x: 2350, y: 220, w: 150, h: 30, type: 'dirt' },
        { x: 2700, y: 380, w: 200, h: 30, type: 'dirt' },
        { x: 3050, y: 320, w: 180, h: 30, type: 'dirt' }
      ],
      coins: [
        { x: 440, y: 320 }, { x: 490, y: 320 },
        { x: 740, y: 240 }, { x: 790, y: 240 },
        { x: 1040, y: 320 }, { x: 1090, y: 320 },
        { x: 1350, y: 220 }, { x: 1400, y: 220 }, { x: 1450, y: 220 },
        { x: 1740, y: 320 }, { x: 1790, y: 320 },
        { x: 2050, y: 240 }, { x: 2100, y: 240 },
        { x: 2400, y: 160 }, { x: 2450, y: 160 },
        { x: 2750, y: 320 }, { x: 2800, y: 320 },
        { x: 3100, y: 260 }, { x: 3150, y: 260 },
        { x: 1600, y: 180 }, { x: 1650, y: 160 }, { x: 1700, y: 180 }
      ],
      enemies: [
        { x: 550, y: 448, left: 450, right: 700 },
        { x: 1150, y: 448, left: 1000, right: 1300 },
        { x: 1550, y: 448, left: 1400, right: 1700 },
        { x: 2250, y: 448, left: 2100, right: 2400 },
        { x: 2900, y: 448, left: 2700, right: 3050 }
      ],
      spikes: [
        { x: 900, y: 448, w: 24, h: 32 },
        { x: 924, y: 448, w: 24, h: 32 },
        { x: 1900, y: 448, w: 24, h: 32 },
        { x: 1924, y: 448, w: 24, h: 32 },
        { x: 2600, y: 448, w: 24, h: 32 }
      ],
      goal: { x: 3450, y: 380, w: 40, h: 100 }
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

    enemies = level.enemies.map(en => new Enemy(en.x, en.y, en.left, en.right));

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
    grad.addColorStop(0, '#1e2a4a');
    grad.addColorStop(0.6, '#2d4a6e');
    grad.addColorStop(1, '#1a3a5c');
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
    ctx.fillText(collectedCount + ' / ' + coins.length, W - 100, 38);

    ctx.fillStyle = '#ff9e7a';
    ctx.font = 'bold 18px Courier New';
    ctx.fillText('LVL ' + (levelIndex + 1), W - 40, 38);

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

  function winLevel() {
    if (state !== 'playing') return;
    state = 'won';
    sfxWin();
    winScoreEl.textContent = 'Score: ' + totalScore;
    winScreen.classList.remove('hidden');
    nextLevelBtn.textContent = levelIndex < LEVELS.length - 1 ? 'Next Level →' : 'Play Again';
  }

  function startGame(idx) {
    levelIndex = idx;
    if (idx === 0) totalScore = 0;
    loadLevel(idx);
    state = 'playing';
    paused = false;
    startScreen.classList.add('hidden');
    winScreen.classList.add('hidden');
    loseScreen.classList.add('hidden');
  }

  function nextLevel() {
    if (levelIndex < LEVELS.length - 1) {
      startGame(levelIndex + 1);
    } else {
      startGame(0);
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

  function loop(t) {
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
  });

  window.addEventListener('keyup', e => {
    keys[e.key] = false;
  });

  startBtn.addEventListener('click', () => {
    audioCtx.get();
    startGame(0);
  });
  nextLevelBtn.addEventListener('click', nextLevel);
  retryBtn.addEventListener('click', () => startGame(levelIndex));

  function bindTouch(el, key) {
    const on = e => { e.preventDefault(); touch[key] = true; el.classList.add('active'); };
    const off = e => { e.preventDefault(); touch[key] = false; el.classList.remove('active'); };
    el.addEventListener('touchstart', on, { passive: false });
    el.addEventListener('touchend', off, { passive: false });
    el.addEventListener('touchcancel', off, { passive: false });
    el.addEventListener('mousedown', on);
    el.addEventListener('mouseup', off);
    el.addEventListener('mouseleave', off);
  }

  bindTouch(document.getElementById('btnLeft'), 'left');
  bindTouch(document.getElementById('btnRight'), 'right');
  bindTouch(document.getElementById('btnJump'), 'jump');

  loadLevel(0);
  state = 'menu';
  requestAnimationFrame(loop);
})();
