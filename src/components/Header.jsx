// Minimal sticky header: brand + location/pickup selector · search · cart + CTA.
// Single-vendor for now, so the "vendor switcher" is a pickup/location pill;
// it's structured to become a real switcher when a second vendor exists.

import React from "react";
import { logo } from "../logo.js";
import { useCart } from "../lib/cart.js";
import { usd } from "../menu.js";

export default function Header({ query, onQuery, onOpenCart, onCheckout }) {
  const { count, subtotalCents } = useCart();
  return (
    <header className="hdr">
      <div className="hdr-in">
        <div className="hdr-brand">
          <img className="hdr-logo" src={logo} alt="" aria-hidden />
          <span className="hdr-word"><b>EMET</b><small>Vegan Cafe</small></span>
          <span className="hdr-loc" title="Single location — pickup">
            <i aria-hidden>📍</i> Pickup · <b>EMET</b>
          </span>
        </div>

        <div className="hdr-search" role="search">
          <span className="mag" aria-hidden>⌕</span>
          <input
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search the menu"
            aria-label="Search the menu"
          />
        </div>

        <div className="hdr-actions">
          <button className="hdr-cart" onClick={onOpenCart} aria-label={`Cart, ${count} items`}>
            🛒{count > 0 && <span className="hdr-badge">{count}</span>}
          </button>
          <button className="hdr-cta" onClick={onCheckout} disabled={count === 0}>
            {count > 0 ? `Checkout · ${usd(subtotalCents)}` : "Order now"}
          </button>
        </div>
      </div>
    </header>
  );
}
