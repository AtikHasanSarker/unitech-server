const express = require("express");
const { ObjectId } = require("mongodb");
const { verifyToken, requireAdmin } = require("../middleware/verifyToken");

const router = express.Router();
let db;

function setDB(database) {
  db = database;
}

function getUsersCollection() {
  if (!db) {
    throw new Error("Database is not connected");
  }

  const candidates = ["user", "users"];

  for (const name of candidates) {
    const collection = db.collection(name);
    if (collection) {
      return collection;
    }
  }

  return db.collection("user");
}

router.get("/", verifyToken, requireAdmin, async (req, res) => {
  try {
    const users = await getUsersCollection().find({}).project({ password: 0, passwordHash: 0, token: 0 }).sort({ createdAt: -1 }).toArray();

    return res.status(200).json({
      success: true,
      count: users.length,
      data: users,
    });
  } catch (error) {
    console.error("List users error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch users",
    });
  }
});

router.get("/:id", verifyToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID",
      });
    }

    const user = await getUsersCollection().findOne({ _id: new ObjectId(id) });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    delete user.password;
    delete user.passwordHash;
    delete user.token;

    return res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error("Get user error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch user",
    });
  }
});

router.patch("/:id/role", verifyToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID",
      });
    }

    if (req.user.id === id) {
      return res.status(403).json({
        success: false,
        message: "You cannot change your own role through this endpoint",
      });
    }

    if (!role || !["user", "admin"].includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Role must be either user or admin",
      });
    }

    const user = await getUsersCollection().findOne({ _id: new ObjectId(id) });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const result = await getUsersCollection().updateOne(
      { _id: new ObjectId(id) },
      { $set: { role, updatedAt: new Date() } },
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "User role updated successfully",
    });
  } catch (error) {
    console.error("Update user role error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update user role",
    });
  }
});

module.exports = { router, setDB };
