const ABACATEPAY_API_URL = 'https://api.abacatepay.com/v2';

type PlanType = 'personal' | 'business';

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
    }
  });
}

async function getAuthenticatedUser(authHeader: string) {
  const response = await fetch(`${env('SUPABASE_URL')}/auth/v1/user`, {
    headers: {
      apikey: env('SUPABASE_ANON_KEY'),
      Authorization: authHeader
    }
  });

  if (!response.ok) {
    throw new Error('Usuário não autenticado.');
  }

  return response.json();
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return jsonResponse({ ok: true });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = request.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Authorization Bearer token obrigatório.' }, 401);
    }

    const user = await getAuthenticatedUser(authHeader);
    const body = await request.json().catch(() => ({}));
    const planType = (body.planType || 'personal') as PlanType;
    const organizationName = String(body.organizationName || '').trim();

    if (!['personal', 'business'].includes(planType)) {
      return jsonResponse({ error: 'Plano inválido.' }, 400);
    }

    if (planType === 'business' && !organizationName) {
      return jsonResponse({ error: 'Nome da organização obrigatório para plano empresarial.' }, 400);
    }

    const productId = planType === 'business'
      ? env('ABACATEPAY_BUSINESS_PRODUCT_ID')
      : env('ABACATEPAY_PERSONAL_PRODUCT_ID');

    const checkoutResponse = await fetch(`${ABACATEPAY_API_URL}/subscriptions/create`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env('ABACATEPAY_API_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        items: [{ id: productId, quantity: 1 }],
        methods: ['CARD'],
        returnUrl: env('APP_CANCEL_URL'),
        completionUrl: env('APP_SUCCESS_URL'),
        externalId: `${planType}:${user.id}:${crypto.randomUUID()}`,
        metadata: {
          app: 'bipe-unico',
          user_id: user.id,
          user_email: user.email,
          plan_type: planType,
          organization_name: organizationName || null
        }
      })
    });

    const checkout = await checkoutResponse.json().catch(() => null);
    if (!checkoutResponse.ok || !checkout?.success) {
      return jsonResponse({ error: checkout?.error || 'Falha ao criar checkout AbacatePay.' }, 502);
    }

    return jsonResponse({
      url: checkout.data?.url,
      checkout: checkout.data
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
