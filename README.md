# AutoScanner Desktop

App desktop em Electron para liberar o AutoScanner por login Supabase e assinatura ativa.

## Rodar em desenvolvimento

```powershell
cd desktop_app
copy .env.example .env
npm install
npm start
```

Edite o `.env` com:

```env
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_ANON_KEY=sua-chave-anon-publica
SUBSCRIPTION_TABLE=subscriptions
BILLING_URL=https://seu-checkout-ou-portal-de-assinatura
```

## Supabase

Execute `supabase/schema.sql` no SQL Editor do Supabase.

O app considera a assinatura ativa quando existe uma linha em `subscriptions` para o usuario autenticado com:

- `status` igual a `active` ou `trialing`
- `current_period_end` vazio ou no futuro

Para cobrar assinatura de verdade, use Stripe ou Mercado Pago em um backend/webhook e atualize a tabela `subscriptions` com uma chave `service_role`. Nunca coloque a `service_role` dentro do app desktop.

O botao `Assinar` abre a `BILLING_URL`. Ela pode ser um Stripe Payment Link, um checkout proprio, um portal do cliente ou uma pagina sua que inicia a cobranca.

## AutoHotkey

O app procura AutoHotkey v2 nos caminhos comuns do Windows. Se nao encontrar, o botao `Instalar AutoHotkey` chama:

```powershell
winget install --id AutoHotkey.AutoHotkey --source winget
```

O script roda a partir da pasta de dados do usuario do Electron. Use o botao `Abrir pasta` para ver ou ajustar `AutoScanner.ah` e `app.ini`.

## Gerar executavel portatil

```powershell
npm run build
```

O executavel sera gerado em `dist`.
