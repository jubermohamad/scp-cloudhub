CREATE TABLE IF NOT EXISTS github_repository_requests (
    id UUID PRIMARY KEY,
    repository_name VARCHAR(255) NOT NULL,
    description TEXT,
    visibility VARCHAR(50) NOT NULL,
    owner_team VARCHAR(255) NOT NULL,
    template_name VARCHAR(255),
    requested_by VARCHAR(255) NOT NULL,
    github_repo_url TEXT,
    status VARCHAR(50) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_github_repo_requests_created_at
    ON github_repository_requests (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_github_repo_requests_status
    ON github_repository_requests (status);
