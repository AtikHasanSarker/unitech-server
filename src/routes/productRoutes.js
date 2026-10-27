const express = require("express");
const { ObjectId } = require("mongodb");
const { verifyToken, requireAdmin } = require("../middleware/verifyToken");
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

// GET: ID দিয়ে একটি Product আনা
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID",
      });
    }

    const product = await getProductsCollection().findOne({
      _id: new ObjectId(id),
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    res.status(200).json({
      success: true,
      data: product,
    });
  } catch (error) {
    console.error("Get product error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch product",
    });
  }
});


// POST: নতুন Product তৈরি
router.post("/", verifyToken, requireAdmin, async (req, res) => {
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


// PATCH: Product Update
router.patch("/:id",verifyToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const allowedFields = [
      "name",
      "description",
      "price",
      "category",
      "brand",
      "images",
      "stock",
    ];

    const updates = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields provided for update",
      });
    }

    for (const field of ["name", "description", "category", "brand"]) {
      if (field in updates) {
        updates[field] = updates[field].trim();
      }
    }

    updates.updatedAt = new Date();

    const result = await getProductsCollection().updateOne(
      { _id: new ObjectId(id) },
      { $set: updates },
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Product updated successfully",
    });
  } catch (error) {
    console.error("Update product error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to update product",
    });
  }
});


// DELETE: Product Delete
router.delete("/:id",verifyToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await getProductsCollection().deleteOne({
      _id: new ObjectId(id),
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Product deleted successfully",
    });
  } catch (error) {
    console.error("Delete product error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to delete product",
    });
  }
});

module.exports = { router, setDB };
