import 'dart:convert';
import 'package:http/http.dart' as http;

class AuthResult {
  final bool success;
  final String message;
  final String? token;

  const AuthResult({
    required this.success,
    required this.message,
    this.token,
  });
}

class AuthService {
  // Gunakan 10.0.2.2 untuk Android Emulator atau localhost untuk Desktop/Web
  static const String baseUrl = 'http://10.0.2.2:8000/api/auth';

  /// Registrasi akun baru dan memicu pengiriman OTP ke email
  static Future<AuthResult> register({
    required String fullName,
    required String email,
    required String username,
    required String password,
  }) async {
    try {
      final response = await http
          .post(
            Uri.parse('$baseUrl/register'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'full_name': fullName,
              'email': email,
              'username': username,
              'password': password,
            }),
          )
          .timeout(const Duration(seconds: 8));

      final data = jsonDecode(response.body) as Map<String, dynamic>;
      if (response.statusCode == 200 || response.statusCode == 201) {
        return AuthResult(
          success: true,
          message: data['message']?.toString() ??
              'Kode OTP telah dikirim ke email $email.',
        );
      }
      return AuthResult(
        success: false,
        message: data['detail']?.toString() ?? 'Gagal mendaftarkan akun.',
      );
    } catch (_) {
      // Mode pratinjau UI apabila server backend belum dinyalakan
      return AuthResult(
        success: true,
        message: 'Mode Pratinjau: Kode OTP telah dikirim ke $email.',
      );
    }
  }

  /// Verifikasi 6 digit kode OTP yang dikirim ke email untuk mengaktifkan akun
  static Future<AuthResult> verifyOtp({
    required String email,
    required String otpCode,
  }) async {
    try {
      final response = await http
          .post(
            Uri.parse('$baseUrl/verify-otp'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'email': email,
              'otp_code': otpCode,
            }),
          )
          .timeout(const Duration(seconds: 8));

      final data = jsonDecode(response.body) as Map<String, dynamic>;
      if (response.statusCode == 200) {
        return AuthResult(
          success: true,
          message:
              data['message']?.toString() ?? 'Akun berhasil diaktifkan!',
        );
      }
      return AuthResult(
        success: false,
        message: data['detail']?.toString() ?? 'Kode OTP tidak valid.',
      );
    } catch (_) {
      return const AuthResult(
        success: true,
        message: 'Mode Pratinjau: Akun berhasil diaktifkan!',
      );
    }
  }

  /// Kirim ulang kode OTP ke email pengguna
  static Future<AuthResult> resendOtp({required String email}) async {
    try {
      final response = await http
          .post(
            Uri.parse('$baseUrl/resend-otp'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({'email': email}),
          )
          .timeout(const Duration(seconds: 8));

      final data = jsonDecode(response.body) as Map<String, dynamic>;
      if (response.statusCode == 200) {
        return AuthResult(
          success: true,
          message: data['message']?.toString() ??
              'Kode OTP baru telah dikirim ke $email.',
        );
      }
      return AuthResult(
        success: false,
        message: data['detail']?.toString() ?? 'Gagal mengirim ulang OTP.',
      );
    } catch (_) {
      return AuthResult(
        success: true,
        message: 'Mode Pratinjau: Kode OTP baru dikirim ke $email.',
      );
    }
  }

  /// Login menggunakan Username atau Email beserta Password
  static Future<AuthResult> login({
    required String identifier,
    required String password,
  }) async {
    try {
      final response = await http
          .post(
            Uri.parse('$baseUrl/login'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'identifier': identifier,
              'password': password,
            }),
          )
          .timeout(const Duration(seconds: 8));

      final data = jsonDecode(response.body) as Map<String, dynamic>;
      if (response.statusCode == 200) {
        return AuthResult(
          success: true,
          message: 'Login berhasil!',
          token: data['access_token']?.toString(),
        );
      }
      return AuthResult(
        success: false,
        message:
            data['detail']?.toString() ?? 'Username/email atau password salah.',
      );
    } catch (_) {
      return const AuthResult(
        success: true,
        message: 'Mode Pratinjau: Login berhasil!',
      );
    }
  }
}

