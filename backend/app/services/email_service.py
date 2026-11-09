import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from ..core.config import settings


def send_otp_email(recipient_email: str, full_name: str, otp_code: str) -> bool:
    """
    Mengirimkan kode OTP 6 digit ke alamat email pengguna melalui SMTP Gmail.
    Apabila kredensial SMTP belum diisi pada file `.env`, kode OTP akan
    dicetak langsung di terminal Backend untuk memudahkan pengujian lokal.
    """
    print("\n========================================================")
    print("  [OTP EMAIL SERVICE - SISTEM ABSENSI PIA]")
    print(f"  Penerima : {full_name} <{recipient_email}>")
    print(f"  KODE OTP : {otp_code} (Berlaku 5 menit)")
    print("========================================================\n")

    if not settings.SMTP_USER or not settings.SMTP_PASSWORD:
        print(
            "[INFO] SMTP_USER / SMTP_PASSWORD belum diatur di .env. "
            "Menggunakan mode cetak OTP di terminal."
        )
        return True

    subject = f"[{otp_code}] Kode Aktivasi Akun Sistem Absensi PIA"
    html_body = f"""
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px;">
      <h2 style="color: #1e3a8a; margin-top: 0;">Aktivasi Akun Absensi PIA</h2>
      <p style="color: #334155; font-size: 15px; line-height: 1.5;">
        Halo <strong>{full_name}</strong>,<br><br>
        Terima kasih telah mendaftar di <strong>Sistem Informasi Absensi &amp; Pembelajaran PIA</strong>.
        Gunakan 6 digit kode OTP berikut untuk mengaktifkan akun Anda:
      </p>
      <div style="background: #eff6ff; border: 1px dashed #2563eb; border-radius: 10px; padding: 16px; text-align: center; margin: 24px 0;">
        <span style="font-size: 28px; font-weight: bold; letter-spacing: 6px; color: #1d4ed8;">{otp_code}</span>
      </div>
      <p style="color: #64748b; font-size: 13px;">
        Kode ini berlaku selama <strong>5 menit</strong>. Jangan berikan kode ini kepada siapa pun.
      </p>
    </div>
    """

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{settings.SMTP_FROM_NAME} <{settings.SMTP_USER}>"
    msg["To"] = recipient_email
    msg.attach(MIMEText(html_body, "html"))

    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as server:
            server.starttls()
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.sendmail(settings.SMTP_USER, [recipient_email], msg.as_string())
        print(f"[SUKSES] Email OTP berhasil dikirim ke {recipient_email}")
        return True
    except Exception as exc:
        print(f"[PERINGATAN] Gagal mengirim email via SMTP ({exc}). Gunakan kode OTP di terminal di atas.")
        return False
