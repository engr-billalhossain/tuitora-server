import express from "express";
import cors from "cors";
import 'dotenv/config';
import { MongoClient } from "mongodb";


const app = express();
const PORT = process.env.PORT || 5000;

//middleware
app.use(express.json());
app.use(cors());

const client = new MongoClient(
  `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.xdlqhda.mongodb.net/`,
);


export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

const connectedClient = await connectToMongoDB();
const db = connectedClient.db("tuitoradb");
const users = db.collection("user");
const courses = db.collection("courses");

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.get("/users", async (req, res) => {
 const cursor = users.find({});
 const result = await cursor.toArray();
 res.send(result);
});

// Get all tuitions (optional ?status=pending|approved filter for admin)
app.get("/courses", async (req, res) => {
  try {
    const { status } = req.query;
    const query = status ? { status } : {};
    const result = await courses.find(query).sort({ createdAt: -1 }).toArray();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.post("/courses", async (req, res) => {
  try {
    const result = await courses.insertOne({
      ...req.body,
      status: "pending",
      createdAt: new Date(),
    });
    res.status(201).json({ insertedId: result.insertedId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});