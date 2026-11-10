/**
 * CloudHub Cluster Tag Validator
 *
 * Centralizes all tag-based eligibility logic for AKS cluster onboarding.
 * This utility ensures consistent tag evaluation across discovery, filtering,
 * and validation operations.
 *
 * Tag Schema:
 * - cloudhub-enabled: "true" | "false" (platform acceptance)
 * - cloudhub-onboarded: "true" | "false" (operator approval)
 *
 * A cluster is deployable ONLY when BOTH tags are "true".
 */

export interface ClusterTags {
  [key: string]: string | undefined;
}

function normalizeTags(
  tags: ClusterTags | undefined | null,
): Record<string, string> {
  if (!tags || typeof tags !== 'object') {
    return {};
  }

  return Object.entries(tags).reduce<Record<string, string>>((acc, entry) => {
    const [rawKey, rawValue] = entry;
    const key = rawKey.trim().toLowerCase();
    if (!key || typeof rawValue !== 'string') {
      return acc;
    }

    acc[key] = rawValue.trim();
    return acc;
  }, {});
}

function isTrueLike(value: string | undefined): boolean {
  return Boolean(value && value.toLowerCase() === 'true');
}

export class ClusterTagValidator {
  /**
   * Tag keys used for CloudHub cluster eligibility
   */
  static readonly REQUIRED_TAGS = {
    ENABLED: 'cloudhub-enabled',
    ONBOARDED: 'cloudhub-onboarded',
  } as const;

  /**
   * Optional tag keys for future use (metadata, audit trail)
   */
  static readonly OPTIONAL_TAGS = {
    ENVIRONMENT: 'cloudhub-environment',
    OWNER: 'cloudhub-owner',
    STATUS: 'cloudhub-status',
  } as const;

  /**
   * Check if a cluster is eligible for CloudHub deployments.
   *
   * Eligibility requires:
   * 1. cloudhub-enabled = "true"
   * 2. cloudhub-onboarded = "true"
   *
   * @param tags - Cluster tags object (or undefined/null)
   * @returns true if cluster is eligible, false otherwise
   */
  static isCloudHubEligible(tags: ClusterTags | undefined | null): boolean {
    const normalized = normalizeTags(tags);
    const enabled = normalized[this.REQUIRED_TAGS.ENABLED];
    const onboarded = normalized[this.REQUIRED_TAGS.ONBOARDED];

    return isTrueLike(enabled) && isTrueLike(onboarded);
  }

  /**
   * Get a detailed eligibility report for a cluster.
   *
   * Useful for diagnostics and admin UIs.
   *
   * @param tags - Cluster tags object
   * @returns Object with individual tag status and overall eligibility
   */
  static getEligibilityReport(tags: ClusterTags | undefined | null): {
    isEligible: boolean;
    enabled: boolean;
    onboarded: boolean;
    missingTags: string[];
  } {
    const tagsObj = normalizeTags(tags);
    const enabled = isTrueLike(tagsObj[this.REQUIRED_TAGS.ENABLED]);
    const onboarded = isTrueLike(tagsObj[this.REQUIRED_TAGS.ONBOARDED]);

    const missingTags: string[] = [];
    if (!tagsObj[this.REQUIRED_TAGS.ENABLED]) {
      missingTags.push(this.REQUIRED_TAGS.ENABLED);
    }
    if (!tagsObj[this.REQUIRED_TAGS.ONBOARDED]) {
      missingTags.push(this.REQUIRED_TAGS.ONBOARDED);
    }

    return {
      isEligible: enabled && onboarded,
      enabled,
      onboarded,
      missingTags,
    };
  }

  /**
   * Create the standard CloudHub tags for onboarding.
   *
   * @param enabled - Whether platform accepts this cluster
   * @param onboarded - Whether operator has approved this cluster
   * @returns Tags object ready for Azure Tag API
   */
  static createCloudHubTags(
    enabled: boolean = true,
    onboarded: boolean = false,
  ): Record<string, string> {
    return {
      [this.REQUIRED_TAGS.ENABLED]: enabled ? 'true' : 'false',
      [this.REQUIRED_TAGS.ONBOARDED]: onboarded ? 'true' : 'false',
    };
  }

  /**
   * Merge new CloudHub tags with existing tags.
   *
   * Preserves non-CloudHub tags and overwrites CloudHub tags.
   *
   * @param existingTags - Current cluster tags (or undefined)
   * @param cloudHubTags - New CloudHub-specific tags to apply
   * @returns Merged tags object
   */
  static mergeCloudHubTags(
    existingTags: ClusterTags | undefined | null,
    cloudHubTags: Partial<Record<string, string>>,
  ): Record<string, string> {
    const merged: Record<string, string> = {};

    // Copy existing tags (only defined values)
    if (existingTags) {
      Object.entries(existingTags).forEach(([key, value]) => {
        if (value !== undefined) {
          merged[key] = value;
        }
      });
    }

    // Overwrite only CloudHub-related tags
    Object.entries(cloudHubTags).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        merged[key] = String(value);
      }
    });

    return merged;
  }

  /**
   * Validate tag values (format/content checking).
   *
   * @param tags - Tags to validate
   * @returns Array of validation errors (empty if valid)
   */
  static validateTagFormat(tags: Record<string, string>): string[] {
    const errors: string[] = [];

    const requiredTagValues = Object.values(this.REQUIRED_TAGS);
    for (const tagKey of requiredTagValues) {
      if (tagKey in tags) {
        const value = tags[tagKey];
        if (value !== 'true' && value !== 'false') {
          errors.push(
            `Tag ${tagKey} must be "true" or "false", got "${value}"`,
          );
        }
      }
    }

    return errors;
  }
}
