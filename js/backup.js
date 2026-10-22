// Backup completo em .json: tetos, pranchas (PDF) e pilares com miniaturas.
import * as db from './db.js';
import { bufParaBase64, base64ParaBuf, dataISO } from './util.js';

const APP = 'pilares-monte-fuji';

export async function gerarBackup() {
  const { tetos, pranchas, pilares } = await db.exportarTudo();
  const dados = {
    app: APP,
    versaoSchema: db.VERSAO_SCHEMA,
    exportadoEm: new Date().toISOString(),
    tetos,
    pranchas: pranchas.map((r) => ({ ...r, pdf: bufParaBase64(r.pdf) })),
    pilares: pilares.map((p) => ({
      ...p,
      fotos: (p.fotos || []).map((f) => ({ ...f, miniatura: f.miniatura ? bufParaBase64(f.miniatura) : null })),
    })),
  };
  return new File([JSON.stringify(dados)], `MF_Backup_${dataISO()}.json`, { type: 'application/json' });
}

// Lê e valida o arquivo. Não grava nada.
export async function lerBackup(arquivo) {
  let dados;
  try {
    dados = JSON.parse(await arquivo.text());
  } catch (e) {
    throw new Error('O arquivo não é um JSON válido.');
  }
  if (!dados || dados.app !== APP) throw new Error('Este arquivo não é um backup do app de Pilares.');
  if (dados.versaoSchema > db.VERSAO_SCHEMA) {
    throw new Error('Este backup foi gerado por uma versão mais nova do app. Atualize o app antes de importar.');
  }
  if (!Array.isArray(dados.tetos) || !Array.isArray(dados.pranchas) || !Array.isArray(dados.pilares)) {
    throw new Error('Backup incompleto ou corrompido.');
  }
  return {
    exportadoEm: dados.exportadoEm,
    tetos: dados.tetos,
    pranchas: dados.pranchas.map((r) => ({ ...r, pdf: base64ParaBuf(r.pdf) })),
    pilares: dados.pilares.map((p) => ({
      ...p,
      fotos: (p.fotos || []).map((f) => ({ ...f, miniatura: f.miniatura ? base64ParaBuf(f.miniatura) : null })),
    })),
  };
}

export function restaurarBackup(dados) {
  return db.substituirTudo(dados);
}
