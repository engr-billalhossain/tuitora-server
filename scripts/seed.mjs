/**
 * Seeds the Express API database with realistic, connected demo data.
 * Usage from tuitora-backend:  npm run seed
 */
import "dotenv/config";
import { MongoClient } from "mongodb";
import { seedDemoData } from "../lib/seed.js";

const uri =
  process.env.MONGODB_URI ||
  `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.xdlqhda.mongodb.net/`;
const client = new MongoClient(uri);

try {
  await client.connect();
  const db = client.db("tuitoradb");
  const summary = await seedDemoData(db);
  console.log("Seed complete:", summary);
} finally {
  await client.close();
}
