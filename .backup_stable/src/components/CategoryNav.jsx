// Sticky category bar — chips scroll to their section; the active chip reflects
// the section currently in view (scroll-spy is driven by the parent via `active`).

import React, { useRef, useEffect } from "react";

export default function CategoryNav({ groups, active, onPick }) {
  const barRef = useRef(null);

  // keep the active chip in view as you scroll
  useEffect(() => {
    const el = barRef.current?.querySelector(`[data-cat="${active}"]`);
    el?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [active]);

  return (
    <nav className="catnav" aria-label="Menu categories">
      <div className="catnav-in" ref={barRef}>
        {groups.map((g) => (
          <button
            key={g.id}
            data-cat={g.id}
            className={"catnav-chip" + (active === g.id ? " on" : "")}
            onClick={() => onPick(g.id)}
          >
            {g.category}
          </button>
        ))}
      </div>
    </nav>
  );
}
