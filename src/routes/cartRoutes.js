const express = require("express");
const { ObjectId } = require("mongodb");
const { verifyToken } = require("../middleware/verifyToken");

const router = express.Router();
let db;

function setDB(database) {
  db = database;
}

function getCartCollection() {
  if (!db) {
    throw new Error("Database is not connected");
  }

  return db.collection("carts");
}

function getProductsCollection() {
  if (!db) {
    throw new Error("Database is not connected");
  }

  return db.collection("products");
}

function normalizeQuantity(value) {
  const quantity = Number(value);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return null;
  }

  return quantity;
}

router.get("/", verifyToken, async (req, res) => {
  try {
    let cart = await getCartCollection().findOne({ userId: req.user.id });

    if (!cart) {
      cart = {
        userId: req.user.id,
        items: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    return res.status(200).json({
      success: true,
      data: cart,
    });
  } catch (error) {
    console.error("Get cart error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch cart",
    });
  }
});

router.post("/", verifyToken, async (req, res) => {
  try {
    const { productId, quantity = 1 } = req.body;
    const normalizedQty = normalizeQuantity(quantity);

    if (!productId || !ObjectId.isValid(productId)) {
      return res.status(400).json({
        success: false,
        message: "Valid product ID is required",
      });
    }

    if (!normalizedQty) {
      return res.status(400).json({
        success: false,
        message: "Quantity must be a positive integer",
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

    let cart = await getCartCollection().findOne({ userId: req.user.id });

    if (!cart) {
      cart = {
        userId: req.user.id,
        items: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    const itemIndex = cart.items.findIndex((item) => item.productId === productId);
    const itemPayload = {
      productId,
      name: product.name,
      price: product.price,
      image: Array.isArray(product.images) && product.images.length > 0 ? product.images[0] : "",
      quantity: normalizedQty,
    };

    if (itemIndex >= 0) {
      const currentQty = cart.items[itemIndex].quantity;
      const nextQty = currentQty + normalizedQty;

      if (product.stock !== undefined && nextQty > product.stock) {
        return res.status(400).json({
          success: false,
          message: `Only ${product.stock} units are available for this product`,
        });
      }

      cart.items[itemIndex].quantity = nextQty;
      cart.items[itemIndex].price = product.price;
      cart.items[itemIndex].image = itemPayload.image;
      cart.items[itemIndex].name = product.name;
    } else {
      if (product.stock !== undefined && normalizedQty > product.stock) {
        return res.status(400).json({
          success: false,
          message: `Only ${product.stock} units are available for this product`,
        });
      }

      cart.items.push(itemPayload);
    }

    cart.updatedAt = new Date();

    await getCartCollection().updateOne(
      { userId: req.user.id },
      { $set: cart },
      { upsert: true },
    );

    return res.status(200).json({
      success: true,
      message: "Product added to cart",
      data: cart,
    });
  } catch (error) {
    console.error("Add to cart error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to add product to cart",
    });
  }
});

router.patch("/:productId", verifyToken, async (req, res) => {
  try {
    const { productId } = req.params;
    const { quantity } = req.body;
    const normalizedQty = normalizeQuantity(quantity);

    if (!ObjectId.isValid(productId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID",
      });
    }

    if (!normalizedQty) {
      return res.status(400).json({
        success: false,
        message: "Quantity must be a positive integer",
      });
    }

    const cart = await getCartCollection().findOne({ userId: req.user.id });

    if (!cart) {
      return res.status(404).json({
        success: false,
        message: "Cart not found",
      });
    }

    const itemIndex = cart.items.findIndex((item) => item.productId === productId);

    if (itemIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Item not found in cart",
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

    if (product.stock !== undefined && normalizedQty > product.stock) {
      return res.status(400).json({
        success: false,
        message: `Only ${product.stock} units are available for this product`,
      });
    }

    cart.items[itemIndex].quantity = normalizedQty;
    cart.items[itemIndex].price = product.price;
    cart.updatedAt = new Date();

    await getCartCollection().updateOne({ userId: req.user.id }, { $set: { items: cart.items, updatedAt: cart.updatedAt } });

    return res.status(200).json({
      success: true,
      message: "Cart item updated",
      data: cart,
    });
  } catch (error) {
    console.error("Update cart item error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update cart item",
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

    const cart = await getCartCollection().findOne({ userId: req.user.id });

    if (!cart) {
      return res.status(404).json({
        success: false,
        message: "Cart not found",
      });
    }

    const itemExists = cart.items.some((item) => item.productId === productId);

    if (!itemExists) {
      return res.status(404).json({
        success: false,
        message: "Item not found in cart",
      });
    }

    const updatedItems = cart.items.filter((item) => item.productId !== productId);
    cart.items = updatedItems;
    cart.updatedAt = new Date();

    await getCartCollection().updateOne({ userId: req.user.id }, { $set: { items: updatedItems, updatedAt: cart.updatedAt } });

    return res.status(200).json({
      success: true,
      message: "Cart item removed",
      data: cart,
    });
  } catch (error) {
    console.error("Remove cart item error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to remove cart item",
    });
  }
});

router.delete("/", verifyToken, async (req, res) => {
  try {
    await getCartCollection().deleteOne({ userId: req.user.id });

    return res.status(200).json({
      success: true,
      message: "Cart cleared successfully",
      data: { userId: req.user.id, items: [] },
    });
  } catch (error) {
    console.error("Clear cart error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to clear cart",
    });
  }
});

module.exports = { router, setDB };
