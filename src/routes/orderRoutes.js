const express = require("express");
const { ObjectId } = require("mongodb");
const { verifyToken, requireAdmin } = require("../middleware/verifyToken");

const router = express.Router();
let db;

const VALID_STATUSES = [
  "Pending",
  "Confirmed",
  "Processing",
  "Shipped",
  "Delivered",
  "Cancelled",
];

function setDB(database) {
  db = database;
}

function getOrdersCollection() {
  if (!db) {
    throw new Error("Database is not connected");
  }

  return db.collection("orders");
}

function getProductsCollection() {
  if (!db) {
    throw new Error("Database is not connected");
  }

  return db.collection("products");
}

function buildOrderItem(product, quantity) {
  return {
    productId: product._id.toString(),
    name: product.name,
    price: product.price,
    image: Array.isArray(product.images) && product.images.length > 0 ? product.images[0] : "",
    quantity,
  };
}

router.post("/", verifyToken, async (req, res) => {
  try {
    const { items, shippingFee = 0, paymentMethod = "Cash on Delivery", deliveryAddress } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one order item is required",
      });
    }

    const validatedItems = [];
    let subtotal = 0;

    for (const item of items) {
      const quantity = Number(item.quantity);
      const productId = item.productId;

      if (!productId || !ObjectId.isValid(productId)) {
        return res.status(400).json({
          success: false,
          message: "Each order item must include a valid product ID",
        });
      }

      if (!Number.isInteger(quantity) || quantity <= 0) {
        return res.status(400).json({
          success: false,
          message: "Order item quantity must be a positive integer",
        });
      }

      const product = await getProductsCollection().findOne({ _id: new ObjectId(productId) });

      if (!product) {
        return res.status(404).json({
          success: false,
          message: `Product ${productId} was not found`,
        });
      }

      if (typeof product.stock === "number" && quantity > product.stock) {
        return res.status(400).json({
          success: false,
          message: `Only ${product.stock} units are available for ${product.name}`,
        });
      }

      validatedItems.push({ productId: product._id.toString(), quantity, product });
      subtotal += Number(product.price) * quantity;
    }

    const total = subtotal + Number(shippingFee);

    const order = {
      userId: req.user.id,
      userEmail: req.user.email || "",
      status: "Pending",
      paymentMethod,
      deliveryAddress: deliveryAddress || "",
      shippingFee: Number(shippingFee) || 0,
      subtotal,
      total,
      items: validatedItems.map(({ product, quantity }) => buildOrderItem(product, quantity)),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await getOrdersCollection().insertOne(order);

    for (const item of validatedItems) {
      if (typeof item.product.stock === "number") {
        await getProductsCollection().updateOne(
          { _id: item.product._id },
          { $inc: { stock: -item.quantity } },
        );
      }
    }

    return res.status(201).json({
      success: true,
      message: "Order created successfully",
      data: { ...order, _id: result.insertedId },
    });
  } catch (error) {
    console.error("Create order error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create order",
    });
  }
});

router.get("/my-orders", verifyToken, async (req, res) => {
  try {
    const orders = await getOrdersCollection()
      .find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .toArray();

    return res.status(200).json({
      success: true,
      count: orders.length,
      data: orders,
    });
  } catch (error) {
    console.error("Get my orders error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch your orders",
    });
  }
});

router.get("/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order ID",
      });
    }

    const order = await getOrdersCollection().findOne({ _id: new ObjectId(id) });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (order.userId !== req.user.id && req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to view this order",
      });
    }

    return res.status(200).json({
      success: true,
      data: order,
    });
  } catch (error) {
    console.error("Get order error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch order",
    });
  }
});

router.get("/", verifyToken, requireAdmin, async (req, res) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
    const filter = status ? { status } : {};

    const orders = await getOrdersCollection().find(filter).sort({ createdAt: -1 }).toArray();

    return res.status(200).json({
      success: true,
      count: orders.length,
      data: orders,
    });
  } catch (error) {
    console.error("Get all orders error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch orders",
    });
  }
});

router.patch("/:id/status", verifyToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order ID",
      });
    }

    if (!status || !VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status must be one of: Pending, Confirmed, Processing, Shipped, Delivered, Cancelled",
      });
    }

    const order = await getOrdersCollection().findOne({ _id: new ObjectId(id) });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const result = await getOrdersCollection().updateOne(
      { _id: new ObjectId(id) },
      { $set: { status, updatedAt: new Date() } },
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Order status updated successfully",
    });
  } catch (error) {
    console.error("Update order status error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update order status",
    });
  }
});

module.exports = { router, setDB };
