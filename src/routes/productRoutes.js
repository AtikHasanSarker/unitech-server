const express = require("express");
const { ObjectId } = require("mongodb");
const { verifyToken, requireAdmin } = require("../middleware/verifyToken");
const router = express.Router();

let db;

function setDB(database) {
  db = database;
}

function getProductsCollection() {
  if (!db) {
    throw new Error("Database is not connected");
  }
  return db.collection("products");
}

function parsePositiveNumber(value, fallback) {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return parsed;
}

function sanitizeSearchText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

router.get("/", async (req, res) => {
  try {
    const search = sanitizeSearchText(req.query.search);
    const category = sanitizeSearchText(req.query.category);
    const minPrice = parsePositiveNumber(req.query.minPrice, null);
    const maxPrice = parsePositiveNumber(req.query.maxPrice, null);
    const page = Math.max(1, parsePositiveNumber(req.query.page, 1));
    const limit = Math.min(100, Math.max(1, parsePositiveNumber(req.query.limit, 12)));
    const sortParam = sanitizeSearchText(req.query.sort).toLowerCase();

    const filter = {};

    if (search) {
      filter.$or = [
        { name: { $regex: escapeRegex(search), $options: "i" } },
        { description: { $regex: escapeRegex(search), $options: "i" } },
        { brand: { $regex: escapeRegex(search), $options: "i" } },
        { category: { $regex: escapeRegex(search), $options: "i" } },
      ];
    }

    if (category) {
      filter.category = { $regex: `^${escapeRegex(category)}$`, $options: "i" };
    }

    if (minPrice !== null && !Number.isNaN(minPrice) && minPrice >= 0) {
      filter.price = { ...(filter.price || {}), $gte: minPrice };
    }

    if (maxPrice !== null && !Number.isNaN(maxPrice) && maxPrice >= 0) {
      filter.price = { ...(filter.price || {}), $lte: maxPrice };
    }

    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      price_asc: { price: 1 },
      price_desc: { price: -1 },
      low_to_high: { price: 1 },
      high_to_low: { price: -1 },
      newest_first: { createdAt: -1 },
      oldest_first: { createdAt: 1 },
    };

    const sort = sortMap[sortParam] || { createdAt: -1 };
    const total = await getProductsCollection().countDocuments(filter);
    const skip = (page - 1) * limit;
    const products = await getProductsCollection()
      .find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .toArray();

    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    return res.status(200).json({
      success: true,
      count: products.length,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
      data: products,
    });
  } catch (error) {
    console.error("Get products error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch products",
    });
  }
});

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

    return res.status(200).json({
      success: true,
      data: product,
    });
  } catch (error) {
    console.error("Get product error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch product",
    });
  }
});

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

    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Product name is required",
      });
    }

    const numericPrice = Number(price);
    if (!Number.isFinite(numericPrice) || numericPrice < 0) {
      return res.status(400).json({
        success: false,
        message: "Product price must be a valid number",
      });
    }

    const numericStock = Number(stock);
    if (!Number.isInteger(numericStock) || numericStock < 0) {
      return res.status(400).json({
        success: false,
        message: "Product stock must be a non-negative integer",
      });
    }

    const product = {
      name: name.trim(),
      description: typeof description === "string" ? description.trim() : "",
      price: numericPrice,
      category: typeof category === "string" ? category.trim() : "",
      brand: typeof brand === "string" ? brand.trim() : "",
      images: Array.isArray(images) ? images : [],
      stock: numericStock,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await getProductsCollection().insertOne(product);

    return res.status(201).json({
      success: true,
      message: "Product created successfully",
      data: { ...product, _id: result.insertedId },
    });
  } catch (error) {
    console.error("Create product error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create product",
    });
  }
});

router.patch("/:id", verifyToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID",
      });
    }

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

    if (updates.name !== undefined) {
      if (typeof updates.name !== "string" || !updates.name.trim()) {
        return res.status(400).json({
          success: false,
          message: "Product name is required",
        });
      }
      updates.name = updates.name.trim();
    }

    if (updates.description !== undefined) {
      updates.description = typeof updates.description === "string" ? updates.description.trim() : "";
    }

    if (updates.price !== undefined) {
      const numericPrice = Number(updates.price);
      if (!Number.isFinite(numericPrice) || numericPrice < 0) {
        return res.status(400).json({
          success: false,
          message: "Product price must be a valid number",
        });
      }
      updates.price = numericPrice;
    }

    if (updates.category !== undefined) {
      updates.category = typeof updates.category === "string" ? updates.category.trim() : "";
    }

    if (updates.brand !== undefined) {
      updates.brand = typeof updates.brand === "string" ? updates.brand.trim() : "";
    }

    if (updates.stock !== undefined) {
      const numericStock = Number(updates.stock);
      if (!Number.isInteger(numericStock) || numericStock < 0) {
        return res.status(400).json({
          success: false,
          message: "Product stock must be a non-negative integer",
        });
      }
      updates.stock = numericStock;
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

    return res.status(200).json({
      success: true,
      message: "Product updated successfully",
    });
  } catch (error) {
    console.error("Update product error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update product",
    });
  }
});

router.delete("/:id", verifyToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID",
      });
    }

    const result = await getProductsCollection().deleteOne({
      _id: new ObjectId(id),
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Product deleted successfully",
    });
  } catch (error) {
    console.error("Delete product error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to delete product",
    });
  }
});

module.exports = { router, setDB };
