// Persistência em IndexedDB.
// Lojas: tetos (leves), pranchas (PDF de cada teto), pilares, meta.
// PDFs e miniaturas são gravados como ArrayBuffer (mais estável no Safari que Blob).

const NOME_BD = 'pilares-monte-fuji';
export const VERSAO_SCHEMA = 1;

let bdPromessa;

function abrir() {
  if (!bdPromessa) {
    bdPromessa = new Promise((resolve, rejeitar) => {
      const req = indexedDB.open(NOME_BD, VERSAO_SCHEMA);
      req.onupgradeneeded = () => {
        const bd = req.result;
        if (!bd.objectStoreNames.contains('tetos')) bd.createObjectStore('tetos', { keyPath: 'id' });
        if (!bd.objectStoreNames.contains('pranchas')) bd.createObjectStore('pranchas', { keyPath: 'tetoId' });
        if (!bd.objectStoreNames.contains('pilares')) {
          bd.createObjectStore('pilares', { keyPath: 'id' }).createIndex('tetoId', 'tetoId');
        }
        if (!bd.objectStoreNames.contains('meta')) bd.createObjectStore('meta', { keyPath: 'chave' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => rejeitar(req.error);
    });
  }
  return bdPromessa;
}

function pedido(req) {
  return new Promise((resolve, rejeitar) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => rejeitar(req.error);
  });
}

function fimTransacao(tx) {
  return new Promise((resolve, rejeitar) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => rejeitar(tx.error);
    tx.onabort = () => rejeitar(tx.error || new Error('Transação cancelada'));
  });
}

async function loja(nome, modo = 'readonly') {
  const bd = await abrir();
  return bd.transaction(nome, modo).objectStore(nome);
}

export async function listarTetos() {
  return pedido((await loja('tetos')).getAll());
}

export async function obterTeto(id) {
  return pedido((await loja('tetos')).get(id));
}

// Grava o teto e, se vier, a prancha na mesma transação.
export async function salvarTeto(teto, prancha) {
  teto.atualizadoEm = new Date().toISOString();
  const bd = await abrir();
  const tx = bd.transaction(['tetos', 'pranchas'], 'readwrite');
  tx.objectStore('tetos').put(teto);
  if (prancha) tx.objectStore('pranchas').put(prancha);
  await fimTransacao(tx);
  return teto;
}

export async function excluirTeto(id) {
  const bd = await abrir();
  const tx = bd.transaction(['tetos', 'pranchas', 'pilares'], 'readwrite');
  tx.objectStore('tetos').delete(id);
  tx.objectStore('pranchas').delete(id);
  const pilares = tx.objectStore('pilares');
  const req = pilares.index('tetoId').openKeyCursor(IDBKeyRange.only(id));
  req.onsuccess = () => {
    const cursor = req.result;
    if (cursor) {
      pilares.delete(cursor.primaryKey);
      cursor.continue();
    }
  };
  return fimTransacao(tx);
}

export async function obterPrancha(tetoId) {
  return pedido((await loja('pranchas')).get(tetoId));
}

export async function listarPilares(tetoId) {
  const s = await loja('pilares');
  return pedido(s.index('tetoId').getAll(IDBKeyRange.only(tetoId)));
}

export async function listarTodosPilares() {
  return pedido((await loja('pilares')).getAll());
}

export async function salvarPilar(p) {
  p.atualizadoEm = new Date().toISOString();
  await pedido((await loja('pilares', 'readwrite')).put(p));
  return p;
}

export async function excluirPilar(id) {
  return pedido((await loja('pilares', 'readwrite')).delete(id));
}

export async function obterMeta(chave) {
  const r = await pedido((await loja('meta')).get(chave));
  return r ? r.valor : undefined;
}

export async function salvarMeta(chave, valor) {
  return pedido((await loja('meta', 'readwrite')).put({ chave, valor }));
}

export async function exportarTudo() {
  const bd = await abrir();
  const tx = bd.transaction(['tetos', 'pranchas', 'pilares'], 'readonly');
  const [tetos, pranchas, pilares] = await Promise.all([
    pedido(tx.objectStore('tetos').getAll()),
    pedido(tx.objectStore('pranchas').getAll()),
    pedido(tx.objectStore('pilares').getAll()),
  ]);
  return { tetos, pranchas, pilares };
}

// Substitui todos os dados numa única transação: se algo falhar, nada é apagado.
export async function substituirTudo({ tetos, pranchas, pilares }) {
  const bd = await abrir();
  const tx = bd.transaction(['tetos', 'pranchas', 'pilares'], 'readwrite');
  const st = tx.objectStore('tetos');
  const sr = tx.objectStore('pranchas');
  const sp = tx.objectStore('pilares');
  st.clear();
  sr.clear();
  sp.clear();
  for (const t of tetos) st.put(t);
  for (const r of pranchas) sr.put(r);
  for (const p of pilares) sp.put(p);
  return fimTransacao(tx);
}
