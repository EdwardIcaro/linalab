/* Cena animada do status da lavagem (96×48 px), reutilizável em qualquer página.
 *
 *   const cena = CenaLavagem.criar(canvas, { veiculo: 'hatch', cor: 'Prata', marca: '#00bcd4', placa: 'QTB5E21', status: 'lavando' });
 *   cena.set({ status: 'pronto' });   // troca qualquer opção; veículo/cor/marca/placa remontam os sprites
 *   cena.parar();
 *
 * status: pendente · lavando · pronto · finalizado · cancelado. Opção `noite` escurece a cena.
 * Depende de PixelKit (pixelkit.js) e SpritesLavagem (sprites-lavagem.js).
 */
(function (global) {
  'use strict';

  const W = 96, H = 48;

  function criar(canvas, opcoes) {
    const PK = global.PixelKit, { S, CORES_VEICULO, BASE, paletaVeiculo } = global.SpritesLavagem;
    const estado = Object.assign({ veiculo: 'hatch', cor: 'Prata', marca: '#00bcd4', placa: 'QTB5E21', status: 'lavando', noite: false }, opcoes);
    estado.t0 = performance.now();
    const tela = PK.screen(canvas, W, H);
    const ruido = (x, y) => PK.rng(PK.hash(x + ',' + y))(); // variação fixa por pixel (piso/parede)
    let spr;

    /* ── construção dos sprites (refeita quando muda veículo/cor/marca/placa) ── */
    function montar() {
      const v = S[estado.veiculo], pal = paletaVeiculo(CORES_VEICULO[estado.cor] ?? estado.cor);
      const contorno = '#1b1e24';
      const corpo = PK.outline(PK.sprite(v.rows, pal), contorno);
      const rodas = S[v.roda].map(q => PK.outline(PK.sprite(q, pal), contorno));
      const [mh, mb, md, mD] = PK.ramp(estado.marca);
      const rng = PK.rngFrom('sujeira', estado.placa, estado.veiculo);
      const sujeira = [];
      for (let y = 0; y < corpo.h; y++) for (let x = 0; x < corpo.w; x++) {
        if (!corpo.px[y * corpo.w + x]) continue;
        const chance = y > corpo.h * 0.55 ? 0.28 : 0.07; // mais barro embaixo
        if (rng() < chance) sujeira.push([x, y, rng() < 0.5 ? '#7a5b3a' : '#9b7b55']);
      }
      const bolhas = [];
      for (let i = 0; i < Math.round(corpo.w / 3); i++) bolhas.push([Math.floor(rng() * corpo.w), Math.floor(rng() * corpo.h * 0.7), 1 + Math.floor(rng() * 3), rng() * 6.28]);
      const brilhos = [];
      for (let i = 0; i < 4; i++) brilhos.push([4 + Math.floor(rng() * (corpo.w - 8)), 1 + Math.floor(rng() * corpo.h * 0.6), rng() * 6.28]);
      spr = {
        v, corpo, rodas, sujeira, bolhas, brilhos,
        gota: PK.sprite(S.gota, BASE),
        bolha: PK.sprite(S.bolha, BASE),
        brilho: S.brilho.map(q => PK.sprite(q, BASE)),
        relogio: PK.outline(PK.sprite(S.relogio, { w: '#ffffff', b: '#fde68a', k: '#7c4a03' }), '#7c4a03'),
        placa: PK.sprite(S.placa, { b: md, h: mh, w: '#ffffff', W: '#ffffff' }),
        coracao: PK.outline(PK.sprite(S.coracao, { r: '#e5484d', R: '#ffb3b5' }), '#7a1d22'),
        marca: { mh, mb, md, mD },
      };
    }

    function fundo() {
      const m = spr.marca;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let c;
        if (y < 30) {                                   // parede com azulejo
          const junta = x % 12 === 0 || y % 7 === 0;
          c = junta ? '#85919e' : ruido(x >> 2, y >> 2) < 0.15 ? '#9ca8b5' : '#94a0ad';
          if (y >= 19 && y <= 22) c = y === 19 ? m.mh : m.mb;   // faixa na cor da empresa
          if (y >= 28) c = '#5f6a76';                            // rodapé
        } else {                                        // piso de concreto
          const junta = (x + (y - 30) * 2) % 32 === 0 || y === 36 || y === 44;
          const r = ruido(x, y);
          c = junta ? '#6f7983' : r < 0.06 ? '#78828c' : r > 0.97 ? '#929ca6' : '#808a94';
        }
        tela.px(x, y, c);
      }
      tela.sprite(spr.placa, 5, 4);
      tela.rect(78, 2, 12, 2, '#5d6670'); tela.rect(80, 4, 8, 2, estado.noite ? '#fff3c4' : '#e2e8f0');   // luminária
      tela.rect(44, 44, 9, 2, '#5f6871'); for (let i = 0; i < 4; i++) tela.px(45 + i * 2, 44, '#454d55');    // ralo
    }

    function sombra(cx, larg, y) {
      for (let x = -larg; x <= larg; x++) {
        const k = 1 - (x / larg) ** 2;
        tela.px(cx + x, y, '#000000', 0.22 * k); tela.px(cx + x, y + 1, '#000000', 0.12 * k);
      }
    }

    function veiculo(x, y, quadroRoda, op = {}) {
      const { corpo, rodas, v } = spr;
      sombra(x + corpo.w / 2 | 0, corpo.w / 2 + 1 | 0, y + v.rodas[0][1] + rodas[0].h - 1);
      const desenharRodas = () => { for (const [rx, ry] of v.rodas) tela.sprite(rodas[quadroRoda % rodas.length], x + rx, y + ry); };
      if (v.rodasAtras) desenharRodas();
      tela.sprite(corpo, x, y);
      if (!v.rodasAtras) desenharRodas();
      if (op.sujeira > 0) for (const [sx, sy, c] of spr.sujeira) tela.px(x + sx, y + sy, c, op.sujeira);
      if (op.reflexo !== undefined) {           // faixa diagonal de luz atravessando a lataria
        const pos = op.reflexo * (corpo.w + 30) - 15;
        for (let j = 0; j < corpo.h; j++) for (let i = 0; i < corpo.w; i++) {
          if (!corpo.px[j * corpo.w + i]) continue;
          const d = Math.abs(i + j * 0.6 - pos);
          if (d < 3) tela.px(x + i, y + j, '#ffffff', d < 1.2 ? 0.55 : 0.25);
        }
      }
    }

    function posicao() {
      const c = spr.corpo, base = spr.v.rodas[0][1] + spr.rodas[0].h;
      return { x: (W - c.w) / 2 | 0, y: 41 - base };
    }

    function desenhar(f, t) {
      fundo();
      const { x, y } = posicao(), c = spr.corpo;
      const st = estado.status;

      if (st === 'pendente') {
        veiculo(x, y, 0, { sujeira: 0.9 });
        tela.sprite(spr.relogio, x + c.w - 4, Math.max(1, y - 12) + Math.round(Math.sin(t * 3) * 1.5));
      }

      if (st === 'lavando') {
        const ciclo = (t % 9) / 9;                          // a sujeira some ao longo de 9 s e recomeça
        const pl = 10 + Math.round(ciclo * (c.w / 2));      // poça que cresce e ondula
        for (let i = -pl; i <= pl; i++) for (let j = 0; j < 3; j++) {
          const k = 1 - (i / pl) ** 2 - j * 0.25; if (k > 0) tela.px(x + c.w / 2 + i, 42 + j, '#5fb3e8', 0.35 * k);
        }
        const onda = (f % 12) / 12 * pl;
        tela.px(x + c.w / 2 - onda, 43, '#bfe6ff', 0.8); tela.px(x + c.w / 2 + onda, 43, '#bfe6ff', 0.8);
        veiculo(x, y, 0, { sujeira: 0.9 * (1 - ciclo) });
        for (const [bx, by, r, fase] of spr.bolhas) {       // espuma
          const rr = r + Math.round(Math.sin(t * 2 + fase) * 0.6);
          for (let j = -rr; j <= rr; j++) for (let i = -rr; i <= rr; i++) {
            const d = i * i + j * j; if (d > rr * rr + 1) continue;
            if (!c.px[Math.max(0, Math.min(c.h - 1, by + j)) * c.w + Math.max(0, Math.min(c.w - 1, bx + i))]) continue;
            tela.px(x + bx + i, y + by + j, d > (rr - 1) * (rr - 1) ? '#cfeaf7' : '#ffffff', 0.92);
          }
        }
        tela.rect(0, 18, 5, 2, '#2f3a45'); tela.rect(5, 17, 3, 4, '#f59e0b');   // mangueira + jato em arco
        for (let p = 0; p < 18; p++) {
          const fase = ((f * 0.07) + p / 18) % 1, alvoX = x + 6 + (p % 5) * 4;
          const px = 8 + (alvoX - 8) * fase, py = 19 - 5 * Math.sin(fase * Math.PI) + fase * (y - 15);
          tela.px(px, py, p % 3 ? '#5fb3e8' : '#bfe6ff', 0.95);
        }
        for (let i = 0; i < 5; i++) {                       // pingos caindo da lataria
          const gx = x + 6 + ((i * 37) % (c.w - 10)), queda = ((f + i * 5) % 14) / 14;
          tela.sprite(spr.gota, gx, y + c.h - 3 + Math.round(queda * 6), 1 - queda * 0.6);
        }
        for (let i = 0; i < 3; i++) {                       // bolhas subindo
          const sobe = ((t * 0.4 + i / 3) % 1);
          tela.sprite(spr.bolha, x + 10 + i * 13 + Math.round(Math.sin(t * 2 + i) * 2), y - 2 - Math.round(sobe * 14), 1 - sobe);
        }
      }

      if (st === 'pronto') {
        veiculo(x, y, 0, { reflexo: (t % 2.6) / 1.6 });
        for (const [bx, by, fase] of spr.brilhos) {
          const q = Math.floor(((t * 1.6 + fase) % 3)); const s = spr.brilho[q === 2 ? 1 : q];
          if (Math.sin(t * 2 + fase) > -0.2) tela.sprite(s, x + bx - (s.w >> 1), y + by - (s.h >> 1));
        }
      }

      if (st === 'finalizado') {
        const tt = (performance.now() - estado.t0) / 1000;
        const saida = Math.min(1, Math.max(0, (tt - 0.6) / 2.2));
        if (saida < 1) veiculo(x + Math.round(saida * saida * (W - x + 4)), y, saida > 0 ? Math.floor(tt * 10) : 0);
        if (saida > 0.7) {
          const sobe = Math.min(1, (tt - 2.4) / 1.2);
          tela.sprite(spr.coracao, W / 2 - 4, 24 - Math.round(sobe * 6) + Math.round(Math.sin(t * 3)), Math.max(0, sobe));
        }
      }

      if (st === 'cancelado') veiculo(x, y, 0, { sujeira: 0.9 });

      if (estado.noite) {
        tela.tint('#141a3a', 0.5);
        for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {      // luz da luminária
          const d = Math.hypot(xx - 84, (yy - 5) * 1.3); if (d < 40) tela.px(xx, yy, '#ffe7a8', 0.32 * (1 - d / 40) ** 1.6);
        }
      }
      if (st === 'cancelado') tela.grayscale();
      tela.flush();
    }

    montar();
    const anim = PK.loop(12, desenhar);
    return {
      set(novas) {
        const remonta = ['veiculo', 'cor', 'marca', 'placa'].some(k => k in novas && novas[k] !== estado[k]);
        if ('status' in novas && novas.status !== estado.status) estado.t0 = performance.now();
        Object.assign(estado, novas);
        if (remonta) montar();
      },
      get estado() { return { ...estado }; },
      get sprites() { return spr; },
      parar() { anim.parar(); },
    };
  }

  global.CenaLavagem = { criar, W, H };
})(window);
