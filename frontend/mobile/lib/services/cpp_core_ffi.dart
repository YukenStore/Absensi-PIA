import 'dart:ffi' as ffi;
import 'dart:io' show Platform;
import 'package:ffi/ffi.dart';

// Definisi tipe fungsi C dan Dart untuk FFI
typedef _ValidateCredentialsNative = ffi.Int32 Function(
  ffi.Pointer<Utf8> username,
  ffi.Pointer<Utf8> email,
  ffi.Pointer<Utf8> password,
);
typedef _ValidateCredentialsDart = int Function(
  ffi.Pointer<Utf8> username,
  ffi.Pointer<Utf8> email,
  ffi.Pointer<Utf8> password,
);

typedef _EvaluateAttendanceNative = ffi.Int32 Function(
  ffi.Int32 checkinHour,
  ffi.Int32 checkinMinute,
  ffi.Int32 scheduleHour,
  ffi.Int32 scheduleMinute,
  ffi.Int32 toleranceMinutes,
);
typedef _EvaluateAttendanceDart = int Function(
  int checkinHour,
  int checkinMinute,
  int scheduleHour,
  int scheduleMinute,
  int toleranceMinutes,
);

/// Jembatan FFI dari Flutter Mobile ke Shared Library C++ (`backend/cpp_core`)
class CppCoreFFI {
  static ffi.DynamicLibrary? _lib;

  static ffi.DynamicLibrary? _loadLibrary() {
    if (_lib != null) return _lib;
    try {
      if (Platform.isAndroid || Platform.isLinux) {
        _lib = ffi.DynamicLibrary.open('libpia_core.so');
      } else if (Platform.isWindows) {
        _lib = ffi.DynamicLibrary.open('pia_core.dll');
      } else if (Platform.isIOS || Platform.isMacOS) {
        _lib = ffi.DynamicLibrary.process();
      }
      return _lib;
    } catch (_) {
      return null;
    }
  }

  /// Memvalidasi format username, email, dan password melalui C++ Core
  static int validateCredentialsFormat({
    required String username,
    required String email,
    required String password,
  }) {
    final lib = _loadLibrary();
    if (lib == null) {
      // Fallback jika native library belum dibundel ke dalam APK/Runner
      if (username.length < 4 || username.contains(' ')) return -1;
      if (!email.contains('@') || !email.contains('.')) return -2;
      if (password.length < 8) return -3;
      return 1;
    }

    final fn = lib.lookupFunction<_ValidateCredentialsNative,
        _ValidateCredentialsDart>('pia_validate_credentials_format');

    final uPtr = username.toNativeUtf8();
    final ePtr = email.toNativeUtf8();
    final pPtr = password.toNativeUtf8();

    try {
      return fn(uPtr, ePtr, pPtr);
    } finally {
      calloc.free(uPtr);
      calloc.free(ePtr);
      calloc.free(pPtr);
    }
  }

  /// Mengevaluasi status kehadiran (0: Tepat Waktu, 1: Terlambat Toleransi, 2: Terlambat)
  static int evaluateAttendanceStatus({
    required int checkinHour,
    required int checkinMinute,
    required int scheduleHour,
    required int scheduleMinute,
    int toleranceMinutes = 15,
  }) {
    final lib = _loadLibrary();
    if (lib == null) {
      final diff = (checkinHour * 60 + checkinMinute) -
          (scheduleHour * 60 + scheduleMinute);
      if (diff <= 0) return 0;
      if (diff <= toleranceMinutes) return 1;
      return 2;
    }

    final fn = lib.lookupFunction<_EvaluateAttendanceNative,
        _EvaluateAttendanceDart>('pia_evaluate_attendance_status');
    return fn(
      checkinHour,
      checkinMinute,
      scheduleHour,
      scheduleMinute,
      toleranceMinutes,
    );
  }
}

