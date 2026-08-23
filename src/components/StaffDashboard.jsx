// /staff — the owner's counter dashboard. Lists active PAID orders (GET /orders),
// each a card with a single relabeling action button that advances the order:
//   accepted → "Start making" → being_made → "Mark ready" → ready → "Mark picked up"
// Polls every 8s so newly-paid orders appear on their own. Gated by a shared
// staff token (v1). Matches the "Owner · counter" panel in the UI preview.

import React, { useEffect, useRef, useState } from "react";
import { listOrders, updateOrderStatus, STAFF_TOKEN } from "../lib/api.js";
import { MENU_BY_ID } from "../menu.js";

const POLL_MS = 8000;

// action button per current status → next status + label
const NEXT = {
  accepted:   { next: "being_made", label: "Start making" },
  being_made: { next: "ready",      label: "Mark ready" },
  ready:      { next: "picked_up",  label: "Mark picked up" },
};
const STATUS_LABEL = {
  accepted: "ACCEPTED",
  being_made: "BEING MADE",
  ready: "READY",
};

export default function StaffDashboard() {
  const [token, setToken] = useState(STAFF_TOKEN || "");
  const [authed, setAuthed] = useState(!!STAFF_TOKEN);
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState({}); // orderId -> true while updating
  const timer = useRef(null);

  useEffect(() => {
    if (!authed) return;
    let alive = true;
    async function tick() {
      try {
        const data = await listOrders(token);
        if (alive) { setOrders(normalize(data)); setError(null); }
      } catch (e) {
        if (alive) {
          setError(e.message);
          if (e.status === 401 || e.status === 403) setAuthed(false); // bad token → back to gate
        }
      }
    }
    tick();
    timer.current = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(timer.current); };
  }, [authed, token]);

  async function advance(o) {
    const step = NEXT[o.status];
    if (!step) return;
    setBusy((b) => ({ ...b, [o.orderId]: true }));
    // optimistic: drop picked_up cards immediately, else relabel
    setOrders((list) =>
      step.next === "picked_up"
        ? list.filter((x) => x.orderId !== o.orderId)
        : list.map((x) => (x.orderId === o.orderId ? { ...x, status: step.next } : x))
    );
    try {
      await updateOrderStatus(o.orderId, step.next, token);
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
        onSubmit={() => { if (token.trim()) { setError(null); setAuthed(true); } }}
      />
    );
  }

  return (
    <div className="sd">
      <style>{css}</style>
      <header className="sd-head">
        <div className="sd-title">
          <h1>Active orders</h1>
          <span className="sd-live"><span className="sd-dot" />Live</span>
        </div>
        <button className="sd-signout" onClick={() => setAuthed(false)}>Sign out</button>
      </header>

      {error && <p className="sd-err e-wrap">{error}</p>}

      <main className="sd-list e-wrap">
        {orders.length === 0 && !error && (
          <div className="sd-empty e-card">No active orders right now. Paid orders appear here automatically.</div>
        )}
        {orders.map((o) => {
          const step = NEXT[o.status];
          return (
            <div key={o.orderId} className="sd-card e-card">
              <div className="sd-card-top">
                <div>
                  <div className="sd-name">{o.customerName || "Customer"}</div>
                  <div className="sd-items">
                    {(o.items || []).map((it) => `${it.qty}× ${MENU_BY_ID[it.id]?.name || it.id}`).join(" · ")}
                  </div>
                </div>
                <div className="sd-card-meta">
                  <span className="sd-no">#{shortId(o.orderId)}</span>
                  {o.slotTime && <span className="sd-slot">{o.slotTime}</span>}
                </div>
              </div>
              <div className="sd-card-foot">
                <span className={"sd-badge s-" + o.status}>{STATUS_LABEL[o.status] || o.status}</span>
                {step && (
                  <button
                    className={"e-btn " + (o.status === "ready" ? "e-btn-ghost" : "e-btn-gold")}
                    disabled={!!busy[o.orderId]}
                    onClick={() => advance(o)}
                  >
                    {busy[o.orderId] ? "…" : step.label}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </main>
    </div>
  );
}

function Gate({ token, setToken, error, onSubmit }) {
  return (
    <div className="sd-gate">
      <style>{css}</style>
      <div className="sd-gate-card e-card">
        <h1>EMET — Staff</h1>
        <p className="e-muted">Enter the staff access code to open the counter dashboard.</p>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSubmit()}
          placeholder="Staff code"
          autoFocus
        />
        {error && <p className="sd-err">{error}</p>}
        <button className="e-btn e-btn-gold" onClick={onSubmit}>Open dashboard</button>
      </div>
    </div>
  );
}

function normalize(data) {
  const list = Array.isArray(data) ? data : (data?.orders || []);
  // only active paid statuses, newest first
  const active = list.filter((o) => ["accepted", "being_made", "ready"].includes(o.status));
  active.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return active;
}
function shortId(v = "") {
  const s = String(v).replace(/[^a-zA-Z0-9]/g, "");
  return s.slice(-4).toUpperCase() || s.toUpperCase();
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
.sd-card{padding:1.1rem 1.2rem;}
.sd-card-top{display:flex;justify-content:space-between;gap:1rem;}
.sd-name{font-weight:800;font-size:1.05rem;color:var(--ink);}
.sd-items{color:var(--ink-dim);font-size:.9rem;margin-top:.2rem;}
.sd-card-meta{text-align:right;flex:none;}
.sd-no{display:block;color:var(--ink-dim);font-size:.82rem;}
.sd-slot{display:block;color:var(--green);font-size:.82rem;margin-top:.2rem;}
.sd-card-foot{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-top:1rem;}
.sd-badge{font-family:var(--font-sub);font-weight:700;letter-spacing:.1em;font-size:.68rem;padding:.3rem .7rem;border-radius:999px;border:1px solid var(--border);color:var(--ink-dim);}
.sd-badge.s-accepted{color:var(--gold);border-color:var(--gold);}
.sd-badge.s-being_made{color:var(--gold-soft);border-color:var(--gold-soft);}
.sd-badge.s-ready{color:var(--green);border-color:var(--green);}
.sd-card-foot .e-btn{min-width:150px;}
.sd-empty{padding:2rem;text-align:center;color:var(--ink-dim);}
.sd-err{color:var(--danger);font-size:.9rem;padding:.6rem 0;}
.sd-gate{min-height:100vh;background:var(--obsidian);display:flex;align-items:center;justify-content:center;padding:1.5rem;}
.sd-gate-card{padding:1.8rem;max-width:360px;width:100%;display:flex;flex-direction:column;gap:.8rem;}
.sd-gate-card h1{font-family:var(--font-brand);text-transform:uppercase;color:var(--gold);margin:0;font-size:1.4rem;}
.sd-gate-card input{background:var(--obsidian);border:1px solid var(--border);border-radius:10px;padding:.8rem;color:var(--ink);font-size:1rem;}
.sd-gate-card input:focus{outline:none;border-color:var(--gold);}
@media (max-width:520px){ .sd-card-foot{flex-direction:column;align-items:stretch;} .sd-card-foot .e-btn{width:100%;} }
`;
