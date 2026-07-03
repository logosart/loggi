# Contexto do Projeto Bipe Unico

Este arquivo e a memoria tecnica do projeto. Sempre que uma funcionalidade importante for criada, alterada ou decidida, atualizar este documento para que a futura versao segura em C# consiga partir daqui sem perder contexto.

## Objetivo do Produto

Bipe Unico e um app desktop para operacoes Shopee Xpress.

O objetivo e reduzir retrabalho operacional em esteiras de bipagem:

- o operador abre a tela de recebimento da Shopee;
- abre a tela de expedicao/detalhe da Shopee;
- bipa ou cola um codigo na tela de recebimento;
- a automacao copia o codigo e cola/confirma na tela de destino;
- tambem existe fila por planilha para enviar o proximo codigo com atalho.
- todo codigo processado entra no historico local com data/hora, origem e status.

Nao existe plano gratuito. O download do software pode ser gratuito, mas o uso da automacao exige assinatura ativa.

## Estado Atual

Versao atual do desktop: `0.1.8`.

Executavel atual:

```text
dist/Bipe Único 0.1.8.exe
```

Copia para download no site:

```text
site/public/downloads/Bipe-Unico.exe
```

Stack atual:

- Electron para app desktop.
- AutoHotkey v2 para automacao.
- Supabase Auth para login.
- Supabase Postgres para assinaturas/equipe.
- Supabase Edge Functions para checkout e webhook AbacatePay.
- Site estatico em `site/`, preparado para Vercel.

## Decisao de Seguranca

Por enquanto vamos terminar a logica e a experiencia principal usando Electron + AutoHotkey.

Depois faremos uma versao mais segura em C#.

Motivo: Electron e AutoHotkey nao protegem bem a logica do cliente. Uma pessoa tecnica pode extrair o `app.asar` e ler partes do codigo. O AutoHotkey tambem pode ser lido se estiver empacotado como `.ah`.

Plano futuro:

- manter Electron ou outro frontend apenas como painel/login/configuracao;
- mover a logica principal da automacao para um runner compilado em C#;
- nao distribuir scripts `.ah` em texto puro;
- fazer o app chamar o runner C#;
- manter validacao de assinatura online antes de liberar automacao;
- nunca colocar secrets no cliente.

## Segredos e Configuracao

O usuario final nao deve configurar `.env`.

O app desktop usa configuracao publica embutida em:

```text
src/app-config.json
```

Esse arquivo e gerado pelo script:

```text
scripts/prepare-public-config.js
```

Comando:

```powershell
npm run prepare:config
```

O build executa isso automaticamente via `prebuild`.

Configuracoes publicas que podem ir no desktop:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUBSCRIPTION_TABLE`
- `BILLING_URL`

Secrets que nunca devem ir no desktop ou site:

- `SUPABASE_SERVICE_ROLE_KEY`
- `ABACATEPAY_API_KEY`
- `ABACATEPAY_WEBHOOK_SECRET`

Esses ficam somente no Supabase/Edge Functions.

## Desktop Electron

Arquivos principais:

```text
src/main.js
src/preload.js
src/renderer.js
src/index.html
src/styles.css
automation/AutoScanner.ah
automation/app.ini
```

Scripts do `package.json`:

```powershell
npm start
npm run prepare:config
npm run test-user:create
npm run build
```

Build gera executavel portatil Windows via Electron Builder.

Regra de versao:

- sempre que alterarmos funcionalidade/build do desktop, subir a versao;
- exemplos: `0.1.1`, `0.1.2`, `0.1.3`, `0.1.4`.

## Fluxo Atual da Automacao

A automacao voltou a usar os titulos padrao da Shopee, sem captura manual de janela.

Titulos padrao:

```ini
[windows]
source_title = Receive Task - Shopee Xpress
target_title = Detail - Shopee Xpress
```

Esses valores ficam em:

```text
automation/app.ini
```

O app tambem restaura automaticamente esses titulos no `app.ini` da pasta de dados do usuario, para evitar que testes antigos com Brave fiquem gravados.

Atalho principal:

- `Enter` na janela de origem.

Fluxo:

- captura o texto/codigo da origem com `Ctrl+A` e `Ctrl+C`;
- extrai codigo por regex;
- ativa a janela destino;
- cola com `Ctrl+A` e `Ctrl+V`;
- envia `Enter`;
- volta para origem;
- opcionalmente seleciona/limpa o campo de origem.

Fila por planilha:

- automatica ao iniciar a automacao ou ao importar uma lista enquanto a automacao esta rodando;
- respeita os delays configurados, incluindo `queue_interval_ms`;
- `F8` fica como atalho de retomada/manual caso a fila pause.

Fluxo:

- pega o proximo codigo de `codes.txt`;
- cola/confirma no destino.
- se o destino receber o codigo, remove esse codigo da fila;
- se o destino estiver fechado, registra `destino_fechado`, pausa a fila e mantem o codigo atual em `codes.txt`.

## Configuracoes de Automacao

No app desktop, o usuario pode configurar delays:

- copiar codigo;
- colar no destino;
- confirmar Enter;
- voltar para origem;
- selecionar campo ao voltar.

Esses valores sao salvos no `app.ini` em:

```ini
[behavior]
return_select_all = 1
copy_delay_ms = 80
paste_delay_ms = 80
enter_delay_ms = 120
return_delay_ms = 80
queue_interval_ms = 500
```

## Importacao de Planilhas

O desktop permite importar:

- `.xlsx`
- `.xls`
- `.csv`
- `.txt`

Dependencia usada:

```text
xlsx
```

O importador extrai codigos por regex:

```text
[A-Z]{2}\d{8,}[A-Z]
```

Se nao encontrar por regex, usa valores/linhas limpas como codigos.

Arquivos de fila na pasta de dados do usuario:

```text
codes.txt
codes-source.txt
```

## Historico de Codigos

A partir da versao `0.1.5`, cada codigo processado e salvo em historico local.

Arquivo:

```text
history.csv
```

Local:

```text
Pasta de dados do usuario do Electron/automation
```

Colunas:

```text
Data
Origem
Codigo
Status
```

Origens atuais:

- `manual`: codigo capturado pela tela de recebimento com Enter;
- `planilha`: codigo enviado pela fila automatica importada.

Status atuais:

- `enviado`: destino recebeu o codigo;
- `destino_fechado`: destino nao foi encontrado/nao recebeu.

A aba `Historico` do app permite:

- pesquisar por codigo, origem ou status;
- filtrar por data inicial e final;
- filtrar por origem;
- filtrar por status;
- atualizar a lista;
- exportar o resultado filtrado para Excel (`.xlsx`).

Exportacao Excel e feita pelo Electron usando a dependencia `xlsx`.

## Login e Assinatura

O app usa Supabase Auth.

Chaves usadas no cliente:

- Supabase URL;
- Supabase anon key.

O app verifica assinatura na tabela configurada por:

```text
SUBSCRIPTION_TABLE
```

Padrao:

```text
subscriptions
```

Assinatura ativa:

- `status` em `active` ou `trialing`;
- `current_period_end` vazio ou no futuro.

Planos:

- `personal`
- `business`

O app tem compatibilidade parcial com schema antigo:

- se `plan_type` nao existir, assume `personal`;
- se tabelas de equipe nao existirem, ignora equipe.

## Equipe

Equipe so deve aparecer para administradores do plano empresarial.

Tabelas relevantes:

```text
organizations
organization_memberships
organization_invitations
subscriptions
```

Plano empresarial:

- assinatura ligada a `organization_id`;
- comprador deve ser `owner`;
- convites ficam disponiveis para `owner`/`admin`;
- limite padrao de convites: 10 operadores alem do owner.

## Supabase Schema

Arquivo:

```text
supabase/schema.sql
```

Contem:

- tabelas de organizacao;
- tabela de assinaturas;
- colunas AbacatePay;
- RLS;
- policies para leitura de assinatura/equipe;
- policies para convites.

Importante: aplicar esse SQL no Supabase remoto para o fluxo completo de AbacatePay e equipe funcionar corretamente.

## AbacatePay

O app desktop nao chama AbacatePay diretamente.

Fluxo:

- desktop/site chama Supabase Edge Function `abacatepay-create-checkout`;
- Edge Function usa `ABACATEPAY_API_KEY`;
- AbacatePay chama webhook `abacatepay-webhook`;
- webhook atualiza `subscriptions` usando `SUPABASE_SERVICE_ROLE_KEY`.

Funcoes:

```text
supabase/functions/abacatepay-create-checkout/index.ts
supabase/functions/abacatepay-webhook/index.ts
```

Secrets esperados nas Edge Functions:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
ABACATEPAY_API_KEY
ABACATEPAY_WEBHOOK_SECRET
ABACATEPAY_PERSONAL_PRODUCT_ID
ABACATEPAY_BUSINESS_PRODUCT_ID
APP_SUCCESS_URL
APP_CANCEL_URL
```

## Usuario de Teste

Script:

```text
scripts/create-test-user.js
```

Comando:

```powershell
npm run test-user:create
```

Requer no ambiente de desenvolvimento:

```text
SUPABASE_SERVICE_ROLE_KEY
```

Pode ser colocado em:

```text
supabase/.env
```

Esse arquivo e ignorado pelo Git.

Usuario padrao criado:

```text
Email: teste@bipeunico.local
Senha: Teste@123456
Plano: pessoal ativo por 1 ano
```

Esse usuario foi criado no Supabase remoto, nao apenas local. Pode ser passado para outra pessoa testar, desde que o app dela aponte para o mesmo projeto Supabase.

Risco: e uma conta compartilhada de teste. Qualquer pessoa com login/senha acessa como paga.

## Site Vercel

Pasta:

```text
site/
```

Objetivo:

- pagina comercial;
- copy forte para converter;
- download gratuito do software;
- login/criacao de conta;
- compra de assinatura pessoal/empresarial;
- sem plano gratuito.

Arquivos:

```text
site/public/index.html
site/public/styles.css
site/public/app.js
site/scripts/prepare-config.js
site/vercel.json
site/package.json
site/README.md
```

Build local:

```powershell
cd site
npm run build
```

Dev local:

```powershell
cd site
npm run dev
```

Variaveis esperadas na Vercel:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
BILLING_URL
SOFTWARE_DOWNLOAD_URL
```

`SOFTWARE_DOWNLOAD_URL` pode apontar para:

```text
/downloads/Bipe-Unico.exe
```

Ou para um link externo.

## Decisoes Recentes

### 0.1.1

- automacao virou tela principal;
- aba de configuracao removida para usuario final;
- login some depois de conectado;
- equipe aparece somente para plano empresarial;
- adicionada importacao de lista;
- adicionados delays configuraveis;
- visual mais profissional/logistico.

### 0.1.2

- corrigido erro de `return` no AutoHotkey;
- criado `site/` para Vercel;
- criada landing page com login, download e planos;
- executavel copiado para download do site.

### 0.1.3

- tentativa de capturar janela origem/destino manualmente;
- adicionado bugfix `global DST_TITLE` no AutoHotkey.

### 0.1.4

- removida captura manual de janela;
- restaurado fluxo automatico Shopee por titulos padrao;
- app força `source_title` e `target_title` padrao no `app.ini`;
- mantido bugfix `global DST_TITLE`;
- atualizado download do site.

### 0.1.5

- adicionado historico local de codigos processados em `history.csv`;
- cada envio manual ou por planilha registra data/hora, origem, codigo e status;
- criada aba `Historico` no desktop;
- adicionados filtros por texto, periodo, origem e status;
- adicionada exportacao do historico filtrado para Excel;
- atualizado download do site.

### 0.1.6

- corrigidos textos fixos da interface usando entidades HTML para evitar mojibake como `HistÃ³rico`;
- ajustado layout responsivo da aba `Historico` para remover rolagem horizontal desnecessaria;
- adicionada renovacao de sessao Supabase antes de consultar assinatura;
- quando a sessao local expira, o app desconecta silenciosamente e pede novo login em vez de mostrar `Conectado` sem plano;
- validado o usuario de teste remoto `teste@bipeunico.local` com plano pessoal ativo.

### 0.1.7

- usuario deslogado passa a ver somente a aba `Conta`;
- abas `Automacao`, `Historico`, `Assinatura` e `Equipe` ficam ocultas ate existir sessao autenticada;
- a compra/gestao de plano saiu da tela `Conta` e virou a aba separada `Assinatura`;
- apos login, usuario com plano ativo vai para `Automacao`; usuario sem plano vai para `Assinatura`;
- tela `Conta` ficou focada em login, dados do usuario e sair da conta.

### 0.1.8

- fila importada por planilha deixou de depender de apertar `F8` a cada codigo;
- `AutoScanner.ah` passou a observar `codes.txt` e enviar os codigos automaticamente em sequencia;
- adicionado delay configuravel `queue_interval_ms` para intervalo entre codigos da planilha;
- se a tela de destino estiver fechada, a fila pausa e mantem o codigo atual para evitar perder a planilha;
- textos da tela de automacao foram atualizados para explicar que `F8` agora serve como retomada/manual.

## Pendencias e Proximos Passos

- Testar o fluxo real dentro das telas Shopee.
- Confirmar se os titulos reais das janelas Shopee batem exatamente com:
  - `Receive Task - Shopee Xpress`
  - `Detail - Shopee Xpress`
- Se os titulos reais forem diferentes, ajustar os padroes em `automation/app.ini` e `src/main.js`.
- Aplicar `supabase/schema.sql` no Supabase remoto.
- Configurar secrets das Edge Functions.
- Testar checkout AbacatePay completo.
- Melhorar iconografia/icone do executavel.
- No futuro, reescrever automacao em C# para proteger melhor a logica.
