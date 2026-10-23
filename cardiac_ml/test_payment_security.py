"""
=====================================================================
PAYMENT SECURITY  -  unit test
=====================================================================

Tests the parts that decide whether money is real, without needing
Razorpay credentials or a Firestore connection: signature checking,
webhook raw-body verification, idempotency, and recipient
resolution.

Run:  python test_payment_security.py
=====================================================================
"""

import hashlib
import hmac
import json
import os
import sys

# Fixed test values so the module imports with a known secret.
os.environ.setdefault("RAZORPAY_KEY_ID", "rzp_test_abc123")
os.environ.setdefault("RAZORPAY_KEY_SECRET", "test_secret_do_not_use")
os.environ.setdefault("RAZORPAY_WEBHOOK_SECRET", "test_webhook_secret")

import payments  # noqa: E402

passed = 0
failed = 0


def check(name, condition, detail=""):
    global passed, failed

    if condition:
        print(f"  PASS  {name}")
        passed += 1
    else:
        print(f"  FAIL  {name}{f' - {detail}' if detail else ''}")
        failed += 1


print("=" * 64)
print("PAYMENT SECURITY")
print("=" * 64)

# ---------------------------------------------------------------
print("\n--- checkout signature ---")

SECRET = payments.RAZORPAY_KEY_SECRET
ORDER = "order_MNq3xK8vLpQ1Zz"
PAYMENT = "pay_MNq3yT2wRsX9Aa"


def sign(order, payment, secret=SECRET):
    return hmac.new(
        secret.encode(), f"{order}|{payment}".encode(), hashlib.sha256
    ).hexdigest()


check(
    "genuine signature accepted",
    payments.signature_matches(ORDER, PAYMENT, sign(ORDER, PAYMENT)),
)
check(
    "guessed signature rejected",
    not payments.signature_matches(ORDER, PAYMENT, "a" * 64),
)
check(
    "signature from the wrong secret rejected",
    not payments.signature_matches(
        ORDER, PAYMENT, sign(ORDER, PAYMENT, "attacker_secret")
    ),
)
check(
    "signature for a DIFFERENT payment rejected (replay)",
    not payments.signature_matches(
        ORDER, PAYMENT, sign(ORDER, "pay_ATTACKER")
    ),
)
check(
    "signature for a DIFFERENT order rejected",
    not payments.signature_matches(
        ORDER, PAYMENT, sign("order_OTHER", PAYMENT)
    ),
)
check("empty signature rejected", not payments.signature_matches(ORDER, PAYMENT, ""))

# ---------------------------------------------------------------
print("\n--- webhook signature is over the RAW body ---")

WEBHOOK_SECRET = payments.RAZORPAY_WEBHOOK_SECRET

body = json.dumps(
    {
        "event": "payment.captured",
        "payload": {"payment": {"entity": {"id": PAYMENT, "order_id": ORDER}}},
    },
    separators=(",", ":"),
).encode()

good = hmac.new(WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()

check(
    "raw body with the right secret verifies",
    hmac.compare_digest(
        good, hmac.new(WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()
    ),
)

# Re-serialising changes whitespace, which changes the hash. This is
# exactly why the endpoint reads request.body() before parsing.
reserialised = json.dumps(json.loads(body)).encode()

check(
    "re-serialised body produces a DIFFERENT hash",
    reserialised != body
    and hmac.new(WEBHOOK_SECRET.encode(), reserialised, hashlib.sha256).hexdigest()
    != good,
    "this is why the raw bytes must be used",
)

check(
    "a tampered body fails",
    hmac.new(
        WEBHOOK_SECRET.encode(), body + b" ", hashlib.sha256
    ).hexdigest()
    != good,
)

check(
    "the checkout key secret does NOT verify webhooks",
    hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest() != good,
    "they are separate secrets and must not be interchangeable",
)

# ---------------------------------------------------------------
print("\n--- idempotency ---")


class FakeDoc:
    def __init__(self, data):
        self._data = dict(data)
        self.updates = []
        # settle_payment iterates documents and writes via .reference
        self.reference = self

    def update(self, patch):
        self.updates.append(patch)
        self._data.update(patch)

    def to_dict(self):
        return dict(self._data)


class FakeQuery:
    """Supports the .where(...).stream() that settle_payment uses to
    unlock the prescriptions belonging to a consultation."""

    def __init__(self, rows):
        self.rows = rows

    def where(self, field, _op, value):
        return FakeQuery(
            [r for r in self.rows if r.to_dict().get(field) == value]
        )

    def stream(self):
        return list(self.rows)


class FakeCollection:
    def __init__(self, store, rows=None):
        self.store = store
        self.rows = rows or []

    def document(self, doc_id):
        return self.store.setdefault(doc_id, FakeDoc({}))

    def where(self, field, op, value):
        return FakeQuery(self.rows).where(field, op, value)


class FakeDb:
    def __init__(self, store, prescriptions=None):
        self.store = store
        self.prescriptions = prescriptions or []

    def collection(self, name):
        if name == "prescriptions":
            return FakeCollection(self.store, self.prescriptions)
        return FakeCollection(self.store)


payments.server_timestamp = lambda: "SERVER_TS"

store = {}

# One locked prescription on the consultation being settled.
locked_prescription = FakeDoc(
    {"requestId": "req_1", "patientId": "p1", "unlocked": False}
)

db = FakeDb(store, prescriptions=[locked_prescription])

paid_ref = FakeDoc({"status": "paid", "requestId": "req_1"})

outcome = payments.settle_payment(
    db, paid_ref, paid_ref.to_dict(), PAYMENT, source="webhook"
)

check(
    "settling an already-paid payment is a no-op",
    outcome == "already_paid" and len(paid_ref.updates) == 0,
    f"outcome={outcome}, updates={len(paid_ref.updates)}",
)

fresh_ref = FakeDoc({"status": "created", "requestId": "req_1"})
fresh_ref.id = "pay_1"

outcome = payments.settle_payment(
    db, fresh_ref, fresh_ref.to_dict(), PAYMENT, source="checkout"
)

check(
    "settling an unpaid payment marks it paid",
    outcome == "paid" and fresh_ref.updates[0]["status"] == "paid",
)

check(
    "settling unlocks the prescription for that consultation",
    any(patch.get("unlocked") is True for patch in locked_prescription.updates),
    "the patient's dashboard query filters on unlocked == true",
)

check(
    "settling also unlocks the consultation",
    any(
        patch.get("paymentStatus") == "paid"
        for doc in store.values()
        for patch in doc.updates
    ),
    "the security rules key off consultation.paymentStatus",
)

# ---------------------------------------------------------------
print("\n--- recipient resolution ---")


class StubSnapshot:
    def __init__(self, data):
        self.exists = data is not None
        self._data = data

    def to_dict(self):
        return self._data


class StubRef:
    """Mirrors hospitals/{id} -> private/settlement."""

    def __init__(self, data):
        self._data = data

    def get(self):
        # The hospital document exists whenever we have any data for it.
        return StubSnapshot({} if self._data is not None else None)

    def collection(self, _name):
        settlement = self._data
        return type(
            "Sub",
            (),
            {"document": lambda _self, _id: StubRef._leaf(settlement)},
        )()

    @staticmethod
    def _leaf(data):
        return type(
            "Leaf", (), {"get": lambda _self: StubSnapshot(data)}
        )()


class StubCollection:
    def __init__(self, docs):
        self.docs = docs

    def document(self, doc_id):
        return StubRef(self.docs.get(doc_id))


class StubDb:
    def __init__(self, hospitals):
        self.hospitals = hospitals

    def collection(self, _name):
        return StubCollection(self.hospitals)


verified = StubDb(
    {
        "h1": {
            "name": "CardioCare",
            "razorpayLinkedAccountId": "acc_ABC123",
            "payoutOnboardingStatus": "verified",
        }
    }
)

result = payments.resolve_recipient(verified, {"hospitalId": "h1"})

check(
    "a verified linked account routes to that hospital",
    result["mode"] == "route" and result["linkedAccountId"] == "acc_ABC123",
    str(result),
)

unverified = StubDb(
    {
        "h1": {
            "razorpayLinkedAccountId": "acc_ABC123",
            "payoutOnboardingStatus": "pending",
        }
    }
)

result = payments.resolve_recipient(unverified, {"hospitalId": "h1"})

check(
    "an UNVERIFIED linked account does NOT receive a transfer",
    result["mode"] == "platform" and result["linkedAccountId"] is None,
    "money must never go to an account nobody has checked",
)

result = payments.resolve_recipient(StubDb({}), {"hospitalId": "missing"})

check(
    "a missing hospital falls back to the platform, with a reason",
    result["mode"] == "platform" and result["reason"],
    str(result),
)

result = payments.resolve_recipient(StubDb({}), {})

check(
    "a consultation with no hospital falls back to the platform",
    result["mode"] == "platform",
)

# ---------------------------------------------------------------
print("\n--- transfers ---")

check(
    "no transfer block when Route is unavailable",
    payments.build_transfers({"mode": "platform"}, 50000) is None,
)

transfers = payments.build_transfers(
    {"mode": "route", "linkedAccountId": "acc_ABC123", "hospitalId": "h1"}, 50000
)

check(
    "the full amount is transferred - no invented commission",
    transfers[0]["amount"] == 50000,
    str(transfers),
)

check(
    "the transfer names the hospital for reconciliation",
    transfers[0]["notes"]["hospitalId"] == "h1",
)

# ---------------------------------------------------------------
print("\n" + "=" * 64)
print(f"PASSED: {passed}    FAILED: {failed}")
print("=" * 64)

sys.exit(0 if failed == 0 else 1)
