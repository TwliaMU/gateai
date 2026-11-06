import { useState, useEffect } from 'react';

export type ThemeMode = 'auto' | 'dark' | 'light';

export function useTheme() {
  const readSavedMode = (): ThemeMode => {
    try {
      const saved = localStorage.getItem('theme-mode') as ThemeMode;
      if (saved === 'dark' || saved === 'light' || saved === 'auto') return saved;
    } catch {}
    return 'auto';
  };

  const [mode, setMode] = useState<ThemeMode>(() => {
    if (typeof window !== 'undefined') return readSavedMode();
    return 'auto';
  });

  const [resolvedTheme, setResolvedTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window === 'undefined') return 'dark';
    try {
      const saved = localStorage.getItem('theme-mode');
      if (saved === 'dark') return 'dark';
      if (saved === 'light') return 'light';
    } catch {}
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const applyTheme = () => {
      let isDark = false;
      if (mode === 'dark') {
        isDark = true;
      } else if (mode === 'light') {
        isDark = false;
      } else {
        // Auto / system
        isDark = mediaQuery.matches;
      }

      setResolvedTheme(isDark ? 'dark' : 'light');
      if (isDark) {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
      // Keep the browser chrome / PWA splash colour in sync with the
      // resolved theme (dark #09090b, light white) instead of always dark.
      try {
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', isDark ? '#09090b' : '#ffffff');
      } catch {}
    };

    applyTheme();
    try { localStorage.setItem('theme-mode', mode); } catch {}

    const listener = () => {
      if (mode === 'auto') {
        applyTheme();
      }
    };

    mediaQuery.addEventListener('change', listener);
    return () => mediaQuery.removeEventListener('change', listener);
  }, [mode]);

  return { mode, setMode, resolvedTheme };
}
