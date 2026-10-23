import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';

import 'firebase_options.dart';
import 'screens/auth_screen.dart';
import 'screens/home_screen.dart';
import 'theme.dart';

/// CardioCare — patient app.
///
/// Shares one Firebase project with the React doctor portal in
/// `cardiac/`: one Authentication instance, one Firestore database,
/// one set of security rules.
void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  String? startupError;

  try {
    await Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform,
    );
  } catch (error) {
    /*
      Fail with an explanation rather than a white screen. Nine times
      out of ten this is a missing firebase.local.json.
    */
    startupError = error is StateError
        ? error.message
        : 'Firebase could not start.\n\n$error';
  }

  runApp(CardioCareApp(startupError: startupError));
}

class CardioCareApp extends StatelessWidget {
  const CardioCareApp({super.key, this.startupError});

  final String? startupError;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'CardioCare',
      debugShowCheckedModeBanner: false,
      theme: CardioTheme.build(),
      home: startupError != null
          ? _StartupError(message: startupError!)
          : const _AuthGate(),
    );
  }
}

/// Decides between the auth screen and the app, and waits for Firebase
/// to restore a session rather than racing it.
class _AuthGate extends StatelessWidget {
  const _AuthGate();

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<User?>(
      stream: FirebaseAuth.instance.authStateChanges(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }

        return snapshot.data == null ? const AuthScreen() : const HomeScreen();
      },
    );
  }
}

class _StartupError extends StatelessWidget {
  const _StartupError({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(28),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.settings_outlined,
                    size: 44, color: CardioTheme.muted),
                const SizedBox(height: 18),
                const Text(
                  'Configuration needed',
                  style: TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                    color: CardioTheme.ink,
                  ),
                ),
                const SizedBox(height: 12),
                SelectableText(
                  message,
                  style: const TextStyle(
                    fontSize: 14,
                    height: 1.65,
                    color: CardioTheme.muted,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
