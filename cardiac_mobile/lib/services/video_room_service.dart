import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:permission_handler/permission_handler.dart';

/// =====================================================================
/// VIDEO ROOM SERVICE  (patient side)
/// =====================================================================
///
/// Speaks the SAME signalling protocol as
/// `cardiac/src/services/videoRoomService.js`. That is what lets a
/// patient on the phone meet a doctor on the web:
///
///   video_rooms/{requestId}
///     sessionId        identifies ONE offer
///     offer            written by the DOCTOR (always the caller)
///     answer           written by the PATIENT (always the callee)
///     answerSessionId  which offer this answer belongs to
///     patientJoinId    changes on every patient page/app load
///     status           waiting | connected | ended
///
///   video_rooms/{requestId}/doctorCandidates/*   tagged with sessionId
///   video_rooms/{requestId}/patientCandidates/*  tagged with sessionId
///
/// The doctor is always the caller. This app is always the callee, so
/// it waits for an offer and answers it.
///
/// sessionId is what makes a reload recover instead of deadlocking:
/// an answer is only accepted for the offer it actually answers, and
/// ICE candidates are filtered to their own session. Changing
/// patientJoinId tells the doctor to send a fresh offer.
/// =====================================================================
class VideoRoomService {
  VideoRoomService({FirebaseFirestore? firestore, FirebaseAuth? auth})
      : _db = firestore ?? FirebaseFirestore.instance,
        _auth = auth ?? FirebaseAuth.instance;

  final FirebaseFirestore _db;
  final FirebaseAuth _auth;

  DocumentReference<Map<String, dynamic>> roomRef(String requestId) =>
      _db.collection('video_rooms').doc(requestId);

  static String randomId() =>
      '${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}'
      '${(DateTime.now().hashCode & 0xFFFFFF).toRadixString(36)}';

  // -------------------------------------------------------------------
  // ICE CONFIGURATION
  // -------------------------------------------------------------------

  /// STUN alone only connects peers that can reach each other directly.
  /// On most mobile networks they cannot, and the call fails after
  /// appearing to almost connect. A TURN server relays the media.
  static Map<String, dynamic> iceConfiguration() {
    const turnUrl = String.fromEnvironment('TURN_URL');

    final servers = <Map<String, dynamic>>[
      {
        'urls': [
          'stun:stun.l.google.com:19302',
          'stun:stun1.l.google.com:19302',
        ],
      },
    ];

    if (turnUrl.isNotEmpty) {
      servers.add({
        'urls': turnUrl,
        'username': const String.fromEnvironment('TURN_USERNAME'),
        'credential': const String.fromEnvironment('TURN_CREDENTIAL'),
      });
    }

    return {
      'iceServers': servers,
      'sdpSemantics': 'unified-plan',
    };
  }

  static bool get hasTurn =>
      const String.fromEnvironment('TURN_URL').isNotEmpty;

  // -------------------------------------------------------------------
  // PERMISSIONS
  // -------------------------------------------------------------------

  /// On Android 6+ camera and microphone are RUNTIME permissions.
  /// Declaring them in AndroidManifest.xml is necessary but not
  /// sufficient - they must also be requested here, at point of use.
  ///
  /// Returns null when everything is granted, or a message explaining
  /// exactly what is wrong. "Permission denied" on its own is what made
  /// the web version so hard to debug, so each case is distinguished.
  Future<String?> ensurePermissions() async {
    // The browser handles its own prompt via getUserMedia.
    if (kIsWeb) return null;

    final statuses = await [Permission.camera, Permission.microphone].request();

    final camera = statuses[Permission.camera];
    final microphone = statuses[Permission.microphone];

    // Permanently denied means the OS will not prompt again; the user
    // has to change it in Settings, so say that rather than looping.
    if (camera == PermissionStatus.permanentlyDenied ||
        microphone == PermissionStatus.permanentlyDenied) {
      return 'Camera and microphone access is blocked for CardioCare.\n\n'
          'Open Settings > Apps > CardioCare > Permissions and allow '
          'Camera and Microphone, then come back and try again.';
    }

    if (camera != PermissionStatus.granted &&
        microphone != PermissionStatus.granted) {
      return 'CardioCare needs your camera and microphone for a video '
          'consultation. Please allow both and try again.';
    }

    if (microphone != PermissionStatus.granted) {
      return 'CardioCare needs your microphone so the doctor can hear you. '
          'Please allow it and try again.';
    }

    // Camera alone missing is survivable - we fall back to audio-only.
    return null;
  }

  // -------------------------------------------------------------------
  // LOCAL MEDIA
  // -------------------------------------------------------------------

  /// Returns the stream plus whether we had to drop to audio-only.
  /// A consultation with sound is far more useful than none at all.
  Future<LocalMediaResult> getLocalStream() async {
    final permissionProblem = await ensurePermissions();

    if (permissionProblem != null) {
      return LocalMediaResult(error: permissionProblem);
    }

    try {
      final stream = await navigator.mediaDevices.getUserMedia({
        'audio': true,
        'video': {
          'facingMode': 'user',
          'width': {'ideal': 640},
          'height': {'ideal': 480},
        },
      });

      return LocalMediaResult(stream: stream);
    } catch (_) {
      // Camera unavailable or in use - try audio only.
      try {
        final audioStream = await navigator.mediaDevices.getUserMedia({
          'audio': true,
          'video': false,
        });

        return LocalMediaResult(
          stream: audioStream,
          audioOnly: true,
          notice: 'Your camera could not be started, so you have joined '
              'with audio only. The doctor will still hear you.',
        );
      } catch (audioError) {
        return LocalMediaResult(
          error: 'Could not start your camera or microphone.\n\n'
              'Close any other app using them and try again.\n\n'
              'Details: $audioError',
        );
      }
    }
  }

  // -------------------------------------------------------------------
  // ACCESS CONTROL
  // -------------------------------------------------------------------

  /// The role is derived from the consultation record, never from a
  /// parameter the caller controls.
  Future<ConsultationAccess> resolveAccess(String requestId) async {
    final user = _auth.currentUser;

    if (user == null) {
      return const ConsultationAccess.denied(
        'Please sign in again to join this consultation.',
      );
    }

    final snapshot =
        await _db.collection('consultation_requests').doc(requestId).get();

    if (!snapshot.exists) {
      return const ConsultationAccess.denied(
        'This consultation no longer exists.',
      );
    }

    final data = snapshot.data()!;

    if (data['patientId'] != user.uid) {
      return const ConsultationAccess.denied(
        'You are not a participant in this consultation.',
      );
    }

    final status = (data['status'] as String? ?? '').toLowerCase();

    if (status != 'accepted') {
      return ConsultationAccess.denied(
        status == 'pending'
            ? 'The doctor has not accepted this consultation yet.'
            : 'This consultation is no longer active.',
      );
    }

    return ConsultationAccess.allowed(data);
  }

  // -------------------------------------------------------------------
  // SIGNALLING
  // -------------------------------------------------------------------

  /// A new patientJoinId tells the doctor this is a fresh join and that
  /// any previous connection is gone, so they must send a new offer.
  Future<void> markPresent(
    String requestId,
    Map<String, dynamic> request,
    String patientJoinId,
  ) async {
    await roomRef(requestId).set({
      'requestId': requestId,
      'patientId': request['patientId'],
      'doctorId': request['doctorId'],
      'patientJoinId': patientJoinId,
      'status': 'waiting',
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }

  Future<void> publishAnswer(
    String requestId,
    String sessionId,
    RTCSessionDescription answer,
  ) async {
    await roomRef(requestId).update({
      'answer': {'type': answer.type, 'sdp': answer.sdp},
      'answerSessionId': sessionId,
      'status': 'connected',
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  Future<void> addCandidate(
    String requestId,
    String sessionId,
    RTCIceCandidate candidate,
  ) async {
    await roomRef(requestId).collection('patientCandidates').add({
      'candidate': candidate.candidate,
      'sdpMid': candidate.sdpMid,
      'sdpMLineIndex': candidate.sdpMLineIndex,
      'sessionId': sessionId,
      'createdAt': FieldValue.serverTimestamp(),
    });
  }

  /// Only the doctor's candidates for THIS session. Filtering by
  /// sessionId is what stops candidates left over from an earlier
  /// attempt being fed into a fresh connection.
  Stream<QuerySnapshot<Map<String, dynamic>>> doctorCandidates(
    String requestId,
    String sessionId,
  ) =>
      roomRef(requestId)
          .collection('doctorCandidates')
          .where('sessionId', isEqualTo: sessionId)
          .snapshots();

  Stream<DocumentSnapshot<Map<String, dynamic>>> roomUpdates(
          String requestId) =>
      roomRef(requestId).snapshots();

  Future<void> markEnded(String requestId) async {
    try {
      await roomRef(requestId).update({
        'status': 'ended',
        'endedBy': 'patient',
        'endedAt': FieldValue.serverTimestamp(),
        'updatedAt': FieldValue.serverTimestamp(),
      });
    } catch (_) {
      // Leaving a call must never surface an error - the user has gone.
    }
  }
}

class LocalMediaResult {
  const LocalMediaResult({
    this.stream,
    this.audioOnly = false,
    this.error,
    this.notice,
  });

  final MediaStream? stream;
  final bool audioOnly;
  final String? error;
  final String? notice;

  bool get ok => stream != null;
}

class ConsultationAccess {
  const ConsultationAccess.allowed(this.request)
      : isAllowed = true,
        message = null;

  const ConsultationAccess.denied(this.message)
      : isAllowed = false,
        request = null;

  final bool isAllowed;
  final String? message;
  final Map<String, dynamic>? request;
}
