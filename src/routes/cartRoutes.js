const express = require("express");
const { ObjectId } = require("mongodb");
const { verifyToken } = require("../middleware/verifyToken");

const router = express.Router();
const inFlightMigrations = new Map();
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
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    return null;
  }

  return quantity;
}

function isValidProductId(value) {
  return typeof value === "string" && /^[a-f\d]{24}$/i.test(value);
}

function isAvailableProduct(product) {
  return Boolean(
    product &&
      product.status !== "Draft" &&
      Number.isFinite(product.price) &&
      Number.isInteger(product.stock) &&
      product.stock > 0,
  );
}

function buildCartItem(product, quantity) {
  return {
    productId: product._id.toString(),
    name: product.name,
    price: product.price,
    oldPrice: product.oldPrice,
    image: Array.isArray(product.images) ? product.images[0] || "" : "",
    brand: product.brand || "",
    category: product.category || "",
    stock: product.stock,
    quantity,
  };
}

function mergeCartItems(existingItems, guestItems, productsById) {
  const quantities = new Map();
  let skippedCount = 0;
  let cappedCount = 0;

  for (const item of Array.isArray(existingItems) ? existingItems : []) {
    const productId = item?.productId;
    const product = productsById.get(productId);
    const quantity = normalizeQuantity(item?.quantity);

    if (!isAvailableProduct(product) || !quantity) {
      skippedCount += 1;
      continue;
    }

    quantities.set(
      productId,
      Math.min(product.stock, (quantities.get(productId) || 0) + quantity),
    );
  }

  for (const item of guestItems) {
    const product = productsById.get(item.productId);
    if (!isAvailableProduct(product)) {
      skippedCount += 1;
      continue;
    }

    const desiredQuantity =
      (quantities.get(item.productId) || 0) + item.quantity;
    const nextQuantity = Math.min(product.stock, desiredQuantity);
    if (nextQuantity < desiredQuantity) cappedCount += 1;
    quantities.set(item.productId, nextQuantity);
  }

  return {
    items: [...quantities].map(([productId, quantity]) =>
      buildCartItem(productsById.get(productId), quantity),
    ),
    skippedCount,
    cappedCount,
  };
}

async function getFreshCart(userId, currentCart) {
  const cart = currentCart || (await getCartCollection().findOne({ userId }));
  if (!cart) {
    const now = new Date();
    return { userId, items: [], createdAt: now, updatedAt: now };
  }

  const productIds = [...new Set(
    (Array.isArray(cart.items) ? cart.items : [])
      .map((item) => item?.productId)
      .filter(isValidProductId),
  )].map((id) => new ObjectId(id));
  const products = productIds.length
    ? await getProductsCollection().find({ _id: { $in: productIds } }).toArray()
    : [];
  const productsById = new Map(
    products.map((product) => [product._id.toString(), product]),
  );
  const normalized = mergeCartItems(cart.items, [], productsById).items;

  if (JSON.stringify(normalized) === JSON.stringify(cart.items || [])) {
    return { ...cart, items: normalized };
  }

  const updatedAt = new Date();
  await getCartCollection().updateOne(
    { _id: cart._id },
    { $set: { items: normalized, updatedAt } },
  );

  return { ...cart, items: normalized, updatedAt };
}

router.use(verifyToken);

router.post("/merge", async (req, res) => {
  let migrationLock;
  let releaseMigration;

  try {
    const migrationId = req.get("Idempotency-Key");
    const submittedItems = req.body?.items;

    if (!/^[\w-]{16,128}$/.test(migrationId || "")) {
      return res.status(400).json({
        success: false,
        message: "A valid cart migration key is required",
      });
    }

    if (!Array.isArray(submittedItems) || submittedItems.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Cart items must be an array of at most 100 entries",
      });
    }

    const guestQuantities = new Map();
    for (const item of submittedItems) {
      if (
        !item ||
        Object.keys(item).some((key) => !["productId", "quantity"].includes(key)) ||
        !isValidProductId(item.productId) ||
        !Number.isSafeInteger(item.quantity) ||
        item.quantity <= 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Each cart item requires a valid product ID and positive integer quantity",
        });
      }

      const productId = new ObjectId(item.productId).toString();
      const quantity = (guestQuantities.get(productId) || 0) + item.quantity;
      if (!Number.isSafeInteger(quantity)) {
        return res.status(400).json({
          success: false,
          message: "Cart item quantity is too large",
        });
      }
      guestQuantities.set(productId, quantity);
    }

    const lockKey = `${req.user.id}:${migrationId}`;
    const pendingMigration = inFlightMigrations.get(lockKey);
    if (pendingMigration) {
      await pendingMigration;
      const currentCart = await getFreshCart(req.user.id);
      if (currentCart.migrationIds?.includes(migrationId)) {
        return res.status(200).json({
          success: true,
          message: "Cart migration was already applied",
          data: currentCart,
        });
      }
    }

    migrationLock = new Promise((resolve) => {
      releaseMigration = resolve;
    });
    inFlightMigrations.set(lockKey, migrationLock);

    const carts = getCartCollection();
    let existingCart = await getFreshCart(req.user.id);
    if (existingCart?.migrationIds?.includes(migrationId)) {
      return res.status(200).json({
        success: true,
        message: "Cart migration was already applied",
        data: existingCart,
      });
    }

    const allProductIds = new Set([
      ...guestQuantities.keys(),
      ...(existingCart?.items || [])
        .map((item) => item?.productId)
        .filter(isValidProductId),
    ]);
    const productIds = [...allProductIds].map((id) => new ObjectId(id));
    const products = productIds.length
      ? await getProductsCollection().find({ _id: { $in: productIds } }).toArray()
      : [];
    const productsById = new Map(
      products.map((product) => [product._id.toString(), product]),
    );
    const merged = mergeCartItems(
      existingCart?.items,
      [...guestQuantities].map(([productId, quantity]) => ({ productId, quantity })),
      productsById,
    );
    const now = new Date();

    const filter = existingCart._id
      ? { _id: existingCart._id, migrationIds: { $ne: migrationId } }
      : { userId: req.user.id, migrationIds: { $ne: migrationId } };
    const update = {
      $set: { items: merged.items, updatedAt: now },
      $addToSet: { migrationIds: migrationId },
    };
    if (!existingCart._id) {
      update.$setOnInsert = { userId: req.user.id, createdAt: now };
    }

    const writeResult = await carts.updateOne(filter, update, {
      upsert: !existingCart._id,
    });
    if (existingCart._id && writeResult.matchedCount === 0) {
      existingCart = await getFreshCart(req.user.id);
      return res.status(200).json({
        success: true,
        message: "Cart migration was already applied",
        data: existingCart,
      });
    }

    existingCart = await getFreshCart(req.user.id);
    return res.status(200).json({
      success: true,
      message: "Cart migrated successfully",
      data: existingCart,
      skippedCount: merged.skippedCount,
      cappedCount: merged.cappedCount,
    });
  } catch (error) {
    console.error("Migrate cart error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to migrate cart",
    });
  } finally {
    if (migrationLock) {
      for (const [key, pending] of inFlightMigrations) {
        if (pending === migrationLock) inFlightMigrations.delete(key);
      }
      releaseMigration();
    }
  }
});

router.get("/", async (req, res) => {
  try {
    const cart = await getFreshCart(req.user.id);

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

router.post("/", async (req, res) => {
  try {
    const { productId: submittedProductId, quantity = 1 } = req.body;
    const normalizedQty = normalizeQuantity(quantity);

    if (!isValidProductId(submittedProductId)) {
      return res.status(400).json({
        success: false,
        message: "Valid product ID is required",
      });
    }
    const productId = new ObjectId(submittedProductId).toString();

    if (!normalizedQty) {
      return res.status(400).json({
        success: false,
        message: "Quantity must be a positive integer",
      });
    }

    const product = await getProductsCollection().findOne({
      _id: new ObjectId(productId),
    });

    if (!isAvailableProduct(product)) {
      return res.status(404).json({
        success: false,
        message: "Product is not available",
      });
    }

    const cart = await getFreshCart(req.user.id);

    const itemIndex = cart.items.findIndex((item) => item.productId === productId);
    const itemPayload = buildCartItem(product, normalizedQty);

    if (itemIndex >= 0) {
      const currentQty = cart.items[itemIndex].quantity;
      const nextQty = currentQty + normalizedQty;

      if (nextQty > product.stock) {
        return res.status(400).json({
          success: false,
          message: `Only ${product.stock} units are available for this product`,
        });
      }

      cart.items[itemIndex] = buildCartItem(product, nextQty);
    } else {
      if (normalizedQty > product.stock) {
        return res.status(400).json({
          success: false,
          message: `Only ${product.stock} units are available for this product`,
        });
      }

      cart.items.push(itemPayload);
    }

    cart.updatedAt = new Date();

    const cartToSave = { ...cart };
    delete cartToSave._id;
    await getCartCollection().updateOne(
      { userId: req.user.id },
      { $set: cartToSave },
      { upsert: true },
    );

    const updatedCart = await getFreshCart(req.user.id);

    return res.status(200).json({
      success: true,
      message: "Product added to cart",
      data: updatedCart,
    });
  } catch (error) {
    console.error("Add to cart error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to add product to cart",
    });
  }
});

router.patch("/:productId", async (req, res) => {
  try {
    const { productId: submittedProductId } = req.params;
    const { quantity } = req.body;
    const normalizedQty = normalizeQuantity(quantity);

    if (!isValidProductId(submittedProductId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID",
      });
    }
    const productId = new ObjectId(submittedProductId).toString();

    if (!normalizedQty) {
      return res.status(400).json({
        success: false,
        message: "Quantity must be a positive integer",
      });
    }

    const cart = await getFreshCart(req.user.id);

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

    if (!isAvailableProduct(product)) {
      return res.status(404).json({
        success: false,
        message: "Product is not available",
      });
    }

    if (normalizedQty > product.stock) {
      return res.status(400).json({
        success: false,
        message: `Only ${product.stock} units are available for this product`,
      });
    }

    cart.items[itemIndex] = buildCartItem(product, normalizedQty);
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

router.delete("/:productId", async (req, res) => {
  try {
    const { productId: submittedProductId } = req.params;

    if (!isValidProductId(submittedProductId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID",
      });
    }
    const productId = new ObjectId(submittedProductId).toString();

    const cart = await getFreshCart(req.user.id);

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

router.delete("/", async (req, res) => {
  try {
    const now = new Date();
    await getCartCollection().updateOne(
      { userId: req.user.id },
      {
        $set: { items: [], updatedAt: now },
        $setOnInsert: { userId: req.user.id, createdAt: now },
      },
      { upsert: true },
    );

    return res.status(200).json({
      success: true,
      message: "Cart cleared successfully",
      data: await getFreshCart(req.user.id),
    });
  } catch (error) {
    console.error("Clear cart error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to clear cart",
    });
  }
});

module.exports = { router, setDB, mergeCartItems };
