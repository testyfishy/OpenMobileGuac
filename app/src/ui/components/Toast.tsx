import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ToastContext } from './toastContext.ts';

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const show = useCallback((text: string) => setToast({ id: Date.now(), text }), []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  const api = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {toast ? (
          <div key={toast.id} className="toast">
            {toast.text}
          </div>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}
