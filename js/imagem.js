// PNG da planta com os pilares coloridos e uma faixa de legenda na identidade da Arco-Íris-Mar.
import { abrirPdf } from './planta.js';
import {
  STATUS, ORDEM_STATUS, checkSemFoto, resumo, fmtData, dataISO, LIMITE_LADO, LIMITE_AREA,
  corDoPilar, COR_SPDA_CONCLUIDO,
} from './util.js';

// Selo de raio do pilar com SPDA: círculo azul-marinho com raio amarelo, centrado em (cx, cy).
function desenharSeloRaio(ctx, cx, cy, raio) {
  ctx.beginPath();
  ctx.arc(cx, cy, raio, 0, Math.PI * 2);
  ctx.fillStyle = '#0B426D';
  ctx.fill();
  ctx.lineWidth = Math.max(1, raio * 0.18);
  ctx.strokeStyle = '#FFFFFF';
  ctx.stroke();
  // mesmo desenho do ícone da tela (viewBox 24): M13.5 2 L5 13.5 h5.5 L9.5 22 L19 9.5 h-5.8 z
  const k = (raio * 1.5) / 24;
  const pts = [[13.5, 2], [5, 13.5], [10.5, 13.5], [9.5, 22], [19, 9.5], [13.2, 9.5]];
  ctx.beginPath();
  pts.forEach(([x, y], i) => {
    const px = cx + (x - 12) * k;
    const py = cy + (y - 12) * k;
    if (i) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  });
  ctx.closePath();
  ctx.fillStyle = '#F2C200';
  ctx.fill();
}

const FONTE = "'Open Sans', Helvetica, Arial, sans-serif";
const FONTE_TITULO = "Poppins, 'Open Sans', Helvetica, Arial, sans-serif";
const AZUL = '#0B426D';
const OURO = '#C3A559';

async function carregarLogo() {
  const img = new Image();
  img.src = 'assets/logo-arcoirismar.png';
  await img.decode();
  return img;
}

export async function gerarImagemPlanta(teto, prancha, pilares) {
  const [logo] = await Promise.all([
    carregarLogo(),
    document.fonts.load(`16px 'Open Sans'`),
    document.fonts.load(`bold 16px 'Open Sans'`),
    document.fonts.load(`600 16px Poppins`),
  ]);
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
      faixa = Math.round(Math.max(170, w * 0.085));
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
      ctx.fillStyle = corDoPilar(p);
      ctx.fill();
      ctx.lineWidth = r * 0.28;
      ctx.strokeStyle = '#2B2B2B';
      ctx.setLineDash(checkSemFoto(p) ? [r * 0.5, r * 0.35] : []);
      if (checkSemFoto(p)) ctx.strokeStyle = '#C79A00';
      ctx.stroke();
      ctx.setLineDash([]);

      // nome à direita; no pilar SPDA, o selo de raio vem antes do nome
      let xNome = cx + r * 1.45;
      if (p.spda) {
        desenharSeloRaio(ctx, cx + r * 0.75, cy - r * 1.35, r * 0.72);
        xNome += r * 0.3;
      }
      ctx.font = `bold ${Math.round(r * 1.7)}px ${FONTE}`;
      ctx.lineJoin = 'round';
      ctx.lineWidth = r * 0.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.strokeText(p.nome, xNome, cy);
      ctx.fillStyle = '#1F1F1F';
      ctx.fillText(p.nome, xNome, cy);
    }

    // faixa de legenda: fundo neutro quente, filete dourado, logo à direita
    const y0 = h;
    ctx.fillStyle = '#F7F6F3';
    ctx.fillRect(0, y0, w, faixa);
    ctx.fillStyle = OURO;
    ctx.fillRect(0, y0, w, Math.max(3, faixa * 0.03));

    const m = faixa * 0.16;
    const t1 = faixa * 0.2;
    const t2 = faixa * 0.13;
    const base1 = y0 + m + t1 * 0.85;
    const base2 = base1 + t2 * 1.7;
    const base3 = base2 + t2 * 1.5;

    const logoA = t1 * 1.25;
    const logoL = (logoA * logo.naturalWidth) / logo.naturalHeight;
    ctx.drawImage(logo, w - m - logoL, y0 + m * 0.9, logoL, logoA);

    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = AZUL;
    ctx.font = `600 ${t1}px ${FONTE_TITULO}`;
    ctx.fillText('Residencial Monte Fuji — Controle de Pilares (As-Built)', m, base1);
    ctx.fillStyle = '#4A4A4A';
    ctx.font = `${t2}px ${FONTE}`;
    const linha2 = `${teto.nome} (${teto.codigo})${teto.referenciaPrancha ? ` · Prancha ${teto.referenciaPrancha}` : ''}`;
    ctx.fillText(linha2, m, base2);
    ctx.fillText(`Emitido em ${fmtData(new Date().toISOString())}`, m, base3);

    // legenda das cores, alinhada à direita, abaixo da logo
    const res = resumo(pilares);
    const itens = ORDEM_STATUS.map((st) => ({
      cor: STATUS[st].cor,
      // com SPDA, o verde conta só os pilares comuns; os SPDA concluídos vão no azul
      texto: `${STATUS[st].rotulo} (${st === 'concluido' ? res.concluido - res.spdaConcluido : res[st]})`,
    }));
    if (res.spda) {
      itens.push({ cor: COR_SPDA_CONCLUIDO, texto: `Concluído SPDA (${res.spdaConcluido})` });
      itens.push({ selo: true, texto: `SPDA (${res.spda})` });
    }
    itens.push({ texto: `${res.pct}% concluído`, destaque: true });
    ctx.font = `bold ${t2}px ${FONTE}`;
    const raio = t2 * 0.42;
    const marca = raio * 2 + t2 * 0.5; // largura do símbolo + folga antes do texto
    const larguras = itens.map((it) => ctx.measureText(it.texto).width + (it.cor || it.selo ? marca : 0));
    const espaco = t2 * 1.4;
    let x = w - m - larguras.reduce((a, b) => a + b, 0) - espaco * (itens.length - 1);
    const yc = base3;
    itens.forEach((it, i) => {
      if (it.cor) {
        ctx.beginPath();
        ctx.arc(x + raio, yc - t2 * 0.32, raio, 0, Math.PI * 2);
        ctx.fillStyle = it.cor;
        ctx.fill();
        ctx.lineWidth = Math.max(1, raio * 0.25);
        ctx.strokeStyle = '#2B2B2B';
        ctx.stroke();
      } else if (it.selo) {
        desenharSeloRaio(ctx, x + raio, yc - t2 * 0.32, raio * 1.1);
      }
      ctx.font = `bold ${t2}px ${FONTE}`;
      ctx.fillStyle = it.destaque ? AZUL : '#232323';
      ctx.fillText(it.texto, x + (it.cor || it.selo ? marca : 0), yc);
      x += larguras[i] + espaco;
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
