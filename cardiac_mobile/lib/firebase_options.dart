import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart'
    show defaultTargetPlatform, kIsWeb, TargetPlatform;

/// Firebase configuration for the CardioCare patient app.
///
/// This points at the SAME Firebase project as the React app in
/// `cardiac/`, which is the whole point: one Authentication instance,
/// one Firestore database, one set of security rules. A patient who
/// signs up on the phone is the same user the doctor sees on the web.
///
/// Values come from `--dart-define` so they are not committed:
///
///   flutter run \
///     --dart-define=FIREBASE_API_KEY=... \
///     --dart-define=FIREBASE_APP_ID=... \
///     --dart-define=FIREBASE_SENDER_ID=... \
///     --dart-define=FIREBASE_PROJECT_ID=...
///
/// Easier: put them in a JSON file and use
/// `--dart-define-from-file=firebase.local.json` (git-ignored).
/// See `firebase.example.json`.
///
/// Note: Firebase client config is not secret. It ships inside every
/// app binary and is safe to expose. What protects the data is
/// firestore.rules. These live here so dev and production projects can
/// be swapped without editing code.
class DefaultFirebaseOptions {
  static const String _apiKey = String.fromEnvironment('FIREBASE_API_KEY');
  static const String _appId = String.fromEnvironment('FIREBASE_APP_ID');
  static const String _senderId = String.fromEnvironment('FIREBASE_SENDER_ID');
  static const String _projectId = String.fromEnvironment('FIREBASE_PROJECT_ID');

  static const String _androidAppId =
      String.fromEnvironment('FIREBASE_ANDROID_APP_ID');

  static const String _iosAppId =
      String.fromEnvironment('FIREBASE_IOS_APP_ID');

  static const String _iosBundleId = String.fromEnvironment(
    'FIREBASE_IOS_BUNDLE_ID',
    defaultValue: 'com.cardiocare.cardiacMobile',
  );

  static bool get isConfigured {
    final sharedValuesPresent =
        _apiKey.isNotEmpty && _projectId.isNotEmpty && _senderId.isNotEmpty;

    final platformAppIdPresent = switch (defaultTargetPlatform) {
      TargetPlatform.android => _androidAppId.isNotEmpty,
      TargetPlatform.iOS => _iosAppId.isNotEmpty,
      _ => _appId.isNotEmpty,
    };

    return sharedValuesPresent && platformAppIdPresent;
  }

  /// Explains what is missing, so a blank screen never has to be guessed at.
  static String get configurationHelp =>
      'Firebase is not configured.\n\n'
      'Copy firebase.example.json to firebase.local.json, fill in the values '
      'from the authorized Firebase project (use a separate app ID for each '
      'platform), then '
      'run:\n\n'
      '  flutter run --dart-define-from-file=firebase.local.json';

  static FirebaseOptions get currentPlatform {
    if (!isConfigured) {
      throw StateError(configurationHelp);
    }

    if (kIsWeb) {
      return FirebaseOptions(
        apiKey: _apiKey,
        appId: _appId,
        messagingSenderId: _senderId,
        projectId: _projectId,
        authDomain: '$_projectId.firebaseapp.com',
        storageBucket: '$_projectId.firebasestorage.app',
      );
    }

    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return FirebaseOptions(
          apiKey: _apiKey,
          appId: _androidAppId,
          messagingSenderId: _senderId,
          projectId: _projectId,
          storageBucket: '$_projectId.firebasestorage.app',
        );

      case TargetPlatform.iOS:
        return FirebaseOptions(
          apiKey: _apiKey,
          appId: _iosAppId,
          messagingSenderId: _senderId,
          projectId: _projectId,
          storageBucket: '$_projectId.firebasestorage.app',
          iosBundleId: _iosBundleId,
        );

      default:
        throw UnsupportedError(
          'CardioCare mobile supports Android, iOS and web. '
          '$defaultTargetPlatform is not configured.',
        );
    }
  }
}
