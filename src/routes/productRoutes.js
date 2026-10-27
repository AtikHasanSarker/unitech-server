const express = require("express");
const router = express.Router();

let db;

// MongoDB connection থেকে database নেওয়ার জন্য
// index.js থেকে setDB() call করা হবে।
function setDB(database) {
  db = database;
}

//collection নেওয়ার জন্য helper function
function getProductsCollection() {
  if (!db) {
    throw new Error("Database is not connected");
  }
  return db.collection("products");
}


// GET: সব Product আনা
router.get("/", async (req, res) => {
  try {
    const products = await getProductsCollection()
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json({
      success: true,
      count: products.length,
      data: products,
    });
  } catch (error) {
    console.error("Get products error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch products",
    });
  }
});


// POST: নতুন Product তৈরি
router.post("/", async (req, res) => {
  try {
    const {
      name,
      description,
      price,
      category,
      brand,
      images = [],
      stock = 0,
    } = req.body;

    if (
      typeof name !== "string" ||
      !name.trim() ||
      typeof description !== "string" ||
      !description.trim() ||
      typeof category !== "string" ||
      !category.trim() ||
      typeof price !== "number" ||
      !Number.isFinite(price) ||
      price < 0 ||
      typeof stock !== "number" ||
      !Number.isInteger(stock) ||
      stock < 0 ||
      !Array.isArray(images) ||
      !images.every((image) => typeof image === "string")
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid product data",
      });
    }

    const product = {
      name: name.trim(),
      description: description.trim(),
      price,
      category: category.trim(),
      brand: typeof brand === "string" ? brand.trim() : "",
      images,
      stock,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await getProductsCollection().insertOne(product);

    res.status(201).json({
      success: true,
      message: "Product created successfully",
      data: {
        ...product,
        _id: result.insertedId,
      },
    });
  } catch (error) {
    console.error("Create product error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to create product",
    });
  }
});

module.exports = { router, setDB };
