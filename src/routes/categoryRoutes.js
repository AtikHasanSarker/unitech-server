const express = require("express");
const { ObjectId } = require("mongodb");
const { verifyToken, requireAdmin } = require("../middleware/verifyToken");

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

function getProductsCollection() {
  if (!db) {
    throw new Error("Database is not connected");
  }

  return db.collection("products");
}

function sanitizeCategoryName(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function buildSlug(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

router.post("/", verifyToken, requireAdmin, async (req, res) => {
  try {
    const name = sanitizeCategoryName(req.body.name);
    const description = typeof req.body.description === "string" ? req.body.description.trim() : "";
    const image = typeof req.body.image === "string" ? req.body.image.trim() : "";

    if (!name || name.length < 2 || name.length > 80) {
      return res.status(400).json({
        success: false,
        message: "Category name must be between 2 and 80 characters",
      });
    }

    const slug = buildSlug(name);

    if (!slug) {
      return res.status(400).json({
        success: false,
        message: "Category name is invalid",
      });
    }

    const existing = await getCategoriesCollection().findOne({
      $or: [{ name: { $regex: `^${escapeRegex(name)}$`, $options: "i" } }, { slug }],
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: "A category with this name already exists",
      });
    }

    const category = {
      name,
      slug,
      description,
      image,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await getCategoriesCollection().insertOne(category);

    return res.status(201).json({
      success: true,
      message: "Category created successfully",
      data: { ...category, _id: result.insertedId },
    });
  } catch (error) {
    console.error("Create category error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create category",
    });
  }
});

router.patch("/:id", verifyToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid category ID",
      });
    }

    const existingCategory = await getCategoriesCollection().findOne({
      _id: new ObjectId(id),
    });

    if (!existingCategory) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    const updates = {};

    if (req.body.name !== undefined) {
      const nextName = sanitizeCategoryName(req.body.name);

      if (!nextName || nextName.length < 2 || nextName.length > 80) {
        return res.status(400).json({
          success: false,
          message: "Category name must be between 2 and 80 characters",
        });
      }

      const nextSlug = buildSlug(nextName);

      if (nextName.toLowerCase() !== existingCategory.name.toLowerCase()) {
        const duplicate = await getCategoriesCollection().findOne({
          _id: { $ne: new ObjectId(id) },
          $or: [{ name: { $regex: `^${escapeRegex(nextName)}$`, $options: "i" } }, { slug: nextSlug }],
        });

        if (duplicate) {
          return res.status(409).json({
            success: false,
            message: "A category with this name already exists",
          });
        }
      }

      updates.name = nextName;
      updates.slug = nextSlug;
    }

    if (req.body.description !== undefined) {
      updates.description = typeof req.body.description === "string" ? req.body.description.trim() : "";
    }

    if (req.body.image !== undefined) {
      updates.image = typeof req.body.image === "string" ? req.body.image.trim() : "";
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields provided for update",
      });
    }

    updates.updatedAt = new Date();

    const result = await getCategoriesCollection().updateOne(
      { _id: new ObjectId(id) },
      { $set: updates },
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    if (updates.name && existingCategory.name !== updates.name) {
      await getProductsCollection().updateMany(
        { category: existingCategory.name },
        { $set: { category: updates.name, updatedAt: new Date() } },
      );
    }

    return res.status(200).json({
      success: true,
      message: "Category updated successfully",
    });
  } catch (error) {
    console.error("Update category error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update category",
    });
  }
});

router.delete("/:id", verifyToken, requireAdmin, async (req, res) => {
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

    const associatedProducts = await getProductsCollection().countDocuments({
      category: category.name,
    });

    if (associatedProducts > 0) {
      return res.status(409).json({
        success: false,
        message: "Cannot delete category that is still assigned to products",
      });
    }

    const result = await getCategoriesCollection().deleteOne({
      _id: new ObjectId(id),
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Category deleted successfully",
    });
  } catch (error) {
    console.error("Delete category error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to delete category",
    });
  }
});

module.exports = { router, setDB };
