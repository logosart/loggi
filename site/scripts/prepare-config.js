const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '..', 'public');
fs.mkdirSync(publicDir, { recursive: true });

const config = {
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  billingUrl: process.env.BILLING_URL || '',
  downloadUrl: process.env.SOFTWARE_DOWNLOAD_URL || '/downloads/Bipe-Unico.exe'
};

const content = `window.BIPE_SITE_CONFIG = ${JSON.stringify(config, null, 2)};\n`;
fs.writeFileSync(path.join(publicDir, 'config.js'), content, 'utf8');
console.log('Generated public/config.js');
