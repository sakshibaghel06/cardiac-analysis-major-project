const PAYMENT_STORAGE_PREFIX = "cardiocare.demo-payment.";
const DEMO_FEE = 500;
const STORAGE_ERROR = "__CARDIOCARE_DEMO_PAYMENT_STORAGE_ERROR__";

const delay = (milliseconds) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds));

const paymentKey = (requestId) =>
  `${PAYMENT_STORAGE_PREFIX}${encodeURIComponent(requestId)}`;

export const getDemoPayment = (requestId) => {
  if (!requestId) return null;

  return parseDemoPayment(getDemoPaymentSnapshot(requestId), requestId);
};

export const getDemoPaymentSnapshot = (requestId) => {
  if (!requestId) return null;

  try {
    return window.localStorage.getItem(paymentKey(requestId));
  } catch {
    return STORAGE_ERROR;
  }
};

export const parseDemoPayment = (stored, requestId) => {
  if (stored === STORAGE_ERROR) {
    throw new Error("Browser storage is unavailable for the demo payment.");
  }
  if (!stored) return null;

  try {
    const payment = JSON.parse(stored);

    return payment?.status === "PAID" &&
      payment?.requestId === requestId &&
      typeof payment?.transactionReference === "string" &&
      typeof payment?.paidAt === "string"
      ? payment
      : null;
  } catch {
    throw new Error("The saved demo payment record could not be read.");
  }
};

export const subscribeDemoPayments = (onChange) => {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", onChange);
  window.addEventListener("cardiocare-demo-payment-change", onChange);

  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("cardiocare-demo-payment-change", onChange);
  };
};

export const payForConsultation = async ({ requestId, consultation = {} }) => {
  if (!requestId) throw new Error("Consultation reference is missing.");

  const existingPayment = getDemoPayment(requestId);
  if (existingPayment) return existingPayment;

  await delay(1200);

  const paidAt = new Date().toISOString();
  const payment = {
    status: "PAID",
    paymentMethod: "DEMO",
    requestId,
    fee: DEMO_FEE,
    paidAt,
    transactionReference: `DEMO-${Date.now().toString(36).toUpperCase()}`,
    doctorName: consultation.doctorName || "",
    hospitalName: consultation.hospitalName || "",
    consultationDate:
      consultation.completedAt?.toDate?.()?.toISOString?.() ||
      consultation.createdAt?.toDate?.()?.toISOString?.() ||
      "",
  };

  try {
    window.localStorage.setItem(paymentKey(requestId), JSON.stringify(payment));
  } catch (error) {
    const storageError = new Error(
      "The demo payment could not be saved in this browser. Check local storage settings and try again."
    );
    storageError.cause = error;
    throw storageError;
  }

  window.dispatchEvent?.(new Event("cardiocare-demo-payment-change"));
  return payment;
};

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });

export const downloadDemoReceipt = (payment) => {
  if (!payment?.requestId || payment.status !== "PAID") {
    throw new Error("A successful demo payment is required for a receipt.");
  }

  const paidDate = new Date(payment.paidAt);
  if (Number.isNaN(paidDate.getTime())) {
    throw new Error("The saved demo payment date is invalid.");
  }

  const receiptDate = escapeHtml(paidDate.toLocaleString());
  const reference = escapeHtml(payment.requestId);
  const doctor = escapeHtml(payment.doctorName || "Not available in this demo");
  const transaction = escapeHtml(payment.transactionReference);

  const receipt = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CardioCare Demo Receipt</title>
  <style>
    body { font: 16px Arial, sans-serif; color: #172033; margin: 0; padding: 32px; }
    main { max-width: 620px; margin: 0 auto; border: 1px solid #cbd5e1; border-radius: 12px; padding: 28px; }
    h1 { margin-top: 0; color: #0f766e; }
    .notice { background: #fff7ed; border: 1px solid #fdba74; padding: 12px; font-weight: 700; }
    dl { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    dt { color: #64748b; font-size: 13px; } dd { margin: 4px 0 0; overflow-wrap: anywhere; }
    .amount { font-size: 22px; font-weight: 700; }
    @media print { body { padding: 0; } main { border: 0; } }
  </style>
</head>
<body>
  <main>
    <h1>CardioCare Medical Center</h1>
    <p class="notice">DEMO RECEIPT — NOT A REAL FINANCIAL TRANSACTION</p>
    <dl>
      <div><dt>Consultation reference</dt><dd>${reference}</dd></div>
      <div><dt>Doctor</dt><dd>${doctor}</dd></div>
      <div><dt>Fee</dt><dd class="amount">₹${DEMO_FEE}</dd></div>
      <div><dt>Payment date and time</dt><dd>${receiptDate}</dd></div>
      <div><dt>Demo transaction reference</dt><dd>${transaction}</dd></div>
      <div><dt>Payment status</dt><dd>PAID — DEMO ONLY</dd></div>
    </dl>
  </main>
</body>
</html>`;

  const blob = new Blob([receipt], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `cardiocare-demo-receipt-${encodeURIComponent(payment.requestId)}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const DEMO_PAYMENT_FEE = DEMO_FEE;
