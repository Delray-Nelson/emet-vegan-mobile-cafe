// EMET storefront ("/") — DoorDash-style ordering in the EMET brand.
// Minimal sticky header · sticky category bar · [category rail | food grid |
// live cart] on desktop, collapsing to grid + sticky cart bar on mobile.
// Menu hydrates from the Stripe catalog (fetchStripeCatalog) with the local MENU
// as instant fallback. Cart hands off to /checkout (slot picker → Stripe).

import React, { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";

import Header from "./components/Header.jsx";
import Hero from "./components/Hero.jsx";
import CategoryNav from "./components/CategoryNav.jsx";
import ProductGrid from "./components/ProductGrid.jsx";
import CartSidebar from "./components/CartSidebar.jsx";
import ItemModal from "./components/ItemModal.jsx";

import { useCart } from "./lib/cart.js";
import { fetchStripeCatalog } from "./lib/api.js";
import { MENU, VENDOR_ID, groupByCategory } from "./menu.js";

export default function App() {
  const navigate = useNavigate();
  const { add, count } = useCart();

  const [items, setItems] = useState(MENU);       // instant local render
  const [query, setQuery] = useState("");
  const [active, setActive] = useState("");
  const [modalItem, setModalItem] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const sectionRefs = useRef({});

  // hydrate from Stripe catalog; keep local fallback if empty/unavailable
  useEffect(() => {
    let alive = true;
    fetchStripeCatalog({ vendorId: VENDOR_ID })
      .then((got) => { if (alive && got && got.length) setItems(got); })
      .catch(() => { /* keep local MENU */ });
    return () => { alive = false; };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((m) =>
      m.name.toLowerCase().includes(q) || (m.description || "").toLowerCase().includes(q)
    );
  }, [items, query]);

  const groups = useMemo(() => groupByCategory(filtered), [filtered]);

  useEffect(() => { if (groups.length && !active) setActive(groups[0].id); }, [groups, active]);

  // scroll-spy: mark the section under the sticky bars active
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => { if (e.isIntersecting) setActive(e.target.id); });
      },
      { rootMargin: "-120px 0px -74% 0px", threshold: 0 }
    );
    Object.values(sectionRefs.current).forEach((el) => el && obs.observe(el));
    return () => obs.disconnect();
  }, [groups]);

  const goToSection = (id) => {
    setActive(id);
    sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const scrollToMenu = () => { const first = groups[0]?.id; if (first) goToSection(first); };

  const goCheckout = () => {
    if (count === 0) return;
    setDrawerOpen(false);
    navigate("/checkout", { state: { cart: cartLinesForCheckout() } });
  };

  // pull the current cart lines out of context via a hidden reader
  const cartLinesRef = useRef([]);
  const cartLinesForCheckout = () => cartLinesRef.current;

  return (
    <div className="store">
      <CartLinesBridge onLines={(l) => { cartLinesRef.current = l; }} />

      <Header
        query={query}
        onQuery={setQuery}
        onOpenCart={() => setDrawerOpen(true)}
        onCheckout={goCheckout}
      />

      <Hero onOrder={scrollToMenu} onMenu={scrollToMenu} />

      <div className="vbanner">
        <div>
          <h1>EMET Vegan Cafe</h1>
          <div className="meta">
            <span className="g">★ 4.9</span>
            <span>Plant-based · Smoothies, juices, wraps, bowls</span>
            <span>Pickup · ready in ~12 min</span>
          </div>
        </div>
        <p className="tagline">Bold Flavor. Rooted in Truth.</p>
      </div>

      <CategoryNav groups={groups} active={active} onPick={goToSection} />

      <div className="store-grid">
        <ProductGrid
          groups={groups}
          sectionRefs={sectionRefs}
          onAdd={(item) => add(item)}
          onOpen={(item) => setModalItem(item)}
        />

        <aside className="cart-col">
          <CartSidebar onCheckout={goCheckout} />
        </aside>
      </div>

      {/* mobile sticky cart bar */}
      {count > 0 && (
        <div className="cartbar">
          <button className="cartbar-btn" onClick={() => setDrawerOpen(true)}>
            <span><span className="c">{count}</span>&nbsp; View order</span>
            <span>Checkout →</span>
          </button>
        </div>
      )}

      {/* mobile cart drawer */}
      {drawerOpen && (
        <div className="drawer-overlay" onClick={() => setDrawerOpen(false)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <CartSidebar onCheckout={goCheckout} embedded />
          </div>
        </div>
      )}

      {modalItem && (
        <ItemModal
          item={modalItem}
          onClose={() => setModalItem(null)}
          onAdd={(item, opts) => add(item, opts)}
        />
      )}
    </div>
  );
}

// Small bridge so the parent can read cart lines for the checkout handoff
// without threading them through every prop.
function CartLinesBridge({ onLines }) {
  const { lines } = useCart();
  useEffect(() => { onLines(lines); }, [lines, onLines]);
  return null;
}
