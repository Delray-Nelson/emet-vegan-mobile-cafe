// /checkout — the slot picker + "Pay" button.
// Receives the cart from the order modal via router state, loads pickup windows
// from GET /slots, collects the customer's name + phone, then calls
// POST /checkout-session and redirects to the Stripe-hosted checkout URL.
//
// Price and slot capacity are validated SERVER-SIDE in createCheckoutSession;
// what we send is only the item ids + quantities + the chosen slot + contact.

import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { MENU_BY_ID, usd } from "../menu.js";
import { getSlots, createCheckoutSession } from "../lib/api.js";
import { logo } from "../logo.js";

export default function Checkout() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const cart = (state && state.cart) || [];

  const [slots, setSlots] = useState(null);   // grouped [{date, times:[{slotId,time,soldOut}]}]
  const [slotId, setSlotId] = useState(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [slotError, setSlotError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const totalCents = useMemo(
    () => cart.reduce((n, i) => n + (MENU_BY_ID[i.id]?.priceCents || 0) * i.qty, 0),
    [cart]
  );

  useEffect(() => {
    let alive = true;
    getSlots()
      .then((data) => { if (alive) { setSlots(groupSlots(data)); setLoadingSlots(false); } })
      .catch((e) => { if (alive) { setSlotError(e.message); setLoadingSlots(false); } });
    return () => { alive = false; };
  }, []);

  if (cart.length === 0) {
    return (
      <Shell>
        <div className="co-empty e-card">
          <p>Your order is empty.</p>
          <Link className="e-btn e-btn-gold" to="/">Back to the menu</Link>
        </div>
      </Shell>
    );
  }

  const canPay = slotId && name.trim() && phone.trim() && !submitting;

  async function pay() {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const { url } = await createCheckoutSession({
        items: cart.map((i) => ({ id: i.id, qty: i.qty })),
        slotId,
        customer: { name: name.trim(), phone: phone.trim() },
      });
      if (!url) throw new Error("No checkout URL returned.");
      window.location.assign(url); // hand off to Stripe-hosted checkout
    } catch (e) {
      // 409 = slot filled between load and pay; refresh slots so they can repick.
      if (e.status === 409) {
        setSubmitError("That pickup time just filled up. Please pick another.");
        setSlotId(null);
        getSlots().then((d) => setSlots(groupSlots(d))).catch(() => {});
      } else {
        setSubmitError(e.message || "Could not start checkout. Please try again.");
      }
      setSubmitting(false);
    }
  }

  return (
    <Shell>
      <div className="co-grid">
        <section className="co-main">
          <h1 className="co-h1">Checkout</h1>

          <div className="co-block e-card">
            <h2 className="co-h2">Pickup time</h2>
            {loadingSlots && <p className="e-muted">Loading pickup times…</p>}
            {slotError && <p className="co-err">Couldn’t load pickup times: {slotError}</p>}
            {slots && slots.length === 0 && <p className="e-muted">No pickup times available right now.</p>}
            {slots && slots.map((day) => (
              <div key={day.date} className="co-day">
                <p className="co-day-label">{day.label}</p>
                <div className="co-slots">
                  {day.times.map((t) => (
                    <button
                      key={t.slotId}
                      disabled={t.soldOut}
                      className={"co-slot" + (t.soldOut ? " full" : "") + (slotId === t.slotId ? " on" : "")}
                      onClick={() => setSlotId(t.slotId)}
                    >
                      {t.time}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="co-block e-card">
            <h2 className="co-h2">Your details</h2>
            <label className="co-field">
              <span>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jordan M." autoComplete="name" />
            </label>
            <label className="co-field">
              <span>Mobile number</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(404) 555-0123" inputMode="tel" autoComplete="tel" />
            </label>
            <p className="co-fineprint e-muted">We’ll text you when your order is accepted and when it’s ready.</p>
          </div>
        </section>

        <aside className="co-summary e-card">
          <h2 className="co-h2">Your order</h2>
          <ul className="co-lines">
            {cart.map((i) => {
              const m = MENU_BY_ID[i.id];
              return (
                <li key={i.id}>
                  <span className="co-qty">{i.qty}×</span>
                  <span className="co-name">{m ? m.name : i.id}</span>
                  <span className="co-line-price">{usd((m?.priceCents || 0) * i.qty)}</span>
                </li>
              );
            })}
          </ul>
          <div className="co-total">
            <span>Total</span>
            <span>{usd(totalCents)}</span>
          </div>
          {submitError && <p className="co-err">{submitError}</p>}
          <button className="e-btn e-btn-gold co-pay" disabled={!canPay} onClick={pay}>
            {submitting ? "Redirecting to payment…" : `Pay ${usd(totalCents)}`}
          </button>
          <Link className="co-back" to="/">← Add more items</Link>
          <p className="co-secure e-muted">Payment is processed securely by Stripe.</p>
        </aside>
      </div>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="co">
      <style>{css}</style>
      <header className="co-head">
        <Link to="/" className="co-brand">
          <img src={logo} alt="" aria-hidden />
          <span><b>EMET</b><small>Vegan Cafe</small></span>
        </Link>
      </header>
      <main className="e-wrap">{children}</main>
    </div>
  );
}

// Accepts either a flat [{slotId,date,time,capacity,booked}] list or an already
// grouped payload; normalizes to day groups the UI renders.
function groupSlots(data) {
  const list = Array.isArray(data) ? data : (data?.slots || []);
  const byDate = {};
  for (const s of list) {
    const date = s.date || (s.slotId || "").split("T")[0];
    const time = s.time || fmtTime(s.slotId);
    const soldOut = typeof s.capacity === "number" && typeof s.booked === "number"
      ? s.booked >= s.capacity
      : !!s.soldOut;
    (byDate[date] ||= []).push({ slotId: s.slotId, time, soldOut });
  }
  return Object.keys(byDate).sort().map((date) => ({
    date,
    label: dayLabel(date),
    times: byDate[date].sort((a, b) => a.slotId.localeCompare(b.slotId)),
  }));
}

function fmtTime(slotId = "") {
  const t = slotId.split("T")[1];
  if (!t) return slotId;
  const [h, m] = t.split(":");
  const hr = ((+h + 11) % 12) + 1;
  return `${hr}:${m} ${+h < 12 ? "AM" : "PM"}`;
}
function dayLabel(date) {
  const today = new Date().toISOString().slice(0, 10);
  if (date === today) return "Today";
  try {
    return new Date(date + "T00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  } catch { return date; }
}

const css = `
.co{min-height:100vh;background:var(--obsidian);color:var(--ink);}
.co-head{border-bottom:1px solid var(--border);padding:.8rem clamp(1rem,4vw,2rem);}
.co-brand{display:inline-flex;align-items:center;gap:.55rem;}
.co-brand img{width:36px;height:36px;border-radius:50%;}
.co-brand b{font-family:var(--font-brand);color:var(--gold);letter-spacing:.06em;font-size:1.15rem;display:block;line-height:1;}
.co-brand small{font-family:var(--font-sub);color:var(--green);letter-spacing:.3em;font-size:.52rem;text-transform:uppercase;}
.co-h1{font-family:var(--font-brand);text-transform:uppercase;color:var(--gold);font-size:2rem;margin:1.4rem 0 1rem;}
.co-h2{font-family:var(--font-brand);text-transform:uppercase;color:var(--ink);font-size:1.1rem;letter-spacing:.02em;margin:0 0 .9rem;}
.co-grid{display:grid;grid-template-columns:1.4fr .9fr;gap:1.4rem;padding-bottom:3rem;}
.co-block{padding:1.2rem;margin-bottom:1.2rem;}
.co-day{margin-bottom:1rem;}
.co-day-label{font-weight:700;color:var(--gold);margin:0 0 .5rem;font-size:.9rem;}
.co-slots{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:.5rem;}
.co-slot{border:1px solid var(--border);background:var(--obsidian);color:var(--ink);border-radius:10px;
  padding:.6rem .3rem;font-weight:600;font-size:.85rem;cursor:pointer;font-family:inherit;}
.co-slot:hover:not(.full){border-color:var(--green);}
.co-slot.on{background:var(--gold);border-color:var(--gold);color:#1a1400;}
.co-slot.full{color:var(--ink-dim);opacity:.5;text-decoration:line-through;cursor:not-allowed;}
.co-field{display:block;margin-bottom:.9rem;}
.co-field span{display:block;font-size:.82rem;color:var(--ink-dim);margin-bottom:.35rem;}
.co-field input{width:100%;background:var(--obsidian);border:1px solid var(--border);border-radius:10px;
  padding:.75rem .85rem;color:var(--ink);font-size:1rem;font-family:inherit;}
.co-field input:focus{outline:none;border-color:var(--gold);}
.co-fineprint{font-size:.82rem;margin:.2rem 0 0;}
.co-summary{padding:1.2rem;align-self:start;position:sticky;top:1rem;}
.co-lines{list-style:none;padding:0;margin:0 0 .8rem;}
.co-lines li{display:grid;grid-template-columns:auto 1fr auto;gap:.5rem;padding:.4rem 0;border-bottom:1px solid var(--border);font-size:.92rem;}
.co-qty{color:var(--green);font-weight:700;}
.co-line-price{color:var(--ink);font-weight:700;}
.co-total{display:flex;justify-content:space-between;font-weight:800;font-size:1.1rem;color:var(--gold);margin:.8rem 0;}
.co-pay{width:100%;margin-top:.4rem;}
.co-back{display:block;text-align:center;color:var(--ink-dim);font-size:.9rem;margin-top:.8rem;}
.co-back:hover{color:var(--gold);}
.co-secure{text-align:center;font-size:.78rem;margin:.7rem 0 0;}
.co-err{color:var(--danger);font-size:.9rem;margin:.4rem 0;}
.co-empty{padding:2rem;text-align:center;margin:3rem auto;max-width:420px;display:flex;flex-direction:column;gap:1rem;align-items:center;}
@media (max-width:820px){ .co-grid{grid-template-columns:1fr;} .co-summary{position:static;} }
`;
