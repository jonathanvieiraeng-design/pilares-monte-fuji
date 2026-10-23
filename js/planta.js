// Visualização da prancha (pdf.js) com zoom, arraste e marcadores de pilares.
//
// Sistema de coordenadas:
// - "mundo": a página ajustada à tela em escala 1 (largura this.bw × altura this.bh, em px CSS);
// - a vista aplica translate(tx, ty) scale(s) sobre o mundo;
// - pilares guardam x, y como fração (0–1) da página.
//
// Render em duas camadas para respeitar o limite de canvas do iOS:
// - base: a página inteira numa resolução fixa (limitada);
// - detalhe: só a região visível, renderizada na resolução do zoom atual ao fim de cada gesto.

import * as pdfjsLib from '../vendor/pdf.min.mjs';
import { el, statusDo, checkSemFoto, limitarEscala, LIMITE_LADO, LIMITE_AREA } from './util.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;

export function abrirPdf(buf) {
  // pdf.js transfere o buffer para o worker; passa uma cópia para manter o original.
  return pdfjsLib.getDocument({
    data: new Uint8Array(buf.slice(0)),
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;
}

export async function renderizarMiniatura(doc, numero, canvas, larguraCss) {
  const pagina = await doc.getPage(numero);
  const vp1 = pagina.getViewport({ scale: 1 });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const escala = limitarEscala(vp1.width, vp1.height, (larguraCss * dpr) / vp1.width);
  const vp = pagina.getViewport({ scale: escala });
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  canvas.style.width = `${larguraCss}px`;
  canvas.style.height = `${(larguraCss * vp1.height) / vp1.width}px`;
  await pagina.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
}

const LIMIAR_ARRASTE = 8;      // px até um toque virar arraste
const TEMPO_TOQUE_LONGO = 450; // ms para começar a mover um marcador
const S_MIN = 0.5;
const ZOOM_ROTULOS = 2.5;      // a partir deste zoom os nomes aparecem

function liberarCanvas(c) {
  if (!c) return;
  c.width = 0;
  c.height = 0;
}

export class Planta {
  constructor(raiz, eventos = {}) {
    this.ev = eventos;
    this.modo = 'conferencia';
    this.pilares = [];
    this.elementos = new Map();
    this.destaqueId = null;
    this.nomesSempre = false;
    this.s = 1;
    this.tx = 0;
    this.ty = 0;
    this.ponteiros = new Map();
    this.gesto = null;

    this.vista = el('div', { class: 'planta-vista' });
    this.mundo = el('div', { class: 'planta-mundo' });
    this.canvasBase = el('canvas', { class: 'planta-base' });
    this.canvasDetalhe = null;
    this.camada = el('div', { class: 'planta-marcadores' });
    this.mundo.append(this.canvasBase);
    this.vista.append(this.mundo, this.camada);
    raiz.append(this.vista);

    this._ligarGestos();
    this.observador = new ResizeObserver(() => this._aoRedimensionar());
    this.observador.observe(this.vista);
  }

  async carregar(buf, numeroPagina) {
    this.pdf = await abrirPdf(buf);
    this.pagina = await this.pdf.getPage(Math.min(numeroPagina || 1, this.pdf.numPages));
    const vp = this.pagina.getViewport({ scale: 1 });
    this.pw = vp.width;
    this.ph = vp.height;
    this._medir();
    this.ajustar();
    await this._renderBase();
  }

  destruir() {
    this.observador.disconnect();
    clearTimeout(this.timerDetalhe);
    clearTimeout(this.timerLongo);
    this.tarefaDetalhe?.cancel();
    liberarCanvas(this.canvasBase);
    liberarCanvas(this.canvasDetalhe);
    this.pdf?.destroy();
    this.vista.remove();
  }

  // ---------- geometria ----------

  _medir() {
    const r = this.vista.getBoundingClientRect();
    this.vw = r.width;
    this.vh = r.height;
    this.ajuste = Math.min(this.vw / this.pw, this.vh / this.ph);
    this.bw = this.pw * this.ajuste;
    this.bh = this.ph * this.ajuste;
    // zoom máximo: 1 pt da prancha = 8 px na tela
    this.sMax = Math.max(4, 8 / this.ajuste);
    this.mundo.style.width = `${this.bw}px`;
    this.mundo.style.height = `${this.bh}px`;
  }

  _aoRedimensionar() {
    if (!this.pagina) return;
    const r = this.vista.getBoundingClientRect();
    if (r.width === this.vw && r.height === this.vh) return;
    if (!r.width || !r.height) return;
    // mantém o ponto central e o zoom
    const cx = (this.vw / 2 - this.tx) / (this.bw * this.s);
    const cy = (this.vh / 2 - this.ty) / (this.bh * this.s);
    this._medir();
    this.tx = this.vw / 2 - cx * this.bw * this.s;
    this.ty = this.vh / 2 - cy * this.bh * this.s;
    this._limitar();
    this._aplicar();
    this._posicionarDetalhe(null);
    this._agendarDetalhe();
  }

  ajustar() {
    this.s = 1;
    this.tx = (this.vw - this.bw) / 2;
    this.ty = (this.vh - this.bh) / 2;
    this._aplicar();
    this._agendarDetalhe();
  }

  zoomEm(x, y, fator) {
    const wx = (x - this.tx) / this.s;
    const wy = (y - this.ty) / this.s;
    this.s = Math.min(this.sMax, Math.max(S_MIN, this.s * fator));
    this.tx = x - wx * this.s;
    this.ty = y - wy * this.s;
    this._limitar();
    this._aplicar();
    this._agendarDetalhe();
  }

  zoomCentro(fator) {
    this.zoomEm(this.vw / 2, this.vh / 2, fator);
  }

  // alturaRelativa: onde o pilar fica na vertical (0,5 = meio; menor quando a ficha cobre a parte de baixo)
  centralizarEm(id, alturaRelativa = 0.5) {
    const p = this.pilares.find((x) => x.id === id);
    if (!p) return;
    this.s = Math.max(this.s, Math.min(this.sMax, 4));
    this.tx = this.vw / 2 - p.x * this.bw * this.s;
    this.ty = this.vh * alturaRelativa - p.y * this.bh * this.s;
    this._limitar();
    this._aplicar();
    this._agendarDetalhe();
    this.destacar(id);
  }

  _limitar() {
    // sempre deixa parte da página na tela
    const mx = this.vw * 0.5;
    const my = this.vh * 0.5;
    this.tx = Math.min(mx, Math.max(mx - this.bw * this.s, this.tx));
    this.ty = Math.min(my, Math.max(my - this.bh * this.s, this.ty));
  }

  _aplicar() {
    this.mundo.style.transform = `translate3d(${this.tx}px, ${this.ty}px, 0) scale(${this.s})`;
    this.camada.classList.toggle('com-rotulos', this.nomesSempre || this.s >= ZOOM_ROTULOS);
    for (const p of this.pilares) this._posicionar(p);
  }

  _agendarAplicar() {
    if (this.quadro) return;
    this.quadro = requestAnimationFrame(() => {
      this.quadro = null;
      this._aplicar();
    });
  }

  _posicionar(p, x = p.x, y = p.y) {
    const e = this.elementos.get(p.id);
    if (!e) return;
    const left = this.tx + x * this.bw * this.s;
    const top = this.ty + y * this.bh * this.s;
    e.style.transform = `translate3d(${left}px, ${top}px, 0)`;
  }

  _fracao(x, y) {
    return {
      fx: (x - this.tx) / (this.bw * this.s),
      fy: (y - this.ty) / (this.bh * this.s),
    };
  }

  // ---------- render ----------

  async _renderBase() {
    const dpr = window.devicePixelRatio || 1;
    // resolução suficiente para ~2,5× de zoom; acima disso entra o detalhe
    this.escalaBase = limitarEscala(this.pw, this.ph, this.ajuste * dpr * 2.5);
    const vp = this.pagina.getViewport({ scale: this.escalaBase });
    const c = this.canvasBase;
    c.width = Math.floor(vp.width);
    c.height = Math.floor(vp.height);
    await this.pagina.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  }

  _agendarDetalhe() {
    clearTimeout(this.timerDetalhe);
    this.timerDetalhe = setTimeout(() => this._renderDetalhe(), 180);
  }

  async _renderDetalhe() {
    if (!this.pagina || this.gesto) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const escalaTela = this.ajuste * this.s * dpr; // px do aparelho por pt
    this.tarefaDetalhe?.cancel();
    if (!this.escalaBase || escalaTela <= this.escalaBase * 1.05) {
      this._posicionarDetalhe(null);
      return;
    }
    // região visível, em px do mundo
    const x0 = Math.max(0, -this.tx / this.s);
    const y0 = Math.max(0, -this.ty / this.s);
    const x1 = Math.min(this.bw, (this.vw - this.tx) / this.s);
    const y1 = Math.min(this.bh, (this.vh - this.ty) / this.s);
    if (x1 <= x0 || y1 <= y0) return;

    let w = (x1 - x0) * this.s * dpr;
    let h = (y1 - y0) * this.s * dpr;
    const k = Math.min(1, LIMITE_LADO / w, LIMITE_LADO / h, Math.sqrt((LIMITE_AREA * 0.98) / (w * h)));
    const escala = escalaTela * k;
    w = Math.floor(w * k);
    h = Math.floor(h * k);

    const viewport = this.pagina.getViewport({
      scale: escala,
      offsetX: -(x0 / this.ajuste) * escala,
      offsetY: -(y0 / this.ajuste) * escala,
    });
    const novo = el('canvas', { class: 'planta-detalhe' });
    novo.width = w;
    novo.height = h;
    const ficha = (this.fichaDetalhe = {});
    const tarefa = (this.tarefaDetalhe = this.pagina.render({ canvasContext: novo.getContext('2d'), viewport }));
    try {
      await tarefa.promise;
    } catch (e) {
      liberarCanvas(novo);
      return; // cancelado por um gesto novo
    }
    if (ficha !== this.fichaDetalhe) {
      liberarCanvas(novo);
      return;
    }
    this._posicionarDetalhe({ canvas: novo, x0, y0, x1, y1 });
  }

  _posicionarDetalhe(d) {
    if (this.canvasDetalhe) {
      this.canvasDetalhe.remove();
      liberarCanvas(this.canvasDetalhe);
      this.canvasDetalhe = null;
    }
    if (!d) return;
    Object.assign(d.canvas.style, {
      left: `${d.x0}px`,
      top: `${d.y0}px`,
      width: `${d.x1 - d.x0}px`,
      height: `${d.y1 - d.y0}px`,
    });
    this.mundo.append(d.canvas);
    this.canvasDetalhe = d.canvas;
  }

  // ---------- marcadores ----------

  _classes(p) {
    let c = `marcador st-${statusDo(p)}`;
    if (checkSemFoto(p)) c += ' sem-foto';
    if (p.spda) c += ' spda';
    if (p.id === this.destaqueId) c += ' destaque';
    return c;
  }

  _criarElemento(p) {
    const e = el('div', { class: this._classes(p), dataset: { id: p.id } },
      el('span', { class: 'ponto' }),
      el('span', { class: 'raio', 'aria-hidden': 'true' }),
      el('span', { class: 'rotulo' }, p.nome));
    this.elementos.set(p.id, e);
    return e;
  }

  setPilares(lista) {
    this.pilares = [...lista];
    this.elementos.clear();
    this.camada.replaceChildren(...lista.map((p) => this._criarElemento(p)));
    this._aplicar();
  }

  atualizarPilar(p) {
    const i = this.pilares.findIndex((x) => x.id === p.id);
    if (i < 0) {
      this.pilares.push(p);
      this.camada.append(this._criarElemento(p));
    } else {
      this.pilares[i] = p;
      const e = this.elementos.get(p.id);
      e.className = this._classes(p);
      e.querySelector('.rotulo').textContent = p.nome;
    }
    this._posicionar(p);
  }

  removerPilar(id) {
    this.pilares = this.pilares.filter((p) => p.id !== id);
    this.elementos.get(id)?.remove();
    this.elementos.delete(id);
  }

  destacar(id) {
    const anterior = this.elementos.get(this.destaqueId);
    anterior?.classList.remove('destaque');
    this.destaqueId = id;
    const e = this.elementos.get(id);
    if (!e) return;
    // reinicia a animação
    e.classList.remove('destaque');
    void e.offsetWidth;
    e.classList.add('destaque');
    clearTimeout(this.timerDestaque);
    this.timerDestaque = setTimeout(() => {
      e.classList.remove('destaque');
      if (this.destaqueId === id) this.destaqueId = null;
    }, 2600);
  }

  alternarNomes() {
    this.nomesSempre = !this.nomesSempre;
    this._aplicar();
    return this.nomesSempre;
  }

  // ---------- gestos ----------

  _ligarGestos() {
    const v = this.vista;
    v.addEventListener('pointerdown', (e) => this._baixo(e));
    v.addEventListener('pointermove', (e) => this._mover(e));
    v.addEventListener('pointerup', (e) => this._cima(e, false));
    v.addEventListener('pointercancel', (e) => this._cima(e, true));
    v.addEventListener('wheel', (e) => {
      e.preventDefault();
      const { x, y } = this._local(e);
      this.zoomEm(x, y, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
  }

  _local(e) {
    const r = this.vista.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _baixo(e) {
    if (!this.pagina) return;
    this.vista.setPointerCapture?.(e.pointerId);
    const pos = this._local(e);
    this.ponteiros.set(e.pointerId, pos);
    clearTimeout(this.timerDetalhe);

    if (this.ponteiros.size === 1) {
      const alvo = e.target.closest?.('.marcador');
      this.gesto = {
        tipo: 'toque', x0: pos.x, y0: pos.y, t0: Date.now(),
        marcadorId: alvo?.dataset.id || null, tx0: this.tx, ty0: this.ty,
      };
      if (alvo && this.modo === 'edicao') {
        this.timerLongo = setTimeout(() => {
          if (this.gesto?.tipo === 'toque') {
            this.gesto.tipo = 'mover';
            alvo.classList.add('movendo');
            navigator.vibrate?.(15);
          }
        }, TEMPO_TOQUE_LONGO);
      }
    } else if (this.ponteiros.size === 2) {
      clearTimeout(this.timerLongo);
      this._cancelarMovimento();
      const [a, b] = [...this.ponteiros.values()];
      this.gesto = {
        tipo: 'pinca',
        d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        s0: this.s,
        mx0: (a.x + b.x) / 2,
        my0: (a.y + b.y) / 2,
        tx0: this.tx,
        ty0: this.ty,
      };
    }
  }

  _mover(e) {
    if (!this.ponteiros.has(e.pointerId)) return;
    const pos = this._local(e);
    this.ponteiros.set(e.pointerId, pos);
    const g = this.gesto;
    if (!g) return;

    if (g.tipo === 'toque' || g.tipo === 'arraste') {
      const dx = pos.x - g.x0;
      const dy = pos.y - g.y0;
      if (g.tipo === 'toque' && Math.hypot(dx, dy) > LIMIAR_ARRASTE) {
        g.tipo = 'arraste';
        clearTimeout(this.timerLongo);
      }
      if (g.tipo === 'arraste') {
        this.tx = g.tx0 + dx;
        this.ty = g.ty0 + dy;
        this._limitar();
        this._agendarAplicar();
      }
    } else if (g.tipo === 'mover') {
      const p = this.pilares.find((x) => x.id === g.marcadorId);
      if (!p) return;
      const { fx, fy } = this._fracao(pos.x, pos.y);
      g.fx = Math.min(1, Math.max(0, fx));
      g.fy = Math.min(1, Math.max(0, fy));
      this._posicionar(p, g.fx, g.fy);
    } else if (g.tipo === 'pinca' && this.ponteiros.size >= 2) {
      const [a, b] = [...this.ponteiros.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const s = Math.min(this.sMax, Math.max(S_MIN, (g.s0 * d) / g.d0));
      const wx = (g.mx0 - g.tx0) / g.s0;
      const wy = (g.my0 - g.ty0) / g.s0;
      this.s = s;
      this.tx = mx - wx * s;
      this.ty = my - wy * s;
      this._limitar();
      this._agendarAplicar();
    }
  }

  _cancelarMovimento() {
    const g = this.gesto;
    if (g?.tipo !== 'mover') return;
    const p = this.pilares.find((x) => x.id === g.marcadorId);
    this.elementos.get(g.marcadorId)?.classList.remove('movendo');
    if (p) this._posicionar(p);
  }

  _cima(e, cancelado) {
    if (!this.ponteiros.has(e.pointerId)) return;
    this.ponteiros.delete(e.pointerId);
    const g = this.gesto;

    if (g?.tipo === 'pinca') {
      if (this.ponteiros.size === 1) {
        // continua como arraste com o dedo que ficou
        const [p] = [...this.ponteiros.values()];
        this.gesto = { tipo: 'arraste', x0: p.x, y0: p.y, tx0: this.tx, ty0: this.ty };
      } else {
        this.gesto = null;
        this._agendarDetalhe();
      }
      return;
    }
    if (this.ponteiros.size > 0) return;

    clearTimeout(this.timerLongo);
    this.gesto = null;
    if (!g) return;
    if (cancelado) {
      this._cancelarMovimento();
      this._agendarDetalhe();
      return;
    }

    if (g.tipo === 'toque') {
      if (g.marcadorId) {
        this.ev.aoTocarMarcador?.(g.marcadorId);
      } else if (Date.now() - g.t0 < 700) {
        this._toqueVazio(g.x0, g.y0);
      }
    } else if (g.tipo === 'mover') {
      this.elementos.get(g.marcadorId)?.classList.remove('movendo');
      if (g.fx != null) this.ev.aoMoverMarcador?.(g.marcadorId, g.fx, g.fy);
    } else {
      this._agendarDetalhe();
    }
  }

  _toqueVazio(x, y) {
    const { fx, fy } = this._fracao(x, y);
    const dentro = fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1;
    if (this.modo === 'conferencia') {
      // toque duplo aproxima
      const agora = Date.now();
      const u = this.ultimoToque;
      if (u && agora - u.t < 320 && Math.hypot(u.x - x, u.y - y) < 30) {
        this.ultimoToque = null;
        this.zoomEm(x, y, 2);
        return;
      }
      this.ultimoToque = { t: agora, x, y };
      return;
    }
    if (dentro) this.ev.aoTocarVazio?.(fx, fy);
  }
}
