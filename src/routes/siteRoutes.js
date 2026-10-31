const express = require("express");

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

function isValidEmail(email) {
  return typeof email === "string" && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

router.post("/contact", async (req, res) => {
  try {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const subject = typeof req.body.subject === "string" ? req.body.subject.trim() : "";
    const message = typeof req.body.message === "string" ? req.body.message.trim() : "";

    if (name.length < 2 || name.length > 120) {
      return res.status(400).json({ success: false, message: "Name must be between 2 and 120 characters" });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "A valid email address is required" });
    }
    if (subject.length < 3 || subject.length > 160) {
      return res.status(400).json({ success: false, message: "Subject must be between 3 and 160 characters" });
    }
    if (message.length < 10 || message.length > 5000) {
      return res.status(400).json({ success: false, message: "Message must be between 10 and 5000 characters" });
    }

    const now = new Date();
    const result = await getCollection("contactMessages").insertOne({
      name,
      email,
      subject,
      message,
      status: "New",
      createdAt: now,
      updatedAt: now,
    });

    return res.status(201).json({
      success: true,
      message: "Your message has been received",
      data: { id: result.insertedId.toString(), status: "New", createdAt: now },
    });
  } catch (error) {
    console.error("Create contact message error:", error);
    return res.status(500).json({ success: false, message: "Failed to submit contact message" });
  }
});

router.post("/newsletter", async (req, res) => {
  try {
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";

    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "A valid email address is required" });
    }

    const subscribers = getCollection("newsletterSubscribers");
    const existing = await subscribers.findOne({ email });
    if (existing) {
      return res.status(409).json({ success: false, message: "This email is already subscribed" });
    }

    const now = new Date();
    const result = await subscribers.insertOne({
      email,
      status: "Subscribed",
      createdAt: now,
      updatedAt: now,
    });

    return res.status(201).json({
      success: true,
      message: "Subscription created successfully",
      data: { id: result.insertedId.toString(), email, status: "Subscribed", createdAt: now },
    });
  } catch (error) {
    console.error("Create newsletter subscription error:", error);
    return res.status(500).json({ success: false, message: "Failed to subscribe to newsletter" });
  }
});

module.exports = { router, setDB };
