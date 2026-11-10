import {
  createSignInResolverFactory,
  type OAuthAuthenticatorResult,
  type PassportProfile,
} from '@backstage/plugin-auth-node';
import { createCloudHubAzureCredential } from '@internal/plugin-platform-common/backend';

export const SYMPHONY_USER_NAMESPACE = 'symphonysensa';
export const SYMPHONY_EMAIL_DOMAIN = 'symphonysensa.com';
export const CLOUDHUB_LOGIN_ALLOW_GROUP_ID =
  '7cb52fd1-0e7d-4722-abab-35de25f99ec2';
export const CLOUDHUB_PLATFORM_OWNERS_GROUP_ID =
  '9d54f155-828d-4a05-8992-a05996f806ef';
export const CLOUDHUB_DATA_EXPORT_GROUP_ID =
  'ea5a79c7-5b88-4108-9c2e-9e88bffff673';

const LOGIN_ALLOW_GROUP_REF = 'group:default/cloudhub-login-allow';
const PLATFORM_OWNERS_GROUP_REF = 'group:default/cloudhubplatformowners';
const DATA_EXPORT_GROUP_REF = 'group:default/grp-cloudhub-data-export';

// Requires admin-consented Microsoft Graph application permission
// GroupMember.Read.All on CloudHub's canonical platform service principal.
// The user-facing OAuth flow remains configured separately via AUTH_MICROSOFT_*.
async function getVerifiedEntraGroups(userIdOrUpn: string): Promise<string[]> {
  const loginAllowGroupId =
    process.env.CLOUDHUB_LOGIN_ALLOW_GROUP_ID?.trim() ||
    CLOUDHUB_LOGIN_ALLOW_GROUP_ID;
  const platformOwnersGroupId =
    process.env.CLOUDHUB_PLATFORM_OWNERS_GROUP_ID?.trim() ||
    CLOUDHUB_PLATFORM_OWNERS_GROUP_ID;
  const dataExportGroupId =
    process.env.CLOUDHUB_DATA_EXPORT_GROUP_ID?.trim() ||
    CLOUDHUB_DATA_EXPORT_GROUP_ID;
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error(
      'Entra group verification needs AZURE_TENANT_ID, AZURE_CLIENT_ID, and AZURE_CLIENT_SECRET for the CloudHub platform service principal. The Microsoft sign-in app credentials cannot verify group membership.',
    );
  }

  let token: string;
  try {
    const credential = createCloudHubAzureCredential();
    const accessToken = await credential.getToken(
      'https://graph.microsoft.com/.default',
    );
    if (!accessToken?.token) {
      throw new Error('Microsoft Graph returned no access token');
    }
    token = accessToken.token;
  } catch {
    throw new Error(
      'Unable to verify Entra group membership. Contact the CloudHub administrator.',
    );
  }

  let response: Response;
  try {
    response = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
        userIdOrUpn,
      )}/checkMemberGroups`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          groupIds: [loginAllowGroupId, platformOwnersGroupId, dataExportGroupId],
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    throw new Error(
      'Unable to verify Entra group membership. Contact the CloudHub administrator.',
    );
  }

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error(
        'The platform service principal cannot read Entra group membership. Grant admin consent for the Microsoft Graph application permission GroupMember.Read.All, then restart CloudHub.',
      );
    }
    throw new Error(
      `Unable to verify Entra group membership (Microsoft Graph HTTP ${response.status}). Contact the CloudHub administrator.`,
    );
  }

  const body = (await response.json()) as { value?: unknown };
  if (!Array.isArray(body.value)) {
    throw new Error(
      'Unable to verify Entra group membership. Contact the CloudHub administrator.',
    );
  }
  return body.value.filter(
    (value): value is string => typeof value === 'string',
  );
}

/**
 * Resolves Symphony Entra accounts to a namespaced catalog User. Requiring the
 * catalog entity keeps its ownership groups and profile attached to the issued
 * Backstage identity.
 */
export const symphonyMicrosoftSignInResolver = createSignInResolverFactory<
  OAuthAuthenticatorResult<PassportProfile>
>({
  create() {
    return async (info, ctx) => {
      const profile = info.result
        .fullProfile as typeof info.result.fullProfile & {
        upn?: string;
        mail?: string;
        emails?: Array<{ value?: string }>;
        _json?: {
          userPrincipalName?: string;
          mail?: string;
        };
      };
      const email = (
        profile._json?.userPrincipalName ||
        profile.upn ||
        profile._json?.mail ||
        profile.mail ||
        profile.emails?.[0]?.value ||
        profile.email ||
        ''
      )
        .trim()
        .toLowerCase();
      const separator = email.lastIndexOf('@');
      if (
        separator <= 0 ||
        email.slice(separator + 1) !== SYMPHONY_EMAIL_DOMAIN
      ) {
        throw new Error(
          `Sign-in requires an @${SYMPHONY_EMAIL_DOMAIN} Entra account`,
        );
      }

      const rawUsername = email.slice(0, separator);
      const username = rawUsername
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
      if (!username) {
        throw new Error(
          'Microsoft Entra profile contains an invalid email address',
        );
      }

      const userEntityRef = `user:${SYMPHONY_USER_NAMESPACE}/${username}`;
      const entraUserId = profile.id?.trim() || email;
      const memberships = await getVerifiedEntraGroups(entraUserId);
      const loginAllowGroupId =
        process.env.CLOUDHUB_LOGIN_ALLOW_GROUP_ID?.trim() ||
        CLOUDHUB_LOGIN_ALLOW_GROUP_ID;
      const platformOwnersGroupId =
        process.env.CLOUDHUB_PLATFORM_OWNERS_GROUP_ID?.trim() ||
        CLOUDHUB_PLATFORM_OWNERS_GROUP_ID;
      const dataExportGroupId =
        process.env.CLOUDHUB_DATA_EXPORT_GROUP_ID?.trim() ||
        CLOUDHUB_DATA_EXPORT_GROUP_ID;
      if (!memberships.includes(loginAllowGroupId)) {
        throw new Error(
          'Access denied. Request membership in the Entra group cloudhub-login-allow to sign in to CloudHub.',
        );
      }

      await ctx.findCatalogUser({
        entityRef: userEntityRef,
      });
      const entitlements = [userEntityRef, LOGIN_ALLOW_GROUP_REF];
      if (memberships.includes(platformOwnersGroupId)) {
        entitlements.push(PLATFORM_OWNERS_GROUP_REF);
      }
      if (memberships.includes(dataExportGroupId)) {
        entitlements.push(DATA_EXPORT_GROUP_REF);
      }

      // Derive role-bearing entitlements from live Entra membership, not static
      // catalog membership, so the catalog cannot grant admin privileges.
      return ctx.issueToken({
        claims: {
          sub: userEntityRef,
          ent: entitlements,
        },
      });
    };
  },
});
