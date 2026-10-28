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

module.exports = { router, setDB };
