/**
 * Kullanıcıya gösterilen Türkçe mesajlar. Kodlar istemci tarafında programatik eşleme için kullanılır.
 */
export const MESSAGES = {
  AUTH_INVALID_CREDENTIALS: 'E-posta adresi veya parola hatalı.',
  AUTH_ACCOUNT_DISABLED: 'Bu hesap devre dışı bırakılmış. Lütfen yöneticinizle iletişime geçin.',
  AUTH_UNAUTHENTICATED: 'Bu işlem için oturum açmanız gerekiyor.',
  AUTH_SESSION_EXPIRED: 'Oturumunuzun süresi dolmuş. Lütfen yeniden giriş yapın.',
  AUTH_FORBIDDEN: 'Bu işlemi gerçekleştirmek için yetkiniz yok.',
  AUTH_CSRF: 'İstek doğrulaması başarısız oldu. Sayfayı yenileyip tekrar deneyin.',
  AUTH_REGISTRATION_CLOSED: 'Yeni hesap kaydı kapalı. Hesap oluşturmak için bir yöneticiye başvurun.',
  AUTH_EMAIL_IN_USE: 'Bu e-posta adresi zaten kullanılıyor.',
  AUTH_PASSWORD_WEAK: 'Parola en az 12 karakter olmalı; harf ve rakam içermelidir.',
  AUTH_CURRENT_PASSWORD_WRONG: 'Mevcut parola hatalı.',
  AUTH_SESSION_NOT_FOUND: 'Oturum bulunamadı.',
  AUTH_RATE_LIMITED: 'Çok fazla deneme yaptınız. Lütfen bir süre bekleyip tekrar deneyin.',
  VALIDATION_FAILED: 'Gönderilen veriler geçersiz.',
  NOT_FOUND: 'Kayıt bulunamadı.',
  INTERNAL_ERROR: 'Beklenmeyen bir hata oluştu. Lütfen daha sonra tekrar deneyin.',
  USER_NOT_FOUND: 'Kullanıcı bulunamadı.',
  USER_CANNOT_MODIFY_SELF_ROLE: 'Kendi rolünüzü veya hesap durumunuzu değiştiremezsiniz.',
  USER_CANNOT_MODIFY_SUPER_ADMIN: 'Süper yönetici hesapları yalnızca başka bir süper yönetici tarafından düzenlenebilir.',
  USER_LAST_SUPER_ADMIN: 'Sistemdeki son süper yönetici hesabı devre dışı bırakılamaz veya rolü değiştirilemez.',
} as const;

export type MessageCode = keyof typeof MESSAGES;
