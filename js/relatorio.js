// Relatório por teto em PDF (jsPDF + autotable), na identidade da Construtora Arco-Íris-Mar:
// logo, azul-marinho e dourado; Poppins nos títulos e Open Sans no texto (embutidas).
import {
  STATUS, statusDo, resumo, fmtData, fmtDataHora, dataISO, compararNatural, bufParaBase64, hexParaRgb,
  corDoPilar, COR_SPDA_CONCLUIDO,
} from './util.js';

const ARQUIVOS_FONTE = {
  regular: 'fonts/OpenSans-Regular.ttf',
  negrito: 'fonts/OpenSans-Bold.ttf',
  titulo: 'fonts/Poppins-SemiBold.ttf',
};
const LOGO = 'assets/logo-arcoirismar.png';
const LOGO_PROPORCAO = 1250 / 190; // largura / altura do arquivo da logo

let recursos;

async function baixar(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`arquivo não encontrado (${url})`);
  return r.arrayBuffer();
}

// A logo é PNG com transparência, que o jsPDF guarda sem compressão (~1 MB).
// Reduz e converte para JPEG sobre fundo branco (~20 KB).
async function logoJpeg() {
  const img = new Image();
  img.src = LOGO;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = 700;
  c.height = Math.round((700 * img.naturalHeight) / img.naturalWidth);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const dados = c.toDataURL('image/jpeg', 0.92);
  c.width = 0;
  c.height = 0;
  return dados;
}

async function carregarRecursos() {
  if (!recursos) {
    const [regular, negrito, titulo, logo] = await Promise.all([
      baixar(ARQUIVOS_FONTE.regular), baixar(ARQUIVOS_FONTE.negrito), baixar(ARQUIVOS_FONTE.titulo), logoJpeg(),
    ]);
    recursos = {
      regular: bufParaBase64(regular),
      negrito: bufParaBase64(negrito),
      titulo: bufParaBase64(titulo),
      logo,
    };
  }
  return recursos;
}

const AZUL = [11, 66, 109];
const OURO = [195, 165, 89];
const CINZA_TEXTO = [35, 35, 35];
const CINZA_MEDIO = [100, 100, 100];
const CINZA_LINHA = [221, 216, 204];
const CINZA_CLARO = [247, 246, 243];

export async function gerarRelatorio(teto, prancha, pilares) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const f = await carregarRecursos();
  doc.addFileToVFS('OpenSans-Regular.ttf', f.regular);
  doc.addFont('OpenSans-Regular.ttf', 'OpenSans', 'normal');
  doc.addFileToVFS('OpenSans-Bold.ttf', f.negrito);
  doc.addFont('OpenSans-Bold.ttf', 'OpenSans', 'bold');
  doc.addFileToVFS('Poppins-SemiBold.ttf', f.titulo);
  doc.addFont('Poppins-SemiBold.ttf', 'Poppins', 'normal');

  const L = 210;
  const M = 15;
  const emissao = new Date().toISOString();

  // cabeçalho: logo à direita, título à esquerda, filete dourado
  const logoL = 52;
  doc.addImage(f.logo, 'JPEG', L - M - logoL, 12, logoL, logoL / LOGO_PROPORCAO);
  doc.setFont('Poppins', 'normal');
  doc.setFontSize(15);
  doc.setTextColor(...AZUL);
  doc.text('Residencial Monte Fuji', M, 18);
  doc.setFont('OpenSans', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...CINZA_MEDIO);
  doc.text('Controle de Pilares — As-Built da Armação', M, 24);
  doc.setDrawColor(...OURO);
  doc.setLineWidth(0.8);
  doc.line(M, 29, L - M, 29);

  const info = [
    ['Teto', `${teto.nome} (${teto.codigo})`],
    ['Prancha', teto.referenciaPrancha || '—'],
    ['Arquivo', `${prancha?.nome || '—'} · página ${teto.pagina}`],
    ['Emissão', fmtDataHora(emissao)],
  ];
  let y = 37;
  doc.setFontSize(10);
  for (const [rotulo, valor] of info) {
    doc.setFont('OpenSans', 'bold');
    doc.setTextColor(...AZUL);
    doc.text(rotulo, M, y);
    doc.setFont('OpenSans', 'normal');
    doc.setTextColor(...CINZA_TEXTO);
    doc.text(doc.splitTextToSize(valor, L - 2 * M - 22)[0], M + 22, y);
    y += 5.5;
  }

  // resumo
  const r = resumo(pilares);
  const caixas = [
    { rotulo: 'Total de pilares', valor: r.total },
    { rotulo: 'Pendentes', valor: r.pendente, cor: STATUS.pendente.cor },
    { rotulo: 'Conferidos', valor: r.conferido, cor: STATUS.conferido.cor },
    { rotulo: 'Concluídos', valor: r.concluido, cor: STATUS.concluido.cor },
    { rotulo: '% concluído', valor: `${r.pct}%` },
  ];
  y += 2;
  const gap = 3;
  const larg = (L - 2 * M - gap * (caixas.length - 1)) / caixas.length;
  const alt = 16;
  caixas.forEach((c, i) => {
    const x = M + i * (larg + gap);
    doc.setFillColor(...CINZA_CLARO);
    doc.setDrawColor(...CINZA_LINHA);
    doc.rect(x, y, larg, alt, 'FD');
    if (c.cor) {
      doc.setFillColor(...hexParaRgb(c.cor));
      doc.rect(x, y, 1.6, alt, 'F');
    }
    doc.setFont('OpenSans', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...CINZA_MEDIO);
    doc.text(c.rotulo, x + 4, y + 5);
    doc.setFont('Poppins', 'normal');
    doc.setFontSize(15);
    doc.setTextColor(...AZUL);
    doc.text(String(c.valor), x + 4, y + 12.5);
  });
  y += alt + 6;

  // resumo SPDA
  const temSpda = r.spda > 0;
  if (temSpda) {
    const rebarOk = pilares.filter((p) => p.spda && p.rebarVerificado).length;
    doc.setFillColor(...hexParaRgb(COR_SPDA_CONCLUIDO));
    doc.rect(M, y - 3, 2.8, 2.8, 'F');
    const titulo = `Pilares com SPDA: ${r.spda}`;
    doc.setFont('OpenSans', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...AZUL);
    doc.text(titulo, M + 4.5, y - 0.6);
    const larguraTitulo = doc.getTextWidth(titulo);
    doc.setFont('OpenSans', 'normal');
    doc.setTextColor(...CINZA_TEXTO);
    doc.text(`·  rebar conferido: ${rebarOk}  ·  concluídos (azul): ${r.spdaConcluido}`, M + 4.5 + larguraTitulo + 2, y - 0.6);
    y += 6;
  }

  // tabela
  const linhas = [...pilares]
    .sort((a, b) => compararNatural(a.nome, b.nome))
    .map((p) => {
      const st = statusDo(p);
      const ultima = p.fotos?.[p.fotos.length - 1];
      const celulas = [
        p.nome,
        STATUS[st].rotulo,
        p.dataConferencia ? fmtData(p.dataConferencia) : '—',
        ultima ? ultima.nomeArquivo : '—',
      ];
      if (temSpda) celulas.push(p.spda ? (p.rebarVerificado ? 'OK' : 'Pendente') : '—');
      celulas.push(p.uploadOneDrive ? fmtData(p.uploadEm) : '—');
      return { cor: corDoPilar(p), celulas };
    });

  const cabecalho = ['Pilar', 'Status', 'Data da conferência', 'Nome da foto'];
  if (temSpda) cabecalho.push('SPDA (rebar)');
  cabecalho.push('Upload no OneDrive');
  const larguras = temSpda
    ? { 0: { fontStyle: 'bold', cellWidth: 16 }, 2: { cellWidth: 25 }, 4: { cellWidth: 23 }, 5: { cellWidth: 23 } }
    : { 0: { fontStyle: 'bold', cellWidth: 20 }, 2: { cellWidth: 28 }, 4: { cellWidth: 28 } };

  doc.autoTable({
    startY: y,
    margin: { left: M, right: M, bottom: 18 },
    head: [cabecalho],
    body: linhas.map((l) => l.celulas),
    styles: {
      font: 'OpenSans', fontSize: 9, textColor: CINZA_TEXTO, cellPadding: 1.8,
      lineColor: CINZA_LINHA, lineWidth: 0.1, overflow: 'linebreak',
    },
    headStyles: { font: 'OpenSans', fontStyle: 'bold', fillColor: AZUL, textColor: 255 },
    alternateRowStyles: { fillColor: CINZA_CLARO },
    columnStyles: {
      ...larguras,
      1: { cellWidth: 25, cellPadding: { left: 6.5, right: 1.8, top: 1.8, bottom: 1.8 } },
    },
    didParseCell: (d) => {
      // coluna SPDA: "OK" em azul, "Pendente" em vermelho
      if (temSpda && d.section === 'body' && d.column.index === 4 && d.cell.raw !== '—') {
        d.cell.styles.textColor = d.cell.raw === 'OK' ? AZUL : [179, 38, 30];
        d.cell.styles.fontStyle = 'bold';
      }
    },
    didDrawCell: (d) => {
      if (d.section !== 'body' || d.column.index !== 1) return;
      const cor = linhas[d.row.index].cor;
      doc.setFillColor(...hexParaRgb(cor));
      doc.rect(d.cell.x + 2, d.cell.y + d.cell.height / 2 - 1.4, 2.8, 2.8, 'F');
    },
  });

  // legenda dos status
  let yl = (doc.lastAutoTable?.finalY || y) + 7;
  if (!linhas.length) {
    doc.setFont('OpenSans', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...CINZA_MEDIO);
    doc.text('Nenhum pilar cadastrado neste teto.', M, yl);
    yl += 7;
  }
  if (yl > 270) {
    doc.addPage();
    yl = 20;
  }
  const legenda = [
    [STATUS.pendente.cor, STATUS.pendente.rotulo, temSpda ? 'falta check (armadura/rebar) ou foto' : 'sem check da armadura ou sem foto'],
    [STATUS.conferido.cor, STATUS.conferido.rotulo, 'checks e foto feitos; upload no OneDrive pendente'],
    [STATUS.concluido.cor, STATUS.concluido.rotulo, 'armadura verificada, foto tirada e upload no OneDrive feito'],
  ];
  if (temSpda) {
    legenda.push([COR_SPDA_CONCLUIDO, 'Concluído SPDA', 'pilar com SPDA: armadura, rebar, foto e upload feitos']);
  }
  doc.setFontSize(8.5);
  for (const [cor, rotulo, texto] of legenda) {
    doc.setFillColor(...hexParaRgb(cor));
    doc.rect(M, yl - 2.4, 2.8, 2.8, 'F');
    doc.setFont('OpenSans', 'bold');
    doc.setTextColor(...CINZA_TEXTO);
    doc.text(rotulo, M + 4.5, yl);
    doc.setFont('OpenSans', 'normal');
    doc.setTextColor(...CINZA_MEDIO);
    doc.text(`— ${texto}`, M + 30, yl);
    yl += 4.8;
  }

  // rodapé
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setDrawColor(...OURO);
    doc.setLineWidth(0.5);
    doc.line(M, 283, L - M, 283);
    doc.setFont('OpenSans', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...CINZA_MEDIO);
    doc.text(`Construtora Arco-Íris-Mar · Residencial Monte Fuji · ${teto.codigo} · emitido em ${fmtDataHora(emissao)}`, M, 288);
    doc.text(`Página ${i} de ${total}`, L - M, 288, { align: 'right' });
  }

  const nome = `MF_${teto.codigo}_Relatorio_${dataISO()}.pdf`;
  return new File([doc.output('blob')], nome, { type: 'application/pdf' });
}
