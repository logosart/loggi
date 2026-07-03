const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const values = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const index = trimmed.indexOf('=');
    if (index === -1) continue;

    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, '');
    values[key] = value;
  }
  return values;
}

const env = {
  ...parseEnvFile(path.join(rootDir, '.env')),
  ...parseEnvFile(path.join(rootDir, 'supabase', '.env')),
  ...process.env
};

const config = {
  supabaseUrl: env.SUPABASE_URL,
  serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  subscriptionTable: env.SUBSCRIPTION_TABLE || 'subscriptions',
  email: env.TEST_USER_EMAIL || 'teste@bipeunico.local',
  password: env.TEST_USER_PASSWORD || 'Teste@123456'
};

function required(value, name) {
  if (!value) {
    throw new Error(`Missing ${name}. Set it in supabase/.env or as an environment variable.`);
  }
  return value;
}

async function supabaseFetch(pathname, options = {}) {
  const response = await fetch(`${config.supabaseUrl}${pathname}`, {
    ...options,
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = body?.msg || body?.message || body?.error_description || body?.error || text;
    throw new Error(message || `HTTP ${response.status}`);
  }

  return body;
}

function missingColumnFromError(error) {
  const message = String(error?.message || error);
  return message.match(/'([^']+)' column/)?.[1] || null;
}

async function findUserByEmail(email) {
  const users = await supabaseFetch(`/auth/v1/admin/users?page=1&per_page=1000`, {
    method: 'GET'
  });

  return users?.users?.find((user) => user.email?.toLowerCase() === email.toLowerCase()) || null;
}

async function createOrUpdateUser() {
  const existing = await findUserByEmail(config.email);
  if (existing) {
    await supabaseFetch(`/auth/v1/admin/users/${existing.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        password: config.password,
        email_confirm: true,
        user_metadata: {
          ...(existing.user_metadata || {}),
          test_user: true
        }
      })
    });
    return existing.id;
  }

  const user = await supabaseFetch('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email: config.email,
      password: config.password,
      email_confirm: true,
      user_metadata: {
        test_user: true
      }
    })
  });

  return user.id;
}

async function upsertActiveSubscription(userId) {
  const periodEnd = new Date();
  periodEnd.setFullYear(periodEnd.getFullYear() + 1);

  const existing = await supabaseFetch(
    `/rest/v1/${config.subscriptionTable}?select=id&user_id=eq.${userId}&limit=1`,
    { method: 'GET' }
  );

  const payload = {
    user_id: userId,
    organization_id: null,
    plan_type: 'personal',
    status: 'active',
    payment_provider: 'test',
    abacatepay_customer_id: `test_customer_${userId}`,
    abacatepay_subscription_id: `test_subscription_${userId}`,
    current_period_end: periodEnd.toISOString(),
    updated_at: new Date().toISOString()
  };

  while (true) {
    try {
      if (existing?.[0]?.id) {
        const rows = await supabaseFetch(`/rest/v1/${config.subscriptionTable}?id=eq.${existing[0].id}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(payload)
        });
        return rows?.[0];
      }

      const rows = await supabaseFetch(`/rest/v1/${config.subscriptionTable}`, {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(payload)
      });
      return rows?.[0];
    } catch (error) {
      const column = missingColumnFromError(error);
      if (!column || !(column in payload)) throw error;

      delete payload[column];
      console.log(`Skipping unavailable column: ${column}`);
    }
  }
}

async function main() {
  config.supabaseUrl = required(config.supabaseUrl, 'SUPABASE_URL');
  config.serviceRoleKey = required(config.serviceRoleKey, 'SUPABASE_SERVICE_ROLE_KEY');

  const userId = await createOrUpdateUser();
  const subscription = await upsertActiveSubscription(userId);

  console.log('Test user ready.');
  console.log(`Email: ${config.email}`);
  console.log(`Password: ${config.password}`);
  console.log(`User ID: ${userId}`);
  console.log(`Subscription ID: ${subscription?.id || '(created)'}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
