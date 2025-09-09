import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI!;
const client = new MongoClient(uri);
const dbName = 'briha';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    // Company name presence check
    if (!body.company) {
      return NextResponse.json({ status: 'error', error: 'Company name is required' }, { status: 400 });
    }
    await client.connect();
    const db = client.db(dbName);
    const collection = db.collection(body.company.toLowerCase());

    // Debug logs
    console.log('Body received:', body);
    console.log('Inserting into collection:', body.company.toLowerCase());

    // Ensure results is not empty, and chatId is present
    if (!body.results || !Array.isArray(body.results) || body.results.length === 0) {
      return NextResponse.json({ status: 'error', error: 'No enrichment results provided.' }, { status: 400 });
    }
    if (!body.chatId) {
      return NextResponse.json({ status: 'error', error: 'No chatId provided.' }, { status: 400 });
    }

    await collection.insertOne({
      email: body.email,
      domain: body.company, // domain should be companyName per requirements
      chatId: body.chatId,
      results: body.results,
      score: body.score,
      reason: body.reason,
      createdAt: new Date(),
    });

    return NextResponse.json({ status: 'success' });
  } catch (error) {
    console.error('[MongoDB Error]', error);
    return NextResponse.json({ status: 'error', error }, { status: 500 });
  }
}

export async function GET() {
  try {
    await client.connect();
    const db = client.db(dbName);
    const collections = await db.listCollections().toArray();

    let allLeads: any[] = [];

    for (const col of collections) {
      const collection = db.collection(col.name);
      const docs = await collection.find({}).toArray();

      for (const doc of docs) {
        allLeads.push({
          email: doc.email ?? '',
          domain: doc.domain ?? col.name,
          chatId: doc.chatId ?? '',
          createdAt: doc.createdAt
            ? new Date(doc.createdAt).toLocaleString()
            : '',
          results: Array.isArray(doc.results)
            ? JSON.stringify(doc.results)
            : doc.results ?? '',
          score: doc.score ?? null,
          reason: doc.reason ?? '',
        });
      }
    }

    return NextResponse.json(allLeads);
  } catch (error) {
    console.error('[GET MongoDB Error]', error);
    return NextResponse.json({ status: 'error', error }, { status: 500 });
  }
}