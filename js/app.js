// Telas e fluxo do app. Rotas: #/ · #/novo · #/teto/{id} · #/teto/{id}/editar
import * as db from './db.js';
import {
  el, uid, agora, STATUS, ORDEM_STATUS, statusDo, checkSemFoto, resumo, fmtData, fmtDataHora, diasDesde,
  tamanhoLegivel, normalizarNomePilar, limparNome, compararNatural, compartilharArquivo, dataISO,
  checksCompletos, conferenciaCompleta, rotuloStatus, chaveNomePilar,
} from './util.js';
import {
  icone, abrirModal, alerta, confirmar, pedirTexto, escolher, oferecerArquivo, toast, carregando,
} from './ui.js';
import { Planta, abrirPdf, renderizarMiniatura } from './planta.js';
import {
  escolherFoto, nomeDaFoto, prepararFoto, arquivoComNome, gerarMiniatura, dataProvavelDaFoto,
} from './foto.js';
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
    'Toque na planta para criar um pilar · toque no marcador para marcar SPDA, renomear ou excluir · toque e segure para mover');
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
    // pilares com check e sem foto continuam cinza (contados em "pendente"),
    // mas ganham um contador próprio para não serem esquecidos
    const semFoto = pilares.filter(checkSemFoto).length;
    const chips = ORDEM_STATUS.map((st) => el('span', { class: 'chip', title: STATUS[st].rotulo },
      el('span', { class: `ponto-st st-${st}` }), String(r[st])));
    if (semFoto) {
      chips.splice(1, 0, el('span', { class: 'chip chip-sem-foto', title: 'Check feito, falta a foto' },
        el('span', { class: 'ponto-st st-pendente sem-foto' }), icone('camera'), String(semFoto)));
    }
    if (r.spda) {
      chips.push(el('span', { class: 'chip chip-spda', title: 'Pilares com SPDA concluídos / total' },
        el('span', { class: 'selo-raio' }), `${r.spdaConcluido}/${r.spda}`));
    }
    resumoEl.replaceChildren(...chips, el('span', { class: 'chip chip-pct' }, `${r.pct}%`));
  }

  // Mantém a data da conferência coerente: é a data da foto mais recente quando
  // checks + foto estão completos, e some quando a conferência deixa de estar completa.
  function sincronizarConferencia(p) {
    if (!conferenciaCompleta(p)) {
      p.dataConferencia = null;
      return;
    }
    if (!p.dataConferencia) p.dataConferencia = p.fotos[p.fotos.length - 1].tiradaEm;
  }

  function definirSpda(p, valor) {
    p.spda = valor;
    if (!valor) Object.assign(p, { rebarVerificado: false, rebarEm: null });
    sincronizarConferencia(p);
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
    // "P01" e "P1" contam como o mesmo pilar
    const chave = chaveNomePilar(nome);
    const outro = pilares.find((p) => p.id !== ignorarId && chaveNomePilar(p.nome) === chave);
    if (outro) return `Já existe o pilar ${outro.nome} neste teto.`;
    return null;
  }

  // Nome + opção SPDA. Resolve { nome, spda } ou null.
  function pedirNomePilar({ titulo, rotuloOk, valor = '', spda = false, ignorarId = null }) {
    const input = el('input', {
      class: 'campo', type: 'text', value: valor, placeholder: 'Ex.: P14',
      autocapitalize: 'characters', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'done',
    });
    const caixaSpda = el('input', { type: 'checkbox', class: 'caixa-spda', checked: spda });
    const erro = el('p', { class: 'erro', hidden: true });
    const enviar = (fechar) => {
      const msg = validarNome(input.value, ignorarId);
      if (msg) {
        erro.textContent = msg;
        erro.hidden = false;
        return;
      }
      fechar({ nome: normalizarNomePilar(input.value), spda: caixaSpda.checked });
    };
    return abrirModal({
      titulo,
      corpo: el('div', { class: 'modal-corpo' },
        el('label', { class: 'rotulo-campo' }, el('span', {}, 'Nome do pilar'), input, erro),
        el('label', { class: 'opcao-spda' }, caixaSpda, el('span', { class: 'selo-raio' }),
          el('span', {}, el('strong', {}, 'Pilar com SPDA'), el('small', {}, 'Rebar conforme projeto de SPDA')))),
      botoes: [
        { rotulo: 'Cancelar', valor: null },
        { rotulo: rotuloOk, classe: 'btn-primario', acao: enviar },
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

  async function criarPilar(fx, fy) {
    const r = await pedirNomePilar({ titulo: 'Novo pilar', rotuloOk: 'Salvar' });
    if (!r) return;
    const p = {
      id: uid(), tetoId: teto.id, nome: r.nome, x: fx, y: fy, spda: r.spda,
      armaduraVerificada: false, armaduraEm: null, rebarVerificado: false, rebarEm: null,
      fotos: [], dataConferencia: null, uploadOneDrive: false, uploadEm: null, criadoEm: agora(),
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
        { rotulo: p.spda ? 'Remover SPDA' : 'Marcar como SPDA', valor: 'spda' },
        { rotulo: 'Renomear', valor: 'renomear' },
        { rotulo: 'Excluir', valor: 'excluir', classe: 'btn-texto-perigo' },
        { rotulo: 'Cancelar', valor: null },
      ],
    });
    if (op === 'spda') {
      if (p.spda && p.rebarVerificado) {
        const ok = await confirmar(`O ${p.nome} já tem o check do rebar SPDA. Remover o SPDA apaga esse check.`,
          { titulo: 'Remover SPDA', rotuloOk: 'Remover', perigo: true });
        if (!ok) return;
      }
      definirSpda(p, !p.spda);
      await salvar(p);
      toast(p.spda ? `${p.nome} marcado como SPDA` : `SPDA removido do ${p.nome}`);
    } else if (op === 'renomear') {
      const r = await pedirNomePilar({ titulo: 'Editar pilar', rotuloOk: 'Salvar', valor: p.nome, spda: !!p.spda, ignorarId: p.id });
      if (!r) return;
      p.nome = r.nome;
      if (r.spda !== !!p.spda) definirSpda(p, r.spda);
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
    const podeUpload = conferenciaCompleta(p);

    const faltas = [];
    if (!p.armaduraVerificada) faltas.push('armadura');
    if (p.spda && !p.rebarVerificado) faltas.push('rebar SPDA');
    if (!p.fotos.length) faltas.push('foto');
    let situacao;
    if (p.dataConferencia) situacao = `Conferido em ${fmtDataHora(p.dataConferencia)}`;
    else if (faltas.length === (p.spda ? 3 : 2)) situacao = 'Ainda não conferido';
    else situacao = `Falta: ${faltas.join(', ')}`;

    let blocoFoto;
    if (!ultima) {
      blocoFoto = el('div', { class: 'bloco-foto' },
        el('button', { type: 'button', class: 'btn btn-primario btn-grande', onclick: () => fluxoFoto(p) },
          icone('camera'), 'Tirar foto'),
        el('button', { type: 'button', class: 'btn', onclick: () => fluxoFoto(p, { carregar: true }) },
          icone('galeria'), 'Carregar foto existente'));
    } else {
      const url = ultima.miniatura ? URL.createObjectURL(new Blob([ultima.miniatura], { type: 'image/jpeg' })) : null;
      if (url) urlsFicha.push(url);
      const naSessao = fotosDaSessao.has(p.id);
      blocoFoto = el('div', { class: 'bloco-foto' },
        el('div', { class: 'foto-linha' },
          url ? el('img', { class: 'miniatura', src: url, alt: `Miniatura da foto de ${p.nome}` }) : el('div', { class: 'miniatura' }),
          el('div', { class: 'foto-info' },
            el('div', { class: 'nome-arquivo' }, ultima.nomeArquivo),
            el('small', {}, fmtDataHora(ultima.tiradaEm) + (ultima.carregada ? ' · carregada' : '')),
            p.fotos.length > 1
              ? el('details', { class: 'historico' },
                el('summary', {}, `${p.fotos.length} fotos no histórico`),
                el('ul', {}, p.fotos.map((f) => el('li', {},
                  `${f.nomeArquivo} · ${fmtDataHora(f.tiradaEm)}${f.carregada ? ' · carregada' : ''}`))))
              : null)),
        el('div', { class: 'foto-acoes' },
          el('button', { type: 'button', class: 'btn', onclick: () => fluxoFoto(p) }, icone('camera'), 'Nova foto'),
          el('button', { type: 'button', class: 'btn', onclick: () => fluxoFoto(p, { carregar: true }) }, icone('galeria'), 'Carregar'),
          naSessao ? el('button', { type: 'button', class: 'btn', onclick: () => compartilharNovamente(p) }, 'Compartilhar de novo') : null,
          el('button', { type: 'button', class: 'btn btn-texto-perigo', onclick: () => excluirUltimaFoto(p) }, 'Excluir foto')),
        naSessao ? null : el('p', { class: 'nota' },
          'O app guarda só a miniatura. A foto original está no OneDrive.'));
    }

    const passos = [
      linhaCheck({
        rotulo: 'Armadura verificada',
        marcado: p.armaduraVerificada,
        sub: p.armaduraEm ? fmtDataHora(p.armaduraEm) : null,
        aoTocar: () => alternarArmadura(p),
      }),
      p.spda
        ? linhaCheck({
          rotulo: 'Rebar SPDA instalado conforme projeto',
          marcado: !!p.rebarVerificado,
          sub: p.rebarEm ? fmtDataHora(p.rebarEm) : null,
          aoTocar: () => alternarRebar(p),
        })
        : null,
      blocoFoto,
      linhaCheck({
        rotulo: 'Upload no OneDrive feito',
        marcado: p.uploadOneDrive,
        desabilitado: !podeUpload && !p.uploadOneDrive,
        sub: p.uploadOneDrive ? fmtDataHora(p.uploadEm) : (podeUpload ? null : 'Disponível após os checks e a foto'),
        aoTocar: () => alternarUpload(p),
      }),
    ].filter(Boolean);

    ficha.replaceChildren(
      el('div', { class: 'ficha-cabeca' },
        el('h2', {}, p.nome),
        el('span', { class: `pilula st-${st}${p.spda && st === 'concluido' ? ' spda-concluido' : ''}` }, rotuloStatus(p)),
        p.spda ? el('span', { class: 'pilula spda' }, el('span', { class: 'selo-raio' }), 'SPDA') : null,
        el('button', { type: 'button', class: 'btn-icone', 'aria-label': 'Fechar ficha', onclick: fecharFicha }, icone('fechar'))),
      el('p', { class: 'situacao' }, situacao),
      ...passos.map((conteudo, i) => el('div', { class: 'passo' }, el('span', { class: 'num-passo' }, String(i + 1)), conteudo)));
    ficha.hidden = false;
  }

  // Desmarcar um check desfaz a conferência: apaga a data e desmarca o upload.
  async function desfazerCheck(p, rotulo, campos) {
    const ok = await confirmar(
      `Desmarcar ${rotulo} do ${p.nome}? Isso apaga a data da conferência e desmarca o upload.`,
      { titulo: 'Desfazer conferência', rotuloOk: 'Desmarcar', perigo: true },
    );
    if (!ok) return false;
    Object.assign(p, campos, { uploadOneDrive: false, uploadEm: null });
    sincronizarConferencia(p);
    return true;
  }

  async function alternarArmadura(p) {
    if (!p.armaduraVerificada) {
      p.armaduraVerificada = true;
      p.armaduraEm = agora();
      // a conferência vale pela data da foto (relevante para fotos antigas carregadas)
      sincronizarConferencia(p);
    } else if (!(await desfazerCheck(p, 'a armadura', { armaduraVerificada: false, armaduraEm: null }))) {
      return;
    }
    await salvar(p);
  }

  async function alternarRebar(p) {
    if (!p.rebarVerificado) {
      p.rebarVerificado = true;
      p.rebarEm = agora();
      sincronizarConferencia(p);
    } else if (!(await desfazerCheck(p, 'o rebar SPDA', { rebarVerificado: false, rebarEm: null }))) {
      return;
    }
    await salvar(p);
  }

  async function alternarUpload(p) {
    if (!p.uploadOneDrive) {
      if (!conferenciaCompleta(p)) return;
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
    if (!p.fotos.length) Object.assign(p, { uploadOneDrive: false, uploadEm: null });
    sincronizarConferencia(p);
    await salvar(p);
  }

  // ---------- fluxo da foto ----------
  // carregar: false = câmera (data de agora); true = foto já existente (galeria/Arquivos),
  // com a data lida da própria foto e editável, porque ela vira a data do arquivo e da conferência.
  async function fluxoFoto(p, { carregar = false } = {}) {
    const original = await escolherFoto({ camera: !carregar });
    if (!original) return;
    const fim = carregando(carregar ? 'Lendo foto…' : 'Preparando foto…');
    let dados;
    let mini;
    let provavel = null;
    try {
      if (carregar) provavel = await dataProvavelDaFoto(original);
      dados = await prepararFoto(original);
      mini = await gerarMiniatura(dados);
    } catch (e) {
      alerta(`Não foi possível ler a foto: ${e.message}`, 'Erro');
      return;
    } finally {
      fim();
    }

    let data = provavel ? provavel.data : new Date();
    const nomeEl = el('div', { class: 'nome-arquivo' });
    const atualizarNome = () => { nomeEl.textContent = nomeDaFoto(teto, p, dataISO(data)); };
    atualizarNome();

    let blocoData = null;
    if (carregar) {
      const campo = el('input', { class: 'campo', type: 'date', value: dataISO(data), max: dataISO() });
      campo.addEventListener('change', () => {
        if (!campo.value) return;
        const [a, m, d] = campo.value.split('-').map(Number);
        // mantém a hora original quando a data não muda
        data = campo.value === dataISO(provavel.data) ? provavel.data : new Date(a, m - 1, d, 12, 0, 0);
        atualizarNome();
      });
      blocoData = el('label', { class: 'rotulo-campo' },
        el('span', {}, `Data da foto (${provavel.origem})`), campo);
    }

    const url = URL.createObjectURL(dados);
    const r = await abrirModal({
      titulo: carregar ? `Carregar foto · ${p.nome}` : `Foto do pilar ${p.nome}`,
      classe: 'modal-foto',
      corpo: el('div', {},
        el('img', { class: 'previa-foto', src: url, alt: 'Prévia da foto' }),
        blocoData,
        nomeEl,
        p.spda ? el('p', { class: 'aviso-spda' }, el('span', { class: 'selo-raio' }),
          'Pilar com SPDA: a foto deve mostrar o rebar instalado.') : null,
        el('p', { class: 'orientacao' },
          'Use "Salvar em Arquivos" (pasta do OneDrive) ou o app do OneDrive. ',
          el('strong', {}, '"Salvar Imagem" perde o nome do arquivo.'),
          carregar ? ' Se a foto já está no OneDrive, use "Só registrar".' : null)),
      botoes: [
        { rotulo: 'Descartar', valor: null },
        carregar
          ? { rotulo: 'Só registrar', acao: (fechar) => fechar({ foto: arquivoComNome(dados, nomeEl.textContent), envio: null }) }
          : null,
        // o share precisa sair dentro deste toque, antes de qualquer await
        {
          rotulo: 'Compartilhar',
          classe: 'btn-primario',
          acao: (fechar) => {
            const foto = arquivoComNome(dados, nomeEl.textContent);
            fechar({ foto, envio: compartilharArquivo(foto) });
          },
        },
      ].filter(Boolean),
    });
    URL.revokeObjectURL(url);
    if (!r) return;

    // registra mesmo que o compartilhamento seja cancelado
    const momento = agora();
    const registro = { nomeArquivo: r.foto.name, tiradaEm: carregar ? data.toISOString() : momento, miniatura: mini };
    if (carregar) Object.assign(registro, { carregada: true, registradaEm: momento });
    p.fotos.push(registro);
    // a última foto da lista é sempre a mais recente
    p.fotos.sort((a, b) => a.tiradaEm.localeCompare(b.tiradaEm));
    sincronizarConferencia(p);
    if (p.fotos[p.fotos.length - 1] === registro) fotosDaSessao.set(p.id, r.foto);
    await salvar(p);

    if (!r.envio) {
      toast('Foto registrada');
      return;
    }
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
    filtros.splice(2, 0, ['semfoto', 'Falta foto', pilares.filter(checkSemFoto).length]);
    if (r.spda) filtros.push(['spda', 'SPDA', r.spda]);
    const ponto = (chave) => {
      if (chave === 'todos') return null;
      if (chave === 'semfoto') return el('span', { class: 'ponto-st st-pendente sem-foto' });
      if (chave === 'spda') return el('span', { class: 'selo-raio' });
      return el('span', { class: `ponto-st st-${chave}` });
    };
    filtrosEl.replaceChildren(...filtros.map(([chave, rotulo, n]) => el('button', {
      type: 'button',
      class: `filtro${lista.filtro === chave ? ' ativo' : ''}`,
      onclick: () => {
        lista.filtro = chave;
        renderLista();
      },
    }, ponto(chave), `${rotulo} ${n}`)));
    renderItensLista();
  }

  function renderItensLista() {
    const termo = limparNome(lista.busca);
    const visiveis = pilares
      .filter((p) => {
        if (lista.filtro === 'todos') return true;
        if (lista.filtro === 'semfoto') return checkSemFoto(p);
        if (lista.filtro === 'spda') return !!p.spda;
        return statusDo(p) === lista.filtro;
      })
      .filter((p) => !termo || limparNome(p.nome).includes(termo))
      .sort((a, b) => compararNatural(a.nome, b.nome));
    if (!visiveis.length) {
      itensEl.replaceChildren(el('li', { class: 'nota item-vazio' }, pilares.length ? 'Nenhum pilar encontrado.' : 'Nenhum pilar cadastrado. Use o modo Editar planta.'));
      return;
    }
    itensEl.replaceChildren(...visiveis.map((p) => {
      const st = statusDo(p);
      let sub = rotuloStatus(p);
      if (p.dataConferencia) sub += ` · ${fmtData(p.dataConferencia)}`;
      else if (checkSemFoto(p)) sub += ' · falta a foto';
      else if (p.spda && p.armaduraVerificada && !p.rebarVerificado) sub += ' · falta o rebar';
      return el('li', {}, el('button', {
        type: 'button',
        class: 'item-pilar',
        onclick: () => {
          fecharLista();
          planta.centralizarEm(p.id, modo === 'conferencia' ? 0.25 : 0.5);
          if (modo === 'conferencia') abrirFicha(p.id);
        },
      },
      el('span', { class: `ponto-st grande st-${st}${p.spda && st === 'concluido' ? ' st-spda' : ''}${checkSemFoto(p) ? ' sem-foto' : ''}` }),
      el('span', { class: 'item-texto' },
        el('strong', {}, p.nome, p.spda ? el('span', { class: 'selo-raio selo-lista', title: 'SPDA' }) : null),
        el('small', {}, sub))));
    }));
  }

  // ---------- SPDA por lista ----------
  // Cola a lista do projeto de SPDA (ex.: "P01, P6, P4") e marca os pilares deste teto.
  // "P01" e "P1" contam como o mesmo pilar. Só acrescenta: não desmarca quem não está na lista.
  async function marcarSpdaPorLista() {
    const campo = el('textarea', {
      class: 'campo', rows: '4', placeholder: 'P01, P6, P4, P2, P22…',
      autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false',
    });
    const texto = await abrirModal({
      titulo: 'Marcar pilares SPDA por lista',
      corpo: el('label', { class: 'rotulo-campo' },
        el('span', {}, `Nomes dos pilares com SPDA em ${teto.codigo}, separados por vírgula, espaço ou linha`), campo),
      botoes: [
        { rotulo: 'Cancelar', valor: null },
        { rotulo: 'Continuar', classe: 'btn-primario', acao: (fechar) => fechar(campo.value) },
      ],
      aoAbrir: () => campo.focus(),
    });
    if (!texto || !texto.trim()) return;

    const nomes = [...new Set(texto.split(/[\s,;]+/).map((n) => n.trim()).filter(Boolean))];
    const encontrados = [];
    const naoEncontrados = [];
    for (const n of nomes) {
      const chave = chaveNomePilar(n);
      const p = pilares.find((x) => chaveNomePilar(x.nome) === chave);
      if (p) encontrados.push(p);
      else naoEncontrados.push(n.toUpperCase());
    }
    const novos = encontrados.filter((p) => !p.spda);
    const jaMarcados = encontrados.filter((p) => p.spda);
    if (!novos.length) {
      alerta(
        [
          jaMarcados.length ? `Já marcados como SPDA: ${jaMarcados.map((p) => p.nome).join(', ')}.` : null,
          naoEncontrados.length ? `Não encontrados neste teto: ${naoEncontrados.join(', ')}.` : null,
        ].filter(Boolean).join(' ') || 'Nenhum pilar da lista encontrado.',
        'SPDA',
      );
      return;
    }
    const ok = await abrirModal({
      titulo: 'Confirmar pilares SPDA',
      corpo: el('div', { class: 'modal-corpo' },
        el('p', {}, el('strong', {}, `Marcar ${novos.length} pilar(es): `), novos.map((p) => p.nome).sort(compararNatural).join(', ')),
        novos.some(conferenciaCompleta)
          ? el('p', { class: 'nota' }, 'Os que já estavam conferidos voltam para pendente até o check do rebar SPDA.')
          : null,
        jaMarcados.length ? el('p', { class: 'nota' }, `Já eram SPDA: ${jaMarcados.map((p) => p.nome).join(', ')}`) : null,
        naoEncontrados.length
          ? el('p', { class: 'erro' }, `Não encontrados neste teto: ${naoEncontrados.join(', ')}. Confira os nomes ou crie esses pilares no modo Editar planta.`)
          : null),
      botoes: [
        { rotulo: 'Cancelar', valor: false },
        { rotulo: 'Marcar', classe: 'btn-primario', valor: true },
      ],
    });
    if (!ok) return;
    for (const p of novos) {
      definirSpda(p, true);
      await salvar(p);
    }
    toast(`${novos.length} pilar(es) marcados como SPDA`);
  }

  // ---------- menu do teto ----------
  async function menuTeto() {
    const op = await escolher({
      titulo: teto.nome,
      opcoes: [
        { rotulo: 'Relatório (PDF)', valor: 'relatorio' },
        { rotulo: 'Imagem da planta (PNG)', valor: 'imagem' },
        { rotulo: 'Marcar pilares SPDA por lista', valor: 'spda' },
        { rotulo: 'Editar teto / trocar prancha', valor: 'editar' },
        { rotulo: 'Cancelar', valor: null },
      ],
    });
    if (op === 'editar') return ir(`#/teto/${teto.id}/editar`);
    if (op === 'spda') return marcarSpdaPorLista();
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
