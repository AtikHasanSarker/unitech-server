const express = require("express");
const { verifyToken, requireAdmin } = require("../middleware/verifyToken");

const router = express.Router();
let db;

function setDB(database) {
  db = database;
}

function getCollection(name) {
  if (!db) {
    throw new Error("Database is not connected");
  }

  return db.collection(name);
}

const DEFAULT_SETTINGS = {
  storeName: "UniTech",
  storeEmail: "support@unitech.com",
  storePhone: "+880 1XXX-XXXXXX",
  storeAddress: "Noakhali, Bangladesh",
  currency: "BDT",
  timezone: "Asia/Dhaka",
  adminName: "Store Administrator",
  adminEmail: "admin@unitech.com",
  language: "English",
  orderNotifications: true,
  lowStockNotifications: true,
  customerMessages: true,
  promotionalEmails: false,
};

const SETTINGS_FIELDS = Object.keys(DEFAULT_SETTINGS);

function validateSettings(settings) {
  for (const field of SETTINGS_FIELDS) {
    if (settings[field] === undefined) {
      return `${field} is required`;
    }
  }

  for (const field of ["storeName", "storeEmail", "adminName", "adminEmail"]) {
    if (typeof settings[field] !== "string" || !settings[field].trim()) {
      return `${field} must be a non-empty string`;
    }
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.storeEmail)) {
    return "storeEmail must be a valid email address";
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.adminEmail)) {
    return "adminEmail must be a valid email address";
  }

  if (!["BDT", "USD", "INR"].includes(settings.currency)) {
    return "currency must be BDT, USD, or INR";
  }

  for (const field of ["orderNotifications", "lowStockNotifications", "customerMessages", "promotionalEmails"]) {
    if (typeof settings[field] !== "boolean") {
      return `${field} must be a boolean`;
    }
  }

  return null;
}

router.get("/dashboard/stats", verifyToken, requireAdmin, async (req, res) => {
  try {
    const productsCount = await getCollection("products").countDocuments();
    const categoriesCount = await getCollection("categories").countDocuments();

    let usersCount = 0;
    for (const name of ["user", "users"]) {
      try {
        usersCount = await getCollection(name).countDocuments();
        if (usersCount > 0 || name === "users") break;
      } catch (error) {
        // safe fallback
      }
    }

    const ordersCollection = getCollection("orders");
    const totalOrders = await ordersCollection.countDocuments();
    const pendingOrders = await ordersCollection.countDocuments({ status: "Pending" });
    const totalRevenue = await ordersCollection
      .aggregate([
        { $match: { status: { $ne: "Cancelled" } } },
        { $group: { _id: null, total: { $sum: "$total" } } },
      ])
      .toArray();

    const stats = {
      totalProducts: productsCount,
      totalCategories: categoriesCount,
      totalUsers: usersCount,
      totalOrders,
      pendingOrders,
      totalRevenue: totalRevenue[0]?.total || 0,
    };

    return res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("Admin dashboard stats error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch dashboard statistics",
    });
  }
});

router.get("/settings", verifyToken, requireAdmin, async (req, res) => {
  try {
    const savedSettings = await getCollection("adminSettings").findOne({ _id: "store" });
    return res.status(200).json({
      success: true,
      data: savedSettings ? Object.fromEntries(SETTINGS_FIELDS.map((field) => [field, savedSettings[field]])) : DEFAULT_SETTINGS,
    });
  } catch (error) {
    console.error("Get admin settings error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch admin settings",
    });
  }
});

router.put("/settings", verifyToken, requireAdmin, async (req, res) => {
  try {
    const settings = Object.fromEntries(
      SETTINGS_FIELDS.map((field) => [
        field,
        typeof req.body[field] === "string" ? req.body[field].trim() : req.body[field],
      ]),
    );
    const validationError = validateSettings(settings);

    if (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError,
      });
    }

    const updatedAt = new Date();
    await getCollection("adminSettings").updateOne(
      { _id: "store" },
      { $set: { ...settings, updatedAt } },
      { upsert: true },
    );

    return res.status(200).json({
      success: true,
      message: "Admin settings saved successfully",
      data: { ...settings, updatedAt },
    });
  } catch (error) {
    console.error("Save admin settings error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to save admin settings",
    });
  }
});

module.exports = { router, setDB };
