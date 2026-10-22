// Relatório por teto em PDF (jsPDF + autotable), fonte Carlito embutida.
import {
  STATUS, statusDo, resumo, fmtData, fmtDataHora, dataISO, compararNatural, bufParaBase64, hexParaRgb,
} from './util.js';

let fontes;

async function carregarFontes() {
  if (!fontes) {
    const [regular, negrito] = await Promise.all(
      ['fonts/Carlito-Regular.ttf', 'fonts/Carlito-Bold.ttf'].map((u) => fetch(u).then((r) => {
        if (!r.ok) throw new Error(`fonte não encontrada (${u})`);
        return r.arrayBuffer();
      })),
    );
    fontes = { regular: bufParaBase64(regular), negrito: bufParaBase64(negrito) };
  }
  return fontes;
}

const CINZA_ESCURO = [64, 64, 64];
const CINZA_TEXTO = [40, 40, 40];
const CINZA_MEDIO = [110, 110, 110];
const CINZA_LINHA = [200, 200, 200];
const CINZA_CLARO = [244, 244, 244];

export async function gerarRelatorio(teto, prancha, pilares) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const f = await carregarFontes();
  doc.addFileToVFS('Carlito-Regular.ttf', f.regular);
  doc.addFont('Carlito-Regular.ttf', 'Carlito', 'normal');
  doc.addFileToVFS('Carlito-Bold.ttf', f.negrito);
  doc.addFont('Carlito-Bold.ttf', 'Carlito', 'bold');

  const L = 210;
  const M = 15;
  const emissao = new Date().toISOString();

  // cabeçalho
  doc.setFont('Carlito', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...CINZA_TEXTO);
  doc.text('Residencial Monte Fuji', M, 20);
  doc.setFont('Carlito', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(...CINZA_MEDIO);
  doc.text('Controle de Pilares — As-Built da Armação', M, 26);
  doc.setDrawColor(...CINZA_LINHA);
  doc.setLineWidth(0.3);
  doc.line(M, 30, L - M, 30);

  const info = [
    ['Teto', `${teto.nome} (${teto.codigo})`],
    ['Prancha', teto.referenciaPrancha || '—'],
    ['Arquivo', `${prancha?.nome || '—'} · página ${teto.pagina}`],
    ['Emissão', fmtDataHora(emissao)],
  ];
  let y = 37;
  doc.setFontSize(10);
  for (const [rotulo, valor] of info) {
    doc.setFont('Carlito', 'bold');
    doc.setTextColor(...CINZA_TEXTO);
    doc.text(rotulo, M, y);
    doc.setFont('Carlito', 'normal');
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
    doc.setFont('Carlito', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...CINZA_MEDIO);
    doc.text(c.rotulo, x + 4, y + 5);
    doc.setFont('Carlito', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(...CINZA_TEXTO);
    doc.text(String(c.valor), x + 4, y + 12.5);
  });
  y += alt + 7;

  // tabela
  const linhas = [...pilares]
    .sort((a, b) => compararNatural(a.nome, b.nome))
    .map((p) => {
      const st = statusDo(p);
      const ultima = p.fotos?.[p.fotos.length - 1];
      return {
        st,
        celulas: [
          p.nome,
          STATUS[st].rotulo,
          p.dataConferencia ? fmtData(p.dataConferencia) : '—',
          ultima ? ultima.nomeArquivo : '—',
          p.uploadOneDrive ? fmtData(p.uploadEm) : '—',
        ],
      };
    });

  doc.autoTable({
    startY: y,
    margin: { left: M, right: M, bottom: 18 },
    head: [['Pilar', 'Status', 'Data da conferência', 'Nome da foto', 'Upload no OneDrive']],
    body: linhas.map((l) => l.celulas),
    styles: {
      font: 'Carlito', fontSize: 9, textColor: CINZA_TEXTO, cellPadding: 1.8,
      lineColor: CINZA_LINHA, lineWidth: 0.1, overflow: 'linebreak',
    },
    headStyles: { font: 'Carlito', fontStyle: 'bold', fillColor: CINZA_ESCURO, textColor: 255 },
    alternateRowStyles: { fillColor: CINZA_CLARO },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 20 },
      1: { cellWidth: 25, cellPadding: { left: 6.5, right: 1.8, top: 1.8, bottom: 1.8 } },
      2: { cellWidth: 28 },
      4: { cellWidth: 28 },
    },
    didDrawCell: (d) => {
      if (d.section !== 'body' || d.column.index !== 1) return;
      const cor = STATUS[linhas[d.row.index].st].cor;
      doc.setFillColor(...hexParaRgb(cor));
      doc.rect(d.cell.x + 2, d.cell.y + d.cell.height / 2 - 1.4, 2.8, 2.8, 'F');
    },
  });

  // legenda dos status
  let yl = (doc.lastAutoTable?.finalY || y) + 7;
  if (!linhas.length) {
    doc.setFont('Carlito', 'normal');
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
    ['pendente', 'sem check da armadura ou sem foto'],
    ['conferido', 'armadura verificada e foto tirada; upload no OneDrive pendente'],
    ['concluido', 'armadura verificada, foto tirada e upload no OneDrive feito'],
  ];
  doc.setFontSize(8.5);
  for (const [st, texto] of legenda) {
    doc.setFillColor(...hexParaRgb(STATUS[st].cor));
    doc.rect(M, yl - 2.4, 2.8, 2.8, 'F');
    doc.setFont('Carlito', 'bold');
    doc.setTextColor(...CINZA_TEXTO);
    doc.text(STATUS[st].rotulo, M + 4.5, yl);
    doc.setFont('Carlito', 'normal');
    doc.setTextColor(...CINZA_MEDIO);
    doc.text(`— ${texto}`, M + 22, yl);
    yl += 4.8;
  }

  // rodapé
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setDrawColor(...CINZA_LINHA);
    doc.line(M, 283, L - M, 283);
    doc.setFont('Carlito', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...CINZA_MEDIO);
    doc.text(`Residencial Monte Fuji · ${teto.codigo} · emitido em ${fmtDataHora(emissao)}`, M, 288);
    doc.text(`Página ${i} de ${total}`, L - M, 288, { align: 'right' });
  }

  const nome = `MF_${teto.codigo}_Relatorio_${dataISO()}.pdf`;
  return new File([doc.output('blob')], nome, { type: 'application/pdf' });
}
