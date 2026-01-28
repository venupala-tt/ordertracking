import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const app = express();

// ─────────────────────────────────────
// Middleware
// ─────────────────────────────────────
app.use(cors());
app.use(express.json());

// ─────────────────────────────────────
// Health check
// ─────────────────────────────────────
app.get("/ping", (req, res) => {
  res.send("API alive");
});

// ─────────────────────────────────────
// Track Order API
// ─────────────────────────────────────
app.post("/api/track-order", async (req, res) => {
  console.log("📥 Incoming body:", req.body);

  try {
    const { orderNumber, email } = req.body || {};

    if (!orderNumber || !email) {
      return res.status(400).json({
        error: "Order number and email required",
      });
    }

    const cleanOrder = orderNumber.replace("#", "").trim();

    // ───────── Fetch order ─────────
    const orderRes = await fetch(
      `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/orders.json?name=${cleanOrder}&status=any`,
      {
        headers: {
          "X-Shopify-Access-Token":
            process.env.SHOPIFY_ADMIN_API_TOKEN,
          "Content-Type": "application/json",
        },
      }
    );

    if (!orderRes.ok) {
      return res.status(orderRes.status).json({
        error: "Failed to fetch order from Shopify",
      });
    }

    const orderData = await orderRes.json();

    if (!orderData.orders || orderData.orders.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    const order = orderData.orders[0];

    // Email validation
    if (
      !order.email ||
      order.email.toLowerCase() !== email.toLowerCase()
    ) {
      return res.status(403).json({
        error: "Email does not match order",
      });
    }

    // ───────── Fetch metafield (SAFE & OPTIONAL) ─────────
    let customShippingStatus = null;

    try {
      const metafieldsRes = await fetch(
        `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/orders/${order.id}/metafields.json`,
        {
          headers: {
            "X-Shopify-Access-Token":
              process.env.SHOPIFY_ADMIN_API_TOKEN,
          },
        }
      );

      if (metafieldsRes.ok) {
        const metafieldsData = await metafieldsRes.json();
        const mf = metafieldsData.metafields?.find(
          (m) =>
            m.namespace === "custom" &&
            m.key === "shipping_status"
        );
        customShippingStatus = mf?.value || null;
      }
    } catch (err) {
      console.warn("⚠ Metafield fetch skipped");
    }

    const fulfillment = order.fulfillments?.[0];

    // ───────── FINAL RESPONSE ─────────
    return res.json({
      orderId: order.id,
      orderCust: order.customer.firstName,
      orderName: order.name,
      financialStatus: order.financial_status,
      fulfillmentStatus: order.fulfillment_status,
      shippingStatus:
        customShippingStatus ||
        (fulfillment
          ? fulfillment.shipment_status || "Shipped"
          : "Order Placed"),
      trackingNumber: fulfillment?.tracking_number || null,
      trackingUrl: fulfillment?.tracking_url || null,
    });
  } catch (err) {
    console.error("❌ Server error:", err);
    return res.status(500).json({
      error: "Internal server error",
    });
  }
});

// ─────────────────────────────────────
// 404 fallback (prevents hanging browser)
// ─────────────────────────────────────
app.use((req, res) => {
  res.status(404).send("Route not found");
});

// ─────────────────────────────────────
// Start server
// ─────────────────────────────────────
const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`🚀 Order Tracking API running on port ${PORT}`);

});
