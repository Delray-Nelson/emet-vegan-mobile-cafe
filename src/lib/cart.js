// Shared cart state for the storefront (Header badge, ProductCard +, CartSidebar).
// Lines are keyed by id + chosen modifiers so the same item with different options
// stacks as separate lines. Checkout consumes lines as [{id, qty}] (options ride
// along as a display-only `note`; pricing stays server-side and base-price only).

import React, { createContext, useContext, useMemo, useState, useCallback } from "react";

const CartCtx = createContext(null);

const lineKey = (id, note) => (note ? `${id}::${note}` : id);

export function CartProvider({ children }) {
  const [lines, setLines] = useState([]); // [{key,id,name,priceCents,qty,note,category}]
  const [fulfillment, setFulfillment] = useState("pickup"); // pickup | delivery(soon)

  const add = useCallback((item, { note = "", qty = 1 } = {}) => {
    const key = lineKey(item.id, note);
    setLines((cur) => {
      const found = cur.find((l) => l.key === key);
      if (found) return cur.map((l) => (l.key === key ? { ...l, qty: l.qty + qty } : l));
      return [...cur, {
        key, id: item.id, name: item.name, priceCents: item.priceCents,
        qty, note, category: item.category,
      }];
    });
  }, []);

  const inc = useCallback((key) =>
    setLines((cur) => cur.map((l) => (l.key === key ? { ...l, qty: l.qty + 1 } : l))), []);
  const dec = useCallback((key) =>
    setLines((cur) => cur.map((l) => (l.key === key ? { ...l, qty: l.qty - 1 } : l)).filter((l) => l.qty > 0)), []);
  const remove = useCallback((key) =>
    setLines((cur) => cur.filter((l) => l.key !== key)), []);
  const clear = useCallback(() => setLines([]), []);

  const value = useMemo(() => {
    const count = lines.reduce((n, l) => n + l.qty, 0);
    const subtotalCents = lines.reduce((n, l) => n + l.priceCents * l.qty, 0);
    return { lines, count, subtotalCents, add, inc, dec, remove, clear, fulfillment, setFulfillment };
  }, [lines, add, inc, dec, remove, clear, fulfillment]);

  return React.createElement(CartCtx.Provider, { value }, children);
}

export function useCart() {
  const ctx = useContext(CartCtx);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
