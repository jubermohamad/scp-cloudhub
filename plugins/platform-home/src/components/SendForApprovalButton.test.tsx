/**
 * SendForApprovalButton.test.tsx
 *
 * Component tests for SendForApprovalButton
 * Tests the approval submission flow, polling mechanism, and status updates
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { lightTheme } from '@backstage/theme';

const muiTheme = (lightTheme as any).getTheme ? (lightTheme as any).getTheme('v5') : lightTheme;

const renderWithTheme = (ui: React.ReactElement) => render(<ThemeProvider theme={muiTheme}>{ui}</ThemeProvider>);
import { SendForApprovalButton } from './SendForApprovalButton';
import * as backendFetchModule from '@internal/plugin-platform-common';

// Mock the backend fetch hook
jest.mock('@internal/plugin-platform-common', () => ({
  useBackendFetch: jest.fn(),
}));

describe('SendForApprovalButton', () => {
  let mockBackendFetch: jest.Mock;
  let defaultProps: {
    config: {
      component: string;
      instance: string;
      helmfile: string;
      config: { env: string };
    };
    disabled: boolean;
    onApprovalSubmitted: jest.Mock;
    onApprovalApproved: jest.Mock;
    onApprovalRejected: jest.Mock;
  };

  beforeEach(() => {
    mockBackendFetch = jest.fn();
    defaultProps = {
      config: {
        component: 'sri-investigation',
        instance: 'dt-test-001',
        helmfile: 'releases:\n  - name: test',
        config: { env: 'dev' },
      },
      disabled: false,
      onApprovalSubmitted: jest.fn(),
      onApprovalApproved: jest.fn(),
      onApprovalRejected: jest.fn(),
    };
    (backendFetchModule.useBackendFetch as jest.Mock).mockReturnValue(
      mockBackendFetch,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  describe('Initial Render', () => {
    it('should render the Send For Approval button', () => {
      renderWithTheme(<SendForApprovalButton {...defaultProps} />);
      const button = screen.getByRole('button', { name: /Send For Approval/i });
      expect(button).toBeInTheDocument();
      expect(button).toBeEnabled();
    });

    it('should render Preview Helmfile button', () => {
      renderWithTheme(<SendForApprovalButton {...defaultProps} />);
      const previewButton = screen.getByRole('button', {
        name: /Preview Helmfile/i,
      });
      expect(previewButton).toBeInTheDocument();
    });

    it('should disable buttons when disabled prop is true', () => {
      renderWithTheme(<SendForApprovalButton {...defaultProps} disabled />);
      const buttons = screen.getAllByRole('button');
      buttons.forEach(button => {
        expect(button).toBeDisabled();
      });
    });
  });

  describe('Approval Submission', () => {
    it('should submit approval when button is clicked', async () => {
      const mockResponse = new Response(
        JSON.stringify({ id: 'approval-123', status: 'PENDING' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );

      mockBackendFetch.mockResolvedValueOnce(mockResponse);

      renderWithTheme(<SendForApprovalButton {...defaultProps} />);
      const button = screen.getByRole('button', { name: /Send For Approval/i });

      await userEvent.click(button);

      await waitFor(() => {
        expect(mockBackendFetch).toHaveBeenCalledWith(
          'deployment-control-plane',
          '/deployments/approvals',
          expect.objectContaining({
            method: 'POST',
          }),
        );
      });

      expect(defaultProps.onApprovalSubmitted).toHaveBeenCalledWith(
        'approval-123',
      );
    });

    it('should show loading spinner while submitting', async () => {
      const mockResponse = new Promise(resolve =>
        setTimeout(
          () =>
            resolve(
              new Response(
                JSON.stringify({ id: 'approval-123', status: 'PENDING' }),
                { status: 200 },
              ),
            ),
          500,
        ),
      );

      mockBackendFetch.mockReturnValueOnce(mockResponse);

      renderWithTheme(<SendForApprovalButton {...defaultProps} />);
      const button = screen.getByRole('button', { name: /Send For Approval/i });

      await userEvent.click(button);

      // Button should show "Submitting…" while loading
      await waitFor(() => {
        expect(button).toHaveTextContent(/Submitting/i);
      });
    });

    it('should handle submission errors', async () => {
      const errorResponse = new Response(
        JSON.stringify({ error: 'Invalid config' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );

      mockBackendFetch.mockResolvedValueOnce(errorResponse);

      renderWithTheme(<SendForApprovalButton {...defaultProps} />);
      const button = screen.getByRole('button', { name: /Send For Approval/i });

      await userEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText(/Invalid config/i)).toBeInTheDocument();
      });

      expect(defaultProps.onApprovalSubmitted).not.toHaveBeenCalled();
    });
  });

  describe('Approval Status Polling', () => {
    it('should poll for approval status after submission', async () => {
      const submitResponse = new Response(
        JSON.stringify({ id: 'approval-123', status: 'PENDING' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );

      const pollResponse = new Response(
        JSON.stringify({
          id: 'approval-123',
          status: 'APPROVED',
          approvedBy: 'admin@example.com',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );

      mockBackendFetch
        .mockResolvedValueOnce(submitResponse)
        .mockResolvedValueOnce(pollResponse);

      renderWithTheme(<SendForApprovalButton {...defaultProps} />);
      const button = screen.getByRole('button', { name: /Send For Approval/i });

      await userEvent.click(button);

      await waitFor(
        () => {
          expect(mockBackendFetch).toHaveBeenCalledWith(
            'deployment-control-plane',
            '/deployments/approvals/approval-123',
            expect.objectContaining({
              method: 'GET',
            }),
          );
        },
        { timeout: 20000 },
      );
    });

    it('should show PENDING status while waiting', async () => {
      const submitResponse = new Response(
        JSON.stringify({ id: 'approval-123', status: 'PENDING' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );

      mockBackendFetch.mockResolvedValueOnce(submitResponse);

      renderWithTheme(<SendForApprovalButton {...defaultProps} />);
      const button = screen.getByRole('button', { name: /Send For Approval/i });

      await userEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText(/Waiting for approval/i)).toBeInTheDocument();
      });
    });

    it('should call onApprovalApproved when status becomes APPROVED', async () => {
      const submitResponse = new Response(
        JSON.stringify({ id: 'approval-123', status: 'PENDING' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );

      const approvedResponse = new Response(
        JSON.stringify({
          id: 'approval-123',
          status: 'APPROVED',
          approvedBy: 'admin@example.com',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );

      mockBackendFetch
        .mockResolvedValueOnce(submitResponse)
        .mockResolvedValueOnce(approvedResponse);

      renderWithTheme(<SendForApprovalButton {...defaultProps} />);
      const button = screen.getByRole('button', { name: /Send For Approval/i });

      await userEvent.click(button);

      await waitFor(
        () => {
          expect(defaultProps.onApprovalApproved).toHaveBeenCalled();
        },
        { timeout: 20000 },
      );

      // Should show success message
      expect(screen.getByText(/Approved/i)).toBeInTheDocument();
    });

    it('should call onApprovalRejected when status becomes REJECTED', async () => {
      const submitResponse = new Response(
        JSON.stringify({ id: 'approval-123', status: 'PENDING' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );

      const rejectedResponse = new Response(
        JSON.stringify({
          id: 'approval-123',
          status: 'REJECTED',
          reason: 'Invalid namespace',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );

      mockBackendFetch
        .mockResolvedValueOnce(submitResponse)
        .mockResolvedValueOnce(rejectedResponse);

      renderWithTheme(<SendForApprovalButton {...defaultProps} />);
      const button = screen.getByRole('button', { name: /Send For Approval/i });

      await userEvent.click(button);

      await waitFor(
        () => {
          expect(defaultProps.onApprovalRejected).toHaveBeenCalledWith(
            'Invalid namespace',
          );
        },
        { timeout: 20000 },
      );

      expect(screen.getByText(/Rejected/i)).toBeInTheDocument();
    });
  });

  describe('Preview Helmfile Dialog', () => {
    it('should open preview dialog when Preview button is clicked', async () => {
      renderWithTheme(<SendForApprovalButton {...defaultProps} />);
      const previewButton = screen.getByRole('button', {
        name: /Preview Helmfile/i,
      });

      await userEvent.click(previewButton);

      expect(screen.getByText(/Helmfile Preview/i)).toBeInTheDocument();
      expect(screen.getByText(/releases:/)).toBeInTheDocument();
    });

    it('should close preview dialog when Close is clicked', async () => {
      renderWithTheme(<SendForApprovalButton {...defaultProps} />);
      const previewButton = screen.getByRole('button', {
        name: /Preview Helmfile/i,
      });

      await userEvent.click(previewButton);

      await waitFor(() => {
        expect(screen.getByText(/Helmfile Preview/i)).toBeInTheDocument();
      });

      const closeButton = screen.getByRole('button', { name: /Close/i });
      await userEvent.click(closeButton);

      await waitFor(() => {
        expect(screen.queryByText(/Helmfile Preview/i)).not.toBeInTheDocument();
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty Helmfile gracefully', () => {
      const props = {
        ...defaultProps,
        config: {
          ...defaultProps.config,
          helmfile: '',
        },
      };

      renderWithTheme(<SendForApprovalButton {...props} />);
      const button = screen.getByRole('button', { name: /Send For Approval/i });

      expect(button).toBeInTheDocument();
    });

    it('should handle null callbacks gracefully', async () => {
      const props = {
        ...defaultProps,
        onApprovalSubmitted: undefined,
        onApprovalApproved: undefined,
        onApprovalRejected: undefined,
      };

      const submitResponse = new Response(
        JSON.stringify({ id: 'approval-123', status: 'PENDING' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );

      mockBackendFetch.mockResolvedValueOnce(submitResponse);

      renderWithTheme(<SendForApprovalButton {...props} />);
      const button = screen.getByRole('button', { name: /Send For Approval/i });

      // Should not crash
      await userEvent.click(button);

      await waitFor(() => {
        expect(mockBackendFetch).toHaveBeenCalled();
      });
    });

    it('should cleanup polling on unmount', async () => {
      const submitResponse = new Response(
        JSON.stringify({ id: 'approval-123', status: 'PENDING' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );

      mockBackendFetch.mockResolvedValueOnce(submitResponse);

      const { unmount } = renderWithTheme(<SendForApprovalButton {...defaultProps} />);
      const button = screen.getByRole('button', { name: /Send For Approval/i });

      await userEvent.click(button);

      unmount();

      expect(mockBackendFetch).toHaveBeenCalled();
    });
  });
});
