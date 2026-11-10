import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';

const databaseConfigured = Boolean(
  process.env.DATABASE_URL || process.env.POSTGRES_HOST || process.env.PGHOST,
);

const suite = databaseConfigured ? describe : describe.skip;

suite('deployment job cursor persistence', () => {
  let pool: Pool;
  const deploymentId = '00000000-0000-0000-0000-000000000091';

  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      host: process.env.DATABASE_URL ? undefined : process.env.POSTGRES_HOST ?? process.env.PGHOST,
      port: process.env.DATABASE_URL ? undefined : Number(process.env.POSTGRES_PORT ?? process.env.PGPORT ?? 5432),
      database: process.env.DATABASE_URL ? undefined : process.env.POSTGRES_DB ?? process.env.PGDATABASE,
      user: process.env.DATABASE_URL ? undefined : process.env.POSTGRES_USER ?? process.env.PGUSER,
      password: process.env.DATABASE_URL ? undefined : process.env.POSTGRES_PASSWORD ?? process.env.PGPASSWORD,
      ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
    });
    await pool.query('CREATE TABLE IF NOT EXISTS control_plane_portal_deployments (id UUID PRIMARY KEY)');
    const migration = fs.readFileSync(path.resolve(__dirname, '../../migrations/008_scripts_pipeline_deployment.sql'), 'utf8');
    await pool.query(migration);
    await pool.query('DELETE FROM control_plane_deployment_jobs WHERE deployment_id = $1', [deploymentId]);
    await pool.query('INSERT INTO control_plane_portal_deployments (id) VALUES ($1) ON CONFLICT DO NOTHING', [deploymentId]);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM control_plane_deployment_jobs WHERE deployment_id = $1', [deploymentId]);
    await pool.query('DELETE FROM control_plane_portal_deployments WHERE id = $1', [deploymentId]);
    await pool.end();
  });

  it('persists and restores independent job cursors', async () => {
    await pool.query(
      `INSERT INTO control_plane_deployment_jobs (deployment_id, github_job_id, job_name, last_log_line)
       VALUES ($1, 101, 'A', 100), ($1, 102, 'B', 50)`,
      [deploymentId],
    );
    const result = await pool.query(
      'SELECT github_job_id, last_log_line FROM control_plane_deployment_jobs WHERE deployment_id = $1 ORDER BY github_job_id',
      [deploymentId],
    );
    expect(result.rows).toEqual([
      { github_job_id: '101', last_log_line: 100 },
      { github_job_id: '102', last_log_line: 50 },
    ]);
  });

  it('updates only new content after restart', async () => {
    await pool.query(
      `UPDATE control_plane_deployment_jobs SET last_log_line = 100
       WHERE deployment_id = $1 AND github_job_id = 101`,
      [deploymentId],
    );
    const before = await pool.query(
      'SELECT last_log_line FROM control_plane_deployment_jobs WHERE deployment_id = $1 AND github_job_id = 101',
      [deploymentId],
    );
    const cursor = Number(before.rows[0].last_log_line);
    const fetchedLines = Array.from({ length: 150 }, (_, index) => index + 1);
    const newLines = fetchedLines.slice(cursor);
    expect(newLines).toHaveLength(50);
    await pool.query(
      `UPDATE control_plane_deployment_jobs SET last_log_line = $3
       WHERE deployment_id = $1 AND github_job_id = $2`,
      [deploymentId, 101, cursor + newLines.length],
    );
    const after = await pool.query(
      'SELECT last_log_line FROM control_plane_deployment_jobs WHERE deployment_id = $1 AND github_job_id = 101',
      [deploymentId],
    );
    expect(Number(after.rows[0].last_log_line)).toBe(150);
  });
});
