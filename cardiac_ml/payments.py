"""
=====================================================================
PAYMENT VERIFICATION  AND  PROVIDER SETTLEMENT
=====================================================================

The single rule this module exists to enforce:

    THE BROWSER NEVER DECIDES THAT A PAYMENT SUCCEEDED.

A patient can call any endpoint, replay any response and edit any
JavaScript. The one thing they cannot forge is an HMAC signed with
the Razorpay key secret, which never leaves this server.

FLOW
----
    1. Browser asks THIS server to create an order.
       Server re-reads the fee and the prescription state from
       Firestore - it never trusts an amount sent by the browser -
       then calls Razorpay and stores a 'created' payment.

    2. Browser opens Razorpay Checkout. Razorpay collects the card
       details. This application never sees or stores them.

    3. Razorpay returns a signed result to the browser, which
       forwards it here.

    4. Server recomputes HMAC_SHA256(order_id|payment_id, secret),
       compares with compare_digest, AND re-reads the order from
       the Razorpay API to confirm it is actually paid. Signature
       alone proves the message came from Razorpay; the API call
       proves the money moved.

    5. Only then does the consultation become paid, which is what
       unlocks the prescription.

WEBHOOK
-------
Step 3 depends on the patient's browser surviving the redirect. It
often does not - they close the tab, lose signal, or the callback
is delayed. The webhook is the authoritative path: Razorpay calls
it server-to-server and retries until it gets a 2xx.

It verifies HMAC_SHA256 over the RAW REQUEST BODY. Re-serialising
parsed JSON changes whitespace and key order, which changes the
signature, so the raw bytes are read before any parsing.

IDEMPOTENCY
-----------
Checkout callback and webhook routinely both arrive, and Razorpay
retries webhooks. Every state change is therefore conditional on
the payment not already being settled, so duplicate deliveries are
no-ops rather than double charges or double unlocks.

CONFIGURATION
-------------
    RAZORPAY_KEY_ID                 test key (rzp_test_...)
    RAZORPAY_KEY_SECRET             server only, never shipped
    RAZORPAY_WEBHOOK_SECRET         set when creating the webhook
    GOOGLE_APPLICATION_CREDENTIALS  Firebase service-account JSON

Missing configuration returns HTTP 503 with an explanation. It
never falls back to approving payments.
=====================================================================
"""

import base64
import hashlib
import hmac
import json
import os
import urllib.error
import urllib.request

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter(prefix="/payments", tags=["payments"])

RAZORPAY_KEY_ID = os.environ.get("RAZORPAY_KEY_ID", "")
RAZORPAY_KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "")
RAZORPAY_WEBHOOK_SECRET = os.environ.get("RAZORPAY_WEBHOOK_SECRET", "")
RAZORPAY_API = "https://api.razorpay.com/v1"


# ---------------------------------------------------------------------
# FIRESTORE (Admin SDK)
# ---------------------------------------------------------------------

_firestore_client = None
_firestore_error = None


def firestore():
    """
    Lazily initialise the Admin SDK.

    Admin credentials bypass security rules, which is precisely why
    the rules can afford to forbid every client write to /payments
    and to consultation paymentStatus.
    """
    global _firestore_client, _firestore_error

    if _firestore_client is not None:
        return _firestore_client

    if _firestore_error is not None:
        raise HTTPException(status_code=503, detail=_firestore_error)

    try:
        import firebase_admin
        from firebase_admin import credentials, firestore as admin_firestore

        if not firebase_admin._apps:
            cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")

            if cred_path and os.path.exists(cred_path):
                firebase_admin.initialize_app(credentials.Certificate(cred_path))
            else:
                firebase_admin.initialize_app()

        _firestore_client = admin_firestore.client()

        return _firestore_client

    except ImportError:
        _firestore_error = (
            "firebase-admin is not installed. Run: pip install firebase-admin"
        )
    except Exception as error:  # noqa: BLE001
        _firestore_error = (
            "Firebase Admin SDK could not start. Set "
            "GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON file. "
            f"Underlying error: {error}"
        )

    raise HTTPException(status_code=503, detail=_firestore_error)


def server_timestamp():
    import firebase_admin

    return firebase_admin.firestore.SERVER_TIMESTAMP


def require_razorpay():
    if not RAZORPAY_KEY_ID or not RAZORPAY_KEY_SECRET:
        raise HTTPException(
            status_code=503,
            detail=(
                "Payments are not configured. Set RAZORPAY_KEY_ID and "
                "RAZORPAY_KEY_SECRET (use rzp_test_... keys in development) "
                "and restart the API."
            ),
        )


# ---------------------------------------------------------------------
# RAZORPAY HTTP
# ---------------------------------------------------------------------

def razorpay_request(path: str, payload: dict | None = None, method: str = "GET"):
    """Minimal Razorpay client - urllib, so no extra dependency."""
    token = base64.b64encode(
        f"{RAZORPAY_KEY_ID}:{RAZORPAY_KEY_SECRET}".encode()
    ).decode()

    data = json.dumps(payload).encode() if payload is not None else None

    request = urllib.request.Request(
        f"{RAZORPAY_API}{path}",
        data=data,
        method=method,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Basic {token}",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            return json.loads(response.read().decode())

    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")

        raise HTTPException(
            status_code=502,
            detail=f"Razorpay rejected the request: {detail}",
        ) from error

    except urllib.error.URLError as error:
        raise HTTPException(
            status_code=502,
            detail=f"Could not reach Razorpay: {error.reason}",
        ) from error


# ---------------------------------------------------------------------
# SCHEMAS
# ---------------------------------------------------------------------

class CreateOrderRequest(BaseModel):
    requestId: str = Field(..., min_length=1)
    patientId: str = Field(..., min_length=1)


class CreateOrderResponse(BaseModel):
    orderId: str
    paymentDocId: str
    amountInPaise: int
    currency: str
    razorpayKeyId: str


class VerifyRequest(BaseModel):
    paymentDocId: str = Field(..., min_length=1)
    razorpayOrderId: str = Field(..., min_length=1)
    razorpayPaymentId: str = Field(..., min_length=1)
    razorpaySignature: str = Field(..., min_length=1)


class VerifyResponse(BaseModel):
    status: str
    paymentDocId: str
    message: str


# ---------------------------------------------------------------------
# SETTLEMENT  -  who actually receives the money
# ---------------------------------------------------------------------

def resolve_recipient(db, consultation: dict) -> dict:
    """
    Work out which provider should be settled, from TRUSTED records
    only - the hospital on the consultation, then that hospital's
    document. A recipient id supplied by the browser is ignored.

    Returns {mode, hospitalId, linkedAccountId, reason}.

    mode is one of:

      route     the hospital has a verified Razorpay Route linked
                account, so a transfer can be made automatically.

      platform  no linked account. Funds settle to the platform's
                own Razorpay account and the intended recipient is
                RECORDED for manual reconciliation.

    'platform' is not automatic hospital settlement and this module
    never describes it as such. Razorpay Route requires activation
    on the account plus KYC per linked account; until that is done
    the honest behaviour is to collect centrally and keep an
    auditable record of who the money is owed to.
    """
    hospital_id = consultation.get("hospitalId")

    if not hospital_id:
        return {
            "mode": "platform",
            "hospitalId": None,
            "linkedAccountId": None,
            "reason": "the consultation has no hospital recorded",
        }

    hospital_ref = db.collection("hospitals").document(hospital_id)

    if not hospital_ref.get().exists:
        return {
            "mode": "platform",
            "hospitalId": hospital_id,
            "linkedAccountId": None,
            "reason": "the hospital record no longer exists",
        }

    """
    Settlement details live in a PRIVATE subcollection, not on the
    hospital document itself. The hospital document is readable by
    every signed-in patient so they can browse and choose; a payout
    destination has no business in a directory listing.

    firestore.rules denies this path to all clients. Only the Admin
    SDK, which bypasses rules, can read it - which is this process.
    """
    settlement = (
        hospital_ref.collection("private").document("settlement").get()
    )

    data = settlement.to_dict() if settlement.exists else {}

    linked = data.get("razorpayLinkedAccountId")
    onboarded = data.get("payoutOnboardingStatus")

    # Both must be true: an id that is present AND marked verified by
    # an administrator. An unverified id would send money to an
    # account nobody has checked.
    if linked and onboarded == "verified":
        return {
            "mode": "route",
            "hospitalId": hospital_id,
            "linkedAccountId": linked,
            "reason": None,
        }

    return {
        "mode": "platform",
        "hospitalId": hospital_id,
        "linkedAccountId": None,
        "reason": (
            "the hospital has no verified Razorpay linked account, so funds "
            "settle to the platform account pending manual reconciliation"
        ),
    }


def build_transfers(recipient: dict, amount_in_paise: int):
    """
    Razorpay Route transfer block, or None.

    No commission is deducted. A platform fee would be a business
    decision with tax and contractual consequences, and inventing a
    percentage here would silently take money from providers. When a
    fee is agreed it belongs in configuration, applied explicitly.
    """
    if recipient["mode"] != "route":
        return None

    return [
        {
            "account": recipient["linkedAccountId"],
            "amount": amount_in_paise,
            "currency": "INR",
            "notes": {"hospitalId": recipient["hospitalId"]},
        }
    ]


# ---------------------------------------------------------------------
# CREATE ORDER
# ---------------------------------------------------------------------

@router.post("/create-order", response_model=CreateOrderResponse)
def create_order(body: CreateOrderRequest):
    require_razorpay()

    db = firestore()

    consultation_ref = db.collection("consultation_requests").document(
        body.requestId
    )
    snapshot = consultation_ref.get()

    if not snapshot.exists:
        raise HTTPException(status_code=404, detail="Consultation not found.")

    consultation = snapshot.to_dict()

    if consultation.get("patientId") != body.patientId:
        raise HTTPException(
            status_code=403, detail="This consultation does not belong to you."
        )

    if consultation.get("paymentStatus") == "paid":
        raise HTTPException(
            status_code=409,
            detail="This consultation has already been paid for.",
        )

    # Payment unlocks the prescription, so there must be one to unlock.
    if consultation.get("prescriptionStatus") != "issued":
        raise HTTPException(
            status_code=409,
            detail=(
                "Your doctor has not issued the prescription yet. There is "
                "nothing to pay for until they do."
            ),
        )

    # The amount comes from the consultation record, NEVER the browser.
    fee = consultation.get("fee")

    if not isinstance(fee, (int, float)) or fee <= 0:
        raise HTTPException(
            status_code=409,
            detail="No consultation fee is recorded for this consultation.",
        )

    amount_in_paise = int(round(float(fee) * 100))

    recipient = resolve_recipient(db, consultation)

    payment_ref = db.collection("payments").document()

    order_payload = {
        "amount": amount_in_paise,
        "currency": "INR",
        "receipt": payment_ref.id,
        "payment_capture": 1,
        "notes": {
            "requestId": body.requestId,
            "patientId": body.patientId,
            "hospitalId": recipient["hospitalId"] or "",
        },
    }

    transfers = build_transfers(recipient, amount_in_paise)

    if transfers:
        order_payload["transfers"] = transfers

    order = razorpay_request("/orders", order_payload, method="POST")

    payment_ref.set(
        {
            "requestId": body.requestId,
            "patientId": body.patientId,
            "doctorId": consultation.get("doctorId"),
            "hospitalId": recipient["hospitalId"],
            "amountInPaise": amount_in_paise,
            "currency": "INR",
            "razorpayOrderId": order["id"],
            "status": "created",
            # Recorded even when Route is unavailable, so every payment
            # can be reconciled to the provider it was owed to.
            "settlementMode": recipient["mode"],
            "linkedAccountId": recipient["linkedAccountId"],
            "settlementNote": recipient["reason"],
            "transferStatus": "pending" if transfers else "not_applicable",
            "createdAt": server_timestamp(),
            "updatedAt": server_timestamp(),
        }
    )

    return CreateOrderResponse(
        orderId=order["id"],
        paymentDocId=payment_ref.id,
        amountInPaise=amount_in_paise,
        currency="INR",
        razorpayKeyId=RAZORPAY_KEY_ID,  # public key only
    )


# ---------------------------------------------------------------------
# SETTLE  -  shared by the callback and the webhook
# ---------------------------------------------------------------------

def signature_matches(order_id: str, payment_id: str, supplied: str) -> bool:
    expected = hmac.new(
        RAZORPAY_KEY_SECRET.encode(),
        f"{order_id}|{payment_id}".encode(),
        hashlib.sha256,
    ).hexdigest()

    # compare_digest, not ==, so a wrong signature cannot be guessed
    # a character at a time by timing the response.
    return hmac.compare_digest(expected, supplied)


def settle_payment(db, payment_ref, record: dict, payment_id: str, source: str):
    """
    Marks a verified payment as paid and unlocks the consultation.

    IDEMPOTENT. The checkout callback and the webhook routinely both
    arrive, and Razorpay retries webhooks until it gets a 2xx, so
    this must be safe to run repeatedly.
    """
    if record.get("status") == "paid":
        return "already_paid"

    payment_ref.update(
        {
            "status": "paid",
            "razorpayPaymentId": payment_id,
            "verifiedBy": source,
            "paidAt": server_timestamp(),
            "updatedAt": server_timestamp(),
        }
    )

    request_id = record["requestId"]

    db.collection("consultation_requests").document(request_id).update(
        {
            "paymentStatus": "paid",
            "paymentId": payment_ref.id,
            "updatedAt": server_timestamp(),
        }
    )

    """
    Unlock the prescription(s) for this consultation.

    The flag lives ON THE PRESCRIPTION rather than being derived
    from the consultation, because Firestore evaluates rules per
    document for a list query: a gate that required reading another
    document made `where patientId == me` unprovable, and one locked
    row failed the patient's entire dashboard query.

    Written here, server side, in the same operation that verified
    the signature. The rules give no client any way to set it -
    including the issuing doctor.
    """
    unlocked = 0

    for prescription in (
        db.collection("prescriptions")
        .where("requestId", "==", request_id)
        .stream()
    ):
        prescription.reference.update(
            {"unlocked": True, "unlockedAt": server_timestamp()}
        )
        unlocked += 1

    print(f"[payments] unlocked {unlocked} prescription(s) for {request_id}")

    return "paid"


def confirm_with_razorpay(order_id: str) -> bool:
    """
    Ask Razorpay whether the order is actually paid.

    A valid signature proves the message came from Razorpay. It does
    not, on its own, prove the money was captured. This is the
    difference between "Razorpay told us something" and "Razorpay
    holds the funds".
    """
    order = razorpay_request(f"/orders/{order_id}")

    return order.get("status") == "paid"


# ---------------------------------------------------------------------
# VERIFY  (checkout callback)
# ---------------------------------------------------------------------

@router.post("/verify", response_model=VerifyResponse)
def verify(body: VerifyRequest):
    require_razorpay()

    db = firestore()

    payment_ref = db.collection("payments").document(body.paymentDocId)
    payment = payment_ref.get()

    if not payment.exists:
        raise HTTPException(status_code=404, detail="Payment record not found.")

    record = payment.to_dict()

    if record.get("status") == "paid":
        return VerifyResponse(
            status="paid",
            paymentDocId=body.paymentDocId,
            message="This payment was already verified.",
        )

    if record.get("razorpayOrderId") != body.razorpayOrderId:
        raise HTTPException(
            status_code=400, detail="Order id does not match this payment record."
        )

    if not signature_matches(
        body.razorpayOrderId, body.razorpayPaymentId, body.razorpaySignature
    ):
        payment_ref.update(
            {
                "status": "failed",
                "failureReason": "signature_mismatch",
                "updatedAt": server_timestamp(),
            }
        )

        raise HTTPException(
            status_code=400, detail="Payment signature verification failed."
        )

    if not confirm_with_razorpay(body.razorpayOrderId):
        # Signature valid but funds not captured. Leave it pending;
        # the webhook will settle it if and when capture happens.
        payment_ref.update(
            {"status": "pending_capture", "updatedAt": server_timestamp()}
        )

        return VerifyResponse(
            status="pending",
            paymentDocId=body.paymentDocId,
            message=(
                "Your payment is being confirmed by the bank. This page will "
                "update as soon as it clears."
            ),
        )

    outcome = settle_payment(
        db, payment_ref, record, body.razorpayPaymentId, source="checkout"
    )

    return VerifyResponse(
        status="paid",
        paymentDocId=body.paymentDocId,
        message=(
            "This payment was already verified."
            if outcome == "already_paid"
            else "Payment verified."
        ),
    )


# ---------------------------------------------------------------------
# WEBHOOK  -  the authoritative path
# ---------------------------------------------------------------------

@router.post("/webhook")
async def webhook(request: Request):
    """
    Razorpay calls this server-to-server and retries until it gets a
    2xx, so it works even when the patient closes the tab.

    The signature is computed over the RAW BODY. Parsing and
    re-serialising JSON changes whitespace and key order, which
    changes the hash - so the bytes are read before anything else
    touches them.
    """
    if not RAZORPAY_WEBHOOK_SECRET:
        raise HTTPException(
            status_code=503,
            detail=(
                "RAZORPAY_WEBHOOK_SECRET is not set, so webhook deliveries "
                "cannot be verified and are refused."
            ),
        )

    raw = await request.body()
    supplied = request.headers.get("X-Razorpay-Signature", "")

    expected = hmac.new(
        RAZORPAY_WEBHOOK_SECRET.encode(), raw, hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(expected, supplied):
        raise HTTPException(status_code=400, detail="Invalid webhook signature.")

    event = json.loads(raw.decode())
    kind = event.get("event", "")

    entity = (
        event.get("payload", {}).get("payment", {}).get("entity", {})
    )

    order_id = entity.get("order_id")
    payment_id = entity.get("id")

    if not order_id:
        # Not a payment event we act on. 200 so Razorpay stops retrying.
        return {"received": True, "handled": False, "event": kind}

    db = firestore()

    matches = list(
        db.collection("payments")
        .where("razorpayOrderId", "==", order_id)
        .limit(1)
        .stream()
    )

    if not matches:
        return {"received": True, "handled": False, "reason": "unknown order"}

    payment_ref = matches[0].reference
    record = matches[0].to_dict()

    if kind in ("payment.captured", "order.paid"):
        outcome = settle_payment(
            db, payment_ref, record, payment_id, source="webhook"
        )

        return {"received": True, "handled": True, "outcome": outcome}

    if kind == "payment.failed":
        # Never downgrade an already-settled payment.
        if record.get("status") != "paid":
            payment_ref.update(
                {
                    "status": "failed",
                    "failureReason": entity.get("error_description")
                    or "reported failed by Razorpay",
                    "updatedAt": server_timestamp(),
                }
            )

        return {"received": True, "handled": True, "outcome": "failed"}

    if kind.startswith("transfer."):
        payment_ref.update(
            {
                "transferStatus": kind.split(".", 1)[1],
                "updatedAt": server_timestamp(),
            }
        )

        return {"received": True, "handled": True, "outcome": kind}

    return {"received": True, "handled": False, "event": kind}


# ---------------------------------------------------------------------
# CONFIG
# ---------------------------------------------------------------------

@router.get("/config")
def config():
    """Lets the frontend say something accurate when payment is off."""
    configured = bool(RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET)

    return {
        "configured": configured,
        "keyId": RAZORPAY_KEY_ID or None,
        "mode": (
            "test"
            if RAZORPAY_KEY_ID.startswith("rzp_test")
            else "live" if RAZORPAY_KEY_ID else None
        ),
        "webhookConfigured": bool(RAZORPAY_WEBHOOK_SECRET),
    }
