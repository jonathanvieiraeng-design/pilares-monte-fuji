// PNG da planta com os pilares coloridos e uma faixa de legenda.
import { abrirPdf } from './planta.js';
import {
  STATUS, ORDEM_STATUS, statusDo, checkSemFoto, resumo, fmtData, dataISO, LIMITE_LADO, LIMITE_AREA,
} from './util.js';

const FONTE = 'Carlito, Calibri, Helvetica, Arial, sans-serif';

export async function gerarImagemPlanta(teto, prancha, pilares) {
  await Promise.all([document.fonts.load(`16px Carlito`), document.fonts.load(`bold 16px Carlito`)]);
  const pdf = await abrirPdf(prancha.pdf);
  const canvas = document.createElement('canvas');
  try {
    const pagina = await pdf.getPage(teto.pagina);
    const vp1 = pagina.getViewport({ scale: 1 });

    // dimensiona dentro dos limites de canvas do iOS, contando a faixa de legenda
    let escala = 3600 / Math.max(vp1.width, vp1.height);
    let w;
    let h;
    let faixa;
    for (;;) {
      w = Math.floor(vp1.width * escala);
      h = Math.floor(vp1.height * escala);
      faixa = Math.round(Math.max(150, w * 0.075));
      if (w <= LIMITE_LADO && h + faixa <= LIMITE_LADO && w * (h + faixa) <= LIMITE_AREA * 0.98) break;
      escala *= 0.95;
    }
    canvas.width = w;
    canvas.height = h + faixa;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h + faixa);
    await pagina.render({ canvasContext: ctx, viewport: pagina.getViewport({ scale: escala }) }).promise;

    // marcadores
    const r = Math.max(9, w * 0.0055);
    ctx.textBaseline = 'middle';
    for (const p of pilares) {
      const cx = p.x * w;
      const cy = p.y * h;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = STATUS[statusDo(p)].cor;
      ctx.fill();
      ctx.lineWidth = r * 0.28;
      ctx.strokeStyle = '#2B2B2B';
      ctx.setLineDash(checkSemFoto(p) ? [r * 0.5, r * 0.35] : []);
      if (checkSemFoto(p)) ctx.strokeStyle = '#C79A00';
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.font = `bold ${Math.round(r * 1.7)}px ${FONTE}`;
      ctx.lineJoin = 'round';
      ctx.lineWidth = r * 0.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.strokeText(p.nome, cx + r * 1.45, cy);
      ctx.fillStyle = '#1F1F1F';
      ctx.fillText(p.nome, cx + r * 1.45, cy);
    }

    // faixa de legenda
    const y0 = h;
    ctx.fillStyle = '#F2F2F2';
    ctx.fillRect(0, y0, w, faixa);
    ctx.fillStyle = '#BDBDBD';
    ctx.fillRect(0, y0, w, Math.max(2, faixa * 0.012));

    const m = faixa * 0.22;
    const t1 = faixa * 0.2;
    const t2 = faixa * 0.14;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#222222';
    ctx.font = `bold ${t1}px ${FONTE}`;
    ctx.fillText('Residencial Monte Fuji — Controle de Pilares (As-Built)', m, y0 + m + t1 * 0.8);
    ctx.fillStyle = '#4A4A4A';
    ctx.font = `${t2}px ${FONTE}`;
    const linha2 = `${teto.nome} (${teto.codigo})${teto.referenciaPrancha ? ` · Prancha ${teto.referenciaPrancha}` : ''}`;
    ctx.fillText(linha2, m, y0 + m + t1 + t2 * 1.4);
    ctx.fillText(`Emitido em ${fmtData(new Date().toISOString())}`, m, y0 + m + t1 + t2 * 2.9);

    // legenda das cores, alinhada à direita
    const res = resumo(pilares);
    const itens = ORDEM_STATUS.map((st) => `${STATUS[st].rotulo} (${res[st]})`);
    itens.push(`${res.pct}% concluído`);
    ctx.font = `bold ${t2}px ${FONTE}`;
    const raio = t2 * 0.42;
    const larguras = itens.map((t, i) => ctx.measureText(t).width + (i < 3 ? raio * 2 + t2 * 0.5 : 0));
    const espaco = t2 * 1.4;
    let x = w - m - larguras.reduce((a, b) => a + b, 0) - espaco * (itens.length - 1);
    const yc = y0 + faixa / 2 + t2 * 0.1;
    itens.forEach((texto, i) => {
      if (i < 3) {
        ctx.beginPath();
        ctx.arc(x + raio, yc - t2 * 0.32, raio, 0, Math.PI * 2);
        ctx.fillStyle = STATUS[ORDEM_STATUS[i]].cor;
        ctx.fill();
        ctx.lineWidth = Math.max(1, raio * 0.25);
        ctx.strokeStyle = '#2B2B2B';
        ctx.stroke();
        x += raio * 2 + t2 * 0.5;
      }
      ctx.fillStyle = '#222222';
      ctx.fillText(texto, x, yc);
      x += larguras[i] - (i < 3 ? raio * 2 + t2 * 0.5 : 0) + espaco;
    });

    const blob = await new Promise((resolve, rejeitar) => {
      canvas.toBlob((b) => (b ? resolve(b) : rejeitar(new Error('falha ao gerar a imagem'))), 'image/png');
    });
    return new File([blob], `MF_${teto.codigo}_Planta_${dataISO()}.png`, { type: 'image/png' });
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    pdf.destroy();
  }
}
