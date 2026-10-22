// Componentes de interface: ícones, modais, avisos e indicador de carregamento.
import { el, compartilharArquivo, tamanhoLegivel } from './util.js';

const ICONES = {
  voltar: '<path d="M15 5l-7 7 7 7"/>',
  menu: '<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3.4"/>',
  lista: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01" />',
  mais: '<path d="M12 5v14M5 12h14"/>',
  menos: '<path d="M5 12h14"/>',
  ajustar: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  galeria: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/>',
  fechar: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  busca: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  nomes: '<path d="M4 18l4.5-12 4.5 12M5.8 14h5.4M15 18v-6.5a2.5 2.5 0 015 0V18M15 14h5"/>',
};

export function icone(nome) {
  const s = document.createElement('span');
  s.className = 'icone';
  s.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[nome]}</svg>`;
  return s;
}

// Cada botão fecha o modal com seu `valor`, ou chama `acao(fechar)` quando precisa
// agir dentro do próprio toque (ex.: abrir o menu de compartilhar do iOS).
export function abrirModal({ titulo, corpo, botoes = [], classe = '', aoAbrir }) {
  return new Promise((resolve) => {
    const camada = document.getElementById('camada-modal');
    const fundo = el('div', { class: 'modal-fundo' });
    const caixa = el('div', { class: `modal ${classe}`, role: 'dialog', 'aria-modal': 'true' });
    const fechar = (valor) => {
      fundo.remove();
      resolve(valor);
    };
    if (titulo) caixa.append(el('h2', { class: 'modal-titulo' }, titulo));
    if (corpo) caixa.append(el('div', { class: 'modal-corpo' }, corpo));
    if (botoes.length) {
      const barra = el('div', { class: 'modal-botoes' });
      for (const b of botoes) {
        barra.append(el('button', {
          type: 'button',
          class: `btn ${b.classe || ''}`,
          onclick: () => (b.acao ? b.acao(fechar) : fechar(b.valor)),
        }, b.rotulo));
      }
      caixa.append(barra);
    }
    fundo.append(caixa);
    camada.append(fundo);
    aoAbrir?.(caixa, fechar);
  });
}

export function alerta(mensagem, titulo = 'Aviso') {
  return abrirModal({
    titulo,
    corpo: el('p', {}, mensagem),
    botoes: [{ rotulo: 'OK', classe: 'btn-primario', valor: true }],
  });
}

export function confirmar(mensagem, { titulo = 'Confirmar', rotuloOk = 'Confirmar', perigo = false } = {}) {
  return abrirModal({
    titulo,
    corpo: el('p', {}, mensagem),
    botoes: [
      { rotulo: 'Cancelar', valor: false },
      { rotulo: rotuloOk, classe: perigo ? 'btn-perigo' : 'btn-primario', valor: true },
    ],
  });
}

export function pedirTexto({ titulo, rotulo, valor = '', placeholder = '', rotuloOk = 'Salvar', perigo = false, maiusculas = false, validar }) {
  const input = el('input', {
    class: 'campo', type: 'text', value: valor, placeholder,
    autocapitalize: maiusculas ? 'characters' : 'sentences',
    autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'done',
  });
  const erro = el('p', { class: 'erro', hidden: true });
  const enviar = (fechar) => {
    const msg = validar?.(input.value);
    if (msg) {
      erro.textContent = msg;
      erro.hidden = false;
      return;
    }
    fechar(input.value);
  };
  return abrirModal({
    titulo,
    corpo: el('label', { class: 'rotulo-campo' }, rotulo ? el('span', {}, rotulo) : null, input, erro),
    botoes: [
      { rotulo: 'Cancelar', valor: null },
      { rotulo: rotuloOk, classe: perigo ? 'btn-perigo' : 'btn-primario', acao: enviar },
    ],
    aoAbrir: (caixa, fechar) => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          enviar(fechar);
        }
      });
      input.addEventListener('input', () => { erro.hidden = true; });
      input.focus();
      input.select();
    },
  });
}

// Lista de opções empilhadas (estilo "action sheet").
export function escolher({ titulo, texto, opcoes }) {
  return abrirModal({
    titulo,
    classe: 'modal-escolha',
    corpo: texto ? el('p', { class: 'nota' }, texto) : null,
    botoes: opcoes.map((o) => ({ rotulo: o.rotulo, valor: o.valor, classe: o.classe })),
  });
}

// Arquivo pronto → botão "Compartilhar" (o toque abre o menu do iOS).
// Resolve com 'compartilhado' | 'cancelado' | 'baixado' | null (fechou).
export function oferecerArquivo(arquivo, { titulo, texto }) {
  return abrirModal({
    titulo,
    corpo: el('div', {},
      texto ? el('p', {}, texto) : null,
      el('div', { class: 'nome-arquivo' }, arquivo.name),
      el('p', { class: 'nota' }, tamanhoLegivel(arquivo.size))),
    botoes: [
      { rotulo: 'Fechar', valor: null },
      { rotulo: 'Compartilhar', classe: 'btn-primario', acao: (fechar) => fechar(compartilharArquivo(arquivo)) },
    ],
  });
}

let timerToast;
export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(timerToast);
  timerToast = setTimeout(() => { t.hidden = true; }, 2800);
}

export function carregando(msg = 'Carregando…') {
  const camada = el('div', { class: 'carregando' },
    el('div', { class: 'carregando-caixa' }, el('div', { class: 'girador' }), el('span', {}, msg)));
  document.body.append(camada);
  return () => camada.remove();
}
