import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../services/firestore_service.dart';
import '../theme.dart';

/// Login and signup in one screen.
///
/// Signing up also creates `users/{uid}` with `role: 'patient'`, which
/// the Firestore rules need in order to let a doctor see the patient's
/// name through a care link.
class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key});

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  final _formKey = GlobalKey<FormState>();

  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();

  bool _isSignUp = false;
  bool _busy = false;
  String? _error;
  String? _notice;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  /// Firebase error codes are not readable by a patient.
  String _describe(Object error) {
    if (error is! FirebaseAuthException) {
      return 'Something went wrong. Please try again.';
    }

    return switch (error.code) {
      'invalid-credential' ||
      'wrong-password' ||
      'user-not-found' =>
        'Incorrect email or password.',
      'email-already-in-use' =>
        'An account already exists with this email. Try signing in.',
      'weak-password' => 'Please choose a password of at least 6 characters.',
      'invalid-email' => 'Please enter a valid email address.',
      'too-many-requests' =>
        'Too many attempts. Please wait a moment and try again.',
      'network-request-failed' =>
        'Network problem. Check your connection and try again.',
      _ => 'Something went wrong. Please try again.',
    };
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
    });

    try {
      if (_isSignUp) {
        final credential =
            await FirebaseAuth.instance.createUserWithEmailAndPassword(
          email: _email.text.trim(),
          password: _password.text,
        );

        await credential.user?.updateDisplayName(_name.text.trim());

        await FirestoreService().ensureProfile(name: _name.text.trim());
      } else {
        await FirebaseAuth.instance.signInWithEmailAndPassword(
          email: _email.text.trim(),
          password: _password.text,
        );

        // Self-heal for accounts created before profiles existed.
        try {
          await FirestoreService().ensureProfile();
        } catch (_) {
          // Never block a login over this.
        }
      }
      // The auth gate in main.dart swaps the screen from here.
    } catch (error) {
      if (mounted) setState(() => _error = _describe(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _resetPassword() async {
    final email = _email.text.trim();

    if (email.isEmpty) {
      setState(() => _error =
          'Enter your email address first, then choose Forgot password.');
      return;
    }

    try {
      await FirebaseAuth.instance.sendPasswordResetEmail(email: email);

      // Deliberately the same message either way, so this form does not
      // reveal which email addresses are registered.
      setState(() {
        _error = null;
        _notice = 'If an account exists for that address, a password '
            'reset link is on its way.';
      });
    } catch (error) {
      setState(() => _error = _describe(error));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(26),
                  child: Form(
                    key: _formKey,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const Icon(Icons.favorite,
                            size: 40, color: CardioTheme.accent),
                        const SizedBox(height: 14),
                        Text(
                          _isSignUp ? 'Create your account' : 'CardioCare',
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            fontSize: 26,
                            fontWeight: FontWeight.w800,
                            color: CardioTheme.ink,
                          ),
                        ),
                        const SizedBox(height: 8),
                        const Text(
                          'Cardiac screening and doctor consultation',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: 14,
                            color: CardioTheme.muted,
                          ),
                        ),
                        const SizedBox(height: 26),
                        if (_isSignUp) ...[
                          TextFormField(
                            controller: _name,
                            textCapitalization: TextCapitalization.words,
                            decoration: const InputDecoration(
                              labelText: 'Full name',
                            ),
                            validator: (value) =>
                                (value == null || value.trim().isEmpty)
                                    ? 'Please enter your name'
                                    : null,
                          ),
                          const SizedBox(height: 14),
                        ],
                        TextFormField(
                          controller: _email,
                          keyboardType: TextInputType.emailAddress,
                          autocorrect: false,
                          decoration:
                              const InputDecoration(labelText: 'Email'),
                          validator: (value) {
                            final text = value?.trim() ?? '';

                            if (text.isEmpty) return 'Please enter your email';

                            if (!text.contains('@') || !text.contains('.')) {
                              return 'Please enter a valid email address';
                            }

                            return null;
                          },
                        ),
                        const SizedBox(height: 14),
                        TextFormField(
                          controller: _password,
                          obscureText: true,
                          decoration:
                              const InputDecoration(labelText: 'Password'),
                          validator: (value) {
                            if (value == null || value.isEmpty) {
                              return 'Please enter your password';
                            }

                            if (_isSignUp && value.length < 6) {
                              return 'At least 6 characters';
                            }

                            return null;
                          },
                        ),
                        if (_error != null) ...[
                          const SizedBox(height: 16),
                          _Banner(message: _error!, isError: true),
                        ],
                        if (_notice != null) ...[
                          const SizedBox(height: 16),
                          _Banner(message: _notice!, isError: false),
                        ],
                        const SizedBox(height: 22),
                        FilledButton(
                          onPressed: _busy ? null : _submit,
                          child: Text(
                            _busy
                                ? 'Please wait...'
                                : (_isSignUp ? 'Create Account' : 'Sign In'),
                          ),
                        ),
                        if (!_isSignUp) ...[
                          const SizedBox(height: 6),
                          TextButton(
                            onPressed: _busy ? null : _resetPassword,
                            child: const Text('Forgot password?'),
                          ),
                        ],
                        const SizedBox(height: 4),
                        TextButton(
                          onPressed: _busy
                              ? null
                              : () => setState(() {
                                    _isSignUp = !_isSignUp;
                                    _error = null;
                                    _notice = null;
                                  }),
                          child: Text(
                            _isSignUp
                                ? 'Already have an account? Sign in'
                                : "Don't have an account? Create one",
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.message, required this.isError});

  final String message;
  final bool isError;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: isError ? CardioTheme.highBg : CardioTheme.lowBg,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: isError
              ? const Color(0xFFF3BCBC)
              : const Color(0xFFB7DDC4),
        ),
      ),
      child: Text(
        message,
        style: TextStyle(
          fontSize: 13.5,
          height: 1.5,
          color: isError ? CardioTheme.high : CardioTheme.low,
        ),
      ),
    );
  }
}
