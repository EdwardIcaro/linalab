/* Sprites da lavagem (originais da Lina). Cada caractere é um papel de cor; a paleta vem depois.
 *   h luz · b base · d sombra · D sombra funda   (rampa da cor do veículo)
 *   g vidro · G reflexo do vidro · V vidro escuro (base) · k pneu · r aro · R aro claro · c friso/cromado
 *   y farol · l/L lanterna · s banco · e/E motor · o/O garfo dourado · K brilho do pneu · p plástico preto (para-choque, moldura do para-lama)
 * Veículos olham para a DIREITA. Rodas são sprites à parte (giram trocando de quadro); os arcos
 * acima delas já vêm recortados no corpo.
 */
(function (global) {
  'use strict';

  const S = {
    hatch: {
      nome: 'Hatch',
      rows: [
        '........hhhhhhhhhhhhhhhhhh',
        '.......hbbbbbbbbbbbbbbbbbbb',
        '.......hgbbbpggGggggpgggGGgb',
        '......hggbbbpgGgggggpggGGggGb',
        '......hggbbbpGggggggpgGGggGgb',
        '.....hggGbbbpgggggggpGGggGgggb',
        '....hggGGbbbpgggggggpGggGgggggb.b',
        '....hVVVVbbbpVVVVVVVpVVVVVVVVVVpbb',
        '..hhhhhhhhhhhhhhhhhhhhhhhhhhhhhphhhhhh',
        '.llLbbbbbbbbdbbbbbbbdbbbbbbbbbbbdbbbbbhhhhh',
        '.LlbbbDDDDDDDDbRrbbbdbbbbbRrbbbbdDDDDDDDDbbhh',
        '.bbhhDD......DDDDhhhdhhhhhDDhhhhDD......DDhyyW',
        '.dddDD........DDdddddddddddddddDD........DDdyy',
        '.ddDD..........DDdddddddddddddDD..........DDdp',
        '.ppD............DdddddddddddddD............Dpc',
        '.ppD............DDDDDDDDDDDDDDD............Dpp',
        '.ppD............DpppppppppppppD............Dp',
      ],
      rodas: [[4, 11], [31, 11]],
      roda: 'rodaMedia',
    },
    seda: {
      nome: 'Sedã',
      rows: [
        '..................hhhhhhhhhhhhhhhh',
        '.................hbbbbbbbbbbbbbbbbb',
        '................hggbbgggGGggGpgggggb',
        '...............hgggbbggGGggGgpggggggb',
        '..............hggggbbgGGggGggpgggggGGb',
        '.............hgggggbbGGggGgggpggggGGggb',
        '............hggggggbbGggGggggpgggGGggGgb.b',
        '...........hVVVVVVVbbVVVVVVVVpVVVVVVVVVVpbb',
        '.....hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhphhhhhhh',
        'hhhhhbbbDDDDDDDDbbbdbbbbbbbbbdbbbbbbbbbbbdbbDDDDDDDDhhh',
        'llLbbbbDD......DDbbdbbbRrbbbbdbbbbRrbbbbbdbDD......DDbbhh',
        'LlhhhhDD........DDhdhhhDDhhhhdhhhhDDhhhhhdDD........DDhyyW',
        'dddddDD..........DDddddddddddddddddddddddDD..........DDdyy',
        'ppdddD............DddddddddddddddddddddddD............Ddpp',
        'ppDDDD............DDDDDDDDDDDDDDDDDDDDDDDD............DDpc',
        'pppppD............DppppppppppppppppppppppD............Dpp',
      ],
      rodas: [[6, 10], [42, 10]],
      roda: 'rodaMedia',
    },
    suv: {
      nome: 'SUV',
      rows: [
        '.....pcccccccccccccccccccccccp',
        '...hhhhhhhhhhhhhhhhhhhhhhhhhhhhh',
        '...hbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        '...hgggggggppggGggggggppGGggGgggb',
        '...hggggggGppgGgggggggppGggGgggggb',
        '...hgggggGGppGggggggggppggGgggggggb',
        '..hgggggGGgppggggggggGppgGggggggggb',
        '..hggggGGggppgggggggGGppGggggggggGGb',
        '..hgggGGggGppggggggGGgppggggggggGGggbb',
        '..hVVVVVVVVppVVVVVVVVVppVVVVVVVVVVVVpbb',
        '..hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhphhhhhhh',
        '.llLbbbbbbbdbbbbbbbbbbdbbbbbbbbbbbbbbdbbbbbbhhhhhhh',
        '.LlbbbppppppppbbRrbbbbdbbbbbbbbRrbbbbdbbbbppppppppbhh',
        '.bbhhpp......pphDDhhhhdhhhhhhhhDDhhhhdhhhpp......ppyyW',
        '.bbbp..........pbbbbbbdbbbbbbbbbbbbbbdbbp..........pyy',
        '.ddp............pddddddddddddddddddddddp............pp',
        '.dpp............ppddddddddddddddddddddpp............pp',
        '.pp..............pddddddddddddddddddddp..............p',
        '.pp..............pDDDDDDDDDDDDDDDDDDDDp..............p',
        '.pp..............pppppppppppppppppppppp',
      ],
      rodas: [[3, 13], [39, 13]],
      roda: 'rodaGrande',
    },
    picape: {
      nome: 'Picape',
      rows: [
        '.........................hhhhhhhhhhhh',
        '.........................hbbbbbbbbbbbb',
        '.........................hggGggggppggGb',
        '.........................hgGgggggppgGGb',
        '.........................hGggggggppGGggb',
        '........................hGgggggggppGggGgb',
        '........................hggggggggppggGgggb',
        '........................hgggggggGppgGggggb.b',
        '.cccpcccpcccpcccpcccpccphVVVVVVVVppVVVVVVVpbb',
        '.hhhhhhhhhhhhhhhhhhhhhhphhhhhhhhhhhhhhhhhhphhhhhhhh',
        'lddbbbbbbbbbbbbbbbbbbbbpdbbbbbbbbdbbbbbbbbbdbbbbbbbhhhhhhhhh',
        'LlbbbbppppppppbbbbbbbbbpdbbbRrbbbdbbbbRrbbbdbbbbbppppppppbbbhhh',
        'bbhhhpp......pphhhhhhhhpdhhhDDhhhdhhhhDDhhhdhhhhpp......pphhhyyW',
        'bbbbp..........pbbbbbbbpdbbbbbbbbdbbbbbbbbbdbbbp..........pbbbyy',
        'dddp............pddddddpddddddddddddddddddddddp............pdddc',
        'ddpp............ppdddddpdddddddddddddddddddddpp............ppddp',
        'ppp..............pdddddpdddddddddddddddddddddp..............pdpc',
        'ppp..............pDDDDDpDDDDDDDDDDDDDDDDDDDDDp..............pDpp',
        'ppp..............ppppppppppppppppppppppppppppp..............ppp',
      ],
      rodas: [[3, 12], [46, 12]],
      roda: 'rodaGrande',
    },
    van: {
      nome: 'Van',
      rows: [
        '.hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh',
        '.hbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        '.hGggggggggGbbgGggggggggppggGggggggggGppgb',
        '.hggggggggGGbbGggggggggGppgGggggggggGGppGgb',
        '.hgggggggGGgbbggggggggGGppGggggggggGGgppgggb',
        'hgggggggGGggbbgggggggGGgppggggggggGGggppggggb',
        'hggggggGGggGbbggggggGGggppgggggggGGggGppggggb',
        'hgggggGGggGgbbgggggGGggGppggggggGGggGgppgggggb',
        'hggggGGggGggbbggggGGggGgppgggggGGggGggppggggGGbb',
        'hVVVVVVVVVVVbbVVVVVVVVVVppVVVVVVVVVVVVppVVVVVVpbb',
        '.hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhphhhh',
        'llLbbbbDDDDDDDDbbbbbbbbbdbbbbbbbbbbbbbdbbbbbbDDDDDDDDh',
        'LlddddDD......DDdddddddbdbbbbbRrbbbbbbdbbbRrDD......DDhh',
        'bbhhhDD........DDhhhhhhhdhhhhhDDhhhhhhdhhhDDD........DDbh',
        'ddddDD..........DDddddddddddddddddddddddddDD..........DDyW',
        'ddddD............DddddddddddddddddddddddddD............Dyy',
        'ppddD............DddddddddddddddddddddddddD............Dpc',
        'ppDDD............DDDDDDDDDDDDDDDDDDDDDDDDDD............Dpp',
        'ppppD............DppppppppppppppppppppppppD............Dp',
      ],
      rodas: [[5, 12], [43, 12]],
      roda: 'rodaMedia',
    },
    moto: {
      nome: 'Moto',
      rows: [
        '..................................GGg',
        '.................................gGGgh',
        '.hh.............................ggGGbhkK',
        '.hbhh...............hhhhhhh....gggGbbhk',
        '..dbbhhh..........hhbbbbbbbh..ggggbhbbh',
        '...ddbbbhhh.....hhbbbbbbbbbbbdbbwwbbbbbWh',
        '.....ddbbbbbsssssbbhhhbbbbbbbbdbbbwwbbbWyy',
        '.......ddddbsssssdbbbbhhhbbbbbdbbbbbwwbbyyp',
        '..........dddDDDeeEEdbbbbbhhhdbpEpEpddoppD',
        '........crrrrrcEeeeEdbbbbbbhhhpEpEpDDdoOhhb',
        '.........cccccEeEEeeEdbbDDDbbbhhbbDdbdoO.bbd',
        '...........cc.eEeeEeeEdbbbbbbbbbbbbbbdD.oO.dd',
        '.........cc...EeeEEeeEdbbDbDbDbbbbbdD...oO',
        '.......cc.....EEeeeEE.dbbbbbbbbbdD..ll.oO',
        '......c.........EEEE...DDDDDDDDD.......oO',
      ],
      rodas: [[0, 8], [32, 8]],
      roda: 'rodaMoto',
      rodasAtras: true, // a carenagem cobre a parte de cima das rodas
    },
    // rodas dos carros geradas por código (pneu com brilho, aro de liga com raios; o 2º quadro gira)
    rodaMedia: [
      ['....KKKK....', '..KKkkkkkk..', '.KKkkRRkkkk.', '.kkRccRRRkk.', 'kkkrRcRcckkk', 'kkrcrkkrrrkk', 'kkrcrkkrrrkk', 'kkkrrcrcckkk', '.kkrccrrrkk.', '.kkkkrrkkkk.', '..kkkkkkkk..', '....kkkk....'],
      ['....KKKK....', '..KKkkkkkk..', '.KKkkRRkkkk.', '.kkRRRccRkk.', 'kkkccRcRrkkk', 'kkrrrkkrcrkk', 'kkrrrkkrcrkk', 'kkkccrcrrkkk', '.kkrrrccrkk.', '.kkkkrrkkkk.', '..kkkkkkkk..', '....kkkk....'],
    ],
    rodaGrande: [
      ['....KKKKKK....', '...KKkkkkKk...', '..KkkRRRRkkk..', '.kkkRRccRRkkk.', 'kkkRRRRRRRRkkk', 'kkrccRRRRccrkk', 'kkrrrrkkrrrrkk', 'kkrrrrkkrrrrkk', 'kkrccrrrrccrkk', 'kkkrrrrrrrrkkk', '.kkkrrccrrkkk.', '..kkkrrrrkkk..', '...kkkkkkkk...', '....kkkkkk....'],
      ['....KKKKKK....', '...KKkkkkKk...', '..KkkRRRRkkk..', '.kkkRcRRcRkkk.', 'kkkRRcRRcRRkkk', 'kkrrrRRRRrrrkk', 'kkrcrrkkrrcrkk', 'kkrcrrkkrrcrkk', 'kkrrrrrrrrrrkk', 'kkkrrcrrcrrkkk', '.kkkrcrrcrkkk.', '..kkkrrrrkkk..', '...kkkkkkkk...', '....kkkkkk....'],
    ],
    // roda da moto 14×14: pneu grosso, aro na cor da moto, 3 raios (o 2º quadro gira 60°)
    rodaMoto: [
      ['....KKKKKK....', '...KKkkkkKk...', '..Kkkkhhkkkk..', '.kkkhhDDhhkkk.', 'kkkhbbbDDDhkkk', 'kkkhDrrrrDhkkk', 'kkbDDrccrbbbkk', 'kkbDDrccrbbbkk', 'kkkbDrrrrDbkkk', 'kkkbbbbDDDbkkk', '.kkkbbDDbbkkk.', '..kkkkbbkkkk..', '...kkkkkkkk...', '....kkkkkk....'],
      ['....KKKKKK....', '...KKkkkkKk...', '..Kkkkhhkkkk..', '.kkkhhDDhhkkk.', 'kkkhDDDbbbhkkk', 'kkkhDrrrrDhkkk', 'kkbbbrccrDDbkk', 'kkbbbrccrDDbkk', 'kkkbDrrrrDbkkk', 'kkkbDDDbbbbkkk', '.kkkbbDDbbkkk.', '..kkkkbbkkkk..', '...kkkkkkkk...', '....kkkkkk....'],
    ],
    gota: ['.a.', 'aAa', 'aAa', '.a.'],
    bolha: ['.www.', 'w..Ww', 'w...w', 'w...w', '.www.'],
    brilho: [
      ['..y..', '.yYy.', '..y..'],
      ['...y...', '...Y...', '.yYWYy.', '...Y...', '...y...'],
      ['....y....', '....Y....', '....Y....', '.yYYWYYy.', '....Y....', '....Y....', '....y....'],
    ],
    relogio: ['..www..', '.wbbbw.', 'wbbkbbw', 'wbbkkbw', 'wbbbbbw', '.wbbbw.', '..www..'],
    placa: ['bbbbbbbbbbbb', 'bhhhhhhhhhhb', 'bh....w...hb', 'bh....w...hb', 'bh...www..hb', 'bh..wwwww.hb', 'bh..wwwww.hb', 'bh...www..hb', 'bhhhhhhhhhhb', 'bbbbbbbbbbbb'],
    coracao: ['.rr.rr.', 'rRrrrrr', 'rrrrrrr', '.rrrrr.', '..rrr..', '...r...'],
  };

  // ordem dos botões: categorias de carro primeiro, moto por último
  const CATEGORIAS = ['hatch', 'seda', 'suv', 'picape', 'van', 'moto'];

  const CORES_VEICULO = { Prata: '#aeb7c0', Branco: '#e6eaee', Preto: '#3b4048', Vermelho: '#c43a31', Azul: '#2f6db3', Amarelo: '#e2b52b' };

  // paleta fixa dos papéis que não dependem da cor do veículo
  const BASE = {
    g: '#5b7fa6', G: '#cfe3f5', k: '#1d2026', r: '#8a929c', R: '#d5dbe1', c: '#5d6670',
    y: '#ffe9a3', l: '#e0473c', L: '#9e2a22', V: '#3f5f84', s: '#2a2d33', e: '#6f7780', E: '#474d56', o: '#d9a441', O: '#f6d98a', K: '#4a515c', p: '#2b2f36',
    a: '#5fb3e8', A: '#bfe6ff', w: '#eaf6ff', W: '#ffffff', Y: '#fff6c9',
  };

  function paletaVeiculo(cor) {
    const [h, b, d, D] = PixelKit.ramp(cor);
    return { ...BASE, h, b, d, D };
  }

  global.SpritesLavagem = { S, CATEGORIAS, CORES_VEICULO, BASE, paletaVeiculo };
})(window);
