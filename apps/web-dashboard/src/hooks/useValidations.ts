import { useState, useCallback } from 'react';
import { useSharedWs } from './useSharedWs';

export interface Validation {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  value?: string | number;
}

export function useValidations() {
  const [validations, setValidations] = useState<Validation[]>([]);

  useSharedWs(
    useCallback((msg: any) => {
      if (msg.type === 'validations') {
        setValidations((msg.data || []) as Validation[]);
      }
    }, []),
  );

  return validations;
}
