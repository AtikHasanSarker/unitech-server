const express = require("express");
const { ObjectId } = require("mongodb");

const router = express.Router();
let db;

function setDB(database) {
  db = database;
}

function getCategoriesCollection() {
  if (!db) {
    throw new Error("Database is not connected");
  }

  return db.collection("categories");
}

router.get("/", async (req, res) => {
  try {
    const categories = await getCategoriesCollection().find({}).sort({ name: 1 }).toArray();

    return res.status(200).json({
      success: true,
      count: categories.length,
      data: categories,
    });
  } catch (error) {
    console.error("Get categories error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch categories",
    });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid category ID",
      });
    }

    const category = await getCategoriesCollection().findOne({
      _id: new ObjectId(id),
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: category,
    });
  } catch (error) {
    console.error("Get category error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch category",
    });
  }
});

module.exports = { router, setDB };
