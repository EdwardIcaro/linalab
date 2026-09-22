/**
 * mobile-tables.js — a tabela vira cartão no celular.
 *
 * Por que existe: o CSS sozinho não consegue transformar tabela em cartão
 * mantendo o nome da coluna ao lado do valor, porque a célula não sabe a
 * qual cabeçalho pertence. O jeito padrão é escrever data-label="..." em
 * cada <td> na mão — inviável aqui, já que são 11 tabelas em 10 páginas e
 * quase todas montam as linhas por JavaScript depois de buscar os dados.
 *
 * Este script carimba o data-label sozinho, lendo o <thead> da própria
 * tabela. Quem desenha o cartão é o CSS (bloco "tabela vira cartão" em
 * mobile.css), que usa o data-label no ::before de cada célula.
 *
 * Regras de segurança:
 * - Só age abaixo de 768px. No desktop a tabela continua tabela.
 * - Tabela sem <thead> não é tocada: fica com a rolagem horizontal.
 * - Célula com colspan (as mensagens de "nenhum registro") não recebe
 *   rótulo, senão viraria "Nome: Nenhum cliente cadastrado".
 * - Célula que só tem botões também não recebe rótulo.
 * - Reaplica quando chegam linhas novas, porque o conteúdo vem de fetch.
 */
(function () {
  'use strict';

  var LARGURA_MOBILE = 768;
  var agendado = null;

  function ehMobile() {
    return window.matchMedia('(max-width: ' + LARGURA_MOBILE + 'px)').matches;
  }

  /**
   * Célula "de ações" = todo o conteúdo dela são botões/links.
   * Não dá para testar por td.textContent === '', porque o texto do próprio
   * botão ("Editar") entra nessa conta e a célula acabava recebendo o
   * rótulo "AÇÕES" ao lado do botão. O teste certo é procurar texto solto,
   * fora dos controles.
   */
  function soTemControles(td) {
    if (!td.querySelector('button, a, input, select')) return false;
    for (var i = 0; i < td.childNodes.length; i++) {
      var no = td.childNodes[i];
      if (no.nodeType === 3 && no.textContent.trim() !== '') return false;
    }
    return true;
  }

  function rotularTabela(tabela) {
    var ths = tabela.querySelectorAll('thead th');
    if (!ths.length) return;

    var rotulos = [];
    for (var i = 0; i < ths.length; i++) {
      rotulos.push(ths[i].textContent.replace(/\s+/g, ' ').trim());
    }

    tabela.classList.add('tabela-cartao');

    var linhas = tabela.querySelectorAll('tbody tr');
    for (var l = 0; l < linhas.length; l++) {
      var celulas = linhas[l].children;
      for (var c = 0; c < celulas.length; c++) {
        var td = celulas[c];
        if (td.colSpan > 1) { td.setAttribute('data-sem-rotulo', ''); continue; }
        if (soTemControles(td)) { td.setAttribute('data-acoes', ''); continue; }
        var rotulo = rotulos[c];
        if (rotulo && td.getAttribute('data-label') !== rotulo) {
          td.setAttribute('data-label', rotulo);
        }
      }
    }
  }

  function aplicar() {
    agendado = null;
    if (!ehMobile()) return;
    var tabelas = document.querySelectorAll('table');
    for (var i = 0; i < tabelas.length; i++) rotularTabela(tabelas[i]);
  }

  function agendar() {
    if (agendado) return;
    agendado = setTimeout(aplicar, 120);
  }

  function iniciar() {
    aplicar();

    // As linhas quase sempre chegam depois (fetch, Alpine, render manual).
    // Observa o documento inteiro porque várias telas trocam o <tbody> todo,
    // e não só as linhas dentro dele.
    if (window.MutationObserver) {
      new MutationObserver(function (mutacoes) {
        for (var i = 0; i < mutacoes.length; i++) {
          if (mutacoes[i].addedNodes.length) { agendar(); return; }
        }
      }).observe(document.body, { childList: true, subtree: true });
    }

    // Girar o aparelho cruza o breakpoint: recarimba ao voltar para o mobile.
    window.addEventListener('resize', agendar);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();
