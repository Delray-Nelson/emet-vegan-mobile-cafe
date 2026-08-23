// Product card. Image is a branded placeholder until the Stripe catalog supplies
// product.images[0] (then it renders the real photo). The "+" adds simple items
// straight to the cart; items with modifiers open the options modal instead.

import React from "react";
import { usd, placeholderFor } from "../menu.js";

const LeafMark = () => (
  <svg viewBox="0 0 100 100" fill="currentColor" aria-hidden>
    <path d="M50 6C30 26 20 56 50 94C80 56 70 26 50 6Z" />
    <rect x="48" y="32" width="4" height="58" />
  </svg>
);

export default function ProductCard({ item, onAdd, onOpen }) {
  const hasOptions = Array.isArray(item.options) && item.options.length > 0;
  const handlePlus = (e) => {
    e.stopPropagation();
    if (hasOptions) onOpen(item);
    else onAdd(item);
  };
  return (
    <button className="pcard" onClick={() => onOpen(item)} aria-label={item.name}>
      <div className="pcard-img" style={item.img ? undefined : { background: placeholderFor(item.category) }}>
        {item.img ? (
          <img src={item.img} alt={item.name} loading="lazy" />
        ) : (
          <>
            <span className="pcard-ph"><LeafMark /></span>
            <span className="pcard-photo-tag">Photo coming soon</span>
          </>
        )}
        {item.dietary?.length > 0 && (
          <div className="pcard-badges">
            {item.dietary.map((d) => (
              <span key={d} className={"pcard-badge" + (d.toLowerCase() === "new" ? " new" : "")}>{d}</span>
            ))}
          </div>
        )}
        <span className="pcard-add" role="button" aria-label={`Add ${item.name}`} onClick={handlePlus}>+</span>
      </div>
      <div className="pcard-body">
        <span className="pcard-name">{item.name}</span>
        {item.description && <span className="pcard-desc">{item.description}</span>}
        <span className="pcard-price">{usd(item.priceCents)}</span>
      </div>
    </button>
  );
}
