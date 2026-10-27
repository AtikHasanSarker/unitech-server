const { createRemoteJWKSet, jwtVerify } = require("jose");

const authIssuer = process.env.AUTH_ISSUER;
const authAudience = process.env.AUTH_AUDIENCE;
const clientURL = process.env.CLIENT_URL;

if (!authIssuer || !authAudience || !clientURL) {
  throw new Error(
    "AUTH_ISSUER, AUTH_AUDIENCE and CLIENT_URL must be configured",
  );
}

const JWKS = createRemoteJWKSet(new URL("/api/auth/jwks", clientURL));

// Verify JWT
async function verifyToken(req, res, next) {
  try {
    const authorization = req.headers.authorization;

    if (!authorization || !authorization.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authentication token is required",
      });
    }

    const token = authorization.split(" ")[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication token is required",
      });
    }

    const { payload } = await jwtVerify(token, JWKS, {
      issuer: authIssuer,
      audience: authAudience,
    });

    if (typeof payload.sub !== "string" || !payload.sub) {
      return res.status(401).json({
        success: false,
        message: "Invalid authentication token",
      });
    }

    req.user = {
      id: payload.sub,
      role: payload.role,
      email: payload.email,
    };

    next();
  } catch (error) {
    console.error("Token verification error:", error.message);

    return res.status(401).json({
      success: false,
      message: "Invalid or expired authentication token",
    });
  }
}

// Verify Admin role
function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: "Authentication required",
    });
  }

  if (req.user.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Admin access required",
    });
  }

  next();
}

module.exports = {
  verifyToken,
  requireAdmin,
};
