# Contexto do Projeto Bipe Unico

Este arquivo e a memoria tecnica do projeto. Sempre que uma funcionalidade importante for criada, alterada ou decidida, atualizar este documento para que a futura versao segura em C# consiga partir daqui sem perder contexto.

## Objetivo do Produto

Bipe Unico e um app desktop para automacao local de operacoes logisticas repetitivas.

O objetivo e reduzir retrabalho operacional entre duas telas configuradas pelo cliente:

- o operador configura uma tela de origem e uma tela de destino;
- bipa ou cola um codigo na tela de origem;
- a automacao copia o codigo e cola/confirma na tela de destino;
- tambem existe fila por planilha para enviar codigos automaticamente.
- todo codigo processado entra no historico local com data/hora, origem e status.

Nao existe plano gratuito. O download do software pode ser gratuito, mas o uso da automacao exige assinatura ativa.

## Estado Atual

Versao atual do desktop: `0.1.10`.

Executavel atual:

```text
dist/Bipe Único 0.1.10.exe
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

## Decisao de Compliance e Marketing

O produto deve ser posicionado como ferramenta generica de automacao local para operacoes repetitivas.

Regras de comunicacao:

- nao usar nomes, logos, prints ou promessas de integracao oficial com plataformas de terceiros sem autorizacao formal;
- nao afirmar compatibilidade oficial com marketplaces, ERPs, transportadoras ou sistemas de terceiros;
- deixar claro que o cliente deve usar a automacao apenas onde possui autorizacao e respeitando termos aplicaveis;
- nao implementar recurso para burlar captcha, bloqueio, limite tecnico, antifraude, autenticacao ou controle de seguranca;
- manter a configuracao de origem/destino como titulo parcial de janela, definida pelo cliente.

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

A automacao usa titulos parciais de janela configurados pelo cliente.

Titulos padrao genericos:

```ini
[windows]
source_title = Origem
target_title = Destino
```

Esses valores ficam em:

```text
automation/app.ini
```

O app permite configurar esses titulos na tela de automacao e salva os valores no `app.ini` da pasta de dados do usuario.

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

- titulo parcial da tela de origem;
- titulo parcial da tela de destino;
- copiar codigo;
- colar no destino;
- confirmar Enter;
- voltar para origem;
- selecionar campo ao voltar.

Esses valores sao salvos no `app.ini` em:

```ini
[windows]
source_title = Origem
target_title = Destino
```

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

## Bloqueio de Compartilhamento de Conta

A partir da versao `0.1.10`, uma conta autenticada so pode manter um computador ativo por vez.

Implementacao:

- o desktop gera um `device_id` local opaco por hash;
- no Windows, o hash usa `MachineGuid` quando disponivel;
- o Supabase armazena apenas o hash, nao o identificador cru da maquina;
- a tabela `account_device_leases` guarda o lease ativo por usuario;
- a RPC `register_account_device` cria/renova o lease por 3 minutos;
- o app renova o lease a cada 60 segundos enquanto a sessao estiver ativa;
- se outro computador tentar usar a mesma conta antes do lease expirar, recebe bloqueio;
- `release_account_device` tenta liberar o lease no logout;
- se o app fechar sem logout, o lease expira automaticamente em alguns minutos.

Importante: aplicar `supabase/schema.sql` no Supabase remoto antes de distribuir essa versao.

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
- restaurado fluxo automatico por titulos padrao;
- app forcava `source_title` e `target_title` padrao no `app.ini`;
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

### 0.1.9

- reposicionado produto/site/app como ferramenta generica de automacao local para operacoes logisticas;
- removidas referencias diretas a plataforma especifica do site, UI desktop, defaults do AHK e defaults do Electron;
- origem e destino passaram a ser configurados pelo cliente por titulo parcial de janela;
- adicionada pagina `site/public/termos.html` com regras de uso responsavel e ausencia de afiliacao oficial;
- documentada decisao de compliance: nao prometer integracao oficial nem burlar mecanismos de seguranca de terceiros.

### 0.1.10

- adicionada tabela `account_device_leases` no schema Supabase;
- adicionadas RPCs `register_account_device` e `release_account_device`;
- app desktop passou a gerar `device_id` local com hash e nome do computador;
- login/restauracao de sessao agora validam que a conta nao esta ativa em outro PC;
- heartbeat renova o lease a cada 60 segundos;
- inicio da automacao renova o lease antes de executar;
- logout tenta liberar o dispositivo atual.

## Pendencias e Proximos Passos

- Testar o fluxo real com os titulos de origem/destino configurados pelo cliente.
- Aplicar `supabase/schema.sql` no Supabase remoto.
- Configurar secrets das Edge Functions.
- Testar checkout AbacatePay completo.
- Melhorar iconografia/icone do executavel.
- No futuro, reescrever automacao em C# para proteger melhor a logica.
