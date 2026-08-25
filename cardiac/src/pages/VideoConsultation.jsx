import { useEffect, useRef, useState } from "react";

import {
  doc,
  setDoc,
  updateDoc,
  collection,
  addDoc,
  onSnapshot,
} from "firebase/firestore";

import {
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";

import { db } from "../firebase/firebase";

function VideoConsultation() {
  const { requestId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const role = searchParams.get("role") || "patient";

  // =====================================================
  // REFS
  // =====================================================

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  const localStreamRef = useRef(null);
  const peerConnectionRef = useRef(null);

  const roomUnsubscribeRef = useRef(null);
  const candidateUnsubscribeRef = useRef(null);

  // ICE candidates can arrive before remote description.
  const pendingCandidatesRef = useRef([]);

  // Prevent duplicate initialization.
  const startedRef = useRef(false);

  // =====================================================
  // STATE
  // =====================================================

  const [cameraOn, setCameraOn] = useState(true);
  const [micOn, setMicOn] = useState(true);

  const [joined, setJoined] = useState(false);
  const [connected, setConnected] = useState(false);

  const [joining, setJoining] = useState(true);

  const [error, setError] = useState("");

  // =====================================================
  // WEBRTC CONFIG
  // =====================================================

  const rtcConfig = {
    iceServers: [
      {
        urls: "stun:stun.l.google.com:19302",
      },
    ],
  };

  // =====================================================
  // CLEANUP
  // =====================================================

  const cleanupCall = () => {
    console.log("CLEANING UP VIDEO CALL");

    if (roomUnsubscribeRef.current) {
      roomUnsubscribeRef.current();
      roomUnsubscribeRef.current = null;
    }

    if (candidateUnsubscribeRef.current) {
      candidateUnsubscribeRef.current();
      candidateUnsubscribeRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current
        .getTracks()
        .forEach((track) => {
          track.stop();
        });

      localStreamRef.current = null;
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    pendingCandidatesRef.current = [];

    setConnected(false);
  };

  // =====================================================
  // START CAMERA + MICROPHONE
  // =====================================================

  const startCamera = async () => {
    try {
      setError("");

      console.log(
        "REQUESTING CAMERA + MICROPHONE..."
      );

      const stream =
        await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
          },
          audio: true,
        });

      console.log(
        "CAMERA + MICROPHONE ACCESS GRANTED"
      );

      localStreamRef.current = stream;

      if (localVideoRef.current) {
        localVideoRef.current.srcObject =
          stream;

        await localVideoRef.current.play().catch(
          () => {}
        );
      }

      return stream;

    } catch (err) {
      console.error(
        "CAMERA/MICROPHONE ERROR:",
        err
      );

      /*
        We do NOT show "camera not supported".

        Instead we give a simple message telling
        the user to allow the browser permission.
      */

      if (
        err.name === "NotAllowedError" ||
        err.name === "PermissionDeniedError"
      ) {
        setError(
          "Please allow camera and microphone access to join the consultation."
        );
      } else if (
        err.name === "NotReadableError"
      ) {
        setError(
          "Your camera or microphone is currently being used by another application."
        );
      } else if (
        err.name === "NotFoundError"
      ) {
        setError(
          "Please connect a camera and microphone to continue."
        );
      } else {
        setError(
          "Please allow camera and microphone access to continue."
        );
      }

      return null;
    }
  };

  // =====================================================
  // ADD PENDING ICE CANDIDATES
  // =====================================================

  const addPendingCandidates = async (
    peerConnection
  ) => {
    const candidates =
      pendingCandidatesRef.current;

    pendingCandidatesRef.current = [];

    for (const candidate of candidates) {
      try {
        await peerConnection.addIceCandidate(
          candidate
        );
      } catch (error) {
        console.error(
          "Error adding pending ICE candidate:",
          error
        );
      }
    }
  };

  // =====================================================
  // CREATE PEER CONNECTION
  // =====================================================

  const createPeerConnection = (
    stream
  ) => {
    console.log(
      "CREATING PEER CONNECTION"
    );

    const peerConnection =
      new RTCPeerConnection(
        rtcConfig
      );

    peerConnectionRef.current =
      peerConnection;

    // ---------------------------------------------------
    // LOCAL TRACKS
    // ---------------------------------------------------

    stream.getTracks().forEach(
      (track) => {
        peerConnection.addTrack(
          track,
          stream
        );
      }
    );

    // ---------------------------------------------------
    // REMOTE TRACKS
    // ---------------------------------------------------

    peerConnection.ontrack = (
      event
    ) => {
      console.log(
        "REMOTE VIDEO/AUDIO RECEIVED"
      );

      const remoteStream =
        event.streams[0];

      if (
        remoteVideoRef.current &&
        remoteStream
      ) {
        remoteVideoRef.current.srcObject =
          remoteStream;

        remoteVideoRef.current
          .play()
          .catch(() => {});

        setConnected(true);
      }
    };

    // ---------------------------------------------------
    // CONNECTION STATE
    // ---------------------------------------------------

    peerConnection.onconnectionstatechange =
      () => {
        console.log(
          "WEBRTC CONNECTION:",
          peerConnection.connectionState
        );

        if (
          peerConnection.connectionState ===
          "connected"
        ) {
          setConnected(true);
        }

        if (
          peerConnection.connectionState ===
            "disconnected" ||
          peerConnection.connectionState ===
            "failed"
        ) {
          setConnected(false);
        }
      };

    peerConnection.oniceconnectionstatechange =
      () => {
        console.log(
          "ICE STATE:",
          peerConnection.iceConnectionState
        );
      };

    return peerConnection;
  };

  // =====================================================
  // DOCTOR
  // =====================================================

  const startDoctorCall = async (
    stream
  ) => {
    console.log(
      "================================"
    );

    console.log(
      "DOCTOR STARTING CALL"
    );

    console.log(
      "REQUEST:",
      requestId
    );

    console.log(
      "================================"
    );

    const peerConnection =
      createPeerConnection(
        stream
      );

    const roomRef = doc(
      db,
      "video_rooms",
      requestId
    );

    const doctorCandidatesRef =
      collection(
        roomRef,
        "doctorCandidates"
      );

    const patientCandidatesRef =
      collection(
        roomRef,
        "patientCandidates"
      );

    // ---------------------------------------------------
    // DOCTOR ICE
    // ---------------------------------------------------

    peerConnection.onicecandidate =
      async (event) => {
        if (!event.candidate) {
          return;
        }

        try {
          await addDoc(
            doctorCandidatesRef,
            event.candidate.toJSON()
          );

          console.log(
            "DOCTOR ICE CANDIDATE SENT"
          );
        } catch (error) {
          console.error(
            "Doctor ICE error:",
            error
          );
        }
      };

    // ---------------------------------------------------
    // LISTEN FOR PATIENT ANSWER
    // ---------------------------------------------------

    roomUnsubscribeRef.current =
      onSnapshot(
        roomRef,
        async (snapshot) => {
          const data =
            snapshot.data();

          if (!data) {
            return;
          }

          // Patient joined and created answer.
          if (
            data.answer &&
            !peerConnection
              .currentRemoteDescription
          ) {
            console.log(
              "DOCTOR: PATIENT ANSWER RECEIVED"
            );

            try {
              await peerConnection.setRemoteDescription(
                new RTCSessionDescription(
                  data.answer
                )
              );

              await addPendingCandidates(
                peerConnection
              );

              console.log(
                "DOCTOR: REMOTE DESCRIPTION SET"
              );
            } catch (error) {
              console.error(
                "Doctor answer error:",
                error
              );
            }
          }
        }
      );

    // ---------------------------------------------------
    // LISTEN FOR PATIENT ICE
    // ---------------------------------------------------

    candidateUnsubscribeRef.current =
      onSnapshot(
        patientCandidatesRef,
        async (snapshot) => {
          for (const change of snapshot.docChanges()) {
            if (
              change.type !== "added"
            ) {
              continue;
            }

            const candidate =
              new RTCIceCandidate(
                change.doc.data()
              );

            /*
              If remote description is not ready,
              keep candidate temporarily.
            */

            if (
              !peerConnection
                .remoteDescription
            ) {
              pendingCandidatesRef.current.push(
                candidate
              );

              continue;
            }

            try {
              await peerConnection.addIceCandidate(
                candidate
              );

              console.log(
                "DOCTOR: PATIENT ICE ADDED"
              );
            } catch (error) {
              console.error(
                "Doctor ICE error:",
                error
              );
            }
          }
        }
      );

    // ---------------------------------------------------
    // CREATE OFFER
    // ---------------------------------------------------

    const offer =
      await peerConnection.createOffer();

    await peerConnection.setLocalDescription(
      offer
    );

    await setDoc(
      roomRef,
      {
        requestId,

        offer: {
          type: offer.type,
          sdp: offer.sdp,
        },

        status: "doctor-ready",

        updatedAt:
          new Date(),
      },
      {
        merge: true,
      }
    );

    console.log(
      "DOCTOR: OFFER SENT"
    );
  };

  // =====================================================
  // PATIENT
  // =====================================================

  const startPatientCall = async (
    stream
  ) => {
    console.log(
      "================================"
    );

    console.log(
      "PATIENT WAITING FOR DOCTOR"
    );

    console.log(
      "REQUEST:",
      requestId
    );

    console.log(
      "================================"
    );

    const peerConnection =
      createPeerConnection(
        stream
      );

    const roomRef = doc(
      db,
      "video_rooms",
      requestId
    );

    const doctorCandidatesRef =
      collection(
        roomRef,
        "doctorCandidates"
      );

    const patientCandidatesRef =
      collection(
        roomRef,
        "patientCandidates"
      );

    // ---------------------------------------------------
    // PATIENT ICE
    // ---------------------------------------------------

    peerConnection.onicecandidate =
      async (event) => {
        if (!event.candidate) {
          return;
        }

        try {
          await addDoc(
            patientCandidatesRef,
            event.candidate.toJSON()
          );

          console.log(
            "PATIENT ICE CANDIDATE SENT"
          );
        } catch (error) {
          console.error(
            "Patient ICE error:",
            error
          );
        }
      };

    // ---------------------------------------------------
    // LISTEN FOR DOCTOR OFFER
    // ---------------------------------------------------

    roomUnsubscribeRef.current =
      onSnapshot(
        roomRef,
        async (snapshot) => {
          const data =
            snapshot.data();

          if (!data?.offer) {
            return;
          }

          if (
            peerConnection
              .currentRemoteDescription
          ) {
            return;
          }

          console.log(
            "PATIENT: DOCTOR OFFER RECEIVED"
          );

          try {
            await peerConnection.setRemoteDescription(
              new RTCSessionDescription(
                data.offer
              )
            );

            console.log(
              "PATIENT: DOCTOR DESCRIPTION SET"
            );

            await addPendingCandidates(
              peerConnection
            );

            // ------------------------------------------------
            // CREATE ANSWER
            // ------------------------------------------------

            const answer =
              await peerConnection.createAnswer();

            await peerConnection.setLocalDescription(
              answer
            );

            await updateDoc(
              roomRef,
              {
                answer: {
                  type: answer.type,
                  sdp: answer.sdp,
                },

                status: "connected",

                updatedAt:
                  new Date(),
              }
            );

            console.log(
              "PATIENT: ANSWER SENT"
            );

          } catch (error) {
            console.error(
              "Patient offer error:",
              error
            );
          }
        }
      );

    // ---------------------------------------------------
    // LISTEN FOR DOCTOR ICE
    // ---------------------------------------------------

    candidateUnsubscribeRef.current =
      onSnapshot(
        doctorCandidatesRef,
        async (snapshot) => {
          for (const change of snapshot.docChanges()) {
            if (
              change.type !== "added"
            ) {
              continue;
            }

            const candidate =
              new RTCIceCandidate(
                change.doc.data()
              );

            if (
              !peerConnection
                .remoteDescription
            ) {
              pendingCandidatesRef.current.push(
                candidate
              );

              continue;
            }

            try {
              await peerConnection.addIceCandidate(
                candidate
              );

              console.log(
                "PATIENT: DOCTOR ICE ADDED"
              );
            } catch (error) {
              console.error(
                "Patient ICE error:",
                error
              );
            }
          }
        }
      );
  };

  // =====================================================
  // JOIN AUTOMATICALLY
  // =====================================================

  const joinConsultation =
    async () => {
      if (startedRef.current) {
        return;
      }

      startedRef.current = true;

      if (!requestId) {
        setError(
          "Consultation request is missing."
        );

        setJoining(false);

        return;
      }

      console.log(
        "================================"
      );

      console.log(
        "JOINING CONSULTATION"
      );

      console.log(
        "ROLE:",
        role
      );

      console.log(
        "REQUEST ID:",
        requestId
      );

      console.log(
        "================================"
      );

      setJoining(true);
      setError("");

      const stream =
        await startCamera();

      if (!stream) {
        setJoining(false);

        /*
          Allow the user to retry permission
          without leaving the consultation.
        */

        startedRef.current = false;

        return;
      }

      setJoined(true);

      try {
        if (role === "doctor") {
          await startDoctorCall(
            stream
          );
        } else {
          await startPatientCall(
            stream
          );
        }
      } catch (error) {
        console.error(
          "Unable to join consultation:",
          error
        );

        setError(
          "Unable to join the consultation. Please try again."
        );
      }

      setJoining(false);
    };

  // =====================================================
  // AUTOMATICALLY START WHEN PAGE OPENS
  // =====================================================

  useEffect(() => {
    joinConsultation();

    return () => {
      cleanupCall();
    };
  }, []);

  // =====================================================
  // CAMERA
  // =====================================================

  const toggleCamera = () => {
    if (!localStreamRef.current) {
      return;
    }

    const videoTrack =
      localStreamRef.current.getVideoTracks()[0];

    if (!videoTrack) {
      return;
    }

    videoTrack.enabled =
      !videoTrack.enabled;

    setCameraOn(
      videoTrack.enabled
    );
  };

  // =====================================================
  // MICROPHONE
  // =====================================================

  const toggleMic = () => {
    if (!localStreamRef.current) {
      return;
    }

    const audioTrack =
      localStreamRef.current.getAudioTracks()[0];

    if (!audioTrack) {
      return;
    }

    audioTrack.enabled =
      !audioTrack.enabled;

    setMicOn(
      audioTrack.enabled
    );
  };

  // =====================================================
  // END CONSULTATION
  // =====================================================

  const endCall = () => {
    cleanupCall();

    if (role === "doctor") {
      navigate(
        "/doctor/dashboard"
      );
    } else {
      navigate(
        `/consultation-status/${requestId}`
      );
    }
  };

  // =====================================================
  // LOADING SCREEN
  // =====================================================

  if (!joined) {
    return (
      <div className="video-consultation-page">

        <header className="video-header">

          <div>

            <span>
              SECURE VIDEO CONSULTATION
            </span>

            <h1>
              Doctor Consultation
            </h1>

            <p>
              {error
                ? error
                : role === "doctor"
                ? "Joining your consultation..."
                : "Joining your consultation..."}
            </p>

          </div>

          <div className="video-role">
            {role === "doctor"
              ? "Doctor"
              : "Patient"}
          </div>

        </header>

        <main className="video-join-container">

          <div className="video-join-card">

            <div className="video-join-icon">
              ◉
            </div>

            <h2>
              {error
                ? "Camera & microphone access needed"
                : "Joining consultation..."}
            </h2>

            <p>
              {error
                ? "Please allow camera and microphone access in your browser, then try again."
                : "Preparing your secure video consultation."}
            </p>

            {error && (
              <button
                className="join-consultation-button"
                onClick={() => {
                  startedRef.current = false;
                  joinConsultation();
                }}
                disabled={joining}
              >
                {joining
                  ? "Trying again..."
                  : "Try Again"}
              </button>
            )}

          </div>

        </main>

      </div>
    );
  }

  // =====================================================
  // VIDEO CONSULTATION SCREEN
  // =====================================================

  return (
    <div className="video-consultation-page">

      {/* =================================================
          HEADER
      ================================================= */}

      <header className="video-header">

        <div>

          <span>
            SECURE VIDEO CONSULTATION
          </span>

          <h1>
            Doctor Consultation
          </h1>

          <p>
            {connected
              ? "Connected securely"
              : role === "doctor"
              ? "Waiting for patient to connect..."
              : "Waiting for doctor to connect..."}
          </p>

        </div>

        <div className="video-role">
          {role === "doctor"
            ? "Doctor"
            : "Patient"}
        </div>

      </header>


      {/* =================================================
          VIDEO AREA
      ================================================= */}

      <main className="video-container">

        <div className="video-main">

          {/* =================================================
              REMOTE VIDEO
          ================================================= */}

          <div className="remote-video">

            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
            />

            {!connected && (
              <div className="video-placeholder">

                <div className="video-placeholder-icon">
                  ◉
                </div>

                <h2>
                  Waiting for participant
                </h2>

                <p>
                  {role === "doctor"
                    ? "Waiting for the patient to join..."
                    : "Waiting for the doctor to join..."}
                </p>

              </div>
            )}

            <div className="participant-label">
              {role === "doctor"
                ? "Patient"
                : "Doctor"}
            </div>

          </div>


          {/* =================================================
              LOCAL VIDEO
          ================================================= */}

          <div className="local-video">

            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
            />

            {!cameraOn && (
              <div className="camera-off">
                Camera Off
              </div>
            )}

            <span>
              You
            </span>

          </div>

        </div>


        {/* =================================================
            CONTROLS
        ================================================= */}

        <div className="video-controls">

          <button
            className={
              micOn
                ? "video-control"
                : "video-control off"
            }
            onClick={toggleMic}
          >
            {micOn
              ? "Mute"
              : "Unmute"}
          </button>


          <button
            className={
              cameraOn
                ? "video-control"
                : "video-control off"
            }
            onClick={toggleCamera}
          >
            {cameraOn
              ? "Camera Off"
              : "Camera On"}
          </button>


          <button
            className="end-call-button"
            onClick={endCall}
          >
            End Consultation
          </button>

        </div>

      </main>

    </div>
  );
}

export default VideoConsultation;