require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("node:fs");
const path = require("node:path");
const swaggerUi = require("swagger-ui-express");
const yaml = require("yaml");
const { router: productRoutes, setDB: setProductDB } = require("./src/routes/productRoutes");
const { router: categoryRoutes, setDB: setCategoryDB } = require("./src/routes/categoryRoutes");
const { router: cartRoutes, setDB: setCartDB } = require("./src/routes/cartRoutes");
const { router: wishlistRoutes, setDB: setWishlistDB } = require("./src/routes/wishlistRoutes");
const { router: orderRoutes, setDB: setOrderDB } = require("./src/routes/orderRoutes");
const { router: uploadRoutes } = require("./src/routes/uploadRoutes");
const { router: adminRoutes, setDB: setAdminDB } = require("./src/routes/adminRoutes");
const { router: userRoutes, setDB: setUserDB } = require("./src/routes/userRoutes");
const { router: siteRoutes, setDB: setSiteDB } = require("./src/routes/siteRoutes");
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

const openApiSpec = yaml.parse(
  fs.readFileSync(path.join(__dirname, "docs", "openapi.yaml"), "utf8"),
);

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "UniTech Backend is running!",
  });
});

let database;
let connectionPromise;

async function connectToDatabase() {
  if (database) {
    return database;
  }

  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing from .env");
  }

  if (!connectionPromise) {
    const client = new MongoClient(process.env.MONGODB_URI);

    connectionPromise = Promise.resolve()
      .then(() => client.connect())
      .then((connectedClient) => {
        database = connectedClient.db("unitech");
        setProductDB(database);
        setCategoryDB(database);
        setCartDB(database);
        setWishlistDB(database);
        setOrderDB(database);
        setAdminDB(database);
        setUserDB(database);
        setSiteDB(database);
        console.log("MongoDB connected successfully!");

        return database;
      })
      .catch(async (error) => {
        connectionPromise = null;
        await client.close().catch(() => {});
        throw error;
      });
  }

  return connectionPromise;
}

async function ensureDatabase(req, res, next) {
  try {
    await connectToDatabase();
    return next();
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    return res.status(503).json({
      success: false,
      message: "Database connection unavailable",
    });
  }
}

app.use("/api/products", ensureDatabase, productRoutes);
app.use("/api/categories", ensureDatabase, categoryRoutes);
app.use("/api/cart", ensureDatabase, cartRoutes);
app.use("/api/wishlist", ensureDatabase, wishlistRoutes);
app.use("/api/orders", ensureDatabase, orderRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/admin", ensureDatabase, adminRoutes);
app.use("/api/users", ensureDatabase, userRoutes);
app.use("/api", ensureDatabase, siteRoutes);

async function startServer() {
  try {
    await connectToDatabase();

    app.listen(PORT, () => {
      console.log(`UniTech server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Server startup failed:", error.message);
    process.exit(1);
  }
}

module.exports = app;

if (require.main === module) {
  startServer();
}
