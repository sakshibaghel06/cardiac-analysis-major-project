import {
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";

import { auth, db } from "../firebase/firebase";

// Same service, same base URL - imported so the two cannot drift.
import { API_URL, apiConfigured } from "./predictionService";

/*
=====================================================
PAYMENT SERVICE (browser side)
=====================================================

This file deliberately CANNOT mark a payment successful.

  * It never writes to /payments - Firestore rules refuse
    every client write to that collection.
  * It only forwards Razorpay's signed response to the
    API, which recomputes the HMAC with the key secret
    and decides.
  * It never sees, handles or stores card details. Those
    go straight from the patient to Razorpay's widget.

So a patient who edits this JavaScript, fakes a success
callback or replays a response still cannot get a
consultation marked paid.

See cardiac_ml/payments.py for the server half.
=====================================================
*/

const RAZORPAY_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

export const PAYMENT_STATUS = {
  UNPAID: "unpaid",
  CREATED: "created",
  PAID: "paid",
  FAILED: "failed",
  REFUNDED: "refunded",
};

// -----------------------------------------------------
// IS PAYMENT EVEN SET UP?
// -----------------------------------------------------

export const getPaymentConfig = async () => {
  if (!apiConfigured()) return { configured: false, unreachable: true };

  try {
    const response = await fetch(`${API_URL}/payments/config`);

    if (!response.ok) return { configured: false };

    return response.json();
  } catch {
    return { configured: false, unreachable: true };
  }
};

// -----------------------------------------------------
// LOAD THE CHECKOUT WIDGET
// -----------------------------------------------------

const loadRazorpayScript = () =>
  new Promise((resolve) => {
    if (window.Razorpay) {
      resolve(true);
      return;
    }

    const script = document.createElement("script");
    script.src = RAZORPAY_SCRIPT;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);

    document.body.appendChild(script);
  });

// -----------------------------------------------------
// PAY
// -----------------------------------------------------

/*
Resolves  { status: 'paid' }        - verified by the server
          { status: 'cancelled' }   - patient closed the widget
Rejects   on a real error.
*/
export const payForConsultation = async ({
  requestId,
  doctorName,
}) => {
  const user = auth.currentUser;

  if (!user) throw new Error("Please sign in to pay for this consultation.");

  const config = await getPaymentConfig();

  if (!config.configured) {
    throw new Error(
      config.unreachable
        ? "Could not reach the payment service. Make sure the API is running."
        : "Online payment is not configured yet. Set RAZORPAY_KEY_ID and " +
          "RAZORPAY_KEY_SECRET on the API and restart it."
    );
  }

  // ---- 1. server creates the order --------------------
  const orderResponse = await fetch(`${API_URL}/payments/create-order`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    /*
      No amount is sent. The server reads the fee from the
      consultation record itself, so there is nothing here for a
      patient to tamper with.
    */
    body: JSON.stringify({
      requestId,
      patientId: user.uid,
    }),
  });

  if (!orderResponse.ok) {
    const problem = await orderResponse.json().catch(() => null);

    throw new Error(
      problem?.detail || "Could not start the payment. Please try again."
    );
  }

  const order = await orderResponse.json();

  // ---- 2. open the checkout widget --------------------
  const scriptLoaded = await loadRazorpayScript();

  if (!scriptLoaded) {
    throw new Error(
      "Could not load the payment window. Check your internet connection."
    );
  }

  return new Promise((resolve, reject) => {
    const checkout = new window.Razorpay({
      key: order.razorpayKeyId, // public key only
      // From the server's order, not from anything the page held.
      amount: order.amountInPaise,
      currency: order.currency,
      order_id: order.orderId,

      name: "CardioCare",
      description: `Consultation with ${doctorName || "your doctor"}`,

      prefill: { email: user.email || "" },

      // ---- 3. Razorpay returns a SIGNED result ---------
      handler: async (response) => {
        try {
          // ---- 4. only the server may accept it --------
          const verifyResponse = await fetch(`${API_URL}/payments/verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              paymentDocId: order.paymentDocId,
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            }),
          });

          if (!verifyResponse.ok) {
            const problem = await verifyResponse.json().catch(() => null);

            reject(
              new Error(
                problem?.detail ||
                  "We could not verify your payment. If money was deducted " +
                    "it will be refunded automatically. Please contact support."
              )
            );
            return;
          }

          const verified = await verifyResponse.json();

          resolve({ status: verified.status, paymentDocId: order.paymentDocId });
        } catch {
          reject(
            new Error(
              "Payment was taken but could not be confirmed. Please do not " +
                "pay again - check your consultation status in a moment."
            )
          );
        }
      },

      modal: {
        ondismiss: () => resolve({ status: "cancelled" }),
      },
    });

    checkout.on("payment.failed", (event) => {
      reject(
        new Error(
          event?.error?.description || "The payment could not be completed."
        )
      );
    });

    checkout.open();
  });
};

// -----------------------------------------------------
// READ
// -----------------------------------------------------

export const getMyPayments = async () => {
  const user = auth.currentUser;

  if (!user) throw new Error("You must be signed in.");

  const snapshot = await getDocs(
    query(collection(db, "payments"), where("patientId", "==", user.uid))
  );

  return snapshot.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort(
      (a, b) =>
        (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)
    );
};
