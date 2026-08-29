// /order/:id — Customer delivery tracking page (Stripe success_url target)
// Displays live 4-stage delivery timeline:
// Accepted -> Being Made -> Out for Delivery -> Delivered
// Polls every 12s

import React, { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { getOrder } from "../lib/api.js";
import { logo } from "../logo.js";
import { MENU_BY_ID } from "../menu.js";

const POLL_MS = 12000;

// The customer-facing delivery stages
const STAGES = [
  { key: "accepted",         title: "Order Accepted",      sub: "We’ve got your order and payment.", icon: "leaf" },
  { key: "being_made",       title: "Being Prepared",      sub: "Your meal is being freshly crafted.", icon: "spark" },
  { key: "out_for_delivery", title: "Out for Delivery",    sub: "Courier is en route to your address.", icon: "car" },
  { key: "delivered",        title: "Delivered",           sub: "Dropped off. Enjoy your meal!", icon: "check" },
];

const RANK = {
  pending_payment: 0,
  accepted: 1,
  being_made: 2,
  out_for_delivery: 3,
  delivered: 4,
  ready: 2, // backward-compat mapped to prep
  picked_up: 4, // backward-compat mapped to delivered
  cancelled: -1,
};

export default function OrderTracker() {
  const { id } = useParams();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const timer = useRef(null);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const data = await getOrder(id);
        if (alive) { setOrder(data); setError(null); setLoading(false); }
      } catch (e) {
        if (alive) { setError(e.message); setLoading(false); }
      }
    }
    tick();
    timer.current = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(timer.current); };
  }, [id]);

  const status = order?.status || "pending_payment";
  const rank = RANK[status] ?? 0;
  const isCancelled = status === "cancelled";
  const isDelivered = status === "delivered" || status === "picked_up";

  return (
    <div className="ot">
      <style>{css}</style>
      <div className="ot-phone">
        <div className="ot-screen">
          <div className="ot-brand">
            <img src={logo} alt="EMET Logo" aria-hidden />
            <span className="ot-emet">EMET</span>
            <span className="ot-sub">Vegan Cafe · Delivery Tracker</span>
          </div>

          {loading && <p className="ot-note">Loading your delivery details…</p>}
          {error && !order && (
            <p className="ot-err">We couldn’t find that order. Double-check your link, or call (404) 941-0711.</p>
          )}

          {order && (
            <>
              <div className="ot-meta">
                <span className="ot-no">Order #{shortId(order.orderId || id)}</span>
                {order.deliveryWindow && (
                  <span className="ot-pickup">Window: <b>{fmtWindow(order.deliveryWindow)}</b></span>
                )}
              </div>

              {order.deliveryAddress && (
                <div className="ot-dest">
                  <span>🚗 Delivering to:</span>
                  <strong>{order.deliveryAddress}, {order.deliveryCity || "Locust Grove"} GA {order.deliveryZip || ""}</strong>
                </div>
              )}

              {order.items && (
                <p className="ot-items">
                  {order.items.map((it) => `${it.qty || 1}× ${MENU_BY_ID[it.id]?.name || it.name || it.id}`).join(" · ")}
                </p>
              )}

              {isCancelled ? (
                <div className="ot-cleared">
                  <p>This order was cancelled. Please call us at (404) 941-0711 if you have questions.</p>
                </div>
              ) : (
                <ol className="ot-stem">
                  {STAGES.map((s, i) => {
                    const done = rank > i + 1;
                    const active = rank === i + 1;
                    const state = done ? "done" : active ? "active" : "todo";
                    return (
                      <li key={s.key} className={"ot-step " + state}>
                        <span className={"ot-dot " + s.icon}>{glyph(s.icon)}</span>
                        <div className="ot-step-body">
                          <div className="ot-step-title">{s.title}</div>
                          <div className="ot-step-sub">{s.sub}</div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}

              {status === "out_for_delivery" && (
                <div className="ot-ready">
                  <b>Courier is on the way! 🚗💨</b>
                  <span>Keep your phone nearby. The courier will arrive shortly.</span>
                </div>
              )}

              {isDelivered && (
                <div className="ot-ready done">
                  <b>Order Delivered! 🌱</b>
                  <span>Thank you for choosing EMET Vegan Cafe!</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <p className="ot-footnote">Live status updates automatically every 12 seconds.</p>
    </div>
  );
}

function shortId(v = "") {
  const s = String(v).replace(/[^a-zA-Z0-9]/g, "");
  return s.slice(-4).toUpperCase() || s.toUpperCase();
}

function fmtWindow(w = "") {
  if (!w) return "";
  const parts = w.split("T");
  if (parts.length < 2) return w;
  const [h, m] = parts[1].split(":");
  const hr = ((+h + 11) % 12) + 1;
  return `${hr}:${m} ${+h < 12 ? "AM" : "PM"}`;
}

function glyph(icon) {
  if (icon === "leaf") return "❧";
  if (icon === "spark") return "✦";
  if (icon === "car") return "🚗";
  return "✓";
}

const css = `
.ot{min-height:100vh;background:var(--obsidian);display:flex;flex-direction:column;align-items:center;
  justify-content:center;padding:2rem 1rem;gap:1rem;}
.ot-phone{width:100%;max-width:440px;border:1px solid var(--border);border-radius:28px;background:var(--forest);
  padding:10px;box-shadow:var(--shadow);}
.ot-screen{background:var(--obsidian);border:1px solid var(--border);border-radius:20px;padding:1.4rem 1.2rem;}
.ot-brand{text-align:center;padding-bottom:1rem;border-bottom:1px solid var(--border);margin-bottom:1rem;}
.ot-brand img{width:46px;height:46px;border-radius:50%;display:block;margin:0 auto .4rem;}
.ot-emet{display:block;font-family:var(--font-brand);text-transform:uppercase;letter-spacing:.06em;color:var(--gold);font-size:1.4rem;line-height:1;}
.ot-sub{display:block;font-family:var(--font-sub);text-transform:uppercase;letter-spacing:.25em;color:var(--green);font-size:.58rem;margin-top:3px;}
.ot-meta{display:flex;justify-content:space-between;align-items:baseline;gap:.5rem;}
.ot-no{font-weight:800;color:var(--ink);font-size:1.05rem;}
.ot-pickup{color:var(--ink-dim);font-size:.9rem;}
.ot-pickup b{color:var(--green);}
.ot-dest{background:rgba(212,175,55,.08);border:1px solid rgba(212,175,55,.2);border-radius:8px;padding:.6rem .8rem;margin:.6rem 0 .8rem;font-size:.85rem;}
.ot-dest span{display:block;color:var(--ink-dim);font-size:.78rem;margin-bottom:2px;}
.ot-dest strong{color:var(--gold);}
.ot-items{color:var(--ink-dim);font-size:.88rem;margin:.3rem 0 1.2rem;border-bottom:1px solid var(--border);padding-bottom:.8rem;}
.ot-note,.ot-err{color:var(--ink-dim);font-size:.95rem;text-align:center;padding:1rem 0;}
.ot-err{color:var(--danger);}
.ot-stem{list-style:none;margin:0;padding:0;position:relative;}
.ot-step{display:flex;gap:.9rem;padding:0 0 1.4rem;position:relative;}
.ot-step:not(:last-child)::before{content:"";position:absolute;left:17px;top:34px;bottom:0;width:2px;background:var(--border);}
.ot-step.done:not(:last-child)::before,.ot-step.active:not(:last-child)::before{background:var(--green);}
.ot-dot{flex:none;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-size:1rem;border:2px solid var(--border);background:var(--forest);color:var(--ink-dim);z-index:1;}
.ot-step.done .ot-dot{background:var(--green);border-color:var(--green);color:#0b1706;}
.ot-step.active .ot-dot{background:transparent;border-color:var(--gold);color:var(--gold);box-shadow:0 0 0 4px rgba(212,175,55,.15);}
.ot-step-title{font-weight:700;color:var(--ink-dim);}
.ot-step-sub{font-size:.85rem;color:var(--ink-dim);opacity:.75;margin-top:2px;}
.ot-step.active .ot-step-title{color:var(--gold);}
.ot-step.done .ot-step-title{color:var(--ink);}
.ot-step.active .ot-step-sub{color:var(--ink);opacity:1;}
.ot-ready{margin-top:.4rem;background:var(--gold);color:#1a1400;border-radius:14px;padding:1rem;display:flex;flex-direction:column;gap:.2rem;}
.ot-ready.done{background:var(--green);color:#0b1706;}
.ot-ready b{font-size:1.05rem;}
.ot-cleared{padding:1.4rem 0;text-align:center;color:var(--ink-dim);}
.ot-footnote{color:var(--ink-dim);font-size:.8rem;}
`;
