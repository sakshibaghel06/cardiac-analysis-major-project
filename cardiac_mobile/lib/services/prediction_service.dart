import 'dart:convert';

import 'package:http/http.dart' as http;

/// Talks to the FastAPI model service in `cardiac_ml/`.
///
/// The nine feature names and their encodings MUST match
/// `cardiac_ml/model_meta.json` exactly. If they drift, the API
/// answers 422 rather than quietly predicting from wrong values.
///
/// This is the same contract the React app uses, deliberately: one
/// model, one schema, two clients.
class PredictionService {
  /// On the Android emulator, `localhost` is the emulator itself.
  /// 10.0.2.2 is the alias for the host machine. On a physical phone
  /// neither works - use the host's LAN address.
  static const String _baseUrl = String.fromEnvironment(
    'PREDICTION_API_URL',
    defaultValue: 'http://10.0.2.2:8000',
  );

  /// Exactly the features the deployed model was trained on.
  static const List<String> features = [
    'age',
    'sex',
    'cp',
    'trestbps',
    'chol',
    'fbs',
    'restecg',
    'thalach',
    'exang',
  ];

  Future<RiskResult> predict(Map<String, int> values) async {
    final missing =
        features.where((name) => !values.containsKey(name)).toList();

    if (missing.isNotEmpty) {
      throw PredictionException(
        'Missing required values: ${missing.join(', ')}',
      );
    }

    // Send exactly the model features, nothing more.
    final payload = <String, int>{
      for (final name in features) name: values[name]!,
    };

    http.Response response;

    try {
      response = await http
          .post(
            Uri.parse('$_baseUrl/predict'),
            headers: const {'Content-Type': 'application/json'},
            body: jsonEncode(payload),
          )
          .timeout(const Duration(seconds: 20));
    } catch (_) {
      throw PredictionException(
        'Could not reach the risk assessment service.\n\n'
        'Check that it is running:\n'
        '  cd cardiac_ml\n'
        '  uvicorn api:app --host 0.0.0.0 --port 8000\n\n'
        'Currently trying: $_baseUrl',
      );
    }

    if (response.statusCode == 422) {
      throw PredictionException(
        'Some of the values entered are outside the accepted range. '
        'Please check them and try again.',
      );
    }

    if (response.statusCode != 200) {
      throw PredictionException(
        'The risk assessment service could not process this request.',
      );
    }

    return RiskResult.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  /// Used to show an accurate message when the API is unreachable.
  Future<bool> isReachable() async {
    try {
      final response = await http
          .get(Uri.parse('$_baseUrl/health'))
          .timeout(const Duration(seconds: 5));

      return response.statusCode == 200;
    } catch (_) {
      return false;
    }
  }
}

class RiskResult {
  const RiskResult({
    required this.risk,
    required this.probability,
    required this.prediction,
    required this.modelType,
    required this.disclaimer,
    required this.thresholds,
  });

  /// LOW, MODERATE or HIGH.
  final String risk;

  /// The model's probability of significant coronary narrowing.
  final double probability;

  /// The binary prediction at the default 0.5 cut.
  final int prediction;

  final String modelType;
  final String disclaimer;
  final Map<String, dynamic> thresholds;

  factory RiskResult.fromJson(Map<String, dynamic> json) => RiskResult(
        risk: json['risk'] as String? ?? 'MODERATE',
        probability: (json['probability'] as num?)?.toDouble() ?? 0,
        prediction: (json['prediction'] as num?)?.toInt() ?? 0,
        modelType: json['modelType'] as String? ?? 'unknown',
        disclaimer: json['disclaimer'] as String? ?? '',
        thresholds:
            (json['thresholds'] as Map?)?.cast<String, dynamic>() ?? const {},
      );

  Map<String, dynamic> toFirestore() => {
        'risk': risk,
        'probability': probability,
        'prediction': prediction,
        'modelType': modelType,
        'thresholds': thresholds,
      };
}

class PredictionException implements Exception {
  PredictionException(this.message);

  final String message;

  @override
  String toString() => message;
}
