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
      sku,
      category,
      brand = "",
      description = "",
      price,
      costPrice = 0,
      discountPrice = null,
      stock,
      lowStockThreshold = 2,
      features = [],
      specifications = [],
      warranty = "",
      images = [],
      status = "Active",
    } = req.body;

    // 1. Required field validation
    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Product name is required.",
      });
    }

    if (typeof sku !== "string" || !sku.trim()) {
      return res.status(400).json({
        success: false,
        message: "Product SKU is required.",
      });
    }

    if (typeof category !== "string" || !category.trim()) {
      return res.status(400).json({
        success: false,
        message: "Product category is required.",
      });
    }

    // 2. Numeric validation
    const numericPrice = Number(price);
    const numericCostPrice = Number(costPrice);
    const numericStock = Number(stock);
    const numericLowStockThreshold = Number(lowStockThreshold);

    if (!Number.isFinite(numericPrice) || numericPrice < 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid selling price.",
      });
    }

    if (!Number.isFinite(numericCostPrice) || numericCostPrice < 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid purchase price.",
      });
    }

    if (!Number.isInteger(numericStock) || numericStock < 0) {
      return res.status(400).json({
        success: false,
        message: "Stock must be a non-negative integer.",
      });
    }

    if (
      !Number.isInteger(numericLowStockThreshold) ||
      numericLowStockThreshold < 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid low stock threshold.",
      });
    }

    // 3. Discount price validation
    let numericDiscountPrice = null;

    if (discountPrice !== null && discountPrice !== "") {
      numericDiscountPrice = Number(discountPrice);

      if (
        !Number.isFinite(numericDiscountPrice) ||
        numericDiscountPrice < 0 ||
        numericDiscountPrice > numericPrice
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Discount price must be valid and cannot exceed selling price.",
        });
      }
    }

    // 4. Status validation
    if (!["Active", "Draft"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product status.",
      });
    }

    // 5. Features validation
    if (
      !Array.isArray(features) ||
      !features.every((item) => typeof item === "string")
    ) {
      return res.status(400).json({
        success: false,
        message: "Features must be an array of strings.",
      });
    }

    // 6. Specifications validation
    if (
      !Array.isArray(specifications) ||
      !specifications.every(
        (item) =>
          item &&
          typeof item.key === "string" &&
          typeof item.value === "string",
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid product specifications.",
      });
    }

    // 7. Image validation
    if (
      !Array.isArray(images) ||
      !images.every(
        (image) => typeof image === "string" && /^https?:\/\/\S+$/i.test(image),
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Product images must be valid image URLs.",
      });
    }

    // 8. SKU duplicate validation
    const normalizedSku = sku.trim();

    const escapedSku = normalizedSku.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const duplicateSku = await getProductsCollection().findOne({
      sku: {
        $regex: `^${escapedSku}$`,
        $options: "i",
      },
    });

    if (duplicateSku) {
      return res.status(409).json({
        success: false,
        message: "A product with this SKU already exists.",
      });
    }

    // 9. Create product
    const product = {
      name: name.trim(),
      sku: normalizedSku,
      category: category.trim(),
      brand: typeof brand === "string" ? brand.trim() : "",
      description: typeof description === "string" ? description.trim() : "",

      // Pricing
      price: numericPrice,
      costPrice: numericCostPrice,
      discountPrice: numericDiscountPrice,

      // Inventory
      stock: numericStock,
      lowStockThreshold: numericLowStockThreshold,

      // Product details
      features: features.map((item) => item.trim()).filter(Boolean),

      specifications: specifications
        .map((item) => ({
          key: item.key.trim(),
          value: item.value.trim(),
        }))
        .filter((item) => item.key && item.value),

      warranty: typeof warranty === "string" ? warranty.trim() : "",

      // Images
      images,

      // Frontend does not currently send status
      status,

      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // 10. Save to MongoDB
    const result = await getProductsCollection().insertOne(product);

    return res.status(201).json({
      success: true,
      message: "Product created successfully.",
      data: {
        ...product,
        _id: result.insertedId,
      },
    });
  } catch (error) {
    console.error("Create product error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create product.",
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
      "oldPrice",
      "category",
      "brand",
      "sku",
      "images",
      "stock",
      "status",
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

    if (updates.oldPrice !== undefined) {
      if (updates.oldPrice === null || updates.oldPrice === "") {
        updates.oldPrice = null;
      } else {
        const numericOldPrice = Number(updates.oldPrice);
        const currentProduct = await getProductsCollection().findOne({ _id: new ObjectId(id) });
        const currentPrice = updates.price ?? currentProduct?.price;
        if (!Number.isFinite(numericOldPrice) || numericOldPrice <= currentPrice) {
          return res.status(400).json({
            success: false,
            message: "Old price must be greater than the current price",
          });
        }
        updates.oldPrice = numericOldPrice;
      }
    }

    if (updates.category !== undefined) {
      updates.category = typeof updates.category === "string" ? updates.category.trim() : "";
    }

    if (updates.brand !== undefined) {
      updates.brand = typeof updates.brand === "string" ? updates.brand.trim() : "";
    }

    if (updates.sku !== undefined) {
      updates.sku = typeof updates.sku === "string" ? updates.sku.trim() : "";
      if (updates.sku) {
        const duplicateSku = await getProductsCollection().findOne({
          _id: { $ne: new ObjectId(id) },
          sku: { $regex: `^${escapeRegex(updates.sku)}$`, $options: "i" },
        });
        if (duplicateSku) {
          return res.status(409).json({
            success: false,
            message: "A product with this SKU already exists",
          });
        }
      }
    }

    if (updates.status !== undefined && !["Active", "Draft"].includes(updates.status)) {
      return res.status(400).json({
        success: false,
        message: "Product status must be Active or Draft",
      });
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
