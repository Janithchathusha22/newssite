import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

type ToastItem = { id: number; message: string; tone: 'success' | 'danger' | 'neutral' };
type ToastContextValue = { notify: (message: string, tone?: ToastItem['tone']) => void };

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const notify = useCallback((message: string, tone: ToastItem['tone'] = 'success') => {
    const id = Date.now();
    setItems((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), 3600);
  }, []);
  const value = useMemo(() => ({ notify }), [notify]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {items.map((item) => (
          <div className={`toast toast-${item.tone}`} key={item.id}>
            <Icon name={item.tone === 'danger' ? 'warning' : item.tone === 'success' ? 'check' : 'info'} size={18} />
            <span>{item.message}</span>
            <button type="button" aria-label="Dismiss" onClick={() => setItems((current) => current.filter((toast) => toast.id !== item.id))}><Icon name="x" size={15} /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside ToastProvider.');
  return value;
}
