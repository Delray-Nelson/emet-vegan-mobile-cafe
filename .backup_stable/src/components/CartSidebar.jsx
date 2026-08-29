// Live order sidebar (desktop) / drawer body (mobile). Fulfillment toggle,
// editable line items, subtotal, and the checkout trigger that hands the cart to
// /checkout (slot picker → Stripe). Delivery is present but disabled until the
// ZIP-based delivery-fee work lands (docs/ROADMAP.md).

import React from "react";
import { useCart } from "../lib/cart.js";
import { usd } from "../menu.js";

const Bag = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
    <path d="M6 7h12l-1 13H7L6 7z" /><path d="M9 7a3 3 0 0 1 6 0" />
  </svg>
);

export default function CartSidebar({ onCheckout, embedded = false }) {
  const { lines, count, subtotalCents, inc, dec, fulfillment, setFulfillment } = useCart();

  return (
    <div className="cart">
      <div className="cart-h">
        <h3>Your order</h3>
        <div className="cart-fulfill-badge">
          <span>🚗 Delivery Order</span>
        </div>
      </div>

      {count === 0 ? (
        <div className="cart-empty"><Bag /><p>Your cart is empty. Add something tasty from the menu.</p></div>
      ) : (
        <ul className="cart-lines">
          {lines.map((l) => (
            <li key={l.key} className="cart-line">
              <span className="cart-qty">
                <button onClick={() => dec(l.key)} aria-label={`Remove one ${l.name}`}>−</button>
                <span>{l.qty}</span>
                <button onClick={() => inc(l.key)} aria-label={`Add one ${l.name}`}>+</button>
              </span>
              <span>
                <span className="nm">{l.name}</span>
                {l.note && <span className="note"> · {l.note}</span>}
              </span>
              <span className="lp">{usd(l.priceCents * l.qty)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="cart-foot">
        <div className="cart-sub"><span>Subtotal</span><span>{usd(subtotalCents)}</span></div>
        <button className="cart-checkout" disabled={count === 0} onClick={onCheckout}>
          {count === 0 ? "Add items to continue" : `Checkout · ${usd(subtotalCents)}`}
        </button>
      </div>
    </div>
  );
}
