import { fireEvent, render, screen } from '@testing-library/react';
import { ApplicationHealthPanel } from './DeploymentWizard';

const URL = 'https://invhub-abanca-dev.symphonyai.dev';

describe('ApplicationHealthPanel', () => {
  it('shows the open-application button once the instance is healthy', () => {
    render(
      <ApplicationHealthPanel
        applicationUrl={URL}
        healthCheck={{
          phase: 'healthy',
          result: {
            healthy: true,
            url: URL,
            healthyPath: '/actuator/health',
            attempts: [],
            checkedAt: '2026-10-08T00:00:00.000Z',
          },
        }}
        onRetry={jest.fn()}
      />,
    );
    expect(
      screen.getByRole('link', { name: /open application/i }),
    ).toHaveAttribute('href', URL);
    expect(screen.getByText('Healthy via /actuator/health')).toBeInTheDocument();
  });

  it('shows the last probe while waiting and hides the open button', () => {
    render(
      <ApplicationHealthPanel
        applicationUrl={URL}
        healthCheck={{
          phase: 'checking',
          result: {
            healthy: false,
            url: URL,
            healthyPath: null,
            attempts: [{ path: '/health', statusCode: 503, error: null }],
            checkedAt: '2026-10-08T00:00:00.000Z',
          },
        }}
        onRetry={jest.fn()}
      />,
    );
    expect(
      screen.getByText(/waiting for the application to report healthy/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/last probe \/health → 503/)).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /open application/i }),
    ).not.toBeInTheDocument();
  });

  it('offers a retry after the health check times out', () => {
    const onRetry = jest.fn();
    render(
      <ApplicationHealthPanel
        applicationUrl={URL}
        healthCheck={{ phase: 'timeout', result: null }}
        onRetry={onRetry}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /check again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
