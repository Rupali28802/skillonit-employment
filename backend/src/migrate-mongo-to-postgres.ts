import { MongoClient } from 'mongodb';
import { Pool } from 'pg';
const source=process.env.MONGODB_URI, target=process.env.DATABASE_URL;
if(!source||!target) throw new Error('MONGODB_URI and DATABASE_URL are required for migration');
const mongo=new MongoClient(source), pg=new Pool({connectionString:target,ssl:process.env.DATABASE_SSL==='false'?false:{rejectUnauthorized:false}});
try {
  await mongo.connect();
  await pg.query('SET synchronous_commit=off');
  await pg.query('CREATE TABLE IF NOT EXISTS app_documents(collection text NOT NULL,id text NOT NULL,data jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(collection,id))');
  const db=mongo.db(process.env.MONGODB_DATABASE||'skillonit');
  const collections=await db.listCollections({}, {nameOnly:true}).toArray();
  for(const {name} of collections){
    const existingRows=await pg.query('SELECT id FROM app_documents WHERE collection=$1',[name]);
    const existing=new Set<string>(existingRows.rows.map((row:{id:string})=>row.id));
    const sourceCount=await db.collection(name).estimatedDocumentCount();
    if(existing.size===sourceCount){ console.log(`${name}: ${sourceCount}`); continue; }
    const sourceIds=(await db.collection(name).find({id:{$type:'string'}},{projection:{_id:0,id:1},batchSize:1000}).hint('id_1').toArray()).map(row=>row.id as string);
    const missingIds=sourceIds.filter(id=>!existing.has(id));
    let count=0; let copied=0; let batch: Record<string, unknown>[]=[]; const cursor=db.collection(name).find({id:{$in:missingIds}}, {projection:{_id:0},batchSize:250});
    for await(const raw of cursor){
      const row=raw as Record<string,unknown>; if(typeof row.id!=='string') continue;
      count++;
      batch.push(row); copied++;
      if(batch.length===25){
        await pg.query("INSERT INTO app_documents(collection,id,data,updated_at) SELECT $1,x->>'id',x,now() FROM jsonb_array_elements($2::jsonb) x",[name,JSON.stringify(batch)]); batch=[];
        if(copied%1000===0) console.log(`${name}: ${count} scanned, ${copied} new`);
      }
    }
    if(batch.length) await pg.query("INSERT INTO app_documents(collection,id,data,updated_at) SELECT $1,x->>'id',x,now() FROM jsonb_array_elements($2::jsonb) x",[name,JSON.stringify(batch)]);
    console.log(`${name}: ${count}`);
  }
} finally { await mongo.close(); await pg.end(); }
