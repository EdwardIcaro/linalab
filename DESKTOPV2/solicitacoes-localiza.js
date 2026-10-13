/**
 * Solicitações da Localiza — fila de carros pedidos por e-mail.
 *
 * Componente compartilhado (mesmo padrão do contas-pagar.js): o index só reserva um
 * espaço e chama SolicitacoesLocaliza.montar(el). Ele mostra uma faixa quando há carros
 * esperando e abre os modais de aceitar e de checklist de avarias por cima da página,
 * sem mexer no layout dela.
 *
 * Depende de window.fetchApi (api.js). API: /api/solicitacoes (permissão gerenciar_ordens).
 */
(function () {
  const LADOS = ['Frente', 'Traseira', 'Esquerda', 'Direita'];
  const MAX_FOTOS = 8;
  const POLL_MS = 60000;

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const brl = (n) => (n == null ? '' : 'R$ ' + Number(n).toFixed(2).replace('.', ','));
  function haQuanto(iso) {
    const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (min < 1) return 'agora';
    if (min < 60) return `há ${min} min`;
    const h = Math.round(min / 60);
    return h < 24 ? `há ${h} h` : `há ${Math.round(h / 24)} dia(s)`;
  }

  function injetarCss(acento) {
    if (document.getElementById('sl-css')) return;
    const st = document.createElement('style');
    st.id = 'sl-css';
    st.textContent = `
      .sl{--sl-ac:${acento};--sl-ok:#16a34a;--sl-av:#dc2626;--sl-mut:#64748b;--sl-bd:#e2e8f0}
      .sl-faixa{display:flex;align-items:center;gap:12px}
      .sl-n{background:var(--sl-ac);color:#fff;font-weight:800;border-radius:12px;min-width:44px;height:44px;display:grid;place-items:center;font-size:18px;flex-shrink:0}
      .sl-t{flex:1;min-width:0}.sl-t b{display:block;font-size:15px;color:#0f172a}.sl-t span{font-size:12px;color:var(--sl-mut)}
      .sl-btn{border:none;cursor:pointer;font:inherit;font-weight:700;font-size:14px;padding:10px 14px;border-radius:12px}
      .sl-pri{background:var(--sl-ac);color:#fff}.sl-sec{background:#f1f5f9;color:#0f172a}
      .sl-amb{background:#fff7ed;color:#c2410c;border:1px solid #fed7aa}
      .sl-btn:disabled{opacity:.5;cursor:not-allowed}
      .sl-ov{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9990;display:flex;align-items:flex-end;justify-content:center}
      @media(min-width:700px){.sl-ov{align-items:center}}
      .sl-sheet{background:#f1f5f9;width:100%;max-width:560px;max-height:92vh;border-radius:20px 20px 0 0;display:flex;flex-direction:column;font-family:inherit;color:#0f172a}
      @media(min-width:700px){.sl-sheet{border-radius:20px;max-height:86vh}}
      .sl-hd{padding:14px 16px;display:flex;align-items:center;gap:10px;background:#fff;border-bottom:1px solid var(--sl-bd);border-radius:20px 20px 0 0}
      .sl-hd h3{flex:1;font-size:17px;margin:0}
      .sl-x{width:34px;height:34px;border-radius:10px;background:#f1f5f9;border:none;cursor:pointer;font-size:16px}
      .sl-bd{padding:14px 16px;overflow:auto;flex:1}
      .sl-ft{padding:12px 16px;background:#fff;border-top:1px solid var(--sl-bd);display:flex;gap:8px}.sl-ft .sl-btn{flex:1}
      .sl-card{background:#fff;border-radius:16px;padding:14px;margin-bottom:12px;box-shadow:0 1px 3px rgba(15,23,42,.08)}
      .sl-top{display:flex;gap:10px;align-items:flex-start}
      .sl-placa{font-family:ui-monospace,Consolas,monospace;font-weight:800;font-size:17px;background:#f1f5f9;border:2px solid #cbd5e1;border-radius:8px;padding:2px 8px;letter-spacing:.05em;display:inline-block}
      .sl-veic{font-size:13px;color:var(--sl-mut);margin-top:4px}.sl-veic.novo{color:#c2410c;font-weight:600}
      .sl-preco{margin-left:auto;text-align:right}.sl-preco b{display:block;font-size:16px}.sl-preco span{font-size:11px;color:var(--sl-mut)}
      .sl-meta{display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;margin-top:10px;font-size:12px;color:var(--sl-mut)}
      .sl-meta b{display:block;color:#0f172a;font-size:13px;font-weight:600}
      .sl-aviso{margin-top:10px;font-size:12px;padding:8px 10px;border-radius:10px;background:#fef3c7;color:#92400e}
      .sl-aviso.azul{background:#eff6ff;color:#1e40af}.sl-aviso.verm{background:#fee2e2;color:#991b1b}
      .sl-acts{display:flex;gap:8px;margin-top:12px}.sl-acts .sl-btn{flex:1}
      .sl-ck{font-size:12px;margin-top:8px;font-weight:600}.sl-ck.ok{color:var(--sl-ok)}.sl-ck.av{color:var(--sl-av)}
      .sl-sec-t{font-size:12px;font-weight:700;color:var(--sl-mut);text-transform:uppercase;letter-spacing:.04em;margin:18px 0 8px}
      .sl-vazio{text-align:center;color:var(--sl-mut);padding:36px 10px;font-size:14px}
      .sl-lbl{display:block;font-size:12px;font-weight:700;color:var(--sl-mut);margin:14px 0 6px}
      .sl-inp{width:100%;box-sizing:border-box;padding:11px 12px;border:1.5px solid var(--sl-bd);border-radius:12px;background:#fff;font:inherit;font-size:14px}
      .sl-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      .sl-res{background:#fff;border-radius:14px;padding:12px;display:flex;gap:10px;align-items:center}
      .sl-info{background:#eff6ff;color:#1e3a8a;border-radius:12px;padding:10px 12px;font-size:13px;margin-top:14px}
      .sl-fotos{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
      .sl-foto{aspect-ratio:1;border:2px dashed #cbd5e1;border-radius:12px;display:grid;place-items:center;font-size:11px;color:var(--sl-mut);text-align:center;background:#fff;overflow:hidden;position:relative;cursor:pointer;white-space:pre-line}
      .sl-foto img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
      .sl-foto input{position:absolute;inset:0;opacity:0;cursor:pointer}
      .sl-foto .sl-rm{position:absolute;top:3px;right:3px;width:22px;height:22px;border-radius:50%;border:none;background:rgba(15,23,42,.7);color:#fff;font-size:12px;cursor:pointer;z-index:2}
      .sl-item{background:#fff;border-radius:12px;padding:10px 12px;margin-bottom:8px}
      .sl-item-top{display:flex;align-items:center;gap:8px}.sl-item-top span{flex:1;font-size:14px;font-weight:600}
      .sl-seg{display:flex;background:#f1f5f9;border-radius:10px;padding:3px}
      .sl-seg button{border:none;background:none;cursor:pointer;font:inherit;padding:6px 10px;border-radius:8px;font-size:12px;font-weight:700;color:var(--sl-mut)}
      .sl-seg button.ok{background:#dcfce7;color:var(--sl-ok)}.sl-seg button.av{background:#fee2e2;color:var(--sl-av)}
      .sl-item textarea{width:100%;box-sizing:border-box;margin-top:8px;border:1px solid var(--sl-bd);border-radius:10px;padding:8px;font:inherit;font-size:13px;resize:vertical}
      .sl-toast{position:fixed;left:50%;bottom:100px;transform:translateX(-50%);color:#fff;padding:10px 18px;border-radius:10px;font-size:13px;font-weight:700;z-index:9999;max-width:90vw;text-align:center}
    `;
    document.head.appendChild(st);
  }

  function toast(msg, erro) {
    const t = document.createElement('div');
    t.className = 'sl-toast';
    t.style.background = erro ? '#ef4444' : '#059669';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  function abrirSheet(titulo, corpoHtml, rodapeHtml) {
    const ov = document.createElement('div');
    ov.className = 'sl sl-ov';
    ov.innerHTML = `<div class="sl-sheet" role="dialog" aria-label="${esc(titulo)}">
        <div class="sl-hd"><h3>${esc(titulo)}</h3><button class="sl-x" data-fechar aria-label="Fechar">✕</button></div>
        <div class="sl-bd">${corpoHtml}</div>
        ${rodapeHtml ? `<div class="sl-ft">${rodapeHtml}</div>` : ''}
      </div>`;
    const fechar = () => ov.remove();
    ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-fechar]')) fechar(); });
    document.body.appendChild(ov);
    return { ov, fechar, q: (s) => ov.querySelector(s), qa: (s) => ov.querySelectorAll(s) };
  }

  /** Mesma compressão do checklist do Lina Center: lado maior 1280px, JPEG 0,7. */
  function comprimirFoto(arquivo) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(arquivo);
      img.onload = () => {
        const max = 1280;
        const escala = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * escala);
        c.height = Math.round(img.height * escala);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('imagem inválida')); };
      img.src = url;
    });
  }

  function montar(host, opts = {}) {
    if (!host || !window.fetchApi) return;
    const acento = opts.acento || '#00a651';
    injetarCss(acento);
    host.classList.add('sl');

    const st = { dados: null, lista: null };
    const empresaNome = () =>
      (document.getElementById('empresaNome')?.textContent || localStorage.getItem('empresaNome') || 'sua empresa').trim();

    async function carregar() {
      try {
        st.dados = await window.fetchApi('/solicitacoes', { semRedirect: true, cache: 'no-store' });
      } catch (e) {
        st.dados = null;
      }
      desenharFaixa();
      if (st.lista) desenharLista();
      return st.dados;
    }

    function desenharFaixa() {
      const d = st.dados;
      const pend = d?.pendentes?.length || 0;
      const semCk = (d?.aceitas || []).filter((a) => !a.checklist).length;
      if (!d?.habilitado || (!pend && !semCk)) { host.hidden = true; return; }
      host.hidden = false;
      const sub = pend
        ? `${pend === 1 ? '1 carro aguardando' : pend + ' carros aguardando'} retirada`
        : `${semCk} aceito(s) hoje sem checklist`;
      host.innerHTML = `<div class="sl-faixa">
          <div class="sl-n">${pend || '✓'}</div>
          <div class="sl-t"><b>Solicitações da Localiza</b><span>${esc(sub)}</span></div>
          <button class="sl-btn sl-pri" type="button">Ver</button>
        </div>`;
      host.querySelector('button').onclick = abrirLista;
    }

    function cardHtml(s, aceita) {
      const veic = s.modelo ? `${esc(s.modelo)}${s.cor ? ' · ' + esc(s.cor) : ''}` : '⚠ Placa nova — preencher modelo e cor';
      const ck = s.checklist
        ? (s.checklist.avarias
          ? `<div class="sl-ck av">⚠ Checklist feito · ${s.checklist.avarias} avaria(s)${s.checklist.fotos ? ' · ' + s.checklist.fotos + ' foto(s)' : ''}</div>`
          : `<div class="sl-ck ok">✔ Checklist feito · sem avarias${s.checklist.fotos ? ' · ' + s.checklist.fotos + ' foto(s)' : ''}</div>`)
        : '';
      return `<div class="sl-card" data-id="${esc(s.id)}">
          <div class="sl-top">
            <div><span class="sl-placa">${esc(s.placa)}</span><div class="sl-veic ${s.modelo ? '' : 'novo'}">${veic}</div></div>
            <div class="sl-preco"><b>${esc(s.precoTexto || brl(s.preco))}</b><span>${esc(s.servico || s.tipo || '')}</span></div>
          </div>
          <div class="sl-meta">
            <div>Retirar em<b>${esc(s.agencia || '—')}</b></div>
            <div>Solicitante<b>${esc(s.solicitante || '—')}</b></div>
            <div>Nº solicitação<b>${esc(s.numero)}</b></div>
            <div>${aceita ? 'Ordem' : 'Chegou'}<b>${aceita ? (s.ordemNumero ? '#' + s.ordemNumero : '—') + ' · ' + esc(s.aceitaPorNome || '') : esc(haQuanto(s.chegouEm))}</b></div>
          </div>
          ${s.mesmoPedido?.length ? `<div class="sl-aviso azul">📦 Mesma solicitação de ${esc(s.mesmoPedido.join(', '))}</div>` : ''}
          ${s.repetida ? `<div class="sl-aviso">⚠ Lavada há ${s.repetida.dias} dia(s) — ordem #${s.repetida.numeroOrdem} (${esc(s.repetida.empresa)}). Menos de 15 dias.</div>` : ''}
          ${!aceita && !s.servico ? `<div class="sl-aviso verm">Valor sem serviço vinculado nesta empresa — o administrador precisa vincular no Hub › Automações.</div>` : ''}
          ${s.canceladaEm ? `<div class="sl-aviso verm">✖ Cancelada pela Localiza depois do aceite — confira a ordem.</div>` : ''}
          ${ck}
          <div class="sl-acts">
            <button class="sl-btn sl-amb" type="button" data-ck>${s.checklist ? '📋 Ver checklist' : '📋 Checklist de avarias'}</button>
            ${aceita ? '' : `<button class="sl-btn sl-pri" type="button" data-aceitar ${s.servico ? '' : 'disabled'}>Aceitar</button>`}
          </div>
        </div>`;
    }

    function desenharLista() {
      const d = st.dados;
      if (!st.lista) return;
      const corpo = st.lista.q('.sl-bd');
      if (!d?.habilitado) { st.lista.fechar(); st.lista = null; return; }
      const pend = d.pendentes || [];
      const aceitas = d.aceitas || [];
      corpo.innerHTML =
        (pend.length ? pend.map((s) => cardHtml(s, false)).join('') : '<div class="sl-vazio">✅ Nenhum carro aguardando.<br>Quando chegar uma solicitação, ela aparece aqui.</div>') +
        (aceitas.length ? `<div class="sl-sec-t">Aceitas nesta empresa · últimas 24h</div>${aceitas.map((s) => cardHtml(s, true)).join('')}` : '');
      const acha = (id) => pend.find((x) => x.id === id) || aceitas.find((x) => x.id === id);
      corpo.querySelectorAll('.sl-card').forEach((el) => {
        const s = acha(el.dataset.id);
        el.querySelector('[data-ck]').onclick = () => abrirChecklist(s);
        const b = el.querySelector('[data-aceitar]');
        if (b) b.onclick = () => abrirAceite(s);
      });
    }

    function abrirLista() {
      if (st.lista) { st.lista.fechar(); st.lista = null; }
      st.lista = abrirSheet('🚗 Solicitações da Localiza', '');
      st.lista.ov.addEventListener('click', (e) => {
        if (e.target === e.currentTarget || e.target.closest('[data-fechar]')) st.lista = null;
      });
      desenharLista();
      carregar();
    }

    function abrirAceite(s) {
      const lav = (st.dados?.lavadores || []).map((l) => `<option value="${esc(l.id)}">${esc(l.nome)}</option>`).join('');
      const m = abrirSheet('Aceitar carro', `
          <div class="sl-res"><span class="sl-placa">${esc(s.placa)}</span>
            <div style="flex:1;font-size:13px;color:#64748b">${esc(s.agencia || '')}</div><b>${esc(s.precoTexto || brl(s.preco))}</b></div>
          <div class="sl-row">
            <div><label class="sl-lbl">Modelo *</label><input class="sl-inp" data-modelo maxlength="60" placeholder="Ex.: Onix" value="${esc(s.modelo || '')}"></div>
            <div><label class="sl-lbl">Cor</label><input class="sl-inp" data-cor maxlength="40" placeholder="Ex.: Branco" value="${esc(s.cor || '')}"></div>
          </div>
          ${s.modelo ? '<div style="font-size:12px;color:#64748b;margin-top:6px">Preenchido pelo cadastro da placa — pode corrigir.</div>' : ''}
          <label class="sl-lbl">Serviço</label>
          <input class="sl-inp" disabled value="${esc((s.servico || '—') + ' — ' + (s.precoTexto || brl(s.preco)))}">
          ${lav ? `<label class="sl-lbl">Lavador (opcional)</label><select class="sl-inp" data-lavador><option value="">— definir depois —</option>${lav}</select>` : ''}
          <label class="sl-lbl">Observação (opcional)</label>
          <input class="sl-inp" data-obs maxlength="300" placeholder="Ex.: buscar depois das 14h">
          <div class="sl-info">🏢 A ordem entra em <b>${esc(empresaNome())}</b>, cliente <b>Localiza</b>.</div>`,
        `<button class="sl-btn sl-sec" type="button" data-fechar>Cancelar</button>
         <button class="sl-btn sl-pri" type="button" data-ok>Confirmar ordem</button>`);
      const ok = m.q('[data-ok]');
      ok.onclick = async () => {
        const modelo = m.q('[data-modelo]').value.trim();
        if (!modelo) { m.q('[data-modelo]').focus(); return toast('Informe o modelo do veículo.', true); }
        ok.disabled = true; ok.textContent = 'Criando...';
        try {
          const r = await window.fetchApi(`/solicitacoes/${encodeURIComponent(s.id)}/aceitar`, {
            method: 'POST',
            semRedirect: true,
            body: JSON.stringify({
              modelo,
              cor: m.q('[data-cor]').value.trim(),
              lavadorId: m.q('[data-lavador]')?.value || null,
              observacoes: m.q('[data-obs]').value.trim(),
            }),
          });
          m.fechar();
          toast(`Ordem #${r.ordem.numeroOrdem} criada!`);
          if (typeof opts.aoCriarOrdem === 'function') opts.aoCriarOrdem(r.ordem);
        } catch (e) {
          toast(e?.error || 'Não foi possível aceitar.', true);
          if (e?.code === 'JA_ACEITA' || e?.code === 'CANCELADA') m.fechar();
          else { ok.disabled = false; ok.textContent = 'Confirmar ordem'; }
        }
        carregar();
      };
    }

    async function abrirChecklist(s) {
      let dados;
      try {
        dados = await window.fetchApi(`/solicitacoes/${encodeURIComponent(s.id)}/checklist`, { semRedirect: true, cache: 'no-store' });
      } catch (e) {
        toast(e?.error || 'Não foi possível abrir o checklist.', true);
        return carregar();
      }
      const salvo = new Map(((dados.checklist && dados.checklist.itens) || []).map((i) => [i.chave, i]));
      const itens = dados.itensPadrao.map((i) => ({ ...i, st: salvo.get(i.chave)?.st || null, obs: salvo.get(i.chave)?.obs || '' }));
      // Fotos: as 4 posições fixas + extras, até 8
      const fotos = LADOS.map((lado) => ({ lado, id: null, src: null }));
      for (const f of dados.fotos || []) {
        const slot = fotos.find((x) => x.lado === f.lado && !x.src);
        if (slot) Object.assign(slot, { id: f.id, src: f.imagem });
        else fotos.push({ lado: f.lado || 'Extra', id: f.id, src: f.imagem });
      }

      const m = abrirSheet('📋 Checklist de avarias', `
          <div class="sl-res"><span class="sl-placa">${esc(s.placa)}</span>
            <div style="flex:1;font-size:12px;color:#64748b">Opcional · fica gravado com data, hora e quem fez${dados.checklistPor ? `<br>Último: ${esc(dados.checklistPor)}` : ''}</div></div>
          <label class="sl-lbl">Fotos do veículo</label>
          <div class="sl-fotos" data-fotos></div>
          <label class="sl-lbl">Vistoria</label>
          <div data-itens></div>
          <div class="sl-info">Marque só o que você conferiu. Se houver avaria, o dono recebe aviso no WhatsApp.</div>`,
        `<button class="sl-btn sl-sec" type="button" data-fechar>Cancelar</button>
         <button class="sl-btn sl-pri" type="button" data-ok>Salvar checklist</button>`);

      function desenharFotos() {
        const caixa = m.q('[data-fotos]');
        const comVaga = fotos.length < MAX_FOTOS;
        caixa.innerHTML = fotos.map((f, i) => `
            <label class="sl-foto">${f.src
              ? `<img src="${esc(f.src)}" alt="${esc(f.lado)}"><button type="button" class="sl-rm" data-rm="${i}" aria-label="Remover">✕</button>`
              : `📷\n${esc(f.lado)}<input type="file" accept="image/*" capture="environment" data-foto="${i}">`}</label>`).join('') +
          (comVaga ? `<label class="sl-foto">＋\nExtra<input type="file" accept="image/*" data-extra></label>` : '');
        caixa.querySelectorAll('[data-foto],[data-extra]').forEach((inp) => {
          inp.onchange = async () => {
            const arq = inp.files[0];
            if (!arq) return;
            try {
              const src = await comprimirFoto(arq);
              if (inp.dataset.extra !== undefined) fotos.push({ lado: 'Extra', id: null, src });
              else Object.assign(fotos[+inp.dataset.foto], { id: null, src });
              desenharFotos();
            } catch { toast('Não foi possível ler a foto.', true); }
          };
        });
        caixa.querySelectorAll('[data-rm]').forEach((b) => {
          b.onclick = (e) => {
            e.preventDefault();
            const i = +b.dataset.rm;
            if (i < LADOS.length) Object.assign(fotos[i], { id: null, src: null });
            else fotos.splice(i, 1);
            desenharFotos();
          };
        });
      }

      function desenharItens() {
        const caixa = m.q('[data-itens]');
        caixa.innerHTML = itens.map((it, i) => `
            <div class="sl-item">
              <div class="sl-item-top"><span>${esc(it.rotulo)}</span>
                <div class="sl-seg"><button type="button" class="${it.st === 'ok' ? 'ok' : ''}" data-st="ok" data-i="${i}">OK</button><button type="button" class="${it.st === 'av' ? 'av' : ''}" data-st="av" data-i="${i}">Avaria</button></div>
              </div>
              ${it.st === 'av' ? `<textarea rows="2" maxlength="300" data-obs="${i}" placeholder="Descreva: onde, tamanho...">${esc(it.obs)}</textarea>` : ''}
            </div>`).join('');
        caixa.querySelectorAll('[data-st]').forEach((b) => {
          b.onclick = () => {
            const it = itens[+b.dataset.i];
            it.st = it.st === b.dataset.st ? null : b.dataset.st; // tocar de novo desmarca
            desenharItens();
          };
        });
        caixa.querySelectorAll('[data-obs]').forEach((t) => { t.oninput = () => { itens[+t.dataset.obs].obs = t.value; }; });
      }

      desenharFotos();
      desenharItens();

      const ok = m.q('[data-ok]');
      ok.onclick = async () => {
        ok.disabled = true; ok.textContent = 'Salvando...';
        try {
          const r = await window.fetchApi(`/solicitacoes/${encodeURIComponent(s.id)}/checklist`, {
            method: 'PUT',
            semRedirect: true,
            body: JSON.stringify({
              itens: itens.filter((i) => i.st).map((i) => ({ chave: i.chave, st: i.st, obs: i.st === 'av' ? i.obs : '' })),
              fotos: fotos.filter((f) => f.src).map((f) => (f.id ? { id: f.id } : { lado: f.lado, imagem: f.src })),
            }),
          });
          m.fechar();
          toast(r.avarias ? `Checklist salvo · ${r.avarias} avaria(s) — dono avisado` : 'Checklist salvo · sem avarias');
        } catch (e) {
          toast(e?.error || 'Não foi possível salvar o checklist.', true);
          ok.disabled = false; ok.textContent = 'Salvar checklist';
        }
        carregar();
      };
    }

    // Abre sozinho quando chega carro novo (uma vez por carro nesta sessão)
    function avisarNovos() {
      const pend = st.dados?.pendentes || [];
      let vistos = [];
      try { vistos = JSON.parse(sessionStorage.getItem('sl_vistos') || '[]'); } catch (e) { /* sem storage */ }
      const novos = pend.filter((s) => !vistos.includes(s.id));
      if (novos.length && !st.lista && !document.querySelector('.sl-ov')) abrirLista();
      try { sessionStorage.setItem('sl_vistos', JSON.stringify(pend.map((s) => s.id))); } catch (e) { /* sem storage */ }
    }

    carregar().then(avisarNovos);
    setInterval(() => {
      if (document.visibilityState === 'visible') carregar().then(avisarNovos);
    }, POLL_MS);
  }

  window.SolicitacoesLocaliza = { montar };
})();
