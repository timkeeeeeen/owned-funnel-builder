import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: process.env.PUBLIC_SITE_URL ?? 'https://owned-funnel-builder.pages.dev',
  outDir: './dist/client',
  integrations: [
    sitemap({
      changefreq: 'weekly',
      priority: 0.7,
      lastmod: new Date(),
      filter: (page) =>
        !['/owned-funnel-builder-video-lead/', '/market-opportunity-plan/'].includes(
          new URL(page).pathname
        ),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
