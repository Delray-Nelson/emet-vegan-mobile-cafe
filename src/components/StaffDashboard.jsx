// /staff — Owner/Kitchen Counter Dashboard
// Lists active PAID delivery orders (GET /orders)
// Allows advancing status:
//   accepted -> "Start prep" -> being_made -> "Dispatch Delivery" -> out_for_delivery -> "Mark Delivered" -> delivered
// Allows deleting/trashing fishy or spam orders.
// Cash acceptance has been permanently removed per owner security guidelines.
// Polls every 8s

import React, { useEffect, useRef, useState } from "react";
import { listOrders, updateOrderStatus, deleteOrder, STAFF_TOKEN } from "../lib/api.js";
import { MENU_BY_ID } from "../menu.js";

const POLL_MS = 8000;
const STORAGE_KEY_DELETED = "emet_deleted_order_ids";

const STATUS_LABEL = {
  accepted: "ACCEPTED",
  being_made: "BEING PREPARED",
  out_for_delivery: "OUT FOR DELIVERY",
  delivered: "DELIVERED",
  ready: "PREPARED",
  cancelled: "DELETED / CANCELLED",
};

function getDeletedOrderIds() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DELETED);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveDeletedOrderId(orderId) {
  try {
    const current = getDeletedOrderIds();
    if (!current.includes(orderId)) {
      current.push(orderId);
      localStorage.setItem(STORAGE_KEY_DELETED, JSON.stringify(current));
    }
  } catch (e) {
    console.error("Failed to save deleted order id", e);
  }
}

function removeDeletedOrderId(orderId) {
  try {
    const current = getDeletedOrderIds().filter((id) => id !== orderId);
    localStorage.setItem(STORAGE_KEY_DELETED, JSON.stringify(current));
  } catch (e) {
    console.error("Failed to remove deleted order id", e);
  }
}

export default function StaffDashboard() {
  const [token, setToken] = useState("");
  const [authed, setAuthed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [orders, setOrders] = useState([]);
  const [filter, setFilter] = useState("active"); // "active" | "pending" | "all" | "spam"
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState({}); // orderId -> true while updating
  const [deletedIds, setDeletedIds] = useState(getDeletedOrderIds());
  const [deleteModal, setDeleteModal] = useState(null);
  const [toast, setToast] = useState(null);
  const timer = useRef(null);

  function showToast(msg, type = "info") {
    setToast({ msg, type });
    setTimeout(() => {
      setToast((cur) => (cur?.msg === msg ? null : cur));
    }, 4000);
  }

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
      list.map((x) => (x.orderId === o.orderId ? { ...x, status: nextStatus } : x))
    );
    try {
      await updateOrderStatus(o.orderId, nextStatus, token);
      showToast(`Order #${shortId(o.orderId)} moved to ${STATUS_LABEL[nextStatus] || nextStatus}.`, "success");
    } catch (e) {
      setError(`Couldn’t update order: ${e.message}`);
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[o.orderId]; return n; });
    }
  }

  async function confirmDelete(order) {
    if (!order) return;
    const oId = order.orderId;
    setBusy((b) => ({ ...b, [oId]: true }));
    try {
      // 1. Mark as cancelled in DynamoDB backend
      await deleteOrder(oId, token);
      
      // 2. Add to deleted tracking list
      saveDeletedOrderId(oId);
      setDeletedIds((prev) => [...prev.filter((id) => id !== oId), oId]);

      // 3. Update local state
      setOrders((list) =>
        list.map((x) => (x.orderId === oId ? { ...x, status: "cancelled" } : x))
      );

      setDeleteModal(null);
      showToast(`Order #${shortId(oId)} removed and marked as spam/cancelled.`, "success");
    } catch (e) {
      console.error("Failed to delete order:", e);
      setError(`Could not delete order: ${e.message}`);
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[oId]; return n; });
    }
  }

  async function handleRestore(order) {
    if (!order) return;
    const oId = order.orderId;
    setBusy((b) => ({ ...b, [oId]: true }));
    try {
      const restoredStatus = order.paymentStatus === "paid" ? "accepted" : "pending_payment";
      await updateOrderStatus(oId, restoredStatus, token);

      removeDeletedOrderId(oId);
      setDeletedIds((prev) => prev.filter((id) => id !== oId));

      setOrders((list) =>
        list.map((x) => (x.orderId === oId ? { ...x, status: restoredStatus } : x))
      );
      showToast(`Order #${shortId(oId)} restored to active dashboard.`, "success");
    } catch (e) {
      console.error("Failed to restore order:", e);
      setError(`Could not restore order: ${e.message}`);
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[oId]; return n; });
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

  const isOrderDeleted = (o) => o.status === "cancelled" || deletedIds.includes(o.orderId);

  const activeOrders = orders.filter((o) => !isOrderDeleted(o) && ["accepted", "being_made", "out_for_delivery", "ready"].includes(o.status));
  const pendingOrders = orders.filter((o) => !isOrderDeleted(o) && o.status === "pending_payment");
  const allValidOrders = orders.filter((o) => !isOrderDeleted(o));
  const spamOrders = orders.filter((o) => isOrderDeleted(o));

  const displayedOrders = (() => {
    if (filter === "active") return activeOrders;
    if (filter === "pending") return pendingOrders;
    if (filter === "spam") return spamOrders;
    return allValidOrders;
  })();

  return (
    <div className="sd">
      <style>{css}</style>
      
      {toast && (
        <div className={`sd-toast sd-toast-${toast.type}`}>
          <span>{toast.msg}</span>
          <button onClick={() => setToast(null)}>✕</button>
        </div>
      )}

      <header className="sd-head">
        <div className="sd-title">
          <h1>Kitchen Orders Counter</h1>
          <span className="sd-live"><span className="sd-dot" />Live Polling</span>
        </div>
        <div className="sd-head-actions">
          <button className="sd-signout" onClick={handleSignOut}>Sign out</button>
        </div>
      </header>

      {/* Security alert notice for kitchen staff */}
      <div className="e-wrap">
        <div className="sd-notice-bar">
          <span className="sd-notice-icon">🛡️</span>
          <span>
            <strong>Kitchen Security Active:</strong> Cash acceptance is disabled. Kitchen only prepares verified Stripe-paid orders. Delete or flag fishy/unpaid orders below.
          </span>
        </div>
      </div>

      <div className="sd-tabs e-wrap">
        <button className={`sd-tab ${filter === "active" ? "active" : ""}`} onClick={() => setFilter("active")}>
          Kitchen Active ({activeOrders.length})
        </button>
        <button className={`sd-tab ${filter === "pending" ? "active" : ""}`} onClick={() => setFilter("pending")}>
          Pending Stripe ({pendingOrders.length})
        </button>
        <button className={`sd-tab ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>
          All Orders ({allValidOrders.length})
        </button>
        <button className={`sd-tab sd-tab-spam ${filter === "spam" ? "active" : ""}`} onClick={() => setFilter("spam")}>
          🗑️ Deleted / Spam ({spamOrders.length})
        </button>
      </div>

      {error && <p className="sd-err e-wrap">{error}</p>}

      <main className="sd-list e-wrap">
        {displayedOrders.length === 0 && !error && (
          <div className="sd-empty e-card">
            {filter === "spam" ? "No deleted or spam orders found." : "No orders found in this view."}
          </div>
        )}

        {displayedOrders.map((o) => {
          const isDeleted = isOrderDeleted(o);
          const isUnpaid = o.paymentStatus !== "paid";
          const isFarAddress = o.deliveryCity && !["Locust Grove", "McDonough", "Jackson", "Hampton", "Stockbridge", "Jonesboro", "Rex", "Jenkinsburg"].some(c => o.deliveryCity.toLowerCase().includes(c.toLowerCase()));

          return (
            <div key={o.orderId} className={`sd-card e-card ${isDeleted ? "sd-card-deleted" : ""}`}>
              <div className="sd-card-top">
                <div>
                  <div className="sd-name">
                    {o.customerName || "Customer"} · <span className="sd-phone">{o.customerPhone || "No Phone"}</span>
                  </div>
                  <div className="sd-dest">
                    🚗 {o.deliveryAddress || "Address"}, {o.deliveryCity || "Locust Grove"} GA {o.deliveryZip || ""}
                    {isFarAddress && (
                      <span className="sd-badge-warn">⚠️ Non-Service City / Check Address</span>
                    )}
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
                    {o.paymentStatus === "paid" ? "✓ PAID (Stripe)" : "⚠️ UNPAID (No Stripe Charge)"}
                  </span>
                  {o.deliveryWindow && <span className="sd-slot">{fmtWindow(o.deliveryWindow)}</span>}
                  {o.totalCents ? (
                    <span className="sd-total">${(o.totalCents / 100).toFixed(2)}</span>
                  ) : null}
                </div>
              </div>

              {/* Informational warning for pending unpaid checkouts */}
              {isUnpaid && !isDeleted && (
                <div className="sd-unpaid-notice">
                  <span>⏳</span>
                  <span>
                    <strong>Customer has not paid online.</strong> Food will not be prepared until customer completes payment on Stripe. If this is a spam or abandoned order, delete it below.
                  </span>
                </div>
              )}

              <div className="sd-card-foot">
                <span className={"sd-badge s-" + (isDeleted ? "cancelled" : o.status)}>
                  {isDeleted ? "DELETED / SPAM" : (STATUS_LABEL[o.status] || o.status)}
                </span>

                <div className="sd-actions">
                  {/* For Deleted / Spam orders: allow restoring */}
                  {isDeleted ? (
                    <button
                      className="e-btn e-btn-ghost"
                      disabled={!!busy[o.orderId]}
                      onClick={() => handleRestore(o)}
                    >
                      {busy[o.orderId] ? "Restoring…" : "↩️ Restore to Kitchen"}
                    </button>
                  ) : (
                    <>
                      {/* Kitchen workflow buttons for genuine orders */}
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

                      {/* Delete / Spam button accessible for any fishy order */}
                      <button
                        className="e-btn sd-btn-delete"
                        disabled={!!busy[o.orderId]}
                        onClick={() => setDeleteModal(o)}
                        title="Delete order and flag as spam"
                      >
                        {busy[o.orderId] ? "…" : "🗑️ Delete / Spam"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </main>

      {/* Confirmation Modal for deleting orders */}
      {deleteModal && (
        <div className="sd-modal-overlay" onClick={() => setDeleteModal(null)}>
          <div className="sd-modal e-card" onClick={(e) => e.stopPropagation()}>
            <div className="sd-modal-header">
              <span className="sd-modal-icon">⚠️</span>
              <h3>Delete Order #{shortId(deleteModal.orderId)}?</h3>
            </div>
            
            <p className="sd-modal-text">
              Are you sure you want to delete this order for <strong>{deleteModal.customerName || "Customer"}</strong>?
            </p>

            <div className="sd-modal-info">
              <div><strong>Customer:</strong> {deleteModal.customerName || "Customer"} ({deleteModal.customerPhone || "No Phone"})</div>
              <div><strong>Address:</strong> {deleteModal.deliveryAddress || ""}, {deleteModal.deliveryCity || ""} GA {deleteModal.deliveryZip || ""}</div>
              <div><strong>Status:</strong> {deleteModal.paymentStatus === "paid" ? "Paid on Stripe" : "Unpaid (No Stripe Charge)"}</div>
              <div><strong>Items:</strong> {(deleteModal.items || []).map(i => `${i.qty || 1}× ${i.name}`).join(", ") || "None"}</div>
            </div>

            <p className="sd-modal-note">
              This order will be removed from your active kitchen prep list and marked as cancelled. You can view or restore it anytime from the <em>"Deleted / Spam"</em> tab.
            </p>

            <div className="sd-modal-buttons">
              <button
                className="e-btn e-btn-ghost"
                onClick={() => setDeleteModal(null)}
                disabled={!!busy[deleteModal.orderId]}
              >
                Keep Order
              </button>
              <button
                className="e-btn sd-btn-danger"
                onClick={() => confirmDelete(deleteModal)}
                disabled={!!busy[deleteModal.orderId]}
              >
                {busy[deleteModal.orderId] ? "Deleting…" : "Yes, Delete Order 🗑️"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Gate({ token, setToken, error, submitting, onSubmit }) {
  return (
    <div className="sd-gate">
      <style>{css}</style>
      <div className="sd-gate-card e-card">
        <h1>EMET — Kitchen Admin</h1>
        <p className="e-muted">Enter the kitchen access code to manage live deliveries.</p>
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
          {submitting ? "Verifying…" : "Open Kitchen Counter"}
        </button>
      </div>
    </div>
  );
}

function normalize(data) {
  const list = Array.isArray(data) ? data : (data?.orders || []);
  const all = list.map((o) => {
    // If order was cancelled, keep it cancelled
    if (o.status === "cancelled") {
      return o;
    }
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
.sd{min-height:100vh;background:var(--obsidian);color:var(--ink);padding-bottom:3rem;position:relative;}
.sd-head{display:flex;align-items:center;justify-content:space-between;padding:1rem clamp(1rem,4vw,2rem);border-bottom:1px solid var(--border);}
.sd-title{display:flex;align-items:center;gap:.8rem;}
.sd-title h1{font-family:var(--font-brand);text-transform:uppercase;letter-spacing:.02em;color:var(--gold);font-size:1.3rem;margin:0;}
.sd-live{display:inline-flex;align-items:center;gap:.4rem;color:var(--green);font-size:.8rem;font-weight:700;}
.sd-dot{width:8px;height:8px;border-radius:50%;background:var(--green);animation:sdpulse 1.8s ease-out infinite;}
@keyframes sdpulse{0%{box-shadow:0 0 0 0 rgba(114,191,68,.5);}70%{box-shadow:0 0 0 7px rgba(114,191,68,0);}100%{box-shadow:0 0 0 0 rgba(114,191,68,0);}}
.sd-signout{background:none;border:1px solid var(--border);color:var(--ink-dim);border-radius:999px;padding:.4rem .9rem;font-size:.82rem;cursor:pointer;}
.sd-signout:hover{border-color:var(--gold);color:var(--gold);}

.sd-notice-bar{display:flex;align-items:center;gap:.7rem;background:rgba(217,119,6,.1);border:1px solid rgba(217,119,6,.3);color:var(--gold-soft);padding:.7rem 1rem;border-radius:10px;font-size:.85rem;margin-top:1rem;}
.sd-notice-icon{font-size:1.1rem;flex:none;}

.sd-list{display:flex;flex-direction:column;gap:1rem;padding-top:1.4rem;}
.sd-card{padding:1.2rem 1.4rem;transition:opacity .2s ease;}
.sd-card-deleted{opacity:.65;border-color:rgba(239,68,68,.4);background:rgba(239,68,68,.03);}
.sd-card-top{display:flex;justify-content:space-between;gap:1rem;}
.sd-name{font-weight:800;font-size:1.1rem;color:var(--ink);}
.sd-phone{color:var(--gold);font-size:.9rem;font-weight:600;}
.sd-dest{color:var(--green);font-size:.92rem;font-weight:600;margin-top:.3rem;display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;}
.sd-badge-warn{display:inline-block;background:rgba(239,68,68,.15);color:#f87171;border:1px solid rgba(239,68,68,.4);font-size:.72rem;padding:.15rem .45rem;border-radius:6px;font-weight:700;}
.sd-notes{color:var(--gold-soft);font-size:.85rem;font-style:italic;margin-top:.2rem;}
.sd-items{color:var(--ink-dim);font-size:.9rem;margin-top:.4rem;}
.sd-tabs{display:flex;gap:.5rem;padding:1rem clamp(1rem,4vw,2rem) 0 clamp(1rem,4vw,2rem);border-bottom:1px solid var(--border);overflow-x:auto;}
.sd-tab{background:none;border:none;border-bottom:2px solid transparent;color:var(--ink-dim);font-weight:700;font-size:.85rem;padding:.5rem .8rem;cursor:pointer;white-space:nowrap;}
.sd-tab.active{color:var(--gold);border-color:var(--gold);}
.sd-tab.sd-tab-spam.active{color:#f87171;border-color:#f87171;}
.sd-tab:hover{color:var(--ink);}
.sd-pay-tag{display:inline-block;font-size:.7rem;font-weight:700;padding:.15rem .45rem;border-radius:4px;margin-top:.2rem;}
.sd-pay-tag.paid{background:rgba(114,191,68,.15);color:var(--green);border:1px solid var(--green);}
.sd-pay-tag.unpaid{background:rgba(239,68,68,.15);color:#f87171;border:1px solid rgba(239,68,68,.4);}
.sd-badge.s-pending_payment{color:var(--gold-soft);border-color:var(--gold-soft);}
.sd-badge.s-cancelled{color:#f87171;border-color:#f87171;background:rgba(239,68,68,.1);}
.sd-card-meta{text-align:right;flex:none;}
.sd-no{display:block;color:var(--ink-dim);font-size:.85rem;font-weight:700;}
.sd-slot{display:block;color:var(--gold);font-size:.9rem;font-weight:700;margin-top:.2rem;}
.sd-total{display:block;color:var(--ink);font-size:.95rem;font-weight:800;margin-top:.2rem;}

.sd-unpaid-notice{display:flex;align-items:flex-start;gap:.6rem;background:rgba(239,68,68,.08);border:1px dashed rgba(239,68,68,.3);color:#fca5a5;padding:.6rem .8rem;border-radius:8px;font-size:.8rem;margin-top:.8rem;}

.sd-card-foot{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-top:1.1rem;border-top:1px solid var(--border);padding-top:.8rem;}
.sd-badge{font-family:var(--font-sub);font-weight:700;letter-spacing:.1em;font-size:.68rem;padding:.3rem .7rem;border-radius:999px;border:1px solid var(--border);color:var(--ink-dim);}
.sd-badge.s-accepted{color:var(--gold);border-color:var(--gold);}
.sd-badge.s-being_made{color:var(--gold-soft);border-color:var(--gold-soft);}
.sd-badge.s-out_for_delivery{color:#38bdf8;border-color:#38bdf8;}
.sd-badge.s-delivered{color:var(--green);border-color:var(--green);}

.sd-actions{display:flex;align-items:center;gap:.6rem;}
.sd-btn-delete{background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.4);color:#f87171;font-size:.82rem;font-weight:700;padding:.5rem .9rem;border-radius:999px;cursor:pointer;transition:all .15s ease;}
.sd-btn-delete:hover{background:rgba(239,68,68,.25);border-color:#ef4444;color:#fee2e2;}
.sd-btn-danger{background:#dc2626;color:#ffffff;border:1px solid #b91c1c;font-weight:800;padding:.6rem 1.2rem;border-radius:999px;cursor:pointer;}
.sd-btn-danger:hover{background:#ef4444;}

.sd-toast{position:fixed;top:1rem;right:1rem;z-index:1000;background:#1e293b;border:1px solid var(--gold);color:var(--ink);padding:.8rem 1.2rem;border-radius:10px;box-shadow:0 10px 25px rgba(0,0,0,.5);display:flex;align-items:center;gap:1rem;font-size:.88rem;animation:sdslide .25s ease-out;}
.sd-toast button{background:none;border:none;color:var(--ink-dim);cursor:pointer;font-size:1rem;}
.sd-toast-success{border-color:var(--green);color:#86efac;}
@keyframes sdslide{from{transform:translateY(-20px);opacity:0;}to{transform:translateY(0);opacity:1;}}

.sd-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.75);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:999;padding:1rem;}
.sd-modal{max-width:440px;width:100%;padding:1.6rem;background:var(--obsidian);border:1px solid rgba(239,68,68,.4);box-shadow:0 15px 35px rgba(0,0,0,.7);display:flex;flex-direction:column;gap:.9rem;}
.sd-modal-header{display:flex;align-items:center;gap:.6rem;}
.sd-modal-header h3{margin:0;font-family:var(--font-brand);font-size:1.2rem;color:#f87171;}
.sd-modal-icon{font-size:1.4rem;}
.sd-modal-text{font-size:.92rem;color:var(--ink);margin:0;}
.sd-modal-info{background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:8px;padding:.8rem;font-size:.82rem;display:flex;flex-direction:column;gap:.3rem;color:var(--ink-dim);}
.sd-modal-info strong{color:var(--ink);}
.sd-modal-note{font-size:.8rem;color:var(--gold-soft);margin:0;}
.sd-modal-buttons{display:flex;justify-content:flex-end;gap:.8rem;margin-top:.5rem;}

.sd-empty{padding:2rem;text-align:center;color:var(--ink-dim);}
.sd-err{color:var(--danger);font-size:.9rem;padding:.6rem 0;}
.sd-gate{min-height:100vh;background:var(--obsidian);display:flex;align-items:center;justify-content:center;padding:1.5rem;}
.sd-gate-card{padding:1.8rem;max-width:360px;width:100%;display:flex;flex-direction:column;gap:.8rem;}
.sd-gate-card h1{font-family:var(--font-brand);text-transform:uppercase;color:var(--gold);margin:0;font-size:1.4rem;}
.sd-gate-card input{background:var(--obsidian);border:1px solid var(--border);border-radius:10px;padding:.8rem;color:var(--ink);font-size:1rem;}
.sd-gate-card input:focus{outline:none;border-color:var(--gold);}
@media (max-width:520px){ 
  .sd-card-foot{flex-direction:column;align-items:stretch;} 
  .sd-actions{flex-direction:column;width:100%;} 
  .sd-actions .e-btn{width:100%;text-align:center;} 
  .sd-card-top{flex-direction:column;}
  .sd-card-meta{text-align:left;}
}
`;
