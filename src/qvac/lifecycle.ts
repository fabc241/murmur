// Mirrors iOS app state into the QVAC runtime: suspend() releases sockets and
// stalls registry downloads cleanly in the background; resume() continues them.

import { resume, state, suspend } from '@qvac/sdk';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { hasActiveJobs } from '../pipeline';
import { sdkStarted } from './models';

export function useQvacLifecycle(): void {
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (!sdkStarted) return;
      if (next === 'background') {
        // A running visit pipeline would have its next step rejected while suspended;
        // iOS freezes the process anyway, and the pipeline continues when the app returns.
        if (!hasActiveJobs()) suspend().catch(() => undefined);
      } else if (next === 'active') {
        state()
          .then((s) => (s === 'active' ? undefined : resume()))
          .catch(() => undefined);
      }
    });
    return () => sub.remove();
  }, []);
}
