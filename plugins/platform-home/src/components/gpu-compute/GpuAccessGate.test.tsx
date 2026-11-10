import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ThemeProvider } from '@mui/material/styles';
import { lightTheme } from '@backstage/theme';

const muiTheme = (lightTheme as any).getTheme ? (lightTheme as any).getTheme('v5') : lightTheme;

const withTheme = (ui: React.ReactElement) => (
  <ThemeProvider theme={muiTheme}>{ui}</ThemeProvider>
);

import { GpuAccessGate } from './GpuAccessGate';
import { useBackendFetch, usePersona } from '@internal/plugin-platform-common';

jest.mock('@internal/plugin-platform-common', () => ({
  ...jest.requireActual('@internal/plugin-platform-common'),
  useBackendFetch: jest.fn(),
  usePersona: jest.fn(),
}));

describe('GpuAccessGate', () => {
  const backendFetch = jest.fn();
  const useBackendFetchMock = useBackendFetch as jest.Mock;
  const usePersonaMock = usePersona as jest.Mock;

  beforeEach(() => {
    backendFetch.mockReset();
    useBackendFetchMock.mockReturnValue(backendFetch);
    usePersonaMock.mockReset();
  });

  it('rechecks GPU authorization when the identity becomes available', async () => {
    let identity: {
      userEntityRef: string;
      ownershipEntityRefs: string[];
    } | null = null;

    usePersonaMock.mockImplementation(() => ({
      persona: 'sre',
      identity,
    }));

    backendFetch
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ authorized: false, role: 'NONE' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ authorized: true, role: 'GPU_USER' }),
      });

    const { rerender } = render(withTheme(
      <GpuAccessGate>
        <div>GPU content</div>
      </GpuAccessGate>,
    ));

    await waitFor(() => {
      expect(screen.getByText('Access Restricted')).toBeInTheDocument();
    });

    identity = {
      userEntityRef: 'user:default/jane.doe',
      ownershipEntityRefs: ['group:default/cloudhub-platform'],
    };

    rerender(withTheme(
      <GpuAccessGate>
        <div>GPU content</div>
      </GpuAccessGate>,
    ));

    await waitFor(() => {
      expect(screen.getByText('GPU content')).toBeInTheDocument();
    });

    expect(backendFetch).toHaveBeenCalledTimes(2);
  });
});