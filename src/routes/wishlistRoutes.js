const express = require("express");
const { ObjectId } = require("mongodb");
const { verifyToken } = require("../middleware/verifyToken");

const router = express.Router();
let db;

function setDB(database) {
  db = database;
}

function getWishlistCollection() {
  if (!db) {
    throw new Error("Database is not connected");
  }

  return db.collection("wishlists");
}

function getProductsCollection() {
  if (!db) {
    throw new Error("Database is not connected");
  }

  return db.collection("products");
}

router.get("/", verifyToken, async (req, res) => {
  try {
    let wishlist = await getWishlistCollection().findOne({ userId: req.user.id });

    if (!wishlist) {
      wishlist = {
        userId: req.user.id,
        items: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    return res.status(200).json({
      success: true,
      data: wishlist,
    });
  } catch (error) {
    console.error("Get wishlist error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch wishlist",
    });
  }
});

router.post("/:productId", verifyToken, async (req, res) => {
  try {
    const { productId } = req.params;

    if (!ObjectId.isValid(productId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID",
      });
    }

    const product = await getProductsCollection().findOne({
      _id: new ObjectId(productId),
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    let wishlist = await getWishlistCollection().findOne({ userId: req.user.id });

    if (!wishlist) {
      wishlist = {
        userId: req.user.id,
        items: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    const exists = wishlist.items.some((item) => item.productId === productId);

    if (exists) {
      return res.status(409).json({
        success: false,
        message: "Product already exists in wishlist",
      });
    }

    wishlist.items.push({
      productId,
      name: product.name,
      price: product.price,
      image: Array.isArray(product.images) && product.images.length > 0 ? product.images[0] : "",
      addedAt: new Date(),
    });
    wishlist.updatedAt = new Date();

    await getWishlistCollection().updateOne(
      { userId: req.user.id },
      { $set: wishlist },
      { upsert: true },
    );

    return res.status(200).json({
      success: true,
      message: "Product added to wishlist",
      data: wishlist,
    });
  } catch (error) {
    console.error("Add to wishlist error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to add product to wishlist",
    });
  }
});

router.delete("/:productId", verifyToken, async (req, res) => {
  try {
    const { productId } = req.params;

    if (!ObjectId.isValid(productId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID",
      });
    }

    const wishlist = await getWishlistCollection().findOne({ userId: req.user.id });

    if (!wishlist) {
      return res.status(404).json({
        success: false,
        message: "Wishlist not found",
      });
    }

    const itemExists = wishlist.items.some((item) => item.productId === productId);

    if (!itemExists) {
      return res.status(404).json({
        success: false,
        message: "Product not found in wishlist",
      });
    }

    wishlist.items = wishlist.items.filter((item) => item.productId !== productId);
    wishlist.updatedAt = new Date();

    await getWishlistCollection().updateOne({ userId: req.user.id }, { $set: { items: wishlist.items, updatedAt: wishlist.updatedAt } });

    return res.status(200).json({
      success: true,
      message: "Product removed from wishlist",
      data: wishlist,
    });
  } catch (error) {
    console.error("Remove from wishlist error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to remove product from wishlist",
    });
  }
});

module.exports = { router, setDB };
