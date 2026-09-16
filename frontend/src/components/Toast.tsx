'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '@/components/Icon';

type ToastTone = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastContextValue {
  notify: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Toasts are announced through `aria-live`, so a screen-reader user is told
 * that an upload succeeded or a retry was queued without having to go looking
 * for the change.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const notify = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, tone, message }]);
    setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 5000);
  }, []);

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto flex animate-slide-in items-start gap-2.5 rounded-xl border px-4 py-3 text-sm shadow-lg ${TONE_CLASSES[toast.tone]}`}
          >
            <Icon name={TONE_ICONS[toast.tone]} size={16} className="mt-0.5" />
            <span className="text-ink-2">{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* Toast surfaces stay opaque (`bg-surface` behind the wash) so a message is
   readable over whatever it lands on top of. */
const TONE_CLASSES: Record<ToastTone, string> = {
  success: 'border-success/25 bg-success-wash text-success',
  error: 'border-danger/25 bg-danger-wash text-danger',
  info: 'border-line bg-surface text-accent',
};

const TONE_ICONS: Record<ToastTone, IconName> = {
  success: 'check',
  error: 'alert',
  info: 'clock',
};

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside a ToastProvider');
  return context;
}
