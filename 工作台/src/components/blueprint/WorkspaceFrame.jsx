import { Theme } from '@radix-ui/themes';
import { TransactionProvider } from '../../workspaces/core/transactionStore';

/**
 * Wraps an embedded RoleWorkspacePage with the same Theme + Transaction
 * provider scoping used by the main /workspaces layout, so workspace styles
 * apply when rendered inside the blueprint dual-column pages.
 */
export default function WorkspaceFrame({ children }) {
  return (
    <TransactionProvider>
      <Theme appearance="light" accentColor="blue" radius="medium" className="ht-workspaces">
        {children}
      </Theme>
    </TransactionProvider>
  );
}
