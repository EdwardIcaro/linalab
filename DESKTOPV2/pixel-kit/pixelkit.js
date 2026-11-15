/* PixelKit — motor mínimo de pixel art procedural (Lina).
 *
 * Ideia: sprite = mapa de texto onde cada caractere é um PAPEL de cor ("h" luz, "b" base, "d" sombra...),
 * não uma cor fixa. A paleta resolve papel → cor na hora de desenhar, então o mesmo carro sai prata,
 * vermelho ou na cor da empresa sem redesenhar nada. Tudo é desenhado em canvas pequeno e ampliado
 * sem suavização.
 */
(function (global) {
  'use strict';

  // ── aleatoriedade determinística: mesma semente → mesmo resultado ──
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  const rngFrom = (...partes) => rng(hash(partes.join('|')));

  // ── cor ──
  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.replace(/./g, c => c + c) : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgbToHex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  function mix(a, b, t) {
    const x = hexToRgb(a), y = hexToRgb(b);
    return rgbToHex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
  }
  function hslToHex(h, s, l) {
    h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
  }
  /* Rampa de 4 tons a partir de uma cor base: [luz, base, sombra, sombra funda].
   * Sombra puxa o matiz para o azul/roxo e luz para o amarelo: é o que deixa pixel art "viva"
   * em vez de só mais clara/escura. */
  function ramp(base) {
    const [h, s, l] = rgbToHsl(...hexToRgb(base));
    const puxa = (alvo, t) => h + ((((alvo - h) % 360) + 540) % 360 - 180) * t;
    return [
      hslToHex(puxa(55, 0.12), s * 0.95, Math.min(0.94, l + 0.16)),
      base,
      hslToHex(puxa(250, 0.12), Math.min(1, s * 1.05), l * 0.72),
      hslToHex(puxa(255, 0.2), Math.min(1, s * 1.1), l * 0.48),
    ];
  }

  // ── sprite ──
  /* rows: array de strings; '.' ou ' ' = transparente. pal: { papel: '#rrggbb' | '#rrggbbaa' }.
   * Linhas curtas são completadas com transparente. */
  function sprite(rows, pal) {
    const h = rows.length, w = Math.max(...rows.map(r => r.length));
    const px = new Array(w * h).fill(null);
    for (let y = 0; y < h; y++) for (let x = 0; x < rows[y].length; x++) {
      const c = rows[y][x];
      if (c === '.' || c === ' ') continue;
      if (!(c in pal)) throw new Error(`PixelKit: papel "${c}" sem cor na paleta`);
      px[y * w + x] = pal[c];
    }
    return { w, h, px };
  }
  // contorno de 1px em volta dos pixels opacos (4 vizinhos); aumenta o sprite em 1px por lado
  function outline(s, cor) {
    const w = s.w + 2, h = s.h + 2, px = new Array(w * h).fill(null);
    const at = (x, y) => (x >= 0 && y >= 0 && x < s.w && y < s.h ? s.px[y * s.w + x] : null);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = at(x - 1, y - 1);
      if (v) px[y * w + x] = v;
      else if (at(x - 2, y - 1) || at(x, y - 1) || at(x - 1, y - 2) || at(x - 1, y)) px[y * w + x] = cor;
    }
    return { w, h, px };
  }
  function flipX(s) {
    const px = new Array(s.px.length);
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) px[y * s.w + x] = s.px[y * s.w + (s.w - 1 - x)];
    return { w: s.w, h: s.h, px };
  }
  // troca cores (ex.: tirar cor para "cancelado")
  function mapColors(s, fn) { return { w: s.w, h: s.h, px: s.px.map(c => (c ? fn(c) : c)) }; }
  function grayscale(c) {
    const [r, g, b] = hexToRgb(c.slice(0, 7)); const v = r * 0.3 + g * 0.59 + b * 0.11;
    return rgbToHex(v, v, v) + c.slice(7);
  }

  // ── tela ──
  /* Cena em baixa resolução: escreve num ImageData e amplia sem suavização. */
  function screen(canvas, w, h) {
    canvas.width = w; canvas.height = h;
    canvas.style.imageRendering = 'pixelated';
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const img = ctx.createImageData(w, h), buf = new Uint32Array(img.data.buffer);
    const cache = new Map();
    function abgr(c) {
      let v = cache.get(c);
      if (v === undefined) {
        const [r, g, b] = hexToRgb(c.slice(0, 7)), a = c.length > 7 ? parseInt(c.slice(7, 9), 16) : 255;
        v = ((a << 24) | (b << 16) | (g << 8) | r) >>> 0; cache.set(c, v);
      }
      return v;
    }
    function blend(i, c, alpha) {
      const [r, g, b] = hexToRgb(c.slice(0, 7)), o = buf[i];
      const or = o & 255, og = (o >> 8) & 255, ob = (o >> 16) & 255;
      buf[i] = ((255 << 24) | (Math.round(ob + (b - ob) * alpha) << 16) | (Math.round(og + (g - og) * alpha) << 8) | Math.round(or + (r - or) * alpha)) >>> 0;
    }
    const api = {
      w, h, ctx,
      clear(c) { buf.fill(abgr(c)); },
      px(x, y, c, alpha) {
        x |= 0; y |= 0;
        if (x < 0 || y < 0 || x >= w || y >= h || !c) return;
        const a = alpha ?? (c.length > 7 ? parseInt(c.slice(7, 9), 16) / 255 : 1);
        if (a >= 1) buf[y * w + x] = abgr(c); else if (a > 0) blend(y * w + x, c, a);
      },
      rect(x, y, rw, rh, c, alpha) { for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) api.px(x + i, y + j, c, alpha); },
      sprite(s, x, y, alpha) {
        for (let j = 0; j < s.h; j++) for (let i = 0; i < s.w; i++) { const c = s.px[j * s.w + i]; if (c) api.px(x + i, y + j, c, alpha); }
      },
      // escurece/tinge a cena inteira (noite, cancelado)
      tint(c, alpha) { for (let i = 0; i < buf.length; i++) blend(i, c, alpha); },
      // tira a cor da cena inteira (ex.: cancelado)
      grayscale() {
        for (let i = 0; i < buf.length; i++) {
          const o = buf[i], v = Math.round((o & 255) * 0.3 + ((o >> 8) & 255) * 0.59 + ((o >> 16) & 255) * 0.11);
          buf[i] = ((255 << 24) | (v << 16) | (v << 8) | v) >>> 0;
        }
      },
      flush() { ctx.putImageData(img, 0, 0); },
    };
    return api;
  }

  // ── animação ──
  /* Loop com fps fixo (pixel art fica melhor "travada" em 8–12 fps), pausa com a aba escondida
   * e respeita prefers-reduced-motion (desenha um quadro só). */
  function loop(fps, desenhar) {
    const parado = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let ativo = true, t0 = performance.now(), ultimo = -1;
    function passo(agora) {
      if (!ativo) return;
      const f = Math.floor(((agora - t0) / 1000) * fps);
      if (f !== ultimo) { ultimo = f; desenhar(f, (agora - t0) / 1000); }
      if (!parado) requestAnimationFrame(passo);
    }
    requestAnimationFrame(passo);
    return { parar() { ativo = false; }, reiniciar() { t0 = performance.now(); ultimo = -1; } };
  }

  // ── exportação (para usar os sprites fora, em outros projetos) ──
  function toCanvas(s, escala = 1) {
    const c = document.createElement('canvas');
    c.width = s.w * escala; c.height = s.h * escala;
    const ctx = c.getContext('2d');
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
      const v = s.px[y * s.w + x]; if (!v) continue;
      ctx.fillStyle = v; ctx.fillRect(x * escala, y * escala, escala, escala);
    }
    return c;
  }
  // folha de sprites: quadros lado a lado, mesma altura
  function sheet(quadros, escala = 1) {
    const w = Math.max(...quadros.map(q => q.w)), h = Math.max(...quadros.map(q => q.h));
    const c = document.createElement('canvas'); c.width = w * quadros.length * escala; c.height = h * escala;
    const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
    quadros.forEach((q, i) => ctx.drawImage(toCanvas(q, escala), i * w * escala, (h - q.h) * escala));
    return c;
  }
  function baixar(canvas, nome) {
    const a = document.createElement('a'); a.download = nome; a.href = canvas.toDataURL('image/png'); a.click();
  }

  global.PixelKit = { rng, hash, rngFrom, hexToRgb, rgbToHex, mix, ramp, sprite, outline, flipX, mapColors, grayscale, screen, loop, toCanvas, sheet, baixar };
})(window);
