#!/usr/bin/env node
/**
 * Deploy secrets from .prod.env to Cloudflare Workers
 * Usage: node scripts/deploy-secrets.mjs
 */

import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const prodEnvPath = join(__dirname, '..', '.prod.env');
const tempJsonPath = join(__dirname, '..', '.secrets.json');

// Parse .prod.env file
function parseEnvFile(content) {
  const secrets = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();

    if (key) {
      secrets[key] = value;
    }
  }
  return secrets;
}

try {
  console.log('📦 Reading .prod.env...');
  const envContent = readFileSync(prodEnvPath, 'utf-8');
  const secrets = parseEnvFile(envContent);

  const secretCount = Object.keys(secrets).length;
  if (secretCount === 0) {
    console.log('⚠️  No secrets found in .prod.env');
    process.exit(0);
  }

  console.log(`🔐 Found ${secretCount} secrets: ${Object.keys(secrets).join(', ')}`);

  // Write temporary JSON file for wrangler secret:bulk
  writeFileSync(tempJsonPath, JSON.stringify(secrets, null, 2));

  console.log('🚀 Uploading secrets to Cloudflare...');
  execSync(`npx wrangler secret bulk ${tempJsonPath}`, {
    stdio: 'inherit',
    cwd: join(__dirname, '..')
  });

  console.log('✅ Secrets deployed successfully!');

} catch (error) {
  if (error.code === 'ENOENT') {
    console.error('❌ .prod.env not found. Create it with your production secrets.');
    process.exit(1);
  }
  throw error;
} finally {
  // Clean up temp file
  try {
    unlinkSync(tempJsonPath);
  } catch {}
}
