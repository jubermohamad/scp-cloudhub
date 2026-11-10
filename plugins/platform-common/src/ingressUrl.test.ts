import { calculateIngressTarget } from './ingressUrl';

describe('calculateIngressTarget', () => {
  it('builds the non-prod URL from a namespace-style instance name', () => {
    expect(
      calculateIngressTarget({
        application: 'invhub',
        customer: 'Abanca',
        instanceName: 'invhub-abanca-dt-juber-poc3',
        environment: 'dev',
      }),
    ).toEqual({
      hostname: 'invhub-abanca-dt-juber-poc3',
      zone: 'symphonyai.dev',
      fqdn: 'invhub-abanca-dt-juber-poc3.symphonyai.dev',
      url: 'https://invhub-abanca-dt-juber-poc3.symphonyai.dev',
    });
  });

  it('strips pipeline-internal app aliases and the customer code', () => {
    expect(
      calculateIngressTarget({
        application: 'invhub',
        customer: 'abanca',
        instanceName: 'ih-abanca-dev',
        environment: 'dev',
      })?.fqdn,
    ).toBe('invhub-abanca-dev.symphonyai.dev');
    expect(
      calculateIngressTarget({
        application: 'netrevealv96',
        customer: 'absa',
        instanceName: 'nr-absa-preprod',
      })?.fqdn,
    ).toBe('netrevealv96-absa-preprod.symphonyai.dev');
  });

  it('uses the symphonyai.cloud zone for production', () => {
    expect(
      calculateIngressTarget({
        application: 'invhub',
        customer: 'abanca',
        instanceName: 'prod-01',
        environment: 'PROD',
      })?.url,
    ).toBe('https://invhub-abanca-prod-01.symphonyai.cloud');
  });

  it('omits the suffix when the instance is only alias and customer', () => {
    expect(
      calculateIngressTarget({
        application: 'invhub',
        customer: 'abanca',
        instanceName: 'ih-abanca',
      })?.hostname,
    ).toBe('invhub-abanca');
  });

  it('normalizes characters that are invalid in DNS labels', () => {
    expect(
      calculateIngressTarget({
        application: 'invhub',
        customer: 'Abanca S.A.',
        instanceName: 'Juber_POC (3)',
      })?.hostname,
    ).toBe('invhub-abanca-s-a-juber-poc-3');
  });

  it('returns null for incomplete or overlong input', () => {
    expect(
      calculateIngressTarget({ application: 'invhub', customer: 'abanca' }),
    ).toBeNull();
    expect(
      calculateIngressTarget({
        application: 'invhub',
        customer: 'abanca',
        instanceName: 'x'.repeat(70),
      }),
    ).toBeNull();
  });
});
