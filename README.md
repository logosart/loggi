# Bipe Unico Desktop

App desktop em Electron para liberar a automacao Bipe Unico por login Supabase e assinatura ativa.

## Rodar em desenvolvimento

```powershell
cd desktop_app
copy .env.example .env
npm install
npm start
```

Em desenvolvimento, edite o `.env` com a configuracao publica do app:

```env
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_ANON_KEY=sua-chave-anon-publica
SUBSCRIPTION_TABLE=subscriptions
BILLING_URL=https://seu-checkout-ou-portal-de-assinatura
```

## Supabase

Execute `supabase/schema.sql` no SQL Editor do Supabase.

A partir da versao `0.1.10`, esse schema tambem cria o controle de dispositivo unico por conta (`account_device_leases` e RPCs de lease). Aplique o SQL remoto antes de distribuir o executavel, senao o login do app vai bloquear avisando que o controle de dispositivo nao esta configurado.

O app libera a automacao quando existe:

- plano pessoal ativo para o proprio usuario; ou
- plano empresarial ativo para uma organizacao da qual o usuario faz parte.

Uma assinatura ativa precisa ter:

- `status` igual a `active` ou `trialing`;
- `current_period_end` vazio ou no futuro.

## Planos

Plano pessoal:

- libera apenas o usuario assinante.

Plano empresarial:

- pertence a uma organizacao;
- o comprador deve entrar em `organization_memberships` com `role = 'owner'`;
- permite convidar ate 10 pessoas alem do owner;
- convidados ativos entram em `organization_memberships` como `member` e passam a ter acesso como se fosse um plano pessoal.

## Pagamentos com AbacatePay

O app desktop nao guarda chave secreta da AbacatePay. Ele chama uma Supabase Edge Function, que cria o checkout e recebe webhooks.

No painel da AbacatePay:

1. Crie dois produtos de assinatura com ciclo mensal ou anual:
   - Bipe Unico Pessoal
   - Bipe Unico Empresarial
2. Copie os IDs dos produtos.
3. Crie um webhook apontando para:

```text
https://SEU-PROJETO.supabase.co/functions/v1/abacatepay-webhook
```

4. Configure os eventos de assinatura:
   - `subscription.completed`
   - `subscription.renewed`
   - `subscription.cancelled`
   - `subscription.trial_started`

Configure os secrets das Edge Functions:

```powershell
supabase secrets set SUPABASE_URL=https://seu-projeto.supabase.co
supabase secrets set SUPABASE_ANON_KEY=sua-chave-anon-publica
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=sua-service-role-secreta
supabase secrets set ABACATEPAY_API_KEY=sua-chave-secreta-abacatepay
supabase secrets set ABACATEPAY_WEBHOOK_SECRET=um-segredo-longo-do-webhook
supabase secrets set ABACATEPAY_PERSONAL_PRODUCT_ID=id-produto-pessoal
supabase secrets set ABACATEPAY_BUSINESS_PRODUCT_ID=id-produto-empresarial
supabase secrets set APP_SUCCESS_URL=https://seusite.com/pagamento/sucesso
supabase secrets set APP_CANCEL_URL=https://seusite.com/pagamento/cancelado
```

Publique as functions:

```powershell
supabase functions deploy abacatepay-create-checkout
supabase functions deploy abacatepay-webhook
```

No `.env` usado pelo desenvolvedor/build, `BILLING_URL` deve apontar para:

```env
BILLING_URL=https://SEU-PROJETO.supabase.co/functions/v1/abacatepay-create-checkout
```

## Convites por e-mail

O app registra convites em `organization_invitations`, mas o envio real de e-mail deve ser feito por um backend confiavel:

- Supabase Edge Function;
- webhook/servidor proprio;
- AbacatePay integrado ao seu backend.

Nunca coloque a `service_role` key dentro do app desktop.

## AutoHotkey

O app procura AutoHotkey v2 nos caminhos comuns do Windows. Se nao encontrar, o botao `Instalar AutoHotkey` abre o instalador oficial.

O script roda a partir da pasta de dados do usuario do Electron. Use o botao `Abrir pasta` para ver ou ajustar `AutoScanner.ah` e `app.ini`.

## Gerar executavel portatil

O usuario final nao precisa receber ou configurar `.env`. Antes do build, o script `prebuild` gera `src/app-config.json` a partir do `.env` local ou das variaveis de ambiente da maquina de build. Esse arquivo deve conter somente configuracao publica do desktop:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUBSCRIPTION_TABLE`
- `BILLING_URL`

Secrets como `ABACATEPAY_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` e `ABACATEPAY_WEBHOOK_SECRET` ficam apenas nos secrets das Edge Functions.

## Usuario de teste pago

Para criar um usuario de teste com assinatura pessoal ativa, coloque somente no ambiente de desenvolvimento:

```env
SUPABASE_SERVICE_ROLE_KEY=sua-service-role-secreta
```

Use `supabase/.env` para essa chave local. Esse arquivo e ignorado pelo Git e nao entra no app desktop.

Depois rode:

```powershell
npm run test-user:create
```

Por padrao o comando cria/atualiza:

```text
Email: teste@bipeunico.local
Senha: Teste@123456
Plano: pessoal ativo por 1 ano
```

Voce pode trocar o usuario sem alterar codigo:

```powershell
$env:TEST_USER_EMAIL="teste@seudominio.com"
$env:TEST_USER_PASSWORD="SenhaForte@123"
npm run test-user:create
```

```powershell
npm run build
```

O executavel sera gerado em `dist`.
