import { doc, serverTimestamp, updateDoc } from "firebase/firestore";

import { auth, db } from "../firebase/firebase";

/*
=====================================================
NOTIFICATIONS
=====================================================

Why there is no `notifications` collection
------------------------------------------
A notification here is never new information. "Your doctor
accepted", "your prescription is ready", "a new request is
waiting" are all restatements of a consultation_requests or
prescriptions document the user can ALREADY read.

Writing them to a second collection would mean:

  * duplicated state that can drift from the record it
    describes - the brief explicitly warns against that
  * a patient needing WRITE access to a document owned by
    a doctor (to notify them of a new request), which is
    exactly the kind of hole the security rules exist to
    close

So notifications are DERIVED from data the user is already
authorised to see. Nothing is duplicated, nothing can drift,
and no new write permission is needed.

What does need persisting is "have I seen this yet", and
that is a single timestamp on the user's own document -
users/{uid} for a patient, doctors/{uid} for a doctor. Both
can already write their own record, so again no new rule.
=====================================================
*/

export const NOTIFICATION_TYPE = {
  REQUEST_RECEIVED: "request_received",
  REQUEST_ACCEPTED: "request_accepted",
  REQUEST_REJECTED: "request_rejected",
  CONSULTATION_READY: "consultation_ready",
  PRESCRIPTION_ISSUED: "prescription_issued",
  PAYMENT_DUE: "payment_due",
  PAYMENT_RECEIVED: "payment_received",
};

const millis = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

/*
Builds the PATIENT's notifications from their own
consultations and prescriptions.
*/
export const patientNotifications = ({
  consultations = [],
  prescriptions = [],
}) => {
  const items = [];

  consultations.forEach((consultation) => {
    const doctor = consultation.doctorName || "Your doctor";

    if (consultation.status === "accepted") {
      items.push({
        id: `${consultation.id}:accepted`,
        type: NOTIFICATION_TYPE.REQUEST_ACCEPTED,
        title: `${doctor} accepted your consultation`,
        body: "You can join the video consultation from your consultations list.",
        at: millis(consultation.respondedAt || consultation.updatedAt),
        route: `/consultation-status/${consultation.id}`,
      });
    }

    if (consultation.status === "rejected") {
      items.push({
        id: `${consultation.id}:rejected`,
        type: NOTIFICATION_TYPE.REQUEST_REJECTED,
        title: "Your consultation request was not accepted",
        body: `${doctor} could not take this consultation. You can request another doctor.`,
        at: millis(consultation.respondedAt || consultation.updatedAt),
        route: "/consult-doctor",
      });
    }

    /*
      Payment is the last step, so it only becomes due once the
      consultation is finished - never before the call.
    */
    if (
      consultation.status === "completed" &&
      consultation.paymentStatus !== "paid" &&
      Number(consultation.fee) > 0
    ) {
      items.push({
        id: `${consultation.id}:payment-due`,
        type: NOTIFICATION_TYPE.PAYMENT_DUE,
        title: "Consultation fee is due",
        body: `Your consultation with ${doctor} is complete. Fee: Rs ${consultation.fee}.`,
        at: millis(consultation.completedAt || consultation.updatedAt),
        route: "/consultations",
      });
    }
  });

  prescriptions.forEach((prescription) => {
    items.push({
      id: `${prescription.id}:issued`,
      type: NOTIFICATION_TYPE.PRESCRIPTION_ISSUED,
      title: "A prescription is available",
      body: `${
        prescription.doctorName || "Your doctor"
      } has issued a prescription. You can view and download it as a PDF.`,
      at: millis(prescription.createdAt),
      route: `/prescription/${prescription.requestId}`,
    });
  });

  return items.sort((a, b) => b.at - a.at);
};

/*
Builds the DOCTOR's notifications from consultations
addressed to them.
*/
export const doctorNotifications = ({ consultations = [] }) => {
  const items = [];

  consultations.forEach((consultation) => {
    const patient = consultation.patientName || "A patient";

    if (consultation.status === "pending") {
      const isHighRisk =
        String(consultation.risk || "").toUpperCase() === "HIGH";

      items.push({
        id: `${consultation.id}:requested`,
        type: NOTIFICATION_TYPE.REQUEST_RECEIVED,
        title: isHighRisk
          ? `New request from ${patient} - high estimated risk`
          : `New consultation request from ${patient}`,
        body: isHighRisk
          ? "This patient's screening returned a high estimated risk. Please review promptly."
          : "Review their assessment and accept or decline.",
        at: millis(consultation.createdAt),
        route: `/doctor/request/${consultation.id}`,
        urgent: isHighRisk,
      });
    }

    if (["accepted", "in_progress"].includes(consultation.status)) {
      items.push({
        id: `${consultation.id}:ready`,
        type: NOTIFICATION_TYPE.CONSULTATION_READY,
        title: `Consultation with ${patient} is ready`,
        body: "You can join the video call, then issue a prescription.",
        at: millis(consultation.respondedAt || consultation.updatedAt),
        route: `/video-consultation/${consultation.id}`,
      });
    }

    if (
      consultation.status === "completed" &&
      consultation.paymentStatus === "paid"
    ) {
      items.push({
        id: `${consultation.id}:paid`,
        type: NOTIFICATION_TYPE.PAYMENT_RECEIVED,
        title: `Payment received from ${patient}`,
        body: `Rs ${consultation.fee} for a completed consultation.`,
        at: millis(consultation.updatedAt),
        route: "/doctor/dashboard",
      });
    }
  });

  return items.sort((a, b) => b.at - a.at);
};

/*
Unread = created after the user last opened their
notifications. A notification with no usable timestamp
counts as unread rather than being silently hidden.
*/
export const countUnread = (items, lastSeenAt) => {
  const seen = millis(lastSeenAt);

  return items.filter((item) => !item.at || item.at > seen).length;
};

export const isUnread = (item, lastSeenAt) => {
  const seen = millis(lastSeenAt);
  return !item.at || item.at > seen;
};

/*
Records that the user has looked at their notifications.

Writes to the user's OWN document, which they can already
update, so this needs no new security rule. Failure is
never surfaced: not being able to clear a badge must not
interrupt what the user was doing.
*/
export const markNotificationsSeen = async (role) => {
  const user = auth.currentUser;

  if (!user) return;

  const collectionName = role === "doctor" ? "doctors" : "users";

  try {
    await updateDoc(doc(db, collectionName, user.uid), {
      lastSeenNotificationsAt: serverTimestamp(),
    });
  } catch (error) {
    console.warn("Could not record notifications as seen:", error.code || error);
  }
};

export const relativeTime = (at) => {
  if (!at) return "";

  const seconds = Math.floor((Date.now() - at) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

  return new Date(at).toLocaleDateString();
};
