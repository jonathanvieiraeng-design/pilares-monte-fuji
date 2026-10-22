// Telas e fluxo do app. Rotas: #/ · #/novo · #/teto/{id} · #/teto/{id}/editar
import * as db from './db.js';
import {
  el, uid, agora, STATUS, ORDEM_STATUS, statusDo, checkSemFoto, resumo, fmtData, fmtDataHora, diasDesde,
  tamanhoLegivel, normalizarNomePilar, limparNome, compararNatural, compartilharArquivo,
} from './util.js';
import {
  icone, abrirModal, alerta, confirmar, pedirTexto, escolher, oferecerArquivo, toast, carregando,
} from './ui.js';
import { Planta, abrirPdf, renderizarMiniatura } from './planta.js';
import { escolherFoto, nomeDaFoto, prepararFoto, gerarMiniatura } from './foto.js';
import { gerarRelatorio } from './relatorio.js';
import { gerarImagemPlanta } from './imagem.js';
import { gerarBackup, lerBackup, restaurarBackup } from './backup.js';

const app = document.getElementById('app');
const LOGO = 'assets/logo-arcoirismar.png';
let aoSairDaTela = null;

// Arquivo original da última foto de cada pilar, só enquanto o app está aberto.
const fotosDaSessao = new Map();

function montar(no, aoSair = null) {
  aoSairDaTela?.();
  aoSairDaTela = aoSair;
  app.replaceChildren(no);
}

function ir(hash) {
  if (location.hash === hash) rota();
  else location.hash = hash;
}

async function rota() {
  const partes = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  try {
    if (partes[0] === 'novo') await telaFormTeto(null);
    else if (partes[0] === 'teto' && partes[1] && partes[2] === 'editar') await telaFormTeto(partes[1]);
    else if (partes[0] === 'teto' && partes[1]) await telaTeto(partes[1]);
    else await telaInicio();
  } catch (e) {
    console.error(e);
    alerta(`Ocorreu um erro: ${e.message}`, 'Erro');
  }
}

// =====================================================================
// Tela inicial
// =====================================================================

function barraProgresso(r) {
  const barra = el('div', { class: 'progresso', 'aria-hidden': 'true' });
  if (!r.total) return barra;
  for (const st of ['concluido', 'conferido', 'pendente']) {
    if (r[st]) barra.append(el('span', { class: `seg st-${st}`, style: { flexGrow: r[st] } }));
  }
  return barra;
}

function faixaBackup(ultimo) {
  let texto;
  let atencao = true;
  if (!ultimo) {
    texto = 'Nenhum backup feito ainda. Os dados existem só neste aparelho.';
  } else {
    const d = diasDesde(ultimo);
    const quando = d <= 0 ? 'hoje' : d === 1 ? 'ontem' : `há ${d} dias`;
    texto = `Último backup: ${quando} (${fmtData(ultimo)}).`;
    atencao = d > 7;
  }
  return el('div', { class: `faixa-backup${atencao ? ' atencao' : ''}` },
    el('span', {}, texto),
    el('button', { type: 'button', class: 'btn btn-pequeno', onclick: acaoExportarBackup }, 'Fazer backup'));
}

async function telaInicio() {
  const [tetos, pilares, ultimoBackup] = await Promise.all([
    db.listarTetos(), db.listarTodosPilares(), db.obterMeta('ultimoBackupEm'),
  ]);
  tetos.sort((a, b) => compararNatural(a.codigo, b.codigo));
  const porTeto = new Map();
  for (const p of pilares) {
    if (!porTeto.has(p.tetoId)) porTeto.set(p.tetoId, []);
    porTeto.get(p.tetoId).push(p);
  }

  const lista = tetos.length
    ? el('div', { class: 'lista-tetos' }, tetos.map((t) => {
      const r = resumo(porTeto.get(t.id) || []);
      return el('a', { class: 'cartao-teto', href: `#/teto/${t.id}` },
        el('div', { class: 'cartao-topo' },
          el('div', {},
            el('h2', {}, t.nome),
            el('p', { class: 'sub' }, [t.codigo, t.referenciaPrancha].filter(Boolean).join(' · '))),
          el('div', { class: 'pct' }, `${r.pct}%`)),
        barraProgresso(r),
        el('p', { class: 'contagens' },
          `${r.total} pilares · `,
          el('span', { class: 'ponto-st st-pendente' }), ` ${r.pendente}  `,
          el('span', { class: 'ponto-st st-conferido' }), ` ${r.conferido}  `,
          el('span', { class: 'ponto-st st-concluido' }), ` ${r.concluido}`));
    }))
    : el('div', { class: 'vazio' },
      el('p', {}, 'Nenhum teto cadastrado.'),
      el('p', { class: 'nota' }, 'Crie o primeiro teto carregando o PDF da prancha.'));

  const raiz = el('div', { class: 'tela tela-rolavel' },
    el('header', { class: 'cabecalho-inicio' },
      el('img', { class: 'logo-marca', src: LOGO, alt: 'Construtora Arco-Íris-Mar' }),
      el('h1', {}, 'Controle de Pilares'),
      el('p', { class: 'sub' }, 'Residencial Monte Fuji · As-built da armação')),
    faixaBackup(ultimoBackup),
    lista,
    el('div', { class: 'acoes-inicio' },
      el('a', { class: 'btn btn-primario btn-grande', href: '#/novo' }, icone('mais'), 'Novo teto'),
      el('div', { class: 'linha-botoes' },
        el('button', { type: 'button', class: 'btn', onclick: acaoExportarBackup }, 'Exportar backup'),
        el('button', { type: 'button', class: 'btn', onclick: acaoImportarBackup }, 'Importar backup'))),
    el('p', { class: 'rodape-versao' }, 'Construtora Arco-Íris-Mar · Residencial Monte Fuji · uso offline'));
  montar(raiz);
}

async function acaoExportarBackup() {
  const fim = carregando('Gerando backup…');
  let arquivo;
  try {
    arquivo = await gerarBackup();
  } catch (e) {
    alerta(`Não foi possível gerar o backup: ${e.message}`, 'Erro');
    return;
  } finally {
    fim();
  }
  try {
    const r = await oferecerArquivo(arquivo, {
      titulo: 'Backup pronto',
      texto: 'Salve no OneDrive com "Salvar em Arquivos". O arquivo contém tetos, pranchas, pilares e miniaturas.',
    });
    if (r === 'compartilhado' || r === 'baixado') {
      await db.salvarMeta('ultimoBackupEm', agora());
      toast('Backup registrado');
      if (!location.hash || location.hash === '#/') rota();
    }
  } catch (e) {
    alerta(`Erro ao compartilhar: ${e.message}`, 'Erro');
  }
}

function acaoImportarBackup() {
  const input = el('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } });
  document.body.append(input);
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    input.remove();
    if (!f) return;
    let dados;
    try {
      dados = await lerBackup(f);
    } catch (e) {
      alerta(e.message, 'Backup inválido');
      return;
    }
    const ok = await confirmar(
      `Backup de ${fmtDataHora(dados.exportadoEm)} com ${dados.tetos.length} teto(s) e ${dados.pilares.length} pilar(es). `
      + 'Importar SUBSTITUI todos os dados atuais deste aparelho.',
      { titulo: 'Importar backup', rotuloOk: 'Substituir dados', perigo: true },
    );
    if (!ok) return;
    const fim = carregando('Restaurando…');
    try {
      await restaurarBackup(dados);
      fotosDaSessao.clear();
      toast('Backup restaurado');
      ir('#/');
    } catch (e) {
      alerta(`A importação falhou e nenhum dado foi alterado. ${e.message}`, 'Erro');
    } finally {
      fim();
    }
  });
  input.click();
}

// =====================================================================
// Cadastro / edição de teto
// =====================================================================

async function telaFormTeto(id) {
  const teto = id ? await db.obterTeto(id) : null;
  if (id && !teto) return ir('#/');
  const prancha = id ? await db.obterPrancha(id) : null;

  let novoPdf = null; // { buf, nome, doc }
  let docAtual = null;

  const cNome = el('input', { class: 'campo', value: teto?.nome || '', placeholder: 'Ex.: Teto 2 — Piso G1 (Garagem 01)' });
  const cCodigo = el('input', {
    class: 'campo', value: teto?.codigo || '', placeholder: 'Ex.: T02',
    autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false',
  });
  const cRef = el('input', { class: 'campo', value: teto?.referenciaPrancha || '', placeholder: 'Ex.: 1102 - 38 - R01' });
  const cArquivo = el('input', { type: 'file', accept: 'application/pdf,.pdf', style: { display: 'none' } });
  const infoArquivo = el('p', { class: 'nota' },
    teto ? `Atual: ${prancha?.nome || '—'} · página ${teto.pagina}` : 'Nenhum arquivo escolhido.');
  const cPagina = el('select', { class: 'campo' });
  const blocoPagina = el('label', { class: 'rotulo-campo', hidden: true }, el('span', {}, 'Página do PDF'), cPagina);
  const previa = el('canvas', { class: 'previa-pdf' });
  const caixaPrevia = el('div', { class: 'caixa-previa', hidden: true }, previa);

  async function mostrarPrevia(doc, numero) {
    caixaPrevia.hidden = false;
    const largura = Math.min(caixaPrevia.clientWidth || 320, 640);
    try {
      await renderizarMiniatura(doc, numero, previa, largura);
    } catch (e) {
      console.warn(e);
    }
  }

  cArquivo.addEventListener('change', async () => {
    const f = cArquivo.files?.[0];
    cArquivo.value = '';
    if (!f) return;
    const fim = carregando('Lendo PDF…');
    try {
      const buf = await f.arrayBuffer();
      const doc = await abrirPdf(buf);
      novoPdf?.doc.destroy();
      novoPdf = { buf, nome: f.name, doc };
      cPagina.replaceChildren(...Array.from({ length: doc.numPages }, (_, i) => el('option', { value: String(i + 1) }, `Página ${i + 1}`)));
      cPagina.value = String(Math.min(teto?.pagina || 1, doc.numPages));
      blocoPagina.hidden = doc.numPages < 2;
      infoArquivo.textContent = `${f.name} · ${doc.numPages} página(s) · ${tamanhoLegivel(f.size)}`;
      await mostrarPrevia(doc, Number(cPagina.value));
    } catch (e) {
      alerta(`Não foi possível abrir o PDF. ${e.message || ''}`, 'Erro');
    } finally {
      fim();
    }
  });
  cPagina.addEventListener('change', () => novoPdf && mostrarPrevia(novoPdf.doc, Number(cPagina.value)));

  async function salvar() {
    const nome = cNome.value.trim();
    const codigo = cCodigo.value.trim().toUpperCase();
    const ref = cRef.value.trim();
    if (!nome) return alerta('Informe o nome do teto.');
    if (!/^[A-Z0-9]+$/.test(codigo)) return alerta('Código: use só letras e números, sem espaços (ex.: T02).');
    const outros = (await db.listarTetos()).filter((t) => t.id !== id);
    if (outros.some((t) => t.codigo === codigo)) return alerta(`Já existe um teto com o código ${codigo}.`);
    if (!teto && !novoPdf) return alerta('Escolha o PDF da prancha.');

    const t = teto ? { ...teto } : { id: uid(), criadoEm: agora() };
    Object.assign(t, { nome, codigo, referenciaPrancha: ref });
    let novaPrancha = null;
    let proporcaoMudou = false;
    if (novoPdf) {
      const numero = Number(cPagina.value) || 1;
      const vp = (await novoPdf.doc.getPage(numero)).getViewport({ scale: 1 });
      if (teto) {
        const antes = teto.paginaLargura / teto.paginaAltura;
        const depois = vp.width / vp.height;
        proporcaoMudou = Math.abs(depois / antes - 1) > 0.01;
      }
      Object.assign(t, { pagina: numero, paginaLargura: vp.width, paginaAltura: vp.height });
      novaPrancha = { tetoId: t.id, pdf: novoPdf.buf, nome: novoPdf.nome, carregadaEm: agora() };
    }
    const fim = carregando('Salvando…');
    try {
      await db.salvarTeto(t, novaPrancha);
    } catch (e) {
      alerta(`Não foi possível salvar: ${e.message}`, 'Erro');
      return;
    } finally {
      fim();
    }
    if (proporcaoMudou) {
      await alerta(
        'A página da nova prancha tem proporção diferente da anterior. Os marcadores foram mantidos, '
        + 'mas podem ter se deslocado: revise as posições no modo Editar planta.',
        'Atenção',
      );
    }
    toast(teto ? 'Teto atualizado' : 'Teto criado');
    ir(`#/teto/${t.id}`);
  }

  async function excluir() {
    const v = await pedirTexto({
      titulo: 'Excluir teto',
      rotulo: `Isso apaga a prancha, os pilares e todos os registros de "${teto.nome}". Digite ${teto.codigo} para confirmar.`,
      rotuloOk: 'Excluir',
      perigo: true,
      maiusculas: true,
      validar: (x) => (x.trim().toUpperCase() === teto.codigo ? null : 'Código não confere.'),
    });
    if (v == null) return;
    await db.excluirTeto(id);
    toast('Teto excluído');
    ir('#/');
  }

  const voltar = teto ? `#/teto/${teto.id}` : '#/';
  const raiz = el('div', { class: 'tela' },
    el('header', { class: 'topo' },
      el('a', { class: 'btn-icone', href: voltar, 'aria-label': 'Voltar' }, icone('voltar')),
      el('div', { class: 'topo-titulo' }, el('strong', {}, teto ? 'Editar teto' : 'Novo teto')),
      el('img', { class: 'logo-topo', src: LOGO, alt: 'Construtora Arco-Íris-Mar' })),
    el('div', { class: 'rolavel form' },
      el('label', { class: 'rotulo-campo' }, el('span', {}, 'Nome do teto'), cNome),
      el('label', { class: 'rotulo-campo' }, el('span', {}, 'Código (usado no nome das fotos)'), cCodigo),
      el('label', { class: 'rotulo-campo' }, el('span', {}, 'Referência da prancha (revisão)'), cRef),
      el('div', { class: 'rotulo-campo' },
        el('span', {}, 'Prancha (PDF)'),
        el('button', { type: 'button', class: 'btn', onclick: () => cArquivo.click() },
          teto ? 'Trocar prancha (nova revisão)' : 'Escolher PDF da prancha'),
        infoArquivo,
        teto ? el('p', { class: 'nota' }, 'Ao trocar a prancha, os marcadores são mantidos.') : null),
      blocoPagina,
      caixaPrevia,
      cArquivo,
      el('button', { type: 'button', class: 'btn btn-primario btn-grande', onclick: salvar }, 'Salvar'),
      teto ? el('button', { type: 'button', class: 'btn btn-texto-perigo', onclick: excluir }, 'Excluir teto') : null));

  montar(raiz, () => {
    novoPdf?.doc.destroy();
    docAtual?.destroy();
  });

  // prévia da prancha atual ao editar
  if (prancha) {
    try {
      docAtual = await abrirPdf(prancha.pdf);
      if (!novoPdf) await mostrarPrevia(docAtual, teto.pagina);
    } catch (e) {
      console.warn(e);
    }
  }
}

// =====================================================================
// Tela do teto: planta, conferência, edição
// =====================================================================

async function telaTeto(id) {
  const teto = await db.obterTeto(id);
  if (!teto) return ir('#/');
  const prancha = await db.obterPrancha(id);
  let pilares = await db.listarPilares(id);
  let modo = 'conferencia';
  let fichaId = null;
  let urlsFicha = [];
  const lista = { aberta: false, busca: '', filtro: 'todos' };

  // ---------- estrutura ----------
  const btnConferencia = el('button', { type: 'button', class: 'seg-btn ativo', onclick: () => definirModo('conferencia') }, 'Conferência');
  const btnEdicao = el('button', { type: 'button', class: 'seg-btn', onclick: () => definirModo('edicao') }, 'Editar planta');
  const resumoEl = el('div', { class: 'resumo-chips' });
  const area = el('div', { class: 'area-planta' });
  const dica = el('div', { class: 'dica-edicao', hidden: true },
    'Toque na planta para criar um pilar · toque no marcador para renomear ou excluir · toque e segure para mover');
  const btnNomes = el('button', { type: 'button', class: 'btn-flutuante', 'aria-label': 'Mostrar nomes', onclick: () => {
    btnNomes.classList.toggle('ativo', planta.alternarNomes());
  } }, icone('nomes'));
  const controles = el('div', { class: 'controles-planta' },
    el('button', { type: 'button', class: 'btn-flutuante', 'aria-label': 'Lista de pilares', onclick: abrirLista }, icone('lista')),
    btnNomes,
    el('button', { type: 'button', class: 'btn-flutuante', 'aria-label': 'Aproximar', onclick: () => planta.zoomCentro(1.6) }, icone('mais')),
    el('button', { type: 'button', class: 'btn-flutuante', 'aria-label': 'Afastar', onclick: () => planta.zoomCentro(1 / 1.6) }, icone('menos')),
    el('button', { type: 'button', class: 'btn-flutuante', 'aria-label': 'Ajustar à tela', onclick: () => planta.ajustar() }, icone('ajustar')));
  const avisoCarregando = el('div', { class: 'carregando-planta' }, el('div', { class: 'girador' }), 'Carregando prancha…');
  const ficha = el('div', { class: 'ficha', hidden: true });
  area.append(dica, controles, avisoCarregando, ficha);

  const buscaInput = el('input', {
    class: 'campo campo-busca', type: 'search', placeholder: 'Buscar pilar…',
    autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false',
  });
  const filtrosEl = el('div', { class: 'filtros' });
  const itensEl = el('ul', { class: 'itens-lista' });
  const gavetaFundo = el('div', { class: 'gaveta-fundo', hidden: true, onclick: fecharLista });
  const gaveta = el('aside', { class: 'gaveta', 'aria-label': 'Lista de pilares' },
    el('div', { class: 'gaveta-topo' },
      el('strong', {}, 'Pilares'),
      el('button', { type: 'button', class: 'btn-icone', 'aria-label': 'Fechar', onclick: fecharLista }, icone('fechar'))),
    el('div', { class: 'busca' }, icone('busca'), buscaInput),
    filtrosEl,
    itensEl);
  buscaInput.addEventListener('input', () => {
    lista.busca = buscaInput.value;
    renderItensLista();
  });

  const raiz = el('div', { class: 'tela tela-teto' },
    el('header', { class: 'topo' },
      el('a', { class: 'btn-icone', href: '#/', 'aria-label': 'Voltar aos tetos' }, icone('voltar')),
      el('div', { class: 'topo-titulo' },
        el('strong', {}, teto.nome),
        el('small', {}, [teto.codigo, teto.referenciaPrancha].filter(Boolean).join(' · '))),
      el('img', { class: 'logo-topo', src: LOGO, alt: 'Construtora Arco-Íris-Mar' }),
      el('button', { type: 'button', class: 'btn-icone', 'aria-label': 'Mais opções', onclick: menuTeto }, icone('menu'))),
    el('div', { class: 'barra-teto' },
      el('div', { class: 'segmentado', role: 'group' }, btnConferencia, btnEdicao),
      resumoEl),
    area,
    gavetaFundo,
    gaveta);

  const planta = new Planta(area, {
    aoTocarVazio: (fx, fy) => modo === 'edicao' && criarPilar(fx, fy),
    aoTocarMarcador: (pid) => (modo === 'edicao' ? menuMarcador(pid) : abrirFicha(pid)),
    aoMoverMarcador: moverPilar,
  });
  area.prepend(planta.vista);

  montar(raiz, () => {
    planta.destruir();
    urlsFicha.forEach((u) => URL.revokeObjectURL(u));
  });
  atualizarResumo();

  if (!prancha) {
    avisoCarregando.replaceChildren('Prancha não encontrada. Edite o teto e carregue o PDF.');
    return;
  }
  try {
    await planta.carregar(prancha.pdf, teto.pagina);
    planta.setPilares(pilares);
    avisoCarregando.remove();
  } catch (e) {
    console.error(e);
    avisoCarregando.replaceChildren(`Não foi possível abrir a prancha: ${e.message}`);
  }

  // ---------- helpers ----------
  // (declarações de função: ficam disponíveis mesmo durante o carregamento da prancha)
  function obter(pid) {
    return pilares.find((p) => p.id === pid);
  }

  async function salvar(p) {
    await db.salvarPilar(p);
    planta.atualizarPilar(p);
    atualizarResumo();
    if (fichaId === p.id) renderFicha();
    if (lista.aberta) renderLista();
  }

  function atualizarResumo() {
    const r = resumo(pilares);
    resumoEl.replaceChildren(
      ...ORDEM_STATUS.map((st) => el('span', { class: 'chip', title: STATUS[st].rotulo },
        el('span', { class: `ponto-st st-${st}` }), String(r[st]))),
      el('span', { class: 'chip chip-pct' }, `${r.pct}%`),
    );
  }

  function definirModo(m) {
    modo = m;
    planta.modo = m;
    btnConferencia.classList.toggle('ativo', m === 'conferencia');
    btnEdicao.classList.toggle('ativo', m === 'edicao');
    dica.hidden = m !== 'edicao';
    area.classList.toggle('modo-edicao', m === 'edicao');
    fecharFicha();
  }

  // ---------- edição da planta ----------
  function validarNome(texto, ignorarId = null) {
    const nome = normalizarNomePilar(texto);
    if (!nome) return 'Digite o nome do pilar.';
    if (!limparNome(nome)) return 'Use letras ou números no nome.';
    const chave = limparNome(nome);
    const outro = pilares.find((p) => p.id !== ignorarId && limparNome(p.nome) === chave);
    if (outro) return `Já existe o pilar ${outro.nome} neste teto.`;
    return null;
  }

  async function criarPilar(fx, fy) {
    const texto = await pedirTexto({
      titulo: 'Novo pilar', rotulo: 'Nome do pilar', placeholder: 'Ex.: P14', maiusculas: true,
      validar: (t) => validarNome(t),
    });
    if (texto == null) return;
    const p = {
      id: uid(), tetoId: teto.id, nome: normalizarNomePilar(texto), x: fx, y: fy,
      armaduraVerificada: false, armaduraEm: null, fotos: [], dataConferencia: null,
      uploadOneDrive: false, uploadEm: null, criadoEm: agora(),
    };
    pilares.push(p);
    await salvar(p);
  }

  async function moverPilar(pid, fx, fy) {
    const p = obter(pid);
    if (!p) return;
    p.x = fx;
    p.y = fy;
    await salvar(p);
    toast(`${p.nome} movido`);
  }

  async function menuMarcador(pid) {
    const p = obter(pid);
    if (!p) return;
    const op = await escolher({
      titulo: p.nome,
      texto: 'Para mover, toque e segure o marcador e arraste.',
      opcoes: [
        { rotulo: 'Renomear', valor: 'renomear' },
        { rotulo: 'Excluir', valor: 'excluir', classe: 'btn-texto-perigo' },
        { rotulo: 'Cancelar', valor: null },
      ],
    });
    if (op === 'renomear') {
      const texto = await pedirTexto({
        titulo: 'Renomear pilar', rotulo: 'Nome do pilar', valor: p.nome, maiusculas: true,
        validar: (t) => validarNome(t, p.id),
      });
      if (texto == null) return;
      p.nome = normalizarNomePilar(texto);
      await salvar(p);
    } else if (op === 'excluir') {
      const temRegistro = p.armaduraVerificada || p.fotos.length;
      const ok = await confirmar(
        temRegistro
          ? `O pilar ${p.nome} tem registros de conferência (check e/ou foto). Excluir apaga esses registros do app.`
          : `Excluir o pilar ${p.nome}?`,
        { titulo: 'Excluir pilar', rotuloOk: 'Excluir', perigo: true },
      );
      if (!ok) return;
      await db.excluirPilar(p.id);
      pilares = pilares.filter((x) => x.id !== p.id);
      fotosDaSessao.delete(p.id);
      planta.removerPilar(p.id);
      if (fichaId === p.id) fecharFicha();
      atualizarResumo();
      if (lista.aberta) renderLista();
    }
  }

  // ---------- ficha do pilar ----------
  function abrirFicha(pid) {
    fichaId = pid;
    planta.destacar(pid);
    renderFicha();
  }

  function fecharFicha() {
    fichaId = null;
    ficha.hidden = true;
    ficha.replaceChildren();
    urlsFicha.forEach((u) => URL.revokeObjectURL(u));
    urlsFicha = [];
  }

  function linhaCheck({ rotulo, marcado, sub, desabilitado, aoTocar }) {
    return el('button', {
      type: 'button',
      class: `linha-check${marcado ? ' marcado' : ''}`,
      disabled: desabilitado,
      'aria-pressed': marcado ? 'true' : 'false',
      onclick: aoTocar,
    },
    el('span', { class: 'caixa-check' }, marcado ? icone('check') : null),
    el('span', { class: 'texto-check' }, el('span', {}, rotulo), sub ? el('small', {}, sub) : null));
  }

  function renderFicha() {
    const p = obter(fichaId);
    if (!p) return fecharFicha();
    urlsFicha.forEach((u) => URL.revokeObjectURL(u));
    urlsFicha = [];
    const st = statusDo(p);
    const ultima = p.fotos[p.fotos.length - 1];
    const podeUpload = p.armaduraVerificada && p.fotos.length > 0;

    let situacao;
    if (p.dataConferencia) situacao = `Conferido em ${fmtDataHora(p.dataConferencia)}`;
    else if (checkSemFoto(p)) situacao = 'Armadura verificada — falta a foto';
    else if (p.fotos.length) situacao = 'Foto tirada — falta o check da armadura';
    else situacao = 'Ainda não conferido';

    let blocoFoto;
    if (!ultima) {
      blocoFoto = el('button', { type: 'button', class: 'btn btn-primario btn-grande', onclick: () => fluxoFoto(p) },
        icone('camera'), 'Tirar foto');
    } else {
      const url = ultima.miniatura ? URL.createObjectURL(new Blob([ultima.miniatura], { type: 'image/jpeg' })) : null;
      if (url) urlsFicha.push(url);
      const naSessao = fotosDaSessao.has(p.id);
      blocoFoto = el('div', { class: 'bloco-foto' },
        el('div', { class: 'foto-linha' },
          url ? el('img', { class: 'miniatura', src: url, alt: `Miniatura da foto de ${p.nome}` }) : el('div', { class: 'miniatura' }),
          el('div', { class: 'foto-info' },
            el('div', { class: 'nome-arquivo' }, ultima.nomeArquivo),
            el('small', {}, fmtDataHora(ultima.tiradaEm)),
            p.fotos.length > 1
              ? el('details', { class: 'historico' },
                el('summary', {}, `${p.fotos.length} fotos no histórico`),
                el('ul', {}, p.fotos.map((f) => el('li', {}, `${f.nomeArquivo} · ${fmtDataHora(f.tiradaEm)}`))))
              : null)),
        el('div', { class: 'foto-acoes' },
          el('button', { type: 'button', class: 'btn', onclick: () => fluxoFoto(p) }, icone('camera'), 'Nova foto'),
          naSessao ? el('button', { type: 'button', class: 'btn', onclick: () => compartilharNovamente(p) }, 'Compartilhar de novo') : null,
          el('button', { type: 'button', class: 'btn btn-texto-perigo', onclick: () => excluirUltimaFoto(p) }, 'Excluir foto')),
        naSessao ? null : el('p', { class: 'nota' },
          'O app guarda só a miniatura. A foto original está no OneDrive.'));
    }

    ficha.replaceChildren(
      el('div', { class: 'ficha-cabeca' },
        el('h2', {}, p.nome),
        el('span', { class: `pilula st-${st}` }, STATUS[st].rotulo),
        el('button', { type: 'button', class: 'btn-icone', 'aria-label': 'Fechar ficha', onclick: fecharFicha }, icone('fechar'))),
      el('p', { class: 'situacao' }, situacao),
      el('div', { class: 'passo' }, el('span', { class: 'num-passo' }, '1'),
        linhaCheck({
          rotulo: 'Armadura verificada',
          marcado: p.armaduraVerificada,
          sub: p.armaduraEm ? fmtDataHora(p.armaduraEm) : null,
          aoTocar: () => alternarArmadura(p),
        })),
      el('div', { class: 'passo' }, el('span', { class: 'num-passo' }, '2'), blocoFoto),
      el('div', { class: 'passo' }, el('span', { class: 'num-passo' }, '3'),
        linhaCheck({
          rotulo: 'Upload no OneDrive feito',
          marcado: p.uploadOneDrive,
          desabilitado: !podeUpload && !p.uploadOneDrive,
          sub: p.uploadOneDrive ? fmtDataHora(p.uploadEm) : (podeUpload ? null : 'Disponível após o check e a foto'),
          aoTocar: () => alternarUpload(p),
        })));
    ficha.hidden = false;
  }

  async function alternarArmadura(p) {
    if (!p.armaduraVerificada) {
      p.armaduraVerificada = true;
      p.armaduraEm = agora();
      if (p.fotos.length && !p.dataConferencia) p.dataConferencia = agora();
    } else {
      const ok = await confirmar(
        `Desmarcar a armadura do ${p.nome}? Isso apaga a data da conferência e desmarca o upload.`,
        { titulo: 'Desfazer conferência', rotuloOk: 'Desmarcar', perigo: true },
      );
      if (!ok) return;
      Object.assign(p, { armaduraVerificada: false, armaduraEm: null, dataConferencia: null, uploadOneDrive: false, uploadEm: null });
    }
    await salvar(p);
  }

  async function alternarUpload(p) {
    if (!p.uploadOneDrive) {
      if (!(p.armaduraVerificada && p.fotos.length)) return;
      p.uploadOneDrive = true;
      p.uploadEm = agora();
    } else {
      const ok = await confirmar(`Desmarcar o upload do ${p.nome}? O pilar volta para "Conferido".`,
        { titulo: 'Desfazer upload', rotuloOk: 'Desmarcar', perigo: true });
      if (!ok) return;
      p.uploadOneDrive = false;
      p.uploadEm = null;
    }
    await salvar(p);
  }

  async function excluirUltimaFoto(p) {
    const ultima = p.fotos[p.fotos.length - 1];
    if (!ultima) return;
    const ok = await confirmar(
      `Excluir o registro da foto ${ultima.nomeArquivo}? O arquivo já salvo no OneDrive não é afetado.`,
      { titulo: 'Excluir foto', rotuloOk: 'Excluir', perigo: true },
    );
    if (!ok) return;
    p.fotos.pop();
    fotosDaSessao.delete(p.id);
    if (!p.fotos.length) Object.assign(p, { dataConferencia: null, uploadOneDrive: false, uploadEm: null });
    await salvar(p);
  }

  // ---------- fluxo da foto ----------
  async function fluxoFoto(p) {
    const original = await escolherFoto();
    if (!original) return;
    const fim = carregando('Preparando foto…');
    let foto;
    let mini;
    const nome = nomeDaFoto(teto, p);
    try {
      foto = await prepararFoto(original, nome);
      mini = await gerarMiniatura(foto);
    } catch (e) {
      alerta(`Não foi possível ler a foto: ${e.message}`, 'Erro');
      return;
    } finally {
      fim();
    }

    const url = URL.createObjectURL(foto);
    const r = await abrirModal({
      titulo: `Foto do pilar ${p.nome}`,
      classe: 'modal-foto',
      corpo: el('div', {},
        el('img', { class: 'previa-foto', src: url, alt: 'Prévia da foto' }),
        el('div', { class: 'nome-arquivo' }, nome),
        el('p', { class: 'orientacao' },
          'Use "Salvar em Arquivos" (pasta do OneDrive) ou o app do OneDrive. ',
          el('strong', {}, '"Salvar Imagem" perde o nome do arquivo.'))),
      botoes: [
        { rotulo: 'Descartar', valor: null },
        // o share precisa sair dentro deste toque, antes de qualquer await
        { rotulo: 'Compartilhar', classe: 'btn-primario', acao: (fechar) => fechar({ envio: compartilharArquivo(foto) }) },
      ],
    });
    URL.revokeObjectURL(url);
    if (!r) return;

    // registra mesmo que o compartilhamento seja cancelado
    const momento = agora();
    p.fotos.push({ nomeArquivo: nome, tiradaEm: momento, miniatura: mini });
    if (p.armaduraVerificada && !p.dataConferencia) p.dataConferencia = momento;
    fotosDaSessao.set(p.id, foto);
    await salvar(p);

    try {
      const res = await r.envio;
      if (res === 'cancelado') toast('Foto registrada. Para enviar, use "Compartilhar de novo".');
      else toast('Foto registrada');
    } catch (e) {
      alerta(`Foto registrada, mas o compartilhamento falhou: ${e.message}`, 'Erro');
    }
  }

  function compartilharNovamente(p) {
    const f = fotosDaSessao.get(p.id);
    if (!f) return;
    compartilharArquivo(f).catch((e) => alerta(`Erro ao compartilhar: ${e.message}`, 'Erro'));
  }

  // ---------- lista lateral ----------
  function abrirLista() {
    lista.aberta = true;
    gaveta.classList.add('aberta');
    gavetaFundo.hidden = false;
    renderLista();
  }

  function fecharLista() {
    lista.aberta = false;
    gaveta.classList.remove('aberta');
    gavetaFundo.hidden = true;
    buscaInput.blur();
  }

  function renderLista() {
    const r = resumo(pilares);
    const filtros = [['todos', 'Todos', r.total], ...ORDEM_STATUS.map((st) => [st, STATUS[st].rotulo, r[st]])];
    filtrosEl.replaceChildren(...filtros.map(([chave, rotulo, n]) => el('button', {
      type: 'button',
      class: `filtro${lista.filtro === chave ? ' ativo' : ''}`,
      onclick: () => {
        lista.filtro = chave;
        renderLista();
      },
    }, chave !== 'todos' ? el('span', { class: `ponto-st st-${chave}` }) : null, `${rotulo} ${n}`)));
    renderItensLista();
  }

  function renderItensLista() {
    const termo = limparNome(lista.busca);
    const visiveis = pilares
      .filter((p) => lista.filtro === 'todos' || statusDo(p) === lista.filtro)
      .filter((p) => !termo || limparNome(p.nome).includes(termo))
      .sort((a, b) => compararNatural(a.nome, b.nome));
    if (!visiveis.length) {
      itensEl.replaceChildren(el('li', { class: 'nota item-vazio' }, pilares.length ? 'Nenhum pilar encontrado.' : 'Nenhum pilar cadastrado. Use o modo Editar planta.'));
      return;
    }
    itensEl.replaceChildren(...visiveis.map((p) => {
      const st = statusDo(p);
      let sub = STATUS[st].rotulo;
      if (p.dataConferencia) sub += ` · ${fmtData(p.dataConferencia)}`;
      else if (checkSemFoto(p)) sub += ' · falta a foto';
      return el('li', {}, el('button', {
        type: 'button',
        class: 'item-pilar',
        onclick: () => {
          fecharLista();
          planta.centralizarEm(p.id, modo === 'conferencia' ? 0.25 : 0.5);
          if (modo === 'conferencia') abrirFicha(p.id);
        },
      },
      el('span', { class: `ponto-st grande st-${st}${checkSemFoto(p) ? ' sem-foto' : ''}` }),
      el('span', { class: 'item-texto' }, el('strong', {}, p.nome), el('small', {}, sub))));
    }));
  }

  // ---------- menu do teto ----------
  async function menuTeto() {
    const op = await escolher({
      titulo: teto.nome,
      opcoes: [
        { rotulo: 'Relatório (PDF)', valor: 'relatorio' },
        { rotulo: 'Imagem da planta (PNG)', valor: 'imagem' },
        { rotulo: 'Editar teto / trocar prancha', valor: 'editar' },
        { rotulo: 'Cancelar', valor: null },
      ],
    });
    if (op === 'editar') return ir(`#/teto/${teto.id}/editar`);
    if (op !== 'relatorio' && op !== 'imagem') return;
    const fim = carregando(op === 'relatorio' ? 'Gerando relatório…' : 'Gerando imagem…');
    let arquivo;
    try {
      arquivo = op === 'relatorio'
        ? await gerarRelatorio(teto, prancha, pilares)
        : await gerarImagemPlanta(teto, prancha, pilares);
    } catch (e) {
      console.error(e);
      alerta(`Não foi possível gerar o arquivo: ${e.message}`, 'Erro');
      return;
    } finally {
      fim();
    }
    try {
      await oferecerArquivo(arquivo, {
        titulo: op === 'relatorio' ? 'Relatório pronto' : 'Imagem pronta',
        texto: 'Envie para Arquivos (OneDrive), WhatsApp ou e-mail.',
      });
    } catch (e) {
      alerta(`Erro ao compartilhar: ${e.message}`, 'Erro');
    }
  }
}

// =====================================================================
// Inicialização
// =====================================================================

function iniciarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const faixa = document.getElementById('faixa-atualizacao');
  let recarregar = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recarregar) location.reload();
  });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const mostrar = () => { faixa.hidden = false; };
    if (reg.waiting && navigator.serviceWorker.controller) mostrar();
    reg.addEventListener('updatefound', () => {
      const novo = reg.installing;
      novo?.addEventListener('statechange', () => {
        if (novo.state === 'installed' && navigator.serviceWorker.controller) mostrar();
      });
    });
    faixa.querySelector('button').addEventListener('click', () => {
      recarregar = true;
      if (reg.waiting) reg.waiting.postMessage('pular-espera');
      else location.reload();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch((e) => console.warn('Service worker não registrado', e));
}

document.addEventListener('gesturestart', (e) => e.preventDefault());
navigator.storage?.persist?.().catch(() => {});
window.addEventListener('hashchange', rota);
iniciarServiceWorker();
rota();
