const encoder = new TextEncoder();

type PlanType = 'personal' | 'business';

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function bytesToBase64(bytes: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function hmacSha256(secret: string, payload: string): Promise<{ hex: string; base64: string }> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return {
    hex: bytesToHex(signature),
    base64: bytesToBase64(signature)
  };
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }
  return diff === 0;
}

async function verifySignature(request: Request, rawBody: string): Promise<boolean> {
  const url = new URL(request.url);
  const querySecret = url.searchParams.get('webhookSecret');
  if (querySecret && timingSafeEqual(querySecret, env('ABACATEPAY_WEBHOOK_SECRET'))) {
    return true;
  }

  const received = request.headers.get('x-abacatepay-signature')
    || request.headers.get('abacatepay-signature')
    || request.headers.get('x-signature')
    || request.headers.get('signature')
    || '';

  if (!received) return false;

  const expected = await hmacSha256(env('ABACATEPAY_WEBHOOK_SECRET'), rawBody);
  const normalized = received.replace(/^sha256=/, '').trim();
  return timingSafeEqual(normalized, expected.hex) || timingSafeEqual(normalized, expected.base64);
}

function firstValue(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeStatus(event: string, providerStatus: string | null): string {
  const status = (providerStatus || '').toUpperCase();
  if (event.includes('cancel') || status === 'CANCELLED') return 'canceled';
  if (event.includes('trial')) return 'trialing';
  if (event.includes('completed') || event.includes('renewed') || status === 'PAID') return 'active';
  if (status === 'PENDING') return 'incomplete';
  if (status === 'EXPIRED' || status === 'FAILED') return 'past_due';
  return 'active';
}

function parsePeriodEnd(data: Record<string, unknown>): string {
  const raw = firstValue(
    data.currentPeriodEnd,
    data.current_period_end,
    data.nextBillingAt,
    data.next_billing_at,
    data.expiresAt,
    data.expires_at
  );

  if (raw) {
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }

  const fallback = new Date();
  fallback.setDate(fallback.getDate() + 31);
  return fallback.toISOString();
}

async function supabase(path: string, init: RequestInit = {}) {
  const response = await fetch(`${env('SUPABASE_URL')}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: env('SUPABASE_SERVICE_ROLE_KEY'),
      Authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`,
      'Content-Type': 'application/json',
      ...init.headers
    }
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  if (response.status === 204) return null;
  return response.json();
}

async function ensureOrganization(userId: string, organizationName: string): Promise<string> {
  const existingMemberships = await supabase(
    `/organization_memberships?select=organization_id,organizations(name)&user_id=eq.${userId}&role=eq.owner&status=eq.active`
  );

  const existing = existingMemberships?.[0]?.organization_id;
  if (existing) return existing;

  const organizations = await supabase('/organizations', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      name: organizationName || 'Equipe Bipe Único',
      owner_user_id: userId,
      invite_limit: 10
    })
  });

  const organizationId = organizations[0].id;
  await supabase('/organization_memberships', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      organization_id: organizationId,
      user_id: userId,
      role: 'owner',
      status: 'active'
    })
  });

  return organizationId;
}

async function upsertSubscription(payload: Record<string, unknown>) {
  const event = String(payload.event || payload.type || '');
  const data = objectValue(payload.data || payload.subscription || payload.checkout || payload);
  const metadata = objectValue(data.metadata || payload.metadata);
  const customer = objectValue(data.customer);

  const userId = firstValue(metadata.user_id, data.user_id);
  const planType = (firstValue(metadata.plan_type, data.plan_type) || 'personal') as PlanType;
  if (!userId || !['personal', 'business'].includes(planType)) {
    throw new Error('Webhook sem user_id ou plan_type válido no metadata.');
  }

  let organizationId: string | null = null;
  if (planType === 'business') {
    organizationId = await ensureOrganization(userId, firstValue(metadata.organization_name) || '');
  }

  const abacatepaySubscriptionId = firstValue(data.id, data.subscriptionId, data.subscription_id, payload.id);
  if (!abacatepaySubscriptionId) {
    throw new Error('Webhook sem ID de assinatura/checkout da AbacatePay.');
  }

  const abacatepayCustomerId = firstValue(data.customerId, data.customer_id, customer.id);
  const providerStatus = firstValue(data.status, payload.status);
  const status = normalizeStatus(event, providerStatus);
  const currentPeriodEnd = status === 'canceled' ? new Date().toISOString() : parsePeriodEnd(data);

  const rows = await supabase('/subscriptions?on_conflict=abacatepay_subscription_id', {
    method: 'POST',
    headers: {
      Prefer: 'resolution=merge-duplicates,return=representation'
    },
    body: JSON.stringify({
      user_id: userId,
      organization_id: organizationId,
      plan_type: planType,
      status,
      payment_provider: 'abacatepay',
      abacatepay_customer_id: abacatepayCustomerId,
      abacatepay_subscription_id: abacatepaySubscriptionId,
      current_period_end: currentPeriodEnd,
      updated_at: new Date().toISOString()
    })
  });

  return rows?.[0] || null;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const rawBody = await request.text();
    const validSignature = await verifySignature(request, rawBody);
    if (!validSignature) return jsonResponse({ error: 'Invalid webhook signature' }, 401);

    const payload = JSON.parse(rawBody);
    const subscription = await upsertSubscription(payload);

    return jsonResponse({ ok: true, subscription });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
