#define PIA_CORE_EXPORTS
#include "../include/pia_core.h"

#include <cstring>
#include <string>
#include <random>
#include <chrono>
#include <sstream>
#include <iomanip>
#include <cstdint>

namespace {

// Implementasi SHA-256 murni C++17 (tanpa dependensi eksternal agar mudah dikompilasi
// di Windows DLL, Linux SO, dan Android/iOS melalui Flutter FFI).
class SHA256 {
public:
    SHA256() { reset(); }

    void update(const uint8_t* data, size_t length) {
        for (size_t i = 0; i < length; ++i) {
            m_data[m_blocklen++] = data[i];
            if (m_blocklen == 64) {
                transform();
                m_bitlen += 512;
                m_blocklen = 0;
            }
        }
    }

    void update(const std::string& str) {
        update(reinterpret_cast<const uint8_t*>(str.data()), str.size());
    }

    std::string final_hex() {
        uint8_t hash[32];
        pad();
        revert(hash);

        std::ostringstream oss;
        for (int i = 0; i < 32; ++i) {
            oss << std::hex << std::setw(2) << std::setfill('0') << static_cast<int>(hash[i]);
        }
        reset();
        return oss.str();
    }

private:
    uint8_t m_data[64];
    uint32_t m_blocklen;
    uint64_t m_bitlen;
    uint32_t m_state[8];

    static constexpr uint32_t K[64] = {
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
        0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
        0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
        0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
        0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
        0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
        0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
        0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    };

    static uint32_t rotr(uint32_t x, uint32_t n) {
        return (x >> n) | (x << (32 - n));
    }

    void reset() {
        m_blocklen = 0;
        m_bitlen = 0;
        m_state[0] = 0x6a09e667;
        m_state[1] = 0xbb67ae85;
        m_state[2] = 0x3c6ef372;
        m_state[3] = 0xa54ff53a;
        m_state[4] = 0x510e527f;
        m_state[5] = 0x9b05688c;
        m_state[6] = 0x1f83d9ab;
        m_state[7] = 0x5be0cd19;
    }

    void transform() {
        uint32_t m[64];
        uint32_t state[8];

        for (int i = 0, j = 0; i < 16; ++i, j += 4) {
            m[i] = (m_data[j] << 24) | (m_data[j + 1] << 16) | (m_data[j + 2] << 8) | (m_data[j + 3]);
        }
        for (int i = 16; i < 64; ++i) {
            uint32_t s0 = rotr(m[i - 15], 7) ^ rotr(m[i - 15], 18) ^ (m[i - 15] >> 3);
            uint32_t s1 = rotr(m[i - 2], 17) ^ rotr(m[i - 2], 19) ^ (m[i - 2] >> 10);
            m[i] = m[i - 16] + s0 + m[i - 7] + s1;
        }
        for (int i = 0; i < 8; ++i) {
            state[i] = m_state[i];
        }
        for (int i = 0; i < 64; ++i) {
            uint32_t S1 = rotr(state[4], 6) ^ rotr(state[4], 11) ^ rotr(state[4], 25);
            uint32_t ch = (state[4] & state[5]) ^ (~state[4] & state[6]);
            uint32_t temp1 = state[7] + S1 + ch + K[i] + m[i];
            uint32_t S0 = rotr(state[0], 2) ^ rotr(state[0], 13) ^ rotr(state[0], 22);
            uint32_t maj = (state[0] & state[1]) ^ (state[0] & state[2]) ^ (state[1] & state[2]);
            uint32_t temp2 = S0 + maj;

            state[7] = state[6];
            state[6] = state[5];
            state[5] = state[4];
            state[4] = state[3] + temp1;
            state[3] = state[2];
            state[2] = state[1];
            state[1] = state[0];
            state[0] = temp1 + temp2;
        }
        for (int i = 0; i < 8; ++i) {
            m_state[i] += state[i];
        }
    }

    void pad() {
        uint64_t i = m_blocklen;
        uint8_t end = m_blocklen < 56 ? 56 : 64;

        m_data[i++] = 0x80;
        while (i < end) {
            m_data[i++] = 0x00;
        }
        if (m_blocklen >= 56) {
            transform();
            std::memset(m_data, 0, 56);
        }
        m_bitlen += m_blocklen * 8;
        m_data[63] = static_cast<uint8_t>(m_bitlen);
        m_data[62] = static_cast<uint8_t>(m_bitlen >> 8);
        m_data[61] = static_cast<uint8_t>(m_bitlen >> 16);
        m_data[60] = static_cast<uint8_t>(m_bitlen >> 24);
        m_data[59] = static_cast<uint8_t>(m_bitlen >> 32);
        m_data[58] = static_cast<uint8_t>(m_bitlen >> 40);
        m_data[57] = static_cast<uint8_t>(m_bitlen >> 48);
        m_data[56] = static_cast<uint8_t>(m_bitlen >> 56);
        transform();
    }

    void revert(uint8_t* hash) {
        for (int i = 0; i < 4; ++i) {
            for (int j = 0; j < 8; ++j) {
                hash[i + (j * 4)] = (m_state[j] >> (24 - i * 8)) & 0x000000ff;
            }
        }
    }
};

// Perbandingan string constant-time untuk mencegah serangan timing attack
bool constant_time_equals(const std::string& a, const std::string& b) {
    if (a.size() != b.size()) {
        return false;
    }
    volatile uint8_t diff = 0;
    for (size_t i = 0; i < a.size(); ++i) {
        diff |= static_cast<uint8_t>(a[i] ^ b[i]);
    }
    return diff == 0;
}

std::string compute_stretched_hash(const std::string& password, const std::string& salt) {
    SHA256 sha;
    std::string current = salt + ":" + password + ":PIA_CORE_V1";
    // 1000 putaran stretching SHA-256
    for (int i = 0; i < 1000; ++i) {
        sha.update(current);
        current = sha.final_hex() + ":" + salt;
    }
    sha.update(current);
    return sha.final_hex();
}

} // namespace

extern "C" {

PIA_API int pia_generate_otp(int length, char* out_buffer, int buffer_size) {
    if (length <= 0 || out_buffer == nullptr || buffer_size < length + 1) {
        return 0;
    }

    std::random_device rd;
    auto time_seed = static_cast<unsigned int>(
        std::chrono::high_resolution_clock::now().time_since_epoch().count()
    );
    std::mt19937 gen(rd() ^ time_seed);
    std::uniform_int_distribution<int> dist(0, 9);

    for (int i = 0; i < length; ++i) {
        out_buffer[i] = static_cast<char>('0' + dist(gen));
    }
    out_buffer[length] = '\0';
    return 1;
}

PIA_API int pia_verify_otp(
    const char* input_otp,
    const char* stored_otp,
    long long expiry_timestamp,
    long long current_timestamp
) {
    if (input_otp == nullptr || stored_otp == nullptr) {
        return 0;
    }
    if (current_timestamp > expiry_timestamp) {
        return -1; // Kedaluwarsa
    }
    std::string in_str(input_otp);
    std::string st_str(stored_otp);
    return constant_time_equals(in_str, st_str) ? 1 : 0;
}

PIA_API int pia_hash_password(
    const char* password,
    const char* salt,
    char* out_hash,
    int buffer_size
) {
    if (password == nullptr || salt == nullptr || out_hash == nullptr || buffer_size < 65) {
        return 0;
    }
    std::string digest = compute_stretched_hash(password, salt);
    std::strncpy(out_hash, digest.c_str(), buffer_size - 1);
    out_hash[buffer_size - 1] = '\0';
    return 1;
}

PIA_API int pia_verify_password(
    const char* password,
    const char* salt,
    const char* stored_hash
) {
    if (password == nullptr || salt == nullptr || stored_hash == nullptr) {
        return 0;
    }
    std::string computed = compute_stretched_hash(password, salt);
    return constant_time_equals(computed, std::string(stored_hash)) ? 1 : 0;
}

PIA_API int pia_validate_credentials_format(
    const char* username,
    const char* email,
    const char* password
) {
    if (!username || !email || !password) {
        return -1;
    }
    std::string u(username);
    std::string e(email);
    std::string p(password);

    if (u.size() < 4 || u.find(' ') != std::string::npos) {
        return -1; // Username tidak valid
    }
    auto at_pos = e.find('@');
    auto dot_pos = e.find('.', at_pos != std::string::npos ? at_pos : 0);
    if (at_pos == std::string::npos || at_pos == 0 || dot_pos == std::string::npos || dot_pos == e.size() - 1) {
        return -2; // Email tidak valid
    }
    if (p.size() < 8) {
        return -3; // Password kurang dari 8 karakter
    }
    return 1;
}

PIA_API int pia_evaluate_attendance_status(
    int checkin_hour,
    int checkin_minute,
    int schedule_hour,
    int schedule_minute,
    int tolerance_minutes
) {
    int checkin_total = checkin_hour * 60 + checkin_minute;
    int schedule_total = schedule_hour * 60 + schedule_minute;
    int diff = checkin_total - schedule_total;

    if (diff <= 0) {
        return 0; // Hadir Tepat Waktu
    }
    if (diff <= tolerance_minutes) {
        return 1; // Terlambat dalam batas toleransi
    }
    return 2; // Terlambat melebihi toleransi
}

} // extern "C"
