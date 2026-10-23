import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

import 'prediction_service.dart';

/// =====================================================================
/// FIRESTORE SERVICE
/// =====================================================================
///
/// Every collection name, field name and status value here matches the
/// React app in `cardiac/` exactly. Both clients read and write the
/// same documents, so a drift in either would silently break the other.
///
/// Statuses are always lowercase. Some legacy records were written as
/// "PENDING", so every read normalises.
/// =====================================================================

String normaliseStatus(Object? status) =>
    status is String ? status.toLowerCase() : 'pending';

class FirestoreService {
  FirestoreService({FirebaseFirestore? firestore, FirebaseAuth? auth})
      : _db = firestore ?? FirebaseFirestore.instance,
        _auth = auth ?? FirebaseAuth.instance;

  final FirebaseFirestore _db;
  final FirebaseAuth _auth;

  User get _requireUser {
    final user = _auth.currentUser;

    if (user == null) {
      throw StateError('You must be signed in.');
    }

    return user;
  }

  // -------------------------------------------------------------------
  // PROFILE
  // -------------------------------------------------------------------

  /// Created at signup. The security rules grant a doctor read access
  /// to users/{patientUid} through a care link, so this document has to
  /// exist for the doctor to see the patient's name at all.
  Future<void> ensureProfile({String? name}) async {
    final user = _requireUser;
    final ref = _db.collection('users').doc(user.uid);

    final existing = await ref.get();

    if (existing.exists) return;

    await ref.set({
      'uid': user.uid,
      'email': user.email,
      'name': name ?? user.displayName ?? '',
      'role': 'patient',
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  // -------------------------------------------------------------------
  // RISK ASSESSMENTS
  // -------------------------------------------------------------------

  /// Stores exactly what was sent to the model alongside exactly what
  /// came back. Assessments are immutable once written - the rules
  /// refuse every update and delete.
  Future<String> saveAssessment({
    required Map<String, int> features,
    required RiskResult result,
    List<String> emergencySymptoms = const [],
  }) async {
    final user = _requireUser;

    final doc = await _db.collection('risk_assessments').add({
      'uid': user.uid,
      'features': features,
      ...result.toFirestore(),
      'emergencySymptoms': emergencySymptoms,
      'source': 'mobile',
      'createdAt': FieldValue.serverTimestamp(),
    });

    return doc.id;
  }

  /// Query by uid so the database only ever returns this user's records.
  /// Sorting happens here rather than in the query because combining
  /// where() with orderBy() on a different field needs a composite index.
  Future<List<Map<String, dynamic>>> myAssessments() async {
    final user = _requireUser;

    final snapshot = await _db
        .collection('risk_assessments')
        .where('uid', isEqualTo: user.uid)
        .get();

    final records = snapshot.docs
        .map((d) => {'id': d.id, ...d.data()})
        .toList();

    records.sort(_newestFirst);

    return records;
  }

  // -------------------------------------------------------------------
  // DOCTORS AND HOSPITALS
  // -------------------------------------------------------------------

  /// A Firebase Auth uid is 28 chars; a Firestore auto-id is 20.
  /// A doctor record without a linked Auth account can never accept a
  /// consultation, so the UI must not offer it.
  static bool isAuthUid(String? id) =>
      id != null && RegExp(r'^[A-Za-z0-9]{28}$').hasMatch(id);

  static String? doctorUidOf(Map<String, dynamic> doctor) {
    final uid = doctor['uid'] as String?;

    if (uid != null && uid.isNotEmpty) return uid;
    if (isAuthUid(doctor['id'] as String?)) return doctor['id'] as String;

    return null;
  }

  Future<List<Map<String, dynamic>>> hospitals() async {
    final snapshot = await _db.collection('hospitals').get();

    return snapshot.docs.map((d) => {'id': d.id, ...d.data()}).toList();
  }

  Future<List<Map<String, dynamic>>> doctorsForHospital(
      String hospitalId) async {
    final snapshot = await _db
        .collection('doctors')
        .where('hospitalId', isEqualTo: hospitalId)
        .get();

    return snapshot.docs.map((d) => {'id': d.id, ...d.data()}).toList();
  }

  // -------------------------------------------------------------------
  // CONSULTATIONS
  // -------------------------------------------------------------------

  Future<String> requestConsultation({
    required Map<String, dynamic> doctor,
    required Map<String, dynamic> hospital,
    required String city,
    required String risk,
    required Map<String, int> features,
    String? assessmentId,
    int fee = 500,
  }) async {
    final user = _requireUser;

    final doctorUid = doctorUidOf(doctor);

    if (doctorUid == null) {
      throw StateError(
        'This doctor is not yet available for online consultations. '
        'Please choose another doctor.',
      );
    }

    final profile = await _db.collection('users').doc(user.uid).get();

    final doc = await _db.collection('consultation_requests').add({
      'patientId': user.uid,
      'patientEmail': user.email ?? '',
      'patientName':
          (profile.data()?['name'] as String?)?.trim().isNotEmpty == true
              ? profile.data()!['name']
              : (user.displayName ?? 'Patient'),

      'doctorId': doctorUid,
      'doctorName': doctor['name'] ?? '',
      'doctorEmail': doctor['email'] ?? '',

      'hospitalId': hospital['id'] ?? '',
      'hospitalName': hospital['name'] ?? '',
      'city': city,

      'risk': risk,
      'report': features,
      'assessmentId': assessmentId,

      'fee': (doctor['fee'] as num?)?.toInt() ?? fee,
      'paymentStatus': 'unpaid',

      'status': 'pending',
      'source': 'mobile',

      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    });

    return doc.id;
  }

  /// Live updates, so the patient sees the doctor accept without
  /// refreshing. This is the app's notification mechanism.
  Stream<List<Map<String, dynamic>>> myConsultations() {
    final user = _requireUser;

    return _db
        .collection('consultation_requests')
        .where('patientId', isEqualTo: user.uid)
        .snapshots()
        .map((snapshot) {
      final records = snapshot.docs
          .map((d) => {
                'id': d.id,
                ...d.data(),
                'status': normaliseStatus(d.data()['status']),
              })
          .toList();

      records.sort(_newestFirst);

      return records;
    });
  }

  Stream<Map<String, dynamic>?> consultation(String requestId) => _db
      .collection('consultation_requests')
      .doc(requestId)
      .snapshots()
      .map((snapshot) => snapshot.exists
          ? {
              'id': snapshot.id,
              ...snapshot.data()!,
              'status': normaliseStatus(snapshot.data()!['status']),
            }
          : null);

  Future<void> cancelConsultation(String requestId) async {
    await _db.collection('consultation_requests').doc(requestId).update({
      'status': 'cancelled',
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  // -------------------------------------------------------------------
  // PRESCRIPTIONS
  // -------------------------------------------------------------------

  /// Read-only for the patient. The rules refuse every patient write.
  Future<List<Map<String, dynamic>>> myPrescriptions() async {
    final user = _requireUser;

    final snapshot = await _db
        .collection('prescriptions')
        .where('patientId', isEqualTo: user.uid)
        .get();

    final records =
        snapshot.docs.map((d) => {'id': d.id, ...d.data()}).toList();

    records.sort(_newestFirst);

    return records;
  }

  // -------------------------------------------------------------------

  static int _newestFirst(
    Map<String, dynamic> a,
    Map<String, dynamic> b,
  ) {
    final at = (a['createdAt'] as Timestamp?)?.millisecondsSinceEpoch ?? 0;
    final bt = (b['createdAt'] as Timestamp?)?.millisecondsSinceEpoch ?? 0;

    return bt.compareTo(at);
  }
}
