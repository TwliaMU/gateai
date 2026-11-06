import React from 'react';
import { Sun, Moon, Laptop } from 'lucide-react';
import { useTheme, type ThemeMode } from '../hooks/useTheme.js';

interface ThemeToggleProps {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  resolvedTheme: 'dark' | 'light';
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ mode, setMode }) => {
  const cycleTheme = () => {
    if (mode === 'auto') setMode('dark');
    else if (mode === 'dark') setMode('light');
    else setMode('auto');
  };

  const getLabel = () => {
    if (mode === 'auto') return '系统跟随';
    if (mode === 'dark') return '暗黑模式';
    return '明亮模式';
  };

  return (
    <button
      onClick={cycleTheme}
      className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white transition text-xs font-medium"
      title={`当前: ${getLabel()} (点击切换)`}
    >
      {mode === 'auto' ? (
        <Laptop className="w-3.5 h-3.5" />
      ) : mode === 'dark' ? (
        <Moon className="w-3.5 h-3.5" />
      ) : (
        <Sun className="w-3.5 h-3.5" />
      )}
      <span className="hidden sm:inline">{getLabel()}</span>
    </button>
  );
};
