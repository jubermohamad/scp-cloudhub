import { render, waitFor } from '@testing-library/react';
import { ConfigReader } from '@backstage/config';
import App, { normalizeAppConfigs } from './App';

describe('App', () => {
  it('should render', async () => {
    process.env = {
      NODE_ENV: 'test',
      APP_CONFIG: [
        {
          data: {
            app: { title: 'Test' },
            backend: { baseUrl: 'http://localhost:7007' },
            techdocs: {
              storageUrl: 'http://localhost:7007/api/techdocs/static/docs',
            },
          },
          context: 'test',
        },
      ] as any,
    };

    const rendered = render(App.createRoot());

    await waitFor(() => {
      expect(rendered.baseElement).toBeInTheDocument();
    });
  });

  it('should tolerate scheme-less base URLs in runtime config', async () => {
    process.env = {
      NODE_ENV: 'test',
      APP_CONFIG: [
        {
          data: {
            app: { baseUrl: 'cloudhub.example.com' },
            backend: { baseUrl: 'backend.example.com' },
          },
          context: 'test',
        },
      ] as any,
    };

    const rendered = render(App.createRoot());

    await waitFor(() => {
      expect(rendered.baseElement).toBeInTheDocument();
    });
  });

  it('should fall back to the current origin when no app config is loaded', async () => {
    process.env = {
      NODE_ENV: 'test',
    };

    const rendered = render(App.createRoot());

    await waitFor(() => {
      expect(rendered.baseElement).toBeInTheDocument();
    });
  });

  it('should ensure app.title defaults to CloudHub when missing in config', () => {
    const rawConfigs = [
      {
        data: {
          app: { baseUrl: 'http://localhost:3000' },
          backend: { baseUrl: 'http://localhost:7007' },
        },
        context: 'env',
      },
    ];

    const normalized = normalizeAppConfigs(rawConfigs as any);
    const config = ConfigReader.fromConfigs(normalized);

    expect(config.getString('app.title')).toBe('CloudHub');
    expect(config.getString('app.baseUrl')).toBe('http://localhost:3000');
  });

  it('should preserve existing app.title when configured', () => {
    const rawConfigs = [
      {
        data: {
          app: { title: 'Custom Portal', baseUrl: 'http://localhost:3000' },
        },
        context: 'app-config.yaml',
      },
    ];

    const normalized = normalizeAppConfigs(rawConfigs as any);
    const config = ConfigReader.fromConfigs(normalized);

    expect(config.getString('app.title')).toBe('Custom Portal');
  });
});
