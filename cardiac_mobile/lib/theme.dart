import 'package:flutter/material.dart';

/// Visual language shared with the React app: the same teal accent on a
/// pale clinical blue, so the two halves of CardioCare look like one
/// product.
class CardioTheme {
  static const Color accent = Color(0xFF2AA7C4);
  static const Color ink = Color(0xFF12385A);
  static const Color muted = Color(0xFF7894AE);
  static const Color faint = Color(0xFF8AA4BB);
  static const Color surface = Color(0xFFEEF5FB);
  static const Color line = Color(0xFFD6E3EE);

  static const Color low = Color(0xFF2C6B43);
  static const Color moderate = Color(0xFF8A5A12);
  static const Color high = Color(0xFFA33A3A);

  static const Color lowBg = Color(0xFFE4F4EA);
  static const Color moderateBg = Color(0xFFFFF4DE);
  static const Color highBg = Color(0xFFFDECEC);

  static Color riskColour(String risk) => switch (risk.toUpperCase()) {
        'LOW' => low,
        'HIGH' => high,
        _ => moderate,
      };

  static Color riskBackground(String risk) => switch (risk.toUpperCase()) {
        'LOW' => lowBg,
        'HIGH' => highBg,
        _ => moderateBg,
      };

  static ThemeData build() {
    final base = ThemeData(
      colorScheme: ColorScheme.fromSeed(
        seedColor: accent,
        primary: accent,
      ),
      scaffoldBackgroundColor: surface,
      useMaterial3: true,
    );

    return base.copyWith(
      appBarTheme: const AppBarTheme(
        backgroundColor: Colors.white,
        foregroundColor: ink,
        elevation: 0,
        centerTitle: false,
        titleTextStyle: TextStyle(
          color: ink,
          fontSize: 19,
          fontWeight: FontWeight.w700,
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: Colors.white,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: line),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: line),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: accent, width: 2),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: high),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: accent,
          padding: const EdgeInsets.symmetric(vertical: 16),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          textStyle: const TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
      cardTheme: CardThemeData(
        color: Colors.white,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(18),
        ),
      ),
    );
  }
}
