/*
=====================================================
CONSULTATION STATUS  -  semantics, in one place
=====================================================

Deliberately free of any Firebase import, for two
reasons: these are pure functions over a string, and
keeping them importable without initialising Firebase
means they can be unit tested directly. See
scripts/test_consultation_status.mjs.

WHY THIS MODULE EXISTS
----------------------
Every screen used to compare the status itself:

    status === "accepted"

That held until `in_progress` was introduced for a call
the doctor had already joined. Each of those comparisons
then became quietly wrong at once - the patient's Join
button disappeared mid-consultation and their status text
fell through to its last else branch, which read
"Pending". Nothing had reset the status; no branch
matched it.

Screens now ask a question about the status instead of
comparing it, so the next status is handled here rather
than in a dozen conditionals that have to be found first.
=====================================================
*/

export const STATUS = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  IN_PROGRESS: "in_progress",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
  COMPLETED: "completed",
};

export const normaliseStatus = (status) =>
  typeof status === "string" ? status.toLowerCase() : STATUS.PENDING;

/*
Can this consultation be joined right now?

Both states qualify. "in_progress" means the doctor has
already joined - excluding it would lock the patient out
of a call that is actively running, and stop either side
rejoining after a disconnect.
*/
export const isJoinable = (status) =>
  [STATUS.ACCEPTED, STATUS.IN_PROGRESS].includes(normaliseStatus(status));

/* Still going: not finished, declined or withdrawn. */
export const isActive = (status) =>
  [STATUS.PENDING, STATUS.ACCEPTED, STATUS.IN_PROGRESS].includes(
    normaliseStatus(status)
  );

export const isFinished = (status) =>
  [STATUS.COMPLETED, STATUS.REJECTED, STATUS.CANCELLED].includes(
    normaliseStatus(status)
  );

const LABELS = {
  [STATUS.PENDING]: "Waiting for doctor",
  [STATUS.ACCEPTED]: "Accepted",
  [STATUS.IN_PROGRESS]: "Consultation in progress",
  [STATUS.REJECTED]: "Declined",
  [STATUS.CANCELLED]: "Cancelled",
  [STATUS.COMPLETED]: "Completed",
};

const HELP = {
  [STATUS.PENDING]:
    "Your request has been sent. The doctor has not responded yet.",
  [STATUS.ACCEPTED]:
    "Your doctor accepted. You can join the video consultation now.",
  [STATUS.IN_PROGRESS]:
    "Your doctor is in the consultation room. Join now, or rejoin if " +
    "you were disconnected.",
  [STATUS.REJECTED]:
    "This doctor could not take your consultation. You can request another.",
  [STATUS.CANCELLED]: "You cancelled this request.",
  [STATUS.COMPLETED]: "This consultation has finished.",
};

export const statusLabel = (status) =>
  LABELS[normaliseStatus(status)] || normaliseStatus(status);

export const statusHelp = (status) => HELP[normaliseStatus(status)] || "";

/* Wording for the join button, which differs once a call is live. */
export const joinLabel = (status) =>
  normaliseStatus(status) === STATUS.IN_PROGRESS
    ? "Rejoin Consultation"
    : "Join Video Consultation";
