// /checkout — Delivery-only checkout flow
// Collects Customer Details + Physical Delivery Address + ZIP code
// Selects Delivery Window generated dynamically from business hours with 60-min prep floor
// Validates ZIP server-side & passes delivery fee to Stripe Checkout Session

import React, { useMemo, useState } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { MENU_BY_ID, usd } from "../menu.js";
import { createCheckoutSession } from "../lib/api.js";
import { generateDeliveryWindows, getDeliveryFeeCents, SERVICED_ZIPS } from "../lib/delivery.js";
import { logo } from "../logo.js";

export default function Checkout() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const cart = (state && state.cart) || [];

  // Delivery Window selection
  const deliveryWindows = useMemo(() => generateDeliveryWindows(), []);
  const [windowId, setWindowId] = useState(
    deliveryWindows[0]?.times[0]?.windowId || null
  );

  // Customer Contact
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  // Delivery Address
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("Locust Grove");
  const [zip, setZip] = useState("30252");
  const [instructions, setInstructions] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const subtotalCents = useMemo(
    () => cart.reduce((n, i) => n + (MENU_BY_ID[i.id]?.priceCents || 0) * i.qty, 0),
    [cart]
  );

  const deliveryFeeCents = useMemo(() => getDeliveryFeeCents(zip), [zip]);
  const isZipValid = deliveryFeeCents !== null;

  const grandTotalCents = useMemo(() => {
    return subtotalCents + (deliveryFeeCents || 0);
  }, [subtotalCents, deliveryFeeCents]);

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

  const canPay =
    windowId &&
    name.trim() &&
    phone.trim() &&
    address.trim() &&
    isZipValid &&
    !submitting;

  async function pay() {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const { url } = await createCheckoutSession({
        items: cart.map((i) => ({ id: i.id, qty: i.qty })),
        windowId,
        customer: { name: name.trim(), phone: phone.trim() },
        delivery: {
          address: address.trim(),
          city: city.trim(),
          zip: zip.trim(),
          instructions: instructions.trim(),
        },
      });
      if (!url) throw new Error("No checkout URL returned.");
      window.location.assign(url); // Hand off to Stripe-hosted checkout
    } catch (e) {
      if (e.status === 422) {
        setSubmitError(e.message || "Delivery is not available to this ZIP code.");
      } else if (e.status === 409) {
        setSubmitError("That delivery window is no longer available. Please select another time.");
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
          <h1 className="co-h1">Delivery Checkout</h1>

          <div className="co-badge-notice">
            <span>🚗</span>
            <p><strong>EMET is Delivery-Only.</strong> We prepare fresh plant-based orders and courier them straight to your door.</p>
          </div>

          {/* Delivery Address & ZIP */}
          <div className="co-block e-card">
            <h2 className="co-h2">1. Delivery Address</h2>
            <label className="co-field">
              <span>Street Address *</span>
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="123 Plant Based Way, Apt 4B"
                autoComplete="street-address"
                required
              />
            </label>

            <div className="co-row">
              <label className="co-field">
                <span>City</span>
                <input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Locust Grove"
                  autoComplete="address-level2"
                />
              </label>
              <label className="co-field">
                <span>ZIP Code *</span>
                <select
                  value={zip}
                  onChange={(e) => setZip(e.target.value)}
                  className="co-select"
                >
                  <option value="30252">30252 (McDonough - $14 fee)</option>
                  <option value="30253">30253 (McDonough - $14 fee)</option>
                  <option value="30281">30281 (Stockbridge - $15 fee)</option>
                  <option value="30228">30228 (Hampton - $15 fee)</option>
                </select>
              </label>
            </div>

            {!isZipValid && (
              <p className="co-err">We currently only service ZIPs: {SERVICED_ZIPS.join(", ")}</p>
            )}

            <label className="co-field">
              <span>Delivery / Gate Instructions (Optional)</span>
              <input
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="Leave on front porch, gate code #1234"
              />
            </label>
          </div>

          {/* Delivery Window Selection */}
          <div className="co-block e-card">
            <h2 className="co-h2">2. Estimated Delivery Window</h2>
            <p className="co-subtext">All items are freshly made with a minimum 60-minute prep floor.</p>

            {deliveryWindows.length === 0 && (
              <p className="e-muted">We are closed today. Please check back during open hours (Tue–Sat).</p>
            )}

            {deliveryWindows.map((day) => (
              <div key={day.date} className="co-day">
                <p className="co-day-label">{day.label}</p>
                <div className="co-slots">
                  {day.times.map((t) => (
                    <button
                      key={t.windowId}
                      className={"co-slot" + (windowId === t.windowId ? " on" : "")}
                      onClick={() => setWindowId(t.windowId)}
                    >
                      {t.time}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Contact Details */}
          <div className="co-block e-card">
            <h2 className="co-h2">3. Your Contact Details</h2>
            <label className="co-field">
              <span>Full Name *</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jordan M."
                autoComplete="name"
                required
              />
            </label>
            <label className="co-field">
              <span>Mobile Number (for live tracking SMS) *</span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(404) 555-0123"
                inputMode="tel"
                autoComplete="tel"
                required
              />
            </label>
            <p className="co-fineprint e-muted">We will text you live tracking updates when your order is accepted, out for delivery, and dropped off.</p>
          </div>
        </section>

        {/* Order Summary Sidebar */}
        <aside className="co-summary e-card">
          <h2 className="co-h2">Your Order</h2>
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

          <div className="co-breakdown">
            <div className="co-subline">
              <span>Food subtotal</span>
              <span>{usd(subtotalCents)}</span>
            </div>
            <div className="co-subline">
              <span>Delivery fee ({zip})</span>
              <span>{deliveryFeeCents !== null ? usd(deliveryFeeCents) : "Unsupported ZIP"}</span>
            </div>
          </div>

          <div className="co-total">
            <span>Total</span>
            <span>{usd(grandTotalCents)}</span>
          </div>

          {submitError && <p className="co-err">{submitError}</p>}

          <button
            className="e-btn e-btn-gold co-pay"
            disabled={!canPay}
            onClick={pay}
          >
            {submitting ? "Redirecting to Stripe…" : `Pay ${usd(grandTotalCents)} with Card / Apple Pay`}
          </button>

          <Link className="co-back" to="/">← Add more items</Link>
          <p className="co-secure e-muted">🔒 Payment is processed securely by Stripe.</p>
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
          <img src={logo} alt="EMET Logo" aria-hidden />
          <span><b>EMET</b><small>Vegan Cafe</small></span>
        </Link>
      </header>
      <main className="e-wrap">{children}</main>
    </div>
  );
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
.co-subtext{font-size:.85rem;color:var(--ink-dim);margin:-0.4rem 0 .8rem;}
.co-badge-notice{display:flex;gap:.75rem;align-items:center;background:rgba(114,191,68,.12);border:1px solid var(--green);border-radius:10px;padding:.75rem 1rem;margin-bottom:1.2rem;font-size:.9rem;color:var(--ink);}
.co-badge-notice span{font-size:1.4rem;}
.co-badge-notice strong{color:var(--green);}
.co-grid{display:grid;grid-template-columns:1.4fr .9fr;gap:1.4rem;padding-bottom:3rem;}
.co-block{padding:1.2rem;margin-bottom:1.2rem;}
.co-row{display:grid;grid-template-columns:1.2fr 1fr;gap:.8rem;}
.co-day{margin-bottom:1rem;}
.co-day-label{font-weight:700;color:var(--gold);margin:0 0 .5rem;font-size:.9rem;}
.co-slots{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:.5rem;}
.co-slot{border:1px solid var(--border);background:var(--obsidian);color:var(--ink);border-radius:10px;
  padding:.6rem .3rem;font-weight:600;font-size:.85rem;cursor:pointer;font-family:inherit;transition:all .15s ease;}
.co-slot:hover{border-color:var(--green);}
.co-slot.on{background:var(--gold);border-color:var(--gold);color:#1a1400;font-weight:700;}
.co-field{display:block;margin-bottom:.9rem;}
.co-field span{display:block;font-size:.82rem;color:var(--ink-dim);margin-bottom:.35rem;}
.co-field input, .co-select{width:100%;background:var(--obsidian);border:1px solid var(--border);border-radius:10px;
  padding:.75rem .85rem;color:var(--ink);font-size:1rem;font-family:inherit;}
.co-field input:focus, .co-select:focus{outline:none;border-color:var(--gold);}
.co-fineprint{font-size:.82rem;margin:.4rem 0 0;}
.co-summary{padding:1.2rem;align-self:start;position:sticky;top:1rem;}
.co-lines{list-style:none;padding:0;margin:0 0 .8rem;}
.co-lines li{display:grid;grid-template-columns:auto 1fr auto;gap:.5rem;padding:.4rem 0;border-bottom:1px solid var(--border);font-size:.92rem;}
.co-qty{color:var(--green);font-weight:700;}
.co-line-price{color:var(--ink);font-weight:700;}
.co-breakdown{border-top:1px solid var(--border);padding-top:.6rem;margin-top:.4rem;}
.co-subline{display:flex;justify-content:space-between;font-size:.88rem;color:var(--ink-dim);margin-bottom:.35rem;}
.co-total{display:flex;justify-content:space-between;font-weight:800;font-size:1.2rem;color:var(--gold);margin:.8rem 0;border-top:1px dashed var(--border);padding-top:.8rem;}
.co-pay{width:100%;margin-top:.4rem;padding:.85rem;}
.co-back{display:block;text-align:center;color:var(--ink-dim);font-size:.9rem;margin-top:.8rem;}
.co-back:hover{color:var(--gold);}
.co-secure{text-align:center;font-size:.78rem;margin:.7rem 0 0;}
.co-err{color:#ff5a5f;font-size:.9rem;margin:.4rem 0;background:rgba(255,90,95,.1);padding:.5rem .75rem;border-radius:6px;}
.co-empty{padding:2rem;text-align:center;margin:3rem auto;max-width:420px;display:flex;flex-direction:column;gap:1rem;align-items:center;}
@media (max-width:820px){ .co-grid{grid-template-columns:1fr;} .co-summary{position:static;} .co-row{grid-template-columns:1fr;} }
`;
