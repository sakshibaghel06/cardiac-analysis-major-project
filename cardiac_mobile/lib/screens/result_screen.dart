import 'package:flutter/material.dart';

import '../services/prediction_service.dart';
import '../theme.dart';
import 'doctor_list_screen.dart';

/// Shows the model's estimate.
///
/// Wording matters here. The model predicts the likelihood of
/// significant coronary narrowing; it does not diagnose. So this screen
/// says "Estimated cardiovascular risk", never "You have heart disease",
/// and it never presents a Low result as reassurance — measured recall
/// is about 0.69, so roughly three in ten true cases are missed.
class ResultScreen extends StatelessWidget {
  const ResultScreen({
    super.key,
    required this.result,
    required this.features,
    this.emergencySymptoms = const [],
  });

  final RiskResult result;
  final Map<String, int> features;
  final List<String> emergencySymptoms;

  String get _headline => switch (result.risk.toUpperCase()) {
        'LOW' => 'Lower estimated risk',
        'HIGH' => 'Higher estimated risk',
        _ => 'Moderate estimated risk',
      };

  String get _explanation => switch (result.risk.toUpperCase()) {
        'LOW' =>
          'Based on the values you entered, the model estimates a lower '
              'likelihood of significant coronary artery narrowing.\n\n'
              'This is not an all-clear. The model misses roughly three in '
              'ten cases that do have narrowing, so if you have symptoms or '
              'concerns, speak to a doctor regardless of this result.',
        'HIGH' =>
          'Based on the values you entered, the model estimates a higher '
              'likelihood of significant coronary artery narrowing.\n\n'
              'This is not a diagnosis. It means a conversation with a '
              'doctor would be worthwhile so they can decide whether any '
              'further tests are needed.',
        _ =>
          'The model cannot place your result clearly in either the lower '
              'or higher band — it sits in between.\n\n'
              'A doctor can interpret this alongside your history and '
              'anything the model does not see.',
      };

  @override
  Widget build(BuildContext context) {
    final colour = CardioTheme.riskColour(result.risk);
    final background = CardioTheme.riskBackground(result.risk);

    return Scaffold(
      appBar: AppBar(title: const Text('Your Result')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            if (emergencySymptoms.isNotEmpty) ...[
              Container(
                padding: const EdgeInsets.all(18),
                decoration: BoxDecoration(
                  color: CardioTheme.highBg,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: const Color(0xFFE8A5A5)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Row(
                      children: [
                        Icon(Icons.warning_amber_rounded,
                            color: CardioTheme.high),
                        SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            'Seek emergency medical help now',
                            style: TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w800,
                              color: CardioTheme.high,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    Text(
                      'You reported: ${emergencySymptoms.join(', ')}.\n\n'
                      'Call your local emergency number or go to the nearest '
                      'emergency department. Do not rely on this assessment.',
                      style: const TextStyle(
                        fontSize: 13.5,
                        height: 1.6,
                        color: Color(0xFF8F3B3B),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),
            ],

            // ---- the estimate ----
            Container(
              padding: const EdgeInsets.all(26),
              decoration: BoxDecoration(
                color: background,
                borderRadius: BorderRadius.circular(20),
              ),
              child: Column(
                children: [
                  const Text(
                    'ESTIMATED CARDIOVASCULAR RISK',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 1.4,
                      color: CardioTheme.muted,
                    ),
                  ),
                  const SizedBox(height: 14),
                  Text(
                    result.risk.toUpperCase(),
                    style: TextStyle(
                      fontSize: 42,
                      fontWeight: FontWeight.w900,
                      color: colour,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    _headline,
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                      color: colour,
                    ),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    'Model probability: '
                    '${(result.probability * 100).toStringAsFixed(1)}%',
                    style: const TextStyle(
                      fontSize: 13.5,
                      color: CardioTheme.muted,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),

            Card(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'What this means',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                        color: CardioTheme.ink,
                      ),
                    ),
                    const SizedBox(height: 10),
                    Text(
                      _explanation,
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
            const SizedBox(height: 16),

            Card(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'What you entered',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                        color: CardioTheme.ink,
                      ),
                    ),
                    const SizedBox(height: 12),
                    ..._readable().entries.map(
                          (entry) => Padding(
                            padding: const EdgeInsets.only(bottom: 8),
                            child: Row(
                              mainAxisAlignment:
                                  MainAxisAlignment.spaceBetween,
                              children: [
                                Expanded(
                                  child: Text(
                                    entry.key,
                                    style: const TextStyle(
                                      fontSize: 13.5,
                                      color: CardioTheme.muted,
                                    ),
                                  ),
                                ),
                                Text(
                                  entry.value,
                                  style: const TextStyle(
                                    fontSize: 13.5,
                                    fontWeight: FontWeight.w600,
                                    color: CardioTheme.ink,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 20),

            FilledButton(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => DoctorListScreen(
                    risk: result.risk,
                    features: features,
                  ),
                ),
              ),
              child: const Text('Consult a Doctor'),
            ),
            const SizedBox(height: 18),

            Text(
              result.disclaimer,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 11.5,
                height: 1.65,
                color: CardioTheme.faint,
              ),
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }

  /// Turns the model's coded features back into readable answers.
  Map<String, String> _readable() => {
        'Age': '${features['age']} years',
        'Sex': features['sex'] == 1 ? 'Male' : 'Female',
        'Chest pain': switch (features['cp']) {
          1 => 'Typical angina',
          2 => 'Atypical angina',
          3 => 'Non-anginal pain',
          _ => 'None',
        },
        'Resting blood pressure': '${features['trestbps']} mm Hg',
        'Cholesterol': '${features['chol']} mg/dL',
        'Fasting blood sugar > 120': features['fbs'] == 1 ? 'Yes' : 'No',
        'Resting ECG': switch (features['restecg']) {
          1 => 'ST-T abnormality',
          2 => 'Left ventricular hypertrophy',
          _ => 'Normal',
        },
        'Maximum heart rate': '${features['thalach']} bpm',
        'Exercise-induced angina': features['exang'] == 1 ? 'Yes' : 'No',
      };
}
