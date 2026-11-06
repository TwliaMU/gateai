import React from 'react';

// App version comes from package.json via the Vite define in
// vite.config.ts; do not reintroduce a second version constant here.
declare const __GATEAI_VERSION__: string;

export const SiteFooter: React.FC = () => {
  return (
    <footer className="border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 mt-auto">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col sm:flex-row flex-wrap items-center justify-center sm:justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-400 text-center">
        <span className="font-semibold text-zinc-800 dark:text-zinc-200">
          GateAI <span className="font-normal text-zinc-500 dark:text-zinc-400">v{__GATEAI_VERSION__}</span>
        </span>
        <span>云服务：Cloudflare（Pages · Workers · Durable Objects）</span>
        <span>系统维护者：Gemini Muse</span>
      </div>
    </footer>
  );
};
