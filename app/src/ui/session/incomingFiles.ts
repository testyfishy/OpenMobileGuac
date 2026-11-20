/**
 * Consent for files the remote pushes (FIL-1, "Files from the remote"). Pure.
 *
 * Applies to server-initiated `file` streams, which include RDP print jobs (labelled as print
 * jobs in the prompt). Files the user asks for in the file browser are never prompted.
 */

import type { RemoteFilesPolicy } from './settings.ts';

export type IncomingDecision = 'accept' | 'decline' | 'ask';

export function decideIncoming(policy: RemoteFilesPolicy): IncomingDecision {
  switch (policy) {
    case 'accept':
      return 'accept';
    case 'decline':
      return 'decline';
    case 'ask':
      return 'ask';
  }
}
