/* Ícones de interface em pixel art, no mesmo estilo dos sprites da lavagem (contorno #1b1e24, luz de cima/esquerda).
 * Mapas 14×14 gerados por Features/pixel-kit/geradores/icones.py. Aqui cada desenho é centralizado pelo que tem
 * de pintado numa caixa de 16×16 e ganha o contorno de 1 px → todos ocupam o mesmo espaço e ficam no meio.
 *
 *   el.innerHTML = IconesPixel.svg('selo');              // <svg class="ip"> nítido em qualquer tamanho (use múltiplos de 16 px)
 *   IconesPixel.qr('00020126...', 25)                    // QR ilustrativo (não lê!) para o protótipo do PIX
 */
(function (global) {
  'use strict';

  const PALETA = {'k': '#1b1e24', 'w': '#ffffff', 's': '#d5dce4', 'S': '#8a95a1', 'z': '#4a525c', 'Z': '#6b7581', 'g': '#3fbf5f', 'G': '#a3f0ad', 'd': '#23803d', 'r': '#e5484d', 'R': '#ff9fa1', 'q': '#9e2a22', 'b': '#3b8fe0', 'B': '#a8d4ff', 'n': '#1f5aa6', 'y': '#f5c542', 'Y': '#fff1a8', 'o': '#c98a1a', 't': '#b07a45', 'T': '#e0b07a', 'u': '#7a4f26', 'v': '#8b5cf6', 'V': '#c4b5fd', 'm': '#5b3aa8'};

  const MAPAS = {
    check: ['..............','..............','............Gg','...........ggd','..........ggd.','..........gd..','.........ggd..','.Gg.....ggd...','.ggg...ggd....','..ggg..gd.....','...gggggd.....','....gggd......','.....gd.......','..............'],
    selo: ['.....GGGG.....','...GGggggGG...','..GggggggggG..','.GgwggggggggG.','.Gggggggggwgd.','GggggggggwwggG','Gggggggggwgggd','Gggwggggwwgggd','Gggwwggwwggggd','.Gggwwgwggggd.','.Ggggwwwggggd.','..Ggggwggggd..','...Gdggggdd...','.....Gddd.....'],
    x: ['..............','..............','..rr.......rr.','..rrr.....rrq.','...rrr...rrq..','....rrr.rrq...','.....rrrrq....','......rrq.....','.....rrqrr....','....rrq.rrr...','...rrq...rrr..','..rrq.....rrr.','..rq.......rq.','..............'],
    erro: ['.....RRRR.....','...RRrrrrRR...','..RrrrrrrrrR..','.RrRrrrrrrrrR.','.Rrrwwrrwwrrq.','RrrrrwwwwrrrrR','Rrrrrrwwrrrrrq','Rrrrrwwwwrrrrq','Rrrrwwrrwwrrrq','.Rrrrrrrrrrrq.','.Rrrrrrrrrrrq.','..Rrrrrrrrrq..','...Rqrrrrqq...','.....Rqqq.....'],
    info: ['.....BBBB.....','...BBbbbbBB...','..BbbbbbbbbB..','.BbbbbwwbbbbB.','.Bbbbbwwbbbbn.','BbbbbbbbbbbbbB','Bbbbbbwwbbbbbn','Bbbbbbwwbbbbbn','Bbbbbbwwbbbbbn','.Bbbbbwwbbbbn.','.Bbbbwwwwbbbn.','..Bbbbbbbbbn..','...Bnbbbbnn...','.....Bnnn.....'],
    alerta: ['......YY......','......Yo......','.....YyyY.....','.....Yyyo.....','....YykkyY....','....Yykkyo....','...YyykkyyY...','...Yyykkyyo...','..YyyykkyyyY..','..Yyyyyyyyyo..','.YyyyykkyyyyY.','.Yyyyykkyyyyo.','YyyyyyyyyyyyyY','Yooooooooooooo'],
    chat: ['......GGG.....','....GGgggGG...','...GgggggggG..','..GgwwggggggG.','..Ggwwwgggggd.','.GggwwgggggggG','.Ggggwgggggggd','.Gggggwggwwggd','..Gggggwwwwgd.','..Ggggggwwggd.','...Ggggggggd..','..Gdddgggdd...','.Gd...Gdd.....','Gd............'],
    pin: ['......RR......','....RRrrRR....','...wrrrrrrR...','..RrrrwwrrrR..','..Rrrwwwwrrq..','..Rrrwwwwrrq..','..Rrrrwwrrrq..','..Rrrrrrrrrq..','...Rrrrrrrq...','...Rrrrrrrq...','....Rrrrrq....','.....Rrrq.....','......Rq......','......Rq......'],
    cadeado: ['....ssSSSS....','...sS....SS...','...sS....SS...','...sS....SS...','...sS....SS...','.YYYYYYYYYYYY.','.Ywyyyyyyyyyo.','.Yyyyyyyyyyyo.','.Yyyyyuuyyyyo.','.Yyyyyuuyyyyo.','.Yyyyyuuyyyyo.','.Yyyyyuuyyyyo.','.Yyyyyyyyyyyo.','.Yooooooooooo.'],
    ampulheta: ['TTTTTTTTTTTTTT','Tuuuuuuuuuuuuu','..swssssssss..','...swyyyyys...','....syyyys....','.....syys.....','......ss......','......ys......','.....syss.....','....ssysss....','...ssyyyyss...','..syyyyyyyys..','TTTTTTTTTTTTTT','Tuuuuuuuuuuuuu'],
    velocimetro: ['..............','..............','..............','..............','..............','....yyyyyy....','..ggyyyyyyZZ..','..ggsssssZzr..','.ggsssssZzsrr.','.gssssZZzzssr.','ggsssZSzzsssrr','ggsssZzzzsssrr','ZZZZZzzzzZZZZZ','Zzzzzzzzzzzzzz'],
    nota: ['..wwwwwwws....','..wwwwwwwws...','..wwwwwwwwww..','..wwwwwwwwww..','..wwSSSSSSww..','..wwwwwwwwww..','..wwSSSSSSww..','..wwwwwwwwww..','..wwSSSSSSww..','..wwwwwwwwww..','..wwSSSSwwww..','..wwwwwwwwww..','..wwwwwwwwww..','..ssssssssss..'],
    copiar: ['wwwwwwwww.....','sssssssss.....','sssssssss.....','sssssssss.....','sssskkkkkkkkkk','sssskwwwwwwwwk','sssskwwwwwwwwk','sssskwSSSSSSwk','sssskwwwwwwwwk','....kwSSSSSwwk','....kwwwwwwwwk','....kwSSSSwwwk','....kwwwwwwwwk','....kkkkkkkkkk'],
    lista: ['..wwwwwwwwww..','..wwwwwwwwww..','..wwwwwwwwww..','..wwgwwSSSww..','..wwwgwwwwww..','..wwwwwwwwww..','..wwgwwSSSww..','..wwwgwwwwww..','..wwwwwwwwww..','..wwgwwSSSww..','..wwwgwwwwww..','..wwwwwwwwww..','..wwwwwwwwww..','...w.w.w.w.w..'],
    recibo: ['..wwwwwwwwww..','..wwwwwwwwww..','..wwSSSSSSww..','..wwwwwwwwww..','..wwSSSSwwww..','..wwwwwwwwww..','..wwSSSSSwww..','..wwwwwwwwww..','..wwwwwwwwww..','..wwrrrrrrww..','..wwrrrrrrww..','..wwwwwwwwww..','..wwwwwwwwww..','...w.w.w.w.w..'],
    prancheta: ['....zZZZZz....','TTTTzzzzzzTTTT','Ttttzzzzzztttu','Ttwwwwwwwwwwtu','Ttwwwwwwwwwwtu','Ttwwwwwwwwgwtu','Ttwwwwwwwggwtu','Ttwwgwwwggwwtu','Ttwwggwggwwwtu','Ttwwwgggwwwwtu','Ttwwwwgwwwwwtu','Ttwwwwwwwwwwtu','Tttttttttttttu','Tuuuuuuuuuuuuu'],
    calendario: ['...Zz....Zz...','...zz....zz...','RRRzzRRRRzzRRR','Rrrzzrrrrzzrrq','Rrrrrrrrrrrrrq','Rqqqqqqqqqqqqq','wwwwwwwwwwwwww','wwwwwwwwwwwwww','wwSSwSSwSSwSSw','wwwwwwwwwwwwww','wwwwwwwwwwwwww','wwSSwSSwrrwSSw','wwwwwwwwwwwwww','ssssssssssssss'],
    relogio: ['.....ssss.....','...sssSSsss...','..sswwwwwwss..','.sswwwzzwwwss.','.swwwwzzwwwws.','sswwwwzzwwwwss','sSwwwwrrzzzwSs','sSwwwwrrzzzwSs','sswwwwwwwwwwss','.swwwwwwwwwws.','.sswwwwwwwwss.','..sswwwwwwss..','...sssSSsss...','.....ssss.....'],
    gota: ['......BB......','......Bn......','.....BbbB.....','.....Bbbn.....','....BbbbbB....','...BbbbbbbB...','..BbbbbbbbbB..','..Bbwbbbbbbn..','.BbwbbbbbbbbB.','.Bbwbbbbbbbbn.','.Bbbbbbbbbbbn.','..Bbbbbbbbbn..','...Bnbbbbnn...','.....Bnnn.....'],
    brilho: ['......YY......','......Yo......','......Yo......','......Yo......','.....YyyY.....','....YyyyyY....','YYYYyywwyyYYYY','Yoooyywwyyoooo','....Yyyyyo....','.....Yyyo.....','......Yo......','......Yo......','......Yo......','......Yo......'],
    bandeira: ['.Zz...........','.Zzwwzzwwzzwwz','.Zzwwzzwwzzwwz','.Zzzzwwzzwwzzw','.Zzzzwwzzwwzzw','.Zzwwzzwwzzwwz','.Zzwwzzwwzzwwz','.Zzzzwwzzwwzzw','.Zzzzwwzzwwzzw','.Zz...........','.Zz...........','.Zz...........','.Zz...........','.Zz...........'],
    camera: ['..............','....ZZZZZZ....','....Zzzzzz....','ZZZZzzzzzzZZZZ','Zzzzzzzzzzyyzz','Zzzzzsssszzzzz','Zzzzssbbsszzzz','Zzzzswbbbszzzz','Zzzssbbbbsszzz','Zzzzsbbbbszzzz','Zzzzssbbsszzzz','Zzzzzsssszzzzz','Zzzzzzzzzzzzzz','..............'],
    qr: ['zzzzwzwwwwzzzz','zwwzwwwzwwzwwz','zwwzwwzwwwzwwz','zzzzwwwwzwzzzz','wwwwwzwwwzwwww','wwzwwwwwwwwwzw','zwwzwwzzwwwwww','wwwwwwwwwwzwwz','wwwwwzwwwwwwww','wwwwwwwwzwwzww','zzzzwwzwwwwwww','zwwzwwwwwzwwzw','zwwzwzwzwwwzww','zzzzwwwwwwzwwz'],
    moeda: ['.....YYYY.....','...YYyyyyYY...','..YywyyyyyyY..','.YywooyyooyyY.','.Yyoyyooyyoyo.','YyyoyyooyyoyyY','Yyyyyyooyyyyyo','Yyyyyyooyyyyyo','Yyyoyyooyyoyyo','.Yyoyyooyyoyo.','.Yyyooyyooyyo.','..Yyyyyyyyyo..','...Yoyyyyoo...','.....Yooo.....'],
    coracao: ['..............','..RRR....RRR..','.RrrrR..RrrrR.','RrrwwrRRrrrrrR','Rrrwrrrrrrrrrq','Rrrrrrrrrrrrrq','.Rrrrrrrrrrrq.','..Rrrrrrrrrq..','...Rrrrrrrq...','....Rrrrrq....','.....Rrrq.....','......Rq......','..............','..............'],
    bolha: ['..............','..............','....BBBBBB....','...BbbbbbbB...','..BbwwbbbbbB..','..Bbwbbbbbbn..','..Bbbbbbbbbn..','..Bbbbbbbbbn..','..Bbbbbbbbbn..','..Bbbbbbbbbn..','...Bbbbbbbn...','....Bnnnnn....','..............','..............'],
    mais: ['.....BBBB.....','...BBbbbbBB...','..BbbbbbbbbB..','.BbbbbwwbbbbB.','.Bbbbbwwbbbbn.','BbbbbbwwbbbbbB','Bbbwwwwwwwwbbn','Bbbwwwwwwwwbbn','Bbbbbbwwbbbbbn','.Bbbbbwwbbbbn.','.Bbbbbwwbbbbn.','..Bbbbbbbbbn..','...Bnbbbbnn...','.....Bnnn.....'],
    pessoas: ['..............','...vvv........','..vmmmv.......','..vmmmm.VVV...','..vmmmmVvvvV..','...vmm.Vvvvv..','.......Vvvvv..','.vvvvvv..V....','vmmmmmmv......','vmmmkvVVVVVV..','vmmmkVvvvvvvV.','vmmmkVvvvvvvvV','....kVvvvvvvvv','....kVvvvvvvvv'],
    capacete: ['..............','..............','..............','.....YYYY.....','...YYyYYoYY...','..YyyyYYoyyY..','..YwyyYYoyyo..','.YyyyyYYoyyyY.','.YyyyyYYoyyyo.','.YyyyyYYoyyyo.','YooooooooooooY','Yooooooooooooo','..............','..............'],
    cedula: ['..............','..dddddddddddd','..dddddddddddd','..dddddddddddd','GGGGGGGGGGGGdd','Gggggggggggddd','GgdggGGggggddd','GgggGgGGgggddd','GgggGGgGgggddd','GggggGGggdgd..','Gggggggggggd..','Gddddddddddd..','..............','..............'],
    chave: ['..............','........s...s.','.......sz...ss','.......sSsssSz','.......sSSSSSz','.......sSSSSSz','.......sSzSzz.','......sSz.s...','.....sSz......','....sSz.......','...sSz........','.ssSz.........','sSSz..........','.sz...........'],
    cracha: ['.....zzzz.....','.....zZZz.....','.BBBBzzzzBBBB.','.Bbbbbbbbbbbb.','.Bbbbbbbbbbbb.','.wwwwwwwwwwww.','.wwBBBBwwwwww.','.wwBbbbwSSSww.','.wwBBbBwwwwww.','.wwbbbbwSSSww.','.wwbbbbwwwwww.','.wwwwwwwwwwww.','.wwwwwwwwwwww.','.ssssssssssss.'],
    porta: ['.TTTTTTTTTTTT.','.Tttttttttttu.','.Ttuuuuuuuutu.','.Ttuttttttutu.','.Ttuttttttutu.','.Ttuuuuuuuutu.','.Tttttttttttu.','.Tttttttttyyu.','.Ttuuuuuuuutu.','.Ttuttttttutu.','.Ttuttttttutu.','.Ttuuuuuuuutu.','.Tttttttttttu.','.Tuuuuuuuuuuu.'],
    presente: ['...yyy..yyy...','..y...yy...y..','...yyyyyyyy...','RRRRRRyoRRRRRR','Rrrrrryorrrrrq','qqqqqqyoqqqqqq','.Rrrrryorrrrq.','.Rrrrryorrrrq.','.Rrrrryorrrrq.','.Rrrrryorrrrq.','.Rrrrryorrrrq.','.Rrrrryorrrrq.','.Rrrrryorrrrq.','.Rqqqqyoqqqqq.'],
    sofa: ['..............','..VVVVVVVVVV..','..Vvvvvmvvvm..','..Vvvvvmvvvm..','VVvvmvvmvvmvVV','Vvvvvvvmvvvvvm','Vvvvvvvmvvvvvm','Vvvmmmmmmmmvvm','Vvvvvvvvvvvvvm','Vvvvvvvvvvvvvm','Vmmmmmmmmmmmmm','.u..........u.','.u..........u.','..............'],
    caixa: ['...ZZZZZZZZ...','...ZGGGGGGz...','...ZGdGddGz...','...ZGGGGGGz...','...Zzzzzzzz...','ZZZzzzzzzzzZZZ','Zzzzzzzzzzzzzz','Zzsszsszsszrzz','Zzzzzzzzzzzrzz','Zzsszsszsszrzz','Zzzzzzzzzzzzzz','Zzzzzzzzzzzzzz','ZZZZZzzzzZZZZZ','ZZZZZZZZZZZZZZ'],
    carro: ['..............','..............','....GGGGGG....','...GggggggG...','..GgwBgBBBgG..','..GgBBgBBBgd..','GGggggggggggGG','rggggggggggggy','Gggggggggggggd','Gggzggggggzzgd','Gdzzzddddzzzzd','.zzszz...zszz.','..zzz....zzzz.','...z......zz..'],
    usuario: ['......BB......','....BBbbBB....','....Bwbbbn....','...BbbbbbbB...','...Bbbbbbbn...','....Bbbbbn....','....Bnbbnn....','......Bn......','..............','....BBBBBB....','..BBbbbbbbBB..','.BbbbbbbbbbbB.','BbbbbbbbbbbbbB','Bnnnnnnnnnnnnn'],
    moedas: ['..............','..yYYYyyyyyy..','.yyyyyyyyyoyy.','.oooooooooooo.','..yYYYyyyyyy..','.yyyyyyyyyoyy.','.oooooooooooo.','..yYYYyyyyyy..','.yyyyyyyyyoyy.','.oooooooooooo.','..yYYYyyyyyy..','.yyyyyyyyyoyy.','.oooooooooooo.','..............'],
  };

  // Junta pixels vizinhos da mesma cor numa linha em retângulos → um <path> por cor
  function paraSvg(linhas, classe) {
    const h = linhas.length, w = linhas[0].length, caminhos = {};
    for (let y = 0; y < h; y++) {
      let x = 0;
      while (x < w) {
        const ch = linhas[y][x];
        if (ch === '.') { x++; continue; }
        let fim = x; while (fim + 1 < w && linhas[y][fim + 1] === ch) fim++;
        (caminhos[ch] ??= []).push(`M${x} ${y}h${fim - x + 1}v1h-${fim - x + 1}z`);
        x = fim + 1;
      }
    }
    const corpo = Object.entries(caminhos).map(([ch, d]) => `<path fill="${PALETA[ch]}" d="${d.join('')}"/>`).join('');
    return `<svg class="${classe}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges" aria-hidden="true">${corpo}</svg>`;
  }

  const CAIXA = 16;
  function comContorno(linhas) {
    // centraliza pelo desenho (não pela grade) e contorna os pixels pintados
    let x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1;
    linhas.forEach((l, y) => [...l].forEach((ch, x) => { if (ch !== '.') { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }));
    const ox = Math.floor((CAIXA - (x1 - x0 + 1)) / 2) - x0, oy = Math.floor((CAIXA - (y1 - y0 + 1)) / 2) - y0;
    const em = (x, y) => linhas[y - oy]?.[x - ox] ?? '.';
    const saida = [];
    for (let y = 0; y < CAIXA; y++) {
      let l = '';
      for (let x = 0; x < CAIXA; x++) {
        const ch = em(x, y);
        if (ch !== '.') { l += ch; continue; }
        const vizinho = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => !'.k'.includes(em(x + a, y + b)));
        l += vizinho ? 'k' : '.';
      }
      saida.push(l);
    }
    return saida;
  }

  const cache = {};
  function svg(nome, classe = 'ip') {
    const chave = nome + '|' + classe;
    if (!cache[chave]) {
      if (!MAPAS[nome]) throw new Error('IconesPixel: ícone desconhecido ' + nome);
      cache[chave] = paraSvg(comContorno(MAPAS[nome]), classe);
    }
    return cache[chave];
  }

  // QR de mentira: três marcadores de canto + ruído fixo pelo texto (só visual)
  function qr(texto, n = 25) {
    let s = 2166136261;
    for (const c of texto) s = Math.imul(s ^ c.charCodeAt(0), 16777619);
    const rnd = () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)) >>> 0) / 4294967296;
    const g = Array.from({ length: n }, () => Array(n).fill('w'));
    const marcador = (ox, oy) => {
      for (let y = -1; y <= 7; y++) for (let x = -1; x <= 7; x++) {
        if (ox + x < 0 || oy + y < 0 || ox + x >= n || oy + y >= n) continue;
        const borda = x === 0 || y === 0 || x === 6 || y === 6, miolo = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        g[oy + y][ox + x] = x >= 0 && y >= 0 && x <= 6 && y <= 6 && (borda || miolo) ? 'k' : 'w';
      }
    };
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (rnd() < 0.48) g[y][x] = 'k';
    marcador(0, 0); marcador(n - 7, 0); marcador(0, n - 7);
    return paraSvg(g.map(l => l.join('')), 'ip-qr');
  }

  global.IconesPixel = { svg, qr, nomes: Object.keys(MAPAS), PALETA };
})(window);
