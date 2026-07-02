# Site Bipe Único

Site estático para subir na Vercel.

## Variáveis da Vercel

Configure no projeto da Vercel:

```env
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_ANON_KEY=sua-chave-anon-publica
BILLING_URL=https://seu-projeto.supabase.co/functions/v1/abacatepay-create-checkout
SOFTWARE_DOWNLOAD_URL=/downloads/Bipe-Unico.exe
```

`SUPABASE_ANON_KEY` é pública. Não coloque `SUPABASE_SERVICE_ROLE_KEY` nem chave secreta do AbacatePay no site.

## Download

Opções:

- subir o `.exe` em `public/downloads/Bipe-Unico.exe`; ou
- apontar `SOFTWARE_DOWNLOAD_URL` para um link externo de download.

O download é gratuito, mas o uso do aplicativo exige assinatura ativa.
