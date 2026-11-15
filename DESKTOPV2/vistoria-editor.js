/* Vistoria de entrada (acompanhamento do veículo, fase 2 — 15/11/2026).
 * Protótipo: Features/front/acompanhamento-veiculo.html (tela "Vistoria").
 *
 *   VistoriaEditor.abrir({ tipo: 'carro'|'moto', placa, dados, botao, onSalvar: async (dados) => {} })
 *     dados = { km, obs, avarias: [{ zona, tipo, obs, fotos: [{ id?, src }] }] }
 *     onSalvar pode lançar erro: a janela continua aberta e mostra a mensagem.
 *   VistoriaEditor.svg(tipo, zonasComAvaria, zonaSelecionada, pixel)  → diagrama (também usado na página do cliente)
 *   VistoriaEditor.nomeZona(tipo, zona) · VistoriaEditor.resumo(dados) · VistoriaEditor.vazia(dados)
 *
 * Tudo é opcional. Foto comprimida no navegador (lado maior 1280 px, JPEG ~100-400 KB), até 3 por avaria e 12 no total.
 */
(function (global) {
  'use strict';

  const ZONAS = {
    carro: {
      pcd: 'Para-choque dianteiro', capo: 'Capô', teto: 'Teto', tampa: 'Tampa traseira', pct: 'Para-choque traseiro',
      pbr: 'Para-brisa', vtr: 'Vidro traseiro', rve: 'Retrovisor esquerdo', rvd: 'Retrovisor direito',
      led: 'Lateral esq. dianteira', let: 'Lateral esq. traseira', ldd: 'Lateral dir. dianteira', ldt: 'Lateral dir. traseira',
      rde: 'Roda dianteira esq.', rdd: 'Roda dianteira dir.', rte: 'Roda traseira esq.', rtd: 'Roda traseira dir.',
    },
    moto: {
      rdm: 'Roda dianteira', farol: 'Farol / frente', guidao: 'Guidão', rve: 'Retrovisor esquerdo', rvd: 'Retrovisor direito',
      tanque: 'Tanque', le: 'Carenagem esquerda', ld: 'Carenagem direita', banco: 'Banco', esc: 'Escapamento',
      rabeta: 'Rabeta / lanterna', rtm: 'Roda traseira',
    },
  };
  const TIPOS = ['Risco', 'Amassado', 'Trincado', 'Quebrado', 'Pintura queimada', 'Peça faltando'];
  const MAX_FOTOS = 12, MAX_FOTOS_AVARIA = 3;

  // data-z = id da parte · data-p = onde vai o número da avaria · classe vd = vidro, rd = roda
  const SVG = {
    carro: `<svg viewBox="0 0 200 400" xmlns="http://www.w3.org/2000/svg">
  <path data-z="rde" data-p="25,90" class="z rd" d="M18 70h14a4 4 0 0 1 4 4v32a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4V74a4 4 0 0 1 4-4z"/>
  <path data-z="rdd" data-p="175,90" class="z rd" d="M168 70h14a4 4 0 0 1 4 4v32a4 4 0 0 1-4 4h-14a4 4 0 0 1-4-4V74a4 4 0 0 1 4-4z"/>
  <path data-z="rte" data-p="25,300" class="z rd" d="M18 280h14a4 4 0 0 1 4 4v32a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4v-32a4 4 0 0 1 4-4z"/>
  <path data-z="rtd" data-p="175,300" class="z rd" d="M168 280h14a4 4 0 0 1 4 4v32a4 4 0 0 1-4 4h-14a4 4 0 0 1-4-4v-32a4 4 0 0 1 4-4z"/>
  <path data-z="rve" data-p="14,128" class="z" d="M30 120h-10a6 6 0 0 0 0 16h10z"/>
  <path data-z="rvd" data-p="186,128" class="z" d="M170 120h10a6 6 0 0 1 0 16h-10z"/>
  <path data-z="pcd" data-p="100,30" class="z" d="M50 22Q100 4 150 22l6 22H44z"/>
  <path data-z="capo" data-p="100,84" class="z" d="M44 44h112l-4 76H48z"/>
  <path data-z="led" data-p="38,165" class="z" d="M30 50q4-4 14-6l4 76-2 80H30z"/>
  <path data-z="ldd" data-p="162,165" class="z" d="M170 50q-4-4-14-6l-4 76 2 80h16z"/>
  <path data-z="let" data-p="38,262" class="z" d="M30 200h16l2 90-4 66q-10-2-14-6z"/>
  <path data-z="ldt" data-p="162,262" class="z" d="M170 200h-16l-2 90 4 66q10-2 14-6z"/>
  <path data-z="teto" data-p="100,212" class="z" d="M48 120h104l2 170H46z"/>
  <path data-z="pbr" data-p="100,141" class="z vd" d="M54 126h92l-6 30H60z"/>
  <path data-z="vtr" data-p="100,273" class="z vd" d="M60 262h80l6 22H54z"/>
  <path data-z="tampa" data-p="100,322" class="z" d="M46 290h108l2 66H44z"/>
  <path data-z="pct" data-p="100,372" class="z" d="M44 356h112l-6 22q-50 18-100 0z"/>
</svg>`,
    moto: `<svg viewBox="0 0 200 400" xmlns="http://www.w3.org/2000/svg">
  <path data-z="rdm" data-p="100,44" class="z rd" d="M100 8a12 12 0 0 1 12 12v50a12 12 0 0 1-24 0V20a12 12 0 0 1 12-12z"/>
  <path data-z="esc" data-p="152,284" class="z" d="M144 236h10a6 6 0 0 1 6 6v80a6 6 0 0 1-6 6h-10z"/>
  <path data-z="rve" data-p="30,104" class="z" d="M30 94a10 8 0 1 1 0 16a10 8 0 1 1 0-16z"/>
  <path data-z="rvd" data-p="170,104" class="z" d="M170 94a10 8 0 1 1 0 16a10 8 0 1 1 0-16z"/>
  <path data-z="guidao" data-p="62,118" class="z" d="M40 114h120a4 4 0 0 1 0 8H40a4 4 0 0 1 0-8z"/>
  <path data-z="farol" data-p="100,96" class="z" d="M76 84q24-14 48 0l-4 28H80z"/>
  <path data-z="le" data-p="56,182" class="z" d="M50 142l18-10-2 98-16-10z"/>
  <path data-z="ld" data-p="144,182" class="z" d="M150 142l-18-10 2 98 16-10z"/>
  <path data-z="tanque" data-p="100,160" class="z" d="M70 128q30-10 60 0l4 62q-34 10-68 0z"/>
  <path data-z="banco" data-p="100,240" class="z" d="M72 196q28 8 56 0l-4 86H76z"/>
  <path data-z="rabeta" data-p="100,300" class="z" d="M76 282h48l-6 36H82z"/>
  <path data-z="rtm" data-p="100,358" class="z rd" d="M100 320a14 14 0 0 1 14 14v48a14 14 0 0 1-28 0v-48a14 14 0 0 1 14-14z"/>
</svg>`,
  };

  const CSS = `
  .vst-fundo{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:10050;display:flex;align-items:center;justify-content:center;padding:16px}
  .vst{width:460px;max-width:100%;max-height:calc(100vh - 32px);background:#fff;color:#0f172a;border-radius:18px;box-shadow:0 10px 32px rgba(15,23,42,.25);display:flex;flex-direction:column;overflow:hidden;font:14px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
  .vst *{box-sizing:border-box}
  .vst-head{padding:14px 18px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;gap:10px}
  .vst-head b{font-size:16px}
  .vst-head span{font-size:12px;color:#64748b;font-family:ui-monospace,Consolas,monospace;letter-spacing:1px}
  .vst-body{padding:16px 18px;display:grid;gap:16px;overflow-y:auto}
  .vst-info{font-size:12px;background:#e0f7fa;color:#006978;padding:9px 11px;border-radius:10px;line-height:1.45}
  .vst-lbl{font-size:13px;font-weight:600;margin-bottom:6px;display:block}
  .vst-lbl small{font-weight:400;color:#64748b}
  .vst-inp{width:100%;border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px;font:inherit;font-size:15px;color:inherit;background:#fff}
  .vst-inp:focus{outline:2px solid #b2ebf2;border-color:#00acc1}
  .vst-veic svg{width:100%;max-width:190px;display:block;margin:0 auto}
  .vst-veic .z{fill:#f1f5f9;stroke:#94a3b8;stroke-width:1.5;cursor:pointer;transition:fill .15s}
  .vst-veic .z.vd{fill:#e0f2fe;stroke:#7dd3fc}
  .vst-veic .z.rd{fill:#cbd5e1;stroke:#64748b}
  .vst-veic .z:hover{fill:#e0f7fa}
  .vst-veic .z.av{fill:#fecaca;stroke:#dc2626}
  .vst-veic .z.sel{stroke:#00838f;stroke-width:3}
  .vst-veic text{font-size:11px;font-weight:700;fill:#fff;pointer-events:none}
  .vst-veic .pin{fill:#dc2626;stroke:#fff;stroke-width:2;pointer-events:none}
  .vst-zona{background:#f8fafc;border:1px solid #e5e7eb;border-radius:14px;padding:12px;display:grid;gap:10px}
  .vst-zona-top{display:flex;justify-content:space-between;align-items:center}
  .vst-chips{display:flex;gap:6px;flex-wrap:wrap}
  .vst-chip{border:1px solid #e5e7eb;padding:7px 11px;border-radius:99px;font-size:13px;background:#fff;cursor:pointer;font-family:inherit;color:inherit}
  .vst-chip.on{background:#dc2626;border-color:#dc2626;color:#fff}
  .vst-fotos{display:flex;gap:6px;flex-wrap:wrap}
  .vst-foto{width:58px;height:58px;border-radius:10px;background:#e5e7eb center/cover;border:1px solid #e5e7eb;position:relative}
  .vst-foto button{position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;border:none;background:#0f172a;color:#fff;font-size:12px;line-height:20px;cursor:pointer;padding:0}
  .vst-add{width:58px;height:58px;border-radius:10px;border:2px dashed #cbd5e1;display:grid;place-items:center;font-size:20px;color:#64748b;cursor:pointer}
  .vst-tags{display:flex;gap:6px;flex-wrap:wrap}
  .vst-tag{font-size:12px;background:#fee2e2;color:#991b1b;padding:4px 8px;border-radius:8px;cursor:pointer;border:none;font-family:inherit}
  .vst-link{background:none;border:none;color:#64748b;font:inherit;font-size:12px;cursor:pointer;padding:0;text-align:left}
  .vst-link.red{color:#dc2626}
  .vst-foot{padding:12px 18px;border-top:1px solid #e5e7eb;display:flex;gap:8px;justify-content:space-between;align-items:center}
  .vst-erro{font-size:12px;color:#dc2626;flex:1}
  .vst-btn{font:inherit;font-weight:600;font-size:14px;padding:10px 16px;border-radius:11px;cursor:pointer;border:1px solid #e5e7eb;background:#fff;color:#0f172a}
  .vst-btn.pri{background:#0097a7;border-color:#0097a7;color:#fff}
  .vst-btn:disabled{opacity:.6;cursor:default}
  @media (max-width:520px){.vst-fundo{padding:0;align-items:flex-end}.vst{border-radius:18px 18px 0 0;max-height:94vh}}
  `;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const nomeZona = (tipo, z) => ZONAS[tipo === 'moto' ? 'moto' : 'carro'][z] || z;
  const kmFmt = (n) => Number(n).toLocaleString('pt-BR');

  function svg(tipo, zonasAv, sel, pixel) {
    const div = document.createElement('div');
    div.innerHTML = SVG[tipo === 'moto' ? 'moto' : 'carro'];
    const el = div.firstElementChild;
    let pinos = '';
    el.querySelectorAll('[data-z]').forEach((p) => {
      const n = zonasAv.indexOf(p.dataset.z);
      if (sel === p.dataset.z) p.classList.add('sel');
      if (n < 0) return;
      p.classList.add('av');
      const [x, y] = p.dataset.p.split(',').map(Number);
      pinos += (pixel ? `<rect class="pin" x="${x - 10}" y="${y - 10}" width="20" height="20"/>` : `<circle class="pin" cx="${x}" cy="${y}" r="9"/>`)
        + `<text x="${x}" y="${y + 4.5}" text-anchor="middle">${n + 1}</text>`;
    });
    return el.outerHTML.replace('</svg>', pinos + '</svg>');
  }

  function vazia(d) { return !d || ((d.km === '' || d.km == null) && !String(d.obs || '').trim() && !(d.avarias || []).length); }
  function resumo(d) {
    if (vazia(d)) return '';
    const p = [];
    if (d.km !== '' && d.km != null) p.push(`${kmFmt(String(d.km).replace(/\D/g, ''))} km`);
    const n = (d.avarias || []).length;
    p.push(n ? `${n} avaria${n > 1 ? 's' : ''}` : 'sem avarias');
    const f = (d.avarias || []).reduce((s, a) => s + (a.fotos || []).length, 0);
    if (f) p.push(`${f} foto${f > 1 ? 's' : ''}`);
    return p.join(' · ');
  }

  function comprimir(arquivo) {
    return new Promise((ok, falhou) => {
      const r = new FileReader();
      r.onerror = () => falhou(new Error('Não deu para ler a foto'));
      r.onload = () => {
        const img = new Image();
        img.onerror = () => falhou(new Error('Arquivo não é uma foto'));
        img.onload = () => {
          const lado = 1280, k = Math.min(1, lado / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          let url = c.toDataURL('image/jpeg', 0.7);
          if (url.length > 450000) url = c.toDataURL('image/jpeg', 0.5);
          ok(url);
        };
        img.src = r.result;
      };
      r.readAsDataURL(arquivo);
    });
  }

  function abrir(opts) {
    if (!document.getElementById('vst-css')) {
      const st = document.createElement('style'); st.id = 'vst-css'; st.textContent = CSS; document.head.appendChild(st);
    }
    const tipo = opts.tipo === 'moto' ? 'moto' : 'carro';
    const ini = opts.dados || {};
    const st = {
      km: ini.km == null ? '' : String(ini.km),
      obs: ini.obs || '',
      avarias: (ini.avarias || []).filter((a) => ZONAS[tipo][a.zona]).map((a) => ({ zona: a.zona, tipo: a.tipo, obs: a.obs || '', fotos: (a.fotos || []).map((f) => ({ ...f })) })),
      sel: null, salvando: false, erro: '',
    };
    const fundo = document.createElement('div');
    fundo.className = 'vst-fundo';
    document.body.appendChild(fundo);
    const fechar = () => { fundo.remove(); document.removeEventListener('keydown', tecla); };
    const tecla = (e) => { if (e.key === 'Escape' && !st.salvando) fechar(); };
    document.addEventListener('keydown', tecla);
    const totalFotos = () => st.avarias.reduce((s, a) => s + a.fotos.length, 0);
    const av = (z) => st.avarias.find((a) => a.zona === z);

    function desenhar() {
      const a = st.sel ? av(st.sel) : null;
      const rolagem = fundo.querySelector('.vst-body')?.scrollTop || 0;
      fundo.innerHTML = `
      <div class="vst" role="dialog" aria-modal="true" aria-label="Vistoria">
        <div class="vst-head"><b>Vistoria de entrada</b><span>${esc(opts.placa || '')}</span></div>
        <div class="vst-body">
          <div class="vst-info">Tudo aqui é opcional. Registre o que ajudar a evitar discussão depois: km, avarias com foto e um recado para o cliente.</div>
          <div><label class="vst-lbl" for="vst-km">Quilometragem</label>
            <input id="vst-km" class="vst-inp" inputmode="numeric" placeholder="Ex.: 48312" maxlength="9" value="${esc(st.km)}" data-c="km"></div>
          <div><span class="vst-lbl">Avarias <small>· toque na parte ${tipo === 'moto' ? 'da moto' : 'do carro'}</small></span>
            <div class="vst-veic" data-c="veic">${svg(tipo, st.avarias.map((x) => x.zona), st.sel, false)}</div></div>
          ${st.sel ? `
          <div class="vst-zona">
            <div class="vst-zona-top"><b>${esc(nomeZona(tipo, st.sel))}</b><button class="vst-link" data-c="fecharZona">fechar ✕</button></div>
            <div class="vst-chips">${TIPOS.map((t) => `<button class="vst-chip${a?.tipo === t ? ' on' : ''}" data-c="tipo" data-t="${esc(t)}">${esc(t)}</button>`).join('')}</div>
            ${a ? `
              <input class="vst-inp" placeholder="Detalhe (opcional): ex. risco de 10 cm" maxlength="160" value="${esc(a.obs)}" data-c="obsAv">
              <div class="vst-fotos">
                ${a.fotos.map((f, i) => `<div class="vst-foto" style="background-image:url('${f.src}')"><button data-c="tiraFoto" data-i="${i}" aria-label="Remover foto">×</button></div>`).join('')}
                ${a.fotos.length < MAX_FOTOS_AVARIA && totalFotos() < MAX_FOTOS ? `<label class="vst-add" title="Adicionar foto"><i class="fas fa-camera"></i><input type="file" accept="image/*" capture="environment" hidden data-c="foto"></label>` : ''}
              </div>
              <button class="vst-link red" data-c="remover">Remover avaria desta parte</button>` : '<span class="vst-link">Escolha o tipo para marcar a avaria.</span>'}
          </div>` : ''}
          ${st.avarias.length ? `<div class="vst-tags">${st.avarias.map((x, i) => `<button class="vst-tag" data-c="ir" data-z="${x.zona}">${i + 1}. ${esc(x.tipo)} · ${esc(nomeZona(tipo, x.zona))}${x.fotos.length ? ` · ${x.fotos.length} foto${x.fotos.length > 1 ? 's' : ''}` : ''}</button>`).join('')}</div>` : ''}
          <div><label class="vst-lbl" for="vst-obs">Observação para o cliente</label>
            <input id="vst-obs" class="vst-inp" maxlength="300" placeholder="Ex.: cliente avisou que o som está com chiado" value="${esc(st.obs)}" data-c="obs"></div>
        </div>
        <div class="vst-foot">
          <span class="vst-erro">${esc(st.erro)}</span>
          <div style="display:flex;gap:8px">
            <button class="vst-btn" data-c="cancelar"${st.salvando ? ' disabled' : ''}>Cancelar</button>
            <button class="vst-btn pri" data-c="salvar"${st.salvando ? ' disabled' : ''}>${st.salvando ? 'Salvando…' : esc(opts.botao || 'Salvar vistoria')}</button>
          </div>
        </div>
      </div>`;
      const body = fundo.querySelector('.vst-body'); if (body) body.scrollTop = rolagem;
    }

    fundo.addEventListener('input', (e) => {
      const c = e.target.dataset.c;
      if (c === 'km') { e.target.value = e.target.value.replace(/\D/g, ''); st.km = e.target.value; }
      else if (c === 'obs') st.obs = e.target.value;
      else if (c === 'obsAv') { const a = av(st.sel); if (a) a.obs = e.target.value; }
    });
    fundo.addEventListener('change', async (e) => {
      if (e.target.dataset.c !== 'foto') return;
      const arq = e.target.files?.[0]; const a = av(st.sel);
      if (!arq || !a) return;
      try { a.fotos.push({ src: await comprimir(arq) }); st.erro = ''; }
      catch (err) { st.erro = err.message; }
      desenhar();
    });
    fundo.addEventListener('click', async (e) => {
      if (e.target === fundo && !st.salvando) return fechar();
      const alvo = e.target.closest('[data-c]'); if (!alvo) return;
      const c = alvo.dataset.c;
      if (c === 'veic') { const z = e.target.closest('[data-z]')?.dataset.z; if (z) { st.sel = z; desenhar(); } }
      else if (c === 'fecharZona') { st.sel = null; desenhar(); }
      else if (c === 'ir') { st.sel = alvo.dataset.z; desenhar(); }
      else if (c === 'tipo') { const a = av(st.sel); if (a) a.tipo = alvo.dataset.t; else st.avarias.push({ zona: st.sel, tipo: alvo.dataset.t, obs: '', fotos: [] }); desenhar(); }
      else if (c === 'remover') { st.avarias = st.avarias.filter((a) => a.zona !== st.sel); st.sel = null; desenhar(); }
      else if (c === 'tiraFoto') { const a = av(st.sel); a?.fotos.splice(Number(alvo.dataset.i), 1); desenhar(); }
      else if (c === 'cancelar') { if (!st.salvando) fechar(); }
      else if (c === 'salvar') {
        const dados = { km: st.km === '' ? null : Number(st.km), obs: st.obs.trim(), avarias: st.avarias.map((a) => ({ zona: a.zona, tipo: a.tipo, obs: a.obs.trim(), fotos: a.fotos })) };
        st.salvando = true; st.erro = ''; desenhar();
        try { await opts.onSalvar?.(dados); fechar(); }
        catch (err) { st.salvando = false; st.erro = err?.error || err?.message || 'Não foi possível salvar'; desenhar(); }
      }
    });
    desenhar();
  }

  global.VistoriaEditor = { abrir, svg, nomeZona, resumo, vazia, ZONAS, TIPOS };
})(window);
