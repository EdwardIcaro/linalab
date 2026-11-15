/* Acompanhamento do veículo (15/11/2026) — bloco "Acompanhamento do cliente" no detalhe da ordem.
 * Usado em ordens.html (dono, modal de edição) e funcionario/ordens.html (detalhe).
 *
 *   AcompOrdem.montar(elementoVazio, ordemId)
 *
 * Mostra se o link foi agendado / enviado / aberto / falhou e oferece Enviar agora, Não enviar,
 * Reenviar, Copiar link e Ver página. Se a rota não existir ainda (backend antigo) ou a ordem
 * não tiver acompanhamento (frota, avulsa), o bloco simplesmente não aparece.
 */
(function (global) {
  'use strict';

  const CSS = `
  .acb{border:1px solid #e5e7eb;border-radius:12px;padding:12px;margin-top:12px;background:#fff;font-size:13px;color:#0f172a}
  .acb h5{font-size:11px;letter-spacing:.5px;text-transform:uppercase;color:#64748b;margin:0 0 10px;font-weight:600}
  .acb-lin{display:flex;gap:10px;align-items:flex-start}
  .acb-ic{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;flex-shrink:0;font-size:15px}
  .acb-lin b{display:block;font-size:14px}
  .acb-lin span{display:block;color:#64748b;font-size:12px;line-height:1.4;margin-top:1px}
  .acb-acoes{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
  .acb-acoes button,.acb-acoes a{font:inherit;font-size:12px;font-weight:600;padding:7px 10px;border-radius:9px;cursor:pointer;display:inline-flex;gap:6px;align-items:center;text-decoration:none;
    border:1px solid #e5e7eb;background:#fff;color:#0f172a}
  .acb-acoes .pri{background:#0f766e;border-color:#0f766e;color:#fff}
  .acb-acoes button:disabled{opacity:.6;cursor:default}
  .acb-log{font-size:12px;color:#64748b;display:grid;gap:4px;margin-top:10px;border-left:2px solid #e5e7eb;padding-left:10px}
  .acb-link{display:flex;gap:6px;margin-top:10px}
  .acb-link input{flex:1;min-width:0;font:12px ui-monospace,Consolas,monospace;border:1px solid #e5e7eb;border-radius:8px;padding:6px 8px;color:#475569;background:#f8fafc}
  `;

  const COR = {
    agendado:          ['#fef3c7', '#b45309', 'fa-clock'],
    enviando:          ['#dbeafe', '#2563eb', 'fa-paper-plane'],
    aguardandoConexao: ['#fee2e2', '#dc2626', 'fa-plug'],
    enviado:           ['#dbeafe', '#2563eb', 'fa-paper-plane'],
    lido:              ['#dcfce7', '#16a34a', 'fa-eye'],
    falhou:            ['#fee2e2', '#dc2626', 'fa-triangle-exclamation'],
    semTelefone:       ['#f1f5f9', '#64748b', 'fa-phone-slash'],
    naoEnviado:        ['#f1f5f9', '#64748b', 'fa-link'],
  };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const hora = (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '');
  const toast = (m, t) => { if (typeof global.showToast === 'function') global.showToast(m, t || 'info'); else console.log(m); };

  function textos(d) {
    const p = d.pendente;
    const oQue = p?.origem === 'ACOMP_PRONTO' ? 'Aviso de pronto' : 'Link';
    switch (d.estado) {
      case 'agendado': return [`${oQue} agendado`, `Sai às ${hora(p.enviarApos)} pelo WhatsApp da empresa. Dá tempo de corrigir algo.`];
      case 'enviando': return ['Enviando agora…', 'Pelo WhatsApp da empresa.'];
      case 'aguardandoConexao': return ['Esperando o WhatsApp da empresa', 'O número da empresa está desconectado. A mensagem sai quando reconectar (até 2 h depois). Se preferir, copie o link e mande na mão.'];
      case 'enviado': return ['Link enviado', `Pelo WhatsApp da empresa às ${hora(d.enviadoEm)}.`];
      case 'lido': return ['Cliente abriu a página', `Enviado ${hora(d.enviadoEm)} · aberto ${hora(d.abertoEm)}`];
      case 'falhou': {
        const e = d.erro || '';
        if (/não encontrado/i.test(e)) return ['Não foi enviado', 'O telefone do cliente não tem WhatsApp. Confira o cadastro ou copie o link.'];
        if (/desconectado/i.test(e)) return ['Não foi enviado', 'O WhatsApp da empresa ficou desconectado. Reconecte e tente de novo, ou copie o link.'];
        return ['Não foi enviado', 'Tente de novo ou copie o link e mande na mão.'];
      }
      case 'semTelefone': return ['Cliente sem telefone', 'Cadastre o telefone do cliente para enviar automaticamente, ou copie o link.'];
      default: return ['Link não enviado', 'Envie pelo WhatsApp da empresa ou copie o link.'];
    }
  }

  function html(d, ocupado) {
    const [bg, cor, ic] = COR[d.estado] || COR.naoEnviado;
    const [t, s] = textos(d);
    const b = [];
    const dis = ocupado ? ' disabled' : '';
    if (d.pendente) {
      if (d.estado === 'agendado') b.push(`<button class="pri" data-a="enviar"${dis}><i class="fas fa-paper-plane"></i> Enviar agora</button>`);
      b.push(`<button data-a="nao"${dis}><i class="fas fa-ban"></i> Não enviar</button>`);
    } else if (d.temTelefone) {
      if (d.estado === 'falhou') b.push(`<button class="pri" data-a="enviar"${dis}><i class="fas fa-rotate-right"></i> Tentar de novo</button>`);
      else if (d.estado === 'enviado' || d.estado === 'lido') b.push(`<button data-a="enviar"${dis}><i class="fas fa-rotate-right"></i> Reenviar</button>`);
      else b.push(`<button class="pri" data-a="enviar"${dis}><i class="fab fa-whatsapp"></i> Enviar pelo WhatsApp</button>`);
    }
    if (d.link) {
      b.push(`<button data-a="copiar"><i class="fas fa-link"></i> Copiar link</button>`);
      b.push(`<a href="${esc(d.link)}?equipe=1" target="_blank" rel="noopener"><i class="fas fa-eye"></i> Ver página</a>`);
    }
    const log = [];
    if (d.enviadoEm) log.push(`Link enviado às ${hora(d.enviadoEm)}`);
    if (d.abertoEm) log.push(`Cliente abriu a página às ${hora(d.abertoEm)}`);
    if (d.prontoEm) log.push(`Aviso de pronto às ${hora(d.prontoEm)}`);
    return `
      <h5>Acompanhamento do cliente</h5>
      <div class="acb-lin"><div class="acb-ic" style="background:${bg};color:${cor}"><i class="fas ${ic}"></i></div><div><b>${esc(t)}</b><span>${esc(s)}</span></div></div>
      ${!d.ativo ? '<div class="acb-log" style="border-color:#fde68a">O envio automático está desligado nesta empresa (Configurações › Preferências).</div>' : ''}
      ${b.length ? `<div class="acb-acoes">${b.join('')}</div>` : ''}
      ${log.length ? `<div class="acb-log">${log.map((l) => `<div>${esc(l)}</div>`).join('')}</div>` : ''}
      <div class="acb-link" hidden><input readonly value="${esc(d.link || '')}" aria-label="Link do acompanhamento"></div>`;
  }

  function montar(el, ordemId) {
    if (!el || !ordemId || !global.api?.getAcompanhamento) return;
    if (!document.getElementById('acb-css')) {
      const st = document.createElement('style'); st.id = 'acb-css'; st.textContent = CSS; document.head.appendChild(st);
    }
    clearInterval(el._acbTimer);
    el._acbOrdem = ordemId;
    el.innerHTML = '';
    el.className = '';
    let d = null, ocupado = false;

    const desenhar = () => {
      if (el._acbOrdem !== ordemId) return;
      if (!d || !d.disponivel || (!d.ativo && !d.link)) { el.innerHTML = ''; el.className = ''; return; }
      el.className = 'acb';
      el.innerHTML = html(d, ocupado);
    };
    const carregar = async () => {
      try { d = await global.api.getAcompanhamento(ordemId); }
      catch { d = null; }
      desenhar();
    };
    const acao = async (fn, ok) => {
      ocupado = true; desenhar();
      try { d = await fn(ordemId); if (ok) toast(ok, 'success'); }
      catch (e) { toast(e?.error || e?.message || 'Não deu certo', 'error'); }
      ocupado = false; desenhar();
    };

    el.onclick = async (ev) => {
      const a = ev.target.closest('[data-a]')?.dataset.a;
      if (!a || !d) return;
      if (a === 'enviar') acao(global.api.enviarAcompanhamento, 'Mensagem na fila do WhatsApp da empresa');
      else if (a === 'nao') acao(global.api.naoEnviarAcompanhamento, 'Envio cancelado');
      else if (a === 'copiar') {
        try { await navigator.clipboard.writeText(d.link); toast('Link copiado', 'success'); }
        catch {
          const box = el.querySelector('.acb-link'); box.hidden = false;
          const i = box.querySelector('input'); i.focus(); i.select();
        }
      }
    };

    carregar();
    // Enquanto há mensagem na fila, atualiza sozinho; para quando o bloco sai da tela
    el._acbTimer = setInterval(() => {
      if (!el.isConnected || el._acbOrdem !== ordemId) { clearInterval(el._acbTimer); return; }
      if (d?.pendente && !ocupado) carregar();
    }, 15000);
  }

  global.AcompOrdem = { montar };
})(window);
