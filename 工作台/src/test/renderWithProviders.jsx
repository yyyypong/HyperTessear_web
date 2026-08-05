import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LocaleProvider } from '../i18n';
import { WalletProvider } from '../wallet';

export function renderWithProviders(
  ui,
  {
    initialEntries = ['/'],
    LocaleProviderComponent = LocaleProvider,
    WalletProviderComponent = WalletProvider,
    ...renderOptions
  } = {},
) {
  function Providers({ children }) {
    return (
      <LocaleProviderComponent>
        <WalletProviderComponent>
          <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
        </WalletProviderComponent>
      </LocaleProviderComponent>
    );
  }

  return render(ui, { wrapper: Providers, ...renderOptions });
}
