const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const envPath = path.join(rootDir, '.env');
const outputPath = path.join(rootDir, 'src', 'app-config.json');

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
  ...parseEnvFile(envPath),
  ...process.env
};

const publicConfig = {
  supabaseUrl: env.SUPABASE_URL || '',
  supabaseAnonKey: env.SUPABASE_ANON_KEY || '',
  subscriptionTable: env.SUBSCRIPTION_TABLE || 'subscriptions',
  billingUrl: env.BILLING_URL || ''
};

const missing = [];
if (!publicConfig.supabaseUrl) missing.push('SUPABASE_URL');
if (!publicConfig.supabaseAnonKey) missing.push('SUPABASE_ANON_KEY');
if (!publicConfig.billingUrl) missing.push('BILLING_URL');

if (missing.length) {
  console.error(`Missing public desktop config: ${missing.join(', ')}`);
  console.error('Create .env from .env.example or set these variables before building.');
  process.exit(1);
}

fs.writeFileSync(outputPath, `${JSON.stringify(publicConfig, null, 2)}\n`);
console.log(`Wrote ${path.relative(rootDir, outputPath)} for the desktop build.`);
