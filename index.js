require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { router: productRoutes, setDB: setProductDB } = require("./src/routes/productRoutes");
const { router: categoryRoutes, setDB: setCategoryDB } = require("./src/routes/categoryRoutes");
const { router: cartRoutes, setDB: setCartDB } = require("./src/routes/cartRoutes");
const { router: wishlistRoutes, setDB: setWishlistDB } = require("./src/routes/wishlistRoutes");
const { router: orderRoutes, setDB: setOrderDB } = require("./src/routes/orderRoutes");
const { router: uploadRoutes } = require("./src/routes/uploadRoutes");
const { router: adminRoutes, setDB: setAdminDB } = require("./src/routes/adminRoutes");
const { router: userRoutes, setDB: setUserDB } = require("./src/routes/userRoutes");
const { MongoClient } = require("mongodb");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  }),
);

app.use(express.json({ limit: "10mb" }));

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "UniTech Backend is running!",
  });
});

app.use("/api/products", productRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/wishlist", wishlistRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/users", userRoutes);

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
    setProductDB(db);
    setCategoryDB(db);
    setCartDB(db);
    setWishlistDB(db);
    setOrderDB(db);
    setAdminDB(db);
    setUserDB(db);

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
