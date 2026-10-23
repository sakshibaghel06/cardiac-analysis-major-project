import { useCallback, useEffect, useRef, useState } from "react";

import {
  collection,
  addDoc,
  onSnapshot,
  query,
  where,
  serverTimestamp,
} from "firebase/firestore";

import { useNavigate, useParams } from "react-router-dom";

import { auth } from "../firebase/firebase";

import { markConsultationInProgress } from "../services/consultationService";

import {
  buildIceConfiguration,
  getLocalStream,
  getRoomState,
  hasTurnConfigured,
  markPatientPresent,
  markRoomEnded,
  publishAnswer,
  publishOffer,
  randomId,
  resolveConsultationAccess,
  roomRefFor,
} from "../services/videoRoomService";

/*
=====================================================
VIDEO CONSULTATION
=====================================================

The doctor is always the caller (creates the offer).
The patient is always the callee (creates the answer).

Both sides use the consultation request id as the room
id, so they are guaranteed to meet in the same room.

Fixed in this file
------------------
1. The local <video> element is now always mounted, so
   the camera stream actually reaches the screen. It
   previously lived behind an early return, which meant
   the ref was null at the moment the stream arrived and
   the preview stayed black forever.

2. The role comes from Firestore, not from ?role= in the
   URL, and non-participants are refused.

3. Reloading either side renegotiates cleanly instead of
   deadlocking on a stale offer/answer.

4. Media failures are reported accurately - in
   particular an insecure origin is no longer mislabelled
   as a permission denial.
=====================================================
*/

function VideoConsultation() {
  const { requestId } = useParams();
  const navigate = useNavigate();

  // ---------------------------------------------------
  // REFS - connection machinery
  // ---------------------------------------------------

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  const localStreamRef = useRef(null);
  const peerConnectionRef = useRef(null);

  const roomUnsubscribeRef = useRef(null);
  const candidateUnsubscribeRef = useRef(null);

  // ICE candidates can arrive before the remote description.
  const pendingCandidatesRef = useRef([]);

  // The offer we are currently negotiating.
  const sessionIdRef = useRef(null);

  // Patient: which offer we have already answered.
  const handledSessionRef = useRef(null);

  // Doctor: the patient page-load we last saw.
  const lastPatientJoinIdRef = useRef(null);

  // Doctor: has the current answer already been applied?
  const answeredSessionRef = useRef(null);

  const accessRef = useRef(null);
  const roleRef = useRef(null);
  const startedRef = useRef(false);

  // Set only by the explicit Rejoin button, so an ended call is
  // never restarted automatically.
  const rejoiningRef = useRef(false);
  const unmountedRef = useRef(false);

  // ---------------------------------------------------
  // STATE - what the user sees
  // ---------------------------------------------------

  const [phase, setPhase] = useState("checking");
  const [role, setRole] = useState(null);

  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);

  const [cameraOn, setCameraOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [audioOnly, setAudioOnly] = useState(false);

  const [connected, setConnected] = useState(false);
  const [connectionState, setConnectionState] = useState("new");

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [peerLeft, setPeerLeft] = useState(false);
  const [endedBy, setEndedBy] = useState(null);

  // =====================================================
  // ATTACH STREAMS TO THE VIDEO ELEMENTS
  // =====================================================

  /*
  Done in an effect rather than inline when the stream is
  created. The stream can arrive before React has mounted
  the <video> element, and that ordering was the original
  reason the local preview was always black.
  */

  useEffect(() => {
    const element = localVideoRef.current;

    if (element && localStream && element.srcObject !== localStream) {
      element.srcObject = localStream;
      element.play().catch(() => {});
    }
  }, [localStream, phase]);

  useEffect(() => {
    const element = remoteVideoRef.current;

    if (element && remoteStream && element.srcObject !== remoteStream) {
      element.srcObject = remoteStream;
      element.play().catch(() => {});
    }
  }, [remoteStream, phase]);

  // =====================================================
  // TEARDOWN
  // =====================================================

  const closePeerConnection = useCallback(() => {
    if (candidateUnsubscribeRef.current) {
      candidateUnsubscribeRef.current();
      candidateUnsubscribeRef.current = null;
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.ontrack = null;
      peerConnectionRef.current.onicecandidate = null;
      peerConnectionRef.current.onconnectionstatechange = null;
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    pendingCandidatesRef.current = [];

    setRemoteStream(null);
    setConnected(false);
  }, []);

  const cleanupCall = useCallback(() => {
    if (roomUnsubscribeRef.current) {
      roomUnsubscribeRef.current();
      roomUnsubscribeRef.current = null;
    }

    closePeerConnection();

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    setLocalStream(null);
  }, [closePeerConnection]);

  // =====================================================
  // PEER CONNECTION
  // =====================================================

  const createPeerConnection = useCallback(
    (stream, sessionId, myRole) => {
      const peerConnection = new RTCPeerConnection(
        buildIceConfiguration()
      );

      peerConnectionRef.current = peerConnection;

      stream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, stream);
      });

      // ---- remote media ------------------------------
      peerConnection.ontrack = (event) => {
        const [incoming] = event.streams;

        if (incoming) {
          setRemoteStream(incoming);
          setPeerLeft(false);
        }
      };

      // ---- our ICE candidates ------------------------
      const myCandidates = collection(
        roomRefFor(requestId),
        myRole === "doctor" ? "doctorCandidates" : "patientCandidates"
      );

      peerConnection.onicecandidate = async (event) => {
        if (!event.candidate) return;

        try {
          await addDoc(myCandidates, {
            ...event.candidate.toJSON(),
            sessionId,
            createdAt: serverTimestamp(),
          });
        } catch (candidateError) {
          console.error("Could not send ICE candidate:", candidateError);
        }
      };

      // ---- connection health -------------------------
      peerConnection.onconnectionstatechange = () => {
        const state = peerConnection.connectionState;

        setConnectionState(state);

        if (state === "connected") {
          setConnected(true);
          setPeerLeft(false);
          setError("");
        }

        if (state === "disconnected") {
          setConnected(false);
        }

        if (state === "failed") {
          setConnected(false);

          setError(
            hasTurnConfigured()
              ? "The connection dropped. Check your internet and press Try Again."
              : "Could not establish a direct connection. This usually means " +
                  "the network is blocking peer-to-peer traffic. Configure a " +
                  "TURN server in cardiac/.env, or try a different network."
          );
        }
      };

      return peerConnection;
    },
    [requestId]
  );

  // ---------------------------------------------------
  // ICE candidates from the other participant
  // ---------------------------------------------------

  const subscribeToRemoteCandidates = useCallback(
    (peerConnection, sessionId, myRole) => {
      if (candidateUnsubscribeRef.current) {
        candidateUnsubscribeRef.current();
        candidateUnsubscribeRef.current = null;
      }

      const theirCandidates = collection(
        roomRefFor(requestId),
        myRole === "doctor" ? "patientCandidates" : "doctorCandidates"
      );

      /*
        Filtering by sessionId is what stops candidates
        left over from an earlier call attempt being fed
        into a brand new connection.
      */
      const scoped = query(
        theirCandidates,
        where("sessionId", "==", sessionId)
      );

      candidateUnsubscribeRef.current = onSnapshot(scoped, (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
          if (change.type !== "added") return;

          const stored = change.doc.data();

          /*
            Take only the fields RTCIceCandidate understands.
            The document also carries sessionId and createdAt,
            which are ours for filtering and would be rejected.
          */
          const candidate = new RTCIceCandidate({
            candidate: stored.candidate,
            sdpMid: stored.sdpMid,
            sdpMLineIndex: stored.sdpMLineIndex,
            usernameFragment: stored.usernameFragment,
          });

          // Cannot add a candidate before the remote description.
          if (!peerConnection.remoteDescription) {
            pendingCandidatesRef.current.push(candidate);
            return;
          }

          try {
            await peerConnection.addIceCandidate(candidate);
          } catch (candidateError) {
            console.error("Could not add ICE candidate:", candidateError);
          }
        });
      });
    },
    [requestId]
  );

  const drainPendingCandidates = useCallback(async (peerConnection) => {
    const queued = pendingCandidatesRef.current;
    pendingCandidatesRef.current = [];

    for (const candidate of queued) {
      try {
        await peerConnection.addIceCandidate(candidate);
      } catch (candidateError) {
        console.error("Could not add queued ICE candidate:", candidateError);
      }
    }
  }, []);

  // =====================================================
  // DOCTOR - create and publish an offer
  // =====================================================

  const sendOffer = useCallback(async () => {
    const stream = localStreamRef.current;
    const access = accessRef.current;

    if (!stream || !access) return;

    // A renegotiation always starts from a clean connection.
    closePeerConnection();

    const sessionId = randomId();
    sessionIdRef.current = sessionId;
    answeredSessionRef.current = null;

    const peerConnection = createPeerConnection(stream, sessionId, "doctor");

    subscribeToRemoteCandidates(peerConnection, sessionId, "doctor");

    const offer = await peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });

    await peerConnection.setLocalDescription(offer);

    await publishOffer(requestId, access.request, sessionId, offer);
  }, [
    requestId,
    closePeerConnection,
    createPeerConnection,
    subscribeToRemoteCandidates,
  ]);

  // =====================================================
  // PATIENT - answer whichever offer is current
  // =====================================================

  const answerOffer = useCallback(
    async (offer, sessionId) => {
      const stream = localStreamRef.current;

      if (!stream) return;

      closePeerConnection();

      sessionIdRef.current = sessionId;
      handledSessionRef.current = sessionId;

      const peerConnection = createPeerConnection(
        stream,
        sessionId,
        "patient"
      );

      subscribeToRemoteCandidates(peerConnection, sessionId, "patient");

      await peerConnection.setRemoteDescription(
        new RTCSessionDescription(offer)
      );

      await drainPendingCandidates(peerConnection);

      const answer = await peerConnection.createAnswer();

      await peerConnection.setLocalDescription(answer);

      await publishAnswer(requestId, sessionId, answer);
    },
    [
      requestId,
      closePeerConnection,
      createPeerConnection,
      subscribeToRemoteCandidates,
      drainPendingCandidates,
    ]
  );

  // =====================================================
  // ROOM LISTENER
  // =====================================================

  const watchRoom = useCallback(
    (myRole) => {
      if (roomUnsubscribeRef.current) {
        roomUnsubscribeRef.current();
      }

      roomUnsubscribeRef.current = onSnapshot(
        roomRefFor(requestId),
        async (snapshot) => {
          const data = snapshot.data();

          if (!data || unmountedRef.current) return;

          // ---- the other side hung up ----------------
          if (data.status === "ended" && data.endedBy !== myRole) {
            setPeerLeft(true);
            setConnected(false);
            return;
          }

          if (myRole === "doctor") {
            /*
              The patient reloaded (new patientJoinId), so the
              connection they had is dead. Send a fresh offer.
            */
            const seen = lastPatientJoinIdRef.current;

            if (data.patientJoinId && data.patientJoinId !== seen) {
              lastPatientJoinIdRef.current = data.patientJoinId;

              if (seen !== null) {
                try {
                  await sendOffer();
                } catch (offerError) {
                  console.error("Could not renegotiate:", offerError);
                }
                return;
              }
            }

            /*
              Only accept an answer to the offer we are actually
              waiting on. This is the stale-answer fix.
            */
            const peerConnection = peerConnectionRef.current;

            if (
              data.answer &&
              data.answerSessionId === sessionIdRef.current &&
              answeredSessionRef.current !== data.answerSessionId &&
              peerConnection
            ) {
              answeredSessionRef.current = data.answerSessionId;

              try {
                await peerConnection.setRemoteDescription(
                  new RTCSessionDescription(data.answer)
                );

                await drainPendingCandidates(peerConnection);
              } catch (answerError) {
                console.error("Could not apply answer:", answerError);
              }
            }

            return;
          }

          // ---- patient side --------------------------
          if (data.offer && data.sessionId) {
            if (handledSessionRef.current === data.sessionId) return;

            try {
              await answerOffer(data.offer, data.sessionId);
            } catch (answerError) {
              console.error("Could not answer offer:", answerError);

              setError(
                "Could not connect to the doctor. Press Try Again."
              );
            }
          }
        },
        (listenerError) => {
          console.error("Room listener failed:", listenerError);

          setError(
            "Lost connection to the consultation room. Check your " +
              "internet connection and press Try Again."
          );
        }
      );
    },
    [requestId, sendOffer, answerOffer, drainPendingCandidates]
  );

  // =====================================================
  // JOIN
  // =====================================================

  const join = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;

    setError("");
    setNotice("");
    setRetrying(true);

    try {
      // ---- 1. are we allowed in, and as what? --------
      const access = await resolveConsultationAccess(requestId);

      if (unmountedRef.current) return;

      if (!access.allowed) {
        accessRef.current = null;
        setPhase("blocked");
        setError(access.message);
        startedRef.current = false;
        return;
      }

      accessRef.current = access;
      roleRef.current = access.role;
      setRole(access.role);

      /*
        ---- 2. has this call already finished? ----------

        Checked against the DATABASE, not component state - a
        fresh mount (Back button, refresh, re-opened bookmark)
        has no state to consult.

        Without this, pressing Back after ending a call landed
        straight back on this page, which auto-joined and
        reopened the camera. Rejoining is still possible, but
        only as a deliberate choice.
      */
      const room = await getRoomState(requestId);

      if (unmountedRef.current) return;

      if (room.ended && !rejoiningRef.current) {
        setPhase("ended");
        setEndedBy(room.endedBy);
        startedRef.current = false;
        return;
      }

      // ---- 3. camera + microphone --------------------
      const media = await getLocalStream();

      if (unmountedRef.current) {
        media.stream?.getTracks().forEach((track) => track.stop());
        return;
      }

      if (!media.stream) {
        setPhase("blocked");
        setError(media.error);
        startedRef.current = false;
        return;
      }

      localStreamRef.current = media.stream;
      setLocalStream(media.stream);
      setAudioOnly(media.audioOnly);
      setCameraOn(!media.audioOnly);
      setMicOn(true);

      if (media.notice) setNotice(media.notice);

      setPhase("live");

      // ---- 4. signalling -----------------------------
      if (access.role === "patient") {
        /*
          A new patientJoinId tells the doctor that this is a
          fresh page load and that the previous connection,
          if any, is gone.
        */
        await markPatientPresent(
          requestId,
          access.request,
          randomId()
        );
      }

      watchRoom(access.role);

      if (access.role === "doctor") {
        /*
          The doctor arriving is what starts the consultation. The
          patient can open the room first and wait, so their
          presence alone would not mean it had begun.

          Never allowed to fail the join: a status label is far
          less important than the call connecting.
        */
        markConsultationInProgress(requestId).catch((statusError) =>
          console.warn("Could not mark consultation started:", statusError)
        );

        await sendOffer();
      }
    } catch (joinError) {
      console.error("Could not join consultation:", joinError);

      if (unmountedRef.current) return;

      setPhase("blocked");

      setError(
        joinError?.code === "permission-denied"
          ? "You do not have permission to join this consultation."
          : "Could not join the consultation. Please press Try Again."
      );

      startedRef.current = false;
    } finally {
      if (!unmountedRef.current) setRetrying(false);
    }
  }, [requestId, watchRoom, sendOffer]);

  const retry = useCallback(() => {
    cleanupCall();

    startedRef.current = false;
    sessionIdRef.current = null;
    handledSessionRef.current = null;
    lastPatientJoinIdRef.current = null;
    answeredSessionRef.current = null;

    setPeerLeft(false);
    setPhase("checking");

    join();
  }, [cleanupCall, join]);

  // ---------------------------------------------------
  // START ONCE AUTH IS KNOWN
  // ---------------------------------------------------

  useEffect(() => {
    unmountedRef.current = false;

    /*
      auth.currentUser is null for a moment after a reload
      while Firebase restores the session, so we wait for
      the first auth state rather than racing it.
    */
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (unmountedRef.current) return;

      if (!user) {
        setPhase("blocked");
        setError("Please sign in again to join this consultation.");
        return;
      }

      join();
    });

    return () => {
      unmountedRef.current = true;
      unsubscribe();

      if (roleRef.current) markRoomEnded(requestId, roleRef.current);

      cleanupCall();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // =====================================================
  // CONTROLS
  // =====================================================

  const toggleCamera = () => {
    const track = localStreamRef.current?.getVideoTracks()[0];

    if (!track) return;

    track.enabled = !track.enabled;
    setCameraOn(track.enabled);
  };

  const toggleMic = () => {
    const track = localStreamRef.current?.getAudioTracks()[0];

    if (!track) return;

    track.enabled = !track.enabled;
    setMicOn(track.enabled);
  };

  const endCall = async () => {
    const myRole = roleRef.current;

    await markRoomEnded(requestId, myRole);

    cleanupCall();

    roleRef.current = null;

    /*
      replace: true is the fix for the Back button reopening an
      ended call.

      navigate() PUSHES, leaving /video-consultation/:id in the
      history stack - so Back returned to it, the component
      re-mounted, and it rejoined and reopened the camera.
      Replacing swaps the video entry for the destination, so
      Back goes to whatever came before the call.

      The database check in join() is the second line of defence,
      for a bookmark or a refresh that history cannot cover.
    */
    if (myRole === "doctor") {
      /*
        The doctor's next step after a consultation is the
        prescription - "Complete Consultation & Write
        Prescription". Landing them on the dashboard made that
        action hard to find.
      */
      navigate(`/prescription/${requestId}`, { replace: true });
    } else {
      /*
        The patient's next step is the payment / waiting page, not
        the raw status screen. It explains what happens next and
        updates itself when the doctor issues the prescription.
      */
      navigate(`/payment/${requestId}`, { replace: true });
    }
  };

  /*
    Deliberate rejoin of a call that was ended - for a dropped
    connection, or someone who hung up too early.
  */
  const rejoin = () => {
    rejoiningRef.current = true;
    startedRef.current = false;

    setEndedBy(null);
    setPeerLeft(false);
    setPhase("checking");

    join();
  };

  // =====================================================
  // RENDER
  // =====================================================

  const statusLine = () => {
    if (phase === "ended") return "This consultation has ended.";

    if (peerLeft) {
      return role === "doctor"
        ? "The patient has left the consultation."
        : "The doctor has left the consultation.";
    }

    if (connected) return "Connected securely";

    if (connectionState === "connecting") return "Connecting...";

    if (phase !== "live") return "Preparing your consultation...";

    return role === "doctor"
      ? "Waiting for the patient to join..."
      : "Waiting for the doctor to join...";
  };

  /*
  The <video> elements are rendered in every phase. Overlays
  sit on top of them. This is deliberate: hiding them behind
  an early return is what stopped the camera ever reaching
  the screen in the previous version.
  */

  return (
    <div className="video-consultation-page">
      <header className="video-header">
        <div>
          <span>SECURE VIDEO CONSULTATION</span>

          <h1>Doctor Consultation</h1>

          <p>{statusLine()}</p>
        </div>

        <div className="video-role">
          {role === "doctor"
            ? "Doctor"
            : role === "patient"
            ? "Patient"
            : "Connecting"}
        </div>
      </header>

      {notice && (
        <div className="video-notice" role="status">
          {notice}
        </div>
      )}

      <main className="video-container">
        <div className="video-main">
          {/* ---------- REMOTE ---------- */}

          <div className="remote-video">
            <video ref={remoteVideoRef} autoPlay playsInline />

            {!connected && (
              <div className="video-placeholder">
                <div className="video-placeholder-icon">◉</div>

                <h2>
                  {peerLeft
                    ? "Consultation ended"
                    : "Waiting for participant"}
                </h2>

                <p>{statusLine()}</p>
              </div>
            )}

            <div className="participant-label">
              {role === "doctor" ? "Patient" : "Doctor"}
            </div>
          </div>

          {/* ---------- LOCAL ---------- */}

          <div className="local-video">
            <video ref={localVideoRef} autoPlay muted playsInline />

            {(!cameraOn || audioOnly) && (
              <div className="camera-off">
                {audioOnly ? "Audio only" : "Camera Off"}
              </div>
            )}

            <span>You</span>
          </div>
        </div>

        {/* ---------- CONTROLS ---------- */}

        <div className="video-controls">
          <button
            className={micOn ? "video-control" : "video-control off"}
            onClick={toggleMic}
            disabled={phase !== "live"}
          >
            {micOn ? "Mute" : "Unmute"}
          </button>

          <button
            className={cameraOn ? "video-control" : "video-control off"}
            onClick={toggleCamera}
            disabled={phase !== "live" || audioOnly}
          >
            {cameraOn ? "Camera Off" : "Camera On"}
          </button>

          <button className="end-call-button" onClick={endCall}>
            End Consultation
          </button>
        </div>
      </main>

      {/* ---------- OVERLAYS ---------- */}

      {/*
        ENDED  -  this call has already finished.

        Reached by the Back button, a refresh, or re-opening the
        URL. It never rejoins on its own: the only way back into
        the call is the explicit Rejoin button, and the primary
        action is the next step in the workflow.
      */}
      {phase === "ended" && (
        <div className="video-overlay">
          <div className="video-join-card">
            <div className="video-join-icon">✓</div>

            <h2>Consultation ended</h2>

            <p>
              {endedBy === "doctor"
                ? "The doctor ended this consultation."
                : endedBy === "patient"
                ? "The patient ended this consultation."
                : "This consultation has already finished."}
            </p>

            <div className="video-overlay-actions">
              {role === "doctor" ? (
                <button
                  className="join-consultation-button"
                  onClick={() =>
                    navigate(`/prescription/${requestId}`, { replace: true })
                  }
                >
                  Complete Consultation &amp; Write Prescription
                </button>
              ) : (
                <button
                  className="join-consultation-button"
                  onClick={() =>
                    navigate(`/payment/${requestId}`, { replace: true })
                  }
                >
                  Continue
                </button>
              )}

              <button className="video-control" onClick={rejoin}>
                Rejoin Call
              </button>

              <button
                className="video-control"
                onClick={() =>
                  navigate(
                    role === "doctor"
                      ? "/doctor/dashboard"
                      : "/patient/dashboard",
                    { replace: true }
                  )
                }
              >
                Back to Dashboard
              </button>
            </div>
          </div>
        </div>
      )}

      {phase !== "live" && phase !== "ended" && (
        <div className="video-overlay">
          <div className="video-join-card">
            <div className="video-join-icon">◉</div>

            <h2>
              {phase === "checking"
                ? "Joining consultation..."
                : "Unable to join"}
            </h2>

            <p>
              {error ||
                "Checking your access and preparing your camera."}
            </p>

            {phase === "blocked" && (
              <div className="video-overlay-actions">
                <button
                  className="join-consultation-button"
                  onClick={retry}
                  disabled={retrying}
                >
                  {retrying ? "Trying again..." : "Try Again"}
                </button>

                <button
                  className="video-control"
                  onClick={() =>
                    navigate(
                      roleRef.current === "doctor"
                        ? "/doctor/dashboard"
                        : `/consultation-status/${requestId}`
                    )
                  }
                >
                  Go Back
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {phase === "live" && error && (
        <div className="video-error-banner" role="alert">
          <span>{error}</span>

          <button onClick={retry} disabled={retrying}>
            {retrying ? "Reconnecting..." : "Try Again"}
          </button>
        </div>
      )}
    </div>
  );
}

export default VideoConsultation;
