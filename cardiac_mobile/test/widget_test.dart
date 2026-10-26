import 'package:flutter_test/flutter_test.dart';

import 'package:cardiac_mobile/main.dart';

void main() {
  testWidgets('shows Firebase setup instructions when configuration is missing',
      (tester) async {
    await tester.pumpWidget(
      const CardioCareApp(
        startupError: 'Firebase configuration is missing.',
      ),
    );

    expect(find.text('Configuration needed'), findsOneWidget);
    expect(find.text('Firebase configuration is missing.'), findsOneWidget);
  });
}
