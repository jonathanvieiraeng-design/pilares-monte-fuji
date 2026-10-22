// Utilidades gerais: status, datas, nomes, base64, compartilhamento e DOM.

export const STATUS = {
  pendente: { rotulo: 'Pendente', cor: '#9E9E9E' },
  conferido: { rotulo: 'Conferido', cor: '#F2C200' },
  concluido: { rotulo: 'Concluído', cor: '#2E9E4F' },
};
export const ORDEM_STATUS = ['pendente', 'conferido', 'concluido'];

// Limites de canvas do Safari no iOS. Acima disso o canvas fica em branco sem erro.
export const LIMITE_LADO = 4096;
export const LIMITE_AREA = 16777216;

// Status é sempre derivado dos dados, nunca gravado.
export function statusDo(p) {
  const temFoto = p.fotos && p.fotos.length > 0;
  if (!p.armaduraVerificada || !temFoto) return 'pendente';
  return p.uploadOneDrive ? 'concluido' : 'conferido';
}

export function checkSemFoto(p) {
  return !!p.armaduraVerificada && !(p.fotos && p.fotos.length);
}

export function resumo(pilares) {
  const r = { total: pilares.length, pendente: 0, conferido: 0, concluido: 0 };
  for (const p of pilares) r[statusDo(p)]++;
  r.pct = r.total ? Math.round((r.concluido / r.total) * 100) : 0;
  return r;
}

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export const agora = () => new Date().toISOString();

const dois = (n) => String(n).padStart(2, '0');

export function dataISO(d = new Date()) {
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
}

export function fmtData(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function fmtDataHora(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${fmtData(iso)} ${dois(d.getHours())}:${dois(d.getMinutes())}`;
}

export function diasDesde(iso) {
  const d = new Date(iso);
  const hoje = new Date();
  const a = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const b = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  return Math.round((b - a) / 86400000);
}

export function tamanhoLegivel(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

// Nome como o usuário vê: maiúsculas, espaços simples.
export function normalizarNomePilar(nome) {
  return (nome || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

// Nome seguro para arquivo: sem acentos, só A–Z, 0–9 e hífen.
export function limparNome(nome) {
  return (nome || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export const compararNatural = (a, b) =>
  String(a).localeCompare(String(b), 'pt-BR', { numeric: true, sensitivity: 'base' });

export function limitarEscala(larguraPt, alturaPt, escala) {
  let e = Math.min(escala, LIMITE_LADO / larguraPt, LIMITE_LADO / alturaPt);
  const area = larguraPt * e * alturaPt * e;
  if (area > LIMITE_AREA * 0.98) e *= Math.sqrt((LIMITE_AREA * 0.98) / area);
  return e;
}

export function bufParaBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  const passo = 0x8000;
  for (let i = 0; i < bytes.length; i += passo) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + passo));
  }
  return btoa(s);
}

export function base64ParaBuf(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}

export function hexParaRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Precisa ser chamada direto do toque do usuário, antes de qualquer await:
// o iOS só abre o menu de compartilhar com gesto ativo.
export async function compartilharArquivo(arquivo) {
  if (navigator.canShare && navigator.canShare({ files: [arquivo] })) {
    try {
      await navigator.share({ files: [arquivo] });
      return 'compartilhado';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelado';
      throw e;
    }
  }
  baixarArquivo(arquivo);
  return 'baixado';
}

export function baixarArquivo(arquivo) {
  const url = URL.createObjectURL(arquivo);
  const a = document.createElement('a');
  a.href = url;
  a.download = arquivo.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

const PROPRIEDADES = new Set(['value', 'checked', 'disabled', 'hidden', 'selected']);

export function el(tag, props = {}, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (PROPRIEDADES.has(k)) e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat(Infinity)) {
    if (f == null || f === false) continue;
    e.append(f instanceof Node ? f : String(f));
  }
  return e;
}
