import 'package:flutter/material.dart';

import '../services/firestore_service.dart';
import '../services/prediction_service.dart';
import '../theme.dart';
import 'result_screen.dart';

/// =====================================================================
/// CARDIAC RISK ASSESSMENT
/// =====================================================================
///
/// Collects exactly the nine features the model was trained on — see
/// `cardiac_ml/FEATURE_ANALYSIS.md`. The ranges here match the API's
/// Pydantic constraints, so a user sees the problem before the request
/// is even sent.
///
/// Four dataset features (oldpeak, slope, ca, thal) need an exercise
/// stress test or cardiac imaging. They are NOT collected and NOT
/// faked — they were removed from the model instead.
///
/// Emergency symptoms are collected but are deliberately NOT model
/// inputs. Someone with acute symptoms needs emergency services, not a
/// screening score.
/// =====================================================================
class RiskAssessmentScreen extends StatefulWidget {
  const RiskAssessmentScreen({super.key});

  @override
  State<RiskAssessmentScreen> createState() => _RiskAssessmentScreenState();
}

class _RiskAssessmentScreenState extends State<RiskAssessmentScreen> {
  final _formKey = GlobalKey<FormState>();

  final _age = TextEditingController();
  final _trestbps = TextEditingController();
  final _chol = TextEditingController();
  final _thalach = TextEditingController();

  int? _sex;
  int? _cp;
  int? _fbs;
  int? _restecg;
  int? _exang;

  final Map<String, bool> _symptoms = {};

  bool _busy = false;
  String? _error;

  static const _emergencySymptoms = {
    'chestPainNow': 'Severe chest pain or pressure right now',
    'breathlessAtRest': 'Severe difficulty breathing while resting',
    'fainting': 'Fainted or lost consciousness recently',
    'armJawPain': 'Pain spreading to the arm, jaw, neck or back',
  };

  @override
  void dispose() {
    _age.dispose();
    _trestbps.dispose();
    _chol.dispose();
    _thalach.dispose();
    super.dispose();
  }

  List<String> get _reportedEmergencies => _emergencySymptoms.entries
      .where((entry) => _symptoms[entry.key] == true)
      .map((entry) => entry.value)
      .toList();

  String? _range(String? value, int min, int max) {
    final text = value?.trim() ?? '';

    if (text.isEmpty) return 'Required';

    final number = int.tryParse(text);

    if (number == null) return 'Enter a whole number';

    if (number < min || number > max) return 'Must be between $min and $max';

    return null;
  }

  Future<void> _submit() async {
    final dropdownsComplete = _sex != null &&
        _cp != null &&
        _fbs != null &&
        _restecg != null &&
        _exang != null;

    if (!_formKey.currentState!.validate() || !dropdownsComplete) {
      setState(() => _error = 'Please complete every field.');
      return;
    }

    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      // Exactly the nine model features.
      final features = <String, int>{
        'age': int.parse(_age.text.trim()),
        'sex': _sex!,
        'cp': _cp!,
        'trestbps': int.parse(_trestbps.text.trim()),
        'chol': int.parse(_chol.text.trim()),
        'fbs': _fbs!,
        'restecg': _restecg!,
        'thalach': int.parse(_thalach.text.trim()),
        'exang': _exang!,
      };

      final result = await PredictionService().predict(features);

      final assessmentId = await FirestoreService().saveAssessment(
        features: features,
        result: result,
        emergencySymptoms: _reportedEmergencies,
      );

      if (!mounted) return;

      Navigator.of(context).pushReplacement(
        MaterialPageRoute(
          builder: (_) => ResultScreen(
            result: result,
            features: features,
            emergencySymptoms: _reportedEmergencies,
            assessmentId: assessmentId,
          ),
        ),
      );
    } catch (error) {
      if (mounted) {
        setState(() => _error =
            error is PredictionException ? error.message : error.toString());
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Cardiac Risk Assessment')),
      body: SafeArea(
        child: Form(
          key: _formKey,
          child: ListView(
            padding: const EdgeInsets.all(20),
            children: [
              const Text(
                'This is a screening tool, not a diagnosis. It estimates '
                'the likelihood of significant coronary artery narrowing '
                'from nine health values, to help you decide whether to '
                'speak to a doctor.',
                style: TextStyle(
                  fontSize: 14,
                  height: 1.6,
                  color: CardioTheme.muted,
                ),
              ),
              const SizedBox(height: 22),

              // ---- emergency screening: NOT a model input ----
              _Section(
                title: 'Are you experiencing any of these right now?',
                tinted: true,
                children: [
                  for (final entry in _emergencySymptoms.entries)
                    CheckboxListTile(
                      value: _symptoms[entry.key] ?? false,
                      onChanged: (value) => setState(
                          () => _symptoms[entry.key] = value ?? false),
                      title: Text(
                        entry.value,
                        style: const TextStyle(fontSize: 14),
                      ),
                      contentPadding: EdgeInsets.zero,
                      controlAffinity: ListTileControlAffinity.leading,
                      dense: true,
                    ),
                  if (_reportedEmergencies.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: CardioTheme.highBg,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: const Color(0xFFE8A5A5)),
                      ),
                      child: const Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Seek emergency medical help now.',
                            style: TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w800,
                              color: CardioTheme.high,
                            ),
                          ),
                          SizedBox(height: 6),
                          Text(
                            'The symptoms you have selected can indicate a '
                            'medical emergency. Call your local emergency '
                            'number or go to the nearest emergency '
                            'department immediately. Do not wait for this '
                            'assessment, and do not use it to decide '
                            'whether to seek help.',
                            style: TextStyle(
                              fontSize: 13.5,
                              height: 1.6,
                              color: Color(0xFF8F3B3B),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ],
              ),

              // ---- about you ----
              _Section(
                title: 'About you',
                children: [
                  _NumberField(
                    controller: _age,
                    label: 'Age',
                    hint: 'years',
                    validator: (value) => _range(value, 18, 120),
                  ),
                  _Dropdown(
                    label: 'Sex',
                    hint: 'as recorded at birth',
                    value: _sex,
                    items: const {1: 'Male', 0: 'Female'},
                    onChanged: (value) => setState(() => _sex = value),
                  ),
                ],
              ),

              // ---- symptoms ----
              _Section(
                title: 'Chest pain and exertion',
                children: [
                  _Dropdown(
                    label: 'Chest pain type',
                    hint: 'the description that fits best',
                    value: _cp,
                    // 1-4, matching the training data. The web form used
                    // to send 0-3, shifting every patient one category.
                    items: const {
                      1: 'Typical angina — pressure on exertion, eased by rest',
                      2: 'Atypical angina — chest pain, but not that pattern',
                      3: 'Non-anginal pain — unrelated to the heart',
                      4: 'No chest pain at all',
                    },
                    onChanged: (value) => setState(() => _cp = value),
                  ),
                  _Dropdown(
                    label: 'Chest pain brought on by exercise',
                    hint: 'walking uphill, stairs, exertion',
                    value: _exang,
                    items: const {1: 'Yes', 0: 'No'},
                    onChanged: (value) => setState(() => _exang = value),
                  ),
                ],
              ),

              // ---- measurements ----
              _Section(
                title: 'Measurements',
                children: [
                  _NumberField(
                    controller: _trestbps,
                    label: 'Resting blood pressure',
                    hint: 'mm Hg — the upper (systolic) number, at rest',
                    validator: (value) => _range(value, 70, 250),
                  ),
                  _NumberField(
                    controller: _thalach,
                    label: 'Maximum heart rate',
                    hint: 'bpm — highest reached during exercise',
                    validator: (value) => _range(value, 60, 230),
                  ),
                ],
              ),

              // ---- from a report ----
              _Section(
                title: 'From a recent medical report',
                subtitle: 'These three come from a blood test and an ECG. '
                    'Use a recent report — within the last 12 months is ideal.',
                children: [
                  _NumberField(
                    controller: _chol,
                    label: 'Cholesterol',
                    hint: 'mg/dL — total serum cholesterol',
                    validator: (value) => _range(value, 100, 600),
                  ),
                  _Dropdown(
                    label: 'Fasting blood sugar above 120 mg/dL',
                    hint: 'from a fasting blood test',
                    value: _fbs,
                    items: const {
                      1: 'Yes, above 120 mg/dL',
                      0: 'No, 120 mg/dL or below',
                    },
                    onChanged: (value) => setState(() => _fbs = value),
                  ),
                  _Dropdown(
                    label: 'Resting ECG result',
                    hint: 'as written on the ECG report',
                    value: _restecg,
                    items: const {
                      0: 'Normal',
                      1: 'ST-T wave abnormality',
                      2: 'Left ventricular hypertrophy',
                    },
                    onChanged: (value) => setState(() => _restecg = value),
                  ),
                ],
              ),

              if (_error != null) ...[
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: CardioTheme.highBg,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0xFFF3BCBC)),
                  ),
                  child: Text(
                    _error!,
                    style: const TextStyle(
                      fontSize: 13.5,
                      height: 1.5,
                      color: CardioTheme.high,
                    ),
                  ),
                ),
                const SizedBox(height: 16),
              ],

              FilledButton(
                onPressed: _busy ? null : _submit,
                child: Text(_busy ? 'Analysing...' : 'Generate Risk Assessment'),
              ),
              const SizedBox(height: 14),
              const Text(
                'This assessment is for screening and support purposes only. '
                'It is not a medical diagnosis and cannot rule heart disease '
                'in or out. Always speak to a qualified doctor.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 12,
                  height: 1.6,
                  color: CardioTheme.faint,
                ),
              ),
              const SizedBox(height: 24),
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------
// SMALL BUILDING BLOCKS
// ---------------------------------------------------------------------

class _Section extends StatelessWidget {
  const _Section({
    required this.title,
    required this.children,
    this.subtitle,
    this.tinted = false,
  });

  final String title;
  final String? subtitle;
  final List<Widget> children;
  final bool tinted;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 20),
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: tinted ? const Color(0xFFFFFDF7) : Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: tinted ? const Color(0xFFF0D9A0) : const Color(0xFFE3ECF4),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            title,
            style: const TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w700,
              color: CardioTheme.ink,
            ),
          ),
          if (subtitle != null) ...[
            const SizedBox(height: 6),
            Text(
              subtitle!,
              style: const TextStyle(
                fontSize: 12.5,
                height: 1.55,
                color: CardioTheme.muted,
              ),
            ),
          ],
          const SizedBox(height: 14),
          ...children,
        ],
      ),
    );
  }
}

class _NumberField extends StatelessWidget {
  const _NumberField({
    required this.controller,
    required this.label,
    required this.hint,
    required this.validator,
  });

  final TextEditingController controller;
  final String label;
  final String hint;
  final String? Function(String?) validator;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: TextFormField(
        controller: controller,
        keyboardType: TextInputType.number,
        validator: validator,
        autovalidateMode: AutovalidateMode.onUserInteraction,
        decoration: InputDecoration(
          labelText: label,
          helperText: hint,
          helperMaxLines: 2,
        ),
      ),
    );
  }
}

class _Dropdown extends StatelessWidget {
  const _Dropdown({
    required this.label,
    required this.hint,
    required this.value,
    required this.items,
    required this.onChanged,
  });

  final String label;
  final String hint;
  final int? value;
  final Map<int, String> items;
  final ValueChanged<int?> onChanged;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: DropdownButtonFormField<int>(
        initialValue: value,
        isExpanded: true,
        decoration: InputDecoration(
          labelText: label,
          helperText: hint,
          helperMaxLines: 2,
        ),
        validator: (selected) => selected == null ? 'Required' : null,
        items: items.entries
            .map(
              (entry) => DropdownMenuItem<int>(
                value: entry.key,
                child: Text(
                  entry.value,
                  style: const TextStyle(fontSize: 14),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            )
            .toList(),
        onChanged: onChanged,
      ),
    );
  }
}
