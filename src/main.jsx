import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";

import "./styles/tokens.css";
import "./styles/storefront.css";

import App from "./App.jsx";
import Checkout from "./components/Checkout.jsx";
import OrderTracker from "./components/OrderTracker.jsx";
import StaffDashboard from "./components/StaffDashboard.jsx";
import { CartProvider } from "./lib/cart.js";

// One React app, four routes:
//   /           customer — DoorDash-style storefront (menu + cart)
//   /checkout   customer — slot picker → Stripe
//   /order/:id  customer — tracking page (Stripe success_url), polls 12s
//   /staff      owner    — dashboard, polls 8s, behind a shared staff token
// SPA deep links need the Amplify rewrite (see docs/DEPLOY.md).
createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <CartProvider>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/order/:id" element={<OrderTracker />} />
          <Route path="/staff" element={<StaffDashboard />} />
          <Route path="*" element={<App />} />
        </Routes>
      </CartProvider>
    </BrowserRouter>
  </React.StrictMode>
);
