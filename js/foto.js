// Câmera, carregamento de fotos existentes, data da foto, nome do arquivo, JPEG e miniatura.
import { dataISO, limparNome, LIMITE_LADO, LIMITE_AREA } from './util.js';

// camera: true abre a câmera traseira; false abre a galeria/Arquivos do iPhone.
// Precisa ser chamada direto do toque do usuário.
export function escolherFoto({ camera = true } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (camera) input.setAttribute('capture', 'environment');
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

// ---------- data de uma foto já existente ----------

function dataValida(d) {
  return d instanceof Date && !Number.isNaN(d.getTime()) && d.getFullYear() >= 2015 && d.getTime() <= Date.now() + 86400000;
}

// Lê DateTimeOriginal (ou DateTime) do EXIF de um JPEG. Retorna Date ou null.
export async function lerDataExif(arquivo) {
  try {
    const v = new DataView(await arquivo.slice(0, 256 * 1024).arrayBuffer());
    if (v.getUint16(0) !== 0xFFD8) return null;
    let o = 2;
    while (o + 10 < v.byteLength) {
      const marca = v.getUint16(o);
      if ((marca & 0xFF00) !== 0xFF00 || marca === 0xFFDA) break;
      if (marca === 0xFFE1 && v.getUint32(o + 4) === 0x45786966) return lerTiff(v, o + 10); // "Exif"
      o += 2 + v.getUint16(o + 2);
    }
  } catch (e) {
    // EXIF ausente ou corrompido: segue para as outras fontes de data
  }
  return null;
}

function lerTiff(v, base) {
  const le = v.getUint16(base) === 0x4949;
  const u16 = (p) => v.getUint16(base + p, le);
  const u32 = (p) => v.getUint32(base + p, le);
  const lerIfd = (pos) => {
    const tags = {};
    const n = u16(pos);
    for (let i = 0; i < n; i++) {
      const e = pos + 2 + i * 12;
      tags[u16(e)] = { qtd: u32(e + 4), campo: e + 8 };
    }
    return tags;
  };
  const texto = (t) => {
    const p = t.qtd > 4 ? u32(t.campo) : t.campo;
    let s = '';
    for (let i = 0; i < t.qtd - 1; i++) s += String.fromCharCode(v.getUint8(base + p + i));
    return s;
  };
  const ifd0 = lerIfd(u32(4));
  let bruto = null;
  if (ifd0[0x8769]) {
    const exif = lerIfd(u32(ifd0[0x8769].campo));
    if (exif[0x9003]) bruto = texto(exif[0x9003]);
  }
  if (!bruto && ifd0[0x0132]) bruto = texto(ifd0[0x0132]);
  const m = bruto && bruto.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return dataValida(d) ? d : null;
}

// IMG-20261015-WA0003.jpg (WhatsApp), IMG_20261015_143210.jpg,
// "WhatsApp Image 2026-10-15 at 08.15.22.jpeg", 2026-10-15 ...
export function dataDoNomeArquivo(nome) {
  const m = (nome || '').match(/(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})(?:(?:[-_. ]| at )?(\d{2})[-_.:]?(\d{2})[-_.:]?(\d{2}))?/);
  if (!m) return null;
  const [ano, mes, dia] = [+m[1], +m[2], +m[3]];
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const temHora = m[4] != null && +m[4] < 24 && +m[5] < 60 && +m[6] < 60;
  const d = temHora ? new Date(ano, mes - 1, dia, +m[4], +m[5], +m[6]) : new Date(ano, mes - 1, dia, 12, 0, 0);
  return d.getMonth() === mes - 1 && dataValida(d) ? d : null;
}

// Melhor estimativa da data em que a foto foi tirada, e de onde ela veio.
export async function dataProvavelDaFoto(arquivo) {
  const exif = await lerDataExif(arquivo);
  if (exif) return { data: exif, origem: 'lida da própria foto' };
  const doNome = dataDoNomeArquivo(arquivo.name);
  if (doNome) return { data: doNome, origem: 'lida do nome do arquivo' };
  const mod = new Date(arquivo.lastModified || Date.now());
  if (dataValida(mod)) return { data: mod, origem: 'data do arquivo — confira' };
  return { data: new Date(), origem: 'não encontrada — informe a data' };
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
// Outro formato: converte para JPEG 0,92. Retorna o Blob; o nome é dado depois,
// porque na foto carregada ele depende da data que o usuário confirma.
export async function prepararFoto(arquivo) {
  const ehJpeg = arquivo.type === 'image/jpeg' || /\.jpe?g$/i.test(arquivo.name || '');
  return ehJpeg ? arquivo : redimensionar(arquivo, LIMITE_LADO, 0.92);
}

export function arquivoComNome(dados, nome) {
  return new File([dados], nome, { type: 'image/jpeg', lastModified: Date.now() });
}

export async function gerarMiniatura(blob) {
  const mini = await redimensionar(blob, 320, 0.7);
  return mini.arrayBuffer();
}
