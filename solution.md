  🔍 O Problema Original                                                                                                
  Quando você selecionava "Adiantamento" no modal de lançar despesa, a lista de lavadores não aparecia no campo           "Responsável". O modal abria normalmente, mas o <datalist> (que mostra as sugestões ao digitar) ficava vazio.

  🐛 Causa Raiz

  O problema estava na incompatibilidade entre Alpine.js e o elemento HTML <datalist>.

  Código Original (linha 1268-1279):

  <datalist id="responsaveis-list">
      <template x-if="transactionModal.categoria === 'Adiantamento'">
          <template x-for="lavador in activeLavadores()" :key="lavador.id">
              <option :value="lavador.nome"></option>
          </template>
      </template>
      <template x-if="transactionModal.categoria !== 'Adiantamento'">
          <template x-for="fornecedor in fornecedores" :key="fornecedor.id">
              <option :value="fornecedor.nome"></option>
          </template>
      </template>
  </datalist>

  Por que não funcionava?

  1. x-if remove elementos do DOM: Quando você usa x-if="false", o Alpine.js literalmente remove o elemento do HTML
  2. <datalist> é nativo do navegador: O navegador não "escuta" mudanças que o Alpine.js faz depois que a página carrega
  3. Problema de timing: Quando a categoria mudava para "Adiantamento", o Alpine.js recriava os elementos, mas o
  navegador não atualizava a lista de sugestões

  ✅ A Solução

  Abandonei as diretivas reativas do Alpine.js e usei JavaScript puro para manipular o DOM diretamente.

  Passo 1: Simplifiquei o HTML (linha 1268-1269)

  <datalist id="responsaveis-list">
  </datalist>

  Agora o <datalist> é apenas um container vazio que vamos preencher manualmente.

  Passo 2: Criei o método updateDatalist() (linha ~1736-1765)

  updateDatalist() {
      const datalist = document.getElementById('responsaveis-list');
      if (!datalist) {
          console.warn('[financeDashboard] datalist nao encontrado');
          return;
      }

      // 1. LIMPAR todas as opções antigas
      datalist.innerHTML = '';

      // 2. DECIDIR qual lista usar (lavadores ou fornecedores)
      const lista = this.getResponsaveisList();
      const isAdiantamento = this.transactionModal.categoria === 'Adiantamento';

      // 3. VALIDAR se temos dados
      if (!Array.isArray(lista) || lista.length === 0) {
          console.warn('[financeDashboard] lista vazia');
          return;
      }

      // 4. CRIAR opções manualmente com JavaScript puro
      lista.forEach((item, index) => {
          if (item && item.nome) {
              const option = document.createElement('option'); // Cria elemento HTML
              option.value = item.nome;                        // Define o valor

              // Adiciona formatação melhorada
              if (isAdiantamento) {
                  option.setAttribute('label', `${item.nome} - Funcionário`);
              } else {
                  let label = item.nome;
                  if (item.telefone) label += ` - ${item.telefone}`;
                  option.setAttribute('label', label);
              }

              datalist.appendChild(option); // Adiciona ao datalist
          }
      });

      console.log('[financeDashboard] ✓ datalist atualizado:',
                  datalist.children.length, 'opcoes');
  }

  Passo 3: Método auxiliar getResponsaveisList() (linha 1725-1734)

  getResponsaveisList() {
      // Apenas retorna lavadores quando for Adiantamento
      if (this.transactionModal.categoria === 'Adiantamento') {
          const lavadores = this.activeLavadores();
          console.log('[getResponsaveisList] Retornando lavadores:', lavadores.length);
          return lavadores;
      }
      // Para outras categorias, retorna fornecedores
      console.log('[getResponsaveisList] Retornando fornecedores:',
                  (this.fornecedores || []).length);
      return this.fornecedores || [];
  }

  Passo 4: Chamei updateDatalist() nos momentos certos

  Quando a categoria muda (linha ~1800):
  onCategoriaChange() {
      const isAdiantamento = this.transactionModal.categoria === 'Adiantamento';
      if (isAdiantamento) {
          this.transactionModal.fornecedorNome = '';
          this.$nextTick(() => {
              this.updateDatalist(); // ← ATUALIZA AQUI
              this.focusResponsavelInput();
          });
      } else {
          // ...
          this.$nextTick(() => {
              this.updateDatalist(); // ← E AQUI TAMBÉM
              this.$refs.transactionValor?.focus();
          });
      }
  }

  Quando o modal abre (linha ~1821):
  openTransactionModal(type) {
      // ... código de inicialização ...

      this.$nextTick(() => {
          this.updateDatalist(); // ← ATUALIZA AO ABRIR
          if (modalState.categoria === 'Adiantamento') {
              this.focusResponsavelInput();
          }
      });
  }

  Quando edita uma transação (linha ~1838):
  openEditModal(tx) {
      // ... código de inicialização ...

      this.$nextTick(() => {
          this.updateDatalist(); // ← ATUALIZA AO EDITAR
          // ...
      });
  }

  🎯 Resultado Final

  ✅ O que funciona agora:

  1. Separação correta:
    - "Adiantamento" → mostra apenas lavadores
    - "Despesa/Outro" → mostra apenas fornecedores
  2. Exibição melhorada:
    - Lavadores: "João Silva - Funcionário"
    - Fornecedores: "Fornecedor ABC - (11) 98765-4321"
  3. Atualização automática: Quando você muda a categoria, a lista atualiza instantaneamente
  4. Logs de debug: Console mostra exatamente o que está acontecendo

  💡 Lição Aprendida

  Alpine.js é ótimo para reatividade, mas alguns elementos HTML nativos (como <datalist>) precisam ser manipulados
  diretamente com JavaScript vanilla porque o navegador não "escuta" mudanças feitas por frameworks JavaScript depois
  que a página carrega.

  A solução foi: Alpine.js gerencia o estado (dados) → JavaScript puro atualiza o DOM (interface) quando necessário.

  Faz sentido? Alguma parte que você gostaria que eu explicasse melhor?