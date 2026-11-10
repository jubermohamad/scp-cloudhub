import type { LoggerService } from '@backstage/backend-plugin-api';

export interface PlatformServicesRequest {
  username: string;
  workspaceName: string;
  dependencies: string[];
}

export interface PlatformServicesResponse {
  postgres?: {
    host: string;
    port: number;
    database: string;
    user: string;
  };
  kafka?: {
    bootstrap: string;
  };
  redis?: {
    host: string;
    port: number;
  };
  temporal?: {
    host: string;
    port: number;
  };
  minio?: {
    host: string;
    port: number;
    bucket: string;
  };
  env: Record<string, string>;
}

export class PlatformService {
  constructor(private readonly logger: LoggerService) {}

  /**
   * Get connection details for platform services
   * These are SHARED services, not dedicated per developer
   */
  async getPlatformServices(
    req: PlatformServicesRequest,
  ): Promise<PlatformServicesResponse> {
    const response: PlatformServicesResponse = {
      env: {},
    };

    const schemaName = `dev_${req.username.replace(/[^a-z0-9]/g, '_')}`;

    // PostgreSQL - Shared instance, isolated by schema
    if (req.dependencies.includes('postgres')) {
      const postgresHost =
        process.env.SRI_POSTGRES_HOST || 'postgres.sri-platform-services';
      const postgresPort = parseInt(
        process.env.SRI_POSTGRES_PORT || '5432',
        10,
      );
      const postgresDb = process.env.SRI_POSTGRES_DB || 'sri_dev';
      const postgresUser = process.env.SRI_POSTGRES_USER || 'sri_dev_user';

      const postgres = {
        host: postgresHost,
        port: postgresPort,
        database: postgresDb,
        user: postgresUser,
      };
      response.postgres = postgres;
      response.env = {
        ...response.env,
        POSTGRES_HOST: postgres.host,
        POSTGRES_PORT: String(postgres.port),
        POSTGRES_DB: postgres.database,
        POSTGRES_SCHEMA: schemaName,
        POSTGRES_USER: postgres.user,
      };
      this.logger.debug(
        `[platform-service] Postgres configured for ${req.username}: schema=${schemaName}`,
      );
    }

    // Kafka - Shared instance, isolated by consumer group + topic prefix
    if (req.dependencies.includes('kafka')) {
      const kafkaBootstrap =
        process.env.SRI_KAFKA_BOOTSTRAP || 'kafka.sri-platform-services:9092';

      const kafka = {
        bootstrap: kafkaBootstrap,
      };
      response.kafka = kafka;
      response.env = {
        ...response.env,
        KAFKA_BOOTSTRAP: kafka.bootstrap,
        KAFKA_CONSUMER_GROUP: `dev_${req.username.replace(/[^a-z0-9]/g, '_')}_${
          req.workspaceName
        }`,
        KAFKA_TOPIC_PREFIX: `dev.${req.username.replace(/[^a-z0-9]/g, '_')}`,
      };
      this.logger.debug(
        `[platform-service] Kafka configured for ${req.username}`,
      );
    }

    // Redis - Shared instance, isolated by key prefix
    if (req.dependencies.includes('redis')) {
      const redisHost =
        process.env.SRI_REDIS_HOST || 'redis.sri-platform-services';
      const redisPort = parseInt(process.env.SRI_REDIS_PORT || '6379', 10);

      const redis = {
        host: redisHost,
        port: redisPort,
      };
      response.redis = redis;
      response.env = {
        ...response.env,
        REDIS_HOST: redis.host,
        REDIS_PORT: String(redis.port),
        REDIS_KEY_PREFIX: `dev:${req.username.replace(/[^a-z0-9]/g, '_')}:`,
      };
      this.logger.debug(
        `[platform-service] Redis configured for ${req.username}`,
      );
    }

    // Temporal - Shared instance, isolated by namespace
    if (req.dependencies.includes('temporal')) {
      const temporalHost =
        process.env.SRI_TEMPORAL_HOST || 'temporal.sri-platform-services';
      const temporalPort = parseInt(
        process.env.SRI_TEMPORAL_PORT || '7233',
        10,
      );

      const temporal = {
        host: temporalHost,
        port: temporalPort,
      };
      response.temporal = temporal;
      response.env = {
        ...response.env,
        TEMPORAL_HOST: `${temporal.host}:${temporal.port}`,
        TEMPORAL_NAMESPACE: `dev_${req.username.replace(/[^a-z0-9]/g, '_')}`,
      };
      this.logger.debug(
        `[platform-service] Temporal configured for ${req.username}`,
      );
    }

    // Object Storage (MinIO/S3) - Dedicated bucket per developer
    if (req.dependencies.includes('object-storage')) {
      const minioHost =
        process.env.SRI_MINIO_HOST || 'minio.sri-platform-services';
      const minioPort = parseInt(process.env.SRI_MINIO_PORT || '9000', 10);

      const minio = {
        host: minioHost,
        port: minioPort,
        bucket: `dev-${req.username.replace(/[^a-z0-9]/g, '-')}-${
          req.workspaceName
        }`,
      };
      response.minio = minio;
      response.env = {
        ...response.env,
        MINIO_HOST: minio.host,
        MINIO_PORT: String(minio.port),
        MINIO_BUCKET: minio.bucket,
      };
      this.logger.debug(
        `[platform-service] MinIO configured for ${req.username}: bucket=${minio.bucket}`,
      );
    }

    return response;
  }
}
