# Site Bipe Unico

Site estatico para subir na Vercel, com posicionamento generico de automacao operacional.

## Variaveis da Vercel

Configure no projeto da Vercel:

```env
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_ANON_KEY=sua-chave-anon-publica
BILLING_URL=https://seu-projeto.supabase.co/functions/v1/abacatepay-create-checkout
SOFTWARE_DOWNLOAD_URL=/downloads/Bipe-Unico.exe
```

`SUPABASE_ANON_KEY` e publica. Nao coloque `SUPABASE_SERVICE_ROLE_KEY` nem chave secreta do AbacatePay no site.

## Download

Opcoes:

- subir o `.exe` em `public/downloads/Bipe-Unico.exe`; ou
- apontar `SOFTWARE_DOWNLOAD_URL` para um link externo de download.

O download e gratuito, mas o uso do aplicativo exige assinatura ativa.

## Marketing e compliance

Nao usar nomes, logos, prints ou promessas de integracao oficial com plataformas de terceiros sem autorizacao formal.
O cliente deve ser informado de que e responsavel por usar a automacao apenas onde possui permissao.
