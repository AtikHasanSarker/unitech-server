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
const VALID_PAYMENT_STATUSES = ["Pending", "Paid", "Failed", "Refunded"];
const COUPONS = {
  NSTU10: { percentage: 0.1 },
  SAVE50: { amount: 50 },
};

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
    const {
      items,
      shippingFee = 0,
      paymentMethod = "Cash on Delivery",
      deliveryAddress,
      couponCode = "",
    } = req.body;

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

    const normalizedShippingFee = Number(shippingFee);

    if (!Number.isFinite(normalizedShippingFee) || normalizedShippingFee < 0) {
      return res.status(400).json({
        success: false,
        message: "Shipping fee must be a non-negative number",
      });
    }

    const normalizedCouponCode = typeof couponCode === "string"
      ? couponCode.trim().toUpperCase()
      : "";
    const coupon = normalizedCouponCode ? COUPONS[normalizedCouponCode] : null;

    if (normalizedCouponCode && !coupon) {
      return res.status(400).json({
        success: false,
        message: "Invalid coupon code",
      });
    }

    const discount = coupon?.percentage
      ? Math.round(subtotal * coupon.percentage)
      : Math.min(coupon?.amount || 0, subtotal);
    const total = subtotal - discount + normalizedShippingFee;

    const order = {
      userId: req.user.id,
      userEmail: req.user.email || "",
      status: "Pending",
      paymentStatus: "Pending",
      paymentMethod,
      deliveryAddress: deliveryAddress || "",
      couponCode: normalizedCouponCode,
      shippingFee: normalizedShippingFee,
      subtotal,
      discount,
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

router.patch("/:id/payment-status", verifyToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { paymentStatus } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order ID",
      });
    }

    if (!VALID_PAYMENT_STATUSES.includes(paymentStatus)) {
      return res.status(400).json({
        success: false,
        message: "Payment status must be one of: Pending, Paid, Failed, Refunded",
      });
    }

    const result = await getOrdersCollection().updateOne(
      { _id: new ObjectId(id) },
      { $set: { paymentStatus, updatedAt: new Date() } },
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Payment status updated successfully",
    });
  } catch (error) {
    console.error("Update payment status error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update payment status",
    });
  }
});

module.exports = { router, setDB };
