// Item detail / modifier modal. Opens from a card (or the card's "+" when the
// item has options). Free modifier selections become a display `note` on the
// cart line; price stays the base price (server prices by id — paid add-ons are
// roadmapped alongside delivery fees).

import React, { useState } from "react";
import { usd, placeholderFor } from "../menu.js";

const LeafMark = () => (
  <svg viewBox="0 0 100 100" fill="currentColor" aria-hidden style={{ width: 44, height: 44, color: "rgba(0,0,0,.32)" }}>
    <path d="M50 6C30 26 20 56 50 94C80 56 70 26 50 6Z" /><rect x="48" y="32" width="4" height="58" />
  </svg>
);

export default function ItemModal({ item, onClose, onAdd }) {
  const groups = item.options || [];
  const [choice, setChoice] = useState(() =>
    Object.fromEntries(groups.map((g) => [g.label, g.choices[0]]))
  );
  const [qty, setQty] = useState(1);

  const note = groups.map((g) => choice[g.label]).filter(Boolean).join(" · ");

  return (
    <div className="im-overlay" onClick={onClose}>
      <div className="im-sheet" role="dialog" aria-modal="true" aria-label={item.name} onClick={(e) => e.stopPropagation()}>
        <div className="im-photo" style={item.img ? undefined : { background: placeholderFor(item.category), display: "flex", alignItems: "center", justifyContent: "center" }}>
          {item.img ? <img src={item.img} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <LeafMark />}
          <button className="im-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="im-body">
          <h3 className="im-name">{item.name}</h3>
          {item.description && <p className="im-desc">{item.description}</p>}
          {groups.map((g) => (
            <div key={g.label} className="im-opt">
              <h4>{g.label}</h4>
              <div className="im-choices">
                {g.choices.map((c) => (
                  <button
                    key={c}
                    className={"im-choice" + (choice[g.label] === c ? " on" : "")}
                    onClick={() => setChoice((cur) => ({ ...cur, [g.label]: c }))}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="im-foot">
          <div className="im-qty">
            <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease quantity">−</button>
            <span>{qty}</span>
            <button onClick={() => setQty((q) => q + 1)} aria-label="Increase quantity">+</button>
          </div>
          <button className="im-add" onClick={() => { onAdd(item, { note, qty }); onClose(); }}>
            Add {qty} · {usd(item.priceCents * qty)}
          </button>
        </div>
      </div>
    </div>
  );
}
