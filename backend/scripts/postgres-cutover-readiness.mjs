import pg from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  max: 1,
});
const client = await pool.connect();
const report = { snapshotAt: new Date().toISOString(), readOnly: true };
const query = async (text, params = []) => (await client.query(text, params)).rows;
try {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("SET LOCAL statement_timeout = '10min'");
  report.jobStatuses = await query(`SELECT COALESCE(data->>'status','<missing>') value,count(*)::int total FROM app_documents WHERE collection='jobs' GROUP BY 1 ORDER BY 1`);
  report.jobLifecycle = await query(`SELECT COALESCE(data->>'lifecycle','<missing>') value,count(*)::int total FROM app_documents WHERE collection='jobs' GROUP BY 1 ORDER BY 1`);
  report.jobTrust = await query(`SELECT COALESCE(data->>'trust','<missing>') value,count(*)::int total FROM app_documents WHERE collection='jobs' GROUP BY 1 ORDER BY 1`);
  report.testMarkers = (await query(`SELECT count(*) FILTER (WHERE id ILIKE '%test%' OR id ILIKE '%sample%' OR COALESCE(data->>'title','') ~* '(test|sample)')::int total FROM app_documents WHERE collection='jobs'`))[0].total;
  report.relationships = {};
  const relations = [
    ['applicationsMissingUsers', 'applications', 'userId', 'users'],
    ['applicationsMissingJobs', 'applications', 'jobId', 'jobs'],
    ['variantsMissingJobs', 'jobFeedVariants', 'jobId', 'jobs'],
    ['fingerprintsMissingJobs', 'jobFeedFingerprints', 'jobId', 'jobs'],
    ['vectorsMissingJobs', 'jobVectors', 'jobId', 'jobs'],
  ];
  for (const [name, source, field, target] of relations) {
    report.relationships[name] = (await query(`SELECT count(*)::int total FROM app_documents s WHERE s.collection=$1 AND NOT EXISTS (SELECT 1 FROM app_documents t WHERE t.collection=$2 AND t.id=s.data->>$3)`, [source, target, field]))[0].total;
  }
  report.indexes = await query(`SELECT indexname FROM pg_indexes WHERE tablename='app_documents' ORDER BY indexname`);
  report.duplicateIds = (await query(`SELECT count(*)::int total FROM (SELECT collection,id FROM app_documents GROUP BY collection,id HAVING count(*)>1) x`))[0].total;
  await client.query('COMMIT');
  console.log(JSON.stringify(report));
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
