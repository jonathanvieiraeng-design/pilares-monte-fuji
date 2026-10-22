// Câmera, nome do arquivo, conversão para JPEG e miniatura.
import { dataISO, limparNome, LIMITE_LADO, LIMITE_AREA } from './util.js';

// Abre a câmera traseira. Precisa ser chamada direto do toque do usuário.
export function escolherFoto() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment');
    input.style.display = 'none';
    document.body.append(input);
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      input.remove();
      resolve(f || null);
    });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    });
    input.click();
  });
}

// MF_T02_P14_2026-10-22.jpg; se já houver foto do pilar no mesmo dia, _02, _03…
export function nomeDaFoto(teto, pilar, data = dataISO()) {
  const base = `MF_${teto.codigo}_${limparNome(pilar.nome)}_${data}`;
  const comSufixo = new RegExp(`^${base}_(\\d{2,})\\.jpg$`);
  let maior = 0;
  for (const f of pilar.fotos || []) {
    if (f.nomeArquivo === `${base}.jpg`) maior = Math.max(maior, 1);
    const m = f.nomeArquivo.match(comSufixo);
    if (m) maior = Math.max(maior, Number(m[1]));
  }
  return maior === 0 ? `${base}.jpg` : `${base}_${String(maior + 1).padStart(2, '0')}.jpg`;
}

async function carregarImagem(blob) {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch (e) {
    URL.revokeObjectURL(url);
    throw new Error('formato de imagem não suportado');
  }
  return { img, liberar: () => URL.revokeObjectURL(url) };
}

function canvasParaBlob(canvas, tipo, qualidade) {
  return new Promise((resolve, rejeitar) => {
    canvas.toBlob((b) => (b ? resolve(b) : rejeitar(new Error('falha ao gerar imagem'))), tipo, qualidade);
  });
}

async function redimensionar(blob, ladoMax, qualidade) {
  const { img, liberar } = await carregarImagem(blob);
  try {
    const w0 = img.naturalWidth;
    const h0 = img.naturalHeight;
    const k = Math.min(1, ladoMax / w0, ladoMax / h0, Math.sqrt((LIMITE_AREA * 0.98) / (w0 * h0)));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w0 * k));
    c.height = Math.max(1, Math.round(h0 * k));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const saida = await canvasParaBlob(c, 'image/jpeg', qualidade);
    c.width = 0;
    c.height = 0;
    return saida;
  } finally {
    liberar();
  }
}

// JPEG: mantém os bytes originais (preserva o EXIF com data e hora da câmera).
// Outro formato: converte para JPEG 0,92.
export async function prepararFoto(arquivo, nome) {
  const ehJpeg = arquivo.type === 'image/jpeg' || /\.jpe?g$/i.test(arquivo.name || '');
  const dados = ehJpeg ? arquivo : await redimensionar(arquivo, LIMITE_LADO, 0.92);
  return new File([dados], nome, { type: 'image/jpeg', lastModified: Date.now() });
}

export async function gerarMiniatura(blob) {
  const mini = await redimensionar(blob, 320, 0.7);
  return mini.arrayBuffer();
}
