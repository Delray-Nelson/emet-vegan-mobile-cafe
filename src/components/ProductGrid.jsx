// Sectional food grid — one section per category, each with an id anchor the
// category bar / rail scroll to and the scroll-spy observes.

import React from "react";
import ProductCard from "./ProductCard.jsx";

export default function ProductGrid({ groups, sectionRefs, onAdd, onOpen }) {
  if (groups.length === 0) {
    return <p className="cart-empty">No items match your search.</p>;
  }
  return (
    <div className="store-main">
      {groups.map((g) => (
        <section
          key={g.id}
          id={g.id}
          className="msec"
          ref={(el) => { if (sectionRefs) sectionRefs.current[g.id] = el; }}
        >
          <h2 className="msec-h">{g.category}</h2>
          <p className="msec-sub">{g.items.length} item{g.items.length !== 1 ? "s" : ""}</p>
          <div className="msec-grid">
            {g.items.map((item) => (
              <ProductCard key={item.id} item={item} onAdd={onAdd} onOpen={onOpen} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
