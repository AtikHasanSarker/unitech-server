const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;

// Middleware
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  }),
);
app.use(express.json());

// MongoDB Connection
const client = new MongoClient(MONGODB_URI);

async function startServer() {
  try {
    if (!MONGODB_URI) {
      throw new Error("MONGODB_URI is missing from .env file");
    }

    await client.connect();
    await client.db("admin").command({ ping: 1 });

    console.log("MongoDB connected successfully!");

    // Health Check API
    app.get("/", (req, res) => {
      res.status(200).json({
        success: true,
        message: "UniTech Backend is running!",
      });
    });

    // Start Server
    app.listen(PORT, () => {
      console.log(`UniTech server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Server startup failed:", error.message);
    await client.close().catch(() => {});
    process.exit(1);
  }
}

startServer();
