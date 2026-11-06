import React, { useState } from 'react';
import { Download, Smartphone, Share, PlusSquare, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall.js';

interface PWAInstallButtonProps {
  variant?: 'compact';
  className?: string;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  variant = 'compact',
  className = ''
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [showGenericGuide, setShowGenericGuide] = useState(false);

  // If already running in standalone PWA mode, don't show install prompt
  if (isInstalled) {
    return null;
  }

  const handleTrigger = async () => {
    if (isInstallable) {
      await install();
    } else if (isIOS) {
      setShowIOSGuide(true);
    } else {
      setShowGenericGuide(true);
    }
  };

  const renderContent = () => {
    // Default compact button (for navbars)
    return (
      <button
        onClick={handleTrigger}
        className={`p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:text-emerald-600 dark:hover:text-emerald-400 hover:border-emerald-500/30 transition shadow-xs flex items-center space-x-1 text-xs ${className}`}
        title="安装 App 到桌面"
        aria-label="安装 App 到桌面"
      >
        <Smartphone className="w-3.5 h-3.5" />
        <span className="hidden sm:inline text-xs font-medium">安装 App</span>
      </button>
    );
  };

  return (
    <>
      {renderContent()}

      {/* iOS Safari Installation Guide Modal */}
      {showIOSGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/70 backdrop-blur-xs">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl max-w-sm w-full p-6 shadow-xl space-y-4 animate-in fade-in zoom-in-95 duration-100">
            <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-3">
              <div className="flex items-center space-x-2">
                <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                  <Smartphone className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
                  安装到 iPhone / iPad 桌面
                </h3>
              </div>
              <button
                onClick={() => setShowIOSGuide(false)}
                className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
              <div className="flex items-start space-x-2.5 p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200/60 dark:border-zinc-800/60">
                <div className="w-5 h-5 rounded-md bg-zinc-200 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 flex items-center justify-center font-bold text-[11px] shrink-0 mt-0.5">
                  1
                </div>
                <div>
                  点击 Safari 底部工具栏的 <Share className="w-3.5 h-3.5 inline mx-1 text-blue-500" /> <strong>分享按钮</strong>。
                </div>
              </div>

              <div className="flex items-start space-x-2.5 p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200/60 dark:border-zinc-800/60">
                <div className="w-5 h-5 rounded-md bg-zinc-200 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 flex items-center justify-center font-bold text-[11px] shrink-0 mt-0.5">
                  2
                </div>
                <div>
                  在弹出菜单中向下滑动，找到并点击 <PlusSquare className="w-3.5 h-3.5 inline mx-1 text-zinc-600 dark:text-zinc-400" /> <strong>「添加到主屏幕」</strong>。
                </div>
              </div>

              <div className="flex items-start space-x-2.5 p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200/60 dark:border-zinc-800/60">
                <div className="w-5 h-5 rounded-md bg-zinc-200 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 flex items-center justify-center font-bold text-[11px] shrink-0 mt-0.5">
                  3
                </div>
                <div>
                  右上角点击 <strong>「添加」</strong>，即可在手机桌面独立全屏启动！
                </div>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setShowIOSGuide(false)}
                className="w-full px-4 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 font-semibold text-xs transition"
              >
                我知道了
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Generic Browser Installation Guide Modal */}
      {showGenericGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/70 backdrop-blur-xs">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl max-w-sm w-full p-6 shadow-xl space-y-4 animate-in fade-in zoom-in-95 duration-100">
            <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-3">
              <div className="flex items-center space-x-2">
                <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                  <Smartphone className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
                  安装到桌面端 / 移动设备
                </h3>
              </div>
              <button
                onClick={() => setShowGenericGuide(false)}
                className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2.5 text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
              <p>
                本网关支持标准 <strong>PWA (Progressive Web App)</strong> 技术：
              </p>
              <ul className="list-disc list-inside space-y-1 bg-zinc-50 dark:bg-zinc-950 p-3 rounded-xl border border-zinc-200/60 dark:border-zinc-800/60">
                <li><strong>Chrome / Edge</strong>: 点击地址栏右侧的「安装应用」图标。</li>
                <li><strong>Android 手机</strong>: 点击浏览器菜单选择「添加到主屏幕」或「安装应用」。</li>
                <li><strong>iPhone / iPad</strong>: 使用 Safari 点击「分享」并选择「添加到主屏幕」。</li>
              </ul>
              <p className="text-[11px] text-zinc-500">
                安装后无需每次打开浏览器输入网址，支持离线缓存与原生全屏体验。
              </p>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setShowGenericGuide(false)}
                className="w-full px-4 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 font-semibold text-xs transition"
              >
                好的
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
