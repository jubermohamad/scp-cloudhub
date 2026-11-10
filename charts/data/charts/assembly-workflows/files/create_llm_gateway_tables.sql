-- Create LLM Gateway tables in assembly_db
-- This script is executed automatically by PostgreSQL on container initialization

\c assembly_db

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create user_provider_keys table for storing encrypted user API keys
CREATE TABLE IF NOT EXISTS user_provider_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(100) NOT NULL,
    key_type VARCHAR(50) NOT NULL CHECK (key_type IN ('llm', 'github', 'github_copilot', 'atlassian', 'claude_code')),
    key_name VARCHAR(255) NOT NULL,
    api_key_encrypted TEXT NOT NULL,
    key_metadata TEXT,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, key_type)
);

-- Create indexes for user_provider_keys
CREATE INDEX IF NOT EXISTS ix_user_provider_keys_id ON user_provider_keys(id);
CREATE INDEX IF NOT EXISTS ix_user_provider_keys_user_id ON user_provider_keys(user_id);
CREATE INDEX IF NOT EXISTS ix_user_provider_keys_key_type ON user_provider_keys(key_type);

-- Create llm_gateway_keys table for auto-generated gateway authentication keys
CREATE TABLE IF NOT EXISTS llm_gateway_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(100) NOT NULL UNIQUE,
    user_email VARCHAR(255),
    gateway_key VARCHAR(100) NOT NULL UNIQUE,
    key_name VARCHAR(255) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL,
    rate_limit_per_minute INTEGER NOT NULL,
    rate_limit_per_hour INTEGER NOT NULL,
    rate_limit_per_day INTEGER NOT NULL,
    total_requests INTEGER NOT NULL DEFAULT 0,
    total_cost DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    last_used_at TIMESTAMP WITHOUT TIME ZONE,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create indexes for llm_gateway_keys
CREATE INDEX IF NOT EXISTS ix_llm_gateway_keys_id ON llm_gateway_keys(id);
CREATE INDEX IF NOT EXISTS ix_llm_gateway_keys_user_id ON llm_gateway_keys(user_id);
CREATE INDEX IF NOT EXISTS ix_llm_gateway_keys_gateway_key ON llm_gateway_keys(gateway_key);

-- Gateway configuration (single-row, replaces SQLite gateway_config)
CREATE TABLE IF NOT EXISTS gateway_config (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    gateway_api_key_encrypted TEXT NOT NULL,
    gateway_base_url TEXT NOT NULL,
    available_models TEXT,
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
);

-- Custom API keys for gateway access (replaces SQLite api_keys)
CREATE TABLE IF NOT EXISTS gateway_api_keys (
    id SERIAL PRIMARY KEY,
    custom_key VARCHAR(100) UNIQUE NOT NULL,
    key_name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
    last_used_at TIMESTAMP WITHOUT TIME ZONE,
    is_active BOOLEAN DEFAULT TRUE,
    usage_count INTEGER DEFAULT 0,
    total_cost DOUBLE PRECISION DEFAULT 0.0,
    total_tokens BIGINT DEFAULT 0,
    daily_limit_tokens BIGINT,
    daily_limit_cost DOUBLE PRECISION,
    lifetime_limit_tokens BIGINT,
    lifetime_limit_cost DOUBLE PRECISION,
    quota_type VARCHAR(20) DEFAULT 'daily',
    user_id VARCHAR(100),
    user_email VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS ix_gateway_api_keys_custom_key ON gateway_api_keys(custom_key);
CREATE INDEX IF NOT EXISTS ix_gateway_api_keys_user_id ON gateway_api_keys(user_id);

-- LLM API call log (primary usage tracking table)
CREATE TABLE IF NOT EXISTS llm_api_calls (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    model VARCHAR(255),
    endpoint VARCHAR(255),
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    total_tokens INTEGER,
    cached_tokens_info TEXT,
    estimated_cost DOUBLE PRECISION,
    request_payload TEXT,
    response_payload TEXT,
    status_code INTEGER,
    response_time_ms INTEGER,
    cost_non_cached_prompt DOUBLE PRECISION,
    cost_cached_prompt DOUBLE PRECISION,
    cost_completion DOUBLE PRECISION,
    custom_api_key VARCHAR(100),
    api_key_name VARCHAR(255),
    user_id VARCHAR(100),
    user_email VARCHAR(255),
    gateway_instance VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS ix_llm_api_calls_timestamp ON llm_api_calls(timestamp);
CREATE INDEX IF NOT EXISTS ix_llm_api_calls_user_id ON llm_api_calls(user_id);
CREATE INDEX IF NOT EXISTS ix_llm_api_calls_custom_api_key ON llm_api_calls(custom_api_key);
CREATE INDEX IF NOT EXISTS ix_llm_api_calls_model ON llm_api_calls(model);

-- Grant privileges
GRANT ALL PRIVILEGES ON TABLE user_provider_keys TO assembly;
GRANT ALL PRIVILEGES ON TABLE llm_gateway_keys TO assembly;
GRANT ALL PRIVILEGES ON TABLE gateway_config TO assembly;
GRANT ALL PRIVILEGES ON TABLE gateway_api_keys TO assembly;
GRANT ALL PRIVILEGES ON TABLE llm_api_calls TO assembly;
GRANT USAGE, SELECT ON SEQUENCE gateway_api_keys_id_seq TO assembly;
GRANT USAGE, SELECT ON SEQUENCE llm_api_calls_id_seq TO assembly;
