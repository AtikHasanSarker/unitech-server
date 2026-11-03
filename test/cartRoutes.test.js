const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { ObjectId } = require("mongodb");
const express = require("express");

let mergeCartItems;
let router;
let setDB;
let database;
let apiOrigin;
let privateKey;
let jose;
let jwksServer;
let apiServer;

function createProduct(price, stock) {
  return {
    _id: new ObjectId(),
    name: "Product",
    price,
    stock,
    status: "Active",
    images: ["/product.png"],
  };
}

function createDatabase() {
  const carts = new Map();
  const products = new Map();

  return {
    carts,
    products,
    collection(name) {
      if (name === "products") {
        return {
          findOne: async ({ _id }) => products.get(_id.toString()) || null,
          find: ({ _id: { $in: ids } }) => ({
            toArray: async () => ids
              .map((id) => products.get(id.toString()))
              .filter(Boolean),
          }),
        };
      }

      return {
        findOne: async ({ userId }) => {
          const cart = [...carts.values()].find((item) => item.userId === userId);
          return cart ? structuredClone(cart) : null;
        },
        updateOne: async (filter, update, options = {}) => {
          const cart = [...carts.values()].find((item) => {
            const matchesId = !filter._id || String(item._id) === String(filter._id);
            const matchesUser = !filter.userId || item.userId === filter.userId;
            const migrationId = filter.migrationIds?.$ne;
            const matchesMigration = !migrationId || !item.migrationIds?.includes(migrationId);
            return matchesId && matchesUser && matchesMigration;
          });

          if (cart) {
            Object.assign(cart, structuredClone(update.$set || {}));
            for (const [key, value] of Object.entries(update.$addToSet || {})) {
              cart[key] ||= [];
              if (!cart[key].includes(value)) cart[key].push(value);
            }
            return { matchedCount: 1, upsertedCount: 0 };
          }

          if (!options.upsert) return { matchedCount: 0, upsertedCount: 0 };

          const created = {
            _id: new ObjectId(),
            ...structuredClone(update.$setOnInsert || {}),
            ...structuredClone(update.$set || {}),
          };
          for (const [key, value] of Object.entries(update.$addToSet || {})) {
            created[key] = [value];
          }
          carts.set(String(created._id), created);
          return { matchedCount: 0, upsertedCount: 1 };
        },
      };
    },
  };
}

async function createToken(subject) {
  return new jose.SignJWT({ role: "user" })
    .setProtectedHeader({ alg: "RS256", kid: "cart-test-key" })
    .setSubject(subject)
    .setIssuer(process.env.AUTH_ISSUER)
    .setAudience(process.env.AUTH_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

before(async () => {
  jose = await import("jose");
  const keyPair = await jose.generateKeyPair("RS256");
  privateKey = keyPair.privateKey;
  const publicJwk = await jose.exportJWK(keyPair.publicKey);
  publicJwk.kid = "cart-test-key";
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";

  jwksServer = http.createServer((request, response) => {
    if (request.url !== "/api/auth/jwks") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ keys: [publicJwk] }));
  });
  await new Promise((resolve) => jwksServer.listen(0, "127.0.0.1", resolve));
  const jwksAddress = jwksServer.address();

  process.env.AUTH_ISSUER = "unitech-cart-tests";
  process.env.AUTH_AUDIENCE = "unitech-cart-api-tests";
  process.env.CLIENT_URL = `http://127.0.0.1:${jwksAddress.port}`;

  ({ router, setDB, mergeCartItems } = require("../src/routes/cartRoutes"));
  const app = express();
  app.use(express.json());
  app.use("/api/cart", router);
  apiServer = http.createServer(app);
  await new Promise((resolve) => apiServer.listen(0, "127.0.0.1", resolve));
  apiOrigin = `http://127.0.0.1:${apiServer.address().port}`;
});

after(async () => {
  for (const server of [apiServer, jwksServer]) {
    if (server?.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});

test("merges guest quantities and preserves user-only products with database prices", () => {
  const productA = createProduct(150, 8);
  const productB = createProduct(25, 4);
  const productC = createProduct(90, 6);
  const productIdA = productA._id.toString();
  const productIdB = productB._id.toString();
  const productIdC = productC._id.toString();

  const result = mergeCartItems(
    [
      { productId: productIdA, quantity: 1, price: 1 },
      { productId: productIdC, quantity: 3, price: 1 },
    ],
    [
      { productId: productIdA, quantity: 2 },
      { productId: productIdB, quantity: 1 },
    ],
    new Map([
      [productIdA, productA],
      [productIdB, productB],
      [productIdC, productC],
    ]),
  );

  assert.deepEqual(
    result.items
      .map(({ productId, quantity, price }) => ({ productId, quantity, price }))
      .sort((left, right) => left.productId.localeCompare(right.productId)),
    [
      { productId: productIdA, quantity: 3, price: 150 },
      { productId: productIdB, quantity: 1, price: 25 },
      { productId: productIdC, quantity: 3, price: 90 },
    ].sort((left, right) => left.productId.localeCompare(right.productId)),
  );
  assert.equal(result.skippedCount, 0);
});

test("caps merged quantities at stock and skips unavailable or deleted products", () => {
  const inStockProduct = createProduct(50, 5);
  const outOfStockProduct = createProduct(20, 0);
  const inStockId = inStockProduct._id.toString();
  const outOfStockId = outOfStockProduct._id.toString();
  const deletedId = new ObjectId().toString();

  const result = mergeCartItems(
    [{ productId: inStockId, quantity: 2 }],
    [
      { productId: inStockId, quantity: 8 },
      { productId: outOfStockId, quantity: 1 },
      { productId: deletedId, quantity: 1 },
    ],
    new Map([
      [inStockId, inStockProduct],
      [outOfStockId, outOfStockProduct],
    ]),
  );

  assert.deepEqual(
    result.items.map(({ productId, quantity }) => ({ productId, quantity })),
    [{ productId: inStockId, quantity: 5 }],
  );
  assert.equal(result.cappedCount, 1);
  assert.equal(result.skippedCount, 2);
});

test("cart migration is authenticated, user-scoped, and idempotent", async () => {
  database = createDatabase();
  setDB(database);
  const product = createProduct(150, 8);
  const productId = product._id.toString();
  database.products.set(productId, product);
  const otherCart = {
    _id: new ObjectId(),
    userId: "another-user",
    items: [{ productId, name: "Product", price: 150, quantity: 7 }],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  database.carts.set(String(otherCart._id), otherCart);

  const response = await fetch(`${apiOrigin}/api/cart/merge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items: [{ productId, quantity: 2 }] }),
  });
  assert.equal(response.status, 401);

  const token = await createToken("authenticated-user");
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "Idempotency-Key": "cart-migration-test-0001",
  };
  const payload = {
    userId: "another-user",
    items: [{ productId, quantity: 2 }],
  };
  const firstResponse = await fetch(`${apiOrigin}/api/cart/merge`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const firstResult = await firstResponse.json();
  assert.equal(firstResponse.status, 200);
  assert.equal(firstResult.data.userId, "authenticated-user");
  assert.equal(firstResult.data.items[0].quantity, 2);
  assert.equal(firstResult.data.items[0].price, 150);

  const retryResponse = await fetch(`${apiOrigin}/api/cart/merge`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const retryResult = await retryResponse.json();
  assert.equal(retryResponse.status, 200);
  assert.equal(retryResult.data.items[0].quantity, 2);

  const otherToken = await createToken("another-user");
  const otherCartResponse = await fetch(`${apiOrigin}/api/cart`, {
    headers: { authorization: `Bearer ${otherToken}` },
  });
  const otherCartResult = await otherCartResponse.json();
  assert.equal(otherCartResult.data.items[0].quantity, 7);
});

test("migration caps stock and reports unavailable products", async () => {
  database = createDatabase();
  setDB(database);
  const product = createProduct(40, 3);
  const productId = product._id.toString();
  const deletedProductId = new ObjectId().toString();
  database.products.set(productId, product);

  const token = await createToken("stock-limited-user");
  const response = await fetch(`${apiOrigin}/api/cart/merge`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "Idempotency-Key": "cart-migration-stock-0001",
    },
    body: JSON.stringify({
      items: [
        { productId, quantity: 9 },
        { productId: deletedProductId, quantity: 1 },
      ],
    }),
  });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.data.items[0].quantity, 3);
  assert.equal(result.cappedCount, 1);
  assert.equal(result.skippedCount, 1);
});