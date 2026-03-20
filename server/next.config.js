const path = require('path');
const { execSync } = require('child_process');
const createNextIntlPlugin = require('next-intl/plugin');
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: path.join(__dirname, '../'),
  env: {
    NEXT_PUBLIC_APP_VERSION: require('./package.json').version,
    NEXT_PUBLIC_BUILD_SHA: process.env.BUILD_SHA ||
      (() => { try { return execSync('git rev-parse --short HEAD 2>/dev/null').toString().trim() } catch { return 'dev' } })(),
    NEXT_PUBLIC_BUILD_DATE: new Date().toISOString(),
  },
}

module.exports = withNextIntl(nextConfig)
