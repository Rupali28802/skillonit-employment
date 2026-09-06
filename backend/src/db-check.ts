import { MongoClient } from 'mongodb';

// Read-only connectivity probe. Never prints URIs, server identities or driver errors.
const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error(
    'MongoDB not configured: set MONGODB_URI in backend/.env locally.',
  );
  process.exitCode = 1;
} else {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    await client
      .db(process.env.MONGODB_DATABASE || 'skillonit')
      .command({ ping: 1 });
    const hello = await client.db('admin').command({ hello: 1 });
    if (!hello.setName && hello.msg !== 'isdbgrid')
      throw new Error('TRANSACTIONS_REQUIRED');
    console.log(
      'PASS: MongoDB reachable; replica-set or sharded topology detected. Run isolated integration tests before production rollout.',
    );
  } catch {
    console.error(
      'MongoDB check failed. Verify local credentials, network access and replica-set topology. Sensitive driver details withheld.',
    );
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}
