# Bipe Unico Desktop

App desktop em Electron para liberar a automacao Bipe Unico por login Supabase e assinatura ativa.

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

## Convites por e-mail

O app registra convites em `organization_invitations`, mas o envio real de e-mail deve ser feito por um backend confiavel:

- Supabase Edge Function;
- webhook/servidor proprio;
- Stripe ou Mercado Pago integrado ao seu backend.

Nunca coloque a `service_role` key dentro do app desktop.

## AutoHotkey

O app procura AutoHotkey v2 nos caminhos comuns do Windows. Se nao encontrar, o botao `Instalar AutoHotkey` abre o instalador oficial.

O script roda a partir da pasta de dados do usuario do Electron. Use o botao `Abrir pasta` para ver ou ajustar `AutoScanner.ah` e `app.ini`.

## Gerar executavel portatil

```powershell
npm run build
```

O executavel sera gerado em `dist`.
