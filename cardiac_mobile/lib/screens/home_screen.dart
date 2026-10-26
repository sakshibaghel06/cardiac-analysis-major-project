import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../services/firestore_service.dart';
import '../theme.dart';
import 'risk_assessment_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _service = FirestoreService();

  late Future<List<Map<String, dynamic>>> _assessments;
  late Future<List<Map<String, dynamic>>> _prescriptions;
  late Stream<List<Map<String, dynamic>>> _consultations;
  bool _signingOut = false;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  void _reload() {
    _assessments = _service.myAssessments();
    _prescriptions = _service.myPrescriptions();
    _consultations = _service.myConsultations();
  }

  Future<void> _signOut() async {
    setState(() => _signingOut = true);

    try {
      await FirebaseAuth.instance.signOut();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not sign out: $error')),
        );
      }
    } finally {
      if (mounted) setState(() => _signingOut = false);
    }
  }

  Future<void> _startAssessment() async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute(builder: (_) => const RiskAssessmentScreen()),
    );

    if (mounted) setState(_reload);
  }

  @override
  Widget build(BuildContext context) {
    final name = FirebaseAuth.instance.currentUser?.displayName?.trim();

    return Scaffold(
      appBar: AppBar(
        title: const Text('CardioCare'),
        actions: [
          IconButton(
            tooltip: 'Sign out',
            onPressed: _signingOut ? null : _signOut,
            icon: _signingOut
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.logout),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text(
            name == null || name.isEmpty ? 'Your heart health' : 'Hello, $name',
            style: const TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.w800,
              color: CardioTheme.ink,
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            'Use the screening as decision support, not as a diagnosis or '
            'a replacement for medical care.',
            style: TextStyle(height: 1.5, color: CardioTheme.muted),
          ),
          const SizedBox(height: 20),
          FilledButton.icon(
            onPressed: _startAssessment,
            icon: const Icon(Icons.monitor_heart_outlined),
            label: const Text('Start risk assessment'),
          ),
          const SizedBox(height: 24),
          _sectionTitle('Latest assessment'),
          const SizedBox(height: 10),
          FutureBuilder<List<Map<String, dynamic>>>(
            future: _assessments,
            builder: (context, snapshot) {
              if (snapshot.hasError) {
                return const _LoadError(
                  message: 'Could not load your assessments.',
                );
              }
              if (!snapshot.hasData) {
                return const _LoadingCard();
              }

              final records = snapshot.data!;
              if (records.isEmpty) {
                return const _InfoCard(
                  message: 'Your completed assessments will appear here.',
                );
              }

              final latest = records.first;
              final risk = latest['risk']?.toString().toUpperCase() ?? 'UNKNOWN';
              final probability = latest['probability'];

              return Card(
                child: ListTile(
                  leading: Icon(
                    Icons.favorite,
                    color: CardioTheme.riskColour(risk),
                  ),
                  title: Text('$risk estimated risk'),
                  subtitle: Text(
                    probability is num
                        ? 'Model probability: '
                            '${(probability * 100).toStringAsFixed(1)}%'
                        : 'Model estimate saved',
                  ),
                ),
              );
            },
          ),
          const SizedBox(height: 20),
          _sectionTitle('Consultations'),
          const SizedBox(height: 10),
          StreamBuilder<List<Map<String, dynamic>>>(
            stream: _consultations,
            builder: (context, snapshot) {
              if (snapshot.hasError) {
                return const _LoadError(
                  message: 'Could not load consultations.',
                );
              }
              if (!snapshot.hasData) {
                return const _LoadingCard();
              }

              final requests = snapshot.data!;
              if (requests.isEmpty) {
                return const _InfoCard(
                  message: 'You do not have any consultation requests yet.',
                );
              }

              return Column(
                children: requests.take(3).map((request) {
                  final doctor = request['doctorName']?.toString();
                  final status = request['status']?.toString() ?? 'pending';
                  return Card(
                    margin: const EdgeInsets.only(bottom: 8),
                    child: ListTile(
                      leading: const Icon(
                        Icons.medical_services_outlined,
                        color: CardioTheme.accent,
                      ),
                      title: Text(
                        doctor == null || doctor.isEmpty
                            ? 'Doctor consultation'
                            : doctor,
                      ),
                      subtitle: Text('Status: $status'),
                    ),
                  );
                }).toList(),
              );
            },
          ),
          const SizedBox(height: 20),
          _sectionTitle('Prescriptions'),
          const SizedBox(height: 10),
          FutureBuilder<List<Map<String, dynamic>>>(
            future: _prescriptions,
            builder: (context, snapshot) {
              if (snapshot.hasError) {
                return const _LoadError(
                  message: 'Could not load prescriptions.',
                );
              }
              if (!snapshot.hasData) {
                return const _LoadingCard();
              }
              return _InfoCard(
                message: snapshot.data!.isEmpty
                    ? 'No prescriptions have been issued to you yet.'
                    : '${snapshot.data!.length} prescription(s) are available '
                        'in your account.',
              );
            },
          ),
        ],
      ),
    );
  }

  Widget _sectionTitle(String value) => Text(
        value,
        style: const TextStyle(
          fontSize: 17,
          fontWeight: FontWeight.w700,
          color: CardioTheme.ink,
        ),
      );
}

class _LoadingCard extends StatelessWidget {
  const _LoadingCard();

  @override
  Widget build(BuildContext context) => const Card(
        child: Padding(
          padding: EdgeInsets.all(20),
          child: Center(child: CircularProgressIndicator()),
        ),
      );
}

class _InfoCard extends StatelessWidget {
  const _InfoCard({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Text(message, style: const TextStyle(height: 1.5)),
        ),
      );
}

class _LoadError extends StatelessWidget {
  const _LoadError({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Text(message, style: const TextStyle(color: CardioTheme.high)),
        ),
      );
}
