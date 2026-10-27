require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { router: productRoutes, setDB } = require("./src/routes/productRoutes");
const { MongoClient } = require("mongodb");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  }),
);

app.use(express.json());

// Health Check API
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "UniTech Backend is running!",
  });
});

// Product Routes
app.use("/api/products", productRoutes);

// MongoDB Connection
const client = new MongoClient(process.env.MONGODB_URI);

async function startServer() {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI is missing from .env");
    }

    await client.connect();
    await client.db("admin").command({ ping: 1 });

    console.log("MongoDB connected successfully!");

    const db = client.db("unitech");
    setDB(db);

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
