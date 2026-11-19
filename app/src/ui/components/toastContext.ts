import { createContext, useContext } from 'react';

/** Short, polite status messages ("Link copied") for the app chrome. */
export interface ToastApi {
  readonly show: (text: string) => void;
}

export const ToastContext = createContext<ToastApi>({ show: () => undefined });

export function useToast(): ToastApi {
  return useContext(ToastContext);
}
