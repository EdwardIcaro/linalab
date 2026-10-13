/**
 * Hub › Configurações da conta › Automações de e-mail.
 *
 * Vale para a conta inteira (todas as empresas do dono): liga os modelos permanentes da
 * Localiza numa caixa de e-mail e vincula, por empresa, o cliente e os serviços que ela
 * já usa — assim a ordem aceita pela fila cai no mesmo cliente/serviço das ordens à mão.
 *
 * Depende de window.fetchApi (api.js). API: /api/hub/solicitacoes (só o dono).
 */
(function () {
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const brl = (n) => 'R$ ' + Number(n).toFixed(2).replace('.', ',');
  const chave = (p) => String(Math.round(Number(p) * 100) / 100);

  function css() {
    if (document.getElementById('ha-css')) return;
    const st = document.createElement('style');
    st.id = 'ha-css';
    st.textContent = `
      .ha-box{border:1px solid #e6e8ee;border-radius:14px;padding:14px;margin-bottom:12px;background:#fff}
      .ha-row{display:flex;gap:12px;align-items:flex-start}
      .ha-ic{width:40px;height:40px;border-radius:11px;background:#ecfdf5;display:grid;place-items:center;font-size:20px;flex-shrink:0}
      .ha-t{flex:1;min-width:0}.ha-t b{font-size:14px;color:#1e293b}.ha-t p{font-size:12.5px;color:#64748b;margin:3px 0 0;line-height:1.45}
      .ha-tag{display:inline-block;font-size:11px;font-weight:700;padding:3px 8px;border-radius:99px;margin-top:6px;margin-right:4px}
      .ha-tag.perm{background:#ecfdf5;color:#047857}.ha-tag.on{background:#dcfce7;color:#166534}.ha-tag.off{background:#f1f3f8;color:#64748b}
      .ha-sw{width:46px;height:27px;border-radius:99px;background:#cbd5e1;position:relative;flex-shrink:0;border:none;cursor:pointer;transition:.2s}
      .ha-sw::after{content:'';position:absolute;top:3px;left:3px;width:21px;height:21px;border-radius:50%;background:#fff;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.2)}
      .ha-sw.on{background:#16a34a}.ha-sw.on::after{left:22px}.ha-sw:disabled{opacity:.5;cursor:wait}
      .ha-lbl{display:block;font-size:12px;font-weight:600;color:#475569;margin:10px 0 5px}
      .ha-sel{width:100%;padding:9px 10px;border:1.5px solid #d5dae5;border-radius:10px;font-size:13px;font-family:inherit;background:#fff}
      .ha-emp{background:#f8fafc;border:1px solid #e6e8ee;border-radius:12px;padding:12px;margin-top:10px}
      .ha-grid{display:grid;grid-template-columns:100px 1fr;gap:6px 8px;align-items:center;font-size:12.5px;color:#334155;margin-top:8px}
      .ha-conta{display:flex;align-items:center;gap:8px;font-size:13px;padding:6px 0}
      .ha-conta span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
      .ha-dot{width:8px;height:8px;border-radius:50%;background:#16a34a;flex-shrink:0}.ha-dot.erro{background:#dc2626}
      .ha-nota{font-size:12px;color:#64748b;margin-top:8px;line-height:1.45}
      .ha-save{margin-top:10px;width:100%}
    `;
    document.head.appendChild(st);
  }

  async function montar(host) {
    if (!host || !window.fetchApi) return;
    css();
    host.innerHTML = '<div class="cfg-empty">Carregando...</div>';
    let d;
    try {
      d = await window.fetchApi('/hub/solicitacoes/config', { semRedirect: true, cache: 'no-store' });
    } catch (e) {
      host.innerHTML = `<div class="cfg-empty">${esc(e?.error || 'Erro ao carregar as automações.')}</div>`;
      return;
    }
    const empNome = Object.fromEntries(d.empresas.map((e) => [e.id, e.nome]));

    const contasHtml = d.contas.length
      ? d.contas.map((c) => `<div class="ha-conta"><i class="ha-dot ${c.status === 'CONECTADO' ? '' : 'erro'}"></i>
          <span><b>${esc(c.email)}</b> · ${esc(empNome[c.empresaId] || '')}</span>
          <small style="color:${c.status === 'CONECTADO' ? '#166534' : '#991b1b'}">${c.status === 'CONECTADO' ? 'Conectado' : esc(c.status)}</small></div>`).join('')
      : '<div class="ha-nota">Nenhuma caixa de e-mail conectada. Conecte em <b>Configurações › WhatsApp › Automação de e-mail</b> dentro de uma empresa.</div>';

    host.innerHTML = `
      <div class="ha-box"><div class="cfg-section-title" style="margin:0 0 4px">Caixas de e-mail</div>${contasHtml}</div>
      ${d.modelos.map((m) => modeloHtml(m, d)).join('')}
      <div class="ha-nota">💡 <b>Modelo permanente</b> = mantido pela Lina. Se a Localiza mudar o layout do e-mail, corrigimos uma vez e vale para todo mundo.</div>`;

    d.modelos.forEach((m) => ligarModelo(host, m, d));
  }

  function modeloHtml(m, d) {
    const ativo = !!m.regra?.ativo;
    const opcoes = d.contas.map((c) => `<option value="${esc(c.id)}" ${m.regra?.contaId === c.id ? 'selected' : ''}>${esc(c.email)}</option>`).join('');
    return `<div class="ha-box" data-modelo="${esc(m.id)}">
        <div class="ha-row">
          <div class="ha-ic">${esc(m.emoji)}</div>
          <div class="ha-t"><b>${esc(m.nome)} · ${esc(m.fornecedor)}</b><p>${esc(m.fila === 'SOLICITACAO'
            ? 'Cada carro solicitado vira um cartão no portal das subcontas com Nova Ordem, para aceitar e lançar a ordem.'
            : m.fila === 'CANCELAMENTO' ? 'Tira o carro da fila do portal. Se já tinha virado ordem, marca e avisa — nunca apaga sozinho.' : m.descricao)}</p>
            <span class="ha-tag perm">Modelo permanente</span><span class="ha-tag ${ativo ? 'on' : 'off'}">${ativo ? 'Ativo' : 'Desligado'}</span>
          </div>
          <button class="ha-sw ${ativo ? 'on' : ''}" type="button" data-sw aria-label="Ligar ou desligar" ${d.contas.length ? '' : 'disabled'}></button>
        </div>
        ${d.contas.length ? `<label class="ha-lbl">Ler da caixa</label><select class="ha-sel" data-conta>${opcoes}</select>` : ''}
        ${m.regra ? `<div class="ha-nota">Avisos no WhatsApp: ${m.regra.destinatarios ? m.regra.destinatarios + ' contato(s)' : 'nenhum'} (editar em Configurações › WhatsApp da empresa).</div>` : ''}
        ${m.fila === 'SOLICITACAO' ? `<div class="cfg-section-title" style="margin:14px 0 2px">Vínculo com o que cada empresa já usa</div>
          <div class="ha-nota" style="margin-top:0">Sugerido pelo histórico de ordens da Localiza. A comissão segue o % do serviço escolhido — igual às ordens lançadas à mão.</div>
          ${d.empresas.map((e) => empresaHtml(e, d.precos)).join('')}` : ''}
      </div>`;
  }

  function empresaHtml(e, precos) {
    const v = e.vinculo;
    const clienteSel = v?.clienteId ?? e.sugestao.clienteId;
    const servSel = v ? v.servicos : e.sugestao.servicos;
    const ativo = v ? v.ativo : false;
    const clientes = e.clientes.map((c) => `<option value="${esc(c.id)}" ${c.id === clienteSel ? 'selected' : ''}>${esc(c.nome)} (${c.ordens} ordens)${!v && c.id === e.sugestao.clienteId ? ' · sugerido' : ''}</option>`).join('');
    const linhas = precos.map((p) => {
      const atual = servSel[chave(p)] || '';
      const sug = e.sugestao.servicos[chave(p)];
      const ops = e.servicos.map((s) => `<option value="${esc(s.id)}" ${s.id === atual ? 'selected' : ''}>${esc(s.nome)} · ${brl(s.preco)}${s.comissaoPercentual != null ? ' · ' + s.comissaoPercentual + '% fixo' : ''}${!v && s.id === sug ? ' · sugerido' : ''}</option>`).join('');
      return `<span>Lavagem ${brl(p)}</span><select class="ha-sel" data-preco="${esc(chave(p))}"><option value="">— sem vínculo —</option>${ops}</select>`;
    }).join('');
    return `<div class="ha-emp" data-emp="${esc(e.id)}">
        <div class="ha-row" style="align-items:center"><b style="flex:1;font-size:13px">🏢 ${esc(e.nome)}</b>
          <span style="font-size:12px;color:#64748b">Fila nesta empresa</span>
          <button class="ha-sw ${ativo ? 'on' : ''}" type="button" data-emp-sw aria-label="Mostrar a fila nesta empresa"></button></div>
        <div class="ha-grid">
          <span>Cliente</span><select class="ha-sel" data-cliente>${clientes || '<option value="">Nenhum cliente "Localiza" cadastrado</option>'}</select>
          ${linhas}
        </div>
        <button class="btn-cfg-primary ha-save" type="button" data-salvar>${v ? 'Salvar vínculo' : 'Confirmar vínculo'}</button>
      </div>`;
  }

  function ligarModelo(host, m, d) {
    const box = host.querySelector(`[data-modelo="${m.id}"]`);
    const sw = box.querySelector('[data-sw]');
    const sel = box.querySelector('[data-conta]');
    const alternar = async (ativo) => {
      sw.disabled = true;
      try {
        await window.fetchApi(`/hub/solicitacoes/modelos/${encodeURIComponent(m.id)}`, {
          method: 'POST', semRedirect: true, body: JSON.stringify({ ativo, contaId: sel?.value }),
        });
        montar(host);
      } catch (e) {
        alert(e?.error || 'Não foi possível alterar a automação.');
        sw.disabled = false;
      }
    };
    sw.onclick = () => alternar(!sw.classList.contains('on'));
    // Trocar a caixa de um modelo já ligado move a leitura pra ela
    if (sel) sel.onchange = () => { if (sw.classList.contains('on')) alternar(true); };

    box.querySelectorAll('[data-emp]').forEach((empBox) => {
      const esw = empBox.querySelector('[data-emp-sw]');
      esw.onclick = () => esw.classList.toggle('on');
      const btn = empBox.querySelector('[data-salvar]');
      btn.onclick = async () => {
        const servicos = {};
        empBox.querySelectorAll('[data-preco]').forEach((s) => { if (s.value) servicos[s.dataset.preco] = s.value; });
        btn.disabled = true; btn.textContent = 'Salvando...';
        try {
          await window.fetchApi(`/hub/solicitacoes/vinculos/${encodeURIComponent(empBox.dataset.emp)}`, {
            method: 'PUT', semRedirect: true,
            body: JSON.stringify({ clienteId: empBox.querySelector('[data-cliente]').value || null, servicos, ativo: esw.classList.contains('on') }),
          });
          btn.textContent = '✓ Salvo';
          setTimeout(() => { btn.disabled = false; btn.textContent = 'Salvar vínculo'; }, 1500);
        } catch (e) {
          alert(e?.error || 'Não foi possível salvar o vínculo.');
          btn.disabled = false; btn.textContent = 'Salvar vínculo';
        }
      };
    });
  }

  window.HubAutomacoes = { montar };
})();
