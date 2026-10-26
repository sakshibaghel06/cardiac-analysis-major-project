import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../services/firestore_service.dart';
import '../theme.dart';

class DoctorListScreen extends StatefulWidget {
  const DoctorListScreen({
    super.key,
    required this.risk,
    required this.features,
    this.assessmentId,
  });

  final String risk;
  final Map<String, int> features;
  final String? assessmentId;

  @override
  State<DoctorListScreen> createState() => _DoctorListScreenState();
}

class _DoctorListScreenState extends State<DoctorListScreen> {
  final _service = FirestoreService();

  late Future<List<Map<String, dynamic>>> _hospitals;
  Future<List<Map<String, dynamic>>>? _doctors;
  String? _hospitalId;
  String? _doctorId;
  String? _error;
  bool _sending = false;

  static const _defaultFee = int.fromEnvironment(
    'DEFAULT_CONSULTATION_FEE',
    defaultValue: 500,
  );

  @override
  void initState() {
    super.initState();
    _hospitals = _service.hospitals();
  }

  void _loadDoctors(String hospitalId) {
    setState(() {
      _hospitalId = hospitalId;
      _doctorId = null;
      _error = null;
      _doctors = _service.doctorsForHospital(hospitalId);
    });
  }

  Future<void> _request(
    Map<String, dynamic> hospital,
    List<Map<String, dynamic>> doctors,
  ) async {
    if (_doctorId == null) return;

    final doctor = doctors.firstWhere((item) => item['id'] == _doctorId);
    final location =
        hospital['location']?.toString() ?? hospital['city']?.toString() ?? '';

    setState(() {
      _sending = true;
      _error = null;
    });

    try {
      await _service.requestConsultation(
        doctor: doctor,
        hospital: hospital,
        city: location,
        risk: widget.risk,
        features: widget.features,
        assessmentId: widget.assessmentId,
        fee: (doctor['fee'] as num?)?.toInt() ?? _defaultFee,
      );

      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Consultation request sent.')),
      );
      Navigator.of(context).popUntil((route) => route.isFirst);
    } catch (error) {
      if (mounted) {
        setState(
          () => _error = error is FirebaseException
              ? error.message ?? 'Could not send the consultation request.'
              : error.toString(),
        );
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Choose a doctor')),
      body: FutureBuilder<List<Map<String, dynamic>>>(
        future: _hospitals,
        builder: (context, snapshot) {
          if (snapshot.hasError) {
            return _ErrorState(
              message: 'Could not load hospitals: ${snapshot.error}',
              onRetry: () => setState(() => _hospitals = _service.hospitals()),
            );
          }
          if (!snapshot.hasData) {
            return const Center(child: CircularProgressIndicator());
          }

          final hospitals = snapshot.data!;
          Map<String, dynamic>? hospital;
          for (final item in hospitals) {
            if (item['id'] == _hospitalId) {
              hospital = item;
              break;
            }
          }

          if (hospitals.isEmpty) {
            return const Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Text(
                  'No hospitals are available. Please try again later.',
                  textAlign: TextAlign.center,
                ),
              ),
            );
          }

          return ListView(
            padding: const EdgeInsets.all(20),
            children: [
              const Text(
                'Your risk estimate and the health values you entered will '
                'be shared with the selected doctor.',
                style: TextStyle(height: 1.5, color: CardioTheme.muted),
              ),
              const SizedBox(height: 18),
              DropdownButtonFormField<String>(
                initialValue: _hospitalId,
                decoration: const InputDecoration(labelText: 'Hospital'),
                items: hospitals
                    .map(
                      (item) => DropdownMenuItem<String>(
                        value: item['id'] as String,
                        child: Text(
                          item['name']?.toString() ?? 'Hospital',
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    )
                    .toList(),
                onChanged: (value) {
                  if (value != null) _loadDoctors(value);
                },
              ),
              if (hospital != null) ...[
                const SizedBox(height: 20),
                Text(
                  'Doctors at ${hospital['name'] ?? 'this hospital'}',
                  style: const TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w700,
                    color: CardioTheme.ink,
                  ),
                ),
                const SizedBox(height: 10),
                _doctorChoices(),
              ],
              if (_error != null) ...[
                const SizedBox(height: 14),
                Text(_error!, style: const TextStyle(color: CardioTheme.high)),
              ],
              const SizedBox(height: 18),
              FilledButton(
                onPressed:
                    hospital == null ||
                        _doctorId == null ||
                        _sending ||
                        _doctors == null
                    ? null
                    : () async {
                        final doctors = await _doctors!;
                        if (mounted) await _request(hospital!, doctors);
                      },
                child: _sending
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Text('Send consultation request'),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _doctorChoices() {
    final doctorsFuture = _doctors;
    if (doctorsFuture == null) {
      return const Text('Select a hospital to view its available doctors.');
    }

    return FutureBuilder<List<Map<String, dynamic>>>(
      future: doctorsFuture,
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return _ErrorState(
            message: 'Could not load doctors: ${snapshot.error}',
            onRetry: () {
              final hospitalId = _hospitalId;
              if (hospitalId != null) _loadDoctors(hospitalId);
            },
          );
        }
        if (!snapshot.hasData) {
          return const Padding(
            padding: EdgeInsets.all(16),
            child: Center(child: CircularProgressIndicator()),
          );
        }

        final doctors = snapshot.data!
            .where(
              (doctor) =>
                  doctor['available'] != false &&
                  doctor['supersededBy'] == null &&
                  FirestoreService.doctorUidOf(doctor) != null,
            )
            .toList();

        if (doctors.isEmpty) {
          return const Card(
            child: Padding(
              padding: EdgeInsets.all(16),
              child: Text(
                'No doctors are currently available for online consultations.',
              ),
            ),
          );
        }

        return RadioGroup<String>(
          groupValue: _doctorId,
          onChanged: (value) => setState(() {
            _doctorId = value;
            _error = null;
          }),
          child: Column(
            children: doctors.map((doctor) {
              final id = doctor['id'] as String;
              final fee = (doctor['fee'] as num?)?.toInt() ?? _defaultFee;
              final speciality = doctor['speciality']?.toString();

              return Card(
                margin: const EdgeInsets.only(bottom: 8),
                child: RadioListTile<String>(
                  value: id,
                  title: Text(doctor['name']?.toString() ?? 'Doctor'),
                  subtitle: Text(
                    '${speciality == null || speciality.isEmpty ? 'Cardiologist' : speciality}'
                    ' · ₹$fee',
                  ),
                ),
              );
            }).toList(),
          ),
        );
      },
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(message, textAlign: TextAlign.center),
          const SizedBox(height: 12),
          OutlinedButton(onPressed: onRetry, child: const Text('Retry')),
        ],
      ),
    ),
  );
}
