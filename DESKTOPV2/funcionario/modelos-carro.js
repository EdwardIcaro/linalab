/**
 * Sugestões de modelo de carro — componente compartilhado das páginas da subconta.
 *
 * Qualquer <input data-modelo-carro> ganha a lista ao receber foco (funciona com campos
 * criados depois, inclusive pelo Alpine). A lista aparece logo abaixo, dentro do elemento
 * marcado com data-modelo-host (ou do pai do campo), ocupando a largura toda.
 *
 * Fontes: catálogo fixo de modelos vendidos no Brasil + modelos que a empresa já usa
 * (GET /api/veiculos/modelos). Os mais usados aparecem primeiro. Tolera erro de digitação
 * (sem acento/espaço/hífen, 0→o, distância de edição) e aceita modelo fora da lista.
 *
 * API: ModelosCarro.anexar(input, host?) · registrarUso([{modelo, qtd}]) · canonico(txt) · sugerir(txt)
 */
(function () {
  'use strict';

  const CATALOGO = {
    Chevrolet: ['Onix', 'Onix Plus', 'Prisma', 'Cruze', 'Tracker', 'Spin', 'S10', 'Montana', 'Equinox', 'Celta', 'Corsa', 'Classic', 'Cobalt', 'Agile', 'Astra', 'Vectra', 'Captiva', 'Trailblazer', 'Blazer', 'Silverado', 'Joy'],
    Volkswagen: ['Gol', 'Voyage', 'Polo', 'Virtus', 'T-Cross', 'Nivus', 'Taos', 'Tiguan', 'Saveiro', 'Amarok', 'Fox', 'Up!', 'Jetta', 'Golf', 'Fusca', 'SpaceFox', 'CrossFox', 'Kombi', 'Tera'],
    Fiat: ['Mobi', 'Argo', 'Cronos', 'Uno', 'Palio', 'Siena', 'Grand Siena', 'Strada', 'Toro', 'Pulse', 'Fastback', 'Fiorino', 'Doblò', 'Ducato', 'Punto', 'Idea', 'Weekend', 'Titano'],
    Hyundai: ['HB20', 'HB20S', 'Creta', 'Tucson', 'Santa Fe', 'ix35', 'i30', 'Azera', 'HR'],
    Toyota: ['Corolla', 'Corolla Cross', 'Yaris', 'Etios', 'Hilux', 'SW4', 'RAV4', 'Camry', 'Prius'],
    Honda: ['Civic', 'City', 'Fit', 'HR-V', 'WR-V', 'CR-V', 'ZR-V', 'Accord'],
    Renault: ['Kwid', 'Sandero', 'Logan', 'Stepway', 'Duster', 'Oroch', 'Captur', 'Master', 'Kardian', 'Clio', 'Fluence'],
    Ford: ['Ka', 'Ka Sedan', 'Fiesta', 'Focus', 'EcoSport', 'Ranger', 'Territory', 'Bronco Sport', 'Maverick', 'Fusion', 'Transit'],
    Nissan: ['Kicks', 'Versa', 'March', 'Sentra', 'Frontier', 'Livina'],
    Jeep: ['Renegade', 'Compass', 'Commander', 'Wrangler', 'Grand Cherokee'],
    Peugeot: ['208', '2008', '3008', '308', '207', 'Partner', 'Expert'],
    Citroën: ['C3', 'C4 Cactus', 'C3 Aircross', 'Aircross', 'Basalt', 'Jumpy', 'Berlingo'],
    Mitsubishi: ['L200', 'Pajero', 'Outlander', 'ASX', 'Eclipse Cross'],
    Kia: ['Sportage', 'Cerato', 'Picanto', 'Soul', 'Sorento', 'Stonic'],
    Caoa: ['Tiggo 5X', 'Tiggo 7', 'Tiggo 8', 'Arrizo 6'],
    BYD: ['Dolphin', 'Dolphin Mini', 'Song Plus', 'Seal', 'Yuan Plus', 'King'],
    GWM: ['Haval H6', 'Ora 03'],
    'Mercedes-Benz': ['Classe A', 'Classe C', 'GLA', 'Sprinter'],
    BMW: ['320i', 'X1', 'X3'],
    Audi: ['A3', 'A4', 'Q3', 'Q5'],
    Motos: ['CG 160', 'Biz', 'Pop 110', 'Fan 160', 'Titan 160', 'Bros 160', 'XRE 300', 'CB 300', 'PCX', 'NMax', 'Fazer 250', 'Factor 150', 'Lander 250', 'MT-03'],
  };

  // compara sem acento, minúsculo, sem espaço/hífen/ponto, zero lido como "o"
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[\s\-.!]/g, '').replace(/0/g, 'o');
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MODELOS = Object.entries(CATALOGO).flatMap(([marca, ms]) => ms.map((m) => ({ marca, m, k: norm(m) })));
  const uso = {};       // nome canônico → quantos veículos da empresa
  const extras = [];    // modelos da empresa fora do catálogo (usados mais de uma vez)

  function lev(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  const tolerancia = (n) => (n >= 6 ? 2 : 1);

  // nome do catálogo (ou já usado na empresa) com a grafia certa, quando bate exato
  function canonico(txt) {
    const k = norm(txt);
    if (!k) return null;
    const x = MODELOS.find((m) => m.k === k) || extras.find((m) => m.k === k);
    return x ? x.m : null;
  }
  // modelo do catálogo mais parecido (para juntar "Corola" com "Corolla" na contagem)
  function parecido(txt) {
    const k = norm(txt);
    if (k.length < 3) return null;
    let melhor = null, dist = 99;
    for (const x of MODELOS) { const d = lev(k, x.k); if (d < dist) { dist = d; melhor = x; } }
    return dist <= tolerancia(k.length) ? melhor : null;
  }

  // soma os modelos da empresa; grafias erradas parecidas com o catálogo contam para o certo
  function registrarUso(lista) {
    for (const { modelo, qtd } of lista || []) {
      if (!modelo || !String(modelo).trim()) continue;
      const exato = canonico(modelo), perto = exato ? null : parecido(modelo);
      const nome = exato || (perto && perto.m) || String(modelo).trim();
      uso[nome] = (uso[nome] || 0) + (qtd || 1);
      if (!exato && !perto && uso[nome] >= 2 && !extras.some((e) => e.k === norm(nome))) extras.push({ marca: '', m: nome, k: norm(nome) });
    }
  }
  let usoPromessa = null;
  function carregarUso() {
    if (!usoPromessa) {
      usoPromessa = (window.fetchApi ? window.fetchApi('/veiculos/modelos', { semRedirect: true }) : Promise.reject())
        .then((r) => registrarUso(r?.modelos || []))
        .catch(() => { /* sem o endpoint, fica só o catálogo */ });
    }
    return usoPromessa;
  }

  // pontua: igual > começa com > contém > marca > parecido; desempate pelo uso na empresa
  function sugerir(txt, max = 7) {
    const q = norm(txt);
    if (!q) return [];
    const out = [];
    for (const x of [...MODELOS, ...extras]) {
      let p = 0;
      if (x.k === q) p = 100;
      else if (x.k.startsWith(q)) p = 80 - (x.k.length - q.length);
      else if (x.k.includes(q)) p = 55;
      else if (x.marca && norm(x.marca).startsWith(q) && q.length >= 3) p = 40;
      else if (q.length >= 3) {
        const dist = lev(q, x.k.slice(0, Math.max(q.length, 3)));
        if (dist <= tolerancia(q.length)) p = 45 - dist * 8;
      }
      if (p > 0) out.push({ ...x, p: p + Math.min(uso[x.m] || 0, 40) / 2 });
    }
    return out.sort((a, b) => b.p - a.p).slice(0, max);
  }

  function destacar(m, txt) {
    const q = norm(txt), i = norm(m).indexOf(q);
    if (i < 0 || !q) return esc(m);
    let n = 0, ini = -1, fim = m.length;
    for (let c = 0; c < m.length; c++) {
      if (/[\s\-.!]/.test(m[c])) continue;
      if (n === i) ini = c;
      n++;
      if (n === i + q.length) { fim = c + 1; break; }
    }
    return ini < 0 ? esc(m) : esc(m.slice(0, ini)) + '<em>' + esc(m.slice(ini, fim)) + '</em>' + esc(m.slice(fim));
  }

  function injetarCss() {
    if (document.getElementById('mc-css')) return;
    const st = document.createElement('style');
    st.id = 'mc-css';
    st.textContent = `
      .mc-lista { grid-column: 1 / -1; width: 100%; margin-top: 4px; background: var(--paper, #fff); color: var(--ink, #111); border: 2.5px solid var(--ink, #111);
        border-radius: 12px; box-shadow: 3px 3px 0 var(--ink, #111); overflow: hidden; text-align: left; }
      .mc-cab { padding: 4px 10px; font: 700 9px var(--mono, monospace); letter-spacing: .1em; text-transform: uppercase; color: var(--muted, #666); background: var(--cream, #f5f5f5); }
      .mc-sug { display: flex; align-items: center; gap: 8px; padding: 8px 10px; cursor: pointer; font: 700 13px var(--mono, monospace); }
      .mc-sug + .mc-sug { border-top: 2px dashed var(--line, #ddd); }
      .mc-sug.ativo, .mc-sug:hover { background: #fff3c4; }
      .mc-marca { flex: none; min-width: 64px; padding: 0 5px; border-radius: 5px; background: var(--ink, #111); color: var(--cream, #fff); font: 700 9px/1.6 var(--mono, monospace); text-align: center; text-transform: uppercase; }
      .mc-marca.empresa { background: var(--blue, #2f62e6); }
      .mc-sug em { font-style: normal; background: var(--yellow, #ffd23f); }
      .mc-uso { margin-left: auto; font: 700 10px var(--mono, monospace); color: var(--muted, #666); white-space: nowrap; }
      .mc-sug.novo { color: var(--muted, #666); font-weight: 400; }
      .mc-dica { grid-column: 1 / -1; margin-top: 2px; font: 700 11px var(--mono, monospace); color: #b05a00; text-align: left; }
      .mc-dica button { border: 0; background: none; padding: 0; font: inherit; color: var(--blue, #2f62e6); text-decoration: underline; cursor: pointer; }
      input.mc-ok { border-color: var(--green, #22a15a) !important; }
      input.mc-duvida { border-color: var(--orange, #ff5b2e) !important; }
    `;
    document.head.appendChild(st);
  }

  // muda o valor do campo avisando quem escuta (Alpine x-model, validações da página)
  function definirValor(input, v) {
    input._mcSilencio = true;
    input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input._mcSilencio = false;
  }

  function anexar(input, host) {
    if (!input || input._mc) return;
    input._mc = true;
    injetarCss();
    carregarUso();
    input.setAttribute('autocomplete', 'off');
    host = host || input.closest('[data-modelo-host]') || input.parentElement;
    const lista = document.createElement('div');
    lista.className = 'mc-lista'; lista.hidden = true;
    const dica = document.createElement('div');
    dica.className = 'mc-dica'; dica.hidden = true;
    host.append(lista, dica);
    let ativo = -1;

    function fechar() { lista.hidden = true; ativo = -1; }
    function abrir() {
      const txt = input.value;
      if (!txt.trim()) { fechar(); return; }
      const s = sugerir(txt);
      const exato = canonico(txt);
      ativo = s.length ? 0 : -1;
      lista.innerHTML = (s.length ? `<div class="mc-cab">${s.some((x) => uso[x.m]) ? 'mais usados aqui primeiro' : 'catálogo'}</div>` : '')
        + s.map((x, i) => `<div class="mc-sug${i === 0 ? ' ativo' : ''}" data-m="${esc(x.m)}"><span class="mc-marca${x.marca ? '' : ' empresa'}">${esc(x.marca || 'sua empresa')}</span>${destacar(x.m, txt)}${uso[x.m] ? `<span class="mc-uso">${uso[x.m]} aqui</span>` : ''}</div>`).join('')
        + (exato ? '' : `<div class="mc-sug novo" data-m="${esc(txt.trim())}"><i class="fas fa-plus"></i> usar “${esc(txt.trim())}” (fora da lista)</div>`);
      lista.hidden = false;
    }
    function escolher(m) { definirValor(input, m); fechar(); validar(); }
    // ao sair: verde se é da lista (e corrige maiúsculas); laranja + "você quis dizer" se parece com um
    function validar() {
      const v = input.value.trim();
      input.classList.remove('mc-ok', 'mc-duvida'); dica.hidden = true;
      if (!v) return;
      const c = canonico(v);
      if (c) { input.classList.add('mc-ok'); if (c !== v) definirValor(input, c); return; }
      const s = sugerir(v, 1)[0];
      if (s) { input.classList.add('mc-duvida'); dica.innerHTML = `Você quis dizer <button type="button" data-m="${esc(s.m)}">${esc(s.m)}</button>?`; dica.hidden = false; }
    }

    input.addEventListener('input', () => {
      if (input._mcSilencio) return;
      input.classList.remove('mc-ok', 'mc-duvida'); dica.hidden = true;
      abrir();
    });
    input.addEventListener('keydown', (e) => {
      if (lista.hidden) return;
      const itens = [...lista.querySelectorAll('.mc-sug')];
      if (!itens.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        ativo = (ativo + (e.key === 'ArrowDown' ? 1 : -1) + itens.length) % itens.length;
        itens.forEach((x, i) => x.classList.toggle('ativo', i === ativo));
      } else if (e.key === 'Enter' && itens[ativo]) { e.preventDefault(); escolher(itens[ativo].dataset.m); }
      else if (e.key === 'Escape') fechar();
    });
    input.addEventListener('blur', () => setTimeout(() => { fechar(); validar(); }, 150));
    // mousedown: escolhe antes do blur fechar a lista
    lista.addEventListener('mousedown', (e) => { const s = e.target.closest('.mc-sug'); if (s) { e.preventDefault(); escolher(s.dataset.m); } });
    dica.addEventListener('mousedown', (e) => { const b = e.target.closest('button'); if (b) { e.preventDefault(); escolher(b.dataset.m); } });
    if (input.value.trim()) validar();
  }

  // liga sozinho em qualquer campo marcado, inclusive os criados depois
  document.addEventListener('focusin', (e) => {
    const i = e.target && e.target.closest && e.target.closest('input[data-modelo-carro]');
    if (i) anexar(i);
  });

  window.ModelosCarro = { anexar, registrarUso, canonico, sugerir, carregarUso };
})();
