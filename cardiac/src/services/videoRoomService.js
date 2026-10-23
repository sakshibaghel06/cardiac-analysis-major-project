import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteField,
  serverTimestamp,
} from "firebase/firestore";

import { auth, db } from "../firebase/firebase";

/*
=====================================================
VIDEO ROOM SERVICE
=====================================================

Responsibilities:

  1. Decide whether the signed-in user is actually
     allowed into a given consultation, and what
     their REAL role is.

  2. Build the WebRTC ICE configuration.

  3. Check that this browser can physically provide
     camera + microphone, and produce an accurate
     error when it cannot.

  4. Own the lifecycle of the video_rooms document.

Room layout (one document per consultation):

  video_rooms/{requestId}
    requestId       string
    patientId       string   - auth uid
    doctorId        string   - auth uid
    sessionId       string   - identifies ONE offer
    offer           { type, sdp }
    answer          { type, sdp }
    answerSessionId string   - which offer this answers
    patientJoinId   string   - changes each patient page load
    status          waiting | connected | ended
    createdAt / updatedAt / endedAt / endedBy

  video_rooms/{requestId}/doctorCandidates/*
  video_rooms/{requestId}/patientCandidates/*
    ...candidate fields, plus sessionId

Why sessionId exists
--------------------
The previous implementation wrote a single offer and a
single answer and never cleared them. When the doctor
reloaded the page it created a brand new peer connection,
but the OLD answer was still sitting in the document, so
the listener immediately applied a stale answer to a
fresh connection and the call could never establish.

Every offer now carries a sessionId. An answer is only
accepted if it answers the offer we actually sent, and
ICE candidates are filtered to the session they belong
to. Reloading either side renegotiates cleanly.
=====================================================
*/

// =====================================================
// IDENTIFIERS
// =====================================================

// Both participants must derive the SAME room id.
export const roomIdForRequest = (requestId) => requestId;

export const randomId = () =>
  Math.random().toString(36).slice(2) + Date.now().toString(36);

// =====================================================
// AUTHORISATION
// =====================================================

/*
The role used to come from the URL (?role=doctor), which
meant any patient could open the doctor view simply by
editing the address bar. The role is now derived from the
consultation record itself and cannot be spoofed.
*/

export const resolveConsultationAccess = async (requestId) => {
  const user = auth.currentUser;

  if (!user) {
    return {
      allowed: false,
      reason: "not-signed-in",
      message: "Please sign in again to join this consultation.",
    };
  }

  if (!requestId) {
    return {
      allowed: false,
      reason: "no-request",
      message: "This consultation link is invalid.",
    };
  }

  const snapshot = await getDoc(
    doc(db, "consultation_requests", requestId)
  );

  if (!snapshot.exists()) {
    return {
      allowed: false,
      reason: "not-found",
      message: "This consultation no longer exists.",
    };
  }

  const request = { id: snapshot.id, ...snapshot.data() };

  let role = null;

  if (user.uid === request.patientId) {
    role = "patient";
  } else if (user.uid === request.doctorId) {
    role = "doctor";
  }

  if (!role) {
    return {
      allowed: false,
      reason: "not-a-participant",
      message: "You are not a participant in this consultation.",
      request,
    };
  }

  const status = String(request.status || "").toLowerCase();

  /*
    Both states admit people to the room. "in_progress" simply
    means the doctor has already joined - rejecting it would lock
    the patient out of a call that is actively running, and would
    stop either side rejoining after a reload.
  */
  const JOINABLE = ["accepted", "in_progress"];

  if (!JOINABLE.includes(status)) {
    return {
      allowed: false,
      reason: "not-joinable",
      message:
        status === "pending"
          ? "The doctor has not accepted this consultation yet."
          : "This consultation is no longer active.",
      role,
      request,
    };
  }

  /*
    NO PAYMENT GATE HERE, deliberately.

    The agreed flow is:

        doctor accepts -> video consultation -> prescription -> payment

    so the call must be reachable while the consultation is still
    unpaid. Payment is requested afterwards, from the consultation
    list, once the doctor has issued the prescription.
  */

  return { allowed: true, role, request, uid: user.uid };
};

// =====================================================
// ICE / TURN CONFIGURATION
// =====================================================

/*
STUN only lets two peers connect when at least one of them
is directly reachable. On most college, office and mobile
networks that is not true, and the call fails after
appearing to "almost" connect.

A TURN server relays the media and fixes it. Configure it
in cardiac/.env - see cardiac/.env.example.
*/

export const buildIceConfiguration = () => {
  const iceServers = [
    {
      urls: [
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302",
      ],
    },
  ];

  const turnUrl = import.meta.env.VITE_TURN_URL;

  if (turnUrl) {
    iceServers.push({
      urls: turnUrl,
      username: import.meta.env.VITE_TURN_USERNAME,
      credential: import.meta.env.VITE_TURN_CREDENTIAL,
    });
  }

  return { iceServers, iceCandidatePoolSize: 10 };
};

export const hasTurnConfigured = () =>
  Boolean(import.meta.env.VITE_TURN_URL);

// =====================================================
// MEDIA CAPABILITY CHECK
// =====================================================

/*
This is the check that was missing.

Browsers only expose navigator.mediaDevices on a SECURE
context: https://, or http://localhost. If you run
"npm run dev -- --host" and open the app from another
device on http://192.168.x.x:5173 then mediaDevices is
undefined, and the old code fell through to a generic
"please allow camera access" message - even though no
permission prompt was ever shown and nothing was denied.

That is almost certainly why one participant appeared to
have "permission denied" while the other worked: one was
on localhost, the other on a LAN address.
*/

export const checkMediaSupport = () => {
  if (typeof window === "undefined") {
    return { supported: false, reason: "no-window" };
  }

  const isLocalhost = ["localhost", "127.0.0.1", "[::1]"].includes(
    window.location.hostname
  );

  if (!window.isSecureContext && !isLocalhost) {
    return {
      supported: false,
      reason: "insecure-context",
      message:
        "Your browser blocks camera and microphone access on insecure " +
        "connections. This page is open on " +
        window.location.origin +
        ". Open it on http://localhost, or serve the app over HTTPS, " +
        "then try again.",
    };
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    return {
      supported: false,
      reason: "unsupported-browser",
      message:
        "This browser does not support video calling. Please use a " +
        "recent version of Chrome, Edge, Firefox or Safari.",
    };
  }

  return { supported: true };
};

// =====================================================
// GET LOCAL CAMERA + MICROPHONE
// =====================================================

const describeMediaError = (error) => {
  switch (error?.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return (
        "Camera and microphone access was blocked. Click the camera " +
        "icon in your address bar, choose Allow, then press Try Again."
      );

    case "NotFoundError":
    case "DevicesNotFoundError":
      return (
        "No camera or microphone was found. Please connect one and " +
        "press Try Again."
      );

    case "NotReadableError":
    case "TrackStartError":
      return (
        "Your camera or microphone is already in use by another " +
        "application or browser tab. Close it - including any other " +
        "tab running this consultation - then press Try Again."
      );

    case "OverconstrainedError":
      return (
        "Your camera does not support the requested settings. Please " +
        "try a different camera."
      );

    case "SecurityError":
      return (
        "Your browser blocked media access for this page. Open the app " +
        "on http://localhost or over HTTPS."
      );

    default:
      return (
        "Unable to start your camera and microphone. " +
        (error?.message || "Please check your device settings.")
      );
  }
};

/*
Returns { stream, audioOnly, error, notice }.

If the camera is unavailable but the microphone works we
still join audio-only, because a consultation with sound
is far more useful than no consultation at all.
*/

export const getLocalStream = async () => {
  const support = checkMediaSupport();

  if (!support.supported) {
    return {
      stream: null,
      audioOnly: false,
      error: support.message,
      reason: support.reason,
    };
  }

  // ---- first choice: camera + microphone ------------
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: { echoCancellation: true, noiseSuppression: true },
    });

    return { stream, audioOnly: false, error: null };
  } catch (error) {
    /*
      A hard denial or an insecure context applies to audio
      too, so there is no point retrying those.
    */
    const hardFailure =
      error?.name === "NotAllowedError" ||
      error?.name === "PermissionDeniedError" ||
      error?.name === "SecurityError";

    if (hardFailure) {
      return {
        stream: null,
        audioOnly: false,
        error: describeMediaError(error),
        reason: error?.name,
      };
    }

    // ---- fallback: microphone only ------------------
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: true,
      });

      return {
        stream: audioStream,
        audioOnly: true,
        error: null,
        notice:
          "Your camera could not be started, so you have joined with " +
          "audio only. The other participant will still hear you.",
      };
    } catch (audioError) {
      return {
        stream: null,
        audioOnly: false,
        error: describeMediaError(audioError),
        reason: audioError?.name,
      };
    }
  }
};

// =====================================================
// ROOM LIFECYCLE
// =====================================================

export const roomRefFor = (requestId) =>
  doc(db, "video_rooms", roomIdForRequest(requestId));

/*
Has this consultation's call already been ended?

Read on EVERY mount, so pressing Back, re-opening a
bookmark, or refreshing a finished consultation shows the
summary instead of silently restarting the call. Component
state cannot answer this - a fresh mount has none.

A missing room means the call never started, which is not
the same as ended.
*/
export const getRoomState = async (requestId) => {
  if (!requestId) return { exists: false, ended: false };

  try {
    const snapshot = await getDoc(roomRefFor(requestId));

    if (!snapshot.exists()) return { exists: false, ended: false };

    const data = snapshot.data();

    return {
      exists: true,
      ended: data.status === "ended",
      endedBy: data.endedBy || null,
      status: data.status || null,
    };
  } catch (error) {
    /*
      Never let this block a join: failing closed here would
      lock both people out of a working consultation.
    */
    console.warn("Could not read room state:", error.code || error);
    return { exists: false, ended: false };
  }
};

/*
Called by the PATIENT on every page load.

patientJoinId changes each time, which is how the doctor
detects that the patient reloaded and knows it must send
a fresh offer.
*/
export const markPatientPresent = async (
  requestId,
  request,
  patientJoinId
) => {
  await setDoc(
    roomRefFor(requestId),
    {
      requestId,
      patientId: request.patientId,
      doctorId: request.doctorId,
      patientJoinId,
      status: "waiting",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
};

/*
Called by the DOCTOR each time it (re)negotiates.

Writing a new sessionId and clearing the previous answer
is what makes a reload recover instead of deadlocking on
a stale answer.
*/
export const publishOffer = async (
  requestId,
  request,
  sessionId,
  offer
) => {
  await setDoc(
    roomRefFor(requestId),
    {
      requestId,
      patientId: request.patientId,
      doctorId: request.doctorId,
      sessionId,
      offer: { type: offer.type, sdp: offer.sdp },
      answer: deleteField(),
      answerSessionId: deleteField(),
      status: "waiting",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
};

/*
Called by the PATIENT once it has answered a specific
offer. answerSessionId tells the doctor whether this
answer belongs to the offer it is currently waiting on.
*/
export const publishAnswer = async (requestId, sessionId, answer) => {
  await updateDoc(roomRefFor(requestId), {
    answer: { type: answer.type, sdp: answer.sdp },
    answerSessionId: sessionId,
    status: "connected",
    updatedAt: serverTimestamp(),
  });
};

export const markRoomEnded = async (requestId, role) => {
  try {
    await updateDoc(roomRefFor(requestId), {
      status: "ended",
      endedBy: role,
      endedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    /*
      Ending a call must never surface an error to the user -
      by this point they have already left the page.
    */
    console.warn("Could not mark room as ended:", error);
  }
};
