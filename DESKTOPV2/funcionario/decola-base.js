// Base "Decola" das páginas da subconta
// Céu estrelado: pontos aleatórios + algumas cruzinhas, como o fundo do Decola (semente fixa para ficar igual em toda página)
(function () {
  const ceu = document.getElementById('ceu');
  if (!ceu) return;
  let semente = 7; const rnd = () => (semente = (semente * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < 90; i++) {
    const e = document.createElement('i');
    e.style.left = rnd() * 100 + '%'; e.style.top = rnd() * 100 + '%'; e.style.opacity = .25 + rnd() * .6;
    ceu.append(e);
  }
  for (let i = 0; i < 6; i++) {
    const c = document.createElement('b'); c.textContent = '+';
    c.style.left = rnd() * 100 + '%'; c.style.top = rnd() * 100 + '%';
    ceu.append(c);
  }
})();

// Janelas que sobem de baixo: abrir/fechar por id, fechar no fundo e nos botões [data-fechar]
window.Folha = {
  abrir(id) { document.getElementById(id).classList.add('on'); },
  fechar(id) { document.getElementById(id).classList.remove('on'); },
};
document.addEventListener('click', (e) => {
  const fundo = e.target.classList?.contains('folha-fundo') ? e.target : e.target.closest('[data-fechar]')?.closest('.folha-fundo');
  if (fundo) fundo.classList.remove('on');
});
