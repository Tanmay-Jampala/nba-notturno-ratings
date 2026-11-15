import { defineConfig } from 'astro/config';

// GitHub Pages serves the project at /<repo>/ — REPO is set by the workflow (defaults to the repo name).
const repo = process.env.REPO_NAME ?? 'nba-notturno-ratings';
const owner = process.env.REPO_OWNER ?? 'tanmay-jampala';

export default defineConfig({
  site: `https://${owner.toLowerCase()}.github.io`,
  base: `/${repo}/`,
  trailingSlash: 'always',
  build: { format: 'directory' },
  vite: { build: { assetsInlineLimit: 0 } },
});
