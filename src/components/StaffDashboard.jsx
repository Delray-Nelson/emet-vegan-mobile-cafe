// /staff — Owner/Kitchen Counter Dashboard
// Lists active PAID delivery orders (GET /orders)
// Allows advancing status:
//   accepted -> "Start prep" -> being_made -> "Dispatch Shipday Courier" or "Self-Deliver" -> out_for_delivery -> "Mark Delivered" -> delivered
// Polls every 8s

import React, { useEffect, useRef, useState } from "react";
import { listOrders, updateOrderStatus, STAFF_TOKEN } from "../lib/api.js";
import { MENU_BY_ID } from "../menu.js";

const POLL_MS = 8000;

const STATUS_LABEL = {
  accepted: "ACCEPTED",
  being_made: "BEING PREPARED",
  out_for_delivery: "OUT FOR DELIVERY",
  delivered: "DELIVERED",
  ready: "PREPARED",
};

export default function StaffDashboard() {
  const [token, setToken] = useState("");
  const [authed, setAuthed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [orders, setOrders] = useState([]);
  const [filter, setFilter] = useState("all"); // "all" | "active" | "pending"
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState({}); // orderId -> true while updating
  const timer = useRef(null);

  useEffect(() => {
    if (!authed || !token) return;
    let alive = true;
    async function tick() {
      try {
        const data = await listOrders(token);
        if (alive) { 
          const normalized = normalize(data);
          setOrders(normalized); 
          setError(null); 
        }
      } catch (e) {
        if (alive) {
          setError(e.message);
        }
      }
    }
    tick();
    timer.current = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(timer.current); };
  }, [authed, token]);

  async function handleLogin() {
    const trimmed = token.trim();
    if (!trimmed) {
      setError("Please enter the staff access code.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const data = await listOrders(trimmed);
      const normalized = normalize(data);
      setOrders(normalized);
      setAuthed(true);
      setError(null);
    } catch (err) {
      console.error("Staff auth error:", err);
      if (err.status === 401 || err.status === 403) {
        setError("Incorrect staff access code. Please try again.");
      } else {
        setError(err.message || "Invalid staff access code.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleSignOut() {
    setAuthed(false);
    setToken("");
    setError(null);
    setOrders([]);
  }

  async function advanceStatus(o, nextStatus) {
    setBusy((b) => ({ ...b, [o.orderId]: true }));
    setOrders((list) =>
      list.map((x) => (x.orderId === o.orderId ? { ...x, status: nextStatus, paymentStatus: nextStatus === "accepted" ? "paid" : x.paymentStatus } : x))
    );
    try {
      await updateOrderStatus(o.orderId, nextStatus, token);
    } catch (e) {
      setError(`Couldn’t update order: ${e.message}`);
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[o.orderId]; return n; });
    }
  }

  if (!authed) {
    return (
      <Gate
        token={token}
        setToken={setToken}
        error={error}
        submitting={submitting}
        onSubmit={handleLogin}
      />
    );
  }

  const displayedOrders = orders.filter((o) => {
    if (filter === "active") return ["accepted", "being_made", "out_for_delivery", "ready"].includes(o.status);
    if (filter === "pending") return o.status === "pending_payment";
    return true;
  });

  return (
    <div className="sd">
      <style>{css}</style>
      <header className="sd-head">
        <div className="sd-title">
          <h1>Delivery Orders Counter</h1>
          <span className="sd-live"><span className="sd-dot" />Live Polling</span>
        </div>
        <button className="sd-signout" onClick={handleSignOut}>Sign out</button>
      </header>

      <div className="sd-tabs e-wrap">
        <button className={`sd-tab ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>
          All Orders ({orders.length})
        </button>
        <button className={`sd-tab ${filter === "active" ? "active" : ""}`} onClick={() => setFilter("active")}>
          Kitchen Active ({orders.filter(o => ["accepted", "being_made", "out_for_delivery", "ready"].includes(o.status)).length})
        </button>
        <button className={`sd-tab ${filter === "pending" ? "active" : ""}`} onClick={() => setFilter("pending")}>
          Pending Payment ({orders.filter(o => o.status === "pending_payment").length})
        </button>
      </div>

      {error && <p className="sd-err e-wrap">{error}</p>}

      <main className="sd-list e-wrap">
        {displayedOrders.length === 0 && !error && (
          <div className="sd-empty e-card">No orders found in this view.</div>
        )}
        {displayedOrders.map((o) => {
          return (
            <div key={o.orderId} className="sd-card e-card">
              <div className="sd-card-top">
                <div>
                  <div className="sd-name">
                    {o.customerName || "Customer"} · <span className="sd-phone">{o.customerPhone || "No Phone"}</span>
                  </div>
                  <div className="sd-dest">
                    🚗 {o.deliveryAddress || "Address"}, {o.deliveryCity || "Locust Grove"} GA {o.deliveryZip || ""}
                  </div>
                  {o.deliveryInstructions && (
                    <div className="sd-notes">Note: "{o.deliveryInstructions}"</div>
                  )}
                  <div className="sd-items">
                    {(o.items || []).map((it) => `${it.qty || 1}× ${MENU_BY_ID[it.id]?.name || it.name || it.id}`).join(" · ")}
                  </div>
                </div>
                <div className="sd-card-meta">
                  <span className="sd-no">#{shortId(o.orderId)}</span>
                  <span className={`sd-pay-tag ${o.paymentStatus === "paid" ? "paid" : "unpaid"}`}>
                    {o.paymentStatus === "paid" ? "✓ PAID" : "PENDING"}
                  </span>
                  {o.deliveryWindow && <span className="sd-slot">{fmtWindow(o.deliveryWindow)}</span>}
                </div>
              </div>
              <div className="sd-card-foot">
                <span className={"sd-badge s-" + o.status}>{STATUS_LABEL[o.status] || o.status}</span>
                <div className="sd-actions">
                  {o.status === "pending_payment" && (
                    <button
                      className="e-btn e-btn-gold"
                      disabled={!!busy[o.orderId]}
                      onClick={() => advanceStatus(o, "accepted")}
                    >
                      {busy[o.orderId] ? "…" : "Accept & Confirm ✓"}
                    </button>
                  )}

                  {o.status === "accepted" && (
                    <button
                      className="e-btn e-btn-gold"
                      disabled={!!busy[o.orderId]}
                      onClick={() => advanceStatus(o, "being_made")}
                    >
                      {busy[o.orderId] ? "…" : "Start Prep"}
                    </button>
                  )}

                  {o.status === "being_made" && (
                    <button
                      className="e-btn e-btn-gold"
                      disabled={!!busy[o.orderId]}
                      onClick={() => advanceStatus(o, "out_for_delivery")}
                    >
                      {busy[o.orderId] ? "…" : "Dispatch Delivery 🚗"}
                    </button>
                  )}

                  {o.status === "out_for_delivery" && (
                    <button
                      className="e-btn e-btn-ghost"
                      disabled={!!busy[o.orderId]}
                      onClick={() => advanceStatus(o, "delivered")}
                    >
                      {busy[o.orderId] ? "…" : "Mark Dropped Off ✓"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </main>
    </div>
  );
}

function Gate({ token, setToken, error, submitting, onSubmit }) {
  return (
    <div className="sd-gate">
      <style>{css}</style>
      <div className="sd-gate-card e-card">
        <h1>EMET — Staff Access</h1>
        <p className="e-muted">Enter the staff code to manage live deliveries.</p>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !submitting && onSubmit()}
          placeholder="Staff access code"
          autoFocus
        />
        {error && <p className="sd-err">{error}</p>}
        <button className="e-btn e-btn-gold" disabled={submitting} onClick={onSubmit}>
          {submitting ? "Verifying…" : "Open Kitchen View"}
        </button>
      </div>
    </div>
  );
}

function normalize(data) {
  const list = Array.isArray(data) ? data : (data?.orders || []);
  const all = list.map((o) => {
    const effectiveStatus = (o.status === "pending_payment" && o.paymentStatus === "paid") ? "accepted" : (o.status || "pending_payment");
    return { ...o, status: effectiveStatus };
  });
  all.sort((a, b) => String(b.createdAt || 0).localeCompare(String(a.createdAt || 0)));
  return all;
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

const css = `
.sd{min-height:100vh;background:var(--obsidian);color:var(--ink);padding-bottom:3rem;}
.sd-head{display:flex;align-items:center;justify-content:space-between;padding:1rem clamp(1rem,4vw,2rem);border-bottom:1px solid var(--border);}
.sd-title{display:flex;align-items:center;gap:.8rem;}
.sd-title h1{font-family:var(--font-brand);text-transform:uppercase;letter-spacing:.02em;color:var(--gold);font-size:1.3rem;margin:0;}
.sd-live{display:inline-flex;align-items:center;gap:.4rem;color:var(--green);font-size:.8rem;font-weight:700;}
.sd-dot{width:8px;height:8px;border-radius:50%;background:var(--green);animation:sdpulse 1.8s ease-out infinite;}
@keyframes sdpulse{0%{box-shadow:0 0 0 0 rgba(114,191,68,.5);}70%{box-shadow:0 0 0 7px rgba(114,191,68,0);}100%{box-shadow:0 0 0 0 rgba(114,191,68,0);}}
.sd-signout{background:none;border:1px solid var(--border);color:var(--ink-dim);border-radius:999px;padding:.4rem .9rem;font-size:.82rem;cursor:pointer;}
.sd-signout:hover{border-color:var(--gold);color:var(--gold);}
.sd-list{display:flex;flex-direction:column;gap:1rem;padding-top:1.4rem;}
.sd-card{padding:1.2rem 1.4rem;}
.sd-card-top{display:flex;justify-content:space-between;gap:1rem;}
.sd-name{font-weight:800;font-size:1.1rem;color:var(--ink);}
.sd-phone{color:var(--gold);font-size:.9rem;font-weight:600;}
.sd-dest{color:var(--green);font-size:.92rem;font-weight:600;margin-top:.3rem;}
.sd-notes{color:var(--gold-soft);font-size:.85rem;font-style:italic;margin-top:.2rem;}
.sd-items{color:var(--ink-dim);font-size:.9rem;margin-top:.4rem;}
.sd-tabs{display:flex;gap:.5rem;padding:1rem clamp(1rem,4vw,2rem) 0 clamp(1rem,4vw,2rem);border-bottom:1px solid var(--border);overflow-x:auto;}
.sd-tab{background:none;border:none;border-bottom:2px solid transparent;color:var(--ink-dim);font-weight:700;font-size:.85rem;padding:.5rem .8rem;cursor:pointer;white-space:nowrap;}
.sd-tab.active{color:var(--gold);border-color:var(--gold);}
.sd-tab:hover{color:var(--ink);}
.sd-pay-tag{display:inline-block;font-size:.7rem;font-weight:700;padding:.15rem .45rem;border-radius:4px;margin-top:.2rem;}
.sd-pay-tag.paid{background:rgba(114,191,68,.15);color:var(--green);border:1px solid var(--green);}
.sd-pay-tag.unpaid{background:rgba(217,119,6,.15);color:var(--gold-soft);border:1px solid var(--gold-soft);}
.sd-badge.s-pending_payment{color:var(--gold-soft);border-color:var(--gold-soft);}
.sd-card-meta{text-align:right;flex:none;}
.sd-no{display:block;color:var(--ink-dim);font-size:.85rem;font-weight:700;}
.sd-slot{display:block;color:var(--gold);font-size:.9rem;font-weight:700;margin-top:.2rem;}
.sd-card-foot{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-top:1.1rem;border-top:1px solid var(--border);padding-top:.8rem;}
.sd-badge{font-family:var(--font-sub);font-weight:700;letter-spacing:.1em;font-size:.68rem;padding:.3rem .7rem;border-radius:999px;border:1px solid var(--border);color:var(--ink-dim);}
.sd-badge.s-accepted{color:var(--gold);border-color:var(--gold);}
.sd-badge.s-being_made{color:var(--gold-soft);border-color:var(--gold-soft);}
.sd-badge.s-out_for_delivery{color:#38bdf8;border-color:#38bdf8;}
.sd-badge.s-delivered{color:var(--green);border-color:var(--green);}
.sd-actions{display:flex;gap:.5rem;}
.sd-actions .e-btn{min-width:160px;}
.sd-empty{padding:2rem;text-align:center;color:var(--ink-dim);}
.sd-err{color:var(--danger);font-size:.9rem;padding:.6rem 0;}
.sd-gate{min-height:100vh;background:var(--obsidian);display:flex;align-items:center;justify-content:center;padding:1.5rem;}
.sd-gate-card{padding:1.8rem;max-width:360px;width:100%;display:flex;flex-direction:column;gap:.8rem;}
.sd-gate-card h1{font-family:var(--font-brand);text-transform:uppercase;color:var(--gold);margin:0;font-size:1.4rem;}
.sd-gate-card input{background:var(--obsidian);border:1px solid var(--border);border-radius:10px;padding:.8rem;color:var(--ink);font-size:1rem;}
.sd-gate-card input:focus{outline:none;border-color:var(--gold);}
@media (max-width:520px){ .sd-card-foot{flex-direction:column;align-items:stretch;} .sd-actions{flex-direction:column;} .sd-actions .e-btn{width:100%;} }
`;
