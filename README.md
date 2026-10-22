# Pilares Monte Fuji

PWA para iPhone que controla, teto a teto, a conferência da armação dos pilares do Residencial Monte Fuji (as-built de execução). Funciona 100% offline depois de instalado. Os dados ficam só no aparelho (IndexedDB).

Especificação: `especificacao-R01.md` (fora deste repositório).

## Publicar no GitHub Pages

1. Crie um repositório no GitHub (ex.: `pilares-monte-fuji`). O Pages gratuito exige repositório **público**: ele contém **só o código**.
2. Envie o conteúdo desta pasta para a branch `main`:
   ```bash
   git init
   git add .
   git commit -m "Pilares Monte Fuji v1"
   git branch -M main
   git remote add origin https://github.com/SEU-USUARIO/pilares-monte-fuji.git
   git push -u origin main
   ```
3. No GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch → `main` / `(root)` → Save**.
4. Em 1 ou 2 minutos o app fica em `https://SEU-USUARIO.github.io/pilares-monte-fuji/`.

> **Nunca** faça commit de pranchas (`.pdf`) ou backups (`.json`). O `.gitignore` já bloqueia esses arquivos.

## Instalar no iPhone

1. Abra o endereço acima no **Safari** (com internet).
2. Toque em **Compartilhar → Adicionar à Tela de Início**.
3. Abra o app pela Tela de Início uma vez com internet, para ele guardar tudo no cache. A partir daí funciona em modo avião.

## Publicar uma atualização

1. Altere os arquivos.
2. Em `sw.js`, **aumente a versão**: `pilares-v1` → `pilares-v2`. Sem isso o app instalado não percebe a mudança.
3. Se criou um arquivo novo, inclua-o na lista `ARQUIVOS` do `sw.js`.
4. Faça commit e push. Ao abrir o app com internet, aparece a faixa **"Nova versão disponível — Recarregar"**.

## Testar no computador

Sirva a pasta por HTTP (o service worker não funciona abrindo o `index.html` direto). Câmera e menu de compartilhar só podem ser validados de verdade no iPhone, depois de publicar.

Durante o desenvolvimento, o service worker serve os arquivos do cache. Para ver uma alteração no navegador do computador, aumente a versão no `sw.js` ou limpe os dados do site.

## Uso em campo: lembretes

- **Foto:** depois de tirar, toque em **Compartilhar** e escolha **"Salvar em Arquivos"** (pasta do OneDrive) ou o app do OneDrive. **"Salvar Imagem" manda para o app Fotos e perde o nome do arquivo.**
- O app guarda só a miniatura. O arquivo oficial é o do OneDrive.
- **Backup:** ao final de cada teto, use **Exportar backup** e salve o `.json` no OneDrive. O backup inclui pranchas, pilares e miniaturas.

## Estrutura

| Arquivo | Função |
|---|---|
| `index.html`, `css/app.css` | Página e estilo (tons de cinza, fonte Carlito) |
| `js/app.js` | Telas, rotas e fluxo |
| `js/db.js` | IndexedDB (tetos, pranchas, pilares, meta) |
| `js/planta.js` | pdf.js, zoom, arraste e marcadores |
| `js/foto.js` | Câmera, nome do arquivo e miniatura |
| `js/relatorio.js` | Relatório PDF |
| `js/imagem.js` | PNG da planta colorida |
| `js/backup.js` | Exportar e importar backup |
| `js/ui.js`, `js/util.js` | Modais, ícones e utilidades |
| `sw.js`, `manifest.webmanifest` | PWA (offline e instalação) |

## Bibliotecas incluídas (sem CDN)

| Biblioteca | Versão | Arquivos |
|---|---|---|
| pdf.js (`pdfjs-dist`, build legacy) | 4.10.38 | `vendor/pdf.min.mjs`, `vendor/pdf.worker.min.mjs` |
| jsPDF | 2.5.2 | `vendor/jspdf.umd.min.js` |
| jspdf-autotable | 3.8.4 | `vendor/jspdf.plugin.autotable.min.js` |
| Carlito (fonte, licença OFL) | Google Fonts | `fonts/Carlito-*.ttf`, `fonts/OFL.txt` |
