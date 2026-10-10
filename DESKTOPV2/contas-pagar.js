/**
 * CONTAS A PAGAR — componente único usado no Lina Wash (Financeiro), no portal
 * da subconta (Financeiro), no Lina Center (aba Contas a pagar) e nos dashboards.
 *
 *   ContasPagar.montar(elemento, { acento: '#0e9fb3' })        → tela completa
 *   ContasPagar.montarCartao(elemento, { acento, aoAbrir })    → cartão do dashboard
 *
 * Depende de window.fetchApi (api.js). API: /api/contas-pagar (permissão ver_financeiro).
 * Sem framework: o mesmo arquivo funciona em páginas Alpine e em páginas vanilla.
 */
(function () {
  'use strict';

  const TIPOS = { AVULSA: 'Avulsa', MENSAL: 'Mensal', A_PRAZO: 'A prazo' };
  const FORMAS = [['PIX', 'Pix'], ['DINHEIRO', 'Dinheiro'], ['CARTAO', 'Cartão'], ['BOLETO', 'Boleto'], ['TRANSFERENCIA', 'Transferência']];

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const brl = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const dataBR = d => d ? d.split('-').reverse().join('/') : '—';
  const hojeStr = () => { const d = new Date(Date.now() - 3 * 3600 * 1000); return d.toISOString().slice(0, 10); }; // BRT
  const somarDias = (dia, n) => { const d = new Date(dia + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

  function prazoTexto(c) {
    const d = c.diasParaVencer;
    if (d < 0) return `venceu há ${plural(-d, 'dia', 'dias')}`;
    if (d === 0) return 'vence hoje';
    if (d === 1) return 'vence amanhã';
    return `vence em ${d} dias`;
  }

  function injetarCss() {
    if (document.getElementById('cp-estilos')) return;
    const st = document.createElement('style');
    st.id = 'cp-estilos';
    st.textContent = `
.cp{--cp-acento:#0e9fb3;--cp-suave:color-mix(in srgb,var(--cp-acento) 12%,#fff);--cp-txt:#17222b;--cp-txt2:#5b6a76;--cp-txt3:#94a1ac;--cp-linha:#e2e7ec;--cp-sup:#fff;--cp-sup2:#f8fafb;
  --cp-venc:#c8372d;--cp-venc-bg:#fde9e7;--cp-breve:#b4690e;--cp-breve-bg:#fdf1dc;--cp-ok:#18865a;--cp-ok-bg:#e2f5ec;color:var(--cp-txt);font-size:14px;line-height:1.5;}
.cp *{box-sizing:border-box;}
.cp button,.cp input,.cp select{font:inherit;color:inherit;}
.cp button{cursor:pointer;}
.cp-aviso{display:flex;gap:10px;align-items:center;background:var(--cp-breve-bg);color:var(--cp-breve);border-radius:12px;padding:10px 14px;font-weight:700;margin-bottom:14px;}
.cp-cab{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-bottom:14px;}
.cp-cab h2{margin:0;font-size:20px;font-weight:800;}
.cp-cab p{margin:2px 0 0;color:var(--cp-txt2);font-size:13px;}
.cp-btn{border:1px solid var(--cp-linha);background:var(--cp-sup);border-radius:10px;padding:9px 14px;font-weight:700;}
.cp .cp-btn-pri,.cp-btn-pri{background:var(--cp-acento);border-color:var(--cp-acento);color:#fff;}
.cp-btn-pri:disabled{opacity:.5;cursor:not-allowed;}
.cp-resumo{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px;}
.cp-tile{background:var(--cp-sup);border:1px solid var(--cp-linha);border-radius:12px;padding:12px 14px;}
.cp-tile .r{font-size:11px;text-transform:uppercase;letter-spacing:.07em;font-weight:700;color:var(--cp-txt3);}
.cp-tile .v{font-size:20px;font-weight:800;font-variant-numeric:tabular-nums;}
.cp-tile .d{font-size:12px;color:var(--cp-txt2);}
.cp-tile.venc .v{color:var(--cp-venc);} .cp-tile.breve .v{color:var(--cp-breve);} .cp-tile.ok .v{color:var(--cp-ok);}
.cp-freq{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;margin-bottom:12px;align-items:center;}
.cp-freq .l{font-size:12px;font-weight:700;color:var(--cp-txt3);white-space:nowrap;}
.cp-chip{flex-shrink:0;display:inline-flex;align-items:center;gap:6px;border:1px dashed var(--cp-acento);background:var(--cp-suave);border-radius:99px;padding:5px 6px 5px 12px;font-size:13px;font-weight:700;white-space:nowrap;}
.cp-chip button{border:0;background:none;font-weight:700;padding:0;}
.cp-chip .x{width:20px;height:20px;border-radius:50%;color:var(--cp-txt3);}
.cp-abas{display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap;}
.cp-aba{border:1px solid var(--cp-linha);background:var(--cp-sup);border-radius:99px;padding:6px 14px;font-size:13px;font-weight:700;color:var(--cp-txt2);}
.cp-aba.on{background:var(--cp-acento);border-color:var(--cp-acento);color:#fff;}
.cp-grupo{font-size:11.5px;text-transform:uppercase;letter-spacing:.07em;font-weight:800;color:var(--cp-txt3);margin:14px 0 6px;}
.cp-conta{display:grid;grid-template-columns:5px 1fr auto;gap:12px;align-items:center;background:var(--cp-sup);border:1px solid var(--cp-linha);border-radius:12px;padding:12px 14px 12px 0;margin-bottom:8px;overflow:hidden;}
.cp-conta .f{align-self:stretch;background:var(--cp-linha);}
.cp-conta.VENCIDA .f{background:var(--cp-venc);} .cp-conta.VENCE_EM_BREVE .f{background:var(--cp-breve);} .cp-conta.PAGA .f{background:var(--cp-ok);}
.cp-conta .ds{font-weight:700;word-break:break-word;}
.cp-meta{font-size:12.5px;color:var(--cp-txt2);display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:2px;}
.cp-tipo{font-size:11px;font-weight:800;padding:1px 8px;border-radius:99px;background:var(--cp-sup2);border:1px solid var(--cp-linha);}
.cp-pz.VENCIDA{color:var(--cp-venc);font-weight:800;} .cp-pz.VENCE_EM_BREVE{color:var(--cp-breve);font-weight:800;}
.cp-dir{text-align:right;display:grid;gap:6px;justify-items:end;}
.cp-val{font-weight:800;font-size:15px;font-variant-numeric:tabular-nums;white-space:nowrap;}
.cp-acoes{display:flex;gap:6px;}
.cp-pagar{border:1px solid var(--cp-acento);background:var(--cp-suave);border-radius:8px;padding:4px 12px;font-size:13px;font-weight:800;}
.cp-mais{border:1px solid var(--cp-linha);background:var(--cp-sup);border-radius:8px;width:30px;font-weight:800;color:var(--cp-txt2);}
.cp-pago{font-size:12px;color:var(--cp-ok);font-weight:700;}
.cp-vazio{text-align:center;color:var(--cp-txt2);padding:28px 12px;background:var(--cp-sup);border:1px dashed var(--cp-linha);border-radius:12px;}
.cp-veu{position:fixed;inset:0;background:rgba(10,20,28,.5);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px;}
.cp-modal{background:#fff;color:#17222b;border-radius:16px;width:min(480px,100%);max-height:92vh;overflow-y:auto;font-size:14px;}
.cp-modal header{padding:16px 18px 10px;border-bottom:1px solid #e2e7ec;display:flex;justify-content:space-between;gap:10px;}
.cp-modal header h3{margin:0;font-size:17px;font-weight:800;}
.cp-modal header p{margin:2px 0 0;font-size:12.5px;color:#5b6a76;}
.cp-x{border:0;background:#f1f4f6;width:30px;height:30px;border-radius:50%;flex-shrink:0;}
.cp-corpo{padding:14px 18px;display:grid;gap:12px;}
.cp-campo{display:grid;gap:5px;}
.cp-campo label{font-size:11.5px;font-weight:800;color:#5b6a76;text-transform:uppercase;letter-spacing:.05em;}
.cp-campo input,.cp-campo select{border:1.5px solid #e2e7ec;background:#f8fafb;border-radius:10px;padding:10px 12px;width:100%;font-size:16px;}
.cp-dupla{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.cp-tipos{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;}
.cp-tipo-op{border:1.5px solid #e2e7ec;background:#f8fafb;border-radius:10px;padding:10px 6px;text-align:center;}
.cp-tipo-op b{display:block;font-size:14px;} .cp-tipo-op span{font-size:11.5px;color:#5b6a76;}
.cp-tipo-op.on{border-color:var(--cp-acento);background:var(--cp-suave);}
.cp-calc{background:var(--cp-suave);border-radius:10px;padding:9px 12px;font-weight:700;font-size:13.5px;}
.cp-check{display:flex;gap:10px;align-items:flex-start;}
.cp-check input{width:18px;height:18px;accent-color:var(--cp-acento);margin-top:2px;}
.cp-check small{display:block;color:#5b6a76;font-size:12px;}
.cp-nota{margin:0;font-size:12.5px;color:#5b6a76;}
.cp-rod{padding:12px 18px 18px;display:flex;gap:8px;justify-content:flex-end;border-top:1px solid #e2e7ec;flex-wrap:wrap;}
.cp-perigo{color:#c8372d;margin-right:auto;}
.cp-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#17222b;color:#fff;padding:10px 16px;border-radius:10px;font-weight:700;z-index:9100;max-width:calc(100% - 32px);font-size:14px;}
.cp-card{font-size:14px;}
.cp-card .t{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;}
.cp-card .t b{font-size:15px;}
.cp-card .t button{border:0;background:none;color:var(--cp-acento);font-weight:800;font-size:13px;}
.cp-card .ln{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-top:1px solid #e2e7ec;}
.cp-card .ln:first-of-type{border-top:0;}
.cp-card .ln small{display:block;color:#94a1ac;font-size:12px;}
.cp-card .ln b{font-variant-numeric:tabular-nums;white-space:nowrap;}
.cp-card .alerta{background:#fdf1dc;color:#b4690e;border-radius:10px;padding:8px 10px;font-weight:700;font-size:13px;margin-bottom:8px;}
.cp-card .venc{color:#c8372d;font-weight:800;}
@media (max-width:820px){.cp-resumo{grid-template-columns:repeat(2,1fr);}}
@media (max-width:480px){.cp-dupla{grid-template-columns:1fr;}.cp-tipo-op{padding:9px 4px;}.cp-tipo-op span{font-size:10.5px;}.cp-tile .v{font-size:17px;}}
`;
    document.head.appendChild(st);
  }

  function toast(msg) {
    let t = document.getElementById('cp-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cp-toast'; t.className = 'cp-toast'; document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 3000);
  }

  function erroMsg(e, padrao) { return (e && (e.error || e.message)) || padrao; }

  // ─────────────────────────── Tela completa ───────────────────────────
  function montar(el, opts = {}) {
    injetarCss();
    const st = { dados: null, aba: 'abertas', carregando: true };
    el.classList.add('cp');
    if (opts.acento) el.style.setProperty('--cp-acento', opts.acento);

    async function carregar() {
      try {
        st.dados = await window.fetchApi('/contas-pagar');
      } catch (e) {
        el.innerHTML = `<div class="cp-vazio">${esc(erroMsg(e, 'Não foi possível carregar as contas.'))}</div>`;
        return;
      }
      render();
    }

    function render() {
      const d = st.dados; const r = d.resumo;
      // Sempre por vencimento: vencidas primeiro, depois hoje, próximos dias…
      const abertas = d.contas.filter(c => c.status === 'PENDENTE').sort((a, b) => a.vencimento.localeCompare(b.vencimento));
      let lista;
      if (st.aba === 'pagas') lista = d.contas.filter(c => c.status === 'PAGA');
      else if (st.aba === 'vencidas') lista = abertas.filter(c => c.diasParaVencer < 0);
      else lista = abertas;

      const grupo = c => c.status === 'PAGA' ? 'Pagas (últimos 60 dias)' : c.diasParaVencer < 0 ? 'Vencidas' : c.diasParaVencer === 0 ? 'Hoje' : c.diasParaVencer <= 7 ? 'Próximos 7 dias' : 'Mais adiante';
      let html = ''; let ult = '';
      lista.forEach(c => {
        const g = grupo(c); if (g !== ult) { html += `<div class="cp-grupo">${g}</div>`; ult = g; }
        html += `<div class="cp-conta ${c.situacao}"><div class="f"></div>
          <div><div class="ds">${esc(c.descricao)}</div>
            <div class="cp-meta"><span class="cp-tipo">${TIPOS[c.tipo] || c.tipo}</span>
              ${c.status === 'PAGA' ? `<span>venceu ${dataBR(c.vencimento)}</span>` : `<span class="cp-pz ${c.situacao}">${prazoTexto(c)} · ${dataBR(c.vencimento)}</span>`}
              ${c.fornecedorNome ? `<span>${esc(c.fornecedorNome)}</span>` : ''}
              ${c.status !== 'PAGA' ? `<span>🔔 ${c.lembrarDiasAntes ? plural(c.lembrarDiasAntes, 'dia', 'dias') + ' antes e no dia' : 'no dia'}</span>` : ''}</div></div>
          <div class="cp-dir"><div class="cp-val">${brl(c.status === 'PAGA' ? (c.valorPago ?? c.valor) : c.valor)}</div>
            ${c.status === 'PAGA' ? `<span class="cp-pago">✓ paga em ${dataBR(c.pagaEm)}</span>`
              : `<div class="cp-acoes"><button class="cp-mais" data-cp-editar="${c.id}" title="Editar">⋯</button><button class="cp-pagar" data-cp-pagar="${c.id}">Pagar</button></div>`}</div>
        </div>`;
      });
      if (!html) html = `<div class="cp-vazio">${st.aba === 'pagas' ? 'Nenhuma conta paga nos últimos 60 dias.' : st.aba === 'vencidas' ? 'Nenhuma conta vencida. 👏' : 'Nenhuma conta a pagar. Toque em "Nova conta" para lançar a primeira.'}</div>`;

      const aviso = [];
      if (r.hoje.qtd) aviso.push(plural(r.hoje.qtd, 'conta vence hoje', 'contas vencem hoje'));
      if (r.vencidas.qtd) aviso.push(plural(r.vencidas.qtd, 'conta vencida', 'contas vencidas'));

      el.innerHTML = `
        ${aviso.length ? `<div class="cp-aviso">🔔 ${aviso.join(' e ')}</div>` : ''}
        <div class="cp-cab"><div><h2>Contas a pagar</h2><p>Boletos, fornecedores e despesas fixas, com lembrete no WhatsApp.</p></div>
          <button class="cp-btn cp-btn-pri" data-cp-nova>+ Nova conta</button></div>
        <div class="cp-resumo">
          <div class="cp-tile venc"><div class="r">Vencidas</div><div class="v">${brl(r.vencidas.total)}</div><div class="d">${plural(r.vencidas.qtd, 'conta', 'contas')}</div></div>
          <div class="cp-tile breve"><div class="r">Próximos 7 dias</div><div class="v">${brl(r.proximos7.total)}</div><div class="d">${plural(r.proximos7.qtd, 'conta', 'contas')}</div></div>
          <div class="cp-tile"><div class="r">A pagar no total</div><div class="v">${brl(r.abertas.total)}</div><div class="d">${r.abertas.qtd} em aberto</div></div>
          <div class="cp-tile ok"><div class="r">Pagas no mês</div><div class="v">${brl(r.pagasMes.total)}</div><div class="d">${plural(r.pagasMes.qtd, 'conta', 'contas')}</div></div>
        </div>
        ${d.frequentes.length ? `<div class="cp-freq"><span class="l">Lançar de novo:</span>${d.frequentes.map(f =>
          `<span class="cp-chip"><button data-cp-freq="${f.id}">↻ ${esc(f.descricao)} · ${f.prazoDias} dias</button><button class="x" data-cp-freq-x="${f.id}" title="Remover dos frequentes">✕</button></span>`).join('')}</div>` : ''}
        <div class="cp-abas">
          <button class="cp-aba ${st.aba === 'abertas' ? 'on' : ''}" data-cp-aba="abertas">A pagar · ${r.abertas.qtd}</button>
          <button class="cp-aba ${st.aba === 'vencidas' ? 'on' : ''}" data-cp-aba="vencidas">Vencidas · ${r.vencidas.qtd}</button>
          <button class="cp-aba ${st.aba === 'pagas' ? 'on' : ''}" data-cp-aba="pagas">Pagas</button>
        </div>
        ${html}`;
    }

    // ── Modais ──
    function abrir(html) {
      fechar();
      const v = document.createElement('div');
      v.className = 'cp-veu cp'; v.id = 'cp-veu';
      if (opts.acento) v.style.setProperty('--cp-acento', opts.acento);
      v.innerHTML = `<div class="cp-modal" role="dialog">${html}</div>`;
      v.addEventListener('click', ev => { if (ev.target === v || ev.target.closest('[data-cp-fechar]')) fechar(); });
      document.body.appendChild(v);
      return v;
    }
    function fechar() { document.getElementById('cp-veu')?.remove(); }

    function modalNova(pre = {}) {
      const tipo = pre.tipo || 'AVULSA';
      const v = abrir(`
        <header><div><h3>Nova conta</h3><p>Escolha como essa conta funciona.</p></div><button class="cp-x" data-cp-fechar aria-label="Fechar">✕</button></header>
        <div class="cp-corpo">
          <div class="cp-tipos">${[['AVULSA', 'Avulsa', 'Paga uma vez'], ['MENSAL', 'Mensal', 'Repete todo mês'], ['A_PRAZO', 'A prazo', 'Compra + X dias']].map(([k, n, s]) =>
            `<button type="button" class="cp-tipo-op ${k === tipo ? 'on' : ''}" data-cp-tipo="${k}"><b>${n}</b><span>${s}</span></button>`).join('')}</div>
          <div class="cp-campo"><label for="cpDesc">O que vai ser pago</label><input id="cpDesc" maxlength="200" placeholder="Ex: Boleto do fornecedor de shampoo" value="${esc(pre.descricao || '')}"></div>
          <div class="cp-dupla">
            <div class="cp-campo"><label for="cpValor">Valor (R$)</label><input id="cpValor" type="number" step="0.01" min="0" inputmode="decimal" placeholder="0,00" value="${pre.valor ?? ''}"></div>
            <div class="cp-campo"><label for="cpForn">Fornecedor (opcional)</label><input id="cpForn" maxlength="120" placeholder="Ex: Química Brilho" value="${esc(pre.fornecedorNome || '')}"></div>
          </div>
          <div id="cpBlocoTipo"></div>
          <div class="cp-campo"><label for="cpLembrar">Lembrar no WhatsApp</label>
            <select id="cpLembrar">${[[1, '1 dia antes e no dia'], [2, '2 dias antes e no dia'], [3, '3 dias antes e no dia'], [5, '5 dias antes e no dia'], [7, '7 dias antes e no dia'], [0, 'Só no dia']].map(([n, t]) =>
              `<option value="${n}" ${n === 3 ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        </div>
        <div class="cp-rod"><button class="cp-btn" data-cp-fechar>Cancelar</button><button class="cp-btn cp-btn-pri" id="cpSalvar">Salvar conta</button></div>`);
      let tipoAtual = tipo;
      const bloco = () => {
        const b = v.querySelector('#cpBlocoTipo');
        if (tipoAtual === 'AVULSA') {
          b.innerHTML = `<div class="cp-campo"><label for="cpVenc">Vencimento</label><input id="cpVenc" type="date" value="${somarDias(hojeStr(), 10)}"></div>`;
        } else if (tipoAtual === 'MENSAL') {
          b.innerHTML = `<div class="cp-dupla"><div class="cp-campo"><label for="cpDia">Vence todo dia</label><input id="cpDia" type="number" min="1" max="31" value="10"></div>
            <div class="cp-campo"><label for="cpIni">A partir de</label><input id="cpIni" type="month" value="${hojeStr().slice(0, 7)}"></div></div>
            <p class="cp-nota">Ao marcar como paga, a do mês seguinte é criada com o mesmo valor (dá para editar). Dia 31 vira o último dia nos meses mais curtos.</p>`;
        } else {
          b.innerHTML = `<div class="cp-dupla"><div class="cp-campo"><label for="cpCompra">Data da compra</label><input id="cpCompra" type="date" value="${hojeStr()}"></div>
            <div class="cp-campo"><label for="cpPrazo">Prazo (dias)</label><input id="cpPrazo" type="number" min="1" max="365" value="${pre.prazoDias || 15}"></div></div>
            <div class="cp-calc" id="cpCalc"></div>
            <label class="cp-check"><input type="checkbox" id="cpFreq" checked><span>Guardar como item frequente<small>Aparece em "Lançar de novo" com o mesmo prazo e valor.</small></span></label>`;
          const atual = () => { const c = v.querySelector('#cpCompra').value || hojeStr(); const p = +v.querySelector('#cpPrazo').value || 0; v.querySelector('#cpCalc').textContent = `Vence em ${dataBR(somarDias(c, p))}`; };
          v.querySelector('#cpCompra').addEventListener('input', atual); v.querySelector('#cpPrazo').addEventListener('input', atual); atual();
        }
      };
      bloco();
      v.querySelectorAll('[data-cp-tipo]').forEach(b => b.addEventListener('click', () => {
        tipoAtual = b.dataset.cpTipo;
        v.querySelectorAll('[data-cp-tipo]').forEach(x => x.classList.toggle('on', x === b));
        bloco();
      }));
      v.querySelector('#cpSalvar').addEventListener('click', async ev => {
        const q = s => v.querySelector(s);
        const corpo = {
          tipo: tipoAtual, descricao: q('#cpDesc').value.trim(), valor: Number(q('#cpValor').value),
          fornecedorNome: q('#cpForn').value.trim() || undefined, lembrarDiasAntes: Number(q('#cpLembrar').value),
        };
        if (tipoAtual === 'AVULSA') corpo.vencimento = q('#cpVenc').value;
        if (tipoAtual === 'MENSAL') { corpo.diaMensal = Number(q('#cpDia').value); corpo.inicio = q('#cpIni').value; }
        if (tipoAtual === 'A_PRAZO') { corpo.dataCompra = q('#cpCompra').value; corpo.prazoDias = Number(q('#cpPrazo').value); corpo.salvarFrequente = q('#cpFreq').checked; }
        if (!corpo.descricao) return toast('Informe o que vai ser pago.');
        if (!(corpo.valor > 0)) return toast('Informe um valor maior que zero.');
        ev.target.disabled = true;
        try {
          await window.fetchApi('/contas-pagar', { method: 'POST', body: JSON.stringify(corpo) });
          fechar(); toast('Conta salva. O lembrete sai no WhatsApp na data certa.'); carregar();
        } catch (e) { toast(erroMsg(e, 'Erro ao salvar a conta')); ev.target.disabled = false; }
      });
      setTimeout(() => v.querySelector(pre.descricao ? '#cpValor' : '#cpDesc')?.focus(), 50);
    }

    function modalEditar(c) {
      const v = abrir(`
        <header><div><h3>Editar conta</h3><p>${esc(TIPOS[c.tipo])}${c.tipo === 'MENSAL' ? ` · todo dia ${c.diaMensal}` : ''}</p></div><button class="cp-x" data-cp-fechar aria-label="Fechar">✕</button></header>
        <div class="cp-corpo">
          <div class="cp-campo"><label for="ceDesc">O que vai ser pago</label><input id="ceDesc" maxlength="200" value="${esc(c.descricao)}"></div>
          <div class="cp-dupla">
            <div class="cp-campo"><label for="ceValor">Valor (R$)</label><input id="ceValor" type="number" step="0.01" min="0" value="${c.valor}"></div>
            <div class="cp-campo"><label for="ceVenc">Vencimento</label><input id="ceVenc" type="date" value="${c.vencimento}"></div>
          </div>
          <div class="cp-dupla">
            <div class="cp-campo"><label for="ceForn">Fornecedor</label><input id="ceForn" maxlength="120" value="${esc(c.fornecedorNome || '')}"></div>
            <div class="cp-campo"><label for="ceLembrar">Lembrar (dias antes)</label><input id="ceLembrar" type="number" min="0" max="30" value="${c.lembrarDiasAntes}"></div>
          </div>
        </div>
        <div class="cp-rod"><button class="cp-btn cp-perigo" id="ceExcluir">Excluir</button><button class="cp-btn" data-cp-fechar>Cancelar</button><button class="cp-btn cp-btn-pri" id="ceSalvar">Salvar</button></div>`);
      v.querySelector('#ceSalvar').addEventListener('click', async ev => {
        const q = s => v.querySelector(s);
        ev.target.disabled = true;
        try {
          await window.fetchApi(`/contas-pagar/${c.id}`, { method: 'PUT', body: JSON.stringify({
            descricao: q('#ceDesc').value, valor: Number(q('#ceValor').value), vencimento: q('#ceVenc').value,
            fornecedorNome: q('#ceForn').value, lembrarDiasAntes: Number(q('#ceLembrar').value),
          }) });
          fechar(); toast('Conta atualizada.'); carregar();
        } catch (e) { toast(erroMsg(e, 'Erro ao salvar')); ev.target.disabled = false; }
      });
      const btnEx = v.querySelector('#ceExcluir');
      btnEx.addEventListener('click', async () => {
        if (btnEx.dataset.confirmar !== '1') { btnEx.dataset.confirmar = '1'; btnEx.textContent = 'Toque de novo para excluir'; return; }
        try { await window.fetchApi(`/contas-pagar/${c.id}`, { method: 'DELETE' }); fechar(); toast('Conta excluída.'); carregar(); }
        catch (e) { toast(erroMsg(e, 'Erro ao excluir')); }
      });
    }

    function modalPagar(c) {
      const temCaixa = st.dados.temCaixa;
      const v = abrir(`
        <header><div><h3>Pagar conta</h3><p>${esc(c.descricao)}</p></div><button class="cp-x" data-cp-fechar aria-label="Fechar">✕</button></header>
        <div class="cp-corpo">
          <div class="cp-dupla">
            <div class="cp-campo"><label for="cpgValor">Valor pago (R$)</label><input id="cpgValor" type="number" step="0.01" min="0" value="${c.valor}"></div>
            <div class="cp-campo"><label for="cpgData">Pago em</label><input id="cpgData" type="date" value="${hojeStr()}"></div>
          </div>
          <div class="cp-campo"><label for="cpgForma">Forma de pagamento</label><select id="cpgForma">${FORMAS.map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></div>
          ${temCaixa
            ? `<label class="cp-check"><input type="checkbox" id="cpgCaixa" checked><span>Lançar saída no caixa<small>Mesmo lançamento de saída do caixa, na categoria Contas${c.fornecedorNome ? `, com o fornecedor ${esc(c.fornecedorNome)}` : ''}.</small></span></label>`
            : `<p class="cp-nota">O pagamento fica registrado aqui (este sistema não tem caixa de despesas).</p>`}
          ${c.tipo === 'MENSAL' ? `<div class="cp-calc">A do próximo mês será criada automaticamente.</div>` : ''}
        </div>
        <div class="cp-rod"><button class="cp-btn" data-cp-fechar>Cancelar</button><button class="cp-btn cp-btn-pri" id="cpgOk">Confirmar pagamento</button></div>`);
      v.querySelector('#cpgOk').addEventListener('click', async ev => {
        const q = s => v.querySelector(s);
        ev.target.disabled = true;
        try {
          const r = await window.fetchApi(`/contas-pagar/${c.id}/pagar`, { method: 'POST', body: JSON.stringify({
            valorPago: Number(q('#cpgValor').value), pagaEm: q('#cpgData').value, formaPagamento: q('#cpgForma').value,
            lancarCaixa: !!q('#cpgCaixa')?.checked,
          }) });
          fechar();
          toast(`Pagamento registrado${r.caixaLancado ? ' e saída lançada no caixa' : ''}${r.proximaVencimento ? `. Próxima: ${dataBR(r.proximaVencimento)}` : ''}.`);
          carregar();
        } catch (e) { toast(erroMsg(e, 'Erro ao registrar o pagamento')); ev.target.disabled = false; }
      });
    }

    el.addEventListener('click', async ev => {
      const t = ev.target.closest('[data-cp-nova],[data-cp-aba],[data-cp-pagar],[data-cp-editar],[data-cp-freq],[data-cp-freq-x]');
      if (!t || !st.dados) return;
      const conta = id => st.dados.contas.find(c => c.id === id);
      if (t.dataset.cpNova !== undefined) return modalNova();
      if (t.dataset.cpAba) { st.aba = t.dataset.cpAba; return render(); }
      if (t.dataset.cpPagar) return modalPagar(conta(t.dataset.cpPagar));
      if (t.dataset.cpEditar) return modalEditar(conta(t.dataset.cpEditar));
      if (t.dataset.cpFreq) {
        const f = st.dados.frequentes.find(x => x.id === t.dataset.cpFreq);
        return modalNova({ tipo: 'A_PRAZO', descricao: f.descricao, valor: f.valor, prazoDias: f.prazoDias, fornecedorNome: f.fornecedorNome });
      }
      if (t.dataset.cpFreqX) {
        try { await window.fetchApi(`/contas-pagar/frequentes/${t.dataset.cpFreqX}`, { method: 'DELETE' }); toast('Removido dos frequentes.'); carregar(); }
        catch (e) { toast(erroMsg(e, 'Erro ao remover')); }
      }
    });

    el.innerHTML = '<div class="cp-vazio">Carregando contas…</div>';
    carregar();
    return { recarregar: carregar };
  }

  // ─────────────────────────── Cartão do dashboard ───────────────────────────
  // Some sozinho se o usuário não tem ver_financeiro (403) ou se não há contas.
  async function montarCartao(el, opts = {}) {
    injetarCss();
    el.classList.add('cp', 'cp-card');
    if (opts.acento) el.style.setProperty('--cp-acento', opts.acento);
    let r;
    try { r = await window.fetchApi('/contas-pagar/resumo'); }
    catch { el.hidden = true; return; }
    if (!r.vencidas.qtd && !r.proximas.length) { el.hidden = true; return; }
    el.hidden = false;
    const hoje = r.hoje ? `<div class="alerta">🔔 ${plural(r.hoje, 'conta vence hoje', 'contas vencem hoje')}</div>` : '';
    el.innerHTML = `
      <div class="t"><b>Contas a pagar</b>${opts.aoAbrir ? '<button type="button" data-cp-abrir>Ver todas</button>' : ''}</div>
      ${hoje}
      ${r.vencidas.qtd ? `<div class="ln"><span class="venc">${plural(r.vencidas.qtd, 'vencida', 'vencidas')}</span><b class="venc">${brl(r.vencidas.total)}</b></div>` : ''}
      ${r.proximas.map(c => `<div class="ln"><span>${esc(c.descricao)}<small>${prazoTexto(c)} · ${dataBR(c.vencimento)}</small></span><b>${brl(c.valor)}</b></div>`).join('')}`;
    if (opts.aoAbrir) el.querySelector('[data-cp-abrir]').addEventListener('click', opts.aoAbrir);
  }

  window.ContasPagar = { montar, montarCartao };
})();
